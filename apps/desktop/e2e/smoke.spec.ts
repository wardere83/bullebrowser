import { createServer } from 'node:http';
import { test, expect, _electron as electron } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');

async function launch(
  {
    openAiOnly = false,
    withoutOpenAiKey = false,
    withoutKeys = false,
    restoredTabs,
  }: { openAiOnly?: boolean; withoutOpenAiKey?: boolean; withoutKeys?: boolean; restoredTabs?: { urls: string[]; activeIndex: number } } = {},
) {
  // Fresh user-data dir per test so we always start from default settings.
  const userData = mkdtempSync(join(tmpdir(), 'bullebrowser-e2e-'));
  if (restoredTabs) writeFileSync(join(userData, 'update-session.json'), JSON.stringify({ session: restoredTabs }));

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
  env.BRAVE_SEARCH_API_KEY = '';
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
  await app.firstWindow({ timeout: 20_000 });
  // Restored native source tabs can load before the app chrome. Select the
  // renderer explicitly instead of mistaking a source page for the app UI.
  await expect.poll(() => app.windows().some((page) => page.url().includes('/renderer/index.html'))).toBe(true);
  const win = app.windows().find((page) => page.url().includes('/renderer/index.html'))!;
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
  await expect(win.locator('aside textarea.prompt-input-field')).toBeEnabled();
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
  const secureStorage = await app.evaluate(({ safeStorage }) =>
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'));
  if (!secureStorage) {
    // Headless Linux has no credential service. Refusing insecure persistence
    // is the required behavior; do not weaken production encryption for CI.
    await expect(win.evaluate(() => window.bullebrowser.secrets.setApiKey(
      'sk-e2e-saved-openai-key-not-real-0000000000000000', 'openai',
    ))).rejects.toThrow('Secure credential storage is unavailable');
    await app.close();
    return;
  }
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
  await expect(win.locator('aside textarea.prompt-input-field')).toBeEnabled();
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
  await expect(win.locator('aside textarea.prompt-input-field')).toBeEnabled();
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
    await expect.poll(() => win.evaluate('window.__voiceProbe.mic.getAudioTracks().every(track => track.readyState === "ended")')).toBe(true);
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
    await expect.poll(() => win.evaluate('window.__voiceProbe.mic.getTracks().every(track => track.readyState === "ended")')).toBe(true);
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


test('updates expose real progress and stage without closing tabs or interrupting a chat', async () => {
  const { app, win, userData } = await launch({ withoutKeys: true });
  try {
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      const state = globalThis as Record<string, unknown>;
      state.__updateStatus = { state: 'idle' };
      ipcMain.removeHandler('update:get-status');
      ipcMain.handle('update:get-status', () => state.__updateStatus);
      ipcMain.removeHandler('update:check');
      ipcMain.handle('update:check', () => {});
      ipcMain.removeHandler('update:details');
      ipcMain.handle('update:details', () => ({ installedVersion: '0.2.64', activationIssue: null }));
      ipcMain.removeHandler('update:apply');
      ipcMain.handle('update:apply', (_event, version: string) => {
        const values = (state.__appliedVersions ??= []) as string[];
        values.push(version);
        state.__updateStatus = { state: 'ready', version, scheduled: true };
        BrowserWindow.getAllWindows()[0].webContents.send('update:status', state.__updateStatus);
      });
    });
    const composer = win.locator('aside textarea.prompt-input-field');
    await expect(composer).toBeEnabled();
    await composer.fill('Keep my draft through this update.');
    const update = win.getByRole('button', { name: 'Update', exact: true });
    await expect(update).toBeVisible();
    await update.click();
    const dialog = win.getByRole('dialog', { name: 'BulleBrowser updates' });
    await expect(dialog).toContainText('Running version: 0.2.64');
    for (const percent of [12, 63, 100]) {
      await app.evaluate(({ BrowserWindow }, progress) => {
        const next = { state: 'downloading', version: '0.2.80', percent: progress };
        (globalThis as Record<string, unknown>).__updateStatus = next;
        BrowserWindow.getAllWindows()[0].webContents.send('update:status', next);
      }, percent);
      await expect(dialog.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(Math.min(percent, 99)));
    }
    await app.evaluate(({ BrowserWindow }) => {
      const next = { state: 'downloading', version: '0.2.80', phase: 'preparing' };
      (globalThis as Record<string, unknown>).__updateStatus = next;
      BrowserWindow.getAllWindows()[0].webContents.send('update:status', next);
    });
    await expect(dialog.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    await expect(dialog).toContainText('Verifying and preparing');
    await app.evaluate(({ BrowserWindow }) => {
      const next = { state: 'ready', version: '0.2.80' };
      (globalThis as Record<string, unknown>).__updateStatus = next;
      BrowserWindow.getAllWindows()[0].webContents.send('update:status', next);
    });
    await expect(dialog.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    await dialog.getByRole('button', { name: 'Prepare update — restart later' }).click();
    await expect(update).toHaveText('Restart required');
    await expect(dialog).toContainText('Restart BulleBrowser when convenient');
    expect(await app.evaluate(() => (globalThis as Record<string, unknown>).__appliedVersions)).toEqual(['0.2.80']);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(composer).toHaveValue('Keep my draft through this update.');
    await win.reload();
    await expect(update).toHaveText('Restart required');
    await expect(win.getByRole('complementary', { name: 'Assistant chat' })).toBeVisible();
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
  }
});

 test('update failures stay visible and give recovery without quitting', async () => {
  const { app, win, userData } = await launch({ withoutKeys: true });
  try {
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      ipcMain.removeHandler('update:details');
      ipcMain.handle('update:details', () => ({ installedVersion: '0.2.64', activationIssue: 'The previous update did not activate.' }));
      const next = { state: 'error', version: '0.2.80', message: 'Not enough free space for the update.', retryable: true };
      BrowserWindow.getAllWindows()[0].webContents.send('update:status', next);
      ipcMain.removeHandler('update:check');
      ipcMain.handle('update:check', () => { throw new Error('Offline'); });
    });
    await win.getByRole('button', { name: 'Update', exact: true }).click();
    const dialog = win.getByRole('dialog', { name: 'BulleBrowser updates' });
    await expect(dialog).toContainText('previous update did not activate');
    await expect(dialog).toContainText('Could not check for updates');
    await expect(dialog.getByRole('link', { name: 'Latest installer' })).toHaveAttribute('href', 'https://bullebrowser.com/download');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(win.locator('aside textarea.prompt-input-field')).toBeEnabled();
  } finally { await app.close(); rmSync(userData, { recursive: true, force: true }); }
});

