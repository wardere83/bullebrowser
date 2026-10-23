'use client';

import { ArrowLink } from '@/components/ArrowLink';
import { PageHero } from '@/components/PageHero';
import { Reveal } from '@/components/Reveal';
import { numberDisc } from '@/components/styles';
import { useEnglishLang, useT } from '@/lib/i18n';
import { WORKFLOWS } from '@/lib/terms';

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li>
      <Reveal delay={(n - 1) * 60}>
        <div className="flex gap-4 rounded-2xl border border-line bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
          <span aria-hidden="true" className={numberDisc}>
            {n}
          </span>
          <div className="min-w-0 pb-1">
            <h2 className="text-base font-semibold text-ink-primary">{title}</h2>
            <div className="mt-1 space-y-2 text-sm leading-relaxed text-ink-secondary">{children}</div>
          </div>
        </div>
      </Reveal>
    </li>
  );
}

// The Guides page: from the installer to the first funding search, as six
// steps in the order the app itself walks through them. The words in
// quotation marks are the app's own labels, which are in English.
export default function InstallPage() {
  const t = useT();
  const english = useEnglishLang();
  return (
    <>
      <PageHero title={t('install.h1')} sub={t('install.sub')} />

      <section className="bg-surface-light py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6">
          <ol role="list" className="space-y-5">
            <Step n={1} title={t('install.s1.t')}>
              <p>
                <strong className="font-semibold text-ink-primary">macOS.</strong> {t('install.s1.mac')}
              </p>
              <p>
                <strong className="font-semibold text-ink-primary">Windows.</strong> {t('install.s1.win')}
              </p>
              <p>
                <strong className="font-semibold text-ink-primary">Linux.</strong> {t('install.s1.linux')}
              </p>
              <p>
                <code
                  dir="ltr"
                  className="inline-block rounded bg-surface-muted px-2 py-1 font-mono text-[12.5px] text-ink-primary"
                >
                  chmod +x BulleBrowser-*.AppImage
                </code>
              </p>
            </Step>
            <Step n={2} title={t('install.s2.t')}>
              <p>{t('install.s2.d')}</p>
            </Step>
            <Step n={3} title={t('install.s3.t')}>
              <p>{t('install.s3.d')}</p>
            </Step>
            <Step n={4} title={t('install.s4.t')}>
              <p>{t('install.s4.d')}</p>
            </Step>
            <Step n={5} title={t('install.s5.t')}>
              <p>{t('install.s5.d')}</p>
            </Step>
            <Step n={6} title={t('install.s6.t')}>
              <p>{t('install.s6.d')}</p>
              <ol lang={english} className="list-decimal space-y-1 ps-5 text-ink-primary marker:text-ink-secondary">
                {WORKFLOWS.map((workflow) => (
                  <li key={workflow.id}>{workflow.label}</li>
                ))}
              </ol>
            </Step>
          </ol>

          <Reveal>
            <div className="mt-10 grid gap-5 sm:grid-cols-2">
              <div className="rounded-2xl border border-line bg-surface-muted p-5 text-sm">
                <h2 className="font-semibold text-ink-primary">{t('install.note.t')}</h2>
                <p className="mt-1 leading-relaxed text-ink-secondary">{t('install.note.d')}</p>
              </div>
              <div className="rounded-2xl border border-line bg-surface-muted p-5 text-sm">
                <h2 className="font-semibold text-ink-primary">{t('install.updates.t')}</h2>
                <p className="mt-1 leading-relaxed text-ink-secondary">{t('install.updates.d')}</p>
              </div>
            </div>
          </Reveal>

          <ArrowLink href="/features" className="mt-8">
            {t('install.next')}
          </ArrowLink>
        </div>
      </section>
    </>
  );
}
