import { describe, expect, it } from 'vitest';
import { calculatorTool, dateContext, evaluateExpression, noteLooksSensitive, notesTools, type AssistantNote } from './assistant-tools.js';

describe('calculator', () => {
  it.each([
    ['2 + 3 * 4', 14],
    ['(2 + 3) * 4', 20],
    ['2 ^ 3 ^ 2', 512],
    ['-4 + 10', 6],
    ['250,000 * 20%', 50000],
    ['round(10 / 3, 2)', 3.33],
    ['max(4, 9, 2)', 9],
    ['sqrt(16) + abs(-2)', 6],
  ])('%s = %d', (expression, value) => {
    expect(evaluateExpression(expression)).toBeCloseTo(value, 10);
  });

  it('never runs code', () => {
    expect(() => evaluateExpression('constructor.constructor("return 1")()')).toThrow();
    expect(() => evaluateExpression('1; process.exit()')).toThrow();
  });

  it('reports errors as results the assistant can read', async () => {
    await expect(calculatorTool().execute({ expression: '1 / 0' })).resolves.toMatchObject({ error: 'Division by zero.' });
  });
});

describe('notes', () => {
  const memory = () => {
    const notes: AssistantNote[] = [];
    return {
      notes,
      store: {
        list: () => notes,
        add: (text: string) => { const note = { id: String(notes.length + 1), text, savedAt: 0 }; notes.push(note); return note; },
        remove: (id: string) => { const at = notes.findIndex((note) => note.id === id); if (at < 0) return false; notes.splice(at, 1); return true; },
      },
    };
  };

  it('saves, recalls and forgets', async () => {
    const { store, notes } = memory();
    const [remember, recall, forget] = notesTools(store);
    await expect(remember!.execute({ text: 'Focus on workforce grants in Ohio.' })).resolves.toMatchObject({ saved: true });
    await expect(recall!.execute({ query: 'ohio' })).resolves.toMatchObject({ count: 1 });
    await forget!.execute({ id: notes[0]!.id });
    expect(notes).toHaveLength(0);
  });

  it('refuses anything that looks like a secret', async () => {
    const { store, notes } = memory();
    const [remember] = notesTools(store);
    for (const text of ['My password is hunter2', 'Card 4242 4242 4242 4242', 'key sk-abcdefghijklmnopqrstuv']) {
      expect(noteLooksSensitive(text)).toBe(true);
      await expect(remember!.execute({ text })).resolves.toMatchObject({ saved: false });
    }
    expect(notes).toHaveLength(0);
  });
});

it('states the date in the given zone', () => {
  expect(dateContext(new Date('2026-11-25T12:00:00Z'), 'UTC')).toContain('Wednesday, November 25, 2026');
});
