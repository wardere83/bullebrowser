import { createServer } from 'node:http';
import { test, expect, _electron as electron } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');

async function launch(
  {
    openAiOnly = false,
    withoutOpenAiKey = false,
    withoutKeys = false,
  }: { openAiOnly?: boolean; withoutOpenAiKey?: boolean; withoutKeys?: boolean } = {},
) {
  // Fresh user-data dir per test so we always start from default settings.
  const userData = mkdtempSync(join(tmpdir(), 'bullebrowser-e2e-'));

  // ELECTRON_RUN_AS_NODE must NOT be inherited. If it is set, the Electron
  // binary runs as plain Node: there is no app and no window, and the
  // --remote-debugging-port Playwright passes ahead of the app path is parsed
  // as a Node flag, so launch dies with "bad option:
  // --remote-debugging-port=0". Some editor/agent shells export it, which makes
  // the whole suite look like a Playwright/Electron incompatibility when it is
  // really just a stray environment variable.
  const env = { ...process.env, NODE_ENV: 'test' };
  delete env.ELECTRON_RUN_AS_NODE;

  // Keep provider configuration deterministic; fixture keys never reach the
  // network. Keyless cases explicitly clear development environment keys.
  delete env.ANTHROPIC_API_KEY;
  delete env.OPENAI_API_KEY;
  env.ANTHROPIC_API_KEY = '';
  if (!openAiOnly && !withoutKeys) {
    env.ANTHROPIC_API_KEY = 'sk-ant-e2e-fixture-key-not-real-0000000000000000';
  }
  // Empty values prevent development .env keys leaking into keyless tests.
  env.OPENAI_API_KEY = withoutOpenAiKey || withoutKeys
    ? ''
    : 'sk-e2e-fixture-key-not-real-0000000000000000';

  const app = await electron.launch({
    args: ['.', '--no-sandbox', `--user-data-dir=${userData}`],
    cwd: appRoot,
    env,
  });
  const win = await app.firstWindow({ timeout: 20_000 });
  await win.waitForLoadState('domcontentloaded');

  // The panel ships open by default; open it idempotently either way.
  const panel = win.getByRole('complementary', { name: 'Assistant chat' });
  if (!(await panel.isVisible().catch(() => false))) {
    await win.getByRole('button', { name: 'Your Assistant' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 10_000 });
  return { app, win, userData };
}

test('the agent panel mounts with its composer', async () => {
  const { app, win } = await launch();
  await expect(win.getByRole('complementary', { name: 'Assistant chat' })).toBeVisible();
  await expect(win.locator('aside textarea')).toBeEnabled();
  await app.close();
});

test('the composer exposes the attachment menu and voice controls', async () => {
  const { app, win } = await launch();
  await expect(win.locator('[aria-label="Add attachment"]')).toBeVisible();
  await expect(win.locator('[aria-label="Voice input"]')).toBeVisible();
  await expect(win.locator('[aria-label="Voice Mode"]')).toBeVisible();
  await expect(win.locator('[aria-label="Open bullebrowser.com"]')).toBeVisible();
  const footer = await win.locator('aside footer').boundingBox();
  const attachment = await win.getByRole('button', { name: 'Add attachment', exact: true }).boundingBox();
  const mic = await win.getByRole('button', { name: 'Voice input', exact: true }).boundingBox();
  const voice = await win.getByRole('button', { name: 'Voice Mode', exact: true }).boundingBox();
  expect(mic!.x).toBeGreaterThan(attachment!.x + attachment!.width + 100);
  expect(Math.abs(voice!.x + voice!.width - (footer!.x + footer!.width - 12))).toBeLessThan(4);
  expect(Math.abs(voice!.y - mic!.y)).toBeLessThan(1);
  await app.close();
});

test('a saved OpenAI key enables the assistant and voice controls', async () => {
  const { app, win } = await launch({ openAiOnly: true });
  const savedModel = await win.evaluate(async () => {
    await window.bullebrowser.secrets.setApiKey(
      'sk-e2e-saved-openai-key-not-real-0000000000000000',
      'openai',
    );
    await window.bullebrowser.settings.set({ defaultModel: 'gpt-4o' });
    return (await window.bullebrowser.settings.get()).defaultModel;
  });
  expect(savedModel).toBe('gpt-4o');
  await win.reload();
  await expect(win.locator('aside textarea')).toBeEnabled();
  await expect(win.locator('[aria-label="Voice input"]')).toBeVisible();
  await expect(win.locator('[aria-label="Voice Mode"]')).toBeVisible();
  await app.close();
});

test('voice controls open without an OpenAI key', async () => {
  const { app, win } = await launch({ withoutOpenAiKey: true });
  await win.locator('[aria-label="Voice input"]').click();
  await expect(win.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(win.getByText('Voice (OpenAI) key', { exact: true })).toBeHidden();
  await app.close();
});

test('the "+" menu opens with every attachment source', async () => {
  const { app, win } = await launch();
  await win.locator('[aria-label="Add attachment"]').click();
  for (const label of ['Upload your file', 'Screenshot', 'Projects', 'Control Browser']) {
    await expect(win.getByText(label, { exact: true })).toBeVisible();
  }
  // The 8-day retention promise is part of the contract with the user.
  await expect(win.getByText(/retained for 8 days/i)).toBeVisible();
  await app.close();
});

test('the "+" menu closes on an outside click', async () => {
  const { app, win } = await launch();
  await win.locator('[aria-label="Add attachment"]').click();
  await expect(win.getByText('Upload your file', { exact: true })).toBeVisible();
  await win.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(win.getByText('Upload your file', { exact: true })).toBeHidden();
  await app.close();
});

// The overlay must appear and be dismissable even where no microphone exists —
// the path most users hit first if permissions are not yet granted.
test('voice input opens an overlay that can be dismissed', async () => {
  const { app, win } = await launch();
  await win.locator('[aria-label="Voice input"]').click();
  await expect(win.getByRole('button', { name: 'Cancel' })).toBeVisible({ timeout: 10_000 });
  await win.getByRole('button', { name: 'Cancel' }).click();
  await expect(win.getByRole('button', { name: 'Cancel' })).toBeHidden();
  await expect(win.locator('aside textarea')).toBeEnabled();
  await app.close();
});

test('Voice Mode opens live voice controls and stops again', async () => {
  const { app, win } = await launch();
  await win.locator('[aria-label="Voice Mode"]').click();
  const stop = win.getByRole('button', { name: 'Stop Voice Mode' });
  await expect(stop).toBeVisible({ timeout: 10_000 });
  await stop.click();
  await expect(stop).toBeHidden();
  await app.close();
});

// Whether a microphone exists varies by machine, so don't assert a specific
// outcome — assert the invariant that used to be violated: the overlay must
// never STAY on "Starting microphone…". It has to resolve one way or the
// other (listening, or an actionable error), rather than hang forever.
test('microphone startup always resolves and never hangs', async () => {
  const { app, win } = await launch();
  await win.locator('[aria-label="Voice input"]').click();
  await expect(win.getByText(/Starting microphone/i)).toBeVisible({ timeout: 5_000 });
  await expect(win.getByText(/Starting microphone/i)).toBeHidden({ timeout: 20_000 });
  await app.close();
});

// Synthetic audio uses real browser MediaStream tracks. Only the provider's
// transport and browser-task IPC are replaced, so no key or microphone is used.
const VOICE_MEDIA_FIXTURE = String.raw`(function installMediaMock(){
  const probe=window.__voiceProbe={mic:null,contexts:[],recorder:null,spoken:[]};
  navigator.mediaDevices.getUserMedia=async()=>{
    const context=new AudioContext();probe.contexts.push(context);
    const destination=context.createMediaStreamDestination();
    const oscillator=context.createOscillator();oscillator.frequency.value=440;oscillator.connect(destination);oscillator.start();
    await context.resume();probe.mic=destination.stream;return destination.stream;
  };
  const Recorder=window.MediaRecorder;
  window.MediaRecorder=class extends Recorder { constructor(...args){super(...args);probe.recorder=this;} };
  window.speechSynthesis.speak=utterance=>{probe.spoken.push(utterance.text);setTimeout(()=>utterance.onend?.(),0);};
})();`;
const VOICE_MAIN_FIXTURE = String.raw`
const { ipcMain, BrowserWindow } = electron;

    const probe=globalThis.__voiceMainProbe={runs:[],cancels:[],connects:0,disconnects:[],pending:null,spoken:[]};
    const contents=BrowserWindow.getAllWindows()[0].webContents;
    const replace=(channel,handler)=>{ipcMain.removeHandler(channel);ipcMain.handle(channel,handler);};
    const finish=(status,text)=>{
      const pending=probe.pending;if(!pending)return;
      if(text)conversation.messages.push({role:'assistant',content:text,timestamp:Date.now()});
      contents.send('agent:step',{runId:pending.runId,step:{kind:'text',text,ts:Date.now()}});
      contents.send('agent:step',{runId:pending.runId,step:{kind:'done',ts:Date.now()}});
      contents.send('agent:result',{runId:pending.runId,conversationId:conversation.id,status,text});
      probe.pending=null;
    };
    replace('conversation:get',()=>structuredClone(conversation));
    replace('voice:transcribe',(_event,audio)=>{if(!(audio instanceof Float32Array)||!audio.length)throw new Error('Expected PCM audio');return {text:probe.nextTranscript || 'Read this page and tell me its requirements.'};});
    // The bundled voice is exercised for real by scripts/check-neural-voice.mjs;
    // here its clips are short tones so the suite needs no model files.
    replace('voice:prepare-speech',()=>{});
    replace('voice:synthesize',(_event,text)=>{probe.spoken.push(text);return {audio:new Float32Array(2205).fill(0.01),sampleRate:44100};});
    replace('voice:connect-realtime',()=>{probe.connects++;return {answerSdp:'mock-answer',callId:'rtc_runtime_call'};});
    replace('voice:disconnect-realtime',(_event,id)=>{probe.disconnects.push(id);});
    replace('agent:run',(_event,request)=>{
      probe.runs.push(request);conversation.messages.push({role:'user',content:request.userMessage,timestamp:Date.now()});
      const runId='runtime-run-'+probe.runs.length;probe.pending={runId,request};
      contents.send('agent:step',{runId,step:{kind:'thinking',ts:Date.now()}});
      contents.send('agent:confirm-request',{runId,id:'runtime-confirm',kind:'browse_access',message:request.userMessage});
      return {runId};
    });
    replace('agent:confirm-reply',(_event,_run,_id,approved)=>finish(approved?'completed':'cancelled',approved?'The browser task finished with a verified answer.':'The task was declined.'));
    replace('agent:cancel',(_event,runId)=>{probe.cancels.push(runId);finish('cancelled','The browser task was stopped.');});
`;

test('keyless live voice records audio, handles approvals, speaks results, and cancels on stop', async () => {
  const { app, win } = await launch({ withoutOpenAiKey: true });
  try {
    const seed = await win.evaluate(async () => {
      const list = await window.bullebrowser.conversations.list();
      return list.length ? window.bullebrowser.conversations.get(list[0]!.id) : window.bullebrowser.conversations.create();
    });
    await app.evaluate((electronModule, fixture) => {
      const install = new Function('electron', 'conversation', fixture.source);
      install(electronModule, fixture.conversation);
    }, { source: VOICE_MAIN_FIXTURE, conversation: seed });
    await win.evaluate(VOICE_MEDIA_FIXTURE);
    const mainProbe = () => app.evaluate(() => JSON.parse(JSON.stringify((globalThis as Record<string, unknown>).__voiceMainProbe)));
    await win.getByRole('button', { name: 'Voice Mode', exact: true }).click();
    await expect(win.getByRole('button', { name: 'Mute microphone', exact: true })).toBeEnabled();
    await win.getByRole('button', { name: 'Mute microphone', exact: true }).click();
    expect(await win.evaluate('window.__voiceProbe.mic.getAudioTracks()[0].enabled')).toBe(false);
    await win.getByRole('button', { name: 'Unmute microphone', exact: true }).click();
    expect(await win.evaluate('window.__voiceProbe.mic.getAudioTracks()[0].enabled')).toBe(true);
    // Wait for actual MediaRecorder data; no provider transport is used.
    await win.evaluate('new Promise(resolve => setTimeout(resolve, 800))');
    await win.evaluate('window.__voiceProbe.recorder.stop()');
    const approval = win.getByRole('button', { name: 'Allow Access', exact: true });
    await expect(approval).toBeVisible();
    await approval.click();
    await expect.poll(async () => (await mainProbe()).spoken).toContain('The browser task finished with a verified answer.');
    expect(await win.evaluate('window.__voiceProbe.spoken')).toEqual([]);
    expect((await mainProbe()).runs).toHaveLength(1);
    expect((await mainProbe()).connects).toBe(0);
    await expect(win.getByRole('region', { name: 'Live Voice Mode' }).getByText('The browser task finished with a verified answer.', { exact: false })).toBeVisible();
    await win.evaluate('new Promise(resolve => setTimeout(resolve, 800))');
    await win.evaluate('window.__voiceProbe.recorder.stop()');
    await expect(approval).toBeVisible();
    await expect(win.getByRole('button', { name: 'Cancel browser task', exact: true })).toBeVisible();
    await app.evaluate(() => { (globalThis as any).__voiceMainProbe.nextTranscript = 'Cancel this browser task.'; });
    await win.evaluate('new Promise(resolve => setTimeout(resolve, 800))');
    await win.evaluate('window.__voiceProbe.recorder.stop()');
    await expect(approval).toBeHidden();
    expect((await mainProbe()).cancels).toEqual(['runtime-run-2']);
    await expect(win.getByRole('region', { name: 'Live Voice Mode' })).toBeVisible();
    await app.evaluate(() => { (globalThis as any).__voiceMainProbe.nextTranscript = ''; });
    await win.evaluate('new Promise(resolve => setTimeout(resolve, 800))');
    await win.evaluate('window.__voiceProbe.recorder.stop()');
    await expect(approval).toBeVisible();
    await win.getByRole('button', { name: 'Stop Voice Mode', exact: true }).click();
    await expect(win.getByRole('region', { name: 'Live Voice Mode' })).toBeHidden();
    await expect(approval).toBeHidden();
    await win.waitForFunction('window.__voiceProbe.mic.getAudioTracks().every(track => track.readyState === "ended")');
    expect((await mainProbe()).cancels).toEqual(['runtime-run-2', 'runtime-run-3']);
  } finally {
    await win.evaluate('Promise.all(window.__voiceProbe?.contexts.map(context => context.close()) ?? [])').catch(() => {});
    await app.close();
  }
});

test('dictation and Voice Mode open with no assistant keys configured', async () => {
  const { app, win } = await launch({ withoutKeys: true });
  try {
    await win.getByRole('button', { name: 'Voice input', exact: true }).click();
    await expect(win.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await win.getByRole('button', { name: 'Cancel' }).click();
    await win.getByRole('button', { name: 'Voice Mode', exact: true }).click();
    await expect(win.getByRole('region', { name: 'Live Voice Mode' })).toBeVisible();
  } finally { await app.close(); }
});


test('dictation releases the microphone as soon as Send is pressed', async () => {
  const { app, win } = await launch({ withoutKeys: true });
  try {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('voice:transcribe');
      ipcMain.handle('voice:transcribe', () => new Promise(() => {}));
    });
    await win.evaluate(VOICE_MEDIA_FIXTURE);
    await win.getByRole('button', { name: 'Voice input', exact: true }).click();
    const send = win.getByRole('dialog', { name: 'Voice input', exact: true }).getByRole('button', { name: 'Send', exact: true });
    await expect(send).toBeEnabled();
    await win.evaluate('new Promise(resolve => setTimeout(resolve, 800))');
    await send.click();
    await expect(win.getByRole('dialog', { name: 'Voice input' }).getByText(/Transcribing/)).toBeVisible();
    await win.waitForFunction('window.__voiceProbe.mic.getTracks().every(track => track.readyState === "ended")');
  } finally {
    await win.evaluate('Promise.all(window.__voiceProbe?.contexts.map(context => context.close()) ?? [])').catch(() => {});
    await app.close();
  }
});

test('dictation releases permission granted after cancellation', async () => {
  const { app, win } = await launch({ withoutKeys: true });
  try {
    await win.evaluate(() => {
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        configurable: true,
        value: () => new Promise((resolve) => setTimeout(() => resolve({
          getTracks: () => [{ stop: () => { document.body.dataset.lateMicStopped = 'yes'; } }],
        }), 1000)),
      });
    });
    await win.getByRole('button', { name: 'Voice input', exact: true }).click();
    await win.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(win.locator('body')).toHaveAttribute('data-late-mic-stopped', 'yes');
  } finally { await app.close(); }
});


