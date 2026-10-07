'use client';

import Link from 'next/link';
import { AppBenefits, AppAudiences } from '@/components/AppBenefits';
import { ArrowLink } from '@/components/ArrowLink';
import { BrandFilm } from '@/components/BrandFilm';
import { Eyebrow } from '@/components/Eyebrow';
import { Reveal } from '@/components/Reveal';
import { button, heading, lead } from '@/components/styles';
import { useT } from '@/lib/i18n';

// Start with the app and its value, then show how it supports businesses and CBOs.
export default function HomePage() {
  const t = useT();

  return (
    <>
      {/* Hero — dark, centered, drifting blobs, the film as the product shot. */}
      <section className="relative overflow-hidden bg-surface-dark text-ink-inverse">
        <div
          aria-hidden="true"
          className="animate-blob pointer-events-none absolute -start-24 -top-24 h-80 w-80 rounded-full bg-primary/20 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="animate-blob pointer-events-none absolute -end-16 top-40 h-72 w-72 rounded-full bg-primary/10 blur-3xl"
          style={{ animationDelay: '-7s' }}
        />
        <div className="relative mx-auto max-w-7xl px-6 pb-12 pt-20 text-center md:pb-16 md:pt-28">
          <Reveal>
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs tracking-wide text-ink-inverse/80">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-primary"
                style={{ animation: 'soft-pulse 1.8s ease-in-out infinite' }}
              />
              {t('home.badge')}
            </p>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="mx-auto mt-6 max-w-4xl text-4xl font-bold tracking-tighter sm:text-5xl lg:text-6xl">
              {t('home.h1')}
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-ink-inverse/80">
              {t('home.sub')}
            </p>
          </Reveal>
          <Reveal delay={240}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href="/download" className={button.primary}>
                {t('cta.download')}
              </Link>
              <Link href="/features" className={button.secondary}>
                {t('home.cta.app')}
              </Link>
            </div>
          </Reveal>
        </div>
        <div className="relative mx-auto max-w-[1680px] px-4 pb-20 sm:px-6 md:pb-28">
          <Reveal delay={360}>
            <BrandFilm />
          </Reveal>
        </div>
      </section>

      <section className="bg-surface-light py-20 md:py-24">
        <div className="mx-auto max-w-6xl px-6">
          <Reveal>
            <Eyebrow>{t('app.eyebrow')}</Eyebrow>
            <h2 className={heading.section}>{t('app.value.h2')}</h2>
            <p className={lead}>{t('app.value.body')}</p>
          </Reveal>
          <AppBenefits />
          <Reveal>
            <ArrowLink href="/features" className="mt-8">
              {t('home.cta.app')}
            </ArrowLink>
          </Reveal>
        </div>
      </section>

      <AppAudiences />

      {/* Privacy — a clean white statement card. */}
      <section className="bg-surface-light py-20 md:py-24">
        <div className="mx-auto max-w-4xl px-6">
          <Reveal>
            <div className="rounded-3xl border border-line bg-white p-8 text-center shadow-sm md:p-12">
              <h2 className="text-3xl font-bold tracking-tight text-ink-primary sm:text-4xl">
                {t('privacy.h2')}
              </h2>
              <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-ink-secondary">
                {t('privacy.body')}
              </p>
              <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-ink-secondary">
                {t('app.assistant')}
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
                <Link href="/download" className={button.primary}>
                  {t('cta.download')}
                </Link>
                <ArrowLink href="/privacy">{t('privacy.more')}</ArrowLink>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
