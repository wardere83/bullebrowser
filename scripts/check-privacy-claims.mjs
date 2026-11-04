import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
export function misleadingPrivacyClaim(text) {
  return /data never leaves (?:your|the user'?s?) (?:device|machine)|reasoning runs (?:entirely )?locally|local-first execution and summarization by default|local mode processes page summaries on your device; optional cloud mode|integrates a high-performance LLM directly into (?:your|user) local hardware/i.test(text);
}
function files(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    const child = join(path, entry.name);
    if (['node_modules', 'out', '.next', 'dist'].includes(entry.name)) return [];
    return entry.isDirectory() ? files(child) : /\.(md|tsx?|jsx?)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [child] : [];
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = ['README.md', ...['docs', 'apps/web/app', 'apps/web/lib/locales', 'apps/desktop/src/renderer'].flatMap(files)];
  const failed = paths.filter(path => misleadingPrivacyClaim(readFileSync(path, 'utf8')));
  if (failed.length) { console.error('Misleading privacy claim in: ' + failed.join(', ')); process.exitCode = 1; }
  else console.log(`Privacy copy checked in ${paths.length} files.`);
}
