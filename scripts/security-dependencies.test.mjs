import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const desktop = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const { gte } = desktop('semver');
test('installed runtime and packaging tools meet the security minimums', () => {
  assert.ok(gte(desktop('electron/package.json').version, '42.11.16'));
  assert.ok(gte(desktop('electron-builder/package.json').version, '26.15.0'));
  assert.ok(gte(desktop('electron-builder-squirrel-windows/package.json').version, '26.15.0'));
});
test('upgraded packaging dependencies retain the macOS notarization hooks', () => {
  const config = readFileSync(new URL('../apps/desktop/electron-builder.yml', import.meta.url), 'utf8');
  assert.match(config, /afterSign: \.\/scripts\/notarize\.cjs/);
  assert.match(config, /hardenedRuntime: true/);
  assert.match(config, /notarize: false/);
  const builder = desktop('electron-builder');
  assert.equal(typeof builder.build, 'function');
});
test('mobile Xcode project UUID generation remains compatible with the patched UUID API', () => {
  const mobile = createRequire(new URL('../apps/mobile/package.json', import.meta.url));
  const cli = createRequire(mobile.resolve('@capacitor/cli'));
  const xcode = cli('xcode');
  const project = xcode.project('unused.pbxproj');
  project.hash = { project: { objects: {} } };
  assert.match(project.generateUuid(), /^[A-F0-9]{24}$/);
});
