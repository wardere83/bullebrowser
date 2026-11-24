import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type * as React from 'react';

const effects = vi.hoisted(() => [] as (readonly unknown[] | undefined)[]);
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof React>();
  return {
    ...actual,
    useEffect: (_effect: () => void, deps?: readonly unknown[]) => { effects.push(deps); },
  };
});

const { Modal } = await import('./Modal.js');

describe('Modal focus handling', () => {
  it('does not re-run its focus effect when the parent passes a new onClose', () => {
    // ConfirmDialog passes an inline onClose, and App re-renders it on every
    // tab update. Re-running the effect moved focus back to the first control,
    // off the Approve button a keyboard user had tabbed to.
    renderToStaticMarkup(<Modal title="Confirm" onClose={() => {}}>body</Modal>);
    renderToStaticMarkup(<Modal title="Confirm" onClose={() => {}}>body</Modal>);
    expect(effects).toHaveLength(2);
    for (const deps of effects) expect(deps).toEqual([]);
  });
});
