import { create } from 'zustand';
import type { FeedbackEntry, FeedbackInput } from '../../shared/feedback.js';

// The ratings already given, by item, so a reply shows the thumb it got.
interface FeedbackState {
  entries: Record<string, FeedbackEntry>;
  /** Whether ratings and comments go to the BulleBrowser team. */
  sharing: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  rate: (input: FeedbackInput) => Promise<void>;
  reset: (entries: FeedbackEntry[]) => void;
  setSharing: (on: boolean) => Promise<void>;
}

const byKey = (entries: FeedbackEntry[]) => Object.fromEntries(entries.map((entry) => [entry.key, entry]));

export const useFeedbackStore = create<FeedbackState>((set, get) => ({
  entries: {},
  sharing: true,
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    set({ loaded: true });
    try {
      const [entries, sharing] = await Promise.all([window.bullebrowser.feedback.list(), window.bullebrowser.feedback.sharing()]);
      set({ entries: byKey(entries), sharing });
    } catch {
      set({ loaded: false });
    }
  },
  rate: async (input) => {
    const saved = await window.bullebrowser.feedback.set(input);
    const entries = { ...get().entries };
    if (saved) entries[input.key] = saved;
    else delete entries[input.key];
    set({ entries });
  },
  reset: (entries) => set({ entries: byKey(entries) }),
  setSharing: async (on) => {
    await window.bullebrowser.feedback.setSharing(on);
    set({ sharing: on });
  },
}));
