import type { AgentStep } from './types.js';
import type { StepBudget } from './budget.js';
import { isBlockedDestination } from './destinations.js';

export function isResearchRequest(request: string): boolean {
  const simpleCommand = /^(?:please\s+)?(?:summari[sz]e|read|click|type|open|go to|navigate to|list tabs)\b/i.test(request);
  if (simpleCommand || /^(?:hi|hello|thanks|thank you|good morning)[!.\s]*$/i.test(request.trim())) return false;
  return /\b(?:research|browse|search|find|compare|investigate|look\s+for|discover|verify|latest|current|grants?|funders?|funding\s+opportunities)\b/i.test(request);
}

/** Only successful live page reads count; search snippets and repeated reads do not. */
export class ResearchProgress {
  readonly sources = new Set<string>();
  private denied = false;
  private reminders = 0;
  constructor(readonly enabled: boolean, private readonly allowClarification = true) {}

  readonly instructions = 'For research and grant discovery, actively browse multiple relevant sources. Search, open the results, follow official program and eligibility links, and read at least three distinct source pages when available. Search snippets alone are not evidence. Cross-check deadlines, eligibility and amounts against official sources. Explain gaps or blocked pages. Ask a brief clarification if essential criteria are missing. Respect the task budget and never claim unperformed browsing.';

  observe(step: AgentStep): void {
    if (step.type === 'error' && (step.data as { code?: string } | undefined)?.code === 'USER_DECLINED') this.denied = true;
    if (step.type !== 'tool_result' || step.toolName !== 'read_page') return;
    const page = step.data as { url?: string; text?: string } | undefined;
    if (!page?.text?.trim() || !page.url) return;
    try {
      const url = new URL(page.url);
      if (!['http:', 'https:'].includes(url.protocol) || isBlockedDestination(url) || /(^|\.)(?:google\.[a-z.]+|bing\.com)$/.test(url.hostname)) return;
      url.hash = '';
      this.sources.add(url.href);
    } catch { /* Invalid addresses cannot count as sources. */ }
  }

  private clarification(text: string): boolean {
    return this.allowClarification && text.length < 600 && /\?/.test(text) && /\b(?:which|what|where|could you|can you|please (?:share|provide)|tell me)\b/i.test(text);
  }

  followUp(text: string, budget: StepBudget): string | null {
    if (!this.enabled || this.sources.size >= 3 || this.denied || this.clarification(text) || budget.used >= budget.total * 0.75 || this.reminders >= 2) return null;
    this.reminders += 1;
    return `Continue the requested live browser research before answering. You have read ${this.sources.size} distinct source pages; aim for at least three relevant source pages. Use navigate, read_page and links to check actual sources, not just search snippets. If access fails, report the limitation; do not invent results. Stay within the remaining step budget.`;
  }

  finish(text: string): string {
    if (!this.enabled || this.sources.size >= 3 || this.clarification(text)) return text;
    if (!this.sources.size) return this.denied
      ? 'Browsing access was declined. I could not verify live sources for this research.'
      : 'I could not verify live source pages for this research. Please retry browsing or provide a source URL; I do not have verified findings to report.';
    return `Research is incomplete: I verified ${this.sources.size} source ${this.sources.size === 1 ? 'page' : 'pages'}. Further source checks are still needed.\n\n${text}`;
  }
}
