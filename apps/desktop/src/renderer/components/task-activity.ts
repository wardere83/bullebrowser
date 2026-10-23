import type { AgentStepEvent } from '../../shared/agent-events.js';

export type ActivityStatus = 'idle' | 'running' | 'error';
export interface ActivityAction {
  id: number;
  toolName: string;
  label: string;
  state: 'running' | 'completed' | 'error' | 'stopped';
  message?: string;
}

const ACTIONS: Record<string, string> = {
  navigate: 'Opening',
  read_page: 'Reading the page',
  getPageText: 'Reading the page',
  getPageMetadata: 'Checking the page',
  getActiveTab: 'Checking the active tab',
  extract: 'Extracting page information',
  extractStructuredData: 'Extracting page information',
  summarizePage: 'Summarizing the page',
  listLinks: 'Checking page links',
  getSelection: 'Reading the selection',
  queryDom: 'Finding page controls',
  click: 'Clicking',
  clickElement: 'Clicking',
  type: 'Entering text',
  typeIntoField: 'Entering text',
  press_key: 'Pressing a key',
  scroll: 'Scrolling the page',
  wait_for: 'Waiting for the page',
  screenshot: 'Taking a screenshot',
  new_tab: 'Opening a new tab',
  switch_tab: 'Switching tabs',
  close_tab: 'Closing a tab',
  list_tabs: 'Checking open tabs',
  listTabs: 'Checking open tabs',
  go_back: 'Going back',
  go_forward: 'Going forward',
  reload: 'Reloading the page',
  find_elements: 'Finding page controls',
  select_option: 'Choosing an option',
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Display only the source hostname; URLs can include private query parameters. */
function sourceHost(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
}

function actionLabel(step: Extract<AgentStepEvent, { kind: 'tool_call' }>): string {
  const verb = ACTIONS[step.toolName] ?? `Running ${step.toolName.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}`;
  const input = record(step.input);
  const host = sourceHost(input?.url);
  if (host) return `${verb} ${host}`;
  // Never show typed text, raw tool arguments or page contents in the log.
  const target = typeof input?.target === 'string' && ['click', 'clickElement', 'find_elements'].includes(step.toolName)
    ? input.target.trim().slice(0, 100)
    : '';
  return target ? `${verb} “${target}”` : verb;
}

/** A call is complete only when its real result arrives. Errors remain visible through retries. */
export function activityActions(steps: readonly AgentStepEvent[], status: ActivityStatus): ActivityAction[] {
  const actions: ActivityAction[] = [];
  for (const [index, step] of steps.entries()) {
    if (step.kind === 'tool_call') {
      actions.push({ id: index, toolName: step.toolName, label: actionLabel(step), state: 'running' });
    } else if (step.kind === 'tool_result' || (step.kind === 'error' && step.toolName)) {
      const toolName = step.toolName;
      const action = [...actions].reverse().find((entry) => entry.toolName === toolName && entry.state === 'running');
      if (action) {
        action.state = step.kind === 'error' ? 'error' : 'completed';
        if (step.kind === 'error') action.message = step.message;
        else {
          const host = sourceHost(record(step.output)?.url);
          if (host && !action.label.includes(host)) action.label = `${action.label} · ${host}`;
        }
      } else if (step.kind === 'error') {
        // Some validation failures occur before the tool can start.
        actions.push({ id: index, toolName: toolName ?? 'unknown', label: 'Action could not start', state: 'error', message: step.message });
      }
    }
  }
  if (status !== 'running') {
    for (const action of actions) if (action.state === 'running') action.state = 'stopped';
  }
  return actions;
}

/** These are the assistant's public text events, never its private reasoning. */
export function liveAssistantText(steps: readonly AgentStepEvent[]): string {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step?.kind === 'text' && step.text.trim()) return step.text;
  }
  return '';
}

/** Source counts come only from actual page reads, never from a timer or a plan. */
export function pagesRead(steps: readonly AgentStepEvent[]): number {
  const pages = new Set<string>();
  for (const step of steps) {
    if (step.kind !== 'tool_result' || step.toolName !== 'read_page') continue;
    const output = record(step.output);
    if (typeof output?.url !== 'string' || typeof output.text !== 'string' || !output.text.trim()) continue;
    try {
      const url = new URL(output.url);
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      url.hash = '';
      pages.add(url.href);
    } catch { /* A malformed URL is not a read page. */ }
  }
  return pages.size;
}
