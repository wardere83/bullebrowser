'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  fetchDownloads,
  formatBytes,
  RELEASES_PAGE,
  type Downloads,
  type Platform,
} from '@/lib/releases';

const PLATFORMS: { key: Platform; label: string; req: string }[] = [
  { key: 'mac-universal', label: 'macOS · Universal (.dmg)', req: 'macOS 12 or newer' },
  { key: 'mac-arm64', label: 'macOS · Apple Silicon (.dmg)', req: 'macOS 12 or newer' },
  { key: 'mac-x64', label: 'macOS · Intel (.dmg)', req: 'macOS 12 or newer' },
  { key: 'win-x64', label: 'Windows 10/11 · x64 (.exe)', req: 'Windows 10 or newer' },
  { key: 'win-arm64', label: 'Windows · ARM64 (.exe)', req: 'Windows 11 ARM' },
  { key: 'linux-x64', label: 'Linux · x64 (.AppImage)', req: 'glibc 2.31+' },
  { key: 'linux-arm64', label: 'Linux · ARM64 (.AppImage)', req: 'glibc 2.31+' },
];

export function DownloadTable() {
  const [dl, setDl] = useState<Downloads | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchDownloads()
      .then(setDl)
      .finally(() => setLoaded(true));
  }, []);

  const noneYet = loaded && dl && !dl.latestTag && !dl.apiUnavailable;

  return (
    <>
      <p className="mt-2 text-ink-secondary">
        {!loaded
          ? 'Checking for the latest release…'
          : dl?.apiUnavailable
            ? 'The live version check is busy right now. '
            : dl?.latestTag
              ? `Latest release: ${dl.latestTag}${
                  dl.publishedAt
                    ? ` · published ${new Date(dl.publishedAt).toLocaleDateString()}`
                    : ''
                }`
              : 'No public release has been published yet. '}
        {(dl?.apiUnavailable || noneYet) && (
          <a
            href={RELEASES_PAGE}
            className="text-primary underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Browse all releases on GitHub
          </a>
        )}
      </p>

      <div className="mt-8 overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-ink-secondary">
            <tr>
              <th className="px-4 py-3">Platform</th>
              <th className="px-4 py-3">Requirements</th>
              <th className="px-4 py-3">Size</th>
              <th className="px-4 py-3">Version</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {PLATFORMS.map((p) => {
              const asset = dl?.forPlatform?.[p.key];
              return (
                <tr key={p.key} className="border-t border-line">
                  <td className="px-4 py-3">{p.label}</td>
                  <td className="px-4 py-3 text-ink-secondary">{p.req}</td>
                  <td className="px-4 py-3 text-ink-secondary">
                    {asset ? formatBytes(asset.size) : '—'}
                  </td>
                  <td className="px-4 py-3 text-ink-secondary">{asset?.tag ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    {asset ? (
                      <a
                        href={asset.browserDownloadUrl}
                        className="inline-block rounded bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Download
                      </a>
                    ) : (
                      <span className="text-xs text-ink-secondary">Unavailable</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-secondary">
        {dl?.checksumsUrl && (
          <a href={dl.checksumsUrl} className="text-primary underline">
            SHA-256 checksums.txt
          </a>
        )}
        <Link href="/install" className="text-primary underline">
          Installation &amp; first-launch guide
        </Link>
        <a
          href={RELEASES_PAGE}
          className="text-primary underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          Release history
        </a>
      </div>
    </>
  );
}
