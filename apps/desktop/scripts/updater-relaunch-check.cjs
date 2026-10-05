const { after, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Exercise the installed updater implementations without launching an installer
// or quitting this test process. Only the Electron and OS process boundaries are
// replaced; install(), platform arguments, and quit scheduling remain real.
let fixture;
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'electron') return { autoUpdater: fixture.nativeUpdater };
  if (request === 'child_process' || request === 'node:child_process') {
    return {
      ...childProcess,
      spawn(command, args, options) {
        fixture.actions.push({ type: 'spawn', command, args, options });
        return Object.assign(new EventEmitter(), { pid: 12345, unref() {} });
      },
      execFileSync(command, args) {
        // AppImage replacement uses the OS's mv command. Perform that operation
        // on our temporary files directly so this check also runs on Windows.
        if (command === 'mv' && fixture.moveFiles && args[0] === '-f') {
          fixture.actions.push({ type: 'move', source: args[1], destination: args[2] });
          fs.renameSync(args[1], args[2]);
          return Buffer.alloc(0);
        }
        throw new Error(`Unexpected OS command in updater test: ${command}`);
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
after(() => { Module._load = originalLoad; });

const { MacUpdater } = require('electron-updater/out/MacUpdater.js');
const { NsisUpdater } = require('electron-updater/out/NsisUpdater.js');
const { AppImageUpdater } = require('electron-updater/out/AppImageUpdater.js');

function createFixture(Updater) {
  const actions = [];
  const nativeUpdater = new EventEmitter();
  nativeUpdater.quitAndInstall = () => actions.push({ type: 'native-install-and-reopen' });
  nativeUpdater.checkForUpdates = () => actions.push({ type: 'native-check' });
  nativeUpdater.on('before-quit-for-update', () => actions.push({ type: 'before-quit-for-update' }));
  const app = {
    version: '0.2.40',
    quit: () => actions.push({ type: 'quit' }),
    relaunch: () => actions.push({ type: 'relaunch' }),
  };
  fixture = { actions, nativeUpdater, app };
  const updater = new Updater(undefined, app);
  updater.logger = null;
  updater.autoRunAppAfterInstall = true;
  return { ...fixture, updater };
}

const nextImmediate = () => new Promise((resolve) => setImmediate(resolve));

describe('installed electron-updater restart behavior', { concurrency: false }, () => {
  test('Mac waits for Squirrel staging and then installs and reopens through the native updater', () => {
    const { updater, nativeUpdater, actions } = createFixture(MacUpdater);
    updater.autoInstallOnAppQuit = true;
    updater.quitAndInstall(true, true);
    assert.deepEqual(actions, []);

    nativeUpdater.emit('update-downloaded');
    assert.deepEqual(actions, [{ type: 'native-install-and-reopen' }]);
    assert.equal(updater.squirrelDownloadedUpdate, true);
  });

  test('Mac reopens immediately when Squirrel has already staged the update', () => {
    const { updater, nativeUpdater, actions } = createFixture(MacUpdater);
    nativeUpdater.emit('update-downloaded');
    updater.quitAndInstall(true, true);
    assert.deepEqual(actions, [{ type: 'native-install-and-reopen' }]);
  });

  test('Mac retry restarts native staging after removing only the failed request callback', () => {
    const { updater, nativeUpdater, actions } = createFixture(MacUpdater);
    const stagingListeners = nativeUpdater.listeners('update-downloaded');
    const beforeRequest = new Set(stagingListeners);
    updater.quitAndInstall(true, true);
    const requestListeners = nativeUpdater.listeners('update-downloaded')
      .filter((listener) => !beforeRequest.has(listener));
    assert.equal(requestListeners.length, 1);

    nativeUpdater.emit('error', new Error('Squirrel could not stage the update'));
    // The real MacUpdater leaves this callback behind after failure. The app
    // must cancel its owned request before retrying, preserving the library's
    // own listener that marks the native update as staged.
    assert.equal(nativeUpdater.listeners('update-downloaded').includes(requestListeners[0]), true);
    for (const listener of requestListeners) nativeUpdater.removeListener('update-downloaded', listener);
    assert.deepEqual(nativeUpdater.listeners('update-downloaded'), stagingListeners);

    updater.quitAndInstall(true, true);
    // autoInstallOnAppQuit is true, so MacUpdater assumes the original staging
    // request is still running and does not start another check by itself.
    assert.deepEqual(actions, []);
    nativeUpdater.checkForUpdates();
    nativeUpdater.emit('update-downloaded');
    assert.equal(updater.squirrelDownloadedUpdate, true);
    assert.deepEqual(actions, [{ type: 'native-check' }, { type: 'native-install-and-reopen' }]);
  });

  test('NSIS starts a silent installer with forced reopen before scheduling app shutdown', async () => {
    const { updater, actions } = createFixture(NsisUpdater);
    // Seed the state produced by a completed download; no real executable is
    // needed because the process-spawn boundary above records the invocation.
    const installerPath = 'downloaded-update.exe';
    updater.downloadedUpdateHelper = {
      file: installerPath,
      downloadedFileInfo: { isAdminRightsRequired: false },
    };
    updater.quitAndInstall(true, true);

    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, 'spawn');
    assert.equal(actions[0].command, installerPath);
    assert.deepEqual(actions[0].args, ['--updated', '/S', '--force-run']);
    assert.equal(actions[0].options.detached, true);
    assert.equal(actions[0].options.stdio, 'ignore');

    await nextImmediate();
    assert.deepEqual(actions.map(({ type }) => type), ['spawn', 'before-quit-for-update', 'quit']);
    // Reopening belongs to the installer after replacement, not app.relaunch().
    assert.equal(actions.some(({ type }) => type === 'relaunch'), false);
  });

  test('NSIS keeps the app running when there is no staged installer', async () => {
    const { updater, actions } = createFixture(NsisUpdater);
    const errors = [];
    updater.on('error', (error) => errors.push(error));
    updater.quitAndInstall(true, true);
    await nextImmediate();

    assert.deepEqual(actions, []);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /No update filepath provided/);
    assert.equal(updater.quitAndInstallCalled, false);
  });

  test('AppImage replaces the installed file and launches the update before quitting', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bulle-updater-relaunch-'));
    const previousAppImage = process.env.APPIMAGE;
    const appImagePath = path.join(directory, 'BulleBrowser.AppImage');
    const installerPath = path.join(directory, 'BulleBrowser-0.2.41.AppImage');
    fs.writeFileSync(appImagePath, 'old version');
    fs.writeFileSync(installerPath, 'updated version');
    process.env.APPIMAGE = appImagePath;
    try {
      const { updater, actions } = createFixture(AppImageUpdater);
      fixture.moveFiles = true;
      updater.downloadedUpdateHelper = {
        file: installerPath,
        downloadedFileInfo: { isAdminRightsRequired: false },
      };
      updater.quitAndInstall(true, true);
      assert.deepEqual(actions.map(({ type }) => type), ['move', 'spawn']);
      assert.equal(fs.readFileSync(appImagePath, 'utf8'), 'updated version');
      assert.equal(fs.existsSync(installerPath), false);
      assert.equal(actions[1].command, appImagePath);
      assert.deepEqual(actions[1].args, []);
      assert.equal(actions[1].options.env.APPIMAGE_SILENT_INSTALL, 'true');

      await nextImmediate();
      assert.deepEqual(actions.map(({ type }) => type), ['move', 'spawn', 'before-quit-for-update', 'quit']);
    } finally {
      if (previousAppImage === undefined) delete process.env.APPIMAGE;
      else process.env.APPIMAGE = previousAppImage;
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
