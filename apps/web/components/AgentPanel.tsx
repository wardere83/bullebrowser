'use client';

// The home-page "live demo": a faithful, self-playing replica of the actual
// BulleBrowser desktop window — the same thing a user sees while using it. On
// the left, the browser pane the agent drives (a visible cursor that moves,
// types the address, and clicks). On the right, the real AI panel, pixel-for-
// pixel with the app's `AiPanel`: the "BulleBrowser Agent" header with History
// / New chat, the Skills + model selectors, the "What can I help you browse?"
// empty state, the streaming conversation with its collapsible activity feed,
// and the composer whose control row carries the "+" attachment menu, the
// brand-mark home bubble, the one-shot mic, and continuous Voice Mode.
//
// Genuinely interactive on the static site (no backend): the "+" menu, the mic
// and Voice Mode overlays, the halo ring on the composer, the jump-to-latest
// pointer, and the home bubble (a real link home). The script also showcases
// each of those states on a loop so the page shows the whole app at a glance.
//
// Mirrors these app sources so it stays honest to the product:
//   apps/desktop/src/renderer/components/AiPanel.tsx
//   apps/desktop/src/renderer/components/AttachMenu.tsx
//   apps/desktop/src/renderer/components/VoiceOverlay.tsx
//
// Honors prefers-reduced-motion by holding a finished, readable state.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

type Page = 'blank' | 'fundResults' | 'grant' | 'eligibility';
type Voice = 'idle' | 'once' | 'continuous';

interface Cursor {
  x: number;
  y: number;
}

// The conversation. Activity groups one run's steps into a single collapsible
// feed, exactly like the app; the answer renders as plain prose beneath it.
type Feed =
  | { kind: 'user'; text: string }
  | { kind: 'activity'; steps: string[]; done: boolean }
  | { kind: 'answer'; html: 'funding' | 'eligibility' };

interface State {
  address: string;
  page: Page;
  cursor: Cursor;
  click: boolean;
  composer: string;
  typing: boolean;
  feed: Feed[];
}

// The real app's registered skills (labels + short descriptions) and its model
// names, so the selectors and empty state read exactly as the product does.
const SKILLS = [
  { id: 'page_assistant', label: 'Page assistant', short: 'Read a page, summarize it, and answer with on-page context.' },
  { id: 'site_navigator', label: 'Site navigator', short: 'Open a URL, find the right control, and complete a browser task.' },
  { id: 'workflow_automator', label: 'Workflow automator', short: 'Coordinate multiple browser steps into a repeatable workflow.' },
  { id: 'compliance_review', label: 'Compliance review', short: 'Check a page against your compliance checklist and report what passes or fails.' },
] as const;

const MODELS = ['BulleBrowser Pro', 'BulleBrowser Balanced', 'BulleBrowser Fastest'] as const;

const START: State = {
  address: '',
  page: 'blank',
  cursor: { x: 50, y: 42 },
  click: false,
  composer: '',
  typing: false,
  feed: [],
};

