// Per-site permission levels.
//
// A task that only reads Wikipedia used to hold the same powers as one that
// could post to the user's bank. Each site (origin) now has a level, and an
// action needs at least the level below to run there. New sites start at
// read + click; anything more is asked for when the task needs it.

import { HIGH_RISK_TARGET_RE } from './policy.js';
import type { PermissionLevel, TargetFacts, ToolName } from './types.js';

export const PERMISSION_LEVELS: PermissionLevel[] = ['read', 'click', 'type', 'full'];
export const DEFAULT_SITE_LEVEL: PermissionLevel = 'click';

export const PERMISSION_LABELS: Record<PermissionLevel, string> = {
  read: 'Read only',
  click: 'Read + click',
  type: 'Read + click + type',
  full: 'Full (submit, upload, download)',
};

export function levelAllows(have: PermissionLevel, need: PermissionLevel): boolean {
  return PERMISSION_LEVELS.indexOf(have) >= PERMISSION_LEVELS.indexOf(need);
}

const TYPE_TOOLS = new Set<string>(['type', 'typeIntoField', 'select_option', 'clipboard_paste']);
const FULL_TOOLS = new Set<string>(['upload_file']);
const CLICK_TOOLS = new Set<string>(['click', 'clickElement']);

// The level an action needs. `facts` is what the runtime found on the page for
// a click or key press (does it submit a form, what does the control say).
export function requiredLevel(
  name: ToolName | string,
  input: Record<string, unknown>,
  facts: TargetFacts | null,
): PermissionLevel {
  if (FULL_TOOLS.has(name)) return 'full';
  if (TYPE_TOOLS.has(name)) return 'type';
  const risky = !!facts && (facts.submitsForm || (facts.activates !== false && HIGH_RISK_TARGET_RE.test(facts.label)));
  if (CLICK_TOOLS.has(name)) return risky ? 'full' : 'click';
  if (name === 'press_key') {
    if ((input.key === 'Enter' || input.key === 'Space') && risky) return 'full';
    if (input.key === 'Backspace' || input.key === 'Delete') return 'type';
    return 'click';
  }
  return 'read';
}
