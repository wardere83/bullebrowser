'use client';

import { Eyebrow } from '@/components/Eyebrow';
import { Reveal } from '@/components/Reveal';
import { card, heading, lead } from '@/components/styles';
import { useT } from '@/lib/i18n';

const BENEFITS = ['context', 'focus', 'strengths'] as const;
const AUDIENCES = ['businesses', 'cbos'] as const;

export function AppBenefits() {
  const t = useT();
  return (
    <ul role="list" className="mt-10 grid gap-6 md:grid-cols-3">
      {BENEFITS.map((benefit, index) => (
        <li key={benefit}>
          <Reveal delay={index * 60} className="h-full">
            <div className={card.light}>
              <h3 className="text-lg font-semibold text-ink-primary">
                {t(`app.benefit.${benefit}.t`)}
              </h3>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-secondary">
                {t(`app.benefit.${benefit}.d`)}
              </p>
            </div>
          </Reveal>
        </li>
      ))}
    </ul>
  );
}

export function AppAudiences() {
  const t = useT();
  return (
    <section className="bg-surface-muted py-20 md:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal>
          <Eyebrow>{t('app.audiences.eyebrow')}</Eyebrow>
          <h2 className={heading.section}>{t('app.audiences.h2')}</h2>
          <p className={lead}>{t('app.audiences.body')}</p>
        </Reveal>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {AUDIENCES.map((audience, index) => (
            <Reveal key={audience} delay={index * 80} className="h-full">
              <div className={`h-full ${card.statement}`}>
                <h3 className={heading.sub}>{t(`app.audience.${audience}.t`)}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-secondary">
                  {t(`app.audience.${audience}.d`)}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