test('an update relaunch restores real source tabs and the selected option', async () => {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<html><title>Restored grant ${req.url}</title><h1>Grant source</h1></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const { app, win, userData } = await launch({ withoutKeys: true, restoredTabs: { urls: [base + '/one', base + '/two'], activeIndex: 1 } });
  try {
    await expect.poll(() => win.evaluate(async () => (await window.bullebrowser.tabs.list()).map((tab) => ({ url: tab.url, active: tab.active })))).toEqual([
      { url: base + '/one', active: false }, { url: base + '/two', active: true },
    ]);
    await expect(win.getByRole('textbox', { name: 'Address bar' })).toHaveValue(base + '/two');
    await expect(win.getByRole('region', { name: 'BulleBrowser funding introduction' })).toBeHidden();
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
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
    await win.locator('aside textarea.prompt-input-field').fill('summarize this page');
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
      await win.locator('aside textarea.prompt-input-field').fill('Find a source');
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
          composerEnabled: !!document.querySelector('aside textarea.prompt-input-field') && !document.querySelector('aside textarea.prompt-input-field').disabled,
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
        await win.locator('aside textarea.prompt-input-field').fill('Continue the same conversation');
        await expect(win.locator('aside textarea.prompt-input-field')).toHaveValue('Continue the same conversation');
      }
    } finally {
      await app.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}

test('an unexecuted action is reported incomplete across chat and task result events', async () => {
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<html><title>Save fixture</title><body><button>Save</button><p>Nothing has been saved.</p></body></html>'); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const { app, win, userData } = await launch({ openAiOnly: true });
  try {
    await win.evaluate((url) => window.bullebrowser.tabs.create(url), `http://127.0.0.1:${address.port}/`);
    await app.evaluate(() => {
      const original = globalThis.fetch;
      (globalThis as Record<string, unknown>).__taskRequestCount = 0;
      globalThis.fetch = async (input, init) => {
        if (String(input).startsWith('https://api.openai.com/v1/chat/completions')) {
          const body = JSON.parse(String(init?.body));
          if (body.messages?.[0]?.content?.includes('Create a short public task plan')) return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '["Click Save","Verify the result"]' } }] }));
          (globalThis as Record<string, number>).__taskRequestCount += 1;
          return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Done. Everything completed successfully.' } }] }));
        }
        return original(input, init);
      };
    });
    await win.evaluate(() => window.bullebrowser.settings.set({ defaultModel: 'gpt-4o' }));
    await win.reload();
    await expect(win.locator('aside textarea.prompt-input-field')).toBeEnabled();
    await win.evaluate(() => {
      const state = window as unknown as { __taskResults: Array<{ status: string; text: string }> };
      state.__taskResults = [];
      window.bullebrowser.agent.onResult((result) => state.__taskResults.push(result));
    });
    await win.locator('aside textarea.prompt-input-field').fill('Click "Save"');
    await win.getByRole('button', { name: 'Send', exact: true }).click();
    await win.getByRole('button', { name: 'Allow Access', exact: true }).click();
    await expect.poll(() => win.evaluate(() => (window as unknown as { __taskResults: Array<{ status: string }> }).__taskResults[0]?.status)).toBe('failed');
    await expect(win.locator('.md-prose')).toContainText('Task incomplete');
    await expect(win.locator('.md-prose')).not.toContainText('Everything completed successfully');
    expect(await app.evaluate(() => (globalThis as Record<string, number>).__taskRequestCount)).toBe(4);
  } finally { await app.close(); rmSync(userData, { recursive: true, force: true }); await new Promise<void>((resolve) => server.close(() => resolve())); }
});


test('session scratchpad saves, reloads, and forgets notes without a model call', async () => {
  const { app, win, userData } = await launch({ withoutKeys: true });
  try {
    await win.getByText('Session scratchpad', { exact: true }).click();
    await win.getByRole('textbox', { name: 'Session notes', exact: true }).fill('Focus on workforce grants.');
    await win.getByRole('button', { name: 'Save notes', exact: true }).click();
    await expect(win.getByText('Saved for later tasks in this conversation.', { exact: true })).toBeVisible();
    await win.reload();
    await win.getByText('Session scratchpad', { exact: true }).click();
    await expect(win.getByRole('textbox', { name: 'Session notes', exact: true })).toHaveValue('Focus on workforce grants.');
    await win.getByRole('button', { name: 'Forget this', exact: true }).click();
    await expect(win.getByText('Session notes forgotten.', { exact: true })).toBeVisible();
    await win.reload();
    await win.getByText('Session scratchpad', { exact: true }).click();
    await expect(win.getByRole('textbox', { name: 'Session notes', exact: true })).toHaveValue('');
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
  }
});
