import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';

const { files, tokenizer, generate, dispose, loadTokenizer, loadModel, env } = vi.hoisted(() => ({
  files: new Map<string, Buffer | string>(),
  tokenizer: vi.fn(),
  generate: vi.fn(),
  dispose: vi.fn(),
  loadTokenizer: vi.fn(),
  loadModel: vi.fn(),
  env: { cacheDir: '', allowLocalModels: false },
}));
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/app', getPath: () => '/tmp/bullebrowser-test' },
}));
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async (file: string) => {
    const value = files.get(file);
    if (value === undefined) throw new Error('ENOENT');
    return value;
  }),
}));
vi.mock('@huggingface/transformers', () => ({
  env,
  AutoTokenizer: { from_pretrained: loadTokenizer },
  SupertonicForConditionalGeneration: { from_pretrained: loadModel },
  Tensor: class { constructor(public type: string, public data: Float32Array, public dims: number[]) {} },
}));

const directory = join('/app', 'resources', 'speech-models');
const manifest = (patch = {}) => JSON.stringify({ schemaVersion: 2, model: 'Supertonic', sampleRate: 44100, ...patch });
const wave = (length = 4410, level = 0.2) => ({ waveform: { data: new Float32Array(length).fill(level) } });

beforeEach(() => {
  vi.resetModules();
  files.clear();
  files.set(join(directory, 'manifest.json'), manifest());
  files.set(join(directory, 'tts', 'voices', 'F1.bin'), Buffer.from(new Float32Array(128 * 101).fill(0.5).buffer));
  tokenizer.mockReset().mockReturnValue({ input_ids: 'ids', attention_mask: 'mask' });
  generate.mockReset().mockResolvedValue(wave());
  dispose.mockReset().mockResolvedValue(undefined);
  loadTokenizer.mockReset().mockResolvedValue(tokenizer);
  loadModel.mockReset().mockResolvedValue({ generate_speech: generate, dispose });
});

describe('bundled neural speech', () => {
  it('speaks with the bundled female voice from local files only, without any network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      const { synthesizeAudio } = await import('./speech.js');
      const { audio, sampleRate } = await synthesizeAudio('  Your report is ready.  ');
      expect(sampleRate).toBe(44100);
      expect(loadModel).toHaveBeenCalledWith(join(directory, 'tts'), expect.objectContaining({ local_files_only: true, dtype: 'fp32' }));
      expect(loadTokenizer).toHaveBeenCalledWith(join(directory, 'tts'), expect.objectContaining({ local_files_only: true }));
      expect(tokenizer).toHaveBeenCalledWith('Your report is ready.', expect.anything());
      const request = generate.mock.calls[0]![0];
      expect(request.style.dims).toEqual([1, 101, 128]);
      expect(request).toMatchObject({ input_ids: 'ids', attention_mask: 'mask', num_inference_steps: 10, speed: 1 });
      // Levelled to a consistent loudness with softened edges.
      expect(audio[0]).toBe(0);
      expect(audio.at(-1)).toBe(0);
      expect(audio[2205]).toBeCloseTo(0.6);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('rejects empty, oversized and control-character text before loading the model', async () => {
    const { synthesizeAudio } = await import('./speech.js');
    await expect(synthesizeAudio('   ')).rejects.toThrow(/between 1 and 600/);
    await expect(synthesizeAudio('x'.repeat(601))).rejects.toThrow(/between 1 and 600/);
    await expect(synthesizeAudio('bad\u0000text')).rejects.toThrow(/between 1 and 600/);
    await expect(synthesizeAudio(42 as unknown as string)).rejects.toThrow(/between 1 and 600/);
    expect(loadModel).not.toHaveBeenCalled();
  });

  it('refuses a mismatched manifest or voice and retries once the bundle is valid', async () => {
    files.set(join(directory, 'manifest.json'), manifest({ model: 'SpeechT5' }));
    const { prepareSpeech } = await import('./speech.js');
    await expect(prepareSpeech()).rejects.toThrow(/could not prepare its voice/);
    files.set(join(directory, 'manifest.json'), manifest());
    files.set(join(directory, 'tts', 'voices', 'F1.bin'), Buffer.alloc(100));
    await expect(prepareSpeech()).rejects.toThrow(/could not prepare its voice/);
    expect(loadModel).not.toHaveBeenCalled();
    files.set(join(directory, 'tts', 'voices', 'F1.bin'), Buffer.from(new Float32Array(128).fill(0.5).buffer));
    await expect(prepareSpeech()).resolves.toBeUndefined();
    expect(loadModel).toHaveBeenCalledOnce();
  });

  it('loads once, keeps requests in order, and reloads after a failed or silent clip', async () => {
    const { synthesizeAudio } = await import('./speech.js');
    const order: string[] = [];
    tokenizer.mockImplementation((text: string) => { order.push(text); return {}; });
    await Promise.all([synthesizeAudio('first'), synthesizeAudio('second'), synthesizeAudio('third')]);
    expect(order).toEqual(['first', 'second', 'third']);
    expect(loadModel).toHaveBeenCalledOnce();
    generate.mockResolvedValueOnce(wave(4410, 0));
    await expect(synthesizeAudio('silent')).rejects.toThrow(/could not speak/);
    expect(dispose).toHaveBeenCalledOnce();
    generate.mockRejectedValueOnce(new Error('native failure'));
    await expect(synthesizeAudio('broken')).rejects.toThrow(/could not speak/);
    await expect(synthesizeAudio('recovered')).resolves.toMatchObject({ sampleRate: 44100 });
    expect(loadModel).toHaveBeenCalledTimes(3);
  });

  it('sheds load instead of queueing speech without bound', async () => {
    const { synthesizeAudio } = await import('./speech.js');
    let release!: (value: unknown) => void;
    generate.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const waiting = [1, 2, 3, 4].map((n) => synthesizeAudio(`clip ${n}`));
    await expect(synthesizeAudio('one too many')).rejects.toThrow(/catching up/);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    release(wave());
    await expect(Promise.all(waiting)).resolves.toHaveLength(4);
  });
});
