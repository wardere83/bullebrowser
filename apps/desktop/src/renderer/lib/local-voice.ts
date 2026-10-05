import type { BrowserBridge } from '../../shared/ipc.js';
import type { VoiceState, VoiceTaskResult, VoiceTranscript } from './realtime-voice.js';

interface Options {
  bridge: BrowserBridge['voice'];
  onState: (state: VoiceState) => void;
  onTranscript: (entry: VoiceTranscript) => void;
  onMicrophoneStream?: (stream: MediaStream) => void;
  onBrowserTask: (prompt: string, signal: AbortSignal) => Promise<VoiceTaskResult>;
}

// Local speech input/output. Browser tasks retain the selected assistant's
// normal authorization and approval flow; speech itself has no credential.
export class LocalVoiceSession {
  private state: VoiceState = { phase: 'connecting', muted: false, playbackBlocked: false };
  private ended = false;
  private started = false;
  private stream?: MediaStream;
  private context?: AudioContext;
  private recorder?: MediaRecorder;
  private frame = 0;
  private hadSpeech = false;
  private silenceAt = 0;
  private prompts: string[] = [];
  private draining = false;
  private playbackText = '';
  private clipTimer?: ReturnType<typeof setTimeout>;
  private micTimer?: ReturnType<typeof setTimeout>;
  private task?: AbortController;
  private queued = 0;
  private queue: Promise<void> = Promise.resolve();
  private speech?: SpeechSynthesisUtterance;
  private releaseSpeech?: () => void;

  constructor(private readonly options: Options) {}

