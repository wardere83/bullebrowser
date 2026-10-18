'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { WORKFLOWS } from '@/lib/terms';
import { Icon } from './Icon';

// An interactive illustration, never a simulated live grant search. Interface
// labels stay in English because that is how the desktop app presents them.
const questions = [
  'Where are you based, and what needs funding?',
  'Which funder should I research?',
  'Which grants, or what funding goal, should I compare?',
  'What should I look for on this page?',
];
const sources = [
  {
    tab: 'Grants.gov',
    url: 'grants.gov',
    heading: 'Start with the official source',
    body: 'Explore federal funding notices and check the original opportunity documents.',
    detail: 'Eligibility · Deadlines · Application requirements',
  },
  {
    tab: 'California Grants Portal',
    url: 'grants.ca.gov',
    heading: 'Look closer to your work',
    body: 'Explore state grant programs and read the published criteria for each opportunity.',
    detail: 'Location · Program purpose · Funding details',
  },
  {
    tab: 'Funder website',
    url: 'Official funder website',
    heading: 'Understand the funder',
    body: 'Read the funder’s own priorities and guidance before deciding what to pursue.',
    detail: 'Priorities · Guidelines · Next steps',
  },
];

export function BrowserWalkthrough() {
  const t = useT();
  const [option, setOption] = useState<number | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [source, setSource] = useState(0);
  const page = sources[source] ?? sources[0]!;
  return (
    <section className="mx-auto max-w-7xl px-6 py-20 md:py-28" aria-labelledby="walkthrough-title">
      <div className="mb-10 grid gap-5 lg:grid-cols-2 lg:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-ink-secondary">
            {t('preview.eyebrow')}
          </p>
          <h2
            id="walkthrough-title"
            className="mt-4 max-w-xl text-3xl font-semibold tracking-tight md:text-4xl"
          >
            {t('preview.h2')}
          </h2>
        </div>
        <p className="max-w-lg text-sm leading-relaxed text-ink-secondary lg:justify-self-end">
          {t('preview.body')}
        </p>
      </div>
      <div className="overflow-hidden rounded-2xl border border-line bg-surface-muted shadow-[0_32px_90px_-55px_rgba(7,20,34,0.5)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-white px-5 py-3 text-xs text-ink-secondary">
          <span className="font-semibold text-ink-primary">BulleBrowser</span>
          <span>{t('common.illustration')}</span>
        </div>
        <div lang="en" dir="ltr" className="grid md:min-h-[460px] md:grid-cols-[1.6fr_1fr]">
          <div className="min-w-0 border-b border-line md:border-b-0 md:border-r">
            <div
              aria-label="Sample source tabs"
              className="flex gap-1 overflow-x-auto border-b border-line p-2"
            >
              {sources.map((item, i) => (
                <button
                  key={item.tab}
                  type="button"
                  aria-pressed={source === i}
                  onClick={() => {
                    setSource(i);
                    setBrowsing(true);
                  }}
                  className={`shrink-0 rounded-lg px-3 py-2 text-xs transition-colors ${source === i ? 'bg-white font-semibold shadow-sm' : 'text-ink-secondary hover:bg-white/70'}`}
                >
                  {item.tab}
                </button>
              ))}
            </div>
            <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-xs text-ink-secondary">
              <Icon name="check-circle" className="h-3.5 w-3.5" />
              {page.url}
            </div>
            <div className="relative m-4 min-h-[280px] overflow-hidden rounded-xl bg-white p-7 md:min-h-[335px] md:p-9">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-secondary">
                {browsing ? 'Source review' : 'Your browser, in view'}
              </p>
              <h3 className="mt-5 max-w-sm text-2xl font-semibold tracking-tight md:text-3xl">
                {page.heading}
              </h3>
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-ink-secondary">
                {page.body}
              </p>
              <div className="mt-7 border-t border-line pt-5 text-xs font-medium leading-relaxed">
                {page.detail}
              </div>
              {browsing && (
                <div
                  aria-hidden="true"
                  className="preview-cursor absolute left-[65%] top-[65%] text-ink-primary"
                >
                  <svg width="25" height="30" viewBox="0 0 25 30">
                    <path
                      d="M2 2v24l6-7 5 10 5-3-5-9h10Z"
                      fill="currentColor"
                      stroke="white"
                      strokeWidth="2"
                    />
                  </svg>
                  <span className="mt-1 block rounded bg-surface-dark px-2 py-1 text-[10px] text-white">
                    BulleBrowser
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col bg-[#fbfcfc] p-5 md:p-6">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span>Your Assistant</span>
              <span aria-hidden="true">···</span>
            </div>
            <p className="mb-4 mt-8 text-xl font-semibold tracking-tight">
              Where should we browse?
            </p>
            <div className="grid grid-cols-2 gap-2">
              {WORKFLOWS.map((workflow, i) => (
                <button
                  key={workflow.id}
                  type="button"
                  aria-pressed={option === i}
                  onClick={() => {
                    setOption(i);
                    setBrowsing(false);
                  }}
                  className={`min-h-[66px] rounded-xl border p-3 text-left text-xs leading-relaxed transition-colors ${option === i ? 'border-primary bg-primary/10' : 'border-line bg-white hover:border-primary'}`}
                >
                  {workflow.label}
                </button>
              ))}
            </div>
            <div aria-live="polite" className="my-5 text-sm leading-relaxed">
              {option === null ? (
                <p className="text-ink-secondary">Choose an option above to see the next step.</p>
              ) : (
                <>
                  <p>{questions[option]}</p>
                  <button
                    type="button"
                    onClick={() => setBrowsing(true)}
                    className="mt-3 rounded-lg bg-surface-dark px-4 py-2 text-xs font-medium text-white"
                  >
                    Continue with a sample answer →
                  </button>
                </>
              )}
              {browsing && (
                <p className="mt-3 text-xs text-ink-secondary">
                  In the app, the assistant opens and reads relevant pages here. Explore the sample
                  tabs on the left.
                </p>
              )}
            </div>
            <div
              tabIndex={0}
              className="halo mt-auto rounded-xl border border-line bg-white px-4 py-4 text-xs text-ink-secondary"
            >
              <svg className="preview-border-track" aria-hidden="true">
                <rect x="0" y="0" width="100%" height="100%" rx="12" pathLength="100" />
              </svg>
              Ask BulleBrowser to browse…
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
