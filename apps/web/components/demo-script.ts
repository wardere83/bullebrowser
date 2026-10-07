// The script of the home page's walk-through, kept apart from how it is drawn.
//
// The walk-through is a list of frames, each a complete picture of the two
// panes and how long to hold it. Building the whole list up front is what lets
// the player pause on any frame, start over, or rest on the last one.

import type { Translate } from '@/lib/i18n';
import type { OpportunityStatus } from '@/lib/terms';

export const LISTINGS = [
  { id: 'a', status: 'active' },
  { id: 'b', status: 'unverified' },
  { id: 'c', status: 'expired' },
] as const satisfies readonly { id: string; status: OpportunityStatus }[];

export type Finding = 'documented' | 'partial' | 'missing';

export const REQUIREMENTS = [
  { id: 'r1', finding: 'documented' },
  { id: 'r2', finding: 'partial' },
  { id: 'r3', finding: 'missing' },
] as const satisfies readonly { id: string; finding: Finding }[];

export interface Turn {
  prompt: string;
  steps: string[];
  /** How many steps are on screen, and how many of those have finished. */
  shown: number;
  done: number;
  answer: string | null;
}

export interface Scene {
  /** What is typed in the composer so far. */
  composer: string;
  /** Index of the option in use, or null before one is chosen. */
  workflow: number | null;
  turn: Turn | null;
  view: 'start' | 'listings' | 'alignment';
  /** Rows revealed on the workspace screen. */
  rows: number;
}

export interface Frame extends Scene {
  /** How long the frame stays up, in milliseconds. */
  hold: number;
}

const TYPE_MS = 34;
const TYPE_CHARS = 2;

/** The whole walk-through in one language: two requests, from typing to answer. */
export function buildFrames(t: Translate): Frame[] {
  const frames: Frame[] = [];
  let scene: Scene = { composer: '', workflow: null, turn: null, view: 'start', rows: 0 };
  const show = (hold: number, change: Partial<Scene> = {}) => {
    scene = { ...scene, ...change };
    frames.push({ ...scene, hold });
  };

  const ask = (
    workflow: number,
    prompt: string,
    steps: string[],
    view: Scene['view'],
    rows: number,
    answer: string,
  ) => {
    show(900, { workflow });
    // By code point, so a letter outside the basic plane is never cut in half.
    const letters = Array.from(prompt);
    for (let end = TYPE_CHARS; end < letters.length + TYPE_CHARS; end += TYPE_CHARS) {
      show(TYPE_MS, { composer: letters.slice(0, end).join('') });
    }
    show(400);
    let turn: Turn = { prompt, steps, shown: 0, done: 0, answer: null };
    show(600, { composer: '', turn, view, rows: 0 });
    steps.forEach((_, index) => {
      turn = { ...turn, shown: index + 1, done: index };
      show(900, { turn });
    });
    for (let row = 1; row <= rows; row += 1) show(450, { rows: row });
    turn = { ...turn, done: steps.length, answer };
    show(5600, { turn });
  };

  show(1600);
  ask(
    0,
    t('demo.prompt1'),
    [t('demo.step.profile'), t('demo.step.search'), t('demo.step.deadlines')],
    'listings',
    LISTINGS.length,
    t('demo.answer1'),
  );
  ask(
    1,
    t('demo.prompt2'),
    [t('demo.step.notice'), t('demo.step.documents'), t('demo.step.compare')],
    'alignment',
    REQUIREMENTS.length,
    t('demo.answer2'),
  );
  return frames;
}
