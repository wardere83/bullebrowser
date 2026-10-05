import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalVoiceSession } from './local-voice.js';

let stopped: ReturnType<typeof vi.fn>;
let track: { enabled: boolean; stop: ReturnType<typeof vi.fn>; onended: (() => void) | null };
let stream: MediaStream;
let recorders: Recorder[];
let audioLevel: number;
let nextFrame: FrameRequestCallback;
class Recorder {
  static isTypeSupported() { return true; }
  state = 'inactive';
  mimeType = 'audio/webm';
  onstop?: () => void;
  ondataavailable?: (event: { data: Blob }) => void;
  onerror?: () => void;
  constructor() { recorders.push(this); }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.onstop?.(); }
  flush() {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(2000)]) });
    this.stop();
  }
}
const options = () => ({
  bridge: { transcribe: vi.fn().mockResolvedValue({ text: 'Read this page' }) },
  onState: vi.fn(), onTranscript: vi.fn(), onMicrophoneStream: vi.fn(),
  onBrowserTask: vi.fn().mockResolvedValue({ status: 'completed', text: 'Verified answer' }),
});

beforeEach(() => {
  recorders = [];
  audioLevel = 0.1;
  stopped = vi.fn();
  track = { enabled: true, stop: stopped, onended: null };
  stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) } });
  vi.stubGlobal('MediaRecorder', Recorder);
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { nextFrame = callback; return 1; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('AudioContext', class {
    resume = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);
    createAnalyser() { return { fftSize: 256, getFloatTimeDomainData: (data: Float32Array) => data.fill(audioLevel) }; }
    createMediaStreamSource() { return { connect: vi.fn() }; }
    decodeAudioData = vi.fn().mockResolvedValue({ duration: 1 });
  });
  vi.stubGlobal('OfflineAudioContext', class {
    destination = {};
    createBufferSource() { return { connect: vi.fn(), start: vi.fn() }; }
    startRendering = vi.fn().mockResolvedValue({ getChannelData: () => new Float32Array(16000).fill(0.1) });
  });
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  vi.stubGlobal('speechSynthesis', { getVoices: () => [], cancel: vi.fn(), speak: vi.fn((utterance) => queueMicrotask(() => utterance.onend?.())) });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('keyless Voice Mode', () => {
  it('records, transcribes locally, runs through the assistant and speaks its real result', async () => {
    const opts = options();
    const session = new LocalVoiceSession(opts as never);
    await session.start();
    recorders[0]!.flush();
    await vi.waitFor(() => expect(opts.onBrowserTask).toHaveBeenCalledWith('Read this page', expect.any(AbortSignal)));
    await vi.waitFor(() => expect(speechSynthesis.speak).toHaveBeenCalled());
    expect(opts.bridge.transcribe).toHaveBeenCalledWith(expect.any(Float32Array));
    expect(opts.onTranscript.mock.calls.map(([entry]) => entry.text)).toEqual(['Read this page', 'Verified answer']);
    session.stop();
    expect(stopped).toHaveBeenCalled();
  });

  it('mute disables capture and stop cancels only its own browser task', async () => {
    const opts = options();
    let signal: AbortSignal | undefined;
    opts.onBrowserTask.mockImplementation((_prompt, input) => {
      signal = input;
      return new Promise((resolve) => input.addEventListener('abort', () => resolve({ status: 'cancelled', text: 'Stopped' })));
    });
    const session = new LocalVoiceSession(opts as never);
    await session.start();
    session.setMuted(true);
    expect(track.enabled).toBe(false);
    session.setMuted(false);
    expect(track.enabled).toBe(true);
    recorders[0]!.flush();
    await vi.waitFor(() => expect(signal).toBeDefined());
    session.stop();
    expect(signal!.aborted).toBe(true);
    await vi.waitFor(() => expect(stopped).toHaveBeenCalled());
    expect(speechSynthesis.speak).not.toHaveBeenCalled();
  });

  it('releases microphone permission granted after cancellation', async () => {
    let grant!: (stream: MediaStream) => void;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(new Promise((resolve) => { grant = resolve; }));
    const session = new LocalVoiceSession(options() as never);
    const starting = session.start();
    session.stop();
    grant(stream);
    await starting;
    expect(stopped).toHaveBeenCalled();
    expect(recorders).toHaveLength(0);
  });

  it('shows a microphone error without starting a model or assistant task', async () => {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(new Error('Microphone permission denied'));
    const opts = options();
    const session = new LocalVoiceSession(opts as never);
    await session.start();
    expect(opts.onState).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'error', error: 'Microphone permission denied' }));
    expect(opts.bridge.transcribe).not.toHaveBeenCalled();
    expect(opts.onBrowserTask).not.toHaveBeenCalled();
  });

  it('never sends silent recorder segments to the model or cancels a long task', async () => {
    const opts = options();
    let signal: AbortSignal | undefined;
    opts.onBrowserTask.mockImplementation((_prompt, input) => {
      signal = input;
      return new Promise((resolve) => input.addEventListener('abort', () => resolve({ status: 'cancelled', text: 'Stopped' })));
    });
    const session = new LocalVoiceSession(opts as never);
    await session.start();
    recorders[0]!.flush();
    await vi.waitFor(() => expect(signal).toBeDefined());
    audioLevel = 0;
    for (let i = 0; i < 8; i++) {
      nextFrame(0);
      recorders.at(-1)!.flush();
    }
    expect(opts.bridge.transcribe).toHaveBeenCalledTimes(1);
    expect(signal!.aborted).toBe(false);
    expect(opts.onState).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'working' }));
    session.stop();
  });

  it('a spoken cancellation reaches the owned task while it is still running', async () => {
    const opts = options();
    opts.bridge.transcribe.mockResolvedValueOnce({ text: 'Read this page' }).mockResolvedValueOnce({ text: 'Cancel this browser task.' });
    let signal: AbortSignal | undefined;
    opts.onBrowserTask.mockImplementation((_prompt, input) => {
      signal = input;
      return new Promise((resolve) => input.addEventListener('abort', () => resolve({ status: 'cancelled', text: 'Stopped' })));
    });
    const session = new LocalVoiceSession(opts as never);
    await session.start();
    recorders[0]!.flush();
    await vi.waitFor(() => expect(signal).toBeDefined());
    nextFrame(0);
    recorders.at(-1)!.flush();
    await vi.waitFor(() => expect(signal!.aborted).toBe(true));
    expect(opts.onBrowserTask).toHaveBeenCalledTimes(1);
    session.stop();
  });

  it('speech playback failure restores the microphone and offers a working retry', async () => {
    const opts = options();
    vi.mocked(speechSynthesis.speak).mockImplementationOnce((utterance) => queueMicrotask(() => utterance.onerror?.({ error: 'not-allowed' } as SpeechSynthesisErrorEvent)));
    const session = new LocalVoiceSession(opts as never);
    await session.start();
    recorders[0]!.flush();
    await vi.waitFor(() => expect(opts.onState).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'listening', playbackBlocked: true })));
    expect(track.enabled).toBe(true);
    await session.enableAudio();
    expect(speechSynthesis.speak).toHaveBeenCalledTimes(2);
    expect(opts.onState).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'listening', playbackBlocked: false }));
    session.stop();
  });

  it('failed assistant requests report failure and keep the microphone available', async () => {
    const opts = options();
    opts.onBrowserTask.mockRejectedValue(new Error('provider failed'));
    const session = new LocalVoiceSession(opts as never);
    await session.start();
    recorders[0]!.flush();
    await vi.waitFor(() => expect(opts.onTranscript).toHaveBeenCalledWith(expect.objectContaining({ role: 'assistant', text: 'The assistant could not complete that request. Please try again.' })));
    await vi.waitFor(() => expect(opts.onState).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'listening' })));
    expect(stopped).not.toHaveBeenCalled();
    session.stop();
  });

});
