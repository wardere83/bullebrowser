'use client';

import Link from 'next/link';
import { PageHero } from '@/components/PageHero';
import { useT } from '@/lib/i18n';
import { button, link } from './styles';

// What a visitor sees while a download starts: a short note, a button to start
// it again, and the way back to the download page.
export function DownloadStart({ url }: { url: string | null }) {
  const t = useT();
  return (
    <>
      <PageHero title={t('get.h1')} sub={url ? t('get.sub') : t('get.unavailable')} />
      <section className="bg-surface-light py-16 md:py-20">
        <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-center gap-x-6 gap-y-3 px-6">
          {url && (
            <button
              type="button"
              className={button.primary}
              onClick={() => {
                window.location.href = url;
              }}
            >
              {t('get.again')}
            </button>
          )}
          <Link href="/download" className={link.onLight}>
            {t('get.back')}
          </Link>
        </div>
      </section>
    </>
  );
}
