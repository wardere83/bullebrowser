import type { ApiTool } from './types.js';

// Everyday tools that make the assistant more capable without sending
// anything anywhere: exact arithmetic, and a small set of notes the user asks
// it to keep between conversations. Both run on the device and are free.

// ---------------------------------------------------------------------------
// Calculator

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: (value, places = 0) => {
    const scale = 10 ** places;
    return Math.round(value * scale) / scale;
  },
  floor: Math.floor,
  ceil: Math.ceil,
  min: Math.min,
  max: Math.max,
  log: Math.log10,
  ln: Math.log,
  exp: Math.exp,
  pow: Math.pow,
};

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

type Token = { kind: 'num'; value: number } | { kind: 'op'; value: string } | { kind: 'name'; value: string };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  const source = expression.replace(/,(?=\d{3}(?:\D|$))/g, '').replace(/[$€£]/g, '');
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (/\s/.test(ch)) { i += 1; continue; }
    const number = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(source.slice(i));
    if (number) {
      let value = Number(number[0]);
      i += number[0].length;
      if (source[i] === '%') {
        // "15%" is 0.15, as people write it.
        value /= 100;
        i += 1;
      }
      tokens.push({ kind: 'num', value });
      continue;
    }
    const name = /^[a-z_]+/i.exec(source.slice(i));
    if (name) {
      tokens.push({ kind: 'name', value: name[0].toLowerCase() });
      i += name[0].length;
      continue;
    }
    if ('+-*/^(),'.includes(ch)) {
      tokens.push({ kind: 'op', value: ch });
      i += 1;
      continue;
    }
    if (ch === '×') { tokens.push({ kind: 'op', value: '*' }); i += 1; continue; }
    if (ch === '÷') { tokens.push({ kind: 'op', value: '/' }); i += 1; continue; }
    throw new Error(`Unexpected "${ch}" in the expression.`);
  }
  return tokens;
}

/**
 * Evaluates an arithmetic expression without running any code: numbers,
 * + - * / ^, parentheses, percentages and a few named functions.
 */
export function evaluateExpression(expression: string): number {
  if (expression.length > 500) throw new Error('The expression is too long.');
  const tokens = tokenize(expression);
  let at = 0;
  const peek = () => tokens[at];
  const take = () => tokens[at++];
  const expect = (value: string) => {
    const token = take();
    if (!token || token.kind !== 'op' || token.value !== value) throw new Error(`Expected "${value}".`);
  };

  const primary = (): number => {
    const token = take();
    if (!token) throw new Error('The expression ended too soon.');
    if (token.kind === 'num') return token.value;
    if (token.kind === 'op' && token.value === '(') {
      const value = sum();
      expect(')');
      return value;
    }
    if (token.kind === 'op' && (token.value === '-' || token.value === '+')) {
      const value = power();
      return token.value === '-' ? -value : value;
    }
    if (token.kind === 'name') {
      if (token.value in CONSTANTS) return CONSTANTS[token.value]!;
      const fn = FUNCTIONS[token.value];
      if (!fn) throw new Error(`Unknown function "${token.value}".`);
      expect('(');
      const args = [sum()];
      while (peek()?.kind === 'op' && peek()!.value === ',') {
        take();
        args.push(sum());
      }
      expect(')');
      return fn(...args);
    }
    throw new Error(`Unexpected "${token.value}".`);
  };
  const power = (): number => {
    const base = primary();
    const next = peek();
    if (next?.kind === 'op' && next.value === '^') {
      take();
      return base ** power();
    }
    return base;
  };
  const product = (): number => {
    let value = power();
    for (let next = peek(); next?.kind === 'op' && (next.value === '*' || next.value === '/'); next = peek()) {
      take();
      const right = power();
      if (next.value === '/' && right === 0) throw new Error('Division by zero.');
      value = next.value === '*' ? value * right : value / right;
    }
    return value;
  };
  const sum = (): number => {
    let value = product();
    for (let next = peek(); next?.kind === 'op' && (next.value === '+' || next.value === '-'); next = peek()) {
      take();
      const right = product();
      value = next.value === '+' ? value + right : value - right;
    }
    return value;
  };

  const result = sum();
  if (at < tokens.length) throw new Error('The expression has extra characters at the end.');
  if (!Number.isFinite(result)) throw new Error('The result is not a finite number.');
  return result;
}

