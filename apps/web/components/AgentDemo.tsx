'use client';

// A self-playing, looping animation of the BulleBrowser agent at work:
// the prompt lands, the tool steps tick through, and a results table
// builds row by row — then it resets. Not a recorded video; a live
// in-page demo (swap in a real screen capture later if desired).
// Honors prefers-reduced-motion by showing the completed state.

import { useEffect, useState } from 'react';

const STEPS = [
  'navigate  sam.gov/opportunities',
  'type  “youth workforce”',
  'click  Apply filters',
  'extract  opportunities[]',
];

const ROWS = [
  ['Workforce Pathways · Rural Youth', 'DOL', 'Jun 14', '$2.5M'],
  ['After-School STEM Capacity', 'ED', 'Jun 28', '$1.1M'],
  ['Trauma-Informed Schools', 'HHS', 'Jul 10', '$750K'],
  ['Apprenticeship Expansion', 'DOL', 'Jul 25', '$4.0M'],
];

// Total frames in one loop. Steps tick, then rows fill, then a pause.
const FRAMES = STEPS.length + ROWS.length + 3;

export function AgentDemo() {
  const [frame, setFrame] = useState(0);
  const [animate, setAnimate] = useState(true);

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setAnimate(false);
      setFrame(FRAMES); // show completed state
      return;
    }
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES), 1100);
    return () => clearInterval(id);
  }, []);

  const stepsDone = Math.min(frame, STEPS.length);
  const rowsShown = Math.max(0, Math.min(frame - STEPS.length, ROWS.length));
  const working = animate && frame < STEPS.length + ROWS.length;

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-white shadow-2xl ring-1 ring-black/5">
      {/* title bar */}
      <div className="flex items-center gap-2 bg-surface-dark px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-yellow-300/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
        <div className="ml-3 flex h-5 flex-1 items-center truncate rounded-md bg-white/10 px-2 text-[10px] text-white/70">
          sam.gov/opportunities?keywords=youth+workforce
        </div>
        <div className="rounded bg-primary px-2 py-0.5 text-[10px] font-semibold text-white">AI</div>
      </div>

      <div className="grid grid-cols-1 text-[11px] sm:grid-cols-[1fr_170px]">
        {/* page: results build in */}
        <div className="border-b border-line p-3 sm:border-b-0 sm:border-r">
          <div className="mb-2 font-semibold text-ink-primary">SAM.gov · Opportunities</div>
          <ul className="space-y-1.5">
            {ROWS.map((r, i) => (
              <li
                key={r[0]}
                className={`rounded border px-2 py-1.5 transition-all duration-500 ${
                  i < rowsShown
                    ? `${i === 0 ? 'border-accent shadow-[0_0_0_2px_rgba(245,158,11,.18)]' : 'border-line'} opacity-100`
                    : 'translate-y-1 border-line opacity-0'
                }`}
              >
                <div className="font-medium text-ink-primary">{r[0]}</div>
                <div className="text-[10px] text-ink-secondary">
                  {r[1]} · {r[3]} · Deadline {r[2]}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* AI panel: prompt + ticking steps */}
        <div className="bg-surface-muted p-3 sm:p-2">
          <div className="text-[11px] font-semibold text-ink-primary sm:text-[10px]">AI agent</div>
          <div className="mt-1 rounded bg-primary px-2 py-1 text-[11px] leading-snug text-white sm:text-[10px]">
            Find youth-workforce grants
          </div>
          <div className="mt-2 space-y-1 font-mono text-[10px] leading-relaxed text-ink-secondary sm:text-[9.5px]">
            {STEPS.map((s, i) => (
              <div
                key={s}
                className={`transition-opacity duration-300 ${
                  i < stepsDone ? 'opacity-100' : 'opacity-30'
                }`}
              >
                <span className={i < stepsDone ? 'text-emerald-600' : 'text-ink-secondary'}>
                  {i < stepsDone ? '✓' : '→'}
                </span>{' '}
                {s}
              </div>
            ))}
          </div>
          <div
            className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium sm:text-[9.5px] ${
              working ? 'bg-accent/15 text-accent' : 'bg-emerald-50 text-emerald-700'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${working ? 'animate-pulse bg-accent' : 'bg-emerald-500'}`}
            />
            {working ? 'working…' : `${ROWS.length} matches`}
          </div>
        </div>
      </div>
    </div>
  );
}
