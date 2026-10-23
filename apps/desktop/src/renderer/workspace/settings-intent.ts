// A link in the workspace that says "connect an assistant" should open Settings
// with the assistant section in view, not folded away. The workspace leaves a
// note here before opening Settings, and the Settings dialog picks it up once.

import { useBrowserStore } from '../state/browser-store.js';

let assistantRequested = false;

/** Opens Settings with the section for connecting an assistant unfolded. */
export function openAssistantSettings(): void {
  assistantRequested = true;
  useBrowserStore.getState().openSettings();
}

/** True once after `openAssistantSettings`; the Settings dialog calls it when it opens. */
export function takeAssistantSettingsRequest(): boolean {
  const requested = assistantRequested;
  assistantRequested = false;
  return requested;
}
