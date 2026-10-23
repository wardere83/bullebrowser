// Neural speech is generated on this device from models bundled with the app.
// This module never downloads models or reads a speech API credential.
import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PreTrainedTokenizer, SupertonicForConditionalGeneration, Tensor } from '@huggingface/transformers';

interface SpeechRuntime {
  tokenizer: PreTrainedTokenizer;
  model: SupertonicForConditionalGeneration;
  style: Tensor;
}

// Must match `voice` in scripts/prepare-speech-model.mjs. F1–F5 all ship.
const DEFAULT_VOICE = 'F1';
const SAMPLE_RATE = 44100;
const STYLE_DIM = 128;
const MAX_TEXT = 600;
const MAX_PENDING = 4;
// More denoising steps are smoother; 10 still runs several times faster than
// real time on CPU. Speed 1.0 is a measured, professional pace.
const INFERENCE_STEPS = 10;
const SPEED = 1;
const TARGET_PEAK = 0.85;
const MAX_GAIN = 3;
const FADE_SAMPLES = Math.round(SAMPLE_RATE * 0.008);
const PREPARE_ERROR = 'BulleBrowser Agentic AI could not prepare its voice. Please restart the app and try again.';
const SPEECH_ERROR = 'BulleBrowser Agentic AI could not speak that response. Please try again.';
let runtime: Promise<SpeechRuntime> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let pending = 0;

function modelDirectory(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'speech-models')
    : join(app.getAppPath(), 'resources', 'speech-models');
}

function hasControlCharacters(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return true;
  }
  return false;
}

function getRuntime(): Promise<SpeechRuntime> {
  if (!runtime) {
    const loading: Promise<SpeechRuntime> = (async () => {
      const directory = modelDirectory();
      const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as {
        schemaVersion?: number; sampleRate?: number; model?: string;
      };
      if (manifest.schemaVersion !== 2 || manifest.sampleRate !== SAMPLE_RATE || manifest.model !== 'Supertonic') {
        throw new Error('Invalid bundled speech manifest');
      }
      const binary = await readFile(join(directory, 'tts', 'voices', `${DEFAULT_VOICE}.bin`));
      const count = binary.byteLength / Float32Array.BYTES_PER_ELEMENT;
      if (!count || count % STYLE_DIM !== 0) throw new Error('Invalid bundled voice');
      const samples = new Float32Array(count);
      let norm = 0;
      for (let i = 0; i < count; i++) {
        const sample = binary.readFloatLE(i * 4);
        if (!Number.isFinite(sample)) throw new Error('Invalid bundled voice');
        samples[i] = sample;
        norm += sample * sample;
      }
      if (norm < 0.0001) throw new Error('Invalid bundled voice');

      const { AutoTokenizer, SupertonicForConditionalGeneration, Tensor, env } = await import('@huggingface/transformers');
      // Whisper shares this runtime. Keep its writable cache and local models
      // enabled; every speech load additionally enforces local_files_only.
      env.cacheDir = join(app.getPath('userData'), 'voice-models');
      env.allowLocalModels = true;
      const local = { local_files_only: true, cache_dir: env.cacheDir };
      const [tokenizer, model] = await Promise.all([
        AutoTokenizer.from_pretrained(join(directory, 'tts'), local),
        SupertonicForConditionalGeneration.from_pretrained(join(directory, 'tts'), { ...local, device: 'cpu', dtype: 'fp32' }),
      ]);
      return {
        tokenizer,
        model: model as SupertonicForConditionalGeneration,
        style: new Tensor('float32', samples, [1, count / STYLE_DIM, STYLE_DIM]),
      };
    })().catch(() => {
      if (runtime === loading) runtime = null; // Allow a failed load to be retried.
      throw new Error(PREPARE_ERROR);
    });
    runtime = loading;
  }
  return runtime;
}

export async function prepareSpeech(): Promise<void> {
  await getRuntime();
}

export async function synthesizeAudio(text: string): Promise<{ audio: Float32Array; sampleRate: number }> {
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT || hasControlCharacters(text)) {
    throw new Error('BulleBrowser Agentic AI voice expects between 1 and 600 characters of text.');
  }
  if (pending >= MAX_PENDING) throw new Error('BulleBrowser Agentic AI voice is catching up. Please pause and try again.');
  pending++;
  const result = queue.then(async () => {
    const loaded = getRuntime();
    const speech = await loaded;
    try {
      const inputs = speech.tokenizer(text.trim(), { padding: true, truncation: true });
      const { waveform } = await speech.model.generate_speech({
        ...inputs,
        style: speech.style,
        num_inference_steps: INFERENCE_STEPS,
        speed: SPEED,
      }) as { waveform?: { data: unknown } };
      const samples = waveform?.data;
      if (!(samples instanceof Float32Array) || samples.length === 0 || samples.length > SAMPLE_RATE * 120) {
        throw new Error('Invalid speech output');
      }
      let peak = 0;
      for (const value of samples) {
        if (!Number.isFinite(value)) throw new Error('Invalid speech output');
        peak = Math.max(peak, Math.abs(value));
      }
      if (peak < 0.001) throw new Error('Empty speech output');
      // Level each clip to a consistent loudness and soften its edges so
      // consecutive sentences join without clicks or volume jumps.
      const gain = Math.min(MAX_GAIN, TARGET_PEAK / peak);
      const audio = new Float32Array(samples.length);
      const fade = Math.min(FADE_SAMPLES, samples.length >> 1);
      for (let i = 0; i < audio.length; i++) {
        const edge = Math.min(i, audio.length - 1 - i);
        audio[i] = Math.max(-1, Math.min(1, samples[i]! * gain)) * (edge < fade ? edge / fade : 1);
      }
      return { audio, sampleRate: SAMPLE_RATE };
    } catch {
      // An invalid native session must not poison subsequent voice requests.
      if (runtime === loaded) {
        runtime = null;
        await Promise.allSettled([speech.model.dispose()]);
      }
      throw new Error(SPEECH_ERROR);
    }
  });
  queue = result.catch(() => {});
  try { return await result; }
  finally { pending--; }
}
