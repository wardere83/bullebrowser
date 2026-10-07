const { after, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Use the shipped platform updater implementations. Only Electron/OS boundaries
// are replaced: these checks never quit a real app or launch an installer.
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
      execFileSync(command, args, options) {
        if (command === 'mv' && fixture.moveFiles && args[0] === '-f') {
          fixture.actions.push({ type: 'move' });
          fs.renameSync(args[1], args[2]);
          return Buffer.alloc(0);
        }
        if (command === fixture.appImagePath) {
          fixture.actions.push({ type: 'install-only', command, args, options });
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
  const quitHandlers = [];
  const nativeUpdater = new EventEmitter();
  nativeUpdater.quitAndInstall = () => actions.push({ type: 'native-install-and-reopen' });
  nativeUpdater.checkForUpdates = () => actions.push({ type: 'native-check' });
  const app = {
    version: '0.2.49',
    quit: () => actions.push({ type: 'quit' }),
    relaunch: () => actions.push({ type: 'relaunch' }),
    onQuit: callback => quitHandlers.push(callback),
  };
  fixture = { actions, quitHandlers, nativeUpdater, app };
  const updater = new Updater(undefined, app);
  updater.logger = null;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.autoRunAppAfterInstall = false;
  return { ...fixture, updater };
}

const nextImmediate = () => new Promise(resolve => setImmediate(resolve));

describe('installed platform updater keeps the current session open', { concurrency: false }, () => {
  test('Mac native staging never closes or reopens the window by itself', () => {
    const { updater, nativeUpdater, actions } = createFixture(MacUpdater);
    nativeUpdater.emit('update-downloaded');
    assert.equal(updater.squirrelDownloadedUpdate, true);
    assert.deepEqual(actions, []);
    assert.equal(nativeUpdater.listenerCount('update-downloaded'), 1);
    assert.equal(updater.autoRunAppAfterInstall, false);
  });

  test('Windows waits for normal quit and silently installs without forcing a reopen', async () => {
    const { updater, actions, quitHandlers } = createFixture(NsisUpdater);
    updater.downloadedUpdateHelper = {
      file: 'downloaded-update.exe',
      downloadedFileInfo: { isAdminRightsRequired: false },
    };
    updater.addQuitHandler();
    assert.equal(quitHandlers.length, 1);
    await nextImmediate();
    assert.deepEqual(actions, []);
    quitHandlers[0](0);
    await nextImmediate();
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, 'spawn');
    assert.equal(actions[0].command, 'downloaded-update.exe');
    assert.deepEqual(actions[0].args, ['--updated', '/S']);
    assert.equal(actions[0].options.detached, true);
    assert.equal(actions[0].options.stdio, 'ignore');
  });

  test('an abnormal Windows exit does not apply a pending installer', () => {
    const { updater, actions, quitHandlers } = createFixture(NsisUpdater);
    updater.downloadedUpdateHelper = {
      file: 'downloaded-update.exe',
      downloadedFileInfo: { isAdminRightsRequired: false },
    };
    updater.addQuitHandler();
    quitHandlers[0](1);
    assert.deepEqual(actions, []);
  });

  test('Linux replaces its AppImage only on normal quit and exits after installation', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bulle-updater-background-'));
    const previousAppImage = process.env.APPIMAGE;
    const appImagePath = path.join(directory, 'BulleBrowser.AppImage');
    const installerPath = path.join(directory, 'BulleBrowser-0.2.50.AppImage');
    fs.writeFileSync(appImagePath, 'old version');
    fs.writeFileSync(installerPath, 'updated version');
    process.env.APPIMAGE = appImagePath;
    try {
      const { updater, actions, quitHandlers } = createFixture(AppImageUpdater);
      fixture.moveFiles = true;
      fixture.appImagePath = appImagePath;
      updater.downloadedUpdateHelper = {
        file: installerPath,
        downloadedFileInfo: { isAdminRightsRequired: false },
      };
      updater.addQuitHandler();
      assert.deepEqual(actions, []);
      assert.equal(fs.readFileSync(appImagePath, 'utf8'), 'old version');
      quitHandlers[0](0);
      assert.deepEqual(actions.map(action => action.type), ['move', 'install-only']);
      assert.equal(fs.readFileSync(appImagePath, 'utf8'), 'updated version');
      assert.equal(fs.existsSync(installerPath), false);
      assert.equal(actions[1].options.env.APPIMAGE_SILENT_INSTALL, 'true');
      assert.equal(actions[1].options.env.APPIMAGE_EXIT_AFTER_INSTALL, 'true');
    } finally {
      if (previousAppImage === undefined) delete process.env.APPIMAGE;
      else process.env.APPIMAGE = previousAppImage;
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
