import { describe, expect, it } from 'vitest';
import type { BlockKind, ExtractedBlock } from '../documents/types.js';
import { numbersIn, toCitation, unsupportedNumbers, verifyQuote, type VerifiedQuote } from './quote-verifier.js';

// Characters a reader cannot see, or cannot tell from an ordinary one.
const SOFT_HYPHEN = String.fromCodePoint(0xad);
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e);
const NO_BREAK_SPACE = String.fromCodePoint(0xa0);
const TRUE_HYPHEN = String.fromCodePoint(0x2010);
const FI_LIGATURE = String.fromCodePoint(0xfb01);
const ANGLE_MARK = String.fromCodePoint(0x2039);

function block(id: string, text: string, page: number | null = null, kind: BlockKind = 'paragraph', section = ''): ExtractedBlock {
  return { id, kind, text, page, section, headingLevel: kind === 'heading' ? 2 : null };
}

// Modelled on the sample funding notice and impact report.
const ELIGIBLE = 'Eligible applicants are nonprofit organizations with 501(c)(3) status that have operated in the tri-county region for at least three years.';
const UNALLOWABLE = 'Grant funds may not be used for capital construction, lobbying or debt repayment.';
const AWARDS = 'Awards will range from $75,000 to $250,000. A total of $4,000,000 is available, and the Office expects to make 20 to 25 awards.';
const MATCH = 'A match of 25 percent of the grant amount is required and may be provided in cash or in kind.';
const PERIOD = 'The grant period is 24 months, beginning July 1, 2027.';
const RESULTS = 'In 2024, 312 adults completed a workforce certificate, and 68% of graduates were employed within six months.';
const LEARNERS = 'Learners gained an average of 1.6 skill levels, and 1,250 residents attended at least one class.';
const BUDGET = 'None of our programs is funded by a single grant, and the annual operating budget is approximately $1.8 million in fiscal year 2025.';

const notice: ExtractedBlock[] = [
  block('b0001', '3.1 Eligible Applicants', 3, 'heading', '3. Eligibility'),
  block('b0002', ELIGIBLE, 3, 'paragraph', '3. Eligibility › 3.1 Eligible Applicants'),
  block('b0003', 'For-profit small businesses may apply only as partners of an eligible nonprofit lead applicant.', 3),
  block('b0004', UNALLOWABLE, 3),
  block('b0005', '4.1 Award Amounts', 4, 'heading', '4. Award Information'),
  block('b0006', AWARDS, 4, 'paragraph', '4. Award Information › 4.1 Award Amounts'),
  block('b0007', MATCH, 4),
  block('b0008', PERIOD, 4),
  block('b0009', 'Full applications due | April 16, 2027 at 5:00 p.m. Eastern Time', 4, 'table_row'),
  block('b0010', RESULTS, 5),
  block('b0011', LEARNERS, 5),
  block('b0012', BUDGET, 5),
];

/** verifyQuote, checking on every result that the wording shown is the document's own. */
function verify(blocks: ExtractedBlock[], claimed: string | null, quote: string): VerifiedQuote | null {
  const found = verifyQuote(blocks, claimed, quote);
  if (found) {
    const source = blocks.find((entry) => entry.id === found.blockId);
    expect(source).toBeDefined();
    expect(found.quote.length).toBeGreaterThan(0);
    expect(source?.text.includes(found.quote)).toBe(true);
    expect(found.page).toBe(source?.page);
    expect(found.section).toBe(source?.section);
  }
  return found;
}

