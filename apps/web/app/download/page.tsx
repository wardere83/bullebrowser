'use client';

import { DownloadTable } from '@/components/DownloadTable';
import { PageHero } from '@/components/PageHero';
import { Reveal } from '@/components/Reveal';
import { useT } from '@/lib/i18n';

// The Download page: a dark hero, then the installers for the current release
// in a white card, with what is and is not code-signed stated underneath.
export default function DownloadPage() {
  const t = useT();
  return (
    <>
      <PageHero title={t('download.h1')} sub={t('download.sub')} />

      <section className="bg-surface-light py-16 md:py-20">
        <div className="mx-auto max-w-4xl px-6">
          <Reveal>
            <div className="rounded-3xl border border-line bg-white p-6 shadow-sm md:p-8">
              <DownloadTable />
            </div>
          </Reveal>
          <p className="mx-auto mt-6 max-w-2xl text-center text-sm leading-relaxed text-ink-secondary">
            {t('download.signed')}
          </p>
        </div>
      </section>
    </>
  );
}
