import type { BrowserBridge } from '../../shared/ipc.js';

export type VoicePhase = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'working' | 'error' | 'closed';
export interface VoiceState {
  phase: VoicePhase;
  muted: boolean;
  playbackBlocked: boolean;
  error?: string;
}
export interface VoiceTranscript {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  final: boolean;
}
export interface VoiceTaskResult {
  status: 'completed' | 'failed' | 'cancelled';
  text: string;
  error?: string;
}

interface VoiceOptions {
  bridge: BrowserBridge['voice'];
  onState: (state: VoiceState) => void;
  onTranscript: (entry: VoiceTranscript) => void;
  onMicrophoneStream?: (stream: MediaStream) => void;
  onBrowserTask: (prompt: string, signal: AbortSignal) => Promise<VoiceTaskResult>;
}

type ServerEvent = Record<string, unknown>;
const CONNECTION_TIMEOUT_MS = 40_000;
const MICROPHONE_TIMEOUT_MS = 10_000;
const DISCONNECT_GRACE_MS = 5_000;
const MAX_TRANSCRIPTS = 100;
const MAX_TRANSCRIPT_LENGTH = 12_000;
const MAX_TASKS = 256;

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

function microphoneError(error: unknown): Error {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return new Error('Microphone access was denied. Allow BulleBrowser to use your microphone, then try again.');
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return new Error('No microphone was found. Connect a microphone, then try again.');
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return new Error('Your microphone could not be opened. Check whether another app is using it, then try again.');
  }
  return new Error('Could not open your microphone. Check its permissions and try again.');
}

/** One owned voice call. Create a new instance to retry after stop or an error. */
export class RealtimeVoiceSession {
  private state: VoiceState = { phase: 'closed', muted: false, playbackBlocked: false };
  private readonly lifetime = new AbortController();
  private started = false;
  private ended = false;
  private startPromise?: Promise<void>;
  private microphone?: MediaStream;
  private peer?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private audio?: HTMLAudioElement;
  private callId?: string;
  private connected = false;
  private disconnected = false;
  private disconnectTimer?: ReturnType<typeof setTimeout>;
  private readonly remoteTracks = new Set<MediaStreamTrack>();
  private readonly activeResponses = new Set<string>();
  private readonly transcripts = new Map<string, VoiceTranscript>();
  private readonly seenTasks = new Set<string>();
  private readonly tasks = new Map<string, AbortController>();
  private userSpeaking = false;
  private audioPlaying = false;
  private followupPending = false;
  private responseRequested = false;

  constructor(private readonly options: VoiceOptions) {}

  async start(): Promise<void> {
    if (this.started || this.ended) return this.startPromise;
    this.started = true;
    this.updateState({ phase: 'connecting' });
    this.startPromise = this.waitFor(
      this.connect(), CONNECTION_TIMEOUT_MS,
      'Voice Mode took too long to connect. Check your connection and try again.',
    ).catch((error: unknown) => {
      if (!this.ended) {
        this.fail(error instanceof Error ? error.message : 'Could not start Voice Mode. Please try again.');
      }
    });
    return this.startPromise;
  }

  stop(): void {
    this.cleanup();
    this.updateState({ phase: 'closed', playbackBlocked: false, error: undefined });
  }

  setMuted(value: boolean): void {
    if (this.ended) return;
    for (const track of this.microphone?.getAudioTracks() ?? []) track.enabled = !value;
    this.updateState({ muted: value });
  }

  interrupt(): void {
    if (this.ended) return;
    if (this.activeResponses.size) this.send({ type: 'response.cancel' });
    this.send({ type: 'output_audio_buffer.clear' });
  }

  async enableAudio(): Promise<void> {
    if (this.ended || !this.audio) return;
    try {
      await this.audio.play();
      if (!this.ended) this.updateState({ playbackBlocked: false });
    } catch {
      if (!this.ended) this.updateState({ playbackBlocked: true });
    }
  }

