'use client';

import Link from 'next/link';
import { ArrowLink } from '@/components/ArrowLink';
import { Eyebrow } from '@/components/Eyebrow';
import { PageHero } from '@/components/PageHero';
import { Reveal } from '@/components/Reveal';
import { StatusLegend } from '@/components/StatusChip';
import { button, card, heading, lead, numberDisc } from '@/components/styles';
import { useEnglishLang, useT } from '@/lib/i18n';
import { GEO_LEVELS, KNOWLEDGE_HUB, LIVE_SOURCES, PROPOSAL_GUIDE, WORKFLOWS } from '@/lib/terms';

const STEPS = ['1', '2', '3'] as const;
const HUB_POINTS = ['formats', 'review', 'flag', 'cite', 'priorities', 'separate'] as const;
const HUB_STEPS = ['1', '2', '3', '4'] as const;
const FILTERS = ['geography', 'eligibility', 'category', 'amount', 'deadline'] as const;
const RFP_COVERS = ['purpose', 'eligibility', 'terms', 'process', 'alignment', 'gaps'] as const;
const RFP_RULES = ['cite', 'split', 'missing', 'profile', 'assistant'] as const;
const GUIDE_RULES = ['own', 'strengths', 'invent', 'ai', 'feedback', 'owner'] as const;
const BROWSER_POINTS = ['access', 'steps', 'budget', 'confirm', 'voice', 'assistant'] as const;
const PRIVACY_POINTS = ['1', '2', '3', '4', '5', '6'] as const;

