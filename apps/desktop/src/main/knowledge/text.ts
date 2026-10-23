// Turning text into search terms. Everything that searches an organization's
// knowledge uses the same terms, so a document and a query always agree on what
// a word is.
//
// A term is a lower-cased word or a number:
//  - Text is read in NFKC form with invisible characters removed, so ligatures,
//    full-width letters and soft hyphens do not hide a word. A word split by a
//    hyphen at the end of a line is read as one word.
//  - A number keeps its value however it was typed: grouping commas, a leading
//    currency sign, a trailing percent sign, leading zeros and an all-zero
//    fraction are dropped ("$1,912,400.00" is "1912400"). Any other fraction is
//    kept as written ("4.10" stays "4.10"). Only English formatting is read.
//  - Letters and digits that touch are separate terms ("FY2025" is "fy" and
//    "2025"), and an ordinal ending is dropped ("24th" is "24").
//  - Common English function words are removed, then the word is stemmed.
//  - Terms shorter than two characters are dropped, so single digits are too.
//
// Because case is folded, "May" and "US" read as the function words "may" and
// "us". Text with no spaces between words, such as Chinese, is not split.
//
// The stemmer handles plurals, -ing and -ed, and nothing else. It prefers
// leaving two forms of a word apart to joining two different words:
//  - Plural: "-ies" becomes "-y"; "-sses", "-xes", "-ches" and "-shes" lose
//    "es"; long "-oes" loses "es"; otherwise a final "s" is dropped unless the
//    word ends in "ss", "us" or "is". A few irregular plurals are listed.
//  - "-ed" and "-ing" are removed when a real stem is left (it has a vowel and
//    at least three letters). A doubled final consonant is undone ("planned"
//    is "plan"), "-ied" becomes "-y", and a silent "e" is put back where
//    English spelling requires one ("serving" is "serve", "funded" is "fund").
//    Where spelling cannot tell, the stem is left without it, which keeps two
//    forms apart rather than risk a wrong word.
//  - Words whose ending only looks like a suffix ("news", "evening", "hundred")
//    are never changed, and words ending in "-eed" are left alone ("need").
// It does not touch -er, -ly, -ment, -tion or any other ending.

const STOP_WORDS = new Set(
  `a about above after again against all also am an and any are as at be because been before being below
  between both but by can cannot could did do does doing down during each either else ever few for from
  further had has have having he her here hers herself him himself his how however i if in into is it its
  itself just may me might more most must my myself neither no nor not of off on once only or other our
  ours ourselves out over own per same shall she should so some such than that the their theirs them
  themselves then there therefore these they this those through thus to too under until up upon us very
  via was we were what when where whether which while who whom whose why will with within without would
  yet you your yours yourself yourselves`.split(/\s+/),
);

// Endings that look like a suffix but are part of the word.
const NEVER_STEMMED = new Set(
  `news means goods odds aids series species lens bias atlas canvas alias whereas overseas christmas chaos
  ethos kudos asbestos diabetes always perhaps texas kansas arkansas massachusetts dallas angeles vegas
  orleans evening morning ceiling sibling seedling darling sterling wellbeing ongoing upcoming incoming
  outgoing forthcoming nothing something anything everything hundred watershed sacred kindred hatred naked
  wicked rugged beloved biased embed`.split(/\s+/),
);

// A Map, so that a word such as "constructor" is never mistaken for an entry.
const IRREGULAR_PLURALS = new Map<string, string>([
  ['children', 'child'],
  ['women', 'woman'],
  ['men', 'man'],
  ['analyses', 'analysis'],
  ['crises', 'crisis'],
  ['diagnoses', 'diagnosis'],
  ['focuses', 'focus'],
  ['campuses', 'campus'],
  ['statuses', 'status'],
  ['bonuses', 'bonus'],
  ['viruses', 'virus'],
  ['buses', 'bus'],
  ['goes', 'go'],
  ['criteria', 'criterion'],
  ['curricula', 'curriculum'],
  ['appendices', 'appendix'],
  ['indices', 'index'],
]);

// Stems whose base ends in a silent "e" that the spelling rules cannot see.
const SILENT_E_STEMS = new Set(
  `complet delet compet promot devot invit excit ignit expedit schedul compil reconcil explor restor ignor
  postpon conven interven welcom becom overcom persuad escap guid quot rout abus accus excus refus confus
  wast tast past unit`.split(/\s+/),
);

const CLITICS = new Set(['s', 't', 're', 've', 'll', 'd', 'm']);