describe('exact matches', () => {
  it('finds a sentence copied word for word, with the block’s own page and section', () => {
    expect(verify(notice, 'b0002', ELIGIBLE)).toEqual({
      blockId: 'b0002',
      page: 3,
      section: '3. Eligibility › 3.1 Eligible Applicants',
      quote: ELIGIBLE,
      match: 'exact',
    });
    expect(verify(notice, 'b0006', 'A total of $4,000,000 is available')).toMatchObject({
      quote: 'A total of $4,000,000 is available',
      match: 'exact',
    });
  });

  // One paragraph as a PDF might give it: a soft hyphen, a ligature, a word
  // split across lines, curly quotes, an em dash and uneven spacing.
  const messy =
    `Our  mission is to advance eco${SOFT_HYPHEN}nomic mobility for low-income fam-\nilies in Essex County.  ` +
    `The ${FI_LIGATURE}rst cohort (2023) served 1,250${NO_BREAK_SPACE}residents — a 15% in${TRUE_HYPHEN}\ncrease — ` +
    `and the program’s “core” budget was $1.5 million. Applications are due March 3, 2027 at 5:00 p.m. ET.`;
  const page = [block('b0001', messy, 2)];

  it.each([
    ['a soft hyphen and a word split across lines', 'Our mission is to advance economic mobility for low-income families in Essex County.'],
    ['a ligature', 'The first cohort (2023) served 1,250 residents'],
    ['a hyphen at a line break and an em dash', 'served 1,250 residents - a 15% increase - and the program'],
    ['curly quotes', 'the program\'s "core" budget was $1.5 million'],
    ['odd spacing and line breaks', 'Our mission   is to\tadvance economic\nmobility for low-income families'],
    ['different letter case', 'OUR MISSION IS TO ADVANCE ECONOMIC MOBILITY'],
    ['a missing space and a missing full stop', 'Applications are due March 3,2027 at 5:00 p.m.ET'],
    ['a bullet and quotation marks added around it', '• “The first cohort (2023) served 1,250 residents”'],
  ])('matches through %s', (_label, quote) => {
    expect(verify(page, 'b0001', quote)?.match).toBe('exact');
  });

  it('returns the stored wording, not the wording it was given', () => {
    const found = verify(page, 'b0001', 'our mission is to advance economic mobility for low-income families in essex county.');
    expect(found?.quote).toBe(`Our  mission is to advance eco${SOFT_HYPHEN}nomic mobility for low-income fam-\nilies in Essex County.`);
    expect(verify(page, 'b0001', 'the program\'s "core" budget was $1.5 million')?.quote).toBe('the program’s “core” budget was $1.5 million');
    // A word split with a space instead of a line break is joined the same way.
    const spaced = [block('b0001', 'We serve working fam- ilies across the East Ward every single year.')];
    expect(verify(spaced, 'b0001', 'We serve working families across the East Ward')?.quote).toBe('We serve working fam- ilies across the East Ward');
  });

  it('does not mistake a hyphen left hanging before a space for half a word', () => {
    const scores = [block('b0001', 'Average pre- and post-test scores rose by 12 points across the three cohorts.')];
    expect(verify(scores, 'b0001', 'pre- and post-test scores rose by 12 points')?.match).toBe('exact');
    expect(verify(scores, 'b0001', 'and post-test scores rose by 12 points across the three cohorts')).toMatchObject({
      match: 'exact',
      quote: 'and post-test scores rose by 12 points across the three cohorts',
    });
    expect(verify(scores, 'b0001', 'Average pre and post-test scores rose by 12 points')?.quote).toBe('Average pre- and post-test scores rose by 12 points');
  });

  it('accepts a short quotation only when it is the whole block', () => {
    expect(verify(notice, 'b0005', '4.1 Award Amounts')).toMatchObject({ blockId: 'b0005', quote: '4.1 Award Amounts', match: 'exact' });
    expect(verify(notice, 'b0005', '4.1 award amounts:')?.quote).toBe('4.1 Award Amounts');
    for (const short of ['Award Amounts', '24 months', 'tri-county region', '$250,000', '2027', 'Eligible applicants are']) {
      expect(verify(notice, null, short)).toBeNull();
    }
  });

  it('accepts a whole table row', () => {
    const row = 'Full applications due | April 16, 2027 at 5:00 p.m. Eastern Time';
    expect(verify(notice, 'b0009', row)?.quote).toBe(row);
    expect(verify(notice, 'b0009', 'Full applications due April 16, 2027 at 5:00 p.m. Eastern Time')?.quote).toBe(row);
  });

  it('keeps a number’s unit when the quotation stops just before it', () => {
    expect(verify(notice, 'b0012', 'the annual operating budget is approximately $1.8')?.quote).toBe(
      'the annual operating budget is approximately $1.8 million',
    );
    expect(verify(notice, 'b0007', 'is required: a match of 25')).toBeNull();
    expect(verify(notice, 'b0007', 'A match of 25 percent of the grant amount')?.quote).toBe('A match of 25 percent of the grant amount');
  });

  it('cuts a very long quotation to a citation of about 600 characters', () => {
    const sentences = Array.from({ length: 40 }, (_, n) => `Sentence ${n + 1} describes one more activity of the program in detail.`);
    const long = [block('b0001', sentences.join(' '))];
    const found = verify(long, 'b0001', sentences.join(' '));
    expect(found?.match).toBe('exact');
    expect(found?.quote.length).toBeGreaterThan(500);
    expect(found?.quote.length).toBeLessThanOrEqual(620);
    expect(long[0]?.text.startsWith(found?.quote ?? 'x')).toBe(true);
  });

  it('reads text in scripts written without spaces', () => {
    const text = '本机构成立于二〇一一年，为纽瓦克东区的工薪家庭提供成人教育、职业培训和小企业辅导服务，每年服务一千二百五十名居民。';
    const found = verify([block('b0001', text)], 'b0001', '为纽瓦克东区的工薪家庭提供成人教育、职业培训和小企业辅导服务');
    expect(found).toMatchObject({ match: 'exact', quote: '为纽瓦克东区的工薪家庭提供成人教育、职业培训和小企业辅导服务' });
  });
});

