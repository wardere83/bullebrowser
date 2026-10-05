// Manual integration check for the bundled voice: real Electron IPC, the real
// bundled model, no API key and no network. The synthesized speech is passed
// back through local Whisper to prove it is intelligible, and saved as a WAV
// so a person can listen to it. Run `pnpm prepare:speech && pnpm build` first.
import { _electron as electron } from 'playwright';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const output = resolve(process.argv[2] ?? 'bullebrowser-voice-sample.wav');
const sentences = [
  'Good afternoon. I found three grant opportunities that match your organization.',
  'The earliest deadline is in two weeks, so I recommend we start with that application.',
];
const expected = ['three', 'grant', 'opportunities', 'organization', 'deadline', 'two weeks', 'application'];
const userData = await mkdtemp(join(tmpdir(), 'bullebrowser-neural-voice-check-'));
const env = { ...process.env, OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', NODE_ENV: 'test' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  ...(process.argv[3] ? { executablePath: process.argv[3] } : {}),
  args: [...(process.argv[3] ? [] : ['.']), `--user-data-dir=${userData}`],
  env,
});
try {
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  const result = await win.evaluate(async (texts) => {
    const started = performance.now();
    await window.bullebrowser.voice.prepareSpeech();
    const loadMs = Math.round(performance.now() - started);
    const clips = [];
    let synthesisMs = 0;
    for (const text of texts) {
      const before = performance.now();
      clips.push(await window.bullebrowser.voice.synthesize(text));
      synthesisMs += performance.now() - before;
    }
    const sampleRate = clips[0].sampleRate;
    const gap = Math.round(sampleRate * 0.25);
    const audio = new Float32Array(clips.reduce((total, clip) => total + clip.audio.length + gap, 0));
    let offset = 0;
    for (const clip of clips) { audio.set(clip.audio, offset); offset += clip.audio.length + gap; }
    // Hear it back exactly as the app would: 16 kHz mono through local Whisper.
    const offline = new OfflineAudioContext(1, Math.ceil(audio.length / sampleRate * 16000), 16000);
    const buffer = offline.createBuffer(1, audio.length, sampleRate);
    buffer.getChannelData(0).set(audio);
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start();
    const pcm = (await offline.startRendering()).getChannelData(0).map((sample) => Math.max(-1, Math.min(1, sample)));
    const heard = await window.bullebrowser.voice.transcribe(pcm);
    let peak = 0;
    for (const sample of audio) peak = Math.max(peak, Math.abs(sample));
    return { loadMs, synthesisMs: Math.round(synthesisMs), seconds: audio.length / sampleRate, sampleRate, peak, heard: heard.text, audio: [...audio] };
  }, sentences);
  const pcm = result.audio;
  const wav = Buffer.alloc(44 + pcm.length * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.length * 2, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(result.sampleRate, 24); wav.writeUInt32LE(result.sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.length * 2, 40);
  pcm.forEach((sample, index) => wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + index * 2));
  await writeFile(output, wav);
  console.log(`Voice loaded in ${result.loadMs} ms; ${result.seconds.toFixed(1)} s of speech generated in ${result.synthesisMs} ms (peak ${result.peak.toFixed(2)}).`);
  console.log('Heard back:', result.heard);
  const heard = result.heard.toLowerCase();
  const missing = expected.filter((word) => !heard.includes(word));
  if (missing.length) throw new Error(`The bundled voice was not intelligible; missing: ${missing.join(', ')}`);
  if (result.synthesisMs > result.seconds * 1000) throw new Error('The bundled voice is slower than real time on this machine');
  console.log(`Bundled voice check passed. Listen to ${output}`);
} finally {
  await app.close();
  await rm(userData, { recursive: true, force: true });
}
