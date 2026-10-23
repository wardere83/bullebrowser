// Real WAV → MediaStream → recorder/VAD → local Whisper → captions → bundled voice.
// Only the assistant result is a fixture; no browser operation is performed.
import { _electron as electron } from 'playwright';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!process.argv[2]) throw new Error('Usage: node scripts/check-live-voice.mjs speech.wav [expected-text]');
const wav = (await readFile(process.argv[2])).toString('base64');
const userData = await mkdtemp(join(tmpdir(), 'bullebrowser-live-voice-check-'));
const env = { ...process.env, OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', NODE_ENV: 'test' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ timeout: 30_000, args: ['.', `--user-data-dir=${userData}`], env });
try {
  const win = await app.firstWindow({ timeout: 20_000 });
  await win.waitForLoadState('domcontentloaded');
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    globalThis.__liveVoiceRuns = [];
    ipcMain.removeHandler('agent:run');
    ipcMain.handle('agent:run', (_event, request) => {
      globalThis.__liveVoiceRuns.push(request.userMessage);
      const runId = 'voice-check-' + globalThis.__liveVoiceRuns.length;
      setTimeout(() => BrowserWindow.getAllWindows()[0].webContents.send('agent:result', {
        runId, conversationId: request.conversationId, status: 'completed', text: 'Local voice recognition is working.',
      }), 100);
      return { runId };
    });
  });
  await win.evaluate(async (data) => {
    const probe = window.__liveVoiceProbe = { stream: null, context: null, speechStarted: false, speechEnded: false };
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext();
      probe.context = context;
      await context.resume();
      const audio = await context.decodeAudioData(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)).buffer);
      const destination = context.createMediaStreamDestination();
      const source = context.createBufferSource();
      source.buffer = audio;
      source.connect(destination);
      probe.stream = destination.stream;
      // Let the session's recorder and VAD attach before playing the fixture.
      setTimeout(() => source.start(), 500);
      return destination.stream;
    };
    // Replies normally play as bundled-voice PCM clips; the installed system
    // voice is only the fallback. Either one counts as the reply being spoken.
    const startClip = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      probe.speechStarted = true;
      this.addEventListener('ended', () => { probe.speechEnded = true; });
      return startClip.apply(this, args);
    };
    const speak = speechSynthesis.speak.bind(speechSynthesis);
    speechSynthesis.speak = (utterance) => {
      const onend = utterance.onend;
      utterance.onstart = () => { probe.speechStarted = true; };
      utterance.onend = (event) => { probe.speechEnded = true; onend?.call(utterance, event); };
      speak(utterance);
    };
  }, wav);
  await win.getByRole('button', { name: 'Voice Mode', exact: true }).click();
  await win.waitForFunction(() => window.__liveVoiceProbe.speechStarted && window.__liveVoiceProbe.speechEnded, undefined, { timeout: 90000 });
  const recognized = await app.evaluate(() => globalThis.__liveVoiceRuns);
  if (!recognized.length || (process.argv[3] && !recognized.join(' ').toLowerCase().includes(process.argv[3].toLowerCase()))) {
    throw new Error('The fixture did not produce the expected speech transcript: ' + JSON.stringify(recognized));
  }
  console.log('Real Voice Mode recognized:', recognized);
  console.log('Real spoken reply started and completed with no provider keys.');
  await win.getByRole('button', { name: 'Stop Voice Mode', exact: true }).click();
  await win.waitForFunction(() => window.__liveVoiceProbe.stream.getTracks().every((track) => track.readyState === 'ended'));
  console.log('Voice Mode released every microphone track.');
} finally {
  await winCleanup(app);
  await app.close();
  await rm(userData, { recursive: true, force: true });
}

async function winCleanup(instance) {
  const windows = instance.windows();
  for (const win of windows) {
    await win.evaluate(() => window.__liveVoiceProbe?.context?.close()).catch(() => {});
  }
}
