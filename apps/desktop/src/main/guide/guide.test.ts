import { describe, expect, it, vi } from 'vitest';
import type { GuideInput } from '../funding/services.js';
import { analyzeRfp } from '../rfp/analysis.js';
import { buildGuide } from './guide.js';

const source = {
  id: 'rfp',
  name: 'Notice.txt',
  version: 1,
  label: 'Funding document',
  blocks: [
    {
      id: 'b0001',
      kind: 'paragraph' as const,
      text: 'AI-generated proposal narratives are prohibited.',
      page: null,
      section: 'AI use',
      headingLevel: null,
    },
  ],
};
function input(): GuideInput {
  return {
    id: 'guide',
    organizationId: 'org',
    rfp: null,
    analysis: null,
    baseline: {
      organizationId: 'org',
      organization: {
        name: 'CBO',
        kind: 'cbo',
        location: { country: 'US', region: '', county: '', city: '' },
      },
      claims: [],
      approvedAt: null,
    },
    knowledge: [],
    search: async () => [],
    complete: null,
    signal: new AbortController().signal,
    progress: vi.fn(),
    now: 10,
  };
}
describe('ethical guide restrictions', () => {
  it('provides reflective questions without inventing organization evidence', async () => {
    const guide = await buildGuide(input());
    expect(guide.method).toBe('standard');
    expect(guide.outline.length).toBeGreaterThan(0);
    expect(guide.outline.every((section) => section.strengths.length === 0)).toBe(true);
    expect(guide.outline.some((section) => section.questions.length > 0)).toBe(true);
  });
  it('never sends documents to an assistant when AI use is prohibited or unknown', async () => {
    const request = input();
    request.rfp = source;
    request.analysis = await analyzeRfp({
      organizationId: 'org',
      document: source,
      complete: null,
      signal: request.signal,
      progress: vi.fn(),
      now: 10,
    });
    const complete = vi.fn();
    request.complete = complete;
    let guide = await buildGuide(request);
    expect(guide.mode).toBe('limited');
    expect(complete).not.toHaveBeenCalled();
    request.analysis.aiUse.stance = 'prohibited';
    request.analysis.method = 'assistant';
    guide = await buildGuide(request);
    expect(guide.mode).toBe('limited');
    expect(guide.method).toBe('standard');
    expect(complete).not.toHaveBeenCalled();
  });
  it('rejects a baseline belonging to another organization', async () => {
    const request = input();
    request.baseline.organizationId = 'other';
    await expect(buildGuide(request)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