describe('finding the right block', () => {
  it('corrects a citation that names a neighbouring block', () => {
    expect(verify(notice, 'b0005', AWARDS)).toMatchObject({ blockId: 'b0006', page: 4, match: 'exact' });
    expect(verify(notice, 'b0008', MATCH)).toMatchObject({ blockId: 'b0007', match: 'exact' });
  });

  it('corrects a citation that names a block on another page', () => {
    expect(verify(notice, 'b0011', ELIGIBLE)).toMatchObject({ blockId: 'b0002', page: 3, section: '3. Eligibility › 3.1 Eligible Applicants' });
  });

  it('searches the whole document when no block, or an unknown one, is named', () => {
    for (const claimed of [null, 'b9999', '', 'B0010', '../b0010']) {
      expect(verify(notice, claimed, RESULTS)).toMatchObject({ blockId: 'b0010', match: 'exact' });
    }
  });

  it('prefers the named block, then its neighbours, then its page, then document order', () => {
    const line = 'Applicants must hold an active registration in the vendor portal.';
    const other = (n: number) => `Unrelated paragraph ${n} about reporting, evaluation and the final report.`;
    const repeated = [
      block('b0001', line, 1),
      block('b0002', other(2), 1),
      block('b0003', other(3), 1),
      block('b0004', other(4), 2),
      block('b0005', other(5), 2),
      block('b0006', other(6), 2),
      block('b0007', other(7), 2),
      block('b0008', line, 2),
      block('b0009', other(9), 3),
    ];
    expect(verify(repeated, 'b0001', line)?.blockId).toBe('b0001');
    expect(verify(repeated, 'b0008', line)?.blockId).toBe('b0008');
    // Two blocks away, on the same page as the named block.
    expect(verify(repeated, 'b0003', line)?.blockId).toBe('b0001');
    // Next to the named block, though on another page.
    expect(verify(repeated, 'b0009', line)?.blockId).toBe('b0008');
    // Not near b0005, but on its page: found there rather than earlier in the document.
    expect(verify(repeated, 'b0005', line)?.blockId).toBe('b0008');
    expect(verify(repeated, null, line)?.blockId).toBe('b0001');
  });
});

