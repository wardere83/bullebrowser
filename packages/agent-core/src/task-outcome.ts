import type { AgentInput, AgentStep } from './types.js';
import type { ToolCallRecord } from './agent-loop.js';
import type { StepBudget } from './budget.js';
import { ResearchProgress, isResearchRequest, researchSourceMinimum } from './research.js';
import { isFundingDiscoveryRequest } from './funding-sources.js';

export interface TaskOutcome { status: 'completed' | 'incomplete'; reason?: string; verifiedSourceCount: number }
interface Intent { tools: string[]; targets?: string[]; url?: string; text?: string; key?: string; tabId?: string }
const normalize = (value: unknown) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const clicks = ['click', 'clickElement'];
const commands = 'open|navigate|go to|click|tap|type|enter|select|press|scroll|reload|close';
function intentsFor(request: string, initialTabId: string): Intent[] {
  const pattern = new RegExp('(?:^|[;\\n]|\\b(?:and then|then|and)\\s+)(?:(?:can|could|would) you\\s+)?(?:please\\s+)?(' + commands + ')\\s+(.+?)(?=\\s+(?:and then|then|and)\\s+(?:' + commands + ')\\b|[;\\n]|$)', 'gi');
  const intents: Intent[] = [];
  for (const match of request.matchAll(pattern)) {
    const verb = match[1]!.toLowerCase();
    const rest = match[2]!.replace(/[.!?]+$/, '').trim();
    const quoted = [...rest.matchAll(/["“']([^"”']+)["”']/g)].map((part) => part[1]!);
    const target = normalize(quoted[0] ?? rest.replace(/^(?:the|a|an)\s+/i, '').replace(/\s+(?:button|control|link)$/i, ''));
    const url = rest.match(/https?:\/\/[^\s"'<>]+/i)?.[0] ?? (/^[\w-]+(?:\.[\w-]+)+(?:\/\S*)?$/.test(rest) ? 'https://' + rest : undefined);
    if (verb === 'navigate' || verb === 'go to' || (verb === 'open' && (url || /\b(?:tab|page|site|website|source)\b/i.test(rest)))) intents.push({ tools: ['navigate', 'new_tab'], ...(url ? { url } : {}) });
    else if (verb === 'close' && /\btab\b/i.test(rest)) intents.push({ tools: ['close_tab'], ...(/\b(?:this|current|active)\b/i.test(rest) ? { tabId: initialTabId } : {}), ...(quoted[0] ? { targets: [normalize(quoted[0])] } : {}) });
    else if (verb === 'open' || verb === 'close') {
      const generic = !quoted.length && /^(?:the\s+)?(?:menu|navigation|dialog|modal|panel|dropdown)$/i.test(rest);
      intents.push({ tools: clicks, targets: generic ? verb === 'close' ? ['close', 'dismiss', 'cancel'] : ['menu', 'navigation', 'toggle'] : [target] });
    } else if (verb === 'click' || verb === 'tap' || verb === 'press') {
      const key = /^(?:Enter|Space|Tab|Escape|Backspace|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/i.test(rest) ? rest : undefined;
      intents.push({ tools: verb === 'press' ? [...clicks, 'press_key'] : clicks, ...(key ? { key } : { targets: [target] }) });
    } else if (verb === 'type' || verb === 'enter') {
      const natural = rest.match(/^(.+?)\s+(?:into|in)\s+(.+)$/i);
      const text = quoted[0] ?? natural?.[1];
      const field = quoted[1] ?? natural?.[2];
      intents.push({ tools: ['type', 'typeIntoField'], ...(text !== undefined ? { text } : {}), ...(field ? { targets: [normalize(field)] } : {}) });
    } else if (verb === 'select') intents.push({ tools: ['select_option'], ...(quoted[0] ? { text: quoted[0] } : {}) });
    else intents.push({ tools: [verb === 'reload' ? 'reload' : 'scroll'] });
  }
  return intents;
}
function matches(intent: Intent, record: ToolCallRecord): boolean {
  if (!intent.tools.includes(record.name)) return false;
  const output = object(record.output);
  if (intent.tabId && record.input.tabId !== intent.tabId) return false;
  if (intent.url) {
    try { if (new URL(String(record.input.url)).href !== new URL(intent.url).href) return false; } catch { return false; }
  }
  if (intent.text !== undefined && String(record.input.text ?? record.input.option ?? '') !== intent.text) return false;
  if (intent.key) return record.name === 'press_key' && normalize(record.input.key) === normalize(intent.key);
  if (intent.targets?.length) {
    const labels = (record.targetFacts?.label ? [record.targetFacts.label] : [output.matched, record.input.target, output.title]).map(normalize);
    if (!intent.targets.some((target) => target && labels.some((label) => (' ' + label + ' ').includes(' ' + target + ' ')))) return false;
  }
  return true;
}
function succeeded(record: ToolCallRecord): boolean {
  return record.ok && (record.name !== 'close_tab' || object(record.output).closed === true);
}

/** One evidence ledger feeds continuation, answer formatting and host completion. */
export class TaskOutcomeTracker {
  readonly research: ResearchProgress;
  private records: ToolCallRecord[] = [];
  private intents: Intent[];
  private exhausted = false;
  private followUps = 0;
  private declined = false;
  private finalOutcome?: TaskOutcome;
  constructor(private readonly input: AgentInput) {
    const request = input.userRequest ?? input.userMessage;
    const funding = ['find_grants', 'research_funder', 'compare_grants'].includes(input.browserTask ?? '') || isFundingDiscoveryRequest(request);
    this.research = new ResearchProgress(Boolean(input.browserTask || (input.researchMode && isResearchRequest(request))), !input.browserTask, funding, researchSourceMinimum(input.browserTask, request));
    this.intents = intentsFor(request, input.context.activeTabId);
  }
  observe(step: AgentStep): void {
    this.research.observe(step);
    if (step.type === 'budget' && (step.data as { exhausted?: boolean } | undefined)?.exhausted) this.exhausted = true;
    if (step.type === 'error' && ['USER_DECLINED', 'BLOCKED_BY_POLICY', 'PERMISSION_DENIED'].includes((step.data as { code?: string } | undefined)?.code ?? '')) this.declined = true;
  }
  record(record: ToolCallRecord): void { this.records.push(record); }
  observeContext(url?: string, text?: string): void {
    if (url && text) this.research.observe({ type: 'tool_result', toolName: 'read_page', data: { url, text } });
  }
  followUp(text: string, budget: StepBudget): string | null {
    if (this.declined || this.followUps >= 2 || budget.used >= budget.total * 0.75 || /\b(?:cannot|blocked|not permitted|not supported|declined)\b/i.test(text)) return null;
    if (!this.input.browserTask && !this.intents.length) return null;
    const result = this.finish(text);
    if (result.status !== 'incomplete' || (this.research.enabled && this.research.sources.size < this.research.minimumSources) || /\?/.test(text)) return null;
    this.followUps += 1;
    return 'The requested task has not been verified: ' + result.reason +
      ' Continue with permitted tools and verify the requested target or resulting state. Respect refusals and policy blocks; never bypass them. If a blocker remains, describe it accurately instead of claiming completion. Stay within the remaining budget.';
  }
  finalize(text: string): string {
    this.finalOutcome ??= this.finish(text);
    const result = this.finalOutcome;
    if (result.status === 'completed' || (text.length < 600 && /\?/.test(text)) || /incomplete|could not|cannot|did not|needs a connected assistant|ran out of step budget|declined/i.test(text)) return text;
    return 'Task incomplete. ' + result.reason;
  }
  get outcome(): TaskOutcome { return this.finalOutcome ?? this.finish(''); }
  finish(text: string): TaskOutcome {
    let reason: string | undefined;
    if (!text.trim()) reason = 'No final result was produced.';
    else if (this.exhausted) reason = 'The task reached its execution budget before all requested work was verified.';
    else if (this.research.enabled && this.research.sources.size < this.research.minimumSources) reason = 'Only ' + this.research.sources.size + ' source pages were verified; the required research remains incomplete.';
    else if (/needs a connected assistant|ran out of step budget|no readable page open|^task incomplete|^research is incomplete|(?:could not|cannot|unable to) complete/i.test(text)) reason = 'The requested work could not be completed with the available connection or page.';
    if (!reason) for (const intent of this.intents) {
      const latest = [...this.records].reverse().find((record) => matches(intent, record));
      if (!latest || !succeeded(latest)) { reason = 'The requested browser action or target was not executed successfully.'; break; }
    }
    if (!reason && !this.intents.length && !this.research.enabled) {
      const failed = this.records.find((record, index) => !succeeded(record) && !this.records.slice(index + 1).some((later) => later.name === record.name && JSON.stringify(later.input) === JSON.stringify(record.input) && succeeded(later)));
      if (failed) reason = 'An attempted operation failed and no matching recovery was verified.';
    }
    return { status: reason ? 'incomplete' : 'completed', ...(reason ? { reason } : {}), verifiedSourceCount: this.research.sources.size };
  }
}
