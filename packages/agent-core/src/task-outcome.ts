import type { AgentInput, AgentStep } from './types.js';
import type { StepBudget } from './budget.js';
import { ResearchProgress, isResearchRequest } from './research.js';

export interface TaskOutcome {
  status: 'completed' | 'incomplete';
  reason?: string;
  verifiedSourceCount: number;
}

/** Completion reflects observed execution; a model saying "done" is not evidence. */
export class TaskOutcomeTracker {
  private research: ResearchProgress;
  private successful = new Set<string>();
  private lastActionFailed = false;
  private exhausted = false;
  private followUps = 0;
  private declined = false;
  constructor(private readonly input: AgentInput) {
    const request = input.userRequest ?? input.userMessage;
    const funding = ['find_grants', 'research_funder', 'compare_grants'].includes(input.browserTask ?? '');
    this.research = new ResearchProgress(funding || Boolean(input.researchMode && isResearchRequest(request)), true, funding);
  }
  observe(step: AgentStep): void {
    this.research.observe(step);
    if (step.type === 'budget' && (step.data as { exhausted?: boolean } | undefined)?.exhausted) this.exhausted = true;
    if (step.type === 'error') {
      this.lastActionFailed = true;
      if (['USER_DECLINED', 'BLOCKED_BY_POLICY', 'PERMISSION_DENIED'].includes((step.data as { code?: string } | undefined)?.code ?? '')) this.declined = true;
    }
    if (step.type === 'tool_result' && step.toolName) {
      this.successful.add(step.toolName);
      this.lastActionFailed = false;
    }
  }
  observeContext(url?: string, text?: string): void {
    if (url && text) this.research.observe({ type: 'tool_result', toolName: 'read_page', data: { url, text } });
  }
  followUp(text: string, budget: StepBudget): string | null {
    if (this.declined || this.followUps >= 2 || budget.used >= budget.total * 0.75 || /\b(?:cannot|blocked|not permitted|not supported|declined)\b/i.test(text)) return null;
    if (!this.input.browserTask && !/^(?:please\s+)?(?:open|navigate|go to|click|tap|type|enter|select|press|scroll|reload|close)\b/i.test(this.input.userRequest ?? this.input.userMessage)) return null;
    const result = this.finish(text);
    if (result.status !== 'incomplete' || this.research.enabled || /\?/.test(text)) return null;
    this.followUps += 1;
    return 'The requested task has not been verified: ' + result.reason +
      ' Continue with the permitted browser tools and inspect the resulting state. Respect refusals and policy blocks; never bypass them. If a blocker remains, describe it accurately instead of claiming completion. Stay within the remaining budget.';
  }
  present(text: string): string {
    const result = this.finish(text);
    if (result.status === 'completed' || (text.length < 600 && /\?/.test(text)) || /incomplete|could not|cannot|did not|needs a connected assistant|ran out of step budget|declined/i.test(text)) return text;
    return `Task incomplete. ${result.reason}`;
  }
  finish(text: string): TaskOutcome {
    let reason: string | undefined;
    if (!text.trim()) reason = 'No final result was produced.';
    else if (this.exhausted) reason = 'The task reached its execution budget before all requested work was verified.';
    else if (this.lastActionFailed) reason = 'The last attempted action failed and no successful recovery was verified.';
    else if (this.research.enabled && this.research.sources.size < 3) reason = `Only ${this.research.sources.size} source pages were verified; the required research remains incomplete.`;
    else if (this.input.browserTask === 'explore_page' && this.research.sources.size === 0) reason = 'No readable source page was verified for the requested page exploration.';
    else if (/needs a connected assistant|ran out of step budget|no readable page open/i.test(text)) reason = 'The requested work could not be completed with the available connection or page.';
    const action = (this.input.userRequest ?? this.input.userMessage).trim().match(/^(?:please\s+)?(open|navigate|go to|click|tap|type|enter|select|press|scroll|reload|close)\b/i)?.[1]?.toLowerCase();
    const required: Record<string, string[]> = {
      open: ['navigate', 'new_tab'], navigate: ['navigate'], 'go to': ['navigate'],
      click: ['click', 'clickElement'], tap: ['click', 'clickElement'],
      type: ['type', 'typeIntoField'], enter: ['type', 'typeIntoField', 'press_key'],
      select: ['select_option'], press: ['press_key', 'click'], scroll: ['scroll'],
      reload: ['reload'], close: ['close_tab'],
    };
    if (!reason && action && !required[action]?.some((name) => this.successful.has(name))) reason = 'The requested browser action was not executed successfully.';
    return { status: reason ? 'incomplete' : 'completed', ...(reason ? { reason } : {}), verifiedSourceCount: this.research.sources.size };
  }
}
