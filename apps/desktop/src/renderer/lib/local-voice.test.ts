import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalVoiceSession } from './local-voice.js';

let stopped: ReturnType<typeof vi.fn>;
let track: { enabled: boolean; stop: ReturnType<typeof vi.fn>; onended: (() => void) | null };
let stream: MediaStream;
let recorders: Recorder[];
let audioLevel: number;
let nextFrame: FrameRequestCallback;
let inputSamples: Float32Array;
let playbackSources: PlaybackSource[];
let autoEndAudio: boolean;
let playbackCapture: boolean[];
class PlaybackSource {
  buffer: unknown;
  onended: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  stop = vi.fn();
  start = vi.fn(() => {
    playbackCapture.push(track.enabled);
    if (autoEndAudio) queueMicrotask(() => this.onended?.());
  });
  constructor() { playbackSources.push(this); }
  finish() { this.onended?.(); }
}
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
  flush(size = 2000) {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(size)]) });
    this.stop();
  }
}
const options = () => ({
  bridge: { transcribe: vi.fn().mockResolvedValue({ text: 'Read this page' }) },
  onState: vi.fn(), onTranscript: vi.fn(), onMicrophoneStream: vi.fn(),
  onBrowserTask: vi.fn().mockResolvedValue({ status: 'completed', text: 'Verified answer' }),
});
const neuralOptions = () => {
  const opts = options();
  return {
    ...opts,
    bridge: {
      ...opts.bridge,
      prepareSpeech: vi.fn().mockResolvedValue(undefined),
      synthesize: vi.fn().mockResolvedValue({ audio: new Float32Array(2400).fill(0.1), sampleRate: 24000 }),
    },
  };
};
const nextTurn = () => { nextFrame(0); recorders.at(-1)!.flush(); };
const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  recorders = [];
  playbackSources = [];
  playbackCapture = [];
  autoEndAudio = true;
  inputSamples = new Float32Array(16000).fill(0.1);
  audioLevel = 0.1;
  stopped = vi.fn();
  track = { enabled: true, stop: stopped, onended: null };
  stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) } });
  vi.stubGlobal('MediaRecorder', Recorder);
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { nextFrame = callback; return 1; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('AudioContext', class {
    destination = {};
    resume = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);
    createAnalyser() { return { fftSize: 256, getFloatTimeDomainData: (data: Float32Array) => data.fill(audioLevel) }; }
    createMediaStreamSource() { return { connect: vi.fn() }; }
    decodeAudioData = vi.fn().mockImplementation(async () => ({ duration: inputSamples.length / 16000 }));
    createBuffer(_channels: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
    createBufferSource() { return new PlaybackSource(); }
  });
  vi.stubGlobal('OfflineAudioContext', class {
    destination = {};
    createBufferSource() { return { connect: vi.fn(), start: vi.fn() }; }
    startRendering = vi.fn().mockImplementation(async () => ({ getChannelData: () => inputSamples }));
  });
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  vi.stubGlobal('speechSynthesis', { getVoices: vi.fn(() => []), cancel: vi.fn(), speak: vi.fn((utterance) => queueMicrotask(() => utterance.onend?.())) });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('keyless Voice Mode', () => {
  it('records, transcribes locally, runs through the assistant and speaks its real result', async () => {
    const opts = options();
    const session = new LocalVoiceSession(opts as never);
    await session.start();
    nextTurn();
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
    nextTurn();
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

  it('uses keyless neural PCM for every sentence, including the end of a long reply', async () => {
    const opts = neuralOptions();
    const reply = `${'The browser has verified the requested details and kept the result in this conversation. '.repeat(65)}Final sentence after the long response.`;
    opts.onBrowserTask.mockResolvedValue({ status: 'completed', text: reply });
    const session = new LocalVoiceSession(opts as never);
    await session.start();
    expect(opts.bridge.prepareSpeech).toHaveBeenCalledOnce();
    nextTurn();
    await vi.waitFor(() => expect(opts.bridge.synthesize.mock.calls.map(([text]) => text).join(' ')).toContain('Final sentence after the long response.'));
    await vi.waitFor(() => expect(track.enabled).toBe(true));
    expect(opts.onState).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'listening' }));
    expect(opts.bridge.synthesize.mock.calls.map(([text]) => text).join(' ').length).toBeGreaterThan(4000);
    expect(opts.bridge.synthesize.mock.calls.every(([text]) => text.length <= 300)).toBe(true);
    expect(opts.bridge.synthesize.mock.calls[0]![0].length).toBeLessThanOrEqual(160);
    expect(playbackSources).toHaveLength(opts.bridge.synthesize.mock.calls.length);
    expect(playbackCapture.every((enabled) => !enabled)).toBe(true);
    expect(speechSynthesis.speak).not.toHaveBeenCalled();
    expect(opts.onTranscript).toHaveBeenCalledWith(expect.objectContaining({ role: 'assistant', text: reply }));
    session.stop();
  });

  it('trims padded silence and accepts a short encoded command by its decoded speech', async () => {
    inputSamples = new Float32Array(16000 * 12);
    inputSamples.fill(0.1, 48000, 52800);
    const opts = options();
    const session = new LocalVoiceSession(opts as never);
    await session.start();
    recorders[0]!.flush(24);
    await vi.waitFor(() => expect(opts.bridge.transcribe).toHaveBeenCalledOnce());
    const pcm = opts.bridge.transcribe.mock.calls[0]![0] as Float32Array;
    expect(pcm).toHaveLength(11200);
    expect(pcm.slice(0, 2560).every((sample) => sample === 0)).toBe(true);
    expect(pcm[2560]).toBeCloseTo(0.1);
    session.stop();
  });

  it('ends a turn after 900ms of silence without waiting the old 1600ms', async () => {
    let now = 100;
    vi.stubGlobal('performance', { now: () => now });
    const session = new LocalVoiceSession(options() as never);
    await session.start();
    const recorder = recorders[0]!;
    audioLevel = 0;
    nextFrame(0);
    now = 999;
    nextFrame(0);
    expect(recorder.state).toBe('recording');
    now = 1000;
    nextFrame(0);
    expect(recorder.state).toBe('inactive');
    session.stop();
  });

  it('cancellation invalidates in-flight and queued audio, then accepts a fresh command', async () => {
    const opts = neuralOptions();
    let completeTranscript!: (value: { text: string }) => void;
    opts.bridge.transcribe.mockResolvedValueOnce({ text: 'Start the browser task' })
      .mockImplementationOnce(() => new Promise((resolve) => { completeTranscript = resolve; }))
      .mockResolvedValue({ text: 'Fresh new command' });
    opts.onBrowserTask.mockImplementationOnce((_prompt, signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve({ status: 'cancelled', text: 'Stopped' }));
    }));
    const session = new LocalVoiceSession(opts as never);
    await session.start();
    nextTurn();
    await vi.waitFor(() => expect(opts.onBrowserTask).toHaveBeenCalledOnce());
    nextTurn();
    await vi.waitFor(() => expect(opts.bridge.transcribe).toHaveBeenCalledTimes(2));
    nextTurn();
    session.cancelTask();
    completeTranscript({ text: 'Stale captured command' });
    await vi.waitFor(() => expect(opts.onState).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'listening' })));
    expect(opts.onBrowserTask).toHaveBeenCalledOnce();
    expect(opts.bridge.transcribe).toHaveBeenCalledTimes(2);
    expect(opts.onTranscript).not.toHaveBeenCalledWith(expect.objectContaining({ text: 'Stale captured command' }));
    nextTurn();
    await vi.waitFor(() => expect(opts.onBrowserTask).toHaveBeenCalledWith('Fresh new command', expect.any(AbortSignal)));
    session.stop();
  });

  it('mute invalidates a pending transcript without dispatching it after unmute', async () => {
    const opts = neuralOptions();
    let completeTranscript!: (value: { text: string }) => void;
    opts.bridge.transcribe.mockImplementationOnce(() => new Promise((resolve) => { completeTranscript = resolve; }));
    const session = new LocalVoiceSession(opts as never);
    await session.start();
    nextTurn();
    await vi.waitFor(() => expect(opts.bridge.transcribe).toHaveBeenCalledOnce());
    session.setMuted(true);
    completeTranscript({ text: 'Do not dispatch this muted turn' });
    session.setMuted(false);
    await flushAsync();
    expect(opts.onBrowserTask).not.toHaveBeenCalled();
    expect(track.enabled).toBe(true);
    session.stop();
  });

  it('interrupts pending neural synthesis and ignores its late audio', async () => {
    const opts = neuralOptions();
    let completeAudio!: (value: { audio: Float32Array; sampleRate: number }) => void;
    opts.bridge.synthesize.mockImplementationOnce(() => new Promise((resolve) => { completeAudio = resolve; }));
    const session = new LocalVoiceSession(opts as never);
    await session.start();
    nextTurn();
    await vi.waitFor(() => expect(opts.bridge.synthesize).toHaveBeenCalledOnce());
    expect(opts.onState).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'thinking' }));
    expect(track.enabled).toBe(false);
    session.interrupt();
    await vi.waitFor(() => expect(track.enabled).toBe(true));
    completeAudio({ audio: new Float32Array(2400).fill(0.1), sampleRate: 24000 });
    await flushAsync();
    expect(playbackSources).toHaveLength(0);
    expect(speechSynthesis.speak).not.toHaveBeenCalled();
    expect(opts.onState).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'listening', playbackBlocked: false }));
    session.stop();
  });

  it('stop releases the microphone immediately and never plays late synthesis', async () => {
    const opts = neuralOptions();
    let completeAudio!: (value: { audio: Float32Array; sampleRate: number }) => void;
    opts.bridge.synthesize.mockImplementationOnce(() => new Promise((resolve) => { completeAudio = resolve; }));
    const session = new LocalVoiceSession(opts as never);
    await session.start();
    nextTurn();
    await vi.waitFor(() => expect(opts.bridge.synthesize).toHaveBeenCalledOnce());
    session.stop();
    expect(stopped).toHaveBeenCalledOnce();
    completeAudio({ audio: new Float32Array(2400).fill(0.1), sampleRate: 24000 });
    await flushAsync();
    expect(playbackSources).toHaveLength(0);
    expect(opts.onState).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'closed' }));
  });

  it('interrupts the sentence queue and ignores a stale completion during a newer reply', async () => {
    autoEndAudio = false;
    const opts = neuralOptions();
    opts.onBrowserTask.mockResolvedValueOnce({ status: 'completed', text: 'The first reply has several details. '.repeat(20) });
    const session = new LocalVoiceSession(opts as never);
    await session.start();
    nextTurn();
    await vi.waitFor(() => expect(playbackSources).toHaveLength(1));
    const first = playbackSources[0]!;
    const staleEnd = first.onended!;
    session.interrupt();
    await vi.waitFor(() => expect(track.enabled).toBe(true));
    expect(first.stop).toHaveBeenCalled();
    // Only the clip being played and the one prepared behind it were requested.
    expect(opts.bridge.synthesize).toHaveBeenCalledTimes(2);
    nextTurn();
    await vi.waitFor(() => expect(playbackSources).toHaveLength(2));
    staleEnd();
    await flushAsync();
    expect(track.enabled).toBe(false);
    expect(opts.onState).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'speaking' }));
    playbackSources[1]!.finish();
    await vi.waitFor(() => expect(track.enabled).toBe(true));
    session.stop();
  });

  it('keeps mute across PCM completion and cooldown until the user unmutes', async () => {
    autoEndAudio = false;
    const opts = neuralOptions();
    const session = new LocalVoiceSession(opts as never);
    await session.start();
    nextTurn();
    await vi.waitFor(() => expect(playbackSources).toHaveLength(1));
    session.setMuted(true);
    playbackSources[0]!.finish();
    await vi.waitFor(() => expect(opts.onState).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'listening', muted: true })));
    expect(track.enabled).toBe(false);
    session.setMuted(false);
    expect(track.enabled).toBe(true);
    session.stop();
  });

  it('serializes replay, discards pre-replay capture and guards against old system callbacks', async () => {
    autoEndAudio = false;
    const opts = neuralOptions();
    let completeReplay!: (value: { audio: Float32Array; sampleRate: number }) => void;
    let staleEnd!: () => void;
    opts.bridge.synthesize.mockRejectedValueOnce(new Error('Neural engine unavailable'))
      .mockImplementationOnce(() => new Promise((resolve) => { completeReplay = resolve; }));
    vi.mocked(speechSynthesis.speak).mockImplementationOnce((utterance) => {
      const onend = utterance.onend;
      staleEnd = () => onend?.call(utterance, new Event('end') as SpeechSynthesisEvent);
      queueMicrotask(() => utterance.onerror?.({ error: 'not-allowed' } as SpeechSynthesisErrorEvent));
    });
    const session = new LocalVoiceSession(opts as never);
    await session.start();
    nextTurn();
    await vi.waitFor(() => expect(opts.onState).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'listening', playbackBlocked: true })));
    nextTurn();
    const replay = session.enableAudio();
    await session.enableAudio();
    await vi.waitFor(() => expect(opts.bridge.synthesize).toHaveBeenCalledTimes(2));
    completeReplay({ audio: new Float32Array(2400).fill(0.1), sampleRate: 24000 });
    await vi.waitFor(() => expect(playbackSources).toHaveLength(1));
    staleEnd();
    await flushAsync();
    expect(track.enabled).toBe(false);
    expect(opts.bridge.transcribe).toHaveBeenCalledOnce();
    expect(opts.onBrowserTask).toHaveBeenCalledOnce();
    playbackSources[0]!.finish();
    await replay;
    expect(track.enabled).toBe(true);
    expect(opts.onState).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'listening', playbackBlocked: false }));
    session.stop();
  });

  it('falls back to an installed US female voice when neural preparation fails', async () => {
    const opts = neuralOptions();
    opts.bridge.prepareSpeech.mockRejectedValue(new Error('First download is offline'));
    vi.mocked(speechSynthesis.getVoices).mockReturnValue([
      { name: 'Alex', lang: 'en-US', localService: true },
      { name: 'Samantha', lang: 'en-US', localService: true },
      { name: 'Remote Aria', lang: 'en-US', localService: false },
    ] as SpeechSynthesisVoice[]);
    const session = new LocalVoiceSession(opts as never);
    await session.start();
    nextTurn();
    await vi.waitFor(() => expect(speechSynthesis.speak).toHaveBeenCalledOnce());
    const utterance = vi.mocked(speechSynthesis.speak).mock.calls[0]![0];
    expect(utterance.voice?.name).toBe('Samantha');
    expect(utterance.lang).toBe('en-US');
    expect(opts.bridge.synthesize).not.toHaveBeenCalled();
    session.stop();
  });

  it('bounds first-download waiting and uses neural audio once late preparation is ready', async () => {
    vi.useFakeTimers();
    const opts = neuralOptions();
    let prepared!: () => void;
    opts.bridge.prepareSpeech.mockImplementationOnce(() => new Promise<void>((resolve) => { prepared = resolve; }));
    const session = new LocalVoiceSession(opts as never);
    await session.start();
    nextTurn();
    await vi.waitFor(() => expect(opts.onTranscript).toHaveBeenCalledWith(expect.objectContaining({ role: 'assistant' })));
    expect(track.enabled).toBe(false);
    await vi.advanceTimersByTimeAsync(8200);
    expect(speechSynthesis.speak).toHaveBeenCalledOnce();
    expect(opts.bridge.synthesize).not.toHaveBeenCalled();
    expect(opts.onState).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'listening' }));
    prepared();
    await vi.advanceTimersByTimeAsync(0);
    nextTurn();
    await vi.waitFor(() => expect(opts.bridge.synthesize).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(200);
    expect(playbackSources).toHaveLength(1);
    expect(speechSynthesis.speak).toHaveBeenCalledOnce();
    session.stop();
  });

  it('stops a stalled installed utterance before restoring capture and offering replay', async () => {
    vi.useFakeTimers();
    const opts = options();
    vi.mocked(speechSynthesis.speak).mockImplementation(() => {});
    const session = new LocalVoiceSession(opts as never);
    await session.start();
    nextTurn();
    await vi.waitFor(() => expect(speechSynthesis.speak).toHaveBeenCalledOnce());
    expect(track.enabled).toBe(false);
    await vi.advanceTimersByTimeAsync(45200);
    expect(speechSynthesis.cancel).toHaveBeenCalledOnce();
    expect(track.enabled).toBe(true);
    expect(opts.onState).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'listening', playbackBlocked: true }));
    session.stop();
  });

});