  async start(): Promise<void> {
    if (this.started || this.ended) return;
    this.started = true;
    this.update({ phase: 'connecting' });
    try {
      const request = navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      } });
      void request.then((stream) => {
        if (this.ended) stream.getTracks().forEach((track) => track.stop());
      }, () => {});
      const stream = await Promise.race([request, new Promise<never>((_, reject) => {
        this.micTimer = setTimeout(() => reject(new Error('Microphone access took too long. Check its permissions and try again.')), 10_000);
      })]);
      clearTimeout(this.micTimer);
      if (this.ended) { stream.getTracks().forEach((track) => track.stop()); return; }
      this.stream = stream;
      for (const track of stream.getAudioTracks()) {
        track.onended = () => this.fail('Your microphone disconnected. Reconnect it and try Voice Mode again.');
      }
      this.options.onMicrophoneStream?.(stream);
      if (this.ended) return;
      this.context = new AudioContext();
      await this.context.resume();
      if (this.ended) return;
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 256;
      this.context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      this.record();
      this.update({ phase: 'listening' });
      const tick = () => {
        if (this.ended) return;
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
        // Speaker output must not be recorded as a new user command. Explicit
        // interruption is available while speaking; capture resumes afterward.
        if (!this.state.muted && this.state.phase !== 'speaking' && rms > 0.025) {
          this.hadSpeech = true;
          this.silenceAt = 0;
        } else if (this.hadSpeech) {
          if (!this.silenceAt) this.silenceAt = performance.now();
          if (performance.now() - this.silenceAt > 1600) {
            if (this.recorder?.state === 'recording') this.recorder.stop();
          }
        }
        this.frame = requestAnimationFrame(tick);
      };
      tick();
    } catch (error) {
      if (!this.ended) this.fail(error instanceof Error ? error.message : 'Could not start your microphone.');
    }
  }

  private record(): void {
    if (this.ended || !this.stream) return;
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => this.fail('Could not record audio. Try Voice Mode again.');
    recorder.onstop = () => {
      clearTimeout(this.clipTimer);
      if (this.ended) return;
      const heardSpeech = this.hadSpeech;
      const blob = new Blob(chunks, { type: recorder.mimeType });
      this.record();
      if (!heardSpeech || blob.size < 1400) return;
      if (this.queued >= 4) { this.caption('assistant', 'Voice is catching up. Please pause before the next command.'); return; }
      this.queued++;
      this.queue = this.queue.then(() => this.process(blob)).catch((error: unknown) => {
        if (!this.ended) this.fail(error instanceof Error ? error.message : 'Could not transcribe that.');
      }).finally(() => { this.queued--; });
    };
    this.recorder = recorder;
    this.hadSpeech = false;
    this.silenceAt = 0;
    recorder.start();
    this.clipTimer = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 30_000);
  }

  private async process(blob: Blob): Promise<void> {
    if (this.ended || !this.context) return;
    if (!this.draining) this.update({ phase: 'thinking' });
    const decoded = await this.context.decodeAudioData(await blob.arrayBuffer());
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const pcm = (await offline.startRendering()).getChannelData(0);
    // Resampling/Opus decoding can overshoot the PCM range slightly.
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.max(-1, Math.min(1, pcm[i]!));
    if (this.ended) return;
    const { text } = await this.options.bridge.transcribe(pcm);
    if (this.ended) return;
    if (!text.trim()) { if (!this.draining) this.update({ phase: 'listening' }); return; }
    this.caption('user', text);
    if (/^(?:please )?(?:stop|cancel)(?: (?:the |this |my )?(?:browser )?(?:task|request|work))?[.!]?$/i.test(text.trim())) {
      if (this.task || this.prompts.length) { this.cancelTask(); return; }
    }
    if (this.prompts.length >= 4) {
      this.caption('assistant', 'Voice is catching up. Please pause before the next command.');
      return;
    }
    this.prompts.push(text);
    void this.drainTasks();
  }

  private async drainTasks(): Promise<void> {
    if (this.draining || this.ended) return;
    this.draining = true;
    try {
      while (!this.ended && this.prompts.length) {
        const text = this.prompts.shift()!;
        await this.runTask(text);
      }
    } catch (error) {
      if (!this.ended) this.fail(error instanceof Error ? error.message : 'Voice could not continue. Please try again.');
    } finally {
      this.draining = false;
      if (!this.ended) this.update({ phase: 'listening' });
    }
  }

  private async runTask(text: string): Promise<void> {
    const controller = new AbortController();
    this.task = controller;
    this.update({ phase: 'working' });
    let result: VoiceTaskResult;
    try { result = await this.options.onBrowserTask(text, controller.signal); }
    catch { result = { status: 'failed', text: 'The assistant could not complete that request. Please try again.' }; }
    finally { if (this.task === controller) this.task = undefined; }
    if (this.ended) return;
    const reply = result.text || result.error || 'The task did not return a response.';
    this.caption('assistant', reply);
    await this.speak(reply);
    if (!this.ended) this.update({ phase: 'listening' });
  }

  private caption(role: VoiceTranscript['role'], text: string): void {
    this.options.onTranscript({ id: crypto.randomUUID(), role, text, final: true });
  }

  private async speak(text: string): Promise<void> {
    this.playbackText = text;
    if (!globalThis.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
      this.update({ playbackBlocked: true });
      return;
    }
    this.update({ phase: 'speaking', playbackBlocked: false });
    // Disable capture during speaker playback to prevent feedback commands.
    this.stream?.getAudioTracks().forEach((track) => { track.enabled = false; });
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 4000));
    this.speech = utterance;
    // Prefer an installed voice so spoken output also works offline.
    const voices = speechSynthesis.getVoices();
    const voice = voices.find((v) => v.localService && v.lang.startsWith('en'));
    if (voice) utterance.voice = voice;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (!this.ended) this.update({ playbackBlocked: true });
        speechSynthesis.cancel();
        finish();
      }, 120_000);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        this.releaseSpeech = undefined;
        this.speech = undefined;
        this.stream?.getAudioTracks().forEach((track) => { track.enabled = !this.state.muted; });
        resolve();
      };
      this.releaseSpeech = finish;
      utterance.onend = finish;
      utterance.onerror = (event) => {
        if (finished) return;
        if (!this.ended && event.error !== 'canceled' && event.error !== 'interrupted') {
          this.update({ playbackBlocked: true });
        }
        finish();
      };
      try { speechSynthesis.speak(utterance); }
      catch { this.update({ playbackBlocked: true }); finish(); }
    });
  }

  setMuted(muted: boolean): void {
    if (this.ended) return;
    this.stream?.getAudioTracks().forEach((track) => { track.enabled = !muted && this.state.phase !== 'speaking'; });
    this.update({ muted });
  }

  interrupt(): void {
    if (this.speech) globalThis.speechSynthesis?.cancel();
    this.releaseSpeech?.();
    if (!this.ended && !this.task) this.update({ phase: 'listening' });
  }

  async enableAudio(): Promise<void> {
    if (this.ended || this.state.phase !== 'listening' || !this.state.playbackBlocked || !this.playbackText) return;
    await this.speak(this.playbackText);
    if (!this.ended && !this.task) this.update({ phase: 'listening' });
  }

  cancelTask(): void {
    if (this.ended) return;
    this.prompts = [];
    this.task?.abort();
  }

  stop(): void {
    if (this.ended) return;
    this.cleanup();
    this.update({ phase: 'closed' });
  }

  private fail(error: string): void {
    if (this.ended) return;
    this.cleanup();
    this.update({ phase: 'error', error });
  }

  private cleanup(): void {
    this.ended = true;
    clearTimeout(this.micTimer);
    clearTimeout(this.clipTimer);
    cancelAnimationFrame(this.frame);
    this.prompts = [];
    this.task?.abort();
    this.interrupt();
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    void this.context?.close().catch(() => {});
  }

  private update(patch: Partial<VoiceState>): void {
    this.state = { ...this.state, ...patch };
    this.options.onState(this.state);
  }
}