  private async connect(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone access is unavailable. Restart BulleBrowser and try again.');
    }
    const microphoneRequest = navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    }).catch((error: unknown) => { throw microphoneError(error); });
    // getUserMedia cannot be cancelled. Release a stream even if permission is
    // granted after the timeout or after this component has been unmounted.
    const microphone = await this.waitFor(microphoneRequest.then((stream) => {
      if (this.ended) stopTracks(stream);
      return stream;
    }), MICROPHONE_TIMEOUT_MS, 'Microphone access took too long. Check its permissions and try again.');
    if (this.ended) return;
    this.microphone = microphone;
    for (const track of microphone.getAudioTracks()) {
      track.enabled = !this.state.muted;
      track.onended = () => this.fail('Your microphone disconnected. Reconnect it and try Voice Mode again.');
    }
    this.options.onMicrophoneStream?.(microphone);
    if (this.ended) return;

    const peer = new RTCPeerConnection();
    this.peer = peer;
    const audio = new Audio();
    audio.autoplay = true;
    this.audio = audio;
    peer.ontrack = (event) => {
      if (this.ended) { event.track.stop(); return; }
      this.remoteTracks.add(event.track);
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void this.enableAudio();
    };
    peer.onconnectionstatechange = () => this.checkConnection();
    peer.oniceconnectionstatechange = () => this.checkConnection();
    for (const track of microphone.getAudioTracks()) peer.addTrack(track, microphone);

    const channel = peer.createDataChannel('oai-events');
    this.channel = channel;
    const channelReady = new Promise<void>((resolve, reject) => {
      channel.onopen = () => {
        if (!this.ended) { this.connected = true; this.refreshPhase(); }
        resolve();
      };
      channel.onerror = () => {
        reject(new Error('Voice Mode lost its connection. Please try again.'));
        this.fail('Voice Mode lost its connection. Please try again.');
      };
      channel.onclose = () => {
        reject(new Error('Voice Mode disconnected. Please try again.'));
        this.fail('Voice Mode disconnected. Please try again.');
      };
      channel.onmessage = (event) => {
        if (this.ended || typeof event.data !== 'string') return;
        try { this.handleEvent(JSON.parse(event.data) as ServerEvent); } catch { /* Ignore malformed provider events. */ }
      };
    });
    // Attach the rejection handler before signaling, which may take seconds.
    const ready = this.waitFor(channelReady, CONNECTION_TIMEOUT_MS, 'Voice Mode could not connect. Please try again.');
    void ready.catch(() => undefined);

    let offer: RTCSessionDescriptionInit;
    try {
      offer = await peer.createOffer();
      if (this.ended) return;
      await peer.setLocalDescription(offer);
    } catch {
      throw new Error('Could not create a Voice Mode connection. Please try again.');
    }
    if (this.ended) return;
    const offerSdp = peer.localDescription?.sdp ?? offer.sdp;
    if (!offerSdp) throw new Error('Could not create a Voice Mode connection. Please try again.');
    const answer = await this.options.bridge.connectRealtime(offerSdp);
    if (this.ended) {
      this.disconnectCall(answer.callId);
      return;
    }
    this.callId = answer.callId;
    try {
      await peer.setRemoteDescription({ type: 'answer', sdp: answer.answerSdp });
    } catch {
      throw new Error('Could not finish connecting Voice Mode. Please try again.');
    }
    if (this.ended) return;
    await ready;
  }

  private waitFor<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const signal = this.lifetime.signal;
      const finish = (callback: () => void) => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        callback();
      };
      const abort = () => finish(() => reject(new Error('Voice Mode was stopped.')));
      const timeout = setTimeout(() => finish(() => reject(new Error(message))), timeoutMs);
      signal.addEventListener('abort', abort, { once: true });
      promise.then((value) => finish(() => resolve(value)), (error: unknown) => finish(() => reject(error)));
      if (signal.aborted) abort();
    });
  }

  private checkConnection(): void {
    if (this.ended || !this.peer) return;
    const { connectionState, iceConnectionState } = this.peer;
    if (connectionState === 'failed' || connectionState === 'closed' || iceConnectionState === 'failed') {
      this.fail('Voice Mode lost its connection. Check your network and try again.');
    } else if (connectionState === 'disconnected' || iceConnectionState === 'disconnected') {
      this.disconnected = true;
      this.refreshPhase();
      this.disconnectTimer ??= setTimeout(() => {
        this.fail('Voice Mode disconnected. Check your network and try again.');
      }, DISCONNECT_GRACE_MS);
    } else if (connectionState === 'connected' || iceConnectionState === 'connected' || iceConnectionState === 'completed') {
      if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
      this.disconnectTimer = undefined;
      this.disconnected = false;
      this.refreshPhase();
    }
  }

  private handleEvent(event: ServerEvent): void {
    switch (event.type) {
      case 'input_audio_buffer.speech_started':
        this.userSpeaking = true;
        break;
      case 'input_audio_buffer.speech_stopped':
        this.userSpeaking = false;
        this.flushFollowup();
        break;
      case 'output_audio_buffer.started':
        this.audioPlaying = true;
        break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        this.audioPlaying = false;
        break;
      case 'response.created': {
        const response = event.response as { id?: string } | undefined;
        if (response?.id) this.activeResponses.add(response.id);
        this.responseRequested = false;
        break;
      }
      case 'response.done': {
        const response = event.response as { id?: string; status?: string } | undefined;
        if (response?.id) this.activeResponses.delete(response.id);
        this.responseRequested = false;
        if (response?.status === 'failed' || response?.status === 'incomplete') {
          this.fail('Voice Mode could not finish its reply. Please try again.');
          break;
        }
        this.flushFollowup();
        break;
      }
      case 'conversation.item.input_audio_transcription.delta':
      case 'conversation.item.input_audio_transcription.completed':
        this.transcribe(event, 'user', event.type.endsWith('.completed'));
        break;
      case 'response.output_audio_transcript.delta':
      case 'response.output_audio_transcript.done':
        this.transcribe(event, 'assistant', event.type.endsWith('.done'));
        break;
      case 'conversation.item.input_audio_transcription.failed':
        // A failed utterance does not end the call. The next turn can succeed.
        break;
      case 'response.function_call_arguments.done':
        this.runTool(event);
        break;
      case 'error': {
        const error = event.error as { code?: string } | undefined;
        if (error?.code === 'conversation_already_has_active_response') {
          this.responseRequested = false;
          this.followupPending = true;
          // Retry on response.done, not immediately against the same response.
        } else if (error?.code !== 'response_cancel_not_active') {
          this.fail('Voice Mode encountered an error. Please try again.');
        }
        break;
      }
    }
    this.refreshPhase();
  }

  private transcribe(event: ServerEvent, role: VoiceTranscript['role'], final: boolean): void {
    if (typeof event.item_id !== 'string') return;
    const id = `${role}:${event.item_id}:${Number(event.content_index) || 0}`;
    const previous = this.transcripts.get(id);
    if (previous?.final) return;
    const value = final ? event.transcript : event.delta;
    if (typeof value !== 'string') return;
    const text = (final ? value : (previous?.text ?? '') + value).slice(0, MAX_TRANSCRIPT_LENGTH);
    const entry = { id, role, text, final };
    this.transcripts.set(id, entry);
    if (this.transcripts.size > MAX_TRANSCRIPTS) {
      const first = this.transcripts.keys().next().value;
      if (first !== undefined) this.transcripts.delete(first);
    }
    this.options.onTranscript(entry);
  }

  private runTool(event: ServerEvent): void {
    const callId = event.call_id;
    if (typeof callId !== 'string' || !callId || callId.length > 200 || this.seenTasks.has(callId)) return;
    if (this.seenTasks.size >= MAX_TASKS) {
      this.fail('This Voice Mode session has reached its task limit. Start a new session to continue.');
      return;
    }
    this.seenTasks.add(callId);
    let argumentsObject: Record<string, unknown> | undefined;
    try {
      const parsed: unknown = JSON.parse(String(event.arguments));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        argumentsObject = parsed as Record<string, unknown>;
      }
    } catch { /* Report invalid arguments below. */ }
    if (event.name === 'cancel_browser_task' && argumentsObject && Object.keys(argumentsObject).length === 0) {
      const hadTask = this.tasks.size > 0;
      for (const controller of this.tasks.values()) controller.abort();
      this.completeTool(callId, hadTask
        ? { status: 'cancelled', text: 'Cancelled the voice-started browser task.' }
        : { status: 'completed', text: 'No voice-started browser task is running.' });
      return;
    }
    const prompt = argumentsObject?.prompt;
    if (event.name !== 'perform_browser_task' || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 20_000) {
      this.completeTool(callId, { status: 'failed', text: 'The browser task was invalid. Ask the user to restate it.' });
      return;
    }
    const controller = new AbortController();
    this.tasks.set(callId, controller);
    let finished = false;
    const finish = (result: VoiceTaskResult) => {
      if (finished) return;
      finished = true;
      controller.signal.removeEventListener('abort', cancel);
      this.tasks.delete(callId);
      if (!this.ended) this.completeTool(callId, result);
    };
    const cancel = () => finish({ status: 'cancelled', text: 'The browser task was cancelled.' });
    controller.signal.addEventListener('abort', cancel, { once: true });
    void Promise.resolve().then(() => {
      if (controller.signal.aborted || this.ended) return { status: 'cancelled', text: 'The browser task was cancelled.' } as VoiceTaskResult;
      return this.options.onBrowserTask(prompt as string, controller.signal);
    }).then(finish, () => finish({ status: 'failed', text: 'The browser task failed. Please try again.' }));
    this.refreshPhase();
  }

  private completeTool(callId: string, result: VoiceTaskResult): void {
    if (this.send({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(result) },
    })) {
      this.followupPending = true;
      this.flushFollowup();
    }
    this.refreshPhase();
  }

  private flushFollowup(): void {
    if (!this.followupPending || this.activeResponses.size || this.tasks.size || this.userSpeaking || this.responseRequested || this.ended) return;
    this.followupPending = false;
    this.responseRequested = this.send({ type: 'response.create' });
  }

  private send(event: Record<string, unknown>): boolean {
    if (this.ended || this.channel?.readyState !== 'open') return false;
    try {
      this.channel.send(JSON.stringify(event));
      return true;
    } catch {
      this.fail('Voice Mode lost its connection. Please try again.');
      return false;
    }
  }

  private refreshPhase(): void {
    if (this.ended) return;
    const phase: VoicePhase = !this.connected || this.disconnected ? 'connecting'
      : this.userSpeaking ? 'listening'
        : this.audioPlaying ? 'speaking'
          : this.tasks.size ? 'working'
            : this.activeResponses.size || this.responseRequested ? 'thinking' : 'listening';
    this.updateState({ phase });
  }

  private updateState(patch: Partial<VoiceState>): void {
    const next = { ...this.state, ...patch };
    if (next.phase === this.state.phase && next.muted === this.state.muted
      && next.playbackBlocked === this.state.playbackBlocked && next.error === this.state.error) return;
    this.state = next;
    this.options.onState({ ...next });
  }

  private fail(message: string): void {
    if (this.ended) return;
    this.cleanup();
    this.updateState({ phase: 'error', error: message, playbackBlocked: false });
  }

  private disconnectCall(callId: string): void {
    void this.options.bridge.disconnectRealtime(callId).catch(() => undefined);
  }

  private cleanup(): void {
    if (this.ended) return;
    this.ended = true;
    this.lifetime.abort();
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    for (const controller of this.tasks.values()) controller.abort();
    this.tasks.clear();
    for (const track of this.microphone?.getTracks() ?? []) { track.onended = null; track.stop(); }
    for (const track of this.remoteTracks) track.stop();
    if (this.channel) {
      this.channel.onopen = this.channel.onclose = this.channel.onerror = this.channel.onmessage = null;
      this.channel.close();
    }
    if (this.peer) {
      this.peer.ontrack = this.peer.onconnectionstatechange = this.peer.oniceconnectionstatechange = null;
      this.peer.close();
    }
    if (this.audio) { this.audio.pause(); this.audio.srcObject = null; }
    if (this.callId) this.disconnectCall(this.callId);
    this.transcripts.clear();
    this.activeResponses.clear();
    this.seenTasks.clear();
  }
}
