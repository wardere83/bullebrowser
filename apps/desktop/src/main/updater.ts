// Published, signed releases download in the background without interrupting
// browsing. Update clicks stage the verified release without quitting.
// Native binaries activate on the next normal quit and launch.

import { app, autoUpdater as nativeAutoUpdater, type BrowserWindow } from 'electron';
// electron-updater is CommonJS; its default export works in the main ESM bundle.
import electronUpdater from 'electron-updater';
import { compare, valid } from 'semver';
import { IPC, type UpdateStatus } from '../shared/ipc.js';
import { getActivatedUpdateVersion, recordPreparedUpdate, reconcilePreparedUpdate } from './storage/update-receipt.js';

const { autoUpdater } = electronUpdater;
const CHECK_INTERVAL_MS = 60 * 1000;
const FOCUS_CHECK_INTERVAL_MS = 60 * 1000;
const NATIVE_STAGING_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_CONNECTION_RETRIES = 3;
const CONNECTION_RETRY_BASE_MS = 10_000;

let latest: UpdateStatus = { state: 'idle' };
let highestVersion: string | undefined;
let acknowledgedVersion: string | undefined;
let requestCheck: (() => Promise<void>) | undefined;
let activationIssue: string | null = null;
let stageUpdate: ((version: string) => void) | undefined;
let notifyStatus: (() => void) | undefined;
let bindWindow: ((win: BrowserWindow) => void) | undefined;

function isNewerVersion(version: string): boolean {
  try {
    return valid(version) !== null && autoUpdater.currentVersion.compare(version) < 0;
  } catch {
    return false;
  }
}

function isCurrentCandidate(version: string): boolean {
  return isNewerVersion(version) && (!highestVersion || compare(version, highestVersion) >= 0);
}