export function AgentPanel() {
  const [s, setS] = useState<State>(START);
  const [voice, setVoice] = useState<Voice>('idle');
  const [menuOpen, setMenuOpen] = useState(false);
  const timers = useRef<number[]>([]);

  const feedRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);

  const onFeedScroll = () => {
    const el = feedRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
  };
  const jumpToLatest = () => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' });
  };
  useEffect(() => {
    const el = feedRef.current;
    if (el && atBottom) el.scrollTop = el.scrollHeight;
  }, [s.feed, atBottom]);

  // ---- The self-playing script ---------------------------------------------
  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setS({
        address: 'grants.gov/search',
        page: 'grant',
        cursor: { x: 50, y: 42 },
        click: false,
        composer: '',
        typing: false,
        feed: [
          { kind: 'user', text: 'Find grants for our community empowerment project in New Jersey and Los Angeles' },
          { kind: 'activity', steps: ['Opening google.com', 'Reading the results', 'Reading grants.gov'], done: true },
          { kind: 'answer', html: 'funding' },
        ],
      });
      return;
    }

    let cancelled = false;
    const clearAll = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
    const at = (t: number, fn: () => void) => {
      timers.current.push(window.setTimeout(() => !cancelled && fn(), t));
    };

    const pushUser = (text: string) =>
      setS((p) => ({ ...p, feed: [...p.feed, { kind: 'user', text }] }));
    const startActivity = (step: string) =>
      setS((p) => ({ ...p, feed: [...p.feed, { kind: 'activity', steps: [step], done: false }] }));
    const addStep = (step: string) =>
      setS((p) => {
        const feed = [...p.feed];
        for (let i = feed.length - 1; i >= 0; i--) {
          const f = feed[i];
          if (f && f.kind === 'activity') {
            feed[i] = { ...f, steps: [...f.steps, step] };
            break;
          }
        }
        return { ...p, feed };
      });
    const finishActivity = () =>
      setS((p) => {
        const feed = p.feed.map((f) => (f.kind === 'activity' ? { ...f, done: true } : f));
        return { ...p, feed };
      });
    const pushAnswer = (html: 'funding' | 'eligibility') =>
      setS((p) => ({ ...p, feed: [...p.feed, { kind: 'answer', html }] }));

    const typeComposer = (text: string, startAt: number, totalMs: number) => {
      const per = Math.max(18, totalMs / Math.max(1, text.length));
      for (let i = 1; i <= text.length; i++) {
        at(startAt + i * per, () => setS((p) => ({ ...p, composer: text.slice(0, i) })));
      }
      return startAt + text.length * per;
    };
    const typeAddress = (text: string, startAt: number, totalMs: number) => {
      const per = Math.max(16, totalMs / Math.max(1, text.length));
      for (let i = 1; i <= text.length; i++) {
        at(startAt + i * per, () => setS((p) => ({ ...p, address: text.slice(0, i) })));
      }
    };

    const run = () => {
      clearAll();
      setS(START);
      setVoice('idle');
      setMenuOpen(false);
      setAtBottom(true);
      let t = 500;

      // ---- Turn 1: find funding ---------------------------------------------
      at(t, () => setS((p) => ({ ...p, typing: true })));
      t = typeComposer('Find grants for our community empowerment project in New Jersey and Los Angeles', t, 1800) + 250;
      at(t, () => {
        pushUser('Find grants for our community empowerment project in New Jersey and Los Angeles');
        setS((p) => ({ ...p, composer: '', typing: false, cursor: { x: 44, y: 8 } }));
      });
      t += 450;

      at(t, () => startActivity('Opening google.com'));
      typeAddress('google.com/search?q=community empowerment grants NJ and LA', t, 950);
      t += 1250;
      at(t, () => {
        setS((p) => ({ ...p, page: 'fundResults' }));
        addStep('Reading the results');
      });
      t += 800;
      at(t, () => setS((p) => ({ ...p, cursor: { x: 34, y: 40 } })));
      t += 550;
      at(t, () => setS((p) => ({ ...p, click: true })));
      at(t + 220, () => setS((p) => ({ ...p, click: false })));
      t += 520;
      at(t, () => {
        setS((p) => ({ ...p, page: 'grant', address: 'grants.gov/search' }));
        addStep('Reading grants.gov');
      });
      t += 950;
      at(t, () => setS((p) => ({ ...p, cursor: { x: 58, y: 52 } })));
      t += 650;
      at(t, () => addStep('Writing the answer'));
      t += 700;
      at(t, () => {
        finishActivity();
        pushAnswer('funding');
      });
      t += 2600;

      // ---- Turn 2: eligibility check ----------------------------------------
      at(t, () => setS((p) => ({ ...p, typing: true })));
      t = typeComposer("Check if we meet this grant's eligibility requirements", t, 1500) + 200;
      at(t, () => {
        pushUser("Check if we meet this grant's eligibility requirements");
        setS((p) => ({ ...p, composer: '', typing: false, cursor: { x: 40, y: 10 } }));
      });
      t += 450;
      at(t, () => {
        setS((p) => ({ ...p, page: 'eligibility', address: 'grants.gov/eligibility' }));
        startActivity('Opening the eligibility rules');
      });
      t += 1000;
      at(t, () => addStep('Reading the requirements'));
      t += 850;
      at(t, () => addStep('Checking each requirement'));
      t += 850;
      at(t, () => addStep('Writing the summary'));
      t += 700;
      at(t, () => {
        finishActivity();
        pushAnswer('eligibility');
      });
      t += 2900;

      // ---- Showcase the composer surfaces, one after another -----------------
      at(t, () => setMenuOpen(true)); // "+" attachment menu
      t += 2200;
      at(t, () => setMenuOpen(false));
      t += 400;
      at(t, () => setVoice('once')); // mic: "Listening… speak, then Send"
      t += 2600;
      at(t, () => setVoice('continuous')); // Voice Mode: "speak your commands"
      t += 2900;
      at(t, () => setVoice('idle'));
      t += 500;

      at(t, run); // loop
    };

    run();
    return () => {
      cancelled = true;
      clearAll();
    };
  }, []);

  const composing = s.typing;

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface-light shadow-xl ring-1 ring-black/5">
      {/* Window toolbar: traffic lights + address bar, like the app's top bar. */}
      <div className="flex items-center gap-2 bg-surface-dark px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-yellow-300/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
        <div className="ml-2 flex h-6 flex-1 items-center gap-1.5 truncate rounded-md bg-white/10 px-2.5 text-[11px] text-white/85">
          <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0 text-white/60" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M7 11V8a5 5 0 0 1 10 0v3" strokeLinecap="round" />
            <rect x="5" y="11" width="14" height="9" rx="2" />
          </svg>
          <span className="truncate">{s.address || 'Search or enter address'}</span>
          {s.address && s.page === 'blank' && <span className="animate-pulse">|</span>}
        </div>
      </div>

      {/* Body: browser pane (left) + AI panel (right), as the docked app shows. */}
      <div className="flex flex-col sm:h-[476px] sm:flex-row">
        {/* Browser pane the agent drives. */}
        <div className="relative h-[150px] overflow-hidden border-b border-line bg-surface-light p-3 text-[11px] sm:h-auto sm:flex-1 sm:border-b-0 sm:border-r">
          <PageContent page={s.page} />
          <div
            className="pointer-events-none absolute z-10 transition-all duration-500 ease-out"
            style={{ left: `${s.cursor.x}%`, top: `${s.cursor.y}%` }}
          >
            {s.click && (
              <span className="absolute -left-2 -top-2 h-5 w-5 animate-ping rounded-full bg-primary/40" />
            )}
            <svg viewBox="0 0 24 24" className="h-4 w-4 drop-shadow" fill="none">
              <path d="M5 3l14 8.5-6.2 1.4L9.8 19 5 3z" fill="#fff" stroke="#111" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        {/* The AI panel — mirrors apps/desktop AiPanel.tsx. */}
        <aside className="relative flex h-[440px] w-full flex-col bg-surface-light sm:h-auto sm:w-[300px]">
          {voice !== 'idle' && <VoiceOverlay mode={voice} onClose={() => setVoice('idle')} />}

          <header className="flex items-center justify-between gap-2 px-3 py-2.5">
            <div className="text-[13px] font-semibold tracking-tight text-ink-primary">
              BulleBrowser Agent
            </div>
            <div className="flex items-center gap-1 text-xs text-ink-secondary">
              <span className="rounded-md px-2 py-1">History</span>
              <span className="rounded-md px-2 py-1">New chat</span>
            </div>
          </header>

          {/* Skills + model selectors (real <select>s, as in the app). */}
          <div className="flex items-center gap-3 px-3 pb-2 text-xs">
            <select
              defaultValue=""
              aria-label="Skill"
              className="min-w-0 flex-1 rounded-md bg-transparent py-1 text-ink-secondary transition-colors hover:text-ink-primary focus:outline-none"
            >
              <option value="">Skills: free chat</option>
              {SKILLS.map((sk) => (
                <option key={sk.id} value={sk.id}>{sk.label}</option>
              ))}
            </select>
            <select
              defaultValue={MODELS[0]}
              aria-label="Model"
              className="rounded-md bg-transparent py-1 text-ink-secondary transition-colors hover:text-ink-primary focus:outline-none"
            >
              {MODELS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* Conversation. */}
          <div className="relative flex flex-1 flex-col overflow-hidden">
            <div ref={feedRef} onScroll={onFeedScroll} className="flex-1 overflow-y-auto px-4 py-4">
              {s.feed.length === 0 ? (
                <EmptyState />
              ) : (
                s.feed.map((f, i) => <FeedRow key={i} item={f} />)
              )}
            </div>
            {!atBottom && (
              <button
                type="button"
                onClick={jumpToLatest}
                aria-label="Jump to latest message"
                className="absolute bottom-2 right-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-line bg-white text-ink-primary shadow-md transition-transform hover:scale-105"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M6 13l6 6 6-6" />
                </svg>
              </button>
            )}
          </div>

          {/* Composer. */}
          <div className="border-t border-line/60 p-2.5">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <div className={`halo rounded-xl ${composing ? 'is-active' : ''}`}>
                  <textarea
                    readOnly
                    rows={3}
                    aria-label="Ask BulleBrowser"
                    value={s.composer}
                    placeholder="Ask BulleBrowser to do something. It will browse, read, compare, and report back."
                    className="w-full resize-none rounded-xl border border-line bg-surface-light px-3 py-2 text-[13px] leading-snug text-ink-primary outline-none placeholder:text-ink-secondary"
                  />
                </div>
              </div>
              <span
                className={`inline-flex h-9 items-center rounded px-3 text-sm font-medium text-white ${
                  s.composer ? 'bg-primary' : 'bg-line'
                }`}
              >
                Send
              </span>
            </div>

            {/* Control row: "+" menu, brand-mark home, mic, Voice Mode. */}
            <div className="mt-2 flex items-center gap-1">
              <AttachMenu open={menuOpen} onToggle={() => setMenuOpen((v) => !v)} />

              <Link
                href="/"
                aria-label="Open bullebrowser.com"
                title="bullebrowser.com"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-muted"
              >
                <svg viewBox="0 0 64 64" className="h-5 w-5" aria-hidden>
                  <rect x="4" y="4" width="56" height="56" rx="16" fill="#20BAD1" />
                  <circle cx="26" cy="30" r="12" fill="none" stroke="#fff" strokeWidth="5" />
                  <circle cx="42" cy="40" r="6" fill="#fff" />
                </svg>
              </Link>

              <button
                type="button"
                onClick={() => setVoice('once')}
                aria-label="Voice input"
                title="Speak a prompt"
                className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                  voice === 'once' ? 'bg-primary/10 text-primary' : 'text-ink-secondary hover:bg-surface-muted hover:text-ink-primary'
                }`}
              >
                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                </svg>
              </button>

              <button
                type="button"
                onClick={() => setVoice((v) => (v === 'continuous' ? 'idle' : 'continuous'))}
                aria-label="Voice Mode"
                aria-pressed={voice === 'continuous'}
                title="Continuous Voice Mode"
                className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                  voice === 'continuous' ? 'bg-primary/10 text-primary' : 'text-ink-secondary hover:bg-surface-muted hover:text-ink-primary'
                }`}
              >
                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round">
                  <path d="M4 11v2M8 8v8M12 5v14M16 8v8M20 11v2" />
                </svg>
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ---- Conversation rows ------------------------------------------------------

