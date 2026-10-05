const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateNativeVoice } = require('./validate-native-voice.cjs');

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
