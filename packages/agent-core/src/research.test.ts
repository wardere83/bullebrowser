import { describe, expect, it } from 'vitest';
import { ResearchProgress, isResearchRequest } from './research.js';
import { StepBudget } from './budget.js';

const read = (url: string, text = 'Source text') => ({ type: 'tool_result' as const, toolName: 'read_page' as const, data: { url, text } });
describe('live research requirements', () => {
  it('recognizes research without turning simple page commands into broad searches', () => {
    expect(isResearchRequest('Find grants for California schools')).toBe(true);
    expect(isResearchRequest('Compare current funding opportunities')).toBe(true);
    expect(isResearchRequest('summarize this page')).toBe(false);
    expect(isResearchRequest('open https://grants.gov')).toBe(false);
    expect(isResearchRequest('Fill the form with my contact information')).toBe(false);
  });
  it('does not ask again after the user answered a browser option’s question', () => {
    const progress = new ResearchProgress(true, false);
    expect(progress.followUp('Which funder should I research?', new StepBudget())).toContain('Continue');
    expect(progress.finish('Which funder should I research?')).not.toContain('Which funder');
  });

  it('counts distinct successful source reads and excludes search snippets and empty pages', () => {
    const progress = new ResearchProgress(true);
    for (const url of ['https://duckduckgo.com/?q=grants', 'https://www.google.com/search?q=grants', 'https://bing.com/search?q=grants']) progress.observe(read(url));
    progress.observe(read('https://funder.org/one', ''));
    progress.observe(read('https://funder.org/one'));
    progress.observe(read('https://funder.org/one#section'));
    expect(progress.sources.size).toBe(1);
    expect(progress.followUp('Here are the results.', new StepBudget())).toContain('1 distinct');
    progress.observe(read('https://funder.org/two'));
    progress.observe(read('https://agency.gov/three'));
    expect(progress.followUp('Here are the results.', new StepBudget())).toBeNull();
    expect(progress.finish('Verified results.')).toBe('Verified results.');
  });
  it('bounds retries and refuses to present an unverified final answer', () => {
    const progress = new ResearchProgress(true);
    const budget = new StepBudget();
    expect(progress.followUp('Made up findings.', budget)).not.toBeNull();
    expect(progress.followUp('Made up findings.', budget)).not.toBeNull();
    expect(progress.followUp('Made up findings.', budget)).toBeNull();
    expect(progress.finish('Made up findings.')).not.toContain('Made up');
  });
  it('allows clarification and stops asking for research after denial or the budget warning', () => {
    const progress = new ResearchProgress(true);
    expect(progress.followUp('Which location should I search?', new StepBudget())).toBeNull();
    progress.observe({ type: 'error', toolName: 'navigate', data: { code: 'USER_DECLINED' } });
    expect(progress.followUp('No access.', new StepBudget())).toBeNull();
    expect(progress.finish('No access.')).toContain('declined');
    const budget = new StepBudget(4);
    budget.charge('navigate'); budget.charge('read_page');
    expect(new ResearchProgress(true).followUp('Partial results.', budget)).toBeNull();
  });
});
