// Native input through Chrome's DevTools protocol (keys, text, mouse).

import type { KeyName } from '@bullebrowser/agent-core';
import type { WebContents } from 'electron';

// Real keyboard input goes through Chrome's own input pipeline (the DevTools
// protocol's Input domain), not webContents.sendInputEvent / insertText:
//  - sendInputEvent delivers to the top-level page only, so keys never reached
//    an editor inside a cross-site frame — Word and PowerPoint Online's
//    document body is exactly that — and the agent could not type there;
//  - insertText into a focused cross-site frame crashes the page's renderer.
// The Input domain routes to whichever frame has focus, like a real keyboard.
export async function withInput<T>(wc: WebContents, act: (send: (method: string, params: object) => Promise<unknown>) => Promise<T>): Promise<T> {
  const dbg = wc.debugger;
  const attachedHere = !dbg.isAttached();
  if (attachedHere) {
    try {
      dbg.attach('1.3');
    } catch {
      throw new Error('Keyboard input is unavailable while DevTools is open on this tab. Close DevTools and try again.');
    }
  }
  try {
    return await act((method, params) => dbg.sendCommand(method, params));
  } finally {
    if (attachedHere && dbg.isAttached()) dbg.detach();
  }
}

// Key definitions for the DevTools Input domain. `text` makes the key produce
// a character (Enter submits and breaks lines, Space types a space).
export const KEY_DEFS: Record<KeyName, { key: string; code: string; keyCode: number; text?: string }> = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
};

// Text as a typist enters it: line breaks are pressed as Enter.
export async function insertLines(send: (method: string, params: object) => Promise<unknown>, text: string): Promise<void> {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) await pressWith(send, KEY_DEFS.Enter);
    if (lines[i]) await send('Input.insertText', { text: lines[i] });
  }
}

export async function pressWith(
  send: (method: string, params: object) => Promise<unknown>,
  def: { key: string; code: string; keyCode: number; text?: string },
): Promise<void> {
  const base = { key: def.key, code: def.code, windowsVirtualKeyCode: def.keyCode, nativeVirtualKeyCode: def.keyCode };
  await send('Input.dispatchKeyEvent', def.text ? { type: 'keyDown', ...base, text: def.text, unmodifiedText: def.text } : { type: 'rawKeyDown', ...base });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

