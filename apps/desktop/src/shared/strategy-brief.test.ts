import { describe, expect, it } from 'vitest';
import type { StrategyPlaybook } from '@bullebrowser/agent-core';
import { BRIEF_FULL_LIMIT, briefHtml, buildBrief, collectPlaybooks, deadlineTime, rankPlaybooks } from './strategy-brief.js';

const NOW = Date.UTC(2026, 10, 28);

const playbook = (overrides: Partial<StrategyPlaybook>): StrategyPlaybook => ({
  headline: 'A program worth pursuing',
  winThemes: ['Lead with measured outcomes'],
  actions: [{ step: 'Register on the funder portal', owner: 'you' }],
  ...overrides,
});

const run = (startedAt: number, playbooks: StrategyPlaybook[]) => ({
  startedAt,
  steps: playbooks.map((p, index) => ({ kind: 'strategy', playbook: p, ts: startedAt + index })),
});

describe('strategy brief', () => {
  it('keeps one playbook per opportunity, the latest version of each', () => {
    const first = playbook({ opportunity: 'Youth Workforce Grant', headline: 'Old take' });
    const updated = playbook({ opportunity: 'youth workforce grant', headline: 'New take' });
    const other = playbook({ opportunity: 'Main Street Fund', headline: 'Small business angle' });
    const collected = collectPlaybooks([run(2, [updated]), run(1, [first, other])]);
    expect(collected.map((p) => p.headline)).toEqual(['New take', 'Small business angle']);
  });

  it('reads deadlines written as ISO dates, words or numbers', () => {
    expect(deadlineTime(playbook({ deadlines: ['Due 2027-01-15'] }))).toBe(Date.UTC(2027, 0, 15));
    expect(deadlineTime(playbook({ deadlines: ['Applications close March 3, 2027'] }))).toBe(Date.UTC(2027, 2, 3));
    expect(deadlineTime(playbook({ deadlines: ['Rolling'] }))).toBeNull();
  });

  it('ranks strong fits first, nearest deadline next, and passed deadlines last', () => {
    const ranked = rankPlaybooks([
      playbook({ opportunity: 'Long shot', outlook: 'long shot', deadlines: ['2027-01-01'] }),
      playbook({ opportunity: 'Strong later', outlook: 'strong', deadlines: ['2027-06-01'] }),
      playbook({ opportunity: 'Strong sooner', outlook: 'strong', deadlines: ['2027-02-01'] }),
      playbook({ opportunity: 'Strong passed', outlook: 'strong', deadlines: ['2026-01-01'] }),
    ], NOW);
    expect(ranked.map((p) => p.opportunity)).toEqual(['Strong sooner', 'Strong later', 'Long shot', 'Strong passed']);
  });

  it('builds a short brief: full detail for the best few, one line for the rest', () => {
    const many = Array.from({ length: BRIEF_FULL_LIMIT + 2 }, (_, i) =>
      playbook({ opportunity: `Program ${i + 1}`, outlook: 'promising', requirements: ['Two years of audited financials'] }));
    const brief = buildBrief(many, NOW);
    expect(brief.opportunities).toHaveLength(BRIEF_FULL_LIMIT);
    expect(brief.alsoConsidered).toHaveLength(2);
    expect(brief.summary.join(' ')).toMatch(/Pursue Program 1 first/);
  });

  it('renders a self-contained page with what a successful proposal needs', () => {
    const html = briefHtml(buildBrief([playbook({
      opportunity: 'Youth Workforce <Grant>',
      funder: 'State Labor Department',
      requirements: ['A letter of support from a local employer'],
    })], NOW));
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('What a successful proposal needs');
    expect(html).toContain('A letter of support from a local employer');
    expect(html).toContain('Youth Workforce &lt;Grant&gt;');
    expect(html).not.toMatch(/<script/i);
  });
});
