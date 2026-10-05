// Ad-hoc codesigns the .app produced by electron-builder so macOS doesn't
// reject it as "damaged" on Apple Silicon. Runs after each platform pack
// but before any .dmg / .zip is built around the .app, so the signature
// lives inside the distributed image.
const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { validatePackagedVoice } = require('./validate-native-voice.cjs');

// A real Developer ID identity is configured (CI imports the cert into a
// dedicated keychain and points electron-builder at it via CSC_KEYCHAIN, or a
// .p12 via CSC_LINK). In that case electron-builder Developer ID–signs the app
// in the signing phase that runs *after* this hook, so an ad-hoc signature here
// is pointless (and would be immediately overwritten). Only ad-hoc sign the
// unsigned fallback build, so `codesign --sign -` never runs on a release.
function realIdentityConfigured() {
  if (process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false') return false;
  return Boolean(process.env.CSC_KEYCHAIN || process.env.CSC_LINK);
}

exports.default = async function afterPack(context) {
  validatePackagedVoice(context);
  const platform = context.electronPlatformName;
  if (platform !== 'darwin') return;
  if (realIdentityConfigured()) {
    console.log('afterPack: Developer ID identity configured — leaving signing to electron-builder.');
    return;
  }
  const appOutDir = context.appOutDir;
  const productName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${productName}.app`);
  if (!fs.existsSync(appPath)) {
    console.warn(`afterPack: ${appPath} not found, skipping ad-hoc sign`);
    return;
  }
  console.log(`afterPack: ad-hoc codesigning ${appPath} (no signing identity)`);
  try {
    execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
    execSync(`codesign --verify --deep --strict --verbose=2 "${appPath}"`, { stdio: 'inherit' });
    console.log('afterPack: ad-hoc signature verified');
  } catch (e) {
    console.error('afterPack: codesign failed', e.message);
    throw e;
  }
};