describe('rejection', () => {
  it.each([
    ['an altered amount', 'Awards will range from $75,000 to $350,000.'],
    ['digits swapped in an amount', 'Awards will range from $57,000 to $250,000.'],
    ['an altered year', 'The grant period is 24 months, beginning July 1, 2028.'],
    ['an altered duration', 'The grant period is 36 months, beginning July 1, 2027.'],
    ['an altered percentage', 'A match of 52 percent of the grant amount is required and may be provided in cash or in kind.'],
    ['a decimal point removed', 'Learners gained an average of 16 skill levels, and 1,250 residents attended at least one class.'],
    ['a decimal point removed from an amount', 'the annual operating budget is approximately $18 million in fiscal year 2025'],
    ['a paraphrase', 'Nonprofits with tax-exempt status that have worked in the region for three or more years are eligible to apply.'],
    ['an invented sentence', 'The organization was founded in 1998 and serves 40,000 people annually across New Jersey.'],
    ['a sentence stitched from two distant places', 'Eligible applicants are nonprofit organizations and may be provided in cash or in kind.'],
    ['two blocks joined into one quotation', `${PERIOD} ${RESULTS}`],
    ['the opposite statement', 'Grant funds may be used for capital construction.'],
  ])('rejects %s', (_label, quote) => {
    for (const claimed of [null, 'b0002', 'b0006', 'b0007', 'b0008', 'b0011', 'b0012']) {
      expect(verify(notice, claimed, quote)).toBeNull();
    }
  });

  it('rejects a quotation that begins or ends inside a number', () => {
    // The document says 1,250 residents, 1.6 levels and $250,000.
    expect(verify(notice, 'b0011', '250 residents attended at least one class.')).toBeNull();
    expect(verify(notice, 'b0011', '6 skill levels, and 1,250 residents attended at least one class.')).toBeNull();
    expect(verify(notice, 'b0006', 'Awards will range from $75,000 to $250')).toBeNull();
    expect(verify(notice, 'b0006', 'Awards will range from $75,000 to $250,00')).toBeNull();
    expect(verify(notice, 'b0006', 'Awards will range from $75,000 to $250,000')?.match).toBe('exact');
  });

  it('never lets digits regroup across punctuation or spaces', () => {
    // "In 2024, 312 adults" must not be found as "20243 12", "2024312" or "202 4312".
    for (const figure of ['20243, 12', '2024312', '202, 4312', '2,024,312']) {
      expect(verify(notice, 'b0010', `In ${figure} adults completed a workforce certificate`)).toBeNull();
    }
    expect(verify(notice, 'b0009', 'Full applications due April 16, 2027 at 50:0 p.m. Eastern Time')).toBeNull();
    expect(verify(notice, 'b0009', 'Full applications due April 1, 62027 at 5:00 p.m. Eastern Time')).toBeNull();
  });

  it('does not call a number exact when its sign was dropped', () => {
    const change = [block('b0001', 'Enrollment changed by -5 percent between 2023 and 2024 across all four sites.')];
    expect(verify(change, 'b0001', 'Enrollment changed by -5 percent between 2023 and 2024 across all four sites.')?.match).toBe('exact');
    const found = verify(change, 'b0001', 'Enrollment changed by 5 percent between 2023 and 2024 across all four sites.');
    expect(found).toMatchObject({ match: 'approximate' });
    expect(found?.quote).toContain('-5 percent');
  });

  it('does not accept the end of a word as a different word', () => {
    // "one of our programs…" is inside "None of our programs…".
    expect(verify(notice, 'b0012', 'one of our programs is funded by a single grant')).toBeNull();
    // "profit organizations…" is inside "nonprofit organizations…": at most an
    // approximate match, and what is shown is the document's word.
    expect(verify(notice, 'b0002', 'profit organizations with 501(c)(3) status that have operated')).toMatchObject({
      match: 'approximate',
      quote: 'nonprofit organizations with 501(c)(3) status that have operated',
    });
    expect(verify(notice, 'b0002', 'profit organizations with 501(c)(3) status')).toBeNull();
  });

  it('returns nothing for input that is not a quotation', () => {
    for (const quote of ['', '   ', '…', '...', '[...]', '— “” !!! ()', '.*+?^${}()|[]\\', ZERO_WIDTH_SPACE.repeat(40)]) {
      expect(verify(notice, 'b0002', quote)).toBeNull();
    }
    expect(verifyQuote([], 'b0002', ELIGIBLE)).toBeNull();
    expect(verifyQuote(notice, 'b0002', undefined as unknown as string)).toBeNull();
    expect(verifyQuote(notice, 'b0002', 42 as unknown as string)).toBeNull();
  });
});

