'use client';

import Link from 'next/link';
import { AppBenefits, AppAudiences } from '@/components/AppBenefits';
import { ArrowLink } from '@/components/ArrowLink';
import { Eyebrow } from '@/components/Eyebrow';
import { PageHero } from '@/components/PageHero';
import { Reveal } from '@/components/Reveal';
import { button, card, heading, lead } from '@/components/styles';
import { useT } from '@/lib/i18n';

export default function FeaturesPage() {
  const t = useT();

  return (
    <>
      <PageHero title={t('features.h1')} sub={t('features.sub')}>
        <Link href="/download" className={button.primary}>
          {t('cta.download')}
        </Link>
      </PageHero>

      <section className="bg-surface-light py-20 md:py-24">
        <div className="mx-auto max-w-6xl px-6">
          <Reveal>
            <Eyebrow>{t('app.eyebrow')}</Eyebrow>
            <h2 className={heading.section}>{t('app.value.h2')}</h2>
            <p className={lead}>{t('app.overview')}</p>
          </Reveal>
          <AppBenefits />
        </div>
      </section>

      <AppAudiences />

      <section className="bg-surface-light py-20 md:py-24">
        <div className="mx-auto max-w-4xl px-6">
          <Reveal>
            <div className={card.statement}>
              <Eyebrow>{t('app.control.eyebrow')}</Eyebrow>
              <h2 className={heading.section}>{t('app.control.h2')}</h2>
              <p className={lead}>{t('app.control.body')}</p>
              <p className="mt-4 text-[15px] leading-relaxed text-ink-secondary">
                {t('app.assistant')}
              </p>
              <p className="mt-4 text-[15px] leading-relaxed text-ink-secondary">
                {t('privacy.5')}
              </p>
              <ArrowLink href="/privacy" className="mt-8">
                {t('privacy.more')}
              </ArrowLink>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="bg-surface-dark text-ink-inverse">
        <div className="mx-auto max-w-3xl px-6 py-24 text-center">
          <Reveal>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {t('features.cta.h2')}
            </h2>
            <p className="mt-4 text-ink-inverse/80">{t('features.cta.sub')}</p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-5">
              <Link href="/download" className={button.primary}>
                {t('cta.download')}
              </Link>
              <ArrowLink href="/install" tone="dark">
                {t('download.guide')}
              </ArrowLink>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
