// Bundle the backend + @bullebrowser/agent-core into one self-contained file
// (dist/server.mjs) that runs with plain `node`, no workspace and nothing to
// install at runtime. Run from the monorepo: `node services/widget-backend/build.mjs`.
//
// esbuild is a transitive dependency of the monorepo, not a direct one, so we
// resolve its binary out of the pnpm store rather than importing it — this
// avoids adding a root dependency (and touching the lockfile the app's CI
// installs from).

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(dir, '../..');

function esbuildBin() {
  const store = path.join(repo, 'node_modules/.pnpm');
  const pkg = fs.readdirSync(store).find((d) => d.startsWith('esbuild@'));
  if (!pkg) throw new Error('esbuild not found in node_modules/.pnpm — run pnpm install at the repo root first.');
  return path.join(store, pkg, 'node_modules/esbuild/bin/esbuild');
}

fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
execFileSync(
  esbuildBin(),
  [
    path.join(dir, 'server.mjs'),
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--target=node20',
    // agent-core is a source-only TS package outside this folder; point esbuild
    // straight at its entry so it's compiled inline.
    `--alias:@bullebrowser/agent-core=${path.join(repo, 'packages/agent-core/src/index.ts')}`,
    `--outfile=${path.join(dir, 'dist/server.mjs')}`,
  ],
  { stdio: 'inherit' },
);

console.log('built services/widget-backend/dist/server.mjs');

// The embedded service must enforce the same product-language release gate.
execFileSync(process.execPath, [path.join(repo, 'scripts/check-product-language.mjs'), path.join(dir, 'dist')], { stdio: 'inherit' });
