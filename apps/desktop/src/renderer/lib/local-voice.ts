import type { BrowserBridge } from '../../shared/ipc.js';
import { speechChunks } from '../../shared/speech.js';
import type { VoiceState, VoiceTaskResult, VoiceTranscript } from './realtime-voice.js';

interface Options {
  bridge: Pick<BrowserBridge['voice'], 'transcribe'> & Partial<Pick<BrowserBridge['voice'], 'prepareSpeech' | 'synthesize'>>;
  onState: (state: VoiceState) => void;
  onTranscript: (entry: VoiceTranscript) => void;
  onMicrophoneStream?: (stream: MediaStream) => void;
  onBrowserTask: (prompt: string, signal: AbortSignal) => Promise<VoiceTaskResult>;
}

interface Playback {
  cancelled: Promise<void>;
  cancel: () => void;
  source?: AudioBufferSourceNode;
  utterance?: SpeechSynthesisUtterance;
}

// Discard silence around a turn without cutting its initial consonants or ending.
function speechSamples(audio: Float32Array): Float32Array {
  const frame = 320;
  let first = -1;
  let last = 0;
  for (let offset = 0; offset < audio.length; offset += frame) {
    let energy = 0;
    const end = Math.min(offset + frame, audio.length);
    for (let index = offset; index < end; index++) energy += audio[index]! ** 2;
    if (Math.sqrt(energy / (end - offset)) >= 0.003) {
      if (first < 0) first = offset;
      last = end;
    }
  }
  if (first < 0) return new Float32Array();
  return audio.slice(Math.max(0, first - 2560), Math.min(audio.length, last + 3840));
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
  private captureGeneration = 0;
  private playbackGeneration = 0;
  private playback?: Playback;
  private preparing?: Promise<void>;
  private neuralReady = false;
  private coolingDown = false;
  private cooldownTimer?: ReturnType<typeof setTimeout>;
  private releaseCooldown?: () => void;

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
      // Preparation starts only after the user grants microphone access. A slow
      // first download never prevents capture or the installed-voice fallback.
      const prepareSpeech = this.options.bridge.prepareSpeech;
      if (prepareSpeech && this.options.bridge.synthesize) {
        this.preparing = Promise.resolve().then(() => prepareSpeech()).then(() => {
          this.neuralReady = true;
        }).catch(() => {});
      }
      globalThis.speechSynthesis?.getVoices();
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
        if (this.captureBlocked()) {
          this.hadSpeech = false;
          this.silenceAt = 0;
        } else if (rms > 0.025) {
          this.hadSpeech = true;
          this.silenceAt = 0;
        } else if (this.hadSpeech) {
          if (!this.silenceAt) this.silenceAt = performance.now();
          if (performance.now() - this.silenceAt >= 900 && this.recorder?.state === 'recording') {
            this.recorder.stop();
          }
        }
        this.frame = requestAnimationFrame(tick);
      };
      tick();
    } catch (error) {
      if (!this.ended) this.fail(error instanceof Error ? error.message : 'Could not start your microphone.');
    }
  }

  private captureBlocked(): boolean {
    return this.ended || this.state.muted || !!this.playback || this.coolingDown;
  }

  private resetCapture(): void {
    this.captureGeneration++;
    this.hadSpeech = false;
    this.silenceAt = 0;
    clearTimeout(this.clipTimer);
    const recorder = this.recorder;
    this.recorder = undefined;
    if (recorder?.state === 'recording') recorder.stop();
  }

  private syncCapture(): void {
    const enabled = !this.captureBlocked();
    this.stream?.getAudioTracks().forEach((track) => { track.enabled = enabled; });
    if (enabled) this.record();
  }

  private record(): void {
    if (this.captureBlocked() || !this.stream || this.recorder?.state === 'recording') return;
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    const generation = this.captureGeneration;
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => {
      if (this.recorder === recorder && !this.ended) this.fail('Could not record audio. Try Voice Mode again.');
    };
    recorder.onstop = () => {
      if (this.recorder !== recorder) return;
      clearTimeout(this.clipTimer);
      this.recorder = undefined;
      if (this.ended) return;
      const heardSpeech = this.hadSpeech;
      const blob = new Blob(chunks, { type: recorder.mimeType });
      this.record();
      if (generation !== this.captureGeneration || this.captureBlocked() || !heardSpeech || !blob.size) return;
      if (this.queued >= 4) { this.caption('assistant', 'Voice is catching up. Please pause before the next command.'); return; }
      this.queued++;
      this.queue = this.queue.then(() => this.process(blob, generation)).catch((error: unknown) => {
        if (this.currentCapture(generation)) this.fail(error instanceof Error ? error.message : 'Could not transcribe that.');
      }).finally(() => { this.queued--; });
    };
    this.recorder = recorder;
    this.hadSpeech = false;
    this.silenceAt = 0;
    recorder.start();
    this.clipTimer = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 30_000);
  }

  private currentCapture(generation: number): boolean {
    return generation === this.captureGeneration && !this.captureBlocked();
  }

  private async process(blob: Blob, generation: number): Promise<void> {
    if (!this.currentCapture(generation) || !this.context) return;
    if (!this.draining && !this.playback) this.update({ phase: 'thinking' });
    const bytes = await blob.arrayBuffer();
    if (!this.currentCapture(generation)) return;
    const decoded = await this.context.decodeAudioData(bytes);
    if (!this.currentCapture(generation)) return;
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const pcm = (await offline.startRendering()).getChannelData(0);
    if (!this.currentCapture(generation)) return;
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.max(-1, Math.min(1, pcm[i]!));
    const audio = speechSamples(pcm);
    if (audio.length < 1600) { this.listenWhenIdle(); return; }
    const { text } = await this.options.bridge.transcribe(audio);
    if (!this.currentCapture(generation)) return;
    if (!text.trim()) { this.listenWhenIdle(); return; }
    this.caption('user', text);
    if (/^(?:please )?(?:stop|cancel)(?: (?:the |this |my )?(?:browser )?(?:task|request|work))?[.!]?$/i.test(text.trim())) {
      if (this.task || this.prompts.length || this.playback) { this.cancelTask(); return; }
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
      while (!this.ended && this.prompts.length) await this.runTask(this.prompts.shift()!);
    } catch (error) {
      if (!this.ended) this.fail(error instanceof Error ? error.message : 'Voice could not continue. Please try again.');
    } finally {
      this.draining = false;
      this.listenWhenIdle();
    }
  }

  private async runTask(text: string): Promise<void> {
    const controller = new AbortController();
    this.task = controller;
    if (this.playback) this.interrupt();
    this.update({ phase: 'working' });
    let result: VoiceTaskResult;
    try { result = await this.options.onBrowserTask(text, controller.signal); }
    catch { result = { status: 'failed', text: 'The assistant could not complete that request. Please try again.' }; }
    finally { if (this.task === controller) this.task = undefined; }
    if (this.ended || controller.signal.aborted) return;
    const reply = result.text || result.error || 'The task did not return a response.';
    this.caption('assistant', reply);
    await this.speak(reply);
  }

  private caption(role: VoiceTranscript['role'], text: string): void {
    this.options.onTranscript({ id: crypto.randomUUID(), role, text, final: true });
  }

  private owns(playback: Playback): boolean {
    return !this.ended && this.playback === playback;
  }

  private async waitOwned<T>(pending: Promise<T>, playback: Playback, timeout: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        pending,
        playback.cancelled.then(() => { throw new Error('Speech interrupted'); }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Speech took too long')), timeout); }),
      ]);
    } finally { clearTimeout(timer); }
  }

  private async speak(text: string): Promise<void> {
    const chunks = speechChunks(text, 300, 160);
    this.playbackText = text;
    if (!chunks.length || this.ended) return;
    this.cancelPlayback();
    this.cancelCooldown();
    const generation = ++this.playbackGeneration;
    let cancel!: () => void;
    const playback: Playback = { cancelled: new Promise<void>((resolve) => { cancel = resolve; }), cancel: () => cancel() };
    this.playback = playback;
    this.resetCapture();
    this.syncCapture();
    this.update({ phase: 'thinking', playbackBlocked: false, outputPending: true });
    try {
      if (!this.neuralReady && this.preparing) {
        try { await this.waitOwned(this.preparing, playback, 8_000); }
        catch { if (!this.owns(playback)) return; }
      }
      const synthesize = this.options.bridge.synthesize;
      let neural = this.neuralReady && !!synthesize;
      // Generate the next clip while the current one plays, so consecutive
      // sentences flow without a pause for inference between them.
      const request = (index: number) => {
        if (!neural || !synthesize || index >= chunks.length) return undefined;
        const audio = Promise.resolve().then(() => synthesize(chunks[index]!));
        audio.catch(() => {});
        return audio;
      };
      let upcoming = request(0);
      for (let index = 0; index < chunks.length; index++) {
        if (!this.owns(playback)) return;
        const current = upcoming;
        upcoming = undefined;
        if (current) {
          try {
            const audio = await this.waitOwned(current, playback, 30_000);
            if (!this.owns(playback)) return;
            upcoming = request(index + 1);
            await this.playAudio(audio.audio, audio.sampleRate, playback);
            continue;
          } catch {
            if (!this.owns(playback)) return;
            neural = false;
            upcoming = undefined;
          }
        }
        await this.speakInstalled(chunks[index]!, playback);
      }
    } catch {
      if (this.owns(playback)) this.update({ playbackBlocked: true });
    } finally {
      if (this.owns(playback)) {
        this.playback = undefined;
        this.update({ outputPending: false });
        await this.restoreCapture(generation);
      }
    }
  }

  private async playAudio(audio: Float32Array, sampleRate: number, playback: Playback): Promise<void> {
    if (!this.context || !(audio instanceof Float32Array) || !audio.length || !Number.isFinite(sampleRate) ||
        sampleRate < 8000 || sampleRate > 192000 || audio.length > sampleRate * 60 || audio.some((sample) => !Number.isFinite(sample))) {
      throw new Error('Invalid speech audio');
    }
    await this.waitOwned(this.context.resume(), playback, 5_000);
    if (!this.owns(playback)) return;
    const buffer = this.context.createBuffer(1, audio.length, sampleRate);
    buffer.getChannelData(0).set(audio);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    playback.source = source;
    try {
      const finished = new Promise<void>((resolve) => { source.onended = () => resolve(); });
      this.update({ phase: 'speaking' });
      source.start();
      await this.waitOwned(finished, playback, (audio.length / sampleRate) * 1000 + 5_000);
    } finally {
      source.onended = null;
      try { source.stop(); } catch { /* Already ended or cancelled. */ }
      source.disconnect();
      if (playback.source === source) playback.source = undefined;
    }
  }

  private async speakInstalled(text: string, playback: Playback): Promise<void> {
    const engine = globalThis.speechSynthesis;
    if (!engine || typeof SpeechSynthesisUtterance === 'undefined') throw new Error('Installed speech is unavailable');
    if (!engine.getVoices().length && engine.addEventListener) {
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); engine.removeEventListener('voiceschanged', done); resolve(); };
        const timer = setTimeout(done, 1000);
        engine.addEventListener('voiceschanged', done);
        void playback.cancelled.then(done);
      });
    }
    if (!this.owns(playback)) return;
    const voices = engine.getVoices().filter((voice) => voice.localService && voice.lang.startsWith('en'));
    const score = (voice: SpeechSynthesisVoice) =>
      (voice.lang.toLowerCase() === 'en-us' ? 100 : 0) +
      (/samantha|ava|allison|susan|zira|aria|jenny|joanna/i.test(voice.name) ? 20 : 0) +
      (/natural|enhanced|premium/i.test(voice.name) ? 10 : 0) + (voice.default ? 1 : 0);
    voices.sort((left, right) => score(right) - score(left));
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 1.02;
    if (voices[0]) utterance.voice = voices[0];
    playback.utterance = utterance;
    try {
      const finished = new Promise<void>((resolve, reject) => {
        utterance.onend = () => resolve();
        utterance.onerror = (event) => reject(new Error(event.error));
      });
      this.update({ phase: 'speaking' });
      engine.speak(utterance);
      await this.waitOwned(finished, playback, 45_000);
    } finally {
      utterance.onend = null;
      utterance.onerror = null;
      if (this.owns(playback) && playback.utterance === utterance) engine.cancel();
      if (playback.utterance === utterance) playback.utterance = undefined;
    }
  }

  private cancelPlayback(): void {
    const playback = this.playback;
    this.playback = undefined;
    if (!playback) return;
    if (!this.ended) this.update({ outputPending: false });
    playback.cancel();
    try { playback.source?.stop(); } catch { /* Source may already have ended. */ }
    if (playback.utterance) globalThis.speechSynthesis?.cancel();
  }

  private cancelCooldown(): void {
    clearTimeout(this.cooldownTimer);
    this.coolingDown = false;
    this.releaseCooldown?.();
    this.releaseCooldown = undefined;
  }

  private async restoreCapture(generation: number): Promise<void> {
    if (this.ended || generation !== this.playbackGeneration) return;
    this.cancelCooldown();
    this.coolingDown = true;
    this.syncCapture();
    await new Promise<void>((resolve) => {
      this.releaseCooldown = resolve;
      this.cooldownTimer = setTimeout(resolve, 150);
    });
    if (this.ended || generation !== this.playbackGeneration || this.playback) return;
    this.releaseCooldown = undefined;
    this.coolingDown = false;
    this.resetCapture();
    this.syncCapture();
    this.listenWhenIdle();
  }

  private listenWhenIdle(): void {
    if (!this.ended && !this.draining && !this.task && !this.playback && !this.coolingDown) this.update({ phase: 'listening' });
  }

  setMuted(muted: boolean): void {
    if (this.ended) return;
    this.update({ muted });
    this.resetCapture();
    this.syncCapture();
  }

  interrupt(): void {
    this.cancelPlayback();
    this.cancelCooldown();
    this.resetCapture();
    if (!this.ended) void this.restoreCapture(++this.playbackGeneration);
  }

  async enableAudio(): Promise<void> {
    if (this.ended || this.state.phase !== 'listening' || this.draining || this.task || !this.state.playbackBlocked || !this.playbackText) return;
    await this.speak(this.playbackText);
    this.listenWhenIdle();
  }

  cancelTask(): void {
    if (this.ended) return;
    this.prompts = [];
    this.task?.abort();
    this.interrupt();
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
    cancelAnimationFrame(this.frame);
    this.prompts = [];
    this.task?.abort();
    this.cancelPlayback();
    this.cancelCooldown();
    this.resetCapture();
    this.stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    void this.context?.close().catch(() => {});
  }

  private update(patch: Partial<VoiceState>): void {
    this.state = { ...this.state, ...patch };
    this.options.onState(this.state);
  }
}
