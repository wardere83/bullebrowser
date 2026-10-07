import { describe, expect, it, vi } from 'vitest';
import { RFP_SECTIONS, type RfpSectionId } from '../../shared/funding.js';
import type { SourceDocument, Complete } from '../funding/pipeline.js';
import { analyzeRfp } from './analysis.js';
import type { RawRfpAnalysis, RawSection } from './analysis-schema.js';

const document: SourceDocument = {
  id: 'rfp-one',
  name: 'Official notice.pdf',
  version: 1,
  label: 'Funding document',
  blocks: [
    {
      id: 'b0001',
      kind: 'paragraph',
      text: 'Awards range from $25,000 to $75,000. Applications are due November 15, 2026.',
      page: 1,
      section: 'Awards',
      headingLevel: null,
    },
    {
      id: 'b0002',
      kind: 'paragraph',
      text: 'Applicants must provide a 20% cash match. AI-generated proposal narratives are prohibited.',
      page: 2,
      section: 'Conditions',
      headingLevel: null,
    },
  ],
};
const input = (complete: Complete | null) => ({
  organizationId: 'org-one',
  document,
  complete,
  signal: new AbortController().signal,
  progress: vi.fn(),
  now: 42,
});
function raw(): RawRfpAnalysis {
  return {
    overview: 'The funder supports local programs.',
    sections: Object.fromEntries(
      RFP_SECTIONS.map((id) => [id, { coverage: 'missing', note: 'Not stated.', items: [] }]),
    ) as unknown as Record<RfpSectionId, RawSection>,
    glossary: [],
    ai_use: { stance: 'not_stated', summary: '', evidence: [] },
    uncertainties: [],
    questions: [],
  };
}

describe('RFP evidence boundaries', () => {
  it('offers exact source findings without making a keyless eligibility judgement', async () => {
    const result = await analyzeRfp(input(null));
    expect(result.method).toBe('text_matches');
    expect(result.sections).toHaveLength(13);
    expect(result.literalFindings.some((finding) => finding.kind === 'amount')).toBe(true);
    expect(result.literalFindings.some((finding) => finding.kind === 'ai_tools')).toBe(true);
    for (const finding of result.literalFindings) {
      expect(
        document.blocks.find((block) => block.id === finding.citation.blockId)?.text,
      ).toContain(finding.citation.quote);
      expect(finding.citation.documentId).toBe(document.id);
    }
  });
  it('drops nonexistent citations and flags unsupported award numbers', async () => {
    const answer = raw();
    answer.sections.award_amounts = {
      coverage: 'stated',
      note: '',
      items: [
        {
          text: 'Awards are $900,000.',
          basis: 'explicit',
          evidence: [{ block_id: 'F1:b0001', quote: 'Awards range from $25,000 to $75,000.' }],
        },
        {
          text: 'Every business is eligible.',
          basis: 'explicit',
          evidence: [{ block_id: 'F1:b9999', quote: 'Every business is eligible.' }],
        },
      ],
    };
    const complete = vi.fn(async () => answer) as unknown as Complete;
    const result = await analyzeRfp(input(complete));
    const awards = result.sections.find((section) => section.id === 'award_amounts')!;
    expect(awards.items).toHaveLength(1);
    expect(awards.items[0]?.needsReview).toBe(true);
    expect(result.limitations.length).toBeGreaterThan(0);
  });
  it('keeps an evidenced AI prohibition and rejects cancellation', async () => {
    const answer = raw();
    answer.ai_use = {
      stance: 'prohibited',
      summary: 'AI-generated narratives are prohibited.',
      evidence: [
        { block_id: 'F1:b0002', quote: 'AI-generated proposal narratives are prohibited.' },
      ],
    };
    const result = await analyzeRfp(input(vi.fn(async () => answer) as unknown as Complete));
    expect(result.aiUse.stance).toBe('prohibited');
    expect(result.aiUse.citations[0]?.page).toBe(2);
    const cancelled = input(null);
    const controller = new AbortController();
    controller.abort();
    cancelled.signal = controller.signal;
    await expect(analyzeRfp(cancelled)).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
