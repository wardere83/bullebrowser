'use client';

import Link from 'next/link';
import { product } from '@bullebrowser/brand-tokens';
import { PageHero } from '@/components/PageHero';
import { ArrowLink } from '@/components/ArrowLink';
import { button } from '@/components/styles';
import { useT } from '@/lib/i18n';

export default function AboutPage() {
  const t = useT();
  return (
    <>
      <PageHero title={t('about.h1')} sub={t('about.lead')}>
        <Link href="/download" className={button.primary}>
          {t('cta.download')}
        </Link>
      </PageHero>
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <div className="grid gap-12 md:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-ink-secondary">
              {t('company.eyebrow')}
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight">{t('company.h2')}</h2>
          </div>
          <div className="space-y-9">
            <section>
              <h3 className="text-xl font-semibold">{t('about.why.h2')}</h3>
              <p className="mt-3 leading-relaxed text-ink-secondary">{t('about.why.p')}</p>
            </section>
            <section>
              <h3 className="text-xl font-semibold">{t('about.limits.h2')}</h3>
              <p className="mt-3 leading-relaxed text-ink-secondary">{t('about.limits.p')}</p>
            </section>
            <section>
              <h3 className="text-xl font-semibold">{t('about.key.h2')}</h3>
              <p className="mt-3 leading-relaxed text-ink-secondary">{t('about.key.p')}</p>
              <ArrowLink href="/privacy" className="mt-5">
                {t('privacy.more')}
              </ArrowLink>
            </section>
          </div>
        </div>
        <section className="mt-20 rounded-3xl bg-surface-dark p-8 text-white md:p-12">
          <h2 className="text-3xl font-semibold tracking-tight">{t('about.contact.h2')}</h2>
          <p className="mt-4 text-white/75">{t('about.contact.p')}</p>
          <a
            href={`mailto:${product.contactEmail}`}
            className="mt-6 inline-block break-all text-lg font-semibold text-primary underline underline-offset-4"
          >
            {product.contactEmail}
          </a>
        </section>
      </div>
    </>
  );
}
