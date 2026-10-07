'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useLocale, useT, type MessageKey } from '@/lib/i18n';
import { RELEASES_PAGE, fetchDownloads, formatBytes, type Downloads, type Platform } from '@/lib/releases';
import { button, link } from './styles';

// The platform names are the same in every language; what each one needs is
// a sentence, so it is translated.
const PLATFORMS: { key: Platform; label: string; requirement: MessageKey }[] = [
  { key: 'mac-arm64', label: 'macOS · Apple Silicon (.dmg)', requirement: 'download.req.mac' },
  { key: 'mac-x64', label: 'macOS · Intel (.dmg)', requirement: 'download.req.mac' },
  { key: 'win-x64', label: 'Windows 10/11 · x64 (.exe)', requirement: 'download.req.win' },
  { key: 'win-arm64', label: 'Windows · ARM64 (.exe)', requirement: 'download.req.winArm' },
  { key: 'linux-x64', label: 'Linux · x64 (.AppImage)', requirement: 'download.req.linux' },
  { key: 'linux-arm64', label: 'Linux · ARM64 (.AppImage)', requirement: 'download.req.linux' },
];

// The installers for the current release, read from the manifest baked into
// the site when it was built. Whatever the outcome it says so in words:
// checking, the release it found, none published, or the list unavailable.
export function DownloadTable() {
  const t = useT();
  const { locale } = useLocale();
  const [dl, setDl] = useState<Downloads | null>(null);
  const [loaded, setLoaded] = useState(false);
  const captionId = useId();

  useEffect(() => {
    fetchDownloads()
      .then(setDl)
      .finally(() => setLoaded(true));
  }, []);

  let status = t('download.checking');
  if (loaded) {
    if (!dl || dl.apiUnavailable) status = t('download.unavailableNow');
    else if (!dl.latestTag) status = t('download.none');
    else {
      status = `${t('download.latest')} ${dl.latestTag}`;
      if (dl.publishedAt) {
        status += ` · ${t('download.published')} ${new Date(dl.publishedAt).toLocaleDateString(locale)}`;
      }
    }
  }

  // Until the list has been read, a row is still being checked, not unavailable:
  // it shows a dash and says nothing, and the line above says what is going on.
  const missing = loaded ? t('download.unavailable') : null;

  return (
    <>
      <p className="text-ink-secondary" aria-live="polite">
        {status}
      </p>

      {/* Scrolls sideways on a narrow screen, and can be scrolled by keyboard. */}
      <div
        role="region"
        aria-labelledby={captionId}
        tabIndex={0}
        className="mt-6 overflow-x-auto rounded-lg border border-line"
      >
        <table className="w-full min-w-[36rem] text-sm">
          <caption id={captionId} className="sr-only">
            {t('download.caption')}
          </caption>
          <thead className="bg-surface-muted text-start text-xs uppercase tracking-wide text-ink-secondary">
            <tr>
              <th scope="col" className="px-4 py-3 text-start font-semibold">
                {t('download.col.platform')}
              </th>
              <th scope="col" className="px-4 py-3 text-start font-semibold">
                {t('download.col.requirements')}
              </th>
              <th scope="col" className="px-4 py-3 text-start font-semibold">
                {t('download.col.size')}
              </th>
              <th scope="col" className="px-4 py-3 text-start font-semibold">
                {t('download.col.version')}
              </th>
              <th scope="col" className="px-4 py-3 text-end font-semibold">
                {t('download.col.action')}
              </th>
            </tr>
          </thead>
          <tbody>
            {PLATFORMS.map((platform) => {
              const installer = dl?.forPlatform?.[platform.key];
              return (
                <tr key={platform.key} className="border-t border-line">
                  <th scope="row" className="px-4 py-3 text-start font-medium text-ink-primary">
                    {platform.label}
                  </th>
                  <td className="px-4 py-3 text-ink-secondary">{t(platform.requirement)}</td>
                  <td className="px-4 py-3 text-ink-secondary">
                    {installer ? formatBytes(installer.size) : <Missing label={missing} />}
                  </td>
                  <td className="px-4 py-3 text-ink-secondary">
                    {installer ? installer.tag : <Missing label={missing} />}
                  </td>
                  <td className="px-4 py-3 text-end">
                    {installer ? (
                      <a href={installer.browserDownloadUrl} className={button.small}>
                        {t('download.action')}
                        <span className="sr-only"> — {platform.label}</span>
                      </a>
                    ) : (
                      missing && <span className="text-xs text-ink-secondary">{missing}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link href="/install" className={link.onLight}>
          {t('download.guide')}
        </Link>
        {dl?.checksumsUrl && (
          <a href={dl.checksumsUrl} className={link.onLight}>
            {t('download.checksums')}
          </a>
        )}
        {/* A way forward even when the list above could not be loaded. */}
        <a href={RELEASES_PAGE} className={link.onLight}>
          {t('download.releases')}
        </a>
      </div>
    </>
  );
}

/** A dash for the eye and, once there is something to say, words for a screen reader. */
function Missing({ label }: { label: string | null }) {
  return (
    <>
      <span aria-hidden="true">—</span>
      {label && <span className="sr-only">{label}</span>}
    </>
  );
}
