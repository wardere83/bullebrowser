import { describe, expect, it, vi } from 'vitest';
import type { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUNDLE_ID, elapsedSeconds, installingUpdate, reopenScript, reopenWhenInstalled, removeLeftoverUpdates } from './update-guard.js';

const onMac = process.platform === 'darwin' ? it : it.skip;

describe('elapsedSeconds', () => {
  it('reads ps elapsed times', () => {
    expect(elapsedSeconds('00:12')).toBe(12);
    expect(elapsedSeconds(' 01:05 ')).toBe(65);
    expect(elapsedSeconds('02:00:01')).toBe(7201);
    expect(elapsedSeconds('1-00:00:00')).toBe(86_400);
    expect(elapsedSeconds('garbage')).toBe(Infinity);
  });
});

describe('installingUpdate', () => {
  onMac('is true while a recent ShipIt for BulleBrowser runs', () => {
    const run = vi.fn((command: string) => (command === 'pgrep' ? '4242\n' : '  00:20\n')) as unknown as typeof execFileSync;
    expect(installingUpdate(run)).toBe(true);
    expect(run).toHaveBeenCalledWith('pgrep', ['-f', `[S]hipIt com\\.bulleconsulting\\.bullebrowser\\.ShipIt`], { encoding: 'utf8' });
  });

  onMac('is false when none runs, or one has been stuck for minutes', () => {
    const none = vi.fn(() => { throw Object.assign(new Error('no match'), { status: 1 }); }) as unknown as typeof execFileSync;
    expect(installingUpdate(none)).toBe(false);
    const stuck = vi.fn((command: string) => (command === 'pgrep' ? '4242' : '12:00')) as unknown as typeof execFileSync;
    expect(installingUpdate(stuck)).toBe(false);
  });

  onMac('never matches the waiting shell, only ShipIt itself', () => {
    // The shell's own command line holds the pattern; it must not match it.
    const pattern = new RegExp(`[S]hipIt com\\.bulleconsulting\\.bullebrowser\\.ShipIt`);
    expect(pattern.test(`/bin/sh -c ${reopenScript()}`)).toBe(false);
    expect(pattern.test('/Applications/BulleBrowser.app/Contents/Frameworks/Squirrel.framework/Resources/ShipIt com.bulleconsulting.bullebrowser.ShipIt /Users/x/Library/Caches/com.bulleconsulting.bullebrowser.ShipIt/ShipItState.plist')).toBe(true);
  });
});

describe('reopenWhenInstalled', () => {
  it('waits for the install in a detached shell, then opens BulleBrowser', () => {
    const unref = vi.fn();
    const start = vi.fn(() => ({ unref })) as unknown as typeof spawn;
    reopenWhenInstalled(start);
    expect(start).toHaveBeenCalledWith('/bin/sh', ['-c', reopenScript()], { detached: true, stdio: 'ignore' });
    expect(unref).toHaveBeenCalled();
    expect(reopenScript()).toContain(`open -b ${BUNDLE_ID}`);
    expect(reopenScript()).toMatch(/while pgrep -f/);
  });
});

describe('removeLeftoverUpdates', () => {
  onMac('removes copies left by cancelled installs and nothing else', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'update-guard-'));
    mkdirSync(join(dir, `${BUNDLE_ID}.ShipIt.abc123`, 'BulleBrowser.app'), { recursive: true });
    mkdirSync(join(dir, `${BUNDLE_ID}.ShipIt.def456`));
    mkdirSync(join(dir, 'com.microsoft.VSCode.ShipIt.xyz'));
    writeFileSync(join(dir, 'other.txt'), 'keep');
    expect(await removeLeftoverUpdates(dir, () => false)).toBe(2);
    expect(readdirSync(dir).sort()).toEqual(['com.microsoft.VSCode.ShipIt.xyz', 'other.txt']);
  });

  onMac('leaves them while an install is running', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'update-guard-'));
    mkdirSync(join(dir, `${BUNDLE_ID}.ShipIt.abc123`));
    expect(await removeLeftoverUpdates(dir, () => true)).toBe(0);
    expect(readdirSync(dir)).toEqual([`${BUNDLE_ID}.ShipIt.abc123`]);
  });
});
