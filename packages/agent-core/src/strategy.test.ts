import { describe, expect, it, vi } from 'vitest';
import { normalizeStrategy, strategyTool } from './strategy.js';

describe('strategy playbook', () => {
  it('keeps a well formed playbook and drops what it cannot show', () => {
    const playbook = normalizeStrategy({
      headline: 'Lead with your rural reach',
      outlook: 'promising',
      winThemes: ['Show three years of outcomes', ''],
      actions: [{ step: 'Email the program officer', when: 'this week' }, { nope: true }],
      sources: ['https://agency.gov/nofo', 'javascript:alert(1)'],
    });
    expect(playbook).toMatchObject({
      headline: 'Lead with your rural reach',
      outlook: 'promising',
      winThemes: ['Show three years of outcomes'],
      actions: [{ step: 'Email the program officer', when: 'this week' }],
      sources: ['https://agency.gov/nofo'],
    });
  });

  it('needs a headline', () => {
    expect(() => normalizeStrategy({ winThemes: ['x'], actions: [] })).toThrow();
  });

  it('shows the playbook as a step and costs the task nothing', async () => {
    const onStep = vi.fn();
    const tool = strategyTool(onStep);
    await expect(tool.execute({ headline: 'Go', winThemes: ['a'], actions: [{ step: 'b' }] })).resolves.toMatchObject({ shown: true });
    expect(onStep).toHaveBeenCalledWith(expect.objectContaining({ type: 'strategy', detail: 'Go' }));
  });
});
