// Typed tool errors.
//
// A failed tool used to come back as an English sentence the model had to
// interpret to decide whether to retry, look again, or give up. Every failure
// now carries a code from this table alongside the human message. The table
// is also the documentation: `retryable` codes are retried automatically by
// the loop (see RETRY_DELAYS_MS) for the actions that are safe to repeat, and
// `next` tells the model what to do when it sees one.

export const TOOL_ERRORS = {
  ELEMENT_NOT_FOUND: {
    retryable: false,
    next: 'Nothing on the page matched. Call find_elements (or read_page) and use a ref from it.',
  },
  ELEMENT_DETACHED: {
    retryable: true,
    next: 'The element was replaced while acting on it. Retried automatically; if it persists, call find_elements again.',
  },
  FRAME_DETACHED: {
    retryable: false,
    next: 'The frame holding the element went away (the page changed). Call find_elements again.',
  },
  NAVIGATION_IN_PROGRESS: {
    retryable: true,
    next: 'The page was navigating. Retried automatically once it settled.',
  },
  NAVIGATION_TIMEOUT: {
    retryable: false,
    next: 'The page did not finish loading in time. read_page to see what did load, or wait_for something specific.',
  },
  TARGET_CLOSED: {
    retryable: true,
    next: 'The tab or page closed mid-action. Retried automatically; if it persists, list_tabs to re-orient.',
  },
  NETWORK_CHANGED: {
    retryable: true,
    next: 'The network changed mid-request (net::ERR_NETWORK_CHANGED). Retried automatically.',
  },
  NETWORK_ERROR: {
    retryable: false,
    next: 'The page could not be reached. Check the address, or try another source.',
  },
  HTTP_ERROR: {
    retryable: false,
    next: 'The server answered with an error status. Do not retry the same URL; try another page.',
  },
  PAGE_UNRESPONSIVE: {
    retryable: false,
    next: 'The page did not respond to the action. Wait briefly, then read_page before trying again.',
  },
  PERMISSION_DENIED: {
    retryable: false,
    next: 'This site is not allowed this kind of action. Tell the user what you need and why.',
  },
  USER_DECLINED: {
    retryable: false,
    next: 'The user said no. Do not try the same action again; continue without it or ask them.',
  },
  BLOCKED_BY_POLICY: {
    retryable: false,
    next: 'This action is never allowed (e.g. typing a password or card number). Ask the user to do it.',
  },
  VALIDATION_ERROR: {
    retryable: false,
    next: 'The input was rejected (by the tool or by the page). Fix the arguments rather than retrying.',
  },
  BUDGET_EXHAUSTED: {
    retryable: false,
    next: 'The step budget for this task is used up. Summarize what you found and stop.',
  },
  UNSUPPORTED: {
    retryable: false,
    next: 'This browser cannot do that. Use a different approach.',
  },
  UNKNOWN: {
    retryable: false,
    next: 'Read the message; re-orient with read_page or find_elements before retrying.',
  },
} as const;

export type ToolErrorCode = keyof typeof TOOL_ERRORS;

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  constructor(code: ToolErrorCode, message: string) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
  }
  get retryable(): boolean {
    return TOOL_ERRORS[this.code].retryable;
  }
}

// Map a raw failure (a runtime message, an Electron or Chromium error, a zod
// validation error) onto a code. Specific runtimes throw ToolError directly
// where they know; this covers everything that arrives as plain text.
const PATTERNS: [RegExp, ToolErrorCode][] = [
  [/^No (element|input) matched|No option "/i, 'ELEMENT_NOT_FOUND'],
  [/no longer on the page|detached from the DOM|node is detached|stale element|not attached to the DOM/i, 'ELEMENT_DETACHED'],
  [/Frame \S+ is gone|frame was disposed|Render frame was disposed|frame.*detached/i, 'FRAME_DETACHED'],
  [/ERR_NETWORK_CHANGED/i, 'NETWORK_CHANGED'],
  [/net::ERR_|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_INTERNET_DISCONNECTED|ERR_TIMED_OUT/i, 'NETWORK_ERROR'],
  [/Execution context was destroyed|navigation in progress|Inspected target navigated|context.*destroyed/i, 'NAVIGATION_IN_PROGRESS'],
  [/Target closed|Tab not found|Object has been destroyed|WebContents.*destroyed|has been closed/i, 'TARGET_CLOSED'],
  [/did not respond|timed out waiting for the page/i, 'PAGE_UNRESPONSIVE'],
  [/declined|said no|not approved/i, 'USER_DECLINED'],
  [/is blocked|blocked by policy/i, 'BLOCKED_BY_POLICY'],
  [/not available in this browser|unavailable while DevTools/i, 'UNSUPPORTED'],
  [/Refusing to open|Not a valid URL|Invalid CSS selector|invalid_type/i, 'VALIDATION_ERROR'],
];

export function toToolError(error: unknown): ToolError {
  if (error instanceof ToolError) return error;
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Tool execution failed.';
  if (error && typeof error === 'object' && (error as { name?: string }).name === 'ZodError') {
    return new ToolError('VALIDATION_ERROR', message);
  }
  for (const [re, code] of PATTERNS) if (re.test(message)) return new ToolError(code, message);
  return new ToolError('UNKNOWN', message);
}

// What the model receives for a failure.
export function errorPayload(err: ToolError): { error: { code: ToolErrorCode; retryable: boolean; message: string; next: string } } {
  return {
    error: { code: err.code, retryable: err.retryable, message: err.message, next: TOOL_ERRORS[err.code].next },
  };
}

// Backoff for automatically retried actions: up to three retries.
export const RETRY_DELAYS_MS = [250, 750, 2000] as const;

// Actions safe to repeat after a transient failure. A transient failure here
// happens before the action took effect (the element was replaced, the page
// was mid-navigation), so repeating cannot double-submit.
export const RETRYABLE_TOOLS = new Set(['click', 'clickElement', 'type', 'typeIntoField', 'navigate', 'select_option']);