function FeedRow({ item }: { item: Feed }) {
  if (item.kind === 'user') {
    return (
      <div className="mb-5 flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-primary px-3.5 py-2 text-[13px] leading-relaxed text-white">
          {item.text}
        </div>
      </div>
    );
  }
  if (item.kind === 'activity') return <ActivityFeed steps={item.steps} done={item.done} />;
  // answer — plain prose, no card, like the app's assistant messages.
  return (
    <div className="mb-5 text-[13px] leading-relaxed text-ink-primary">
      {item.html === 'funding' ? (
        <>
          Found <strong>3 open grants</strong> for your community empowerment project. Best
          match: <strong>Neighborhood Empowerment Grant</strong> — up to{' '}
          <strong>$150,000</strong> for programs in New Jersey and Los Angeles, deadline{' '}
          <strong>Nov&nbsp;14</strong>.
          <span className="mt-1 block text-[11px] text-ink-secondary">Source: grants.gov</span>
        </>
      ) : (
        <>
          Checked the grant&apos;s eligibility rules — you meet <strong>3 of 4</strong>:
          <span className="mt-1.5 block space-y-1">
            <CheckLine ok>Registered nonprofit organization</CheckLine>
            <CheckLine ok>Serves residents of New Jersey or Los Angeles</CheckLine>
            <CheckLine ok>Project budget within $150,000</CheckLine>
            <CheckLine>Letter of support from a local partner — request one</CheckLine>
          </span>
        </>
      )}
    </div>
  );
}

