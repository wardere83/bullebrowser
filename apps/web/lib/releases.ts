// The download page reads a small manifest baked into the site when it is
// built: versions, sizes and dates only. Every installer is then fetched
// through the site's own /get/ address, so no link on the page points away
// from it.

import { asset, basePath } from '@/lib/asset';

export type Platform =
  | 'mac-arm64'
  | 'mac-x64'
  | 'win-x64'
  | 'win-arm64'
  | 'linux-x64'
  | 'linux-arm64';

/** Every file the site hands out, by its /get/ name. */
export type DownloadFile = Platform | 'checksums';

export const DOWNLOAD_FILES: readonly DownloadFile[] = [
  'mac-arm64',
  'mac-x64',
  'win-x64',
  'win-arm64',
  'linux-x64',
  'linux-arm64',
  'checksums',
];

export interface ReleaseAsset {
  size: number;
  /** Version of the release this file came from. */
  tag: string;
}

export interface Downloads {
  /** Newest published release (for display). */
  latestTag: string | null;
  publishedAt: string | null;
  /** Best available installer per platform, newest-first across releases. */
  forPlatform: Partial<Record<Platform, ReleaseAsset>>;
  /** True when the newest release has a checksum file. */
  hasChecksums: boolean;
  /** True only if the release list could not be read at all. */
  apiUnavailable: boolean;
}

interface ReleaseManifest {
  generatedAt: string;
  latestTag: string | null;
  publishedAt: string | null;
  files: Partial<Record<DownloadFile, ReleaseAsset>>;
}

const LOCAL_MANIFEST_PATH = `${basePath}/releases-manifest.json`;

/** The site's own address for a file, which starts its download. */
export const downloadHref = (file: DownloadFile): string => asset(`/get/${file}/`);

export async function fetchDownloads(): Promise<Downloads> {
  try {
    const res = await fetch(LOCAL_MANIFEST_PATH, { cache: 'no-store' });
    if (res.ok) {
      const manifest = (await res.json()) as ReleaseManifest;
      if (manifest && typeof manifest.files === 'object' && manifest.files) {
        const { checksums, ...forPlatform } = manifest.files;
        return {
          latestTag: manifest.latestTag ?? null,
          publishedAt: manifest.publishedAt ?? null,
          forPlatform,
          hasChecksums: Boolean(checksums),
          apiUnavailable: false,
        };
      }
    }
  } catch {
    // Reported below as unavailable.
  }
  return { latestTag: null, publishedAt: null, forPlatform: {}, hasChecksums: false, apiUnavailable: true };
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
