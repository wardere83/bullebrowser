// The product's fixed wording.
//
// BulleBrowser writes "CBOs" (singular "CBO") and never the words behind the
// acronym. The system prompt asks every cloud engine for that, but a prompt is
// a request, not a guarantee, and the keyless assistant has no prompt at all.
// So everything the agent loop emits or returns also passes through
// applyTerminology, and any other code that shows text written by a model
// should pass it through as well.
//
// The long form is assembled from separate words, here and in the tests, so it
// is written nowhere in this package.

/** Added to the system prompt for every cloud engine. */
export const TERMINOLOGY_INSTRUCTIONS = [
  'Terminology: write "CBOs" (singular "CBO") and never write out the words the',
  'acronym stands for: not on first use, not in headings, and not when the user',
  'or a source spells it out. When you name who BulleBrowser serves, say',
  '"businesses and CBOs".',
].join('\n');

/**
 * The funding screens, by the names the workspace navigation shows. The
 * keyless assistant points people to them, so the two must read the same.
 */
export const FUNDING_SCREENS = {
  knowledgeHub: 'Organization Knowledge Hub',
  opportunities: 'Opportunities',
  rfpAnalysis: 'RFP Analysis',
  proposalGuide: 'Proposal Guide',
} as const;

// One word per line, so a search for the phrase finds nothing here either.
const LONG_FORM_WORDS = [
  'community',
  'based',
  'organi[sz]ation',
] as const;

// A space or tab, but not a line break.
const SPACE = '[^\\S\\r\\n]';
// Spaces between two words, or the single line break where a sentence wraps.
const GAP = `(?:${SPACE}+(?:\\r?\\n${SPACE}*)?|\\r?\\n${SPACE}*)`;
// The hyphen is optional and may be any dash, including one at a line end.
const HYPHEN = `${SPACE}*[\\p{Pd}\\u2212]${SPACE}*(?:\\r?\\n${SPACE}*)?`;
const NOT_IN_A_WORD_BEFORE = '(?<![\\p{L}\\p{N}_])';
const NOT_IN_A_WORD_AFTER = '(?![\\p{L}\\p{N}_])';

// Captures the plural "s". "organizational" and "organizing" do not match.
const LONG_FORM =
  NOT_IN_A_WORD_BEFORE +
  `${LONG_FORM_WORDS[0]}(?:${HYPHEN}|${GAP})${LONG_FORM_WORDS[1]}${GAP}${LONG_FORM_WORDS[2]}(s?)` +
  NOT_IN_A_WORD_AFTER;
const SHORT_FORM = `${NOT_IN_A_WORD_BEFORE}cbo(s?)${NOT_IN_A_WORD_AFTER}`;

// Quotation marks or emphasis around the term inside brackets: (“CBOs”), (**CBOs**).
const WRAP = '["\'“”‘’*_]*';
const OPEN = `(?:${GAP})?[(\\[]${SPACE}*`;
const CLOSE = `${SPACE}*[)\\]]`;
// Words that only introduce a name. A bracket holding anything else, such as
// "(especially small CBOs)", says something of its own and is left in place.
const NAMING = `(?:(?:or|aka|a\\.k\\.a\\.?|i\\.e\\.,?|also|known|called|referred|to|as|abbreviated|hereafter|hereinafter|collectively|simply|the)${SPACE}+)*`;
const EXPLAINING = `(?:(?:which|that|is|are|short|stands?|standing|for|meaning|means|i\\.e\\.,?|or|an?|the|abbreviation|acronym|of)${SPACE}+)*`;

// "<long form> (CBOs)"
const LONG_THEN_SHORT = new RegExp(
  `${LONG_FORM}${OPEN}${NAMING}${WRAP}cbo(?:s|'s)?${WRAP}(?:${SPACE}+for${SPACE}+short)?${CLOSE}`,
  'giu',
);
// "CBOs (<long form>)"
const SHORT_THEN_LONG = new RegExp(`${SHORT_FORM}${OPEN}${EXPLAINING}${WRAP}${LONG_FORM}${WRAP}${CLOSE}`, 'giu');
// "<long form>, or CBOs,"
const LONG_OR_SHORT = new RegExp(
  `${LONG_FORM}(,?)${GAP}(?:or|aka|also${GAP}(?:known${GAP}as|called))${GAP}cbos?${NOT_IN_A_WORD_AFTER}(,?)`,
  'giu',
);
const LONG_ALONE = new RegExp(LONG_FORM, 'giu');

// Text that must come through exactly as written: code, links and addresses.
// One capturing group, so split() returns prose and protected text in turn.
// An address is only looked for at the start of a run of its characters, and
// its first part is bounded: otherwise a long unbroken token, such as a hash,
// is rescanned from every position in it.
const PROTECTED =
  /(```[\s\S]*?(?:```|$)|`[^`\n]*`|(?:https?:\/\/|www\.)[^\s<>"'`]+|(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]{1,64}@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+)/iu;

const acronym = (plural: string): string => (plural ? 'CBOs' : 'CBO');

function rewriteProse(prose: string): string {
  return prose
    .replace(LONG_THEN_SHORT, (_match, plural: string) => acronym(plural))
    .replace(SHORT_THEN_LONG, (_match, plural: string) => acronym(plural))
    // Keeps the comma that belongs to the sentence and drops the pair around the name.
    .replace(LONG_OR_SHORT, (_match, plural: string, before: string, after: string) =>
      acronym(plural) + (before ? '' : after),
    )
    .replace(LONG_ALONE, (_match, plural: string) => acronym(plural));
}

function rewrite(text: string): string {
  return text
    .split(PROTECTED)
    .map((part, index) => (index % 2 === 1 ? part : rewriteProse(part)))
    .join('');
}

/**
 * Rewrites the spelled-out forms of the acronym to "CBO" / "CBOs": hyphenated
 * or not, singular or plural, in any capitalization, and "<long form> (CBOs)"
 * or "CBOs (<long form>)" becomes the acronym alone. URLs, e-mail addresses
 * and code are left exactly as written. Applying it twice changes nothing more.
 */
export function applyTerminology(text: string): string {
  // Joining a phrase that wrapped across lines can change which backticks pair
  // up as code, so one pass is not always the last. Each pass that changes
  // anything removes at least one long form, so this ends.
  let current = text;
  for (;;) {
    const next = rewrite(current);
    if (next === current) return current;
    current = next;
  }
}