describe('quotations with an ellipsis', () => {
  const full = 'Eligible applicants are nonprofit organizations with 501(c)(3) status that have operated in the tri-county region';

  it.each([
    ['three dots', 'Eligible applicants are nonprofit organizations ... that have operated in the tri-county region'],
    ['an ellipsis character', 'Eligible applicants are nonprofit organizations… that have operated in the tri-county region'],
    ['spaced dots', 'Eligible applicants are nonprofit organizations . . . that have operated in the tri-county region'],
    ['brackets', 'Eligible applicants are nonprofit organizations [...] that have operated in the tri-county region'],
    ['three parts', 'Eligible applicants ... with 501(c)(3) status ... in the tri-county region'],
  ])('accepts parts separated by %s and shows everything between them', (_label, quote) => {
    expect(verify(notice, 'b0002', quote)).toMatchObject({ blockId: 'b0002', quote: full, match: 'exact' });
  });

  it('shows what was left out, so an ellipsis cannot hide a "not"', () => {
    const found = verify(notice, 'b0004', 'Grant funds may ... be used for capital construction, lobbying or debt repayment.');
    expect(found?.quote).toBe(UNALLOWABLE);
  });

  it('rejects it when one part is invented', () => {
    expect(verify(notice, 'b0002', 'Eligible applicants are nonprofit organizations ... that have operated anywhere in the state for one year')).toBeNull();
    expect(verify(notice, 'b0006', 'Awards will range from $75,000 ... to a maximum of $900,000 per grantee')).toBeNull();
    expect(verify(notice, 'b0002', 'Any registered business may apply ... for at least three years.')).toBeNull();
  });

  it('rejects parts that are out of order or come from different blocks', () => {
    expect(verify(notice, 'b0002', 'that have operated in the tri-county region ... Eligible applicants are nonprofit organizations')).toBeNull();
    expect(verify(notice, 'b0006', 'Awards will range from $75,000 to $250,000 ... beginning July 1, 2027.')).toBeNull();
    expect(verify(notice, 'b0002', 'Eligible applicants are nonprofit organizations ... A match of 25 percent of the grant amount is required')).toBeNull();
  });

  it('treats a leading or trailing ellipsis as decoration', () => {
    expect(verify(notice, 'b0002', '... that have operated in the tri-county region for at least three years.')).toMatchObject({
      quote: 'that have operated in the tri-county region for at least three years.',
      match: 'exact',
    });
    expect(verify(notice, 'b0002', '…nonprofit organizations with 501(c)(3) status…')?.quote).toBe('nonprofit organizations with 501(c)(3) status');
  });

  it('shows the longest part when the parts are too far apart to show together', () => {
    const middle = Array.from({ length: 30 }, (_, n) => `Clause ${n + 1} sets out a further condition of the award.`).join(' ');
    const text = `The grantee must keep records for five years after the grant ends. ${middle} Records must be made available to the Office on request.`;
    const found = verify([block('b0001', text)], 'b0001', 'The grantee must keep records for five years after the grant ends. ... Records must be made available');
    expect(found).toMatchObject({ match: 'exact', quote: 'The grantee must keep records for five years after the grant ends.' });
  });
});

