import { create } from 'zustand';
import type { FeedbackEntry, FeedbackInput } from '../../shared/feedback.js';

// The ratings already given, by item, so a reply shows the thumb it got.
interface FeedbackState {
  entries: Record<string, FeedbackEntry>;
  loaded: boolean;
  load: () => Promise<void>;
  rate: (input: FeedbackInput) => Promise<void>;
  reset: (entries: FeedbackEntry[]) => void;
}

const byKey = (entries: FeedbackEntry[]) => Object.fromEntries(entries.map((entry) => [entry.key, entry]));

export const useFeedbackStore = create<FeedbackState>((set, get) => ({
  entries: {},
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    set({ loaded: true });
    try {
      set({ entries: byKey(await window.bullebrowser.feedback.list()) });
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
  reset: (entries) => set({ entries: byKey(entries), loaded: true }),
}));
