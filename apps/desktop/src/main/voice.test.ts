import { beforeEach, describe, expect, it, vi } from 'vitest';

const { recognize, pipeline, env } = vi.hoisted(() => ({
  recognize: vi.fn(),
  pipeline: vi.fn(),
  env: { cacheDir: '', allowLocalModels: true },
}));
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/bullebrowser-test' } }));
vi.mock('@huggingface/transformers', () => ({ pipeline, env }));

const audio = () => new Float32Array(1600).fill(0.1);

beforeEach(() => {
  vi.resetModules();
  recognize.mockReset().mockResolvedValue({ text: '  open the pricing page  ' });
  pipeline.mockReset().mockResolvedValue(recognize);
});

describe('local voice transcription', () => {
  it('transcribes without reading secrets or calling a hosted audio API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      const { transcribeAudio } = await import('./voice.js');
      expect(await transcribeAudio(audio())).toEqual({ text: 'open the pricing page' });
      expect(pipeline).toHaveBeenCalledWith('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
        device: 'cpu', dtype: 'q8',
      });
      expect(env.cacheDir).toBe('/tmp/bullebrowser-test/voice-models');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('skips empty and silent audio without downloading a model', async () => {
    const { transcribeAudio } = await import('./voice.js');
    expect(await transcribeAudio(new Float32Array())).toEqual({ text: '' });
    expect(await transcribeAudio(new Float32Array(1600))).toEqual({ text: '' });
    expect(pipeline).not.toHaveBeenCalled();
  });

  it('rejects malformed and oversized IPC input', async () => {
    const { transcribeAudio } = await import('./voice.js');
    await expect(transcribeAudio(new Uint8Array(10) as unknown as Float32Array)).rejects.toThrow(/16 kHz/);
    await expect(transcribeAudio(new Float32Array(16000 * 120 + 1))).rejects.toThrow(/two minutes/);
    await expect(transcribeAudio(new Float32Array([NaN]))).rejects.toThrow(/Invalid/);
    await expect(transcribeAudio(new Float32Array([Infinity]))).rejects.toThrow(/Invalid/);
    expect(pipeline).not.toHaveBeenCalled();
  });

  it('loads once and serializes continuous commands', async () => {
    const { transcribeAudio } = await import('./voice.js');
    let finish!: (value: { text: string }) => void;
    recognize.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = transcribeAudio(audio());
    const second = transcribeAudio(audio());
    await vi.waitFor(() => expect(recognize).toHaveBeenCalledTimes(1));
    finish({ text: 'first' });
    expect(await first).toEqual({ text: 'first' });
    expect(await second).toEqual({ text: 'open the pricing page' });
    expect(pipeline).toHaveBeenCalledTimes(1);
  });

  it('allows retry after a failed model download', async () => {
    pipeline.mockRejectedValueOnce(new Error('offline'));
    const { transcribeAudio } = await import('./voice.js');
    await expect(transcribeAudio(audio())).rejects.toThrow(/first download/);
    expect(await transcribeAudio(audio())).toEqual({ text: 'open the pricing page' });
    expect(pipeline).toHaveBeenCalledTimes(2);
  });

  it('recovers the queue after an inference failure', async () => {
    recognize.mockRejectedValueOnce(new Error('inference failed'));
    const { transcribeAudio } = await import('./voice.js');
    await expect(transcribeAudio(audio())).rejects.toThrow('inference failed');
    expect(await transcribeAudio(audio())).toEqual({ text: 'open the pricing page' });
  });
});