function isDiskFull(error: Error): boolean {
  const code = (error as Error & { code?: string | number }).code;
  return code === 'ENOSPC' || code === 640 || code === '640'
    || /\bENOSPC\b|\bno space left\b|\b(?:not enough|isn['’]?t enough|is not enough)\s+(?:free\s+|disk\s+)?space\b|\bdisk (?:is )?full\b|\bNSFileWriteOutOfSpace\b|\bNSCocoaErrorDomain\b.{0,24}\b640\b/i.test(error.message);
}

function isConnectionInterrupted(error: Error): boolean {
  const code = (error as Error & { code?: string | number }).code;
  return ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'ECONNREFUSED'].includes(String(code))
    || /\b(?:ERR_(?:CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_TIMED_OUT|NETWORK_CHANGED|INTERNET_DISCONNECTED)|ECONNRESET|ETIMEDOUT|EAI_AGAIN)\b|\b(?:network|connection)\s+(?:timeout|timed out|interrupted|reset)|\b(?:HTTP|status(?: code)?)\s*[:=]?\s*(?:408|429|50[234])\b/i.test(error.message);
}

export function getUpdateStatus(): UpdateStatus {
  if (latest.state !== 'idle' && !isNewerVersion(latest.version)) latest = { state: 'idle' };
  if (highestVersion && !isNewerVersion(highestVersion)) highestVersion = undefined;
  if (acknowledgedVersion && !isNewerVersion(acknowledgedVersion)) acknowledgedVersion = undefined;
  // Keep the staged version internally, but renderer reloads must not bring
  // back a notice that the user has already acknowledged in this session.
  if (latest.state !== 'idle' && acknowledgedVersion && compare(latest.version, acknowledgedVersion) <= 0) {
    return { state: 'idle' };
  }
  return latest;
}

export function prepareUpdate(version: string): void {
  const status = getUpdateStatus();
  if (status.state !== 'ready' || status.version !== version) {
    throw new Error('This update is no longer ready. Check the update notice for the current version.');
  }
  acknowledgedVersion = status.version;
  notifyStatus?.();
}

/** Stage a release while keeping every browser window and active task alive. */
export async function applyUpdate(version: string, saveSession: () => void = () => {}): Promise<void> {
  const status = getUpdateStatus();
  const preparedVersion = status.state === 'ready' ? status.version : status.state === 'deferred' ? status.preparedVersion : undefined;
  if (!app.isPackaged || preparedVersion !== version) throw new Error('This update is not ready to prepare.');
  if (status.state === 'ready' && status.scheduled) return;
  saveSession();
  stageUpdate?.(version);
}

/** Explicit, user-consented activation. Electron must replace the native process. */
export function finishUpdate(version: string): void {
  const status = getUpdateStatus();
  const prepared = status.state === 'ready' ? status.version : status.state === 'deferred' ? status.preparedVersion : null;
  if (!app.isPackaged || prepared !== version) throw new Error('This update is not ready to install.');
  if (process.platform === 'linux') throw new Error('Automatic installation is not supported for this Linux package.');
  // The renderer saves chat drafts before invoking this handler. Native updater
  // takes ownership of the controlled quit/install/relaunch sequence.
  autoUpdater.quitAndInstall(false, true);
}

export function getUpdateDetails(): { installedVersion: string; activationIssue: string | null; completedVersion: string | null } {
  return { installedVersion: app.getVersion(), activationIssue, completedVersion: getActivatedUpdateVersion() };
}

/** Explicit checks work even when no update notice has been announced yet. */
export async function checkForAppUpdates(): Promise<void> {
  if (!app.isPackaged) throw new Error('Automatic updates are available in installed builds.');
  await requestCheck?.();
}

export function dismissUpdateNotice(version: string): void {
  const status = getUpdateStatus();
  if (status.state !== 'deferred' || status.version !== version) {
    throw new Error('This update notice has changed. Check the notice for the current version.');
  }
  acknowledgedVersion = status.version;
  notifyStatus?.();
}

export async function retryUpdate(): Promise<void> {
  const status = getUpdateStatus();
  if (status.state !== 'error' || status.retryable === false) return;
  await requestCheck?.();
}

export function setupAutoUpdate(win: BrowserWindow): void {
  if (!app.isPackaged) return;
  if (bindWindow) {
    bindWindow(win);
    return;
  }

  let disposed = false;
  let targetWindow: BrowserWindow | undefined;
  let checkPromise: Promise<void> | undefined;
  let downloadPromise: Promise<void> | undefined;
  let downloadVersion: string | undefined;
  let stagingVersion: string | undefined;
  let stagingFeedUrl: string | undefined;
  let nativePreparedVersion: string | undefined;
  let stagingTimer: ReturnType<typeof setTimeout> | undefined;
  let connectionRetryTimer: ReturnType<typeof setTimeout> | undefined;
  let connectionRetryVersion: string | undefined;
  let connectionRetryAttempts = 0;
  let lastCheckTime = -Infinity;
  const isMac = process.platform === 'darwin';
  try {
    activationIssue = reconcilePreparedUpdate(app.getVersion(), app.getAppPath());
  } catch {
    activationIssue = 'Could not read the previous update record. Check for updates or use the latest installer.';
  }
  const rememberPrepared = (version: string) => {
    try { recordPreparedUpdate(version, app.getVersion(), app.getAppPath()); }
    catch { activationIssue = 'The update is verified, but its history could not be saved. Check free disk space before your next launch.'; }
  };
  const installLocationError = isMac && /(?:^\/Volumes\/|\/AppTranslocation\/)/.test(process.execPath)
    ? 'Move BulleBrowser to Applications and open that copy before updating. Updates cannot replace an app running from a disk image or a translocated location.'
    : null;
  if (installLocationError) activationIssue = installLocationError;
  let checkError: Error | undefined;


  const publish = () => {
    if (!disposed && targetWindow && !targetWindow.isDestroyed()) targetWindow.webContents.send(IPC.UPDATE_STATUS, getUpdateStatus());
  };
  const send = (status: UpdateStatus) => {
    if (disposed) return;
    latest = status;
    publish();
  };
  notifyStatus = publish;
  const scheduled = (version: string) => {
    if (disposed) throw new Error('The updater is no longer available.');
    rememberPrepared(version);
    send({ state: 'ready', version, scheduled: true });
  };
  stageUpdate = scheduled;


  // Control downloads ourselves so checks continue after an update is ready,
  // without repeatedly staging that version or replacing it with a stale feed.
  autoUpdater.autoDownload = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = false;
  // MacUpdater otherwise copies the verified ZIP a second time for a future
  // differential download. Squirrel needs its own ZIP and unpacked bundle too;
  // keep that disk space available for preparation instead of a spare archive.
  autoUpdater.disableDifferentialDownload = isMac;

  const clearStaging = () => {
    if (stagingTimer) clearTimeout(stagingTimer);
    stagingTimer = undefined;
    stagingVersion = undefined;
    stagingFeedUrl = undefined;
  };

  const clearConnectionRetry = () => {
    if (connectionRetryTimer) clearTimeout(connectionRetryTimer);
    connectionRetryTimer = undefined;
  };

  const scheduleConnectionRetry = (version: string): boolean => {
    if (connectionRetryVersion !== version) {
      connectionRetryVersion = version;
      connectionRetryAttempts = 0;
    }
    if (connectionRetryAttempts >= MAX_CONNECTION_RETRIES) return false;
    clearConnectionRetry();
    const delay = CONNECTION_RETRY_BASE_MS * (2 ** connectionRetryAttempts);
    connectionRetryAttempts += 1;
    connectionRetryTimer = setTimeout(() => {
      connectionRetryTimer = undefined;
      if (!disposed && latest.state === 'error' && latest.version === version && isCurrentCandidate(version)) {
        void check();
      }
    }, delay);
    return true;
  };

  const failed = (err: Error) => {
    if (disposed) return;
    console.warn('[updater] error:', err?.message ?? err);
    const phase = stagingVersion ? 'prepare' : downloadVersion ? 'download' : 'check';
    const version = stagingVersion ?? downloadVersion ?? (latest.state === 'error' ? latest.version : undefined);
    if (!version) return; // An unrelated feed failure cannot hide a ready update.
    clearStaging();
    downloadVersion = undefined;
    if (isCurrentCandidate(version)) {
      if (isDiskFull(err)) {
        send({ state: 'error', version, message: 'Not enough free space for the update. Free up space and retry.', retryable: true });
        return;
      }
      const message = phase === 'download'
        ? 'Could not download the update. Check your connection and retry.'
        : phase === 'prepare' ? 'Could not prepare the update. Please retry.' : 'Could not check for the update. Please retry.';
      // Retry verified network failures promptly. Native preparation failures
      // stay explicit: retrying a live Squirrel attempt would race its installer.
      const automaticRetry = phase !== 'prepare' && isConnectionInterrupted(err) && scheduleConnectionRetry(version);
      send({ state: 'error', version, message: automaticRetry ? 'Connection interrupted. Retrying automatically; you can keep browsing.' : message });
    }
  };

  const nativePreparationFailed = (message: string) => {
    if (!stagingVersion || disposed) return;
    console.warn('[updater] preparation:', message);
    if (stagingTimer) clearTimeout(stagingTimer);
    stagingTimer = undefined;
    // There is no public API that cancels Squirrel's native staging operation.
    // Keep this attempt and its feed correlation active instead of racing it
    // with a new download. A late matching ready event can still recover it.
    send({ state: 'error', version: stagingVersion, message: 'Quit and reopen BulleBrowser to finish preparing this update.', retryable: false });
  };

  const available = (info: { version: string }) => {
    if (disposed || !isCurrentCandidate(info.version) || downloadPromise || stagingVersion) return;
    if (latest.state === 'ready' && compare(info.version, latest.version) === 0) return;
    if (acknowledgedVersion && compare(info.version, acknowledgedVersion) <= 0) return;
    if (isMac && nativePreparedVersion) {
      if (compare(info.version, nativePreparedVersion) <= 0) return;
      if (latest.state === 'deferred' && compare(info.version, latest.version) === 0) return;
      // A new Squirrel feed can prune the already prepared bundle. Preserve it
      // until normal relaunch activates it; keep announcing newer releases.
      highestVersion = info.version;
      send({ state: 'deferred', version: info.version, preparedVersion: nativePreparedVersion });
      return;
    }
    highestVersion = info.version;
    if (installLocationError) {
      send({ state: 'error', version: info.version, message: installLocationError, retryable: false });
      return;
    }
    clearConnectionRetry();
    downloadVersion = info.version;
    send({ state: 'downloading', version: info.version });
    // updateInfoAndProvider is set before update-available, so this uses the
    // same verified feed result. The promise also serializes native staging.
    const version = info.version;
    const task = Promise.resolve()
      .then(() => disposed ? [] : autoUpdater.downloadUpdate())
      .then(() => undefined)
      .catch((err: Error) => {
        // electron-updater emits error and rejects its promise for the same
        // failure. Preserve the original download/staging explanation.
        if (latest.state === 'error' && latest.version === version && !downloadVersion && !stagingVersion) return;
        failed(err);
      })
      .finally(() => {
        if (downloadPromise === task) downloadPromise = undefined;
        if (downloadVersion === version) downloadVersion = undefined;
      });
    downloadPromise = task;
  };

  const downloaded = (info: { version: string }) => {
    if (disposed || !isCurrentCandidate(info.version)) return;
    if (isMac && nativePreparedVersion) return;
    if ((downloadVersion && downloadVersion !== info.version) || stagingVersion) return;
    if (latest.state === 'ready' && compare(info.version, latest.version) === 0) return;
    if (acknowledgedVersion && compare(info.version, acknowledgedVersion) <= 0) return;
    highestVersion = info.version;
    if (isMac) {
      // MacUpdater emits this before Squirrel finishes checking and staging the
      // signed bundle. Only Electron's native event confirms it is ready.
      clearStaging();
      stagingVersion = info.version;
      try {
        stagingFeedUrl = nativeAutoUpdater.getFeedURL();
        // Validate before accepting a readiness event from this native feed.
        new URL(stagingFeedUrl);
      } catch (err) {
        failed(err as Error);
        return;
      }
      send({ state: 'downloading', version: info.version, phase: 'preparing' });
      stagingTimer = setTimeout(() => {
        nativePreparationFailed('Native update preparation timed out');
      }, NATIVE_STAGING_TIMEOUT_MS);
    } else {
      clearConnectionRetry();
      connectionRetryAttempts = 0;
      downloadVersion = undefined;
      rememberPrepared(info.version);
      send({ state: 'ready', version: info.version });
    }
  };

  const nativeDownloaded = (...args: unknown[]) => {
    if (!stagingVersion || disposed) return;
    const updateUrl = args[4];
    if (!stagingFeedUrl) return;
    // Pinned Electron supplies the ZIP URL, including for a late completion
    // from a timed-out attempt. Correlate it with this package's native feed.
    if (typeof updateUrl !== 'string') return;
    try {
      const feed = new URL(stagingFeedUrl);
      const update = new URL(updateUrl);
      if (update.origin !== feed.origin || !update.pathname.startsWith(feed.pathname)) return;
    } catch {
      return;
    }
    const version = stagingVersion;
    clearStaging();
    downloadVersion = undefined;
    if (isCurrentCandidate(version)) {
      clearConnectionRetry();
      connectionRetryAttempts = 0;
      nativePreparedVersion = version;
      rememberPrepared(version);
      send({ state: 'ready', version });
    }
  };
  const progress = (info: { percent: number }) => {
    if (!downloadVersion || stagingVersion || latest.state !== 'downloading' || latest.version !== downloadVersion || !Number.isFinite(info.percent)) return;
    send({ state: 'downloading', version: downloadVersion, percent: Math.max(0, Math.min(100, Math.round(info.percent))) });
  };
  const unavailable = () => {
    // A cached/stale manifest cannot undo a known download, retryable error, or
    // staged update. Installed/same-version offers are filtered by the getter.
    if (latest.state === 'idle') publish();
  };
  const nativeUnavailable = () => {
    nativePreparationFailed('Native updater could not prepare the pending update');
  };

  autoUpdater.on('update-available', available);
  autoUpdater.on('update-downloaded', downloaded);
  autoUpdater.on('download-progress', progress);
  autoUpdater.on('update-not-available', unavailable);
  autoUpdater.on('error', failed);
  if (isMac) {
    nativeAutoUpdater.on('update-downloaded', nativeDownloaded);
    nativeAutoUpdater.on('update-not-available', nativeUnavailable);
  }

  const check = (): Promise<void> => {
    if (disposed || downloadPromise || stagingVersion) return Promise.resolve();
    if (checkPromise) return checkPromise;
    clearConnectionRetry();
    lastCheckTime = Date.now();
    checkError = undefined;
    const task = Promise.resolve()
      .then(() => disposed ? null : autoUpdater.checkForUpdates())
      .then(() => undefined)
      .catch((err: Error) => { checkError = err; failed(err); })
      .finally(() => {
        if (checkPromise === task) checkPromise = undefined;
      });
    checkPromise = task;
    return task;
  };
  const requestedCheck = async () => {
    clearConnectionRetry();
    connectionRetryAttempts = 0;
    // The error event arrives before the download promise settles. A click
    // during that gap must wait for cleanup instead of silently doing nothing.
    if (downloadPromise) await downloadPromise;
    await check();
    if (checkError) throw new Error('Could not check for updates. Check your connection and try again.');
  };
  requestCheck = requestedCheck;
  const focused = () => {
    if (Date.now() - lastCheckTime >= FOCUS_CHECK_INTERVAL_MS) void check();
  };
  const bind = (window: BrowserWindow) => {
    if (targetWindow === window) {
      publish();
      return;
    }
    targetWindow?.removeListener('focus', focused);
    targetWindow = window;
    window.on('focus', focused);
    window.once('closed', () => {
      window.removeListener('focus', focused);
      if (targetWindow === window) targetWindow = undefined;
    });
    publish();
  };
  bindWindow = bind;
  bind(win);
  void check();
  const timer = setInterval(() => {
    // Failed downloads use bounded backoff; native staging failures need an
    // explicit retry. Routine discovery must not bypass either policy.
    if (latest.state !== 'error') void check();
  }, CHECK_INTERVAL_MS);
  app.once('quit', () => {
    disposed = true;
    clearInterval(timer);
    clearStaging();
    clearConnectionRetry();
    targetWindow?.removeListener('focus', focused);
    targetWindow = undefined;
    autoUpdater.removeListener('update-available', available);
    autoUpdater.removeListener('update-downloaded', downloaded);
    autoUpdater.removeListener('download-progress', progress);
    autoUpdater.removeListener('update-not-available', unavailable);
    autoUpdater.removeListener('error', failed);
    if (isMac) {
      nativeAutoUpdater.removeListener('update-downloaded', nativeDownloaded);
      nativeAutoUpdater.removeListener('update-not-available', nativeUnavailable);
    }
    if (requestCheck === requestedCheck) requestCheck = undefined;
    if (stageUpdate === scheduled) stageUpdate = undefined;
    if (notifyStatus === publish) notifyStatus = undefined;
    if (bindWindow === bind) bindWindow = undefined;
  });
}
