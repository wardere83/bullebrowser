// Arrow-key movement shared by Tabs and Menu: which item the focus goes to
// next. Kept as a plain function so the rules (wrap at the ends, skip what is
// disabled, Home and End) are tested once.

export type RovingOrientation = 'horizontal' | 'vertical';

/**
 * The index focus should move to for a key press, or null when the key is not
 * one that moves focus. `enabled[i]` says whether item `i` can take focus;
 * `current` may be -1 when nothing in the set has focus yet.
 */
export function rovingIndex(
  key: string,
  current: number,
  enabled: readonly boolean[],
  orientation: RovingOrientation,
): number | null {
  const count = enabled.length;
  if (!enabled.some(Boolean)) return null;

  const forwardKey = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
  const backwardKey = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';

  const step = (from: number, direction: 1 | -1): number => {
    let index = from;
    for (let moved = 0; moved < count; moved += 1) {
      index = (index + direction + count) % count;
      if (enabled[index]) return index;
    }
    return from;
  };

  if (key === forwardKey) return step(current < 0 ? -1 : current, 1);
  if (key === backwardKey) return step(current < 0 ? 0 : current, -1);
  if (key === 'Home') return step(-1, 1);
  if (key === 'End') return step(0, -1);
  return null;
}
