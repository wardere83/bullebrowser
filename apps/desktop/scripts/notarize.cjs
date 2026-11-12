// afterSign hook — notarize, staple, and Gatekeeper-validate the signed .app.
//
// Runs after electron-builder has code-signed the app (with hardened runtime +
// entitlements) and before the .dmg / .zip are built, so the notarization
// ticket is stapled *inside* the distributed image.
//
// It shells out to the Xcode command-line tools (notarytool, stapler, spctl)
// only — no npm dependency — so nothing needs to be added to the frozen pnpm
// lockfile. Those tools ship with the macos runners.
//
// Behaviour:
//   • Developer ID–signed app + Apple credentials present
//         → submit to notarytool (--wait), staple, then verify with
//           `stapler validate` and `spctl --assess --type execute`.
//   • Release run (IS_RELEASE=1 — set by the CI job for tag pushes and
//     publish dispatches) that is not properly signed, or with credentials
//     missing
//         → throw, so an un-notarized build can never be published.
//   • Anything else (local dev, PRs, ad-hoc fallback builds)
//         → warn and skip.
//
// Credentials (either set works; API key is preferred when present):
//   APPLE_API_KEY (path to .p8) + APPLE_API_KEY_ID + APPLE_API_ISSUER
//   APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID

const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

function isDeveloperIdSigned(appPath) {
  // `codesign -dvv` writes its details to stderr (and returns 0 on a valid
  // signature), so read both streams via spawnSync rather than execFileSync,
  // which returns stdout only.
  const result = spawnSync('codesign', ['-dvv', appPath], { encoding: 'utf8' });
  const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return /Authority=Developer ID Application/.test(combined);
}

// Returns notarytool credential args, or null when none are configured.
function notaryCredentialArgs() {
  const {
    APPLE_API_KEY,
    APPLE_API_KEY_ID,
    APPLE_API_ISSUER,
    APPLE_ID,
    APPLE_APP_SPECIFIC_PASSWORD,
    APPLE_TEAM_ID,
  } = process.env;

  if (APPLE_API_KEY && APPLE_API_KEY_ID && APPLE_API_ISSUER) {
    return ['--key', APPLE_API_KEY, '--key-id', APPLE_API_KEY_ID, '--issuer', APPLE_API_ISSUER];
  }
  if (APPLE_ID && APPLE_APP_SPECIFIC_PASSWORD && APPLE_TEAM_ID) {
    return ['--apple-id', APPLE_ID, '--password', APPLE_APP_SPECIFIC_PASSWORD, '--team-id', APPLE_TEAM_ID];
  }
  return null;
}

// Submit to the notary service with a bounded wait, retrying once on a stall.
// `notarytool --wait` polls until Apple returns a verdict; --timeout caps that
// poll so a stuck queue surfaces as a failure we can retry rather than an
// indefinite hang.
function submitWithRetry(zipPath, creds, attempts = 2, waitTimeout = '20m') {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      console.log(
        `notarize: submitting to Apple notary service (attempt ${attempt}/${attempts}, ` +
          `up to ${waitTimeout})…`,
      );
      // Credentials are passed as argv, not interpolated into a shell string, so
      // the app-specific password / key is never expanded by a shell.
      execFileSync(
        'xcrun',
        ['notarytool', 'submit', zipPath, ...creds, '--wait', '--timeout', waitTimeout],
        { stdio: 'inherit' },
      );
      return;
    } catch (error) {
      if (attempt === attempts) {
        throw new Error(
          `notarize: notarization failed after ${attempts} attempts — ${error.message}`,
        );
      }
      console.warn(`notarize: attempt ${attempt} failed (${error.message}); retrying…`);
    }
  }
}

// Stapling and validation fetch the ticket from Apple's CDN. A dropped
// connection there ("The network connection was lost", stapler error 68)
// failed the v0.2.94 release after Apple had already accepted the
// notarization. Retry these online checks a few times with growing waits; a
// genuinely invalid ticket still fails on the last attempt.
function runWithRetry(command, args, label, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      execFileSync(command, args, { stdio: 'inherit' });
      return;
    } catch (error) {
      if (attempt >= attempts) throw error;
      const waitSeconds = 10 * 2 ** (attempt - 1);
      console.warn(`notarize: ${label} failed (attempt ${attempt}/${attempts}); retrying in ${waitSeconds}s…`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitSeconds * 1000);
    }
  }
}
exports.runWithRetry = runWithRetry;

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  const isRelease = process.env.IS_RELEASE === '1';

  if (!fs.existsSync(appPath)) {
    console.warn(`notarize: ${appPath} not found — skipping.`);
    return;
  }

  const signed = isDeveloperIdSigned(appPath);
  const creds = notaryCredentialArgs();

  if (!signed || !creds) {
    const why = !signed
      ? 'the app is not Developer ID–signed'
      : 'Apple notarization credentials are not set';
    if (isRelease) {
      throw new Error(
        `notarize: refusing to publish an un-notarized release — ${why}. ` +
          'Provide MACOS_CERTIFICATE / MACOS_CERTIFICATE_PASSWORD and either ' +
          'APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID or ' +
          'APPLE_API_KEY / APPLE_API_KEY_ID / APPLE_API_ISSUER.',
      );
    }
    console.warn(`notarize: skipping (${why}). This build will NOT be notarized.`);
    return;
  }

  const zipPath = path.join(os.tmpdir(), `${appName}-notarize-${process.pid}.zip`);
  console.log(`notarize: zipping ${appName}.app for submission…`);
  // ditto preserves the bundle structure and symlinks that notarytool expects.
  execFileSync('ditto', ['-c', '-k', '--keepParent', appPath, zipPath], { stdio: 'inherit' });

  try {
    // A bare `--wait` blocks forever when Apple's queue stalls. The mac job
    // notarizes twice (arm64 then x64) back to back, so one stalled submission
    // used to hang the whole job until CI killed it — that is exactly how
    // v0.2.16 shipped with no Intel DMG. Bound each wait and retry once.
    submitWithRetry(zipPath, creds);
  } finally {
    fs.rmSync(zipPath, { force: true });
  }

  console.log('notarize: stapling the ticket to the .app…');
  runWithRetry('xcrun', ['stapler', 'staple', appPath], 'stapling');

  console.log('notarize: validating staple + Gatekeeper acceptance…');
  runWithRetry('xcrun', ['stapler', 'validate', appPath], 'staple validation');
  runWithRetry('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath], 'Gatekeeper assessment');

  console.log(`notarize: ✔ ${appName}.app is Developer ID–signed, notarized, stapled, and Gatekeeper-accepted.`);
};
