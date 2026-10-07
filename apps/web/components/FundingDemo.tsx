'use client';

// The home page's walk-through: a self-playing picture of the app answering two
// requests. On one side the workspace screen the assistant fills in, on the
// other the assistant panel, which opens on the same four options the app
// opens on.
//
// It is an illustration and is built to be unmistakable as one. Every funder,
// listing, amount and deadline is sample data and is named as a sample, the
// window's address bar carries the illustration label instead of an address,
// nothing imitates a real website, and deadlines are relative ("in 6 weeks") so
// the example cannot age into looking like a missed real one.
//
// The moving picture is hidden from screen readers, which get a written
// description of it instead. It can be paused and replayed, it waits until it
// is on screen, and under prefers-reduced-motion it does not play at all: it
// shows its finished state until the visitor presses Play.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useEnglishLang, useT, type Translate } from '@/lib/i18n';
import { ASSISTANT_NAME, SCREENS, WORKFLOWS } from '@/lib/terms';
import { LISTINGS, REQUIREMENTS, buildFrames, type Finding, type Frame } from './demo-script';
import { Icon, type IconName } from './Icon';
import { StatusChip } from './StatusChip';

const FINDING_LOOK: Record<Finding, { icon: IconName; colours: string }> = {
  documented: { icon: 'check-circle', colours: 'border-emerald-300 bg-emerald-50 text-emerald-800' },
  partial: { icon: 'half', colours: 'border-amber-300 bg-amber-50 text-amber-800' },
  missing: { icon: 'dash', colours: 'border-slate-300 bg-slate-100 text-slate-700' },
};