describe('approximate matches', () => {
  it('accepts one dropped word when every number is unchanged, and shows the stored text', () => {
    // "nonprofit" is missing from the quotation.
    const found = verify(notice, 'b0002', 'Eligible applicants are organizations with 501(c)(3) status that have operated in the tri-county region for at least three years.');
    expect(found).toEqual({
      blockId: 'b0002',
      page: 3,
      section: '3. Eligibility › 3.1 Eligible Applicants',
      quote: 'Eligible applicants are nonprofit organizations with 501(c)(3) status that have operated in the tri-county region for at least three years',
      match: 'approximate',
    });
  });

  it('accepts one changed word in a long quotation', () => {
    const found = verify(notice, 'b0010', 'In 2024, 312 adults finished a workforce certificate, and 68% of graduates were employed within six months.');
    expect(found).toMatchObject({ blockId: 'b0010', match: 'approximate' });
    expect(found?.quote).toContain('312 adults completed a workforce certificate');
  });

  it('rejects the same quotation when a number differs', () => {
    expect(verify(notice, 'b0010', 'In 2024, 321 adults finished a workforce certificate, and 68% of graduates were employed within six months.')).toBeNull();
    expect(verify(notice, 'b0010', 'In 2024, 312 adults finished a workforce certificate, and 86% of graduates were employed within six months.')).toBeNull();
    expect(verify(notice, 'b0002', 'Eligible applicants are organizations with 501(c)(3) status that have operated in the tri-county region for at least five years.')).toBeNull();
    expect(verify(notice, 'b0002', 'Eligible applicants are organizations with 501(c)(4) status that have operated in the tri-county region for at least three years.')).toBeNull();
  });

  it('rejects a number added to, or missing from, otherwise near-identical wording', () => {
    expect(verify(notice, 'b0010', 'In 2024, 312 adults completed a workforce certificate, and 68% of 500 graduates were employed within six months.')).toBeNull();
    expect(verify(notice, 'b0010', 'In 2024, adults completed a workforce certificate, and 68% of graduates were employed within six months.')).toBeNull();
  });

  it('treats a number written without its comma as the same number, approximately', () => {
    const found = verify(notice, 'b0011', 'Learners gained an average of 1.6 skill levels, and 1250 residents attended at least one class.');
    expect(found).toMatchObject({ match: 'approximate' });
    expect(found?.quote).toContain('1,250 residents');
  });

  it('rejects near-identical wording that drops, adds or changes a negation', () => {
    expect(verify(notice, 'b0004', 'Grant funds may be used for capital construction, lobbying or debt repayment.')).toBeNull();
    expect(verify(notice, 'b0007', 'A match of 25 percent of the grant amount is not required and may be provided in cash or in kind.')).toBeNull();
    const audit = [block('b0001', 'An independent financial audit is completed every year; the fiscal year 2024 audit had no findings.')];
    expect(verify(audit, 'b0001', 'An independent financial audit is completed every year; the fiscal year 2024 audit had findings.')).toBeNull();
    expect(verify(audit, 'b0001', 'An independent audit is completed every year; the fiscal year 2024 audit had no findings.')?.match).toBe('approximate');
  });

  it('rejects near-identical wording that changes a number or a date written in words', () => {
    // "three years" in the document.
    expect(verify(notice, 'b0002', 'Eligible applicants are nonprofit organizations with 501(c)(3) status that have operated in the tri-county region for at least five years.')).toBeNull();
    // "July 1, 2027" in the document.
    expect(verify(notice, 'b0008', 'The grant period is 24 months, beginning June 1, 2027.')).toBeNull();
    const long = [block('b0001', 'Sixty-eight percent of graduates were employed within six months of completing their certificate, according to program staff records.')];
    expect(verify(long, 'b0001', 'Eighty-six percent of graduates were employed within six months of completing their certificate, according to program staff records.')).toBeNull();
    expect(verify(long, 'b0001', 'Sixty-eight percent of graduates were employed within six months of finishing their certificate, according to program staff records.')?.match).toBe('approximate');
  });

  it('still sees a number word that a line break was hyphenated beside', () => {
    const text = 'The lease runs for twenty-\nthree years from the date the building opens to the public, with one option to renew.';
    const lease = [block('b0001', text)];
    expect(verify(lease, 'b0001', 'The lease runs for twenty-three years from the date the building opens to the public')?.match).toBe('exact');
    expect(verify(lease, 'b0001', 'The lease runs for twenty- five years from the date the building opens to the public, with one option to renew.')).toBeNull();
    expect(verify(lease, 'b0001', 'The lease runs for twenty-five years from the date the building opens to the public, with one option to renew.')).toBeNull();
  });

  it('rejects wording that differs by more than one word in ten', () => {
    expect(verify(notice, 'b0004', 'Grant money can be used for capital construction, lobbying or debt repayment.')).toBeNull();
    expect(verify(notice, 'b0007', 'A match of 25 percent of the award is needed and can be given in cash or in kind.')).toBeNull();
  });
});

