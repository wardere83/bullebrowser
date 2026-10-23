import type {
  AgentResultEvent,
  AgentRunRequest,
  BrowserBridge,
  ConversationDetail,
} from '../../shared/ipc.js';

export type VoiceBrowserTaskResult = Pick<AgentResultEvent, 'status' | 'text' | 'error'>;

// A very fast run can finish before the UI receives its handle. Read the
// saved answer, but never replace a newer prompt or another selected chat.
export async function refreshVoiceConversation(
  bridge: Pick<BrowserBridge, 'conversations'>,
  conversationId: string,
  state: {
    current: () => ConversationDetail | null;
    refresh: (conversation: ConversationDetail) => void;
  },
): Promise<void> {
  const current = state.current();
  if (current?.id !== conversationId) return;
  try {
    const saved = await bridge.conversations.get(conversationId);
    if (saved?.id === conversationId && state.current() === current) state.refresh(saved);
  } catch {
    // The voice tool already has its result; a failed chat refresh must not
    // turn a completed browser task into a spoken failure.
  }
}

const cancelledResult = (): VoiceBrowserTaskResult => ({
  status: 'cancelled',
  text: 'The browser task was stopped.',
});

// The run IPC returns a handle, not an answer. Subscribe first: an immediate
// failure can arrive before that handle, while unrelated runs share the feed.
export function runVoiceBrowserTask(
  bridge: Pick<BrowserBridge, 'agent'>,
  request: AgentRunRequest,
  signal: AbortSignal,
  onStarted?: (runId: string) => void,
): Promise<VoiceBrowserTaskResult> {
  if (signal.aborted) return Promise.resolve(cancelledResult());

  return new Promise((resolve) => {
    let runId: string | null = null;
    let settled = false;
    let aborted = false;
    const earlyResults = new Map<string, AgentResultEvent>();
    let unsubscribe = () => {};

    const cleanup = () => {
      const detach = unsubscribe;
      unsubscribe = () => {};
      detach();
      signal.removeEventListener('abort', onAbort);
      earlyResults.clear();
    };
    const finish = (result: VoiceBrowserTaskResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ status: result.status, text: result.text, ...(result.error ? { error: result.error } : {}) });
    };
    const cancelOwnRun = () => {
      if (runId) void bridge.agent.cancel(runId).catch(() => {});
    };
    const onAbort = () => {
      aborted = true;
      cleanup();
      if (runId) {
        cancelOwnRun();
        finish(cancelledResult());
      }
      // If the initial IPC is still pending, retain the dispatch lock until
      // it returns; then cancel that exact run instead of an unrelated task.
    };

    unsubscribe = bridge.agent.onResult((result) => {
      if (settled || aborted || result.conversationId !== request.conversationId) return;
      if (!runId) earlyResults.set(result.runId, result);
      else if (result.runId === runId) finish(result);
    });
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      finish(cancelledResult());
      return;
    }

    const fail = (error: unknown) => {
      finish(aborted
        ? cancelledResult()
        : {
            status: 'failed',
            text: 'The browser task could not start.',
            error: error instanceof Error ? error.message : 'The browser task could not start.',
          });
    };
    try {
      void bridge.agent.run(request).then((started) => {
        runId = started.runId;
        if (aborted) {
          cancelOwnRun();
          finish(cancelledResult());
          return;
        }
        const early = earlyResults.get(runId);
        if (early) finish(early);
        else onStarted?.(runId);
      }).catch(fail);
    } catch (error) {
      fail(error);
    }
  });
}