export function FundingDemo() {
  const t = useT();
  const frames = useMemo(() => buildFrames(t), [t]);
  const last = frames.length - 1;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [inView, setInView] = useState(false);
  const root = useRef<HTMLElement>(null);

  const position = Math.min(index, last);
  const frame = frames[position];

  // Whether to play is decided in the browser: the exported page shows the
  // first frame, and a visitor who asked for less motion gets the last one.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setIndex(Number.MAX_SAFE_INTEGER);
    else setPlaying(true);
  }, []);

  // A new language is a new script: begin it again, or rest on its last frame.
  const script = useRef(frames);
  useEffect(() => {
    if (script.current === frames) return;
    script.current = frames;
    setIndex(playing ? 0 : Number.MAX_SAFE_INTEGER);
  }, [frames, playing]);

  useEffect(() => {
    const element = root.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setInView(entry?.isIntersecting ?? false), {
      threshold: 0.25,
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const hold = frame?.hold ?? 0;
  useEffect(() => {
    if (!playing || !inView) return;
    const timer = window.setTimeout(() => setIndex((position + 1) % (last + 1)), hold);
    return () => window.clearTimeout(timer);
  }, [playing, inView, position, last, hold]);

  if (!frame) return null;

  const togglePlay = () => {
    // Play from the finished state starts over rather than waiting it out.
    if (!playing && position === last) setIndex(0);
    setPlaying(!playing);
  };
  const replay = () => {
    setIndex(0);
    setPlaying(true);
  };

  const control =
    'inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-white px-3 py-1.5 text-xs font-semibold text-ink-primary transition-colors hover:bg-surface-muted';

  return (
    <figure ref={root} className="mt-10">
      <div role="group" aria-label={t('demo.eyebrow')} className="mb-3 flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={togglePlay} className={control}>
          <Icon name={playing ? 'pause' : 'play'} className="h-3.5 w-3.5" />
          {playing ? t('demo.pause') : t('demo.play')}
        </button>
        <button type="button" onClick={replay} className={control}>
          <Icon name="replay" className="h-3.5 w-3.5" />
          {t('demo.replay')}
        </button>
      </div>

      <div
        aria-hidden="true"
        className="overflow-hidden rounded-2xl border border-line bg-surface-light shadow-xl ring-1 ring-black/5"
      >
        {/* Window bar. Where an address would be, the label says what this is. */}
        <div className="flex items-center gap-2 bg-surface-dark px-3 py-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-400/80" />
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-yellow-300/80" />
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400/80" />
          <div className="ms-2 flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-white/10 px-2.5 py-1.5 text-xs leading-snug text-white/90">
            <Icon name="info" className="h-3.5 w-3.5" />
            <span>{t('common.illustration')}</span>
          </div>
        </div>

        <div className="flex flex-col lg:h-[540px] lg:flex-row">
          <Workspace frame={frame} t={t} />
          <Panel frame={frame} t={t} />
        </div>
      </div>

      <figcaption className="mt-3 text-sm leading-relaxed text-ink-secondary">{t('demo.caption')}</figcaption>
      <p className="sr-only">{t('demo.description')}</p>
    </figure>
  );
}

// The workspace screen the assistant fills in: listings, then requirements.
function Workspace({ frame, t }: { frame: Frame; t: Translate }) {
  const english = useEnglishLang();
  const alignment = frame.view === 'alignment';
  // A row that has not arrived yet holds its place, so nothing jumps when it does.
  const pending = 'h-[4.75rem] rounded-xl border border-dashed border-line-strong bg-white/60';
  const row = 'animate-fade-in-up rounded-xl border border-line bg-white p-3';
  const revealed = frame.view === 'start' ? 0 : frame.rows;

  return (
    <div className="min-h-[27rem] min-w-0 flex-1 overflow-hidden bg-surface-muted p-4 lg:min-h-0">
      <p lang={english} className="text-sm font-semibold tracking-tight text-ink-primary">
        {alignment ? SCREENS.rfpAnalysis : SCREENS.opportunities}
      </p>

      {alignment ? (
        <>
          <p className="mt-1 text-xs text-ink-secondary">{t('demo.align.title')}</p>
          <ul className="mt-3 space-y-2">
            {REQUIREMENTS.map(({ id, finding }, at) =>
              at < revealed ? (
                <li key={id} className={row}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Caption>{t('demo.align.funder')}</Caption>
                      <p className="mt-1 text-[13px] font-semibold leading-snug text-ink-primary">
                        {t(`demo.align.${id}.req`)}
                      </p>
                      <Source>{t(`demo.align.${id}.src`)}</Source>
                    </div>
                    <div>
                      <Caption>{t('demo.align.yours')}</Caption>
                      <p className="mt-1">
                        <Chip icon={FINDING_LOOK[finding].icon} colours={FINDING_LOOK[finding].colours}>
                          {t(`finding.${finding}`)}
                        </Chip>
                      </p>
                      <Source>{t(`demo.align.${id}.org`)}</Source>
                    </div>
                  </div>
                </li>
              ) : (
                <li key={id} className={pending} />
              ),
            )}
          </ul>
        </>
      ) : (
        <>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {(['place', 'applicant', 'category'] as const).map((filter) => (
              <li
                key={filter}
                className="rounded-full border border-line-strong bg-white px-2.5 py-0.5 text-xs text-ink-primary"
              >
                {t(`demo.filter.${filter}`)}
              </li>
            ))}
          </ul>
          <ul className="mt-3 space-y-2">
            {LISTINGS.map(({ id, status }, at) =>
              at < revealed ? (
                <li key={id} className={row}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 basis-48 text-[13px] font-semibold leading-snug text-ink-primary">
                      {t(`demo.listing.${id}.title`)}
                    </p>
                    <StatusChip status={status} />
                  </div>
                  <p className="mt-1 text-xs text-ink-secondary">
                    {t(`demo.listing.${id}.funder`)} · {t(`demo.listing.${id}.meta`)}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                    <span className="text-ink-secondary">{t(`demo.listing.${id}.reason`)}</span>
                    <span className="inline-flex items-center gap-1 font-semibold text-ink-primary underline underline-offset-2">
                      {t('demo.listing.link')}
                      <Icon name="external" className="h-3 w-3" />
                    </span>
                  </div>
                </li>
              ) : (
                <li key={id} className={pending} />
              ),
            )}
          </ul>
        </>
      )}
    </div>
  );
}

// The assistant panel: the four options, then the request, its steps and its answer.
function Panel({ frame, t }: { frame: Frame; t: Translate }) {
  const english = useEnglishLang();
  const feed = useRef<HTMLDivElement>(null);
  const { turn } = frame;
  const workflow = frame.workflow === null ? undefined : WORKFLOWS[frame.workflow];

  // Keep the newest line in view when a turn outgrows the panel.
  useEffect(() => {
    const element = feed.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [turn]);

  return (
    <div className="flex w-full flex-col border-t border-line bg-surface-light lg:w-[340px] lg:border-s lg:border-t-0">
      <div className="px-4 pb-2 pt-3">
        <p lang={english} className="text-[13px] font-semibold tracking-tight text-ink-primary">
          {ASSISTANT_NAME}
        </p>
        {turn && workflow && (
          <p lang={english} className="mt-1 flex items-center gap-1.5 text-xs text-ink-secondary">
            <Icon name="check" className="h-3.5 w-3.5" />
            {workflow.label}
          </p>
        )}
      </div>

      <div ref={feed} className="min-h-[21rem] flex-1 overflow-hidden px-4 pb-3 lg:min-h-0">
        {turn ? (
          <div className="space-y-3">
            <div className="flex justify-end">
              <p className="max-w-[88%] rounded-2xl bg-primary px-3.5 py-2 text-[13px] leading-relaxed text-ink-primary">
                {turn.prompt}
              </p>
            </div>
            {turn.shown > 0 && (
              <ul className="space-y-1.5 rounded-lg border border-line bg-surface-muted px-3 py-2 text-xs">
                {turn.steps.slice(0, turn.shown).map((step, at) => {
                  const finished = at < turn.done;
                  return (
                    <li key={step} className="flex items-center gap-2">
                      <span className="grid h-3.5 w-3.5 shrink-0 place-items-center">
                        {finished ? (
                          <Icon name="check" className="h-3.5 w-3.5 text-emerald-700" />
                        ) : (
                          <span
                            className="h-1.5 w-1.5 rounded-full bg-ink-primary"
                            style={{ animation: 'soft-pulse 1.2s ease-in-out infinite' }}
                          />
                        )}
                      </span>
                      <span className={finished ? 'text-ink-secondary' : 'text-ink-primary'}>{step}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {turn.answer && (
              <p className="animate-fade-in-up text-[13px] leading-relaxed text-ink-primary">{turn.answer}</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[15px] font-semibold tracking-tight text-ink-primary">{t('ask.h2')}</p>
            <p className="text-xs leading-relaxed text-ink-secondary">{t('demo.panel.intro')}</p>
            <ol className="grid gap-2">
              {WORKFLOWS.map((option, at) => {
                const chosen = frame.workflow === at;
                return (
                  <li
                    key={option.id}
                    lang={english}
                    className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 text-[13px] leading-snug text-ink-primary ${
                      chosen ? 'border-ink-primary bg-primary/10' : 'border-line'
                    }`}
                  >
                    <span className="font-semibold text-ink-secondary">{at + 1}</span>
                    <span className="min-w-0 flex-1">{option.label}</span>
                    {chosen && <Icon name="check" className="mt-0.5 h-3.5 w-3.5" />}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>

      <div className="border-t border-line p-3">
        <div className={`halo rounded-xl ${frame.composer ? 'is-active' : ''}`}>
          <p className="min-h-[3.5rem] rounded-xl border border-line bg-surface-light px-3 py-2 text-[13px] leading-snug">
            {frame.composer ? (
              <span className="text-ink-primary">{frame.composer}</span>
            ) : (
              <span className="text-ink-secondary">{t('demo.composer')}</span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">{children}</p>;
}

function Source({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-secondary">
      <Icon name="document" className="h-3.5 w-3.5" />
      {children}
    </p>
  );
}

function Chip({ icon, colours, children }: { icon: IconName; colours: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${colours}`}
    >
      <Icon name={icon} className="h-3.5 w-3.5" />
      {children}
    </span>
  );
}
