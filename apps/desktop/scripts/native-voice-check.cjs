const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateNativeVoice, validateSpeechModels } = require('./validate-native-voice.cjs');

function fixture(platform, arch) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-native-test-'));
  const suffix = `${platform}-${arch}`;
  const paths = [
    '@huggingface/transformers/package.json',
    `onnxruntime-node/bin/napi-v3/${platform}/${arch}/onnxruntime_binding.node`,
    `@img/sharp-${suffix}/lib/sharp-${suffix}.node`,
    ...(platform === 'win32' ? [] : [`@img/sharp-libvips-${suffix}/package.json`]),
  ];
  for (const file of paths) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'fixture');
  }
  return root;
}

for (const platform of ['darwin', 'win32', 'linux']) {
  test(`accepts installed ${platform} runtime and rejects a missing cross-architecture binary`, () => {
    const root = fixture(platform, 'arm64');
    try {
      assert.doesNotThrow(() => validateNativeVoice(root, platform, 'arm64'));
      assert.throws(() => validateNativeVoice(root, platform, 'x64'), /incomplete/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}

test('accepts a complete bundled voice and rejects a missing, truncated or unlisted one', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-bundle-test-'));
  try {
    assert.throws(() => validateSpeechModels(root), /missing/);
    const files = ['tts/voices/F1.bin', 'tts/config.json', 'tts/tokenizer.json', 'tts/onnx/voice_decoder.onnx', 'LICENSE-MODELS.txt', 'NOTICES.txt']
      .map((file) => ({ path: file, size: 7 }));
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(root, file.path)), { recursive: true });
      fs.writeFileSync(path.join(root, file.path), 'fixture');
    }
    const write = (manifest) => fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
    write({ schemaVersion: 2, voice: 'F1', files });
    assert.doesNotThrow(() => validateSpeechModels(root));
    write({ schemaVersion: 2, voice: 'F3', files });
    assert.throws(() => validateSpeechModels(root), /tts\/voices\/F3\.bin/);
    write({ schemaVersion: 1, voice: 'F1', files });
    assert.throws(() => validateSpeechModels(root), /invalid/);
    write({ schemaVersion: 2, voice: 'F1', files });
    fs.writeFileSync(path.join(root, 'tts/onnx/voice_decoder.onnx'), 'cut');
    assert.throws(() => validateSpeechModels(root), /voice_decoder/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
