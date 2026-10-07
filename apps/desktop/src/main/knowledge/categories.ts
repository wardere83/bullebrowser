// Which kind of document a file is, guessed from its name alone.
//
// The guess only labels a document. It decides nothing else, and a person can
// change it at any time. So a name is compared with the few ways people name
// these documents, and anything else is filed as "other" rather than pushed
// into a kind it may not be.

import { KNOWLEDGE_CATEGORY_LABELS, type KnowledgeCategory } from '../../shared/funding.js';

export function isKnowledgeCategory(value: unknown): value is KnowledgeCategory {
  return typeof value === 'string' && Object.hasOwn(KNOWLEDGE_CATEGORY_LABELS, value);
}

type Hints = [category: KnowledgeCategory, names: string[]][];

// Names that say outright what a document is. A file that calls itself a
// budget is one, whatever else its name mentions. The rest are looked for
// before any single word, so "program impact report" is an impact report and
// not a program description.
const NAMED_OUTRIGHT: Hints = [
  ['budget', ['budget']],
  [
    'previous_proposal',
    [
      'previous proposal',
      'prior proposal',
      'past proposal',
      'grant proposal',
      'funding proposal',
      'grant application',
      'funding application',
      'letter of intent',
      'letter of inquiry',
    ],
  ],
  [
    'strategic_plan',
    ['strategic plan', 'strategic framework', 'strategic priority', 'strategic direction', 'business plan'],
  ],
  ['impact_report', ['impact report', 'annual report', 'outcome report', 'evaluation report']],
  [
    'program_description',
    [
      'program description',
      'programme description',
      'program overview',
      'programme overview',
      'program summary',
      'programme summary',
      'service description',
    ],
  ],
  [
    'organizational_profile',
    [
      'organizational profile',
      'organisational profile',
      'organization profile',
      'organisation profile',
      'business profile',
      'company profile',
      'capability statement',
      'about us',
    ],
  ],
];

// Single words that suggest a kind when nothing names one outright.
const SUGGESTED_BY_A_WORD: Hints = [
  ['strategic_plan', ['strategy']],
  ['previous_proposal', ['proposal']],
  ['impact_report', ['impact']],
  ['program_description', ['program', 'programme']],
  ['organizational_profile', ['profile']],
];

/** Folds simple plurals, so "Program Descriptions" reads as "program description". */
function singular(word: string): string {
  if (word.length < 5) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  return word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

/** The words of a file name: no directories, no extension, no digits, lower case. */
function nameWords(fileName: string): string[] {
  const base = (fileName.split(/[\\/]/).pop() ?? '').replace(/\.[A-Za-z0-9]{1,8}$/, '');
  return (
    base
      .normalize('NFKC')
      // "StrategicPlan2025" is two words and a year.
      .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
      .toLowerCase()
      .split(/[^\p{L}]+/u)
      .filter(Boolean)
      .map(singular)
  );
}

/** The category a file's name suggests, or "other" when it suggests none. */
export function guessCategory(fileName: string): KnowledgeCategory {
  // Padded, so a hint only matches whole words.
  const name = ` ${nameWords(fileName).join(' ')} `;
  for (const hints of [NAMED_OUTRIGHT, SUGGESTED_BY_A_WORD]) {
    for (const [category, names] of hints) {
      if (names.some((entry) => name.includes(` ${entry} `))) return category;
    }
  }
  return 'other';
}
