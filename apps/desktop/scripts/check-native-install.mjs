import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(require.resolve('@huggingface/transformers'));
const sharpRequire = createRequire(runtimeRequire.resolve('sharp'));
const onnxRoot = join(dirname(runtimeRequire.resolve('onnxruntime-node')), '..');
for (const arch of ['x64', 'arm64']) {
  const suffix = `${process.platform}-${arch}`;
  sharpRequire.resolve(`@img/sharp-${suffix}/sharp.node`);
  if (process.platform !== 'win32') sharpRequire.resolve(`@img/sharp-libvips-${suffix}/package`);
  const binding = join(onnxRoot, 'bin/napi-v3', process.platform, arch, 'onnxruntime_binding.node');
  if (!existsSync(binding)) throw new Error(`Missing ONNX binding for ${process.platform}/${arch}`);
  console.log(`Native speech dependencies are installed for ${process.platform}/${arch}`);
}
// Actually load the host runtime as well as checking the cross-target paths.
await import('@huggingface/transformers');
console.log(`Speech runtime imports successfully on ${process.platform}/${process.arch}`);
