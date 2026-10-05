import { createServer } from 'node:http';
import { test, expect, _electron as electron } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
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
  const panelHeader = win.locator('aside').getByText('BulleBrowser Agent');
  if (!(await panelHeader.isVisible().catch(() => false))) {
    await win.getByRole('button', { name: 'Your Assistant' }).click();
  }
  await expect(panelHeader).toBeVisible({ timeout: 10_000 });
  return { app, win };
}

test('the agent panel mounts with its composer', async () => {
  const { app, win } = await launch();
  await expect(win.locator('aside').getByText('BulleBrowser Agent')).toBeVisible();
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
  await win.locator('aside').getByText('BulleBrowser Agent').click();
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

    const probe=globalThis.__voiceMainProbe={runs:[],cancels:[],connects:0,disconnects:[],pending:null};
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
    await win.waitForFunction('window.__voiceProbe.spoken.includes("The browser task finished with a verified answer.")');
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


test('the update button clears after installation and returns for a later release', async () => {
  const { app, win } = await launch({ withoutKeys: true });
  try {
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      ipcMain.removeHandler('update:get-status');
      ipcMain.handle('update:get-status', () => new Promise((resolve) => {
        ipcMain.once('test:resolve-update-status', () => resolve({ state: 'idle' }));
      }));
      let attempts = 0;
      ipcMain.removeHandler('update:install');
      ipcMain.handle('update:install', () => {
        attempts += 1;
        if (attempts === 1) throw new Error('Installer fixture failure');
        BrowserWindow.getAllWindows()[0].webContents.send('update:status', { state: 'idle' });
      });
    });
    await win.reload();
    await expect(win.locator('aside textarea')).toBeEnabled();
    const update = win.getByRole('button', { name: 'Update App', exact: true });
    await expect(update).toBeHidden();
    await app.evaluate(({ BrowserWindow, ipcMain }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('update:status', { state: 'ready', version: '0.2.38' });
      // A delayed initial snapshot must not erase a newer update event.
      ipcMain.emit('test:resolve-update-status');
    });
    await expect(update).toBeVisible();
    await update.click();
    await expect(update).toBeEnabled();
    await update.click();
    await expect(update).toBeHidden();
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('update:get-status');
      ipcMain.handle('update:get-status', () => ({ state: 'idle' }));
    });
    await win.reload();
    await expect(win.locator('aside textarea')).toBeEnabled();
    await expect(update).toBeHidden();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('update:status', { state: 'ready', version: '0.2.39' });
    });
    await expect(update).toBeVisible();
    await expect(update).toHaveAttribute('title', /0\.2\.39/);
  } finally { await app.close(); }
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