// The Workflows page: each part of the product in turn, with what it does and
// what it will not do. Sections alternate light and muted bands, and each has
// an id so the home page and the list at the top can link straight to it.
export default function FeaturesPage() {
  const t = useT();
  const english = useEnglishLang();

  const contents = [
    { href: '#workflows', label: t('features.flows.eyebrow') },
    { href: '#knowledge-hub', label: KNOWLEDGE_HUB, lang: english },
    { href: '#funding-finder', label: t('finder.eyebrow') },
    { href: '#rfp-analysis', label: t('rfp.eyebrow') },
    { href: '#proposal-guide', label: t('guide.eyebrow') },
    { href: '#browser', label: t('browser.eyebrow') },
    { href: '#privacy', label: t('privacy.eyebrow') },
  ];

  return (
    <>
      <PageHero title={t('features.h1')} sub={t('features.sub')}>
        <Link href="/download" className={button.primary}>
          {t('cta.download')}
        </Link>
      </PageHero>

      <nav aria-label={t('features.toc')} className="border-b border-line bg-surface-muted">
        <ul className="mx-auto flex max-w-6xl flex-wrap justify-center gap-x-6 gap-y-2 px-6 py-4 text-sm">
          {contents.map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                lang={item.lang}
                className="font-medium text-ink-primary underline underline-offset-4 hover:decoration-primary hover:decoration-2"
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* The four workflows, each in three steps. */}
      <section id="workflows" className="scroll-mt-24 bg-surface-light py-20 md:py-24">
        <div className="mx-auto max-w-6xl px-6">
          <Reveal>
            <Eyebrow>{t('features.flows.eyebrow')}</Eyebrow>
            <h2 className={heading.section}>{t('features.flows.h2')}</h2>
            <p className={lead}>{t('ask.body')}</p>
          </Reveal>
          <ol role="list" className="mt-10 grid gap-6 lg:grid-cols-2">
            {WORKFLOWS.map((workflow, index) => (
              <li key={workflow.id}>
                <Reveal delay={index * 60} className="h-full">
                  <div className={card.light}>
                    <div className="flex items-start gap-4">
                      <span aria-hidden="true" className={numberDisc}>
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <h3 lang={english} className="text-lg font-semibold leading-snug text-ink-primary">
                          {workflow.label}
                        </h3>
                        <p className="mt-1 text-sm font-medium text-ink-secondary">{t(`ask.${workflow.id}.lede`)}</p>
                      </div>
                    </div>
                    <ol className="mt-5 list-decimal space-y-2 ps-5 text-sm leading-relaxed text-ink-secondary marker:font-semibold marker:text-ink-primary">
                      {STEPS.map((step) => (
                        <li key={step}>{t(`features.flow.${workflow.id}.${step}`)}</li>
                      ))}
                    </ol>
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Organization Knowledge Hub. */}
      <section id="knowledge-hub" className="scroll-mt-24 bg-surface-muted py-20 md:py-24">
        <div className="mx-auto max-w-6xl px-6">
          <Reveal>
            <Eyebrow>{t('hub.eyebrow')}</Eyebrow>
            <h2 lang={english} className={heading.section}>
              {KNOWLEDGE_HUB}
            </h2>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-primary">{t('hub.description')}</p>
          </Reveal>
          <ul role="list" className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {HUB_POINTS.map((point, index) => (
              <li key={point}>
                <Reveal delay={index * 60} className="h-full">
                  <div className={card.light}>
                    <h3 className="text-sm font-semibold text-ink-primary">{t(`hub.${point}.t`)}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-ink-secondary">{t(`hub.${point}.d`)}</p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ul>
          <Reveal>
            <div className={`mt-10 ${card.statement}`}>
              <h3 className={heading.sub}>{t('hub.how.h3')}</h3>
              <ol className="mt-5 list-decimal space-y-3 ps-5 text-[15px] leading-relaxed text-ink-secondary marker:font-semibold marker:text-ink-primary">
                {HUB_STEPS.map((step) => (
                  <li key={step}>{t(`hub.how.${step}`)}</li>
                ))}
              </ol>
              <p className="mt-5 border-t border-line pt-5 text-sm leading-relaxed text-ink-secondary">
                {t('hub.how.note')}
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Funding opportunity finder. */}
      <section id="funding-finder" className="scroll-mt-24 bg-surface-light py-20 md:py-24">
        <div className="mx-auto max-w-6xl px-6">
          <Reveal>
            <Eyebrow>{t('finder.eyebrow')}</Eyebrow>
            <h2 className={heading.section}>{t('finder.h2')}</h2>
            <p className={lead}>{t('finder.body')}</p>
          </Reveal>

          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            <Reveal className="h-full">
              <div className={`h-full ${card.statement}`}>
                <h3 className={heading.sub}>{t('finder.levels.h3')}</h3>
                <ul role="list" className="mt-4 flex flex-wrap gap-2">
                  {GEO_LEVELS.map((level) => (
                    <li
                      key={level}
                      className="rounded-full border border-line-strong bg-surface-muted px-3 py-1 text-sm text-ink-primary"
                    >
                      {t(`level.${level}`)}
                    </li>
                  ))}
                </ul>
                <h3 className={`mt-8 ${heading.sub}`}>{t('finder.filters.h3')}</h3>
                <ul role="list" className="mt-4 flex flex-wrap gap-2">
                  {FILTERS.map((filter) => (
                    <li
                      key={filter}
                      className="rounded-full border border-line-strong bg-surface-muted px-3 py-1 text-sm text-ink-primary"
                    >
                      {t(`filter.${filter}`)}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
            <Reveal delay={100} className="h-full">
              <div className={`h-full ${card.statement}`}>
                <h3 className={heading.sub}>{t('status.heading')}</h3>
                <div className="mt-6">
                  <StatusLegend />
                </div>
              </div>
            </Reveal>
          </div>

          <Reveal>
            <div className={`mt-6 ${card.statement}`}>
              <h3 className={heading.sub}>{t('finder.sources.h3')}</h3>
              <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink-secondary">
                {t('finder.sources.body')}
              </p>
              <div className="mt-6 overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-[34rem] text-sm">
                  <caption className="sr-only">{t('finder.sources.caption')}</caption>
                  <thead className="bg-surface-muted text-xs uppercase tracking-wide text-ink-secondary">
                    <tr>
                      <th scope="col" className="px-4 py-3 text-start font-semibold">
                        {t('finder.col.source')}
                      </th>
                      <th scope="col" className="px-4 py-3 text-start font-semibold">
                        {t('finder.col.level')}
                      </th>
                      <th scope="col" className="px-4 py-3 text-start font-semibold">
                        {t('finder.col.lists')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {LIVE_SOURCES.map((source) => (
                      <tr key={source.id} className="border-t border-line">
                        <th scope="row" lang={english} className="px-4 py-3 text-start font-medium text-ink-primary">
                          {source.name}
                        </th>
                        <td className="px-4 py-3 text-ink-secondary">{t(`level.${source.level}`)}</td>
                        <td className="px-4 py-3 text-ink-secondary">{t(`source.${source.about}.d`)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-ink-secondary">{t('finder.sources.note')}</p>
              <h3 className={`mt-8 ${heading.sub}`}>{t('finder.portals.t')}</h3>
              <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink-secondary">
                {t('finder.portals.d')}
              </p>
              <p className="mt-5 border-t border-line pt-5 text-sm leading-relaxed text-ink-secondary">
                {t('finder.coverage')}
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* RFP upload and analysis. */}
      <section id="rfp-analysis" className="scroll-mt-24 bg-surface-muted py-20 md:py-24">
        <div className="mx-auto max-w-6xl px-6">
          <Reveal>
            <Eyebrow>{t('rfp.eyebrow')}</Eyebrow>
            <h2 className={heading.section}>{t('rfp.h2')}</h2>
            <p className={lead}>{t('rfp.body')}</p>
          </Reveal>
          <Reveal>
            <h3 className={`mt-10 ${heading.sub}`}>{t('rfp.covers.h3')}</h3>
          </Reveal>
          <ul role="list" className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {RFP_COVERS.map((cover, index) => (
              <li key={cover}>
                <Reveal delay={index * 60} className="h-full">
                  <div className={card.light}>
                    <h4 className="text-sm font-semibold text-ink-primary">{t(`rfp.cover.${cover}.t`)}</h4>
                    <p className="mt-1 text-sm leading-relaxed text-ink-secondary">{t(`rfp.cover.${cover}.d`)}</p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ul>
          <Reveal>
            <div className={`mt-10 ${card.statement}`}>
              <h3 className={heading.sub}>{t('rfp.rules.h3')}</h3>
              <Bullets>
                {RFP_RULES.map((rule) => (
                  <Bullet key={rule}>{t(`rfp.rule.${rule}`)}</Bullet>
                ))}
              </Bullets>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Ethical Strengths-Based Proposal Guide — the dark slate-card panel. */}
      <section id="proposal-guide" className="scroll-mt-24 bg-surface-light py-20 md:py-24">
        <div className="mx-auto max-w-6xl px-6">
          <Reveal>
            <div className="rounded-3xl bg-surface-dark p-8 text-ink-inverse md:p-12">
              <Eyebrow tone="dark">{t('guide.eyebrow')}</Eyebrow>
              <h2 lang={english} className={heading.section}>
                {PROPOSAL_GUIDE}
              </h2>
              <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-inverse/80">{t('guide.body')}</p>
              <ul role="list" className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {GUIDE_RULES.map((rule) => (
                  <li key={rule} className={card.slate}>
                    <h3 className="text-base font-semibold">{t(`guide.rule.${rule}.t`)}</h3>
                    <p className="mt-2 text-[14px] leading-relaxed text-ink-inverse/75">
                      {t(`guide.rule.${rule}.d`)}
                    </p>
                  </li>
                ))}
              </ul>
              <p className="mt-8 max-w-3xl text-sm leading-relaxed text-ink-inverse/70">{t('common.disclaimer')}</p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* The browser and its assistant. */}
      <section id="browser" className="scroll-mt-24 bg-surface-muted py-20 md:py-24">
        <div className="mx-auto max-w-6xl px-6">
          <Reveal>
            <Eyebrow>{t('browser.eyebrow')}</Eyebrow>
            <h2 className={heading.section}>{t('browser.h2')}</h2>
            <p className={lead}>{t('browser.body')}</p>
          </Reveal>
          <ul role="list" className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {BROWSER_POINTS.map((point, index) => (
              <li key={point}>
                <Reveal delay={index * 60} className="h-full">
                  <div className={card.light}>
                    <h3 className="text-sm font-semibold text-ink-primary">{t(`browser.${point}.t`)}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-ink-secondary">{t(`browser.${point}.d`)}</p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Privacy. */}
      <section id="privacy" className="scroll-mt-24 bg-surface-light py-20 md:py-24">
        <div className="mx-auto max-w-4xl px-6">
          <Reveal>
            <div className={card.statement}>
              <Eyebrow>{t('privacy.eyebrow')}</Eyebrow>
              <h2 className={heading.section}>{t('privacy.h2')}</h2>
              <Bullets>
                {PRIVACY_POINTS.map((point) => (
                  <Bullet key={point}>{t(`privacy.${point}`)}</Bullet>
                ))}
              </Bullets>
              <ArrowLink href="/privacy" className="mt-8">
                {t('privacy.more')}
              </ArrowLink>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Call to action. */}
      <section className="relative overflow-hidden bg-surface-dark text-ink-inverse">
        <div
          aria-hidden="true"
          className="animate-blob pointer-events-none absolute -start-16 bottom-0 h-72 w-72 rounded-full bg-primary/15 blur-3xl"
        />
        <div className="relative mx-auto max-w-3xl px-6 py-24 text-center">
          <Reveal>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('features.cta.h2')}</h2>
            <p className="mt-4 text-ink-inverse/80">{t('features.cta.sub')}</p>
            <Link href="/download" className={`mt-8 ${button.primary}`}>
              {t('cta.download')}
            </Link>
          </Reveal>
        </div>
      </section>
    </>
  );
}

function Bullets({ children }: { children: React.ReactNode }) {
  return (
    <ul role="list" className="mt-6 space-y-3 text-[15px] leading-relaxed text-ink-secondary">
      {children}
    </ul>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
      <span>{children}</span>
    </li>
  );
}