test('updates show progress, keep browsing open, clear after preparation and return for a later release', async () => {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Work during update</title><h1>Continue working</h1>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No update test port');
  const url = `http://127.0.0.1:${address.port}/`;
  const { app, win, userData } = await launch({ withoutKeys: true });
  try {
    const processId = await app.evaluate(() => process.pid);
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      ipcMain.removeHandler('update:get-status');
      ipcMain.handle('update:get-status', () => new Promise(resolve => {
        ipcMain.once('test:resolve-update-status', () => resolve({ state: 'idle' }));
      }));
      let attempts = 0;
      ipcMain.removeHandler('update:prepare');
      ipcMain.handle('update:prepare', (_event, version: string) => {
        attempts += 1;
        (globalThis as Record<string, unknown>).__updatePrepare = { attempts, version };
        if (attempts === 1) throw new Error('Preparation fixture failure');
        BrowserWindow.getAllWindows()[0].webContents.send('update:status', { state: 'idle' });
      });
      ipcMain.removeHandler('update:retry');
      ipcMain.handle('update:retry', () => {
        BrowserWindow.getAllWindows()[0].webContents.send('update:status', { state: 'downloading', version: '0.2.50', percent: 0 });
      });
      ipcMain.removeHandler('update:dismiss');
      ipcMain.handle('update:dismiss', (_event, version: string) => {
        (globalThis as Record<string, unknown>).__dismissedUpdate = version;
        BrowserWindow.getAllWindows()[0].webContents.send('update:status', { state: 'idle' });
      });
    });
    await win.reload();
    const composer = win.locator('aside textarea');
    await expect(composer).toBeEnabled();
    await composer.fill('Keep this work while updating.');
    await win.evaluate(async target => {
      const tabs = await window.bullebrowser.tabs.list();
      await window.bullebrowser.tabs.navigate(tabs.find(tab => tab.active)!.id, target);
    }, url);
    const notice = win.getByRole('region', { name: 'App update' });
    const update = win.getByRole('button', { name: 'Update App', exact: true });
    await expect(notice).toBeHidden();
    await app.evaluate(({ BrowserWindow, ipcMain }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('update:status', { state: 'downloading', version: '0.2.50', percent: 25 });
      // A delayed initial idle snapshot must not erase a newer event.
      ipcMain.emit('test:resolve-update-status');
    });
    await expect(notice).toContainText('Downloading v0.2.50 · 25%');
    await expect(win.getByRole('progressbar', { name: 'Update download progress' })).toHaveAttribute('value', '25');
    await expect(update).toBeHidden();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('update:status', { state: 'error', version: '0.2.50', message: 'Check your connection and retry.' });
    });
    await expect(notice).toContainText('Check your connection and retry.');
    await win.getByRole('button', { name: 'Retry update', exact: true }).click();
    await expect(notice).toContainText('Downloading v0.2.50 · 0%');
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('update:status', { state: 'downloading', version: '0.2.50', percent: 100, phase: 'preparing' });
    });
    await expect(notice).toContainText('Preparing v0.2.50');
    await expect(win.getByRole('progressbar', { name: 'Update download progress' })).not.toHaveAttribute('value');
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('update:status', { state: 'error', version: '0.2.50', message: 'Reopen BulleBrowser to finish preparing this update.', retryable: false });
    });
    await expect(notice).toContainText('Reopen BulleBrowser');
    await expect(win.getByRole('button', { name: 'Retry update', exact: true })).toBeHidden();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('update:status', { state: 'ready', version: '0.2.50' });
    });
    await expect(update).toBeVisible();
    await expect(notice).toContainText('Applies after you quit and reopen');
    await expect(update).toHaveAttribute('title', /without closing the app/);
    await update.click();
    await expect(notice).toContainText('Couldn’t prepare. Try again.');
    await expect(update).toBeEnabled();
    await update.click();
    await expect(update).toBeHidden();
    await expect(notice).toBeHidden();
    await expect(win.getByRole('status').filter({ hasText: 'v0.2.50 prepared.' })).toBeVisible();
    await expect.poll(() => app.evaluate(() => (globalThis as Record<string, unknown>).__updatePrepare))
      .toEqual({ attempts: 2, version: '0.2.50' });
    expect(await app.evaluate(() => process.pid)).toBe(processId);
    await expect(composer).toHaveValue('Keep this work while updating.');
    await expect.poll(() => app.evaluate(({ BrowserWindow }, target) => {
      const browserWindow = BrowserWindow.getAllWindows()[0];
      const page = browserWindow.contentView.children.find(view =>
        'webContents' in view && (view as import('electron').WebContentsView).webContents.getURL() === target,
      ) as import('electron').WebContentsView | undefined;
      return { open: !browserWindow.isDestroyed(), pageVisible: page?.getVisible(), pageUrl: page?.webContents.getURL() };
    }, url)).toEqual({ open: true, pageVisible: true, pageUrl: url });
    // The main-process acknowledgment survives reloading the renderer.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('update:get-status');
      ipcMain.handle('update:get-status', () => ({ state: 'idle' }));
    });
    await win.reload();
    await expect(composer).toBeEnabled();
    await expect(update).toBeHidden();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('update:status', { state: 'ready', version: '0.2.51' });
    });
    await expect(update).toBeVisible();
    await expect(update).toHaveAttribute('title', /0\.2\.51/);
    await win.screenshot({ path: '/tmp/bulle-background-update.png' });
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('update:status', { state: 'deferred', version: '0.2.52', preparedVersion: '0.2.50' });
    });
    await expect(notice).toContainText('v0.2.52 available');
    await expect(notice).toContainText('After v0.2.50’s next launch');
    await expect(update).toBeHidden();
    await win.getByRole('button', { name: 'Got it', exact: true }).click();
    await expect(notice).toBeHidden();
    expect(await app.evaluate(() => (globalThis as Record<string, unknown>).__dismissedUpdate)).toBe('0.2.52');
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('update:status', { state: 'deferred', version: '0.2.53', preparedVersion: '0.2.50' });
    });
    await expect(notice).toContainText('v0.2.53 available');
    expect(await app.evaluate(() => process.pid)).toBe(processId);
    if (process.platform === 'darwin') {
      // Red-dot close keeps the Mac process alive; opening it again must rebind
      // its window and IPC instead of leaving the updater attached to a dead UI.
      const reopened = app.waitForEvent('window');
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0);
      await app.evaluate(({ app: electronApp }) => { electronApp.emit('second-instance'); });
      const next = await reopened;
      await expect(next.locator('aside textarea')).toBeEnabled();
      await expect(next.getByRole('region', { name: 'BulleBrowser funding introduction' })).toBeVisible();
      await next.getByRole('button', { name: 'Organization Knowledge Hub', exact: true }).click();
      await expect(next.getByRole('region', { name: 'Funding workspace' })).toBeVisible();
      expect(await app.evaluate(() => process.pid)).toBe(processId);
    }
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});


