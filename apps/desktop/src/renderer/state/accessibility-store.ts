import { create } from 'zustand';
import {
  DEFAULT_ACCESSIBILITY,
  normalizeAccessibility,
  type AccessibilityPreferences,
} from '../../shared/accessibility.js';

export const useAccessibilityStore = create<{
  preferences: AccessibilityPreferences;
  ready: boolean;
  setPreferences: (value: unknown) => void;
}>((set) => ({
  preferences: { ...DEFAULT_ACCESSIBILITY },
  ready: false,
  setPreferences: (value) => set({ preferences: normalizeAccessibility(value), ready: true }),
}));