const TERM_RE =
  /(\d{1,3}(?:,\d{3})+(?!\d)(?:\.\d+)?|\d+(?:\.\d+)?)|([\p{L}\p{M}]+(?:'[\p{L}\p{M}]+)*)|(\p{N}+)/gu;
// A word split by a hyphen where a line ended: "fam-" then "ilies".
const LINE_BREAK_HYPHEN_RE = /(\p{L})[-\u2010\u2011\u00AD]\s+(?=\p{Ll})/gu;
const ORDINAL_RE = /(?:st|nd|rd|th)(?![\p{L}\p{M}])/uy;

/**
 * A number as one comparable value: no grouping commas, no leading zeros and no
 * all-zero fraction. Other fractions are kept exactly as written.
 */
export function canonicalNumber(raw: string): string {
  const [whole = '', fraction = ''] = raw.replace(/,/g, '').split('.');
  const integer = whole.replace(/^0+(?=\d)/, '') || '0';
  return fraction && /[1-9]/.test(fraction) ? `${integer}.${fraction}` : integer;
}

function isVowel(word: string, index: number): boolean {
  const letter = word[index];
  if (letter === undefined) return false;
  if ('aeiou'.includes(letter)) return true;
  // "y" sounds as a vowel after a consonant ("type", "style").
  return letter === 'y' && index > 0 && !isVowel(word, index - 1);
}

function hasVowel(word: string): boolean {
  for (let index = 0; index < word.length; index++) if (isVowel(word, index)) return true;
  return false;
}

function syllables(word: string): number {
  let count = 0;
  for (let index = 0; index < word.length; index++) {
    if (isVowel(word, index) && !isVowel(word, index - 1)) count += 1;
  }
  return count;
}

/** True when the stem ends consonant, single vowel, `ending` ("provid" with "id"). */
function endsWithSingleVowel(stem: string, ending: string): boolean {
  if (!stem.endsWith(ending)) return false;
  const vowelAt = stem.length - ending.length;
  return isVowel(stem, vowelAt) && !isVowel(stem, vowelAt - 1);
}

function wantsSilentE(stem: string): boolean {
  const length = stem.length;
  const last = stem[length - 1] ?? '';
  const before = stem[length - 2] ?? '';
  const beforeIsVowel = isVowel(stem, length - 2);
  if (SILENT_E_STEMS.has(stem) || stem.endsWith('creat')) return true;
  if (stem === 'bias') return false;

  // English words do not end in these letters, or these pairs, without an "e".
  if (last === 'v' || last === 'u' || last === 'c') return true;
  if (last === 'z' && beforeIsVowel) return true;
  if (last === 'g' && (beforeIsVowel || 'drl'.includes(before) || /(?:ang|eng|ung)$/.test(stem))) return true;
  if (last === 'l' && 'bcdfgkptz'.includes(before)) return true;
  if (last === 's') {
    // "focus" keeps its ending; "house" and "use" do not.
    if (before === 'u' ? length === 2 || isVowel(stem, length - 3) : beforeIsVowel || 'nrlp'.includes(before)) {
      return true;
    }
  }

  // One syllable ending consonant-vowel-consonant: "mak" is "make". A verb
  // without the "e" would have doubled its last letter ("planned").
  const closedSyllable =
    !isVowel(stem, length - 1) && beforeIsVowel && !isVowel(stem, length - 3) && !'wxy'.includes(last);
  if (closedSyllable && syllables(stem) === 1) return true;

  if (last === 'r') return stem.endsWith('quir') || ['ir', 'ur', 'ar'].some((end) => endsWithSingleVowel(stem, end));
  if (last === 't') {
    if (stem.endsWith('at')) return !'aeo'.includes(stem[length - 3] ?? '');
    return endsWithSingleVowel(stem, 'ut');
  }
  if (last === 'd') return ['ad', 'ed', 'id', 'od', 'ud'].some((end) => endsWithSingleVowel(stem, end));
  if (last === 'n') return endsWithSingleVowel(stem, 'in');
  if (last === 'm') return endsWithSingleVowel(stem, 'um');
  if (last === 'k' || last === 'b') return closedSyllable;
  return false;
}

function finishStem(stem: string): string {
  const last = stem[stem.length - 1] ?? '';
  if (last === stem[stem.length - 2] && !isVowel(stem, stem.length - 1)) {
    // "ll", "ss", "ff" and "zz" end real words ("call", "pass", "staff").
    return 'lsfz'.includes(last) || stem.length < 4 ? stem : stem.slice(0, -1);
  }
  return wantsSilentE(stem) ? `${stem}e` : stem;
}

function isRealStem(stem: string): boolean {
  if (stem.length >= 3) return hasVowel(stem);
  // "use", "age": a vowel and one consonant, where the "e" was dropped.
  return stem.length === 2 && isVowel(stem, 0) && !isVowel(stem, 1) && !'wxy'.includes(stem[1] ?? '');
}

function singular(word: string): string {
  const irregular = IRREGULAR_PLURALS.get(word);
  if (irregular) return irregular;
  if (word.length < 4 || !word.endsWith('s')) return word;
  if (word.endsWith('ies')) return word.length > 4 ? `${word.slice(0, -3)}y` : word.slice(0, -1);
  if (/(?:sses|xes|ches|shes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('oes') && word.length > 5) return word.slice(0, -2);
  if (/(?:ss|us|is)$/.test(word)) return word;
  return word.slice(0, -1);
}

function stem(word: string): string {
  // Only words in the Latin alphabet follow these spelling rules.
  if (!/^[a-z]+$/.test(word) || NEVER_STEMMED.has(word)) return word;
  const base = singular(word);
  if (NEVER_STEMMED.has(base)) return base;
  if (base.endsWith('ied') && base.length > 4) return `${base.slice(0, -3)}y`;
  const ending = base.endsWith('ing') ? 'ing' : base.endsWith('ed') && !base.endsWith('eed') ? 'ed' : '';
  if (!ending) return base;
  const cut = base.slice(0, -ending.length);
  return isRealStem(cut) ? finishStem(cut) : base;
}

interface Term {
  /** What is indexed and compared. */
  term: string;
  /** The word as it was written, lower-cased. */
  surface: string;
}

function readTerms(text: string): Term[] {
  const clean = text
    .normalize('NFKC')
    .replace(LINE_BREAK_HYPHEN_RE, '$1')
    .replace(/\p{Cf}/gu, '')
    .replace(/[\u2019\u02BC]/g, "'")
    .toLowerCase();
  const terms: Term[] = [];
  const keep = (term: string, surface: string) => {
    if (term.length >= 2) terms.push({ term, surface });
  };

  TERM_RE.lastIndex = 0;
  for (let match = TERM_RE.exec(clean); match; match = TERM_RE.exec(clean)) {
    if (match[1] !== undefined) {
      const value = canonicalNumber(match[1]);
      keep(value, value);
      ORDINAL_RE.lastIndex = TERM_RE.lastIndex;
      if (ORDINAL_RE.test(clean)) TERM_RE.lastIndex = ORDINAL_RE.lastIndex;
    } else if (match[2] !== undefined) {
      const parts = match[2].split("'");
      // "newark's" is "newark"; "don't" and "we're" are function words.
      const clitic = parts.length === 2 && CLITICS.has(parts[1] ?? '');
      if (clitic && parts[1] !== 's') continue;
      for (const part of clitic ? parts.slice(0, 1) : parts) {
        if (!STOP_WORDS.has(part)) keep(stem(part), part);
      }
    } else if (match[3] !== undefined) {
      keep(match[3], match[3]);
    }
  }
  return terms;
}

/** The search terms in a text, in reading order. The same text always gives the same terms. */
export function tokenize(text: string): string[] {
  return readTerms(text).map((entry) => entry.term);
}

// Words too general to say what an organization does. They count for a fifth
// of an ordinary word, so one has to be repeated often to rank at all.
const GENERAL_WEIGHT = 0.2;
const GENERAL_WORDS = new Set(
  `able access across activity additional address annual applicant application approach area available award
  based become begin benefit best better build call change come community continue current day develop
  development different effort ensure every example existing find first focus follow fund funding general
  get give go goal good grant great group help high important improve include increase individual
  information key know large last level like long made make many member month much need new next number
  offer one open opportunity order organization part people period place plan point program project
  proposal provide purpose range receive report request require resource result see serve service set
  several show since small staff start state still support take team three time total two type use want
  way week well work year`
    .split(/\s+/)
    .map(stem),
);

/**
 * The words that best characterize the texts, most distinctive first: how often
 * a word occurs, with very general words counted for much less. Ties are in
 * alphabetical order. Each word is returned in the form it was most often
 * written in, never as a stem, so the result can be shown or searched for.
 * Numbers and two-letter terms are left out.
 */
export function significantTerms(texts: string[], limit: number): string[] {
  const max = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  const counts = new Map<string, { count: number; forms: Map<string, number> }>();
  for (const text of texts) {
    for (const { term, surface } of readTerms(text)) {
      if (term.length < 3 || /^\p{N}/u.test(term)) continue;
      const entry = counts.get(term) ?? { count: 0, forms: new Map<string, number>() };
      entry.count += 1;
      entry.forms.set(surface, (entry.forms.get(surface) ?? 0) + 1);
      counts.set(term, entry);
    }
  }

  const ranked = [...counts].map(([term, entry]) => {
    const [word = term] = [...entry.forms]
      .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || (a[0] < b[0] ? -1 : 1))
      .map(([form]) => form);
    return { word, weight: entry.count * (GENERAL_WORDS.has(term) ? GENERAL_WEIGHT : 1) };
  });
  ranked.sort((a, b) => b.weight - a.weight || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));
  return ranked.slice(0, max).map((entry) => entry.word);
}