test('chat and spoken browser tasks use the real local assistant without any keys', async () => {
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<html><head><title>Local grants fixture</title></head><body><main><h1>Grant deadlines</h1><p>Grant applications close on December 15. Eligible schools can request funding for accessible classrooms.</p></main></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/`;
  const { app, win } = await launch({ withoutKeys: true });
  try {
    await win.evaluate(async (target) => {
      const tabs = await window.bullebrowser.tabs.list();
      const active = tabs.find((tab) => tab.active)!;
      await window.bullebrowser.tabs.navigate(active.id, target);
    }, url);
    await expect(win.getByText('Add your key to start — it stays on this device.', { exact: true })).toBeHidden();
    await win.locator('aside textarea').fill('summarize this page');
    await win.getByRole('button', { name: 'Send', exact: true }).click();
    const approval = win.getByRole('button', { name: 'Allow Access', exact: true });
    await expect(approval).toBeVisible();
    await approval.click();
    const replies = () => win.evaluate(async () => {
      const conversations = await window.bullebrowser.conversations.list();
      const conversation = await window.bullebrowser.conversations.get(conversations[0]!.id);
      return conversation!.messages.filter((message) => message.role === 'assistant').map((message) => message.content);
    });
    await expect.poll(replies).toEqual([expect.stringContaining('Grant applications close on December 15.')]);
    expect((await replies())[0]).toContain(url);
    await expect(win.getByRole('heading', { name: 'Settings', exact: true })).toBeHidden();
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('voice:transcribe');
      ipcMain.handle('voice:transcribe', () => ({ text: 'summarize this page' }));
    });
    await win.evaluate(VOICE_MEDIA_FIXTURE);
    await win.getByRole('button', { name: 'Voice Mode', exact: true }).click();
    await expect(win.getByRole('button', { name: 'Mute microphone', exact: true })).toBeEnabled();
    await win.evaluate('new Promise(resolve => setTimeout(resolve, 800))');
    await win.evaluate('window.__voiceProbe.recorder.stop()');
    await expect(approval).toBeVisible();
    await approval.click();
    await expect(win.getByRole('region', { name: 'Live Voice Mode' }).getByText(/Grant applications close on December 15/)).toBeVisible();
    await win.getByRole('button', { name: 'Stop Voice Mode', exact: true }).click();
  } finally {
    await win.evaluate('Promise.all(window.__voiceProbe?.contexts.map(context => context.close()) ?? [])').catch(() => {});
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

for (const interaction of ['click', 'keyboard', 'middle', 'same-window fallback'] as const) {
  test(`chat result links open in the web pane via ${interaction}`, async () => {
    const server = createServer((_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<html><head><title>Search source</title></head><body><h1>Source opened in a browser tab</h1></body></html>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/source`;
    const { app, win } = await launch({ withoutKeys: true });
    try {
      const chromeUrl = win.url();
      const seed = await win.evaluate(async () => {
        const list = await window.bullebrowser.conversations.list();
        return window.bullebrowser.conversations.get(list[0]!.id);
      });
      await app.evaluate(({ ipcMain, BrowserWindow }, fixture) => {
        const conversation = fixture.conversation!;
        ipcMain.removeHandler('conversation:get');
        ipcMain.handle('conversation:get', () => conversation);
        ipcMain.removeHandler('agent:run');
        ipcMain.handle('agent:run', (_event, request) => {
          const text = `Search result: [Open source](${fixture.url})`;
          conversation.messages.push({ role: 'user', content: request.userMessage, timestamp: Date.now() });
          conversation.messages.push({ role: 'assistant', content: text, timestamp: Date.now() });
          setTimeout(() => {
            const contents = BrowserWindow.getAllWindows()[0].webContents;
            contents.send('agent:step', { runId: 'link-run', step: { kind: 'done', ts: Date.now() } });
            contents.send('agent:result', { runId: 'link-run', conversationId: conversation.id, status: 'completed', text });
          }, 50);
          return { runId: 'link-run' };
        });
      }, { conversation: seed, url });
      await win.locator('aside textarea').fill('Find a source');
      await win.getByRole('button', { name: 'Send', exact: true }).click();
      const link = win.getByRole('link', { name: 'Open source', exact: true });
      await expect(link).toBeVisible();
      if (interaction === 'keyboard') {
        await link.focus();
        await link.press('Enter');
      } else if (interaction === 'middle') {
        await link.click({ button: 'middle' });
      } else {
        if (interaction === 'same-window fallback') await link.evaluate((element) => element.removeAttribute('target'));
        await link.click({ noWaitAfter: interaction === 'same-window fallback' });
      }
      await expect.poll(() => win.evaluate(async () => {
        const tabs = await window.bullebrowser.tabs.list();
        return tabs.find((tab) => tab.active)?.url;
      })).toBe(url);
      expect(win.url()).toBe(chromeUrl);
      // Electron cancels the same-window navigation in will-navigate. Read
      // the native frame directly: Playwright's navigation waiter does not
      // receive a completed navigation for an intentionally cancelled load.
      const readChrome = () => app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(`({
          hasSource: !!Array.from(document.querySelectorAll('aside a')).find(a => a.textContent === 'Open source'),
          composerEnabled: !!document.querySelector('aside textarea') && !document.querySelector('aside textarea').disabled,
          chatX: document.querySelector('aside').getBoundingClientRect().x
        })`),
      );
      const chrome = await readChrome();
      expect(chrome.hasSource).toBe(true);
      expect(chrome.composerEnabled).toBe(true);
      const readBounds = () => app.evaluate(({ BrowserWindow }, target) => {
        const view = BrowserWindow.getAllWindows()[0].contentView.children.find((child) =>
          'webContents' in child && (child as Electron.WebContentsView).webContents.getURL() === target,
        );
        return view?.getBounds();
      }, url);
      await expect.poll(readBounds).toBeTruthy();
      const bounds = await readBounds();
      const chatX = (await readChrome()).chatX;
      expect(bounds).toBeTruthy();
      expect(bounds!.width).toBeGreaterThan(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(chatX + 1);
      if (interaction !== 'same-window fallback') {
        await win.locator('aside textarea').fill('Continue the same conversation');
        await expect(win.locator('aside textarea')).toHaveValue('Continue the same conversation');
      }
    } finally {
      await app.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}
