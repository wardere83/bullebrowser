import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const updateQuestion = 'Can you tell me what new updates have been done on this app';

async function launch(provider: 'none' | 'anthropic' | 'openai' = 'none') {
  const env = { ...process.env, NODE_ENV: 'test', BULLEBROWSER_TEST_HOOKS: '1',
    ANTHROPIC_API_KEY: provider === 'anthropic' ? 'identity-fixture-key' : '',
    OPENAI_API_KEY: provider === 'openai' ? 'identity-fixture-key' : '' };
  delete (env as NodeJS.ProcessEnv).ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ cwd: appRoot,
    args: ['.', '--no-sandbox', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'bullebrowser-identity-'))}`], env });
  const win = await app.firstWindow({ timeout: 20_000 });
  await expect(win.getByRole('complementary', { name: 'Assistant chat' })).toBeVisible();
  await expect(win.locator('aside textarea')).toBeEnabled();
  await expect.poll(() => win.evaluate(async () => (await window.bullebrowser.conversations.list()).length)).toBeGreaterThan(0);
  await win.evaluate(() => {
    const events: string[] = [];
    (window as unknown as Record<string, unknown>).__identityEvents = events;
    window.bullebrowser.agent.onStep(({ step }) => {
      if (step.kind === 'text') events.push(step.text);
    });
  });
  await app.evaluate(({ shell }) => {
    globalThis.fetch = async () => { throw new Error('Product answers must not call an external provider'); };
    const contacts: string[] = [];
    (globalThis as Record<string, unknown>).__identityContacts = contacts;
    shell.openExternal = async (url) => { contacts.push(url); };
  });
  return { app, win };
}

for (const provider of ['none', 'anthropic', 'openai'] as const) {
  test(`app questions use the product identity and support path with ${provider} configured`, async () => {
    const { app, win } = await launch(provider);
    try {
      const requests = [updateQuestion, 'How was BulleBrowser built?', 'What model are you?'];
      for (let index = 0; index < requests.length; index++) {
        await win.locator('aside textarea').fill(requests[index]!);
        await win.getByRole('button', { name: 'Send', exact: true }).click();
        await expect(win.locator('.md-prose')).toHaveCount(index + 1);
        const reply = win.locator('.md-prose').nth(index);
        await expect(reply).toContainText('BulleBrowser Agentic AI');
        await expect(reply.getByRole('link', { name: 'support@bullebrowser.com', exact: true })).toHaveAttribute('href', 'mailto:support@bullebrowser.com');
        expect(await reply.innerText()).not.toMatch(/claude|anthropic|openai|chatgpt|electron|react|gpt-/i);
        await expect(win.locator('aside').getByRole('button', { name: 'Stop', exact: true })).toBeHidden();
        await expect(win.getByRole('button', { name: 'Allow Access', exact: true })).toBeHidden();
      }
      const events = await win.evaluate(() => (window as unknown as { __identityEvents: string[] }).__identityEvents);
      expect(events).toHaveLength(3);
      expect(events.every((event) => event.includes('support@bullebrowser.com') && !/claude|anthropic|openai|chatgpt/i.test(event))).toBe(true);
      const tabsBefore = await win.evaluate(() => window.bullebrowser.tabs.list());
      await win.locator('.md-prose').last().getByRole('link', { name: 'support@bullebrowser.com', exact: true }).click();
      await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __identityContacts: string[] }).__identityContacts)).toEqual(['mailto:support@bullebrowser.com']);
      expect(await win.evaluate(() => window.bullebrowser.tabs.list())).toEqual(tabsBefore);
      await expect(win.locator('aside textarea')).toBeVisible();
    } finally { await app.close(); }
  });
}

test('saved app questions and their follow-ups use the support answer without changing stored user history', async () => {
  const { app, win } = await launch();
  try {
    const path = join(await app.evaluate(({ app }) => app.getPath('userData')), 'conversations.json');
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const conversation = data.conversations[0];
    conversation.title = 'App update conversation';
    conversation.messages = [
      { role: 'user', content: updateQuestion, timestamp: Date.now() },
      { role: 'assistant', content: "You're asking about updates to me (the BulleBrowser agent / Claude). I can check Anthropic news. Would you like both?", timestamp: Date.now() },
    ];
    conversation.messageCount = 2;
    writeFileSync(path, JSON.stringify(data));
    await win.getByRole('button', { name: 'History', exact: true }).click();
    await win.getByRole('button', { name: /App update conversation/ }).click();
    await expect(win.locator('.md-prose')).toContainText('support@bullebrowser.com');
    expect(await win.locator('.md-prose').innerText()).not.toMatch(/Claude|Anthropic/);
    const retained = JSON.parse(readFileSync(path, 'utf8')).conversations[0].messages[1].content.includes('Claude');
    expect(retained).toBe(true);
    await win.locator('aside textarea').fill('Both');
    await win.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(win.locator('.md-prose')).toHaveCount(2);
    await expect(win.locator('.md-prose').last()).toContainText('support@bullebrowser.com');
    expect(await win.locator('.md-prose').last().innerText()).not.toMatch(/Claude|Anthropic/);
    await expect(win.locator('aside').getByRole('button', { name: 'Stop', exact: true })).toBeHidden();
  } finally { await app.close(); }
});

test('keyless Voice Mode speaks the same general product answer', async () => {
  const { app, win } = await launch();
  try {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('voice:transcribe');
      ipcMain.handle('voice:transcribe', (_event, audio) => {
        if (!(audio instanceof Float32Array) || !audio.length) throw new Error('Expected PCM audio');
        return { text: 'How was BulleBrowser built?' };
      });
      // Capture what the bundled voice is asked to say; clips are short tones.
      const spoken: string[] = [];
      (globalThis as Record<string, unknown>).__identitySpoken = spoken;
      ipcMain.removeHandler('voice:prepare-speech');
      ipcMain.handle('voice:prepare-speech', () => undefined);
      ipcMain.removeHandler('voice:synthesize');
      ipcMain.handle('voice:synthesize', (_event, text: string) => {
        spoken.push(text);
        return { audio: new Float32Array(2205).fill(0.01), sampleRate: 44100 };
      });
    });
    await win.evaluate(() => {
      const probe = { recorder: null as MediaRecorder | null, spoken: [] as string[], contexts: [] as AudioContext[] };
      (window as unknown as Record<string, unknown>).__identityVoice = probe;
      navigator.mediaDevices.getUserMedia = async () => {
        const context = new AudioContext();
        probe.contexts.push(context);
        const destination = context.createMediaStreamDestination();
        const oscillator = context.createOscillator();
        oscillator.connect(destination);
        oscillator.start();
        await context.resume();
        return destination.stream;
      };
      const Recorder = window.MediaRecorder;
      window.MediaRecorder = class extends Recorder {
        constructor(stream: MediaStream, options?: MediaRecorderOptions) {
          super(stream, options);
          probe.recorder = this;
        }
      };
      window.speechSynthesis.speak = (utterance) => {
        probe.spoken.push(utterance.text);
        setTimeout(() => utterance.onend?.call(utterance, new Event('end') as SpeechSynthesisEvent), 0);
      };
    });
    await win.getByRole('button', { name: 'Voice Mode', exact: true }).click();
    await expect(win.getByRole('button', { name: 'Mute microphone', exact: true })).toBeEnabled();
    await win.waitForFunction(() => (window as unknown as { __identityVoice: { recorder: MediaRecorder | null } }).__identityVoice.recorder?.state === 'recording');
    await win.waitForTimeout(800);
    await win.evaluate(() => (window as unknown as { __identityVoice: { recorder: MediaRecorder } }).__identityVoice.recorder.stop());
    const heard = () => app.evaluate(() => ((globalThis as Record<string, unknown>).__identitySpoken as string[]).join(' '));
    await expect.poll(heard).toContain('support at bullebrowser dot com');
    const spoken = await heard();
    expect(spoken).toContain('BulleBrowser Agentic AI');
    expect(spoken).not.toMatch(/claude|anthropic|openai|chatgpt|electron|react|gpt-|[@*#`]|https?:/i);
    expect(await win.evaluate(() => (window as unknown as { __identityVoice: { spoken: string[] } }).__identityVoice.spoken)).toEqual([]);
    await expect(win.getByRole('button', { name: 'Allow Access', exact: true })).toBeHidden();
    await expect(win.locator('.md-prose')).toContainText('support@bullebrowser.com');
  } finally { await app.close(); }
});
