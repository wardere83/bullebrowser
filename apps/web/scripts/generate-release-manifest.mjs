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
const outFile = path.join(outDir, 'releases-manifest.json');

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
    console.warn(`[release-manifest] ${error?.message ?? error}. Skipping manifest; downloads use the live API.`);
    return;
  }
  await mkdir(outDir, { recursive: true });
  await writeFile(
    outFile,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), releases }, null, 2)}\n`,
    'utf8',
  );
  console.log(`Wrote ${outFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
