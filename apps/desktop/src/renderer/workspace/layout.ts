// How the workspace fits the space it is given.
//
// The workspace is painted in the page slot: the area under the tab strip and
// to the left of the assistant panel. The panel takes a fixed share of the
// window, so the slot is much narrower than the window, and viewport media
// queries would give the wrong answer. Everything here is worked out from the
// measured width of the slot instead.
//
//   slot width   size      navigation        columns a screen can use
//   520–739      compact   one row on top    1 (2 from about 670)
//   740–1099     regular   rail on the left  1 (2 from about 930)
//   1100 and up  wide      rail on the left  2 (3 from about 1360)

import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';

export type WorkspaceSize = 'compact' | 'regular' | 'wide';

export interface WorkspaceLayout {
  /** Decides how the navigation is laid out. */
  size: WorkspaceSize;
  /** The measured width of the page slot, in pixels. */
  slotWidth: number;
  /** The width a screen has for its content, in pixels, after the rail and the gutters. */
  contentWidth: number;
  /** How many columns of content fit comfortably: stack when it is 1. */
  columns: 1 | 2 | 3;
}

/** The slot's width at the default window size, used until the slot has been measured. */
export const DEFAULT_SLOT_WIDTH = 840;
/** Below this the navigation becomes one row above the content. */
export const COMPACT_BELOW = 740;
/** From this width the rail and the gutters get a little more room. */
export const WIDE_FROM = 1100;
/**
 * The width of the navigation rail, in pixels: enough for the longest screen
 * name, "Organization Knowledge Hub", to sit on one line beside its icon.
 */
export const RAIL_WIDTH: Record<Exclude<WorkspaceSize, 'compact'>, number> = {
  regular: 240,
  wide: 256,
};
/** The space on each side of a screen's content, in pixels. Matches GUTTER_CLASS. */
export const GUTTER: Record<WorkspaceSize, number> = { compact: 16, regular: 24, wide: 32 };
export const GUTTER_CLASS: Record<WorkspaceSize, string> = {
  compact: 'px-4',
  regular: 'px-6',
  wide: 'px-8',
};
/** A screen's content never grows wider than this, however wide the window. */
export const CONTENT_MAX_WIDTH = 1240;

const TWO_COLUMNS_FROM = 640;
const THREE_COLUMNS_FROM = 1040;

/** The layout for a slot of the given width. A missing or zero width means "not measured yet". */
export function layoutFor(slotWidth: number | null | undefined): WorkspaceLayout {
  const width = slotWidth && slotWidth > 0 ? slotWidth : DEFAULT_SLOT_WIDTH;
  const size: WorkspaceSize =
    width < COMPACT_BELOW ? 'compact' : width < WIDE_FROM ? 'regular' : 'wide';
  const rail = size === 'compact' ? 0 : RAIL_WIDTH[size];
  const contentWidth = Math.max(0, Math.min(CONTENT_MAX_WIDTH, width - rail) - 2 * GUTTER[size]);
  const columns = contentWidth >= THREE_COLUMNS_FROM ? 3 : contentWidth >= TWO_COLUMNS_FROM ? 2 : 1;
  return { size, slotWidth: width, contentWidth, columns };
}

const WorkspaceLayoutContext = createContext<WorkspaceLayout>(layoutFor(null));

export const WorkspaceLayoutProvider = WorkspaceLayoutContext.Provider;

/**
 * The space a screen has. Use `columns` to decide whether things sit side by
 * side or stack (filters beside results, or above them), and `size` only when
 * the difference really is about the navigation.
 */
export function useWorkspaceLayout(): WorkspaceLayout {
  return useContext(WorkspaceLayoutContext);
}

/**
 * Measures an element's width and keeps it up to date. Returns a ref for the
 * element and the width, which is null until the element has been measured. A
 * width of zero (the element is hidden) is ignored, so the last real width is
 * kept while the workspace is not showing.
 */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number | null] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = (next: number) => {
      const rounded = Math.round(next);
      if (rounded > 0) setWidth((previous) => (previous === rounded ? previous : rounded));
    };
    measure(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) measure(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
