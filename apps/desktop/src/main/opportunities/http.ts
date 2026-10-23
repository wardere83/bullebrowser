// Requests to official funding sources. They are made from the main process
// only (the renderer's content policy allows no outside connections, and most
// sources send no cross-origin headers), they send search terms and filters
// and nothing about the organization, and they fail loudly: a challenge page,
// an error page served with status 200 or an oversized body is an error, never
// an empty result.

import { FundingError } from '../funding/errors.js';

const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_BODY_BYTES = 12 * 1024 * 1024;
/** Several official sites refuse requests that do not look like a browser. */
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 BulleBrowser';

export interface HttpRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  /** Sent as JSON when it is not a string or FormData. */
  body?: unknown;
  signal: AbortSignal;
  timeoutMs?: number;
  /** The source's name, for the error message. */
  source: string;
}

export interface HttpClient {
  json<T = unknown>(request: HttpRequest): Promise<T>;
  text(request: HttpRequest): Promise<string>;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

function unavailable(source: string, detail: string): FundingError {
  return new FundingError('SOURCE_UNAVAILABLE', `${source} could not be read: ${detail}`);
}

async function send(fetchImpl: FetchLike, request: HttpRequest): Promise<{ body: string; contentType: string }> {
  if (request.signal.aborted) throw new FundingError('CANCELLED', 'Cancelled.');
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  request.signal.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, request.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      accept: 'application/json, text/plain;q=0.8, */*;q=0.5',
      'user-agent': USER_AGENT,
      ...request.headers,
    };
    let body: BodyInit | undefined;
    if (typeof request.body === 'string' || request.body instanceof FormData) {
      body = request.body;
    } else if (request.body !== undefined) {
      body = JSON.stringify(request.body);
      headers['content-type'] ??= 'application/json';
    }
    const response = await fetchImpl(request.url, {
      method: request.method ?? (body === undefined ? 'GET' : 'POST'),
      headers,
      body,
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!response.ok) throw unavailable(request.source, `it answered with status ${response.status}.`);
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MAX_BODY_BYTES) throw unavailable(request.source, 'its answer was too large.');
    const text = await response.text();
    if (text.length > MAX_BODY_BYTES) throw unavailable(request.source, 'its answer was too large.');
    return { body: text, contentType: response.headers.get('content-type') ?? '' };
  } catch (error) {
    if (error instanceof FundingError) throw error;
    if (request.signal.aborted) throw new FundingError('CANCELLED', 'Cancelled.');
    if (timedOut) throw unavailable(request.source, 'it took too long to answer.');
    throw unavailable(request.source, 'the connection failed. Check your internet connection.');
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', onAbort);
  }
}

export function createHttpClient(fetchImpl: FetchLike = (input, init) => fetch(input, init)): HttpClient {
  return {
    async json<T>(request: HttpRequest): Promise<T> {
      const { body, contentType } = await send(fetchImpl, request);
      // Error and challenge pages are often HTML served with a success status.
      if (/html/i.test(contentType) || /^\s*</.test(body)) {
        throw unavailable(request.source, 'it answered with a web page instead of data.');
      }
      try {
        return JSON.parse(body) as T;
      } catch {
        throw unavailable(request.source, 'its answer was not valid data.');
      }
    },
    async text(request: HttpRequest): Promise<string> {
      return (await send(fetchImpl, request)).body;
    },
  };
}
