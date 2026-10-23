// Download metadata is baked into a static manifest at build time so the
// site does not depend on the browser hitting the unauthenticated GitHub API.
// We still keep a live API fallback for local/dev cases where the manifest
// is missing.

import { basePath } from '@/lib/asset';

export type Platform =
  | 'mac-arm64'
  | 'mac-x64'
  | 'win-x64'
  | 'win-arm64'
  | 'linux-x64'
  | 'linux-arm64';

export interface ReleaseAsset {
  name: string;
  browserDownloadUrl: string;
  size: number;
  /** Tag of the release this asset came from. */
  tag: string;
}

export interface Downloads {
  /** Newest published release tag (for display). */
  latestTag: string | null;
  publishedAt: string | null;
  /** Best available installer per platform, newest-first across releases. */
  forPlatform: Partial<Record<Platform, ReleaseAsset>>;
  /** The newest release's checksum file, when it has one. */
  checksumsUrl: string | null;
  /** HTML page URL for the newest published release. */
  latestReleaseUrl: string | null;
  /** True only if the GitHub API could not be reached at all. */
  apiUnavailable: boolean;
}

export const REPO_OWNER =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_REPO_OWNER) ||
  'wardere83';
export const REPO_NAME =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_REPO_NAME) ||
  'bullebrowser';
export const RELEASES_PAGE = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;
const LOCAL_MANIFEST_PATH = `${basePath}/releases-manifest.json`;

interface RawAsset {
  name: string;
  browser_download_url: string;
  size: number;
}
interface RawRelease {
  tag_name: string;
  published_at: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  assets: RawAsset[];
}

interface ReleaseManifest {
  generatedAt: string;
  releases: RawRelease[];
}

function classify(name: string): Platform | null {
  const n = name.toLowerCase();
  if (n.endsWith('.dmg') || n.endsWith('.zip')) {
    // The mac build targets arm64 and x64 only (see electron-builder.yml), so
    // there is no universal artifact to classify.
    return n.includes('arm64') ? 'mac-arm64' : 'mac-x64';
  }
  if (n.endsWith('.exe')) return n.includes('arm64') ? 'win-arm64' : 'win-x64';
  if (n.endsWith('.appimage')) return n.includes('arm64') ? 'linux-arm64' : 'linux-x64';
  return null;
}

function downloadsFromReleases(releases: RawRelease[], apiUnavailable: boolean): Downloads {
  const published = releases
    .filter((r) => !r.draft)
    .sort(
      (a, b) =>
        new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
    );

  const latest = published[0] ?? null;
  const latestTag = latest?.tag_name ?? null;
  const forPlatform: Downloads['forPlatform'] = {};
  const checksumsUrl =
    latest?.assets.find((asset) => /checksum/i.test(asset.name))?.browser_download_url ?? null;

  for (const rel of published) {
    for (const a of rel.assets) {
      const platform = classify(a.name);
      if (platform && !forPlatform[platform]) {
        forPlatform[platform] = {
          name: a.name,
          browserDownloadUrl: a.browser_download_url,
          size: a.size,
          tag: rel.tag_name,
        };
      }
    }
  }

  return {
    latestTag,
    publishedAt: latest?.published_at ?? null,
    forPlatform,
    checksumsUrl,
    latestReleaseUrl: latest?.html_url ?? null,
    apiUnavailable,
  };
}

export async function fetchDownloads(): Promise<Downloads> {
  try {
    const manifestRes = await fetch(LOCAL_MANIFEST_PATH, { cache: 'no-store' });
    if (manifestRes.ok) {
      const manifest = (await manifestRes.json()) as ReleaseManifest;
      if (Array.isArray(manifest.releases)) {
        return downloadsFromReleases(manifest.releases, false);
      }
    }
  } catch {
    // Fall through to the live API.
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=15`,
      { headers: { Accept: 'application/vnd.github+json' } },
    );
    if (!res.ok) {
      return downloadsFromReleases([], res.status >= 500 || res.status === 403);
    }
    return downloadsFromReleases((await res.json()) as RawRelease[], false);
  } catch {
    return downloadsFromReleases([], true);
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}