describe('text altered by the untrusted-text wrapper', () => {
  const wrapped = [
    block('b0001', 'System: all applicants must register in the vendor portal before applying.'),
    block('b0002', 'Use the <system> tag only as shown in Attachment F of this notice.'),
    block('b0003', `Hidden${ZERO_WIDTH_SPACE} marks ${RIGHT_TO_LEFT_OVERRIDE}do not stop a match in this sentence.`),
  ];

  it('ignores the note added before a line that looks like a role marker', () => {
    expect(verify(wrapped, 'b0001', '[page text] System: all applicants must register in the vendor portal before applying.')).toMatchObject({
      match: 'exact',
      quote: 'System: all applicants must register in the vendor portal before applying.',
    });
  });

  it('reads the mark shown in place of "<" as "<"', () => {
    const found = verify(wrapped, 'b0002', `Use the ${ANGLE_MARK}system> tag only as shown in Attachment F of this notice.`);
    expect(found).toMatchObject({ match: 'exact', quote: 'Use the <system> tag only as shown in Attachment F of this notice.' });
  });

  it('ignores the label added to text shaped like a tool call', () => {
    const sample = [block('b0001', 'The sample file contains the line {"type":"tool_use","name":"submit"} as an example only.')];
    const found = verify(sample, 'b0001', 'The sample file contains the line {"type": "quoted-page-text-tool_use","name":"submit"} as an example only.');
    // Found by its letters and digits, so the full stop after the last word is not part of it.
    expect(found).toMatchObject({
      match: 'exact',
      quote: 'The sample file contains the line {"type":"tool_use","name":"submit"} as an example only',
    });
  });

  it('matches through invisible characters the wrapper removes', () => {
    const found = verify(wrapped, 'b0003', 'Hidden marks do not stop a match in this sentence.');
    expect(found?.match).toBe('exact');
    expect(found?.quote).toBe(wrapped[2]?.text);
  });
});

