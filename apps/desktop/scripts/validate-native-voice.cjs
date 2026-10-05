// Fail packaging if the target's native speech runtime was not installed.
// npmRebuild is disabled, so cross-architecture builds must ship both variants.
const fs = require('node:fs');
const path = require('node:path');

function validateNativeVoice(moduleRoot, platform, arch) {
  const suffix = `${platform === 'linux' ? 'linux' : platform}-${arch}`;
  const required = [
    path.join(moduleRoot, '@huggingface/transformers/package.json'),
    path.join(moduleRoot, 'onnxruntime-node/bin/napi-v3', platform, arch, 'onnxruntime_binding.node'),
    path.join(moduleRoot, `@img/sharp-${suffix}/lib/sharp-${suffix}.node`),
  ];
  if (platform !== 'win32') {
    required.push(path.join(moduleRoot, `@img/sharp-libvips-${suffix}/package.json`));
  }
  const missing = required.filter((file) => !fs.existsSync(file));
  if (missing.length) {
    throw new Error(`Voice runtime is incomplete for ${platform}/${arch}. Install dependencies with pnpm supportedArchitectures before packaging. Missing: ${missing.join(', ')}`);
  }
}

function validatePackagedVoice(context) {
  // electron-builder 25's Arch enum: ia32=0, x64=1, armv7l=2, arm64=3.
  const arch = ['ia32', 'x64', 'armv7l', 'arm64'][context.arch];
  if (!arch || !['x64', 'arm64'].includes(arch)) throw new Error('Unsupported speech-runtime target architecture');
  const resources = context.packager.getResourcesDir(context.appOutDir);
  validateNativeVoice(path.join(resources, 'app/node_modules'), context.electronPlatformName, arch);
}
module.exports = { validateNativeVoice, validatePackagedVoice };
