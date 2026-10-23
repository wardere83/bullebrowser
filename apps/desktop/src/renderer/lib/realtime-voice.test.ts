import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserBridge } from '../../shared/ipc.js';
import { RealtimeVoiceSession, type VoiceState, type VoiceTaskResult, type VoiceTranscript } from './realtime-voice.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class MockTrack {
  enabled = true;
  onended: (() => void) | null = null;
  stop = vi.fn();
}

class MockStream {
  constructor(readonly tracks = [new MockTrack()]) {}
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks; }
}

class MockChannel {
  readyState = 'connecting';
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send = vi.fn<(message: string) => void>();
  close = vi.fn(() => { this.readyState = 'closed'; this.onclose?.(); });
  open() { this.readyState = 'open'; this.onopen?.(); }
  receive(event: Record<string, unknown>) { this.onmessage?.({ data: JSON.stringify(event) }); }
  messages() { return this.send.mock.calls.map(([message]) => JSON.parse(message) as Record<string, unknown>); }
}

class MockPeer {
  static instances: MockPeer[] = [];
  channel = new MockChannel();
  connectionState = 'new';
  iceConnectionState = 'new';
  localDescription: { type: string; sdp: string } | null = null;
  ontrack: ((event: { track: MockTrack; streams: MockStream[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  addTrack = vi.fn();
  createDataChannel = vi.fn(() => this.channel);
  createOffer = vi.fn(async () => ({ type: 'offer', sdp: 'offer-sdp' }));
  setLocalDescription = vi.fn(async (offer: { type: string; sdp: string }) => { this.localDescription = offer; });
  setRemoteDescription = vi.fn(async () => { this.channel.open(); });
  close = vi.fn(() => { this.connectionState = 'closed'; this.onconnectionstatechange?.(); });
  constructor() { MockPeer.instances.push(this); }
  state(value: string) { this.connectionState = value; this.onconnectionstatechange?.(); }
}

class MockAudio {
  static instances: MockAudio[] = [];
  autoplay = false;
  srcObject: MockStream | null = null;
  play = vi.fn(async () => undefined);
  pause = vi.fn();
  constructor() { MockAudio.instances.push(this); }
}

async function settle() {
  for (let step = 0; step < 12; step++) await Promise.resolve();
}

describe('RealtimeVoiceSession', () => {
  let stream: MockStream;
  let getUserMedia: ReturnType<typeof vi.fn>;
  let bridge: BrowserBridge['voice'];
  let states: VoiceState[];
  let transcripts: VoiceTranscript[];
  let browserTask: ReturnType<typeof vi.fn<(prompt: string, signal: AbortSignal) => Promise<VoiceTaskResult>>>;
  const sessions: RealtimeVoiceSession[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    MockPeer.instances = [];
    MockAudio.instances = [];
    stream = new MockStream();
    getUserMedia = vi.fn(async () => stream);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.stubGlobal('RTCPeerConnection', MockPeer);
    vi.stubGlobal('MediaStream', MockStream);
    vi.stubGlobal('Audio', MockAudio);
    bridge = {
      transcribe: vi.fn(),
      prepareSpeech: vi.fn(),
      synthesize: vi.fn(),
      connectRealtime: vi.fn(async () => ({ answerSdp: 'answer-sdp', callId: 'rtc_test' })),
      disconnectRealtime: vi.fn(async () => undefined),
    };
    states = [];
    transcripts = [];
    browserTask = vi.fn(async () => ({ status: 'completed', text: 'Opened the requested page.' }));
  });

  afterEach(() => {
    for (const session of sessions.splice(0)) session.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function create() {
    const session = new RealtimeVoiceSession({
      bridge,
      onState: (state) => states.push(state),
      onTranscript: (entry) => transcripts.push(entry),
      onBrowserTask: browserTask,
    });
    sessions.push(session);
    return session;
  }

  function peer() { return MockPeer.instances.at(-1)!; }
  function channel() { return peer().channel; }
  function phase() { return states.at(-1)?.phase; }
  function task(callId = 'call_1', argumentsText = '{"prompt":"Open the weather page"}') {
    channel().receive({ type: 'response.function_call_arguments.done', call_id: callId, name: 'perform_browser_task', arguments: argumentsText });
  }

  it('connects with microphone processing, renderer-only SDP, and remote audio', async () => {
    const session = create();
    await session.start();
    expect(phase()).toBe('listening');
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false,
    });
    expect(bridge.connectRealtime).toHaveBeenCalledWith('offer-sdp');
    expect(peer().createDataChannel).toHaveBeenCalledWith('oai-events');
    expect(peer().setRemoteDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'answer-sdp' });
    const remote = new MockStream();
    peer().ontrack?.({ track: remote.tracks[0]!, streams: [remote] });
    await settle();
    expect(MockAudio.instances[0]?.srcObject).toBe(remote);
    expect(MockAudio.instances[0]?.play).toHaveBeenCalled();
    session.setMuted(true);
    expect(stream.tracks[0]?.enabled).toBe(false);
    session.setMuted(false);
    expect(stream.tracks[0]?.enabled).toBe(true);
    session.stop();
    expect(stream.tracks[0]?.stop).toHaveBeenCalledOnce();
    expect(remote.tracks[0]?.stop).toHaveBeenCalledOnce();
    expect(bridge.disconnectRealtime).toHaveBeenCalledWith('rtc_test');
    expect(MockAudio.instances[0]?.srcObject).toBeNull();
    expect(phase()).toBe('closed');
  });

  it('uses playback buffer events instead of response.done for the speaking phase', async () => {
    await create().start();
    channel().receive({ type: 'response.created', response: { id: 'r1' } });
    expect(phase()).toBe('thinking');
    channel().receive({ type: 'output_audio_buffer.started' });
    expect(phase()).toBe('speaking');
    channel().receive({ type: 'response.done', response: { id: 'r1' } });
    expect(phase()).toBe('speaking');
    channel().receive({ type: 'output_audio_buffer.stopped' });
    expect(phase()).toBe('listening');
  });

  it('assembles GA input and output transcripts and never submits transcripts as chat text', async () => {
    await create().start();
    channel().receive({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'u1', delta: 'Open ' });
    channel().receive({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'u1', delta: 'weather' });
    channel().receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', transcript: 'Open the weather.' });
    channel().receive({ type: 'response.output_audio_transcript.delta', item_id: 'a1', content_index: 0, delta: 'Certainly.' });
    channel().receive({ type: 'response.output_audio_transcript.done', item_id: 'a1', content_index: 0, transcript: 'Certainly.' });
    expect(transcripts.map((entry) => [entry.role, entry.text, entry.final])).toEqual([
      ['user', 'Open ', false], ['user', 'Open weather', false], ['user', 'Open the weather.', true],
      ['assistant', 'Certainly.', false], ['assistant', 'Certainly.', true],
    ]);
    expect(channel().messages()).toEqual([]);
    expect(browserTask).not.toHaveBeenCalled();
  });

  it('caps transcript length and retained history', async () => {
    await create().start();
    channel().receive({ type: 'response.output_audio_transcript.delta', item_id: 'long', delta: 'x'.repeat(30_000) });
    expect(transcripts.at(-1)?.text).toHaveLength(12_000);
    for (let id = 0; id < 101; id++) {
      channel().receive({ type: 'response.output_audio_transcript.delta', item_id: `a${id}`, delta: 'a' });
    }
    channel().receive({ type: 'response.output_audio_transcript.delta', item_id: 'a0', delta: 'b' });
    expect(transcripts.at(-1)?.text).toBe('b');
  });

  it('deduplicates browser calls and waits for the parent response.done before requesting speech', async () => {
    await create().start();
    channel().receive({ type: 'response.created', response: { id: 'parent' } });
    task();
    task();
    expect(phase()).toBe('working');
    await settle();
    expect(browserTask).toHaveBeenCalledOnce();
    expect(browserTask.mock.calls[0]?.[0]).toBe('Open the weather page');
    expect(channel().messages()).toEqual([{
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: 'call_1', output: JSON.stringify({ status: 'completed', text: 'Opened the requested page.' }) },
    }]);
    channel().receive({ type: 'response.done', response: { id: 'parent' } });
    expect(channel().messages().at(-1)).toEqual({ type: 'response.create' });
    task();
    await settle();
    expect(browserTask).toHaveBeenCalledOnce();
    expect(channel().messages()).toHaveLength(2);
  });

  it('waits for all active responses, pending tasks, and current user speech before a follow-up', async () => {
    const first = deferred<VoiceTaskResult>();
    const second = deferred<VoiceTaskResult>();
    browserTask.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await create().start();
    channel().receive({ type: 'response.created', response: { id: 'r1' } });
    channel().receive({ type: 'response.created', response: { id: 'r2' } });
    task('call_1');
    task('call_2');
    first.resolve({ status: 'completed', text: 'First result' });
    await settle();
    channel().receive({ type: 'response.done', response: { id: 'r1' } });
    channel().receive({ type: 'input_audio_buffer.speech_started' });
    channel().receive({ type: 'response.done', response: { id: 'r2' } });
    expect(channel().messages().filter((message) => message.type === 'response.create')).toHaveLength(0);
    second.resolve({ status: 'completed', text: 'Second result' });
    await settle();
    expect(channel().messages().filter((message) => message.type === 'response.create')).toHaveLength(0);
    channel().receive({ type: 'input_audio_buffer.speech_stopped' });
    expect(channel().messages().filter((message) => message.type === 'response.create')).toHaveLength(1);
  });

  it('retries the active-response race only when the current response finishes', async () => {
    await create().start();
    task();
    await settle();
    expect(channel().messages().at(-1)?.type).toBe('response.create');
    channel().receive({ type: 'error', error: { code: 'conversation_already_has_active_response' } });
    expect(channel().messages()).toHaveLength(2);
    expect(phase()).not.toBe('error');
    channel().receive({ type: 'response.done', response: { id: 'unseen_parent' } });
    expect(channel().messages()).toHaveLength(3);
    expect(channel().messages().at(-1)?.type).toBe('response.create');
  });

  it.each(['{}', '{"prompt":""}', '{"prompt":12}', 'not json'])('rejects invalid tool arguments %s without executing a browser task', async (argumentsText) => {
    await create().start();
    task('bad_call', argumentsText);
    await settle();
    expect(browserTask).not.toHaveBeenCalled();
    const output = channel().messages()[0]?.item as { output: string };
    expect(JSON.parse(output.output).status).toBe('failed');
  });

  it('returns a truthful failure when the browser callback rejects', async () => {
    browserTask.mockRejectedValueOnce(new Error('private browser details'));
    await create().start();
    task();
    await settle();
    const output = channel().messages()[0]?.item as { output: string };
    expect(JSON.parse(output.output)).toEqual({ status: 'failed', text: 'The browser task failed. Please try again.' });
  });

  it('interrupts only an active response and clears audio while browser work continues', async () => {
    const pending = deferred<VoiceTaskResult>();
    browserTask.mockReturnValue(pending.promise);
    const session = create();
    await session.start();
    session.interrupt();
    expect(channel().messages()).toEqual([{ type: 'output_audio_buffer.clear' }]);
    channel().receive({ type: 'response.created', response: { id: 'r1' } });
    task();
    await settle();
    const signal = browserTask.mock.calls[0]![1];
    session.interrupt();
    expect(signal.aborted).toBe(false);
    expect(channel().messages().slice(1, 3)).toEqual([{ type: 'response.cancel' }, { type: 'output_audio_buffer.clear' }]);
    expect(channel().messages()).toHaveLength(3);
    pending.resolve({ status: 'completed', text: 'Task result' });
    await settle();
    const output = channel().messages().at(-1)?.item as { output: string };
    expect(JSON.parse(output.output).status).toBe('completed');
  });

  it('cancels owned browser work through the explicit cancellation tool and ignores its late result', async () => {
    const pending = deferred<VoiceTaskResult>();
    browserTask.mockReturnValue(pending.promise);
    await create().start();
    channel().receive({ type: 'response.created', response: { id: 'task_parent' } });
    task();
    await settle();
    const signal = browserTask.mock.calls[0]![1];
    channel().receive({ type: 'response.function_call_arguments.done', call_id: 'cancel_1', name: 'cancel_browser_task', arguments: '{}' });
    expect(signal.aborted).toBe(true);
    const outputs = channel().messages().map((message) => {
      const item = message.item as { call_id: string; output: string };
      return [item.call_id, JSON.parse(item.output).status];
    });
    expect(outputs).toEqual([['call_1', 'cancelled'], ['cancel_1', 'cancelled']]);
    pending.resolve({ status: 'completed', text: 'Late result' });
    await settle();
    expect(channel().messages()).toHaveLength(2);
    channel().receive({ type: 'response.done', response: { id: 'task_parent' } });
    expect(channel().messages().at(-1)).toEqual({ type: 'response.create' });
  });

  it('truthfully reports no owned task running and deduplicates cancellation calls', async () => {
    await create().start();
    const cancel = { type: 'response.function_call_arguments.done', call_id: 'cancel_1', name: 'cancel_browser_task', arguments: '{}' };
    channel().receive(cancel);
    channel().receive(cancel);
    const output = channel().messages()[0]?.item as { output: string };
    expect(JSON.parse(output.output)).toEqual({ status: 'completed', text: 'No voice-started browser task is running.' });
    expect(channel().messages()).toHaveLength(2);
    expect(browserTask).not.toHaveBeenCalled();
  });

  it('ends capture and aborts browser work on stop, even while muted', async () => {
    const pending = deferred<VoiceTaskResult>();
    browserTask.mockReturnValue(pending.promise);
    const session = create();
    await session.start();
    task();
    await settle();
    const events = channel();
    session.setMuted(true);
    session.stop();
    expect(browserTask.mock.calls[0]?.[1].aborted).toBe(true);
    expect(stream.tracks[0]?.stop).toHaveBeenCalledOnce();
    pending.resolve({ status: 'completed', text: 'Late result' });
    await settle();
    expect(events.messages()).toHaveLength(0);
    expect(phase()).toBe('closed');
  });

  it('offers an explicit audio unlock when browser autoplay is blocked', async () => {
    const session = create();
    await session.start();
    const audio = MockAudio.instances[0]!;
    audio.play.mockRejectedValueOnce(new Error('NotAllowedError'));
    const remote = new MockStream();
    peer().ontrack?.({ track: remote.tracks[0]!, streams: [remote] });
    await settle();
    expect(states.at(-1)?.playbackBlocked).toBe(true);
    await session.enableAudio();
    expect(states.at(-1)?.playbackBlocked).toBe(false);
  });

  it('reports microphone permission errors without an unhandled start rejection', async () => {
    const permissionError = new Error('denied');
    permissionError.name = 'NotAllowedError';
    getUserMedia.mockRejectedValueOnce(permissionError);
    await expect(create().start()).resolves.toBeUndefined();
    expect(phase()).toBe('error');
    expect(states.at(-1)?.error).toContain('Microphone access was denied');
    expect(bridge.connectRealtime).not.toHaveBeenCalled();
  });

  it('times out a permission prompt and stops a microphone granted afterward', async () => {
    const pending = deferred<MockStream>();
    getUserMedia.mockReturnValueOnce(pending.promise);
    const starting = create().start();
    await vi.advanceTimersByTimeAsync(10_000);
    await starting;
    expect(phase()).toBe('error');
    expect(states.at(-1)?.error).toContain('Microphone access took too long');
    pending.resolve(stream);
    await settle();
    expect(stream.tracks[0]?.stop).toHaveBeenCalledOnce();
    expect(MockPeer.instances).toHaveLength(0);
  });

  it('times out signaling and hangs up a late backend answer', async () => {
    const pending = deferred<{ answerSdp: string; callId: string }>();
    vi.mocked(bridge.connectRealtime).mockReturnValueOnce(pending.promise);
    const starting = create().start();
    await settle();
    await vi.advanceTimersByTimeAsync(40_000);
    await starting;
    expect(phase()).toBe('error');
    expect(stream.tracks[0]?.stop).toHaveBeenCalledOnce();
    pending.resolve({ answerSdp: 'answer', callId: 'rtc_late' });
    await settle();
    expect(bridge.disconnectRealtime).toHaveBeenCalledWith('rtc_late');
    expect(peer().setRemoteDescription).not.toHaveBeenCalled();
  });

  it('cancels a connecting instance without allowing late signaling to revive it', async () => {
    const pending = deferred<{ answerSdp: string; callId: string }>();
    vi.mocked(bridge.connectRealtime).mockReturnValueOnce(pending.promise);
    const oldSession = create();
    const starting = oldSession.start();
    await settle();
    oldSession.stop();
    await starting;
    const oldPeer = peer();
    await create().start();
    pending.resolve({ answerSdp: 'old-answer', callId: 'rtc_old' });
    await settle();
    expect(oldPeer.setRemoteDescription).not.toHaveBeenCalled();
    expect(bridge.disconnectRealtime).toHaveBeenCalledWith('rtc_old');
    expect(phase()).toBe('listening');
    expect(peer().close).not.toHaveBeenCalled();
  });

  it('stops the microphone and peer when signaling fails', async () => {
    vi.mocked(bridge.connectRealtime).mockRejectedValueOnce(new Error('Voice Mode needs an OpenAI key.'));
    await create().start();
    expect(phase()).toBe('error');
    expect(states.at(-1)?.error).toContain('OpenAI key');
    expect(stream.tracks[0]?.stop).toHaveBeenCalledOnce();
    expect(peer().close).toHaveBeenCalledOnce();
  });

  it('cleans up a server call when applying the answer fails', async () => {
    const pending = deferred<{ answerSdp: string; callId: string }>();
    vi.mocked(bridge.connectRealtime).mockReturnValueOnce(pending.promise);
    const starting = create().start();
    await settle();
    peer().setRemoteDescription.mockRejectedValueOnce(new Error('invalid SDP'));
    pending.resolve({ answerSdp: 'answer', callId: 'rtc_bad_answer' });
    await starting;
    expect(phase()).toBe('error');
    expect(bridge.disconnectRealtime).toHaveBeenCalledWith('rtc_bad_answer');
  });

  it('fails a data channel that never opens within the overall connection deadline', async () => {
    const pending = deferred<{ answerSdp: string; callId: string }>();
    vi.mocked(bridge.connectRealtime).mockReturnValueOnce(pending.promise);
    const starting = create().start();
    await settle();
    peer().setRemoteDescription.mockImplementationOnce(async () => undefined);
    pending.resolve({ answerSdp: 'answer', callId: 'rtc_no_channel' });
    await settle();
    await vi.advanceTimersByTimeAsync(40_000);
    await starting;
    expect(phase()).toBe('error');
    expect(bridge.disconnectRealtime).toHaveBeenCalledWith('rtc_no_channel');
  });

  it('allows a short network recovery but releases capture on a lasting disconnect', async () => {
    await create().start();
    peer().state('disconnected');
    expect(phase()).toBe('connecting');
    await vi.advanceTimersByTimeAsync(2_000);
    peer().state('connected');
    expect(phase()).toBe('listening');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(phase()).toBe('listening');
    peer().state('disconnected');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(phase()).toBe('error');
    expect(stream.tracks[0]?.stop).toHaveBeenCalledOnce();
    expect(bridge.disconnectRealtime).toHaveBeenCalledWith('rtc_test');
  });

  it('releases capture when the remote data channel unexpectedly closes', async () => {
    await create().start();
    channel().close();
    expect(phase()).toBe('error');
    expect(states.at(-1)?.error).toContain('try again');
    expect(stream.tracks[0]?.stop).toHaveBeenCalledOnce();
    expect(bridge.disconnectRealtime).toHaveBeenCalledWith('rtc_test');
  });

  it.each(['failed', 'incomplete'])('cleans up a %s model reply with a clear retryable error', async (status) => {
    await create().start();
    channel().receive({ type: 'response.created', response: { id: 'r1' } });
    channel().receive({ type: 'response.done', response: { id: 'r1', status } });
    expect(phase()).toBe('error');
    expect(states.at(-1)?.error).toContain('could not finish its reply');
    expect(stream.tracks[0]?.stop).toHaveBeenCalledOnce();
    expect(bridge.disconnectRealtime).toHaveBeenCalledWith('rtc_test');
  });
});
