// Generate reproducible native projects from the pinned Capacitor templates.
// Sources in native/ are authoritative; generated ios/ and android/ are ignored.
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
if (Number(process.versions.node.split('.')[0]) < 22)
  throw new Error('Native project generation requires Node 22 or newer.');
const platforms = process.argv.slice(2);
if (platforms.some((value) => !['ios', 'android'].includes(value)))
  throw new Error('Use ios and/or android.');
const cap = resolve(root, 'node_modules/@capacitor/cli/bin/capacitor');
const invoke = (...args) =>
  execFileSync(process.execPath, [cap, ...args], { cwd: root, stdio: 'inherit' });
const replace = (file, from, to) => {
  const text = readFileSync(file, 'utf8');
  if (text.includes(to)) return;
  if (!text.includes(from)) throw new Error(`Native template changed: ${file}`);
  writeFileSync(file, text.replace(from, to));
};
for (const platform of platforms.length ? platforms : ['ios', 'android']) {
  if (!existsSync(platform)) invoke('add', platform);
  if (platform === 'ios') {
    copyFileSync(
      resolve('native/assets/icon-1024.png'),
      resolve('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'),
    );
    const project = resolve('ios/App/App.xcodeproj/project.pbxproj');
    for (const name of [
      'MobileAgentPlugin.swift',
      'BrowserViewController.swift',
      'PrivacyInfo.xcprivacy',
    ]) {
      copyFileSync(resolve('native/ios', name), resolve('ios/App/App', name));
      let text = readFileSync(project, 'utf8');
      if (!text.includes(`/* ${name} */ =`)) {
        const id = (part) =>
          createHash('sha256').update(`${name}:${part}`).digest('hex').slice(0, 24).toUpperCase();
        const file = id('file'),
          build = id('build'),
          phase = name.endsWith('.swift') ? 'Sources' : 'Resources';
        text = text.replace(
          '/* End PBXBuildFile section */',
          `\t\t${build} /* ${name} in ${phase} */ = {isa = PBXBuildFile; fileRef = ${file} /* ${name} */; };\n/* End PBXBuildFile section */`,
        );
        text = text.replace(
          '/* End PBXFileReference section */',
          `\t\t${file} /* ${name} */ = {isa = PBXFileReference; lastKnownFileType = ${name.endsWith('.swift') ? 'sourcecode.swift' : 'text.plist.xml'}; path = ${name}; sourceTree = "<group>"; };\n/* End PBXFileReference section */`,
        );
        const group = /504EC3061FED79650016851F \/\* App \*\/ = \{[\s\S]*?children = \(/;
        if (!group.test(text)) throw new Error('Native App group changed.');
        text = text.replace(group, (match) => `${match}\n\t\t\t\t${file} /* ${name} */,`);
        const section = new RegExp(`isa = PBX${phase}BuildPhase;[\\s\\S]*?files = \\(`);
        if (!section.test(text)) throw new Error(`Native ${phase} phase changed.`);
        text = text.replace(
          section,
          (match) => `${match}\n\t\t\t\t${build} /* ${name} in ${phase} */,`,
        );
        writeFileSync(project, text);
      }
    }
    replace(
      'ios/App/App/Base.lproj/Main.storyboard',
      'customClass="CAPBridgeViewController" customModule="Capacitor"',
      'customClass="BrowserViewController" customModule="App"',
    );
    invoke('sync', 'ios');
  } else {
    const java = resolve('android/app/src/main/java/com/bullebrowser/mobile');
    mkdirSync(java, { recursive: true });
    for (const name of ['MainActivity.java', 'MobileAgentPlugin.java'])
      copyFileSync(resolve('native/android', name), resolve(java, name));
    for (const [density, size] of [
      ['mdpi', 48],
      ['hdpi', 72],
      ['xhdpi', 96],
      ['xxhdpi', 144],
      ['xxxhdpi', 192],
    ]) {
      for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png'])
        copyFileSync(
          resolve(`native/assets/icon-${size}.png`),
          resolve(`android/app/src/main/res/mipmap-${density}/${name}`),
        );
    }
    // Device-bound assistant keys cannot be restored with a cloud/device backup.
    replace(
      'android/app/src/main/AndroidManifest.xml',
      'android:allowBackup="true"',
      'android:allowBackup="false"',
    );
    invoke('sync', 'android');
  }
}
