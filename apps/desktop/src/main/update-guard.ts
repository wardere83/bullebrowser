// macOS installs an update after BulleBrowser quits: ShipIt checks the new
// copy's signature (about 30 seconds) and swaps it in, but gives up when
// BulleBrowser is running again by then ("App Still Running Error"). Opening
// BulleBrowser during that window used to cancel the update every time, and
// each cancelled attempt left an ~900 MB copy behind until the disk filled.
//
// Now a launch during an install leaves straight away and reopens BulleBrowser
// once the install is done, so a reopened BulleBrowser is always the updated
// one. Leftover copies are removed on the next normal start.

import { execFileSync, spawn } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const BUNDLE_ID = 'com.bulleconsulting.bullebrowser';

// The bracket keeps a shell that waits on this pattern from matching itself.
const SHIPIT = `[S]hipIt ${BUNDLE_ID.replace(/\./g, '\\.')}\\.ShipIt`;

// An install takes well under a minute; a ShipIt older than this is stuck
// and must not keep BulleBrowser from opening.
const STUCK_AFTER_SECONDS = 300;

/** Seconds from `ps -o etime=` ("[[dd-]hh:]mm:ss"). */
export function elapsedSeconds(etime: string): number {
  const [days, clock] = etime.trim().includes('-') ? etime.trim().split('-') : ['0', etime.trim()];
  const parts = (clock ?? '').split(':').map(Number);
  if (parts.some((part) => Number.isNaN(part))) return Infinity;
  const [s = 0, m = 0, h = 0] = parts.reverse();
  return Number(days) * 86_400 + h * 3_600 + m * 60 + s;
}

/** Whether macOS is installing a BulleBrowser update right now. */
export function installingUpdate(run: typeof execFileSync = execFileSync): boolean {
  if (process.platform !== 'darwin') return false;
  let pids: string[];
  try {
    pids = String(run('pgrep', ['-f', SHIPIT], { encoding: 'utf8' })).split(/\s+/).filter(Boolean);
  } catch {
    return false; // pgrep exits 1 when nothing matches.
  }
  return pids.some((pid) => {
    try {
      return elapsedSeconds(String(run('ps', ['-o', 'etime=', '-p', pid], { encoding: 'utf8' }))) < STUCK_AFTER_SECONDS;
    } catch {
      return false;
    }
  });
}

/** The shell that waits for the install, then opens BulleBrowser. */
export function reopenScript(): string {
  return [
    `osascript -e 'display notification "BulleBrowser is finishing its update and will open in a moment." with title "BulleBrowser"' >/dev/null 2>&1`,
    `n=0; while pgrep -f '${SHIPIT}' >/dev/null && [ "$n" -lt ${STUCK_AFTER_SECONDS} ]; do sleep 1; n=$((n+1)); done`,
    // ShipIt may already have opened it; open then just brings it forward.
    `sleep 2; open -b ${BUNDLE_ID}`,
  ].join('\n');
}

/** Reopen BulleBrowser once the install finishes; this launch then exits. */
export function reopenWhenInstalled(start: typeof spawn = spawn): void {
  start('/bin/sh', ['-c', reopenScript()], { detached: true, stdio: 'ignore' }).unref();
}

/** Remove copies left by cancelled installs; never while one is running. */
export async function removeLeftoverUpdates(dir = tmpdir(), installing = installingUpdate): Promise<number> {
  if (process.platform !== 'darwin' || installing()) return 0;
  const leftovers = (await readdir(dir).catch(() => [] as string[])).filter((name) => name.startsWith(`${BUNDLE_ID}.ShipIt.`));
  await Promise.all(leftovers.map((name) => rm(join(dir, name), { recursive: true, force: true }).catch(() => {})));
  return leftovers.length;
}
