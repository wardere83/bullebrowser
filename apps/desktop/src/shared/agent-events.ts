// Agent step events serialized over IPC. Mirrors the AgentStep type
// from @bullebrowser/agent-core but adds an event id and timestamp for
// the renderer's activity feed.

export type AgentStepEvent =
  | { kind: 'thinking'; detail?: string; ts: number }
  | { kind: 'tool_call'; toolName: string; detail: string; input: unknown; ts: number }
  | { kind: 'tool_result'; toolName: string; output: unknown; ts: number }
  | { kind: 'text'; text: string; ts: number }
  | { kind: 'error'; toolName?: string; message: string; code?: string; ts: number }
  | { kind: 'budget'; detail: string; used: number; total: number; exhausted: boolean; ts: number }
  | { kind: 'done'; ts: number };
