// Local Whisper inference: audio stays on this device and needs no API key.
// Model files download on first use and persist in Electron's user-data folder.
import { app } from 'electron';
import { join } from 'node:path';
import type { AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

let transcriber: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let pending = 0;
const SAMPLE_RATE = 16_000;
const MAX_SAMPLES = SAMPLE_RATE * 120;

function getTranscriber(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!transcriber) {
    transcriber = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.cacheDir = join(app.getPath('userData'), 'voice-models');
      // Bundled neural speech shares this runtime and loads local-only models.
      env.allowLocalModels = true;
      return pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
        device: 'cpu',
        dtype: 'q8',
      });
    })().catch(() => {
      transcriber = null; // Allow a failed first download to be retried.
      throw new Error(
        'Could not load the voice model. Connect to the internet for the first download, check available disk space, then try again.',
      );
    });
  }
  return transcriber;
}

export async function transcribeAudio(audio: Float32Array): Promise<{ text: string }> {
  if (!(audio instanceof Float32Array) || audio.length > MAX_SAMPLES) {
    throw new Error('Voice expects mono 16 kHz audio, up to two minutes per clip.');
  }
  if (audio.length === 0) return { text: '' };
  let energy = 0;
  for (const sample of audio) {
    if (!Number.isFinite(sample) || Math.abs(sample) > 1) {
      throw new Error('Invalid voice audio. Please record the clip again.');
    }
    energy += sample * sample;
  }
  // Avoid Whisper's hallucinated transcripts on silent recordings.
  if (Math.sqrt(energy / audio.length) < 0.001) return { text: '' };
  if (pending >= 4) throw new Error('Voice is catching up. Please pause, then try again.');
  pending++;
  const result = queue.then(async () => {
    const recognize = await getTranscriber();
    const output = await recognize(audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
    });
    return { text: (Array.isArray(output) ? output.map((o) => o.text).join(' ') : output.text).trim() };
  });
  queue = result.catch(() => {});
  try {
    return await result;
  } finally {
    pending--;
  }
}
