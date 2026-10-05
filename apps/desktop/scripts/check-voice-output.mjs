// Manual audio-output check against Electron's real system speech engine.
import { _electron as electron } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const userData = await mkdtemp(join(tmpdir(), 'bullebrowser-speech-check-'));
const env = { ...process.env, OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', NODE_ENV: 'test' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ timeout: 30_000, args: ['.', `--user-data-dir=${userData}`], env });
try {
  const win = await app.firstWindow({ timeout: 20_000 });
  await win.waitForLoadState('domcontentloaded');
  const result = await win.evaluate(async () => {
    const engine = window.speechSynthesis;
    if (!engine) throw new Error('System speech is unavailable');
    await new Promise((resolve) => {
      if (engine.getVoices().length) return resolve();
      const done = () => { clearTimeout(timer); engine.removeEventListener('voiceschanged', done); resolve(); };
      const timer = setTimeout(done, 3000);
      engine.addEventListener('voiceschanged', done);
    });
    const voices = engine.getVoices();
    const voice = voices.find((v) => v.localService && v.lang.startsWith('en'));
    if (!voice) throw new Error(`No local English speech voice is available (${voices.length} voices)`);
    let started = false;
    await new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance('BulleBrowser voice is ready.');
      utterance.voice = voice;
      const timer = setTimeout(() => { engine.cancel(); reject(new Error('System speech did not finish')); }, 15000);
      utterance.onstart = () => { started = true; };
      utterance.onend = () => { clearTimeout(timer); resolve(); };
      utterance.onerror = (event) => { clearTimeout(timer); reject(new Error(`System speech failed: ${event.error}`)); };
      engine.speak(utterance);
    });
    if (!started) throw new Error('System speech never started');
    return { voice: voice.name, language: voice.lang, local: voice.localService, completed: true };
  });
  console.log('Real system speech check:', result);
} finally {
  await app.close();
  await rm(userData, { recursive: true, force: true });
}