// A pass/fail line for the eligibility check, echoing the app's check marks.
function CheckLine({ ok, children }: { ok?: boolean; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      {ok ? (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-emerald-500" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12.5 9 17.5 20 6.5" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-red-500" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      )}
      <span className="text-ink-primary">{children}</span>
    </span>
  );
}

// One quiet, openable line of what the agent is doing — mirrors the app's
// ActivityFeed: a pulsing dot while running, a check when done, a step count.
function ActivityFeed({ steps, done }: { steps: string[]; done: boolean }) {
  const [open, setOpen] = useState(false);
  const summary = steps[steps.length - 1] ?? 'Working…';
  return (
    <div className="mb-5 overflow-hidden rounded-lg border border-line/50 bg-surface-muted/30 text-[12px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        {done ? (
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-emerald-500" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12.5 9 17.5 20 6.5" />
          </svg>
        ) : (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" style={{ animation: 'soft-pulse 1.2s ease-in-out infinite' }} />
        )}
        <span className="flex-1 truncate text-ink-primary">{summary}</span>
        <span className="shrink-0 text-[11px] text-ink-secondary">
          {steps.length} {steps.length === 1 ? 'step' : 'steps'}
        </span>
        <span className={`shrink-0 text-ink-secondary transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open && (
        <ol className="max-h-40 space-y-1.5 overflow-y-auto border-t border-line/40 px-3 py-2 text-ink-secondary">
          {steps.map((st, i) => (
            <li key={i} className="truncate">{st}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="space-y-5 pt-1 text-sm">
      <p className="text-[15px] font-semibold tracking-tight text-ink-primary">
        What can I help you browse?
      </p>
      <p className="text-[13px] leading-relaxed text-ink-secondary">
        Describe a task and I&apos;ll use your live tabs to browse, read, compare, and report back.
      </p>
      <div className="space-y-3">
        {SKILLS.map((sk) => (
          <div key={sk.id}>
            <div className="text-[13px] font-medium text-ink-primary">{sk.label}</div>
            <div className="text-[12px] leading-relaxed text-ink-secondary">{sk.short}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- "+" attachment menu — mirrors apps/desktop AttachMenu.tsx --------------

const ATTACH: { key: string; label: string; note: string; icon: React.ReactNode }[] = [
  { key: 'upload', label: 'Upload your file', note: 'Session files are retained for 8 days', icon: <path d="M12 16V4m0 0L7 9m5-5 5 5M5 20h14" /> },
  {
    key: 'screenshot',
    label: 'Screenshot',
    note: 'Capture the current page',
    icon: (
      <>
        <rect x="3" y="6" width="18" height="13" rx="2" />
        <circle cx="12" cy="12.5" r="3.2" />
        <path d="M8.5 6 10 3.5h4L15.5 6" />
      </>
    ),
  },
  { key: 'projects', label: 'Projects', note: 'Attach a project folder', icon: <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h9A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z" /> },
  {
    key: 'control',
    label: 'Control Browser',
    note: 'Let the agent drive your tabs',
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3.2 9h17.6M3.2 15h17.6M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </>
    ),
  },
];

function AttachMenu({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-label="Add attachment"
        aria-expanded={open}
        title="Attach files, a screenshot, or a project"
        className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
          open ? 'border-primary bg-primary/10 text-primary' : 'border-line text-ink-secondary hover:text-ink-primary'
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      {open && (
        <div className="absolute bottom-10 left-0 z-40 w-64 overflow-hidden rounded-xl border border-line bg-white p-1 text-ink-primary shadow-xl">
          {ATTACH.map((a) => (
            <div key={a.key} className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-surface-muted">
              <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-primary" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                {a.icon}
              </svg>
              <span className="min-w-0">
                <span className="block text-[12px] font-medium">{a.label}</span>
                <span className="block text-[11px] text-ink-secondary">{a.note}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Voice overlay — mirrors apps/desktop VoiceOverlay.tsx -------------------

function VoiceOverlay({ mode, onClose }: { mode: 'once' | 'continuous'; onClose: () => void }) {
  const bars = [0, 0.18, 0.36, 0.12, 0.28, 0.06, 0.22];
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-surface-light/95 backdrop-blur-sm">
      <div className="flex w-[80%] max-w-xs flex-col items-center gap-6 rounded-2xl border border-line/40 bg-white p-6 shadow-xl">
        <span className={`inline-flex items-center gap-[3px] ${mode === 'continuous' ? 'text-primary' : 'text-ink-primary'}`} aria-hidden>
          {bars.map((d, i) => (
            <span
              key={i}
              className="eq-bar block w-[3px] rounded-full bg-current"
              style={{ height: 26, transformOrigin: 'center', animation: `eq-bar 0.9s ease-in-out ${d}s infinite` }}
            />
          ))}
        </span>

        <div className="min-h-[2.5rem] px-2 text-center text-[13px] text-ink-secondary">
          {mode === 'continuous' && (
            <span className="mb-1 flex items-center justify-center gap-1.5 text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" style={{ animation: 'soft-pulse 1.4s ease-in-out infinite' }} />
              Voice Mode
            </span>
          )}
          {mode === 'continuous' ? 'Listening… speak your commands' : 'Listening… speak, then Send'}
        </div>

        <div className="flex items-center gap-2">
          {mode === 'once' && (
            <button type="button" onClick={onClose} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-hover">
              Send
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded-md border border-line px-4 py-1.5 text-sm text-ink-secondary hover:bg-surface-muted">
            {mode === 'continuous' ? 'Stop Voice Mode' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Browser page mock ------------------------------------------------------

function PageContent({ page }: { page: Page }) {
  if (page === 'blank') {
    return (
      <div className="flex h-full items-center justify-center text-ink-secondary/60">
        <div className="text-center">
          <div className="mx-auto mb-1 h-6 w-6 rounded-full border-2 border-primary/40" />
          <div className="text-[10px]">New tab</div>
        </div>
      </div>
    );
  }
  if (page === 'fundResults') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[10px] text-ink-secondary">
          <svg viewBox="0 0 24 24" className="h-3 w-3 text-ink-secondary" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          community empowerment grants NJ and LA
        </div>
        {[
          ['Grants.gov — Find grant opportunities', 'grants.gov · federal funding across agencies'],
          ['SAM.gov — Assistance Listings', 'sam.gov · programs and eligibility'],
          ['Community foundation grants', 'Local funders in New Jersey and Los Angeles'],
        ].map(([title, sub], i) => (
          <div key={title} className={`rounded px-1 py-0.5 ${i === 0 ? 'bg-primary/5' : ''}`}>
            <div className="text-[10px] font-medium text-primary">{title}</div>
            <div className="text-[9px] text-ink-secondary">{sub}</div>
          </div>
        ))}
      </div>
    );
  }
  if (page === 'grant') {
    // A Grants.gov opportunity synopsis, in the site's own layout.
    return (
      <div className="space-y-1.5">
        <div className="-mx-3 -mt-3 mb-1 bg-[#162e51] px-3 py-1 text-[9px] font-bold tracking-wide text-white">
          GRANTS.GOV <span className="ml-2 font-normal opacity-80">View Grant Opportunity</span>
        </div>
        <div className="text-[11.5px] font-bold text-ink-primary">
          OCP-27-0187 &ndash; Neighborhood Empowerment Grant
        </div>
        {[
          ['Funding Instrument Type', 'Grant'],
          ['Category', 'Community Development'],
          ['Award Ceiling', 'up to $150,000'],
          ['Closing Date', 'Nov 14, 2026'],
        ].map(([k, v], i) => (
          <div key={k} className={`flex gap-2 border-b border-line/60 pb-0.5 text-[9px] ${i >= 2 ? 'font-semibold' : ''}`}>
            <span className="w-28 shrink-0 font-semibold text-ink-primary">{k}:</span>
            <span className={i >= 2 ? 'rounded bg-primary/10 px-1 text-ink-primary' : 'text-ink-secondary'}>{v}</span>
          </div>
        ))}
      </div>
    );
  }
  // the grant's eligibility rules, being checked
  return (
    <div className="space-y-1.5">
      <div className="text-[12px] font-bold text-ink-primary">Eligibility requirements</div>
      <div className="rounded border border-line bg-surface-muted/40 px-2 py-1 text-[9.5px]">
        <div className="font-semibold text-ink-primary">Neighborhood Empowerment Grant</div>
        <div className="text-ink-secondary">New Jersey · Los Angeles</div>
      </div>
      <div className="h-2 w-11/12 rounded bg-surface-muted" />
      <div className="text-[9px] text-ink-secondary">Applicants must be registered nonprofits</div>
      <div className="h-2 w-2/3 rounded bg-surface-muted" />
    </div>
  );
}