export function calculatorTool(): ApiTool {
  return {
    name: 'calculate',
    description:
      'Work out arithmetic exactly instead of estimating it: budgets, award amounts, percentages, ' +
      'match requirements, dates as day counts. Supports + - * / ^, parentheses, percentages like 15%, ' +
      'and sqrt, abs, round(x, places), floor, ceil, min, max, log, ln, exp, pow (separate arguments with ", "). Use it whenever a number ' +
      'in your answer comes from a calculation.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        expression: { type: 'string', description: 'The expression, e.g. "250000 * 0.2 + 15%*40000".' },
      },
      required: ['expression'],
    },
    execute: async (input) => {
      const expression = typeof input.expression === 'string' ? input.expression : '';
      try {
        const value = evaluateExpression(expression);
        return { expression, value: Number(value.toPrecision(15)) };
      } catch (error) {
        return { expression, error: (error as Error).message };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Notes kept between conversations

export interface AssistantNote {
  id: string;
  text: string;
  savedAt: number;
}

export interface AssistantNotesStore {
  list(): AssistantNote[] | Promise<AssistantNote[]>;
  add(text: string): AssistantNote | Promise<AssistantNote>;
  remove(id: string): boolean | Promise<boolean>;
}

export const MAX_NOTES = 200;
const MAX_NOTE_CHARS = 500;

// Notes must never hold a secret. A card, account or ID number, a password or
// a key is refused outright rather than stored and redacted later.
const SECRET_PATTERNS: RegExp[] = [
  /\b(?:\d[ -]?){13,19}\b/, // card or account numbers
  /\b\d{3}-\d{2}-\d{4}\b/, // US social security numbers
  /\b(?:password|passcode|passwd|pin|cvv|cvc|api[ _-]?key|secret|token|private key|seed phrase|recovery phrase)\b/i,
  /\b(?:sk|pk|rk)-[a-z0-9_-]{16,}/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]+-----/,
];

export function noteLooksSensitive(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

export function notesTools(store: AssistantNotesStore): ApiTool[] {
  return [
    {
      name: 'remember_note',
      description:
        "Save a short note the user wants kept for later conversations: their organization's focus, a " +
        'preference about how they like answers, an opportunity they are pursuing, a deadline they care ' +
        'about. Save only what the user told you or asked you to keep, in one plain sentence. Never save ' +
        'passwords, card, bank or ID numbers, keys, health details or anything about other people\'s private lives.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string', description: 'The note, one sentence.' } },
        required: ['text'],
      },
      execute: async (input) => {
        const text = typeof input.text === 'string' ? input.text.replace(/\s+/g, ' ').trim() : '';
        if (!text) return { saved: false, reason: 'The note was empty.' };
        if (text.length > MAX_NOTE_CHARS) return { saved: false, reason: `Keep notes under ${MAX_NOTE_CHARS} characters.` };
        if (noteLooksSensitive(text)) return { saved: false, reason: 'Notes cannot hold passwords, keys or card, bank or ID numbers.' };
        const existing = await store.list();
        if (existing.some((note) => note.text.toLowerCase() === text.toLowerCase())) return { saved: true, duplicate: true };
        if (existing.length >= MAX_NOTES) return { saved: false, reason: 'The notes are full. Forget an old note first.' };
        const note = await store.add(text);
        return { saved: true, id: note.id };
      },
    },
    {
      name: 'recall_notes',
      description:
        'Read the notes the user asked you to keep from earlier conversations. Check them when a request ' +
        'may depend on what you were told before: their organization, preferences, opportunities in progress.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { query: { type: 'string', description: 'Optional words to narrow the notes.' } },
      },
      execute: async (input) => {
        const query = typeof input.query === 'string' ? input.query.toLowerCase().split(/\s+/).filter(Boolean) : [];
        const notes = (await store.list())
          .filter((note) => query.length === 0 || query.some((word) => note.text.toLowerCase().includes(word)))
          .slice(-50)
          .map((note) => ({ id: note.id, text: note.text, saved: new Date(note.savedAt).toISOString().slice(0, 10) }));
        return { notes, count: notes.length };
      },
    },
    {
      name: 'forget_note',
      description: 'Delete a note when the user asks you to forget it or it is no longer true.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string', description: 'The id from recall_notes.' } },
        required: ['id'],
      },
      execute: async (input) => {
        const id = typeof input.id === 'string' ? input.id : '';
        return { forgotten: id ? await store.remove(id) : false };
      },
    },
  ];
}

/** A line for the system prompt that grounds the assistant in the current date. */
export function dateContext(now: Date = new Date(), timeZone?: string): string {
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = new Intl.DateTimeFormat('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: zone }).format(now);
  return `Today is ${date} (${zone}). Judge deadlines, eligibility windows and "recent" against this date.`;
}