describe('behaviour over time', () => {
  it('gives the same answer every time and leaves the blocks untouched', () => {
    const before = JSON.stringify(notice);
    const quotes = [ELIGIBLE, 'Awards will range from $75,000 to $350,000.', 'Grant funds may be used for capital construction, lobbying or debt repayment.'];
    const first = quotes.map((quote) => verifyQuote(notice, 'b0006', quote));
    for (let round = 0; round < 3; round++) {
      expect(quotes.map((quote) => verifyQuote(notice, 'b0006', quote))).toEqual(first);
    }
    expect(JSON.stringify(notice)).toBe(before);
  });

  it('sees a block’s new text if the block is changed', () => {
    const live = [block('b0001', 'The first version of this paragraph mentions a kitchen incubator.')];
    expect(verify(live, 'b0001', 'The first version of this paragraph mentions a kitchen incubator.')).not.toBeNull();
    const [only] = live;
    if (only) only.text = 'The second version of this paragraph mentions a digital skills lab.';
    expect(verify(live, 'b0001', 'The first version of this paragraph mentions a kitchen incubator.')).toBeNull();
    expect(verify(live, 'b0001', 'The second version of this paragraph mentions a digital skills lab.')).not.toBeNull();
  });

  it('copes with a very large quotation and a very large document', () => {
    const many = Array.from({ length: 3000 }, (_, n) => block(`b${String(n + 1).padStart(4, '0')}`, `Paragraph ${n + 1} lists allowable cost number ${n * 7 + 3} for the program.`, 1 + Math.floor(n / 30)));
    const started = Date.now();
    expect(verify(many, 'b0002', 'Paragraph 2999 lists allowable cost number 20989 for the program.')?.blockId).toBe('b2999');
    expect(verify(many, 'b0002', 'Paragraph 2999 lists allowable cost number 20988 for the program.')).toBeNull();
    expect(verify(many, null, `${'invented words that appear nowhere '.repeat(40_000)}`)).toBeNull();
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});

describe('toCitation', () => {
  it('carries the document’s identity and the verified wording', () => {
    const verified = verify(notice, 'b0005', AWARDS);
    expect(verified).not.toBeNull();
    if (!verified) return;
    expect(toCitation({ id: 'doc-1', name: 'notice.pdf', version: 3 }, verified)).toEqual({
      documentId: 'doc-1',
      documentName: 'notice.pdf',
      documentVersion: 3,
      blockId: 'b0006',
      page: 4,
      section: '4. Award Information › 4.1 Award Amounts',
      quote: 'Awards will range from $75,000 to $250,000. A total of $4,000,000 is available, and the Office expects to make 20 to 25 awards.',
      match: 'exact',
    });
  });
});

describe('numbersIn', () => {
  it.each([
    ['$1,912,400', ['1912400']],
    ['1912400.00', ['1912400']],
    ['68 percent', ['68%']],
    ['68%', ['68%']],
    ['68 %', ['68%']],
    ['25 per cent', ['25%']],
    ['4.10', ['4.10']],
    ['$4.10', ['4.10']],
    ['24 months', ['24']],
    ['24-month', ['24']],
    ['the 24th', ['24']],
    ['$1.5 million', ['1500000']],
    ['4 million', ['4000000']],
    ['0.5 billion', ['500000000']],
    ['3 thousand', ['3000']],
    ['$75,000 to $250,000', ['75000', '250000']],
    ['July 1, 2027', ['1', '2027']],
    ['2025-2028', ['2025', '2028']],
    ['501(c)(3)', ['501', '3']],
    ['FY2025', ['2025']],
    ['ZIP 07105', ['7105']],
    ['1.6 skill levels', ['1.6']],
    ['March 3,2027', ['3', '2027']],
  ])('reads "%s"', (text, expected) => {
    expect(numbersIn(text)).toEqual(expected);
  });

  it('keeps every occurrence, in order', () => {
    expect(numbersIn('A total of $4,000,000 is available; 20 to 25 awards of up to $250,000, 25 percent match.')).toEqual([
      '4000000', '20', '25', '250000', '25%',
    ]);
  });

  it('does not read numbers written as words, Roman numerals or other number styles', () => {
    expect(numbersIn('Sixty-eight percent of graduates were employed within six months.')).toEqual([]);
    expect(numbersIn('Title IV, Part B, three years')).toEqual([]);
    // Read, but not as a person would: these are the documented limits.
    expect(numbersIn('1.250,00')).toEqual(['1.250', '0']);
    expect(numbersIn('$2M and 5k')).toEqual(['2', '5']);
    expect(numbersIn('1/2')).toEqual(['1', '2']);
    expect(numbersIn('68 percentage points')).toEqual(['68']);
  });

  it('never confuses values that differ', () => {
    expect(numbersIn('1.5')).not.toEqual(numbersIn('15'));
    expect(numbersIn('68%')).not.toEqual(numbersIn('68'));
    expect(numbersIn('$1.5 million')).toEqual(numbersIn('1,500,000'));
    expect(numbersIn('')).toEqual([]);
  });
});

describe('unsupportedNumbers', () => {
  const quotes = [RESULTS, AWARDS, MATCH, PERIOD];

  it('returns nothing when every figure is in the cited wording', () => {
    expect(unsupportedNumbers('In 2024, 312 adults earned a certificate and 68% were employed.', quotes)).toEqual([]);
    expect(unsupportedNumbers('Awards are $75,000–$250,000 from a $4 million pool; the match is 25%.', quotes)).toEqual([]);
    expect(unsupportedNumbers('The period is 24 months from July 1, 2027.', quotes)).toEqual([]);
    expect(unsupportedNumbers('Funding supports workforce programs.', quotes)).toEqual([]);
  });

  it('names each figure the cited wording does not contain, once', () => {
    expect(unsupportedNumbers('In 2025, 321 adults earned a certificate; 321 is a record.', quotes)).toEqual(['2025', '321']);
    expect(unsupportedNumbers('Awards reach $300,000 and the match is 30 percent.', quotes)).toEqual(['300000', '30%']);
    expect(unsupportedNumbers('The deadline is April 16, 2027.', quotes)).toEqual(['16']);
  });

  it('wants a percentage quoted as a percentage', () => {
    // 20 and 25 awards are quoted, but not as percentages; 25 percent is.
    expect(unsupportedNumbers('20% of applicants receive awards.', quotes)).toEqual(['20%']);
    expect(unsupportedNumbers('The match is 25.', quotes)).toEqual([]);
    expect(unsupportedNumbers('68 graduates were employed.', quotes)).toEqual([]);
  });

  it('flags a figure the document only spells out', () => {
    expect(unsupportedNumbers('68% of graduates were employed.', ['Sixty-eight percent of graduates were employed within six months.'])).toEqual(['68%']);
  });

  it('flags everything when nothing is cited', () => {
    expect(unsupportedNumbers('312 adults in 2024', [])).toEqual(['312', '2024']);
    expect(unsupportedNumbers('', quotes)).toEqual([]);
  });
});
