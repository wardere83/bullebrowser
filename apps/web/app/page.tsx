'use client';

import Link from 'next/link';
import { product } from '@bullebrowser/brand-tokens';
import { BrowserWalkthrough } from '@/components/BrowserWalkthrough';
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
      {/* White introduction, with the navy film as the visual focal point. */}
      <section className="relative overflow-hidden bg-white text-ink-primary">
        <div className="relative mx-auto max-w-7xl px-6 pb-12 pt-20 text-center md:pb-16 md:pt-28">
          <Reveal>
            <p className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1 text-xs tracking-wide text-ink-secondary">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-primary"
                style={{ animation: 'soft-pulse 1.8s ease-in-out infinite' }}
              />
              {t('home.badge')}
            </p>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="mx-auto mt-6 max-w-5xl text-5xl font-semibold leading-[1.08] tracking-tighter sm:text-6xl lg:text-7xl">
              {t('home.h1')}
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-ink-secondary">
              {t('home.sub')}
            </p>
          </Reveal>
          <Reveal delay={240}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href="/download" className={button.primary}>
                {t('cta.download')}
              </Link>
              <Link href="/features" className={`${button.secondary} border border-line`}>
                {t('home.cta.app')}
              </Link>
            </div>
          </Reveal>
          <p className="mt-6 text-xs tracking-wide text-ink-secondary">{t('home.platforms')}</p>
        </div>
        <div className="relative mx-auto max-w-[1280px] px-4 pb-20 sm:px-6 md:pb-28">
          <Reveal delay={360}>
            <BrandFilm />
          </Reveal>
        </div>
      </section>

      <BrowserWalkthrough />

      <section className="border-y border-line bg-white py-20 md:py-24">
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

      <section className="border-y border-line bg-white text-ink-primary">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 md:grid-cols-[1.2fr_1fr] md:py-28">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-ink-secondary">
              {t('company.eyebrow')}
            </p>
            <h2 className="mt-5 text-3xl font-semibold tracking-tight md:text-4xl">
              {t('company.h2')}
            </h2>
          </div>
          <div>
            <p className="text-base leading-relaxed text-ink-secondary">{t('company.body')}</p>
            <div className="mt-7 flex flex-wrap gap-6">
              <ArrowLink href="/about">{t('company.cta')}</ArrowLink>
              <a
                className="text-sm font-semibold text-ink-primary underline underline-offset-4"
                href={`mailto:${product.contactEmail}`}
              >
                {product.contactEmail}
              </a>
            </div>
          </div>
        </div>
      </section>

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
