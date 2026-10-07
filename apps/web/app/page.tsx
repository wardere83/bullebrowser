'use client';

import Link from 'next/link';
import { ArrowLink } from '@/components/ArrowLink';
import { BrandFilm } from '@/components/BrandFilm';
import { Eyebrow } from '@/components/Eyebrow';
import { FundingDemo } from '@/components/FundingDemo';
import { Marquee } from '@/components/Marquee';
import { ProfileSample } from '@/components/ProfileSample';
import { Reveal } from '@/components/Reveal';
import { StatusLegend } from '@/components/StatusChip';
import { button, card, heading, lead, numberDisc } from '@/components/styles';
import { useEnglishLang, useT } from '@/lib/i18n';
import { GEO_LEVELS, KNOWLEDGE_HUB, PROPOSAL_GUIDE, WORKFLOWS } from '@/lib/terms';

const HUB_POINTS = ['formats', 'review', 'flag', 'cite', 'priorities', 'separate'] as const;

// The home page: what BulleBrowser is for, in the order a visitor needs it.
// A dark hero with the film, then the four options the app opens on, the
// Organization Knowledge Hub, a walk-through, the funding finder with what its
// three labels mean, RFP analysis beside the proposal guide, and privacy.
//
// Names the app shows on screen are printed in English in every language (see
// lib/terms.ts) and marked as English for screen readers.
export default function HomePage() {
  const t = useT();
  const english = useEnglishLang();
  const pills = [
    ...GEO_LEVELS.map((level) => t(`level.${level}`)),
    t('home.pill.sources'),
    t('home.pill.status'),
    t('home.pill.citations'),
    t('home.pill.device'),
  ];

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
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-ink-inverse/80">{t('home.sub')}</p>
          </Reveal>
          <Reveal delay={240}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href="/download" className={button.primary}>
                {t('cta.download')}
              </Link>
              <Link href="/features" className={button.secondary}>
                {t('home.cta.workflows')}
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

      {/* What it covers, in a moving band that can be paused. */}
      <section className="border-b border-line bg-surface-muted py-8">
        <Marquee items={pills} label={t('marquee.label')} />
      </section>

      {/* The four options — the signature dark panel with slate cards. */}
      <section className="bg-surface-light py-20 md:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <Reveal>
            <div className="rounded-3xl bg-surface-dark p-8 text-ink-inverse md:p-12">
              <div className="grid gap-10 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] xl:gap-12">
                <div>
                  <Eyebrow tone="dark">{t('ask.eyebrow')}</Eyebrow>
                  <h2 className={heading.section}>{t('ask.h2')}</h2>
                  <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-inverse/80">{t('ask.body')}</p>
                  <ArrowLink href="/features#workflows" tone="dark" className="mt-6">
                    {t('ask.more')}
                  </ArrowLink>
                </div>
                <ol role="list" className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  {WORKFLOWS.map((workflow, index) => (
                    <li key={workflow.id} className={card.slate}>
                      <span aria-hidden="true" className={numberDisc}>
                        {index + 1}
                      </span>
                      <h3 lang={english} className="mt-4 text-lg font-semibold leading-snug">
                        {workflow.label}
                      </h3>
                      <p className="mt-1 text-sm font-medium text-primary">{t(`ask.${workflow.id}.lede`)}</p>
                      <p className="mt-2 text-[14px] leading-relaxed text-ink-inverse/75">
                        {t(`ask.${workflow.id}.body`)}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
              {/* Said here, before anyone downloads: which parts need a key. */}
              <p className="mt-10 border-t border-white/10 pt-6 text-sm leading-relaxed text-ink-inverse/75">
                {t('browser.assistant.d')}
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Organization Knowledge Hub. */}
      <section className="bg-surface-muted py-20 md:py-24">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
          <Reveal>
            <Eyebrow>{t('hub.eyebrow')}</Eyebrow>
            <h2 lang={english} className={heading.section}>
              {KNOWLEDGE_HUB}
            </h2>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-primary">{t('hub.description')}</p>
            <ul role="list" className="mt-10 grid gap-x-10 gap-y-7 sm:grid-cols-2">
              {HUB_POINTS.map((point) => (
                <li key={point} className="border-s-2 border-primary ps-4">
                  <h3 className="text-[15px] font-semibold text-ink-primary">{t(`hub.${point}.t`)}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-secondary">{t(`hub.${point}.d`)}</p>
                </li>
              ))}
            </ul>
            <ArrowLink href="/features#knowledge-hub" className="mt-10">
              {t('hub.more')}
            </ArrowLink>
          </Reveal>
          <Reveal delay={120}>
            <ProfileSample />
          </Reveal>
        </div>
      </section>

      {/* The walk-through. */}
      <section className="bg-surface-light py-20 md:py-24">
        <div className="mx-auto max-w-5xl px-6">
          <Reveal>
            <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
              <Eyebrow>{t('demo.eyebrow')}</Eyebrow>
              <h2 className={heading.section}>{t('demo.h2')}</h2>
              <p className="mt-4 text-[15px] leading-relaxed text-ink-secondary">{t('demo.body')}</p>
            </div>
          </Reveal>
          <Reveal delay={80}>
            <FundingDemo />
          </Reveal>
        </div>
      </section>

      {/* The funding finder, and what its three labels mean. */}
      <section className="bg-surface-muted py-20 md:py-24">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 lg:grid-cols-2 lg:items-start">
          <Reveal>
            <Eyebrow>{t('finder.eyebrow')}</Eyebrow>
            <h2 className={heading.section}>{t('finder.h2')}</h2>
            <p className={lead}>{t('finder.body')}</p>
            <ul role="list" className="mt-6 flex flex-wrap gap-2">
              {GEO_LEVELS.map((level) => (
                <li
                  key={level}
                  className="rounded-full border border-line-strong bg-white px-3 py-1 text-sm text-ink-primary"
                >
                  {t(`level.${level}`)}
                </li>
              ))}
            </ul>
            <ArrowLink href="/features#funding-finder" className="mt-8">
              {t('finder.more')}
            </ArrowLink>
          </Reveal>
          <Reveal delay={120}>
            <div className={card.statement}>
              <h3 className={heading.sub}>{t('status.heading')}</h3>
              <div className="mt-6">
                <StatusLegend />
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* RFP analysis beside the proposal guide. */}
      <section className="bg-surface-light py-20 md:py-24">
        <div className="mx-auto grid max-w-7xl gap-6 px-6 lg:grid-cols-2">
          <Reveal className="h-full">
            <div className={`h-full ${card.statement}`}>
              <Eyebrow>{t('rfp.eyebrow')}</Eyebrow>
              <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">{t('rfp.h2')}</h2>
              <p className={lead}>{t('rfp.body')}</p>
              <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-secondary">{t('rfp.rule.profile')}</p>
              <ArrowLink href="/features#rfp-analysis" className="mt-6">
                {t('rfp.more')}
              </ArrowLink>
            </div>
          </Reveal>
          <Reveal delay={100} className="h-full">
            <div className={`h-full ${card.statement}`}>
              <Eyebrow>{t('guide.eyebrow')}</Eyebrow>
              <h2 lang={english} className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
                {PROPOSAL_GUIDE}
              </h2>
              <p className={lead}>{t('guide.body')}</p>
              <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-secondary">
                {t('guide.rule.invent.d')}
              </p>
              <ArrowLink href="/features#proposal-guide" className="mt-6">
                {t('guide.more')}
              </ArrowLink>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Privacy — a clean white statement card. */}
      <section className="bg-surface-light pb-20 md:pb-24">
        <div className="mx-auto max-w-4xl px-6">
          <Reveal>
            <div className="rounded-3xl border border-line bg-white p-8 text-center shadow-sm md:p-12">
              <h2 className="text-3xl font-bold tracking-tight text-ink-primary sm:text-4xl">{t('privacy.h2')}</h2>
              <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-ink-secondary">
                {t('privacy.body')}
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
