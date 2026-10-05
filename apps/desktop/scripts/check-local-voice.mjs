// Manual integration check: provide a speech WAV path. Uses the real Electron
// IPC path, decoder and Whisper model; it never needs an API key.
import { _electron as electron } from 'playwright';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!process.argv[2]) throw new Error('Usage: node scripts/check-local-voice.mjs speech.wav [packaged-executable]');
const wav = (await readFile(process.argv[2])).toString('base64');
const userData = await mkdtemp(join(tmpdir(), 'bullebrowser-voice-check-'));
const env = { ...process.env, OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', NODE_ENV: 'test' };
delete env.ELECTRON_RUN_AS_NODE;
const launchOptions = {
  ...(process.argv[3] ? { executablePath: process.argv[3] } : {}),
  args: [...(process.argv[3] ? [] : ['.']), `--user-data-dir=${userData}`],
  env,
};
let app = await electron.launch(launchOptions);
try {
  let win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  const text = await win.evaluate(async (bytes) => {
    const ctx = new AudioContext();
    try {
      const decoded = await ctx.decodeAudioData(Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0)).buffer);
      const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start();
      const audio = (await offline.startRendering()).getChannelData(0);
      const first = await window.bullebrowser.voice.transcribe(audio);
      return { text: first.text, audio: [...audio] };
    } finally {
      await ctx.close();
    }
  }, wav);
  if (!text.text) throw new Error('No transcript returned for speech fixture');
  console.log('Keyless transcript:', text.text);
  await app.close();
  app = await electron.launch(launchOptions);
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await app.evaluate(() => {
    globalThis.fetch = () => { throw new Error('Network blocked for offline check'); };
  });
  const offline = await win.evaluate((samples) => window.bullebrowser.voice.transcribe(new Float32Array(samples)), text.audio);
  if (offline.text !== text.text) throw new Error('Offline transcription changed');
  console.log('Offline transcription passed after restarting with network blocked.');
} finally {
  await app.close();
  await rm(userData, { recursive: true, force: true });
}
