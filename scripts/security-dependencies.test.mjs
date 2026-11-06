import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

test('actual packaging schema accepts the full installer configuration and preserves Linux metadata', async () => {
  const builder = createRequire(desktop.resolve('electron-builder'));
  const { getConfig, validateConfiguration } = builder('app-builder-lib/out/util/config/config');
  const { LinuxTargetHelper } = builder('app-builder-lib/out/targets/LinuxTargetHelper');
  const projectDir = fileURLToPath(new URL('../apps/desktop/', import.meta.url));
  const config = await getConfig(projectDir, 'electron-builder.yml');
  await validateConfiguration(config, { isEnabled: false });
  assert.equal(config.win.signtoolOptions.publisherName, 'Bulle Consulting');
  for (const invalid of [
    { ...config, win: { ...config.win, publisherName: 'Bulle Consulting' } },
    { ...config, linux: { ...config.linux, desktop: { Name: 'BulleBrowser' } } },
  ]) await assert.rejects(validateConfiguration(invalid, { isEnabled: false }), /Invalid configuration/);
  const helper = new LinuxTargetHelper({
    appInfo: { productName: config.productName, sanitizedProductName: config.productName, description: 'The agentic AI web browser' },
    executableName: config.executableName,
    info: { metadata: { desktopName: 'BulleBrowser.desktop' } },
    config, platformSpecificBuildOptions: config.linux, fileAssociations: [],
  });
  const entry = await helper.computeDesktopEntry(config.linux);
  assert.match(entry, /^Name=BulleBrowser$/m);
  assert.match(entry, /^Comment=The agentic AI web browser$/m);
  assert.match(entry, /^Categories=Network;$/m);
  assert.match(entry, /^Exec=\/opt\/BulleBrowser\/BulleBrowser %U$/m);
});
