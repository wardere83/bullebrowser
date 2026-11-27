import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repoOwner = process.env.NEXT_PUBLIC_REPO_OWNER || 'wardere83';
const repoName = process.env.NEXT_PUBLIC_REPO_NAME || 'bullebrowser';
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
// Deploys opt in to failing the build when release data is unavailable.
const strict = process.env.RELEASE_MANIFEST_STRICT === '1';
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 2_000;

const url = `https://api.github.com/repos/${repoOwner}/${repoName}/releases?per_page=15`;
const outDir = path.resolve('public');
// Public: what the download page shows (versions, sizes, dates). It names no
// host, repository or release notes, because anyone can open it.
const outFile = path.join(outDir, 'releases-manifest.json');
// Private to the build: where each installer is stored. Only the /get/ pages
// read it, so a visitor's link always stays on the site's own address.
const sourcesFile = path.resolve('.release-downloads.json');

export const FILES = [
  'mac-arm64',
  'mac-x64',
  'win-x64',
  'win-arm64',
  'linux-x64',
  'linux-arm64',
  'checksums',
];

function classify(name) {
  const n = name.toLowerCase();
  if (n.endsWith('.blockmap') || n.endsWith('.yml')) return null;
  if (/checksum/.test(n)) return 'checksums';
  if (n.endsWith('.dmg')) return n.includes('arm64') ? 'mac-arm64' : 'mac-x64';
  if (n.endsWith('.exe')) {
    if (n.includes('arm64')) return 'win-arm64';
    // The combined Windows installer carries both architectures; prefer the
    // x64-only one when the release has it.
    return 'win-x64';
  }
  if (n.endsWith('.appimage')) return n.includes('arm64') ? 'linux-arm64' : 'linux-x64';
  return null;
}

// Newest release first; each file comes from the newest release that has it.
export function summarize(releases) {
  const published = releases
    .filter((r) => !r.draft)
    .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());
  const latest = published[0] ?? null;
  const files = {};
  const sources = {};
  for (const rel of published) {
    // The best file of each kind in this release. Windows ships a combined
    // installer beside the x64 one; the x64 one is preferred when present.
    const best = {};
    for (const asset of rel.assets ?? []) {
      const key = classify(asset.name);
      if (!key) continue;
      const preferred = key !== 'win-x64' || /x64/i.test(asset.name);
      if (!best[key] || (preferred && !best[key].preferred)) best[key] = { asset, preferred };
    }
    for (const [key, { asset }] of Object.entries(best)) {
      if (files[key]) continue;
      // Checksums only describe the release they ship with.
      if (key === 'checksums' && rel !== latest) continue;
      files[key] = { size: asset.size, tag: rel.tag_name };
      sources[key] = asset.browser_download_url;
    }
  }
  return {
    manifest: {
      generatedAt: new Date().toISOString(),
      latestTag: latest?.tag_name ?? null,
      publishedAt: latest?.published_at ?? null,
      files,
    },
    sources,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isTransient = (status) => status === 429 || status === 403 || status >= 500;

async function fetchReleases() {
  let useToken = Boolean(token);
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          ...(useToken ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (res.ok) return await res.json();
      lastError = new Error(`Failed to fetch releases: ${res.status} ${res.statusText}`);
      // A rejected token must not block a public read: retry anonymously.
      if (res.status === 401 && useToken) {
        useToken = false;
        continue;
      }
      if (!isTransient(res.status)) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
  }
  throw lastError;
}

async function main() {
  let releases;
  try {
    releases = await fetchReleases();
  } catch (error) {
    if (strict) throw error;
    // lib/releases.ts falls back to the live API when the manifest is absent,
    // so a stale file must not survive and a missing one must not block builds.
    await rm(outFile, { force: true });
    await rm(sourcesFile, { force: true });
    console.warn(`[release-manifest] ${error?.message ?? error}. Skipping manifest; the download page will say the list is unavailable.`);
    return;
  }
  const { manifest, sources } = summarize(releases);
  await mkdir(outDir, { recursive: true });
  await writeFile(outFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeFile(sourcesFile, `${JSON.stringify(sources, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${outFile} and ${sourcesFile}`);
}

// Run only when invoked directly, so a test can import summarize().
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
