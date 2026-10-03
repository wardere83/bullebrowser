'use client';

import Link from 'next/link';
import { product } from '@bullebrowser/brand-tokens';
import { AgentPanel } from '@/components/AgentPanel';
import { BrandFilm } from '@/components/BrandFilm';
import { Reveal } from '@/components/Reveal';
import { Marquee } from '@/components/Marquee';
import { useT } from '@/lib/i18n';

const SKILL_KEYS = ['page', 'nav', 'flow'] as const;

const MARQUEE = [
  'Summarize this page',
  'Compare options',
  'Act on the page',
  'Research grants',
  'Compare RFPs',
  'Review compliance',
  'Automate workflows',
  'Drive your tabs',
  'Voice control',
];

// The home page in the Bulle Consulting brand layout, with its motion: a dark
// hero with drifting teal blobs and a staggered fade-in, then the BulleBrowser
// film in a cinema frame, a scrolling capability
// marquee, and reveal-on-scroll panels. All copy is the existing BulleBrowser
// content (via i18n) and the live agent demo — only the styling and animation
// changed.
export default function HomePage() {
  const t = useT();
  return (
    <>
      {/* Hero — dark, centered, drifting blobs, the agent panel as product shot. */}
      <section className="relative overflow-hidden bg-surface-dark text-ink-inverse">
        <div aria-hidden className="animate-blob pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-primary/20 blur-3xl" />
        <div aria-hidden className="animate-blob pointer-events-none absolute -right-16 top-40 h-72 w-72 rounded-full bg-primary/10 blur-3xl" style={{ animationDelay: '-7s' }} />
        <div className="relative mx-auto max-w-7xl px-6 pb-12 pt-20 text-center md:pb-16 md:pt-28">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs tracking-wide text-ink-inverse/80">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" style={{ animation: 'soft-pulse 1.8s ease-in-out infinite' }} />
              {t('home.badge')} {product.vendor}
            </span>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-extrabold tracking-tighter sm:text-5xl lg:text-6xl">
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
              <Link
                href="/download"
                className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-white transition-all duration-300 hover:scale-105 hover:bg-primary-hover"
              >
                {t('download.h1')} {product.name}
              </Link>
              <Link
                href="/features"
                className="inline-flex items-center justify-center rounded-lg bg-white px-6 py-3 text-sm font-semibold text-ink-primary transition-all duration-300 hover:scale-105 hover:bg-gray-200"
              >
                {t('home.skills.explore')}
              </Link>
            </div>
          </Reveal>
        </div>
        {/* The film — the hero's product shot, in a wide cinema frame. */}
        <div className="relative mx-auto max-w-[1680px] px-4 pb-20 text-left sm:px-6 md:pb-28">
          <Reveal delay={360}>
            <BrandFilm />
          </Reveal>
        </div>
      </section>

      {/* Capability marquee. */}
      <section className="border-b border-line bg-surface-muted py-8">
        <Marquee items={MARQUEE} />
      </section>

      {/* The live assistant demo — try what the film shows. */}
      <section className="bg-surface-light py-20 md:py-24">
        <div className="mx-auto max-w-3xl px-6">
          <Reveal>
            <h2 className="mb-8 text-center text-3xl font-bold tracking-tight text-ink-primary sm:text-4xl">
              {t('film.demo')}
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <AgentPanel />
          </Reveal>
        </div>
      </section>

      {/* Skills — a dark rounded panel with slate cards, on a light band. */}
      <section className="bg-surface-light pb-20 md:pb-24">
        <div className="mx-auto max-w-7xl px-6">
          <Reveal>
            <div className="rounded-3xl bg-surface-dark p-8 text-ink-inverse md:p-12">
              <div className="grid gap-12 lg:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-widest text-primary">
                    {t('home.skills.eyebrow')}
                  </div>
                  <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
                    {t('home.skills.h2')}
                  </h2>
                  <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink-inverse/80">
                    {t('home.skills.body')}
                  </p>
                  <Link
                    href="/features"
                    className="mt-6 inline-flex text-sm font-semibold text-primary underline-offset-4 hover:underline"
                  >
                    {t('home.skills.explore')} →
                  </Link>
                </div>
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  {SKILL_KEYS.map((k) => (
                    <div
                      key={k}
                      className="rounded-3xl border border-slate-700 bg-slate-800/50 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-primary/40"
                    >
                      <h3 className="text-lg font-semibold">{t(`skill.${k}.title`)}</h3>
                      <p className="mt-1 text-sm font-medium text-primary">{t(`skill.${k}.lede`)}</p>
                      <p className="mt-2 text-[14px] leading-relaxed text-ink-inverse/75">
                        {t(`skill.${k}.body`)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Privacy — a clean white statement card. */}
      <section className="bg-surface-light pb-20 md:pb-24">
        <div className="mx-auto max-w-4xl px-6">
          <Reveal>
            <div className="rounded-3xl border border-line bg-white p-8 text-center shadow-sm md:p-12">
              <h2 className="text-3xl font-bold tracking-tight text-ink-primary sm:text-4xl">
                {t('home.privacy.h2')}
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-ink-secondary">
                {t('home.privacy.body')}
              </p>
              <Link
                href="/download"
                className="mt-8 inline-flex items-center justify-center rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-white transition-all duration-300 hover:scale-105 hover:bg-primary-hover"
              >
                {t('download.h1')} {product.name}
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
