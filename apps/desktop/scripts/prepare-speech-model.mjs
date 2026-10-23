#!/usr/bin/env node
// Build-time only: pin, verify, and bundle the local voice assets. The app
// never calls this downloader and never needs a speech API key.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(desktop, 'resources/speech-models');
const modelRevision = 'cff123c84b0655d9d647641f1b532c3cbb8f7faa';
const licenseRevision = 'b6856d033f622c63ea29441795be266a1133e227';
// The voice the app speaks with. Every female style ships (52 KB each), so
// changing voice is this one line plus DEFAULT_VOICE in src/main/speech.ts.
const voice = 'F1';
const modelUrl = (repo, revision, file) => `https://huggingface.co/${repo}/resolve/${revision}/${file}`;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const assets = [
  ['tts/config.json', 247, '37cdafab327b4360e0d6911956bfb3ca3d7254b53749e06ca41ab422d7686259'],
  ['tts/tokenizer.json', 2038, 'da6954f045585fc12c8ea9831b3c3eb1c5bffc8ef7ff6b6db7de781cd472ee01'],
  ['tts/tokenizer_config.json', 119, '87dad35dfef4b41ef8bb92723e2fc040b91d3fdf770ee5f4716fa5d4896f7a68'],
  ['tts/onnx/text_encoder.onnx', 433169, '50a03d29d5dc95918eeff578f542b814f3cf5a741f927116f5a8462a76ff6898'],
  ['tts/onnx/text_encoder.onnx_data', 28426752, '6415854f135a318909dc716e90f83a391d9a91bd9da09bdb6d6763d6b0a6c102'],
  ['tts/onnx/latent_denoiser.onnx', 398102, '9a639a8c05c9be111848562c5cf10ea2697a589c6341830aac479d0ce7b75aa9'],
  ['tts/onnx/latent_denoiser.onnx_data', 132098880, 'cde4abf1136defce235bc446eaab4954a57721ae8d5a4754cdd337bf191b612f'],
  ['tts/onnx/voice_decoder.onnx', 59921, '83c104006dabcd6b568c0d5acb6fec18f65609d2391dd2c459e4440e85027669'],
  ['tts/onnx/voice_decoder.onnx_data', 101353472, 'ea52402c9ba5131ee2b3901a86db2f0b435b322169cd75157e053493d967d17f'],
  ['tts/voices/F1.bin', 51712, '5ef84e3421e4f80994a5a40a18ba39ba9fc48175c41ae6cf3e56418820872dbf'],
  ['tts/voices/F2.bin', 51712, '1949cf0e066c4278980d2b835cf334dab0f8f781704c9116bf48a072278f7c72'],
  ['tts/voices/F3.bin', 51712, '38ee1d62ad8a02877ab0d08b501742b76cf3586ed888514df1a7f27cc0f8d171'],
  ['tts/voices/F4.bin', 51712, '63890c361868a296c51f9aee114f51e0a9a92c3f46a91582539545f7ab408a72'],
  ['tts/voices/F5.bin', 51712, '793223d8d11e0ee49721842ebdc7bd46b4487579588f646953e75ad3fc8ffb9c'],
].map(([path, size, hash]) => ({
  path, size, sha256: hash,
  source: modelUrl('onnx-community/Supertonic-TTS-ONNX', modelRevision, path.slice('tts/'.length)),
}));
assets.push({
  path: 'LICENSE-MODELS.txt', size: 15007,
  sha256: '0d944a9110fed9a9602d60e0423a272903e7bd21ab060490774efc77c2275e9f',
  source: modelUrl('Supertone/supertonic', licenseRevision, 'LICENSE'),
});

async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function isVerified(asset) {
  try { return await fileHash(resolve(target, asset.path)) === asset.sha256; }
  catch { return false; }
}
async function save(asset, bytes) {
  if (bytes.length !== asset.size || sha256(bytes) !== asset.sha256) {
    throw new Error(`Speech asset failed integrity verification: ${asset.path}`);
  }
  const file = resolve(target, asset.path);
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.partial`;
  try { await writeFile(temporary, bytes); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}
async function download(url, maximum) {
  const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!response.ok || !response.body) throw new Error(`Speech asset download failed (${response.status})`);
  const chunks = [];
  let received = 0;
  for await (const chunk of response.body) {
    received += chunk.length;
    if (received > maximum) throw new Error('Speech asset exceeds its pinned size');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, received);
}

await mkdir(target, { recursive: true });
// Assets from a previously bundled model must not ride along in the installer.
for (const stale of ['vocoder', 'speaker-slt.bin', 'SPEAKER-DATASET.md', 'tts/generation_config.json', 'tts/preprocessor_config.json', 'tts/special_tokens_map.json', 'tts/added_tokens.json', 'tts/onnx/encoder_model_quantized.onnx', 'tts/onnx/decoder_model_merged_quantized.onnx']) {
  await rm(resolve(target, stale), { recursive: true, force: true });
}
for (const asset of assets) {
  if (await isVerified(asset)) continue;
  console.log(`[speech] preparing ${asset.path}`);
  await save(asset, await download(asset.source, asset.size));
}
const notice = `BulleBrowser local speech model notices\n\nSupertonic text-to-speech model weights and voice styles: BigScience\nOpen RAIL-M License, copyright Supertone Inc. ONNX conversion: ONNX Community.\nThe full license, including its use restrictions, is in LICENSE-MODELS.txt.\nThose use restrictions apply to everyone who uses this voice.\n\nVoice: Supertonic preset ${voice}, a US English female voice. The publisher\ndocuments its presets by gender only; no other speaker attribute is documented.\n\nModel snapshot revisions:\nonnx-community/Supertonic-TTS-ONNX: ${modelRevision}\nSupertone/supertonic (license): ${licenseRevision}\n`;
await writeFile(resolve(target, 'NOTICES.txt'), notice);
const files = [...assets, { path: 'NOTICES.txt', size: Buffer.byteLength(notice), sha256: sha256(notice), source: 'generated attribution' }];
await writeFile(resolve(target, 'manifest.json'), JSON.stringify({ schemaVersion: 2, model: 'Supertonic', sampleRate: 44100, voice, dtype: 'fp32', files }, null, 2) + '\n');
console.log(`[speech] verified ${files.length} bundled assets (${files.reduce((total, file) => total + file.size, 0)} bytes); runtime needs no download or key`);
