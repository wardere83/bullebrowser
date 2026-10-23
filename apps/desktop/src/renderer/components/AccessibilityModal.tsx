import { useRef, useState } from 'react';
import {
  DEFAULT_ACCESSIBILITY,
  normalizeAccessibility,
  type AccessibilityPreferences,
} from '../../shared/accessibility.js';
import { useAccessibilityStore } from '../state/accessibility-store.js';
import { useBrowserStore } from '../state/browser-store.js';
import { Modal } from './Modal.js';

const options = [
  ['contrast', 'Increase contrast'],
  ['underlineLinks', 'Underline links'],
  ['textSpacing', 'Roomier text spacing'],
  ['readingFont', 'Use a clear reading font'],
] as const;

export function AccessibilityModal() {
  const close = useBrowserStore((s) => s.closeAccessibility);
  const preferences = useAccessibilityStore((s) => s.preferences);
  const setPreferences = useAccessibilityStore((s) => s.setPreferences);
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const update = async (patch: Partial<AccessibilityPreferences>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setMessage('Saving preferences…');
    try {
      const next = await window.bullebrowser.settings.set({
        accessibility: normalizeAccessibility({ ...preferences, ...patch }),
      });
      setPreferences(next.accessibility);
      setMessage('Preferences saved on this device.');
    } catch {
      setMessage('Couldn’t save your preferences. Please try again.');
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <Modal title="Accessibility" onClose={close} width={420}>
      <p className="mb-5 text-sm leading-relaxed text-slate-600">
        Adjust the app and browsing pages to suit you. Preferences stay on this device.
      </p>
      <fieldset disabled={saving} aria-busy={saving} className="space-y-4">
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>Text size</span>
          <select
            aria-label="Text size"
            value={preferences.textSize}
            onChange={(e) =>
              void update({ textSize: e.target.value as AccessibilityPreferences['textSize'] })
            }
            className="rounded-md border border-line bg-white px-3 py-2"
          >
            <option value="default">Default</option>
            <option value="larger">Larger text</option>
            <option value="largest">Largest text</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>Motion</span>
          <select
            aria-label="Motion"
            value={preferences.motion}
            onChange={(e) =>
              void update({ motion: e.target.value as AccessibilityPreferences['motion'] })
            }
            className="rounded-md border border-line bg-white px-3 py-2"
          >
            <option value="system">Use device setting</option>
            <option value="reduce">Reduce motion</option>
          </select>
        </label>
        {options.map(([key, label]) => (
          <label
            key={key}
            className="flex min-h-10 cursor-pointer items-center justify-between gap-4 text-sm"
          >
            <span>{label}</span>
            <input
              type="checkbox"
              className="h-5 w-5 accent-primary"
              checked={preferences[key]}
              onChange={(e) => void update({ [key]: e.target.checked })}
            />
          </label>
        ))}
        <button
          type="button"
          onClick={() => void update(DEFAULT_ACCESSIBILITY)}
          className="mt-2 rounded-md border border-line px-4 py-2 text-sm font-medium hover:bg-surface-muted"
        >
          Reset preferences
        </button>
      </fieldset>
      <p role="status" className="mt-3 min-h-5 text-xs text-slate-600">
        {message}
      </p>
      <details className="mt-2 text-xs leading-relaxed text-slate-600">
        <summary className="cursor-pointer font-medium">Keyboard tips</summary>
        <p className="mt-2">
          Use Tab and Shift+Tab to move between controls, Space to toggle a checkbox, and Escape to
          close this menu.
        </p>
      </details>
    </Modal>
  );
}
