import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const ts = createRequire(import.meta.url)('typescript');
const { outputText } = ts.transpileModule(
  readFileSync(new URL('../lib/mobile-downloads.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
);
const module = { exports: {} };
vm.runInNewContext(outputText, { module, exports: module.exports, URL });
const { mobileDownload } = module.exports;
test('unpublished and unsafe mobile destinations have no download link', () => {
  for (const value of [
    undefined,
    '',
    'javascript:alert(1)',
    'http://apps.apple.com/app/id123',
    'https://apps.apple.com.evil.com/app/id123',
    'https://secret@apps.apple.com/app/id123',
    'https://play.google.com/store/apps/details?id=some.other.app',
  ]) {
    assert.equal(mobileDownload('ios', value), null);
    assert.equal(mobileDownload('android', value), null);
  }
});
test('verified store URL shapes distinguish beta and public downloads', () => {
  assert.equal(
    mobileDownload('ios', 'https://apps.apple.com/us/app/bullebrowser/id12345678').beta,
    false,
  );
  assert.equal(mobileDownload('ios', 'https://testflight.apple.com/join/abcd1234').beta, true);
  assert.equal(
    mobileDownload(
      'android',
      'https://play.google.com/store/apps/details?id=com.bullebrowser.mobile',
    ).beta,
    false,
  );
  assert.equal(
    mobileDownload('android', 'https://play.google.com/apps/testing/com.bullebrowser.mobile').beta,
    true,
  );
});
