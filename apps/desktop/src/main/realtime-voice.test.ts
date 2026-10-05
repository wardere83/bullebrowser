import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as RealtimeVoiceModule from './realtime-voice.js';

let apiKey: string | null = 'sk-realtime-test-secret';
const getApiKey = vi.fn((provider: string) => provider === 'openai' ? apiKey : null);
vi.mock('./storage/secrets.js', () => ({ getApiKey }));

const OFFER = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const ANSWER = OFFER.replace('o=- 1 1', 'o=- 2 2');
type FetchImpl = (url: string, init: RequestInit) => Promise<Response> | Response;
let voice: typeof RealtimeVoiceModule;

function connected(callId = 'rtc_test', answer = ANSWER): Response {
  return new Response(answer, {
    status: 201,
    headers: { location: `/v1/realtime/calls/${callId}`, 'content-type': 'application/sdp' },
  });
}

function mockFetch(impl: FetchImpl = (url) => url.endsWith('/hangup')
  ? new Response(null, { status: 200 })
  : connected()) {
  const fn = vi.fn<FetchImpl>(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  apiKey = 'sk-realtime-test-secret';
  getApiKey.mockClear();
  voice = await import('./realtime-voice.js');
});

afterEach(() => {
  voice.disposeRealtimeVoice(1);
  voice.disposeRealtimeVoice(2);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('live voice signaling', () => {
  it('returns only the SDP answer and call id, keeping the saved OpenAI key in main', async () => {
    const fetch = mockFetch();
    const result = await voice.connectRealtimeVoice(1, OFFER);
    expect(result).toEqual({ answerSdp: ANSWER, callId: 'rtc_test' });
    expect(JSON.stringify(result)).not.toContain(apiKey);
    expect(getApiKey).toHaveBeenCalledWith('openai');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/realtime/calls');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: `Bearer ${apiKey}`, Accept: 'application/sdp' });
    const form = init.body as FormData;
    expect(form.get('sdp')).toBe(OFFER);
    const session = JSON.parse(String(form.get('session')));
    expect(session).toMatchObject({
      type: 'realtime', model: 'gpt-realtime', output_modalities: ['audio'],
      audio: {
        input: {
          noise_reduction: { type: 'near_field' },
          transcription: { model: 'gpt-4o-mini-transcribe' },
          turn_detection: { type: 'semantic_vad', create_response: true, interrupt_response: true },
        },
        output: { voice: 'marin' },
      },
    });
    expect(session.tools).toEqual([expect.objectContaining({
      type: 'function', name: 'perform_browser_task',
      parameters: {
        type: 'object', properties: { prompt: expect.objectContaining({ type: 'string' }) },
        required: ['prompt'], additionalProperties: false,
      },
    }), expect.objectContaining({
      type: 'function', name: 'cancel_browser_task',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    })]);
    expect(session.instructions).toContain('Never say you opened');
    expect(session.instructions).toContain('Never claim cancellation without');
    expect(session.instructions).toContain('BulleBrowser Agentic AI');
    expect(session.instructions).toContain('support@bullebrowser.com');
    expect(session.instructions).toContain('internal model/provider');
    expect(JSON.stringify(session)).not.toContain(apiKey);
  });

  it('directs users to keyless Voice Mode without naming internal providers', async () => {
    apiKey = null;
    const fetch = mockFetch();
    await expect(voice.connectRealtimeVoice(1, OFFER)).rejects.toThrow(/keyless Voice Mode.*support@bullebrowser\.com/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['', 'empty'],
    ['not sdp', 'malformed'],
    ['v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n', 'missing audio'],
    [OFFER + '\0', 'control character'],
    [OFFER + 'a='.repeat(70_000), 'too large'],
  ])('rejects invalid offer %# before using credentials', async (offer) => {
    const fetch = mockFetch();
    await expect(voice.connectRealtimeVoice(1, offer)).rejects.toThrow(/Invalid.*offer/);
    expect(fetch).not.toHaveBeenCalled();
    expect(getApiKey).not.toHaveBeenCalled();
  });

  it.each([
    [401, /not authorized/], [403, /not available for this account/], [429, /at its limit/],
    [503, /temporarily unavailable/], [400, /Could not start live voice \(400\)/],
  ])('sanitizes provider errors for status %s', async (status, message) => {
    mockFetch(() => new Response(`Private raw provider error: ${apiKey}`, { status }));
    const error = await voice.connectRealtimeVoice(1, OFFER).catch((value: Error) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(message);
    expect((error as Error).message).not.toContain(apiKey);
    expect((error as Error).message).not.toContain('Private raw');
    expect((error as Error).message).not.toMatch(/OpenAI|Anthropic|Claude|ChatGPT/);
  });

  it('sanitizes network exceptions, including ones that resemble friendly messages', async () => {
    mockFetch(() => { throw new Error(`OpenAI ${apiKey}`); });
    await expect(voice.connectRealtimeVoice(1, OFFER)).rejects.toThrow(
      'Could not connect live voice. Check your connection and try again.',
    );
  });

  it.each([
    null,
    'https://attacker.example/v1/realtime/calls/rtc_test',
    'https://api.openai.com/v1/realtime/calls/rtc_test?key=private',
    '/v1/realtime/calls/rtc_test/../../anything',
    '/v1/realtime/calls/call%2Fother',
  ])('rejects an untrusted call location %s without sending a hangup to it', async (location) => {
    const headers = new Headers({ 'content-type': 'application/sdp' });
    if (location) headers.set('location', location);
    const fetch = mockFetch(() => new Response(ANSWER, { status: 201, headers }));
    await expect(voice.connectRealtimeVoice(1, OFFER)).rejects.toThrow(/Invalid.*response/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('accepts an opaque provider call id without a required prefix and uses its exact owned hangup path', async () => {
    const fetch = mockFetch((url) => url.endsWith('/hangup')
      ? new Response(null, { status: 200 })
      : connected('call_ABC-123'));
    await expect(voice.connectRealtimeVoice(1, OFFER)).resolves.toEqual({
      answerSdp: ANSWER, callId: 'call_ABC-123',
    });
    await voice.disconnectRealtimeVoice(1, 'call_ABC-123');
    expect(fetch.mock.calls[1]?.[0]).toBe('https://api.openai.com/v1/realtime/calls/call_ABC-123/hangup');
  });

  it('hangs up a created call when its SDP response is invalid or contains the key', async () => {
    const fetch = mockFetch((url) => url.endsWith('/hangup')
      ? new Response(null, { status: 200 })
      : connected('rtc_test', ANSWER + `a=private:${apiKey}\r\n`));
    await expect(voice.connectRealtimeVoice(1, OFFER)).rejects.toThrow(/Invalid.*response/);
    expect(fetch.mock.calls[1]?.[0]).toBe('https://api.openai.com/v1/realtime/calls/rtc_test/hangup');
  });

  it('bounds a streamed SDP answer even without Content-Length', async () => {
    const hugeAnswer = ANSWER + 'a=x\r\n'.repeat(30_000);
    mockFetch((url) => url.endsWith('/hangup')
      ? new Response(null, { status: 200 })
      : connected('rtc_test', hugeAnswer));
    await expect(voice.connectRealtimeVoice(1, OFFER)).rejects.toThrow(/Invalid.*response/);
  });

  it.each([
    ['text/html', ANSWER],
    ['application/sdp', '<html>not an SDP answer</html>'],
  ])('rejects an invalid response content type or body (%#)', async (contentType, answer) => {
    const fetch = mockFetch((url) => url.endsWith('/hangup')
      ? new Response(null, { status: 200 })
      : new Response(answer, {
        status: 201,
        headers: { location: '/v1/realtime/calls/rtc_test', 'content-type': contentType },
      }));
    await expect(voice.connectRealtimeVoice(1, OFFER)).rejects.toThrow(/Invalid.*response/);
    expect(fetch.mock.calls[1]?.[0]).toContain('/rtc_test/hangup');
  });

  it('hangs up only a call owned by the requesting renderer, once, using the original key', async () => {
    const fetch = mockFetch();
    await voice.connectRealtimeVoice(1, OFFER);
    apiKey = 'sk-new-key';
    await voice.disconnectRealtimeVoice(2, 'rtc_test');
    await voice.disconnectRealtimeVoice(1, 'https://attacker.example');
    expect(fetch).toHaveBeenCalledTimes(1);
    await voice.disconnectRealtimeVoice(1, 'rtc_test');
    expect(fetch.mock.calls[1]).toEqual([
      'https://api.openai.com/v1/realtime/calls/rtc_test/hangup',
      expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer sk-realtime-test-secret' } }),
    ]);
    await voice.disconnectRealtimeVoice(1, 'rtc_test');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('replaces a pending handshake and hangs up a late stale call without touching the replacement', async () => {
    let resolveFirst!: (response: Response) => void;
    let number = 0;
    const fetch = mockFetch((url) => {
      if (url.endsWith('/hangup')) return new Response(null, { status: 200 });
      number++;
      if (number === 1) return new Promise((resolve) => { resolveFirst = resolve; });
      return connected('rtc_new');
    });
    const old = voice.connectRealtimeVoice(1, OFFER);
    const oldResult = expect(old).rejects.toThrow(/cancelled/);
    await expect(voice.connectRealtimeVoice(1, OFFER)).resolves.toMatchObject({ callId: 'rtc_new' });
    expect(fetch.mock.calls[0]?.[1].signal?.aborted).toBe(true);
    resolveFirst(connected('rtc_old'));
    await oldResult;
    expect(fetch.mock.calls[2]?.[0]).toContain('/rtc_old/hangup');
    await voice.disconnectRealtimeVoice(1, 'rtc_new');
    expect(fetch.mock.calls[3]?.[0]).toContain('/rtc_new/hangup');
  });

  it('closes the previous active call when a new call is started', async () => {
    let number = 0;
    const fetch = mockFetch((url) => url.endsWith('/hangup')
      ? new Response(null, { status: 200 })
      : connected(`rtc_${++number}`));
    await voice.connectRealtimeVoice(1, OFFER);
    await voice.connectRealtimeVoice(1, OFFER);
    expect(fetch.mock.calls[1]?.[0]).toContain('/rtc_1/hangup');
    await voice.disconnectRealtimeVoice(1, 'rtc_1');
    expect(fetch).toHaveBeenCalledTimes(3);
    await voice.disconnectRealtimeVoice(1, 'rtc_2');
    expect(fetch.mock.calls[3]?.[0]).toContain('/rtc_2/hangup');
  });

  it('treats an already-ended call as successfully disconnected', async () => {
    mockFetch((url) => url.endsWith('/hangup') ? new Response(null, { status: 404 }) : connected());
    await voice.connectRealtimeVoice(1, OFFER);
    await expect(voice.disconnectRealtimeVoice(1, 'rtc_test')).resolves.toBeUndefined();
  });

  it('aborts a pending handshake when the owning window closes', async () => {
    mockFetch((_url, init) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const pending = voice.connectRealtimeVoice(1, OFFER);
    const rejected = expect(pending).rejects.toThrow(/cancelled/);
    voice.disposeRealtimeVoice(1);
    await rejected;
  });

  it('times out the handshake within thirty seconds', async () => {
    const fetch = mockFetch((_url, init) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const pending = voice.connectRealtimeVoice(1, OFFER);
    const rejected = expect(pending).rejects.toThrow(/too long to connect/);
    await vi.advanceTimersByTimeAsync(25_000);
    await rejected;
    expect(fetch.mock.calls[0]?.[1].signal?.aborted).toBe(true);
  });

  it('cleans up an expired active call and makes later disconnect a no-op', async () => {
    const fetch = mockFetch();
    await voice.connectRealtimeVoice(1, OFFER);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(fetch.mock.calls[1]?.[0]).toContain('/rtc_test/hangup');
    await voice.disconnectRealtimeVoice(1, 'rtc_test');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
