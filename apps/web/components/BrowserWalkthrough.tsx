'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { WORKFLOWS } from '@/lib/terms';
import { Icon, type IconName } from './Icon';
import { BrandMark } from './BrandMark';
import { PAGES, SITES, SitePage, type PageId, type PageState, type SiteId } from './walkthrough/SitePages';

// An interactive illustration of a BulleBrowser task, scripted step by step
// from what the desktop app shows: the option's question, session access, a
// task plan, live activity, the agent's pointer, click ring and outline on the
// page, and a sourced answer. It never searches anything live; every page and
// listing is sample data. Interface labels stay in English, as in the app.
const questions = [
  'Where are you based, and what needs funding?',
  'Which funder should I research?',
  'Which grants, or what funding goal, should I compare?',
  'What should I look for on this page?',
];
const OPTION_ICONS: IconName[] = ['search', 'compass', 'scale', 'external'];

interface Scene extends PageState {
  tabs: SiteId[];
  loading: boolean;
  cursor: string | null;
  halo: string | null;
  scrollTo: string | null;
  glow: boolean;
  toast: string | null;
  click: number;
}

interface Answer {
  lead: string;
  items: { status: 'match' | 'no' | 'info'; title: string; detail: string; source: string }[];
  compare?: { name: string; amount: string; deadline: string; source: string }[];
  next?: string;
}

type Step =
  | { do: 'ask' | 'note'; text: string }
  | { do: 'reply'; text: string }
  | { do: 'access' }
  | { do: 'plan'; goals: string[] }
  | { do: 'goal' }
  | { do: 'act'; label: string; tool: string }
  | { do: 'scene'; set: Partial<Scene> | ((scene: Scene) => Partial<Scene>); wait?: number; click?: boolean }
  | { do: 'type'; text: string }
  | { do: 'answer'; answer: Answer };

const BLANK: Scene = {
  page: 'start', typed: '', results: false, filtered: false, verified: [], ruledOut: [],
  tabs: [], loading: false, cursor: null, halo: null, scrollTo: null, glow: false, toast: null, click: 0,
};

// ── Step helpers, so each task reads as the sequence the agent performs.
const go = (page: PageId, extra: Partial<Scene> = {}): Step[] => [
  { do: 'scene', set: (s) => {
    const site = PAGES[page].site;
    return { page, loading: true, typed: '', results: false, filtered: false, cursor: null, halo: null, scrollTo: null,
      tabs: !site || s.tabs.includes(site) ? s.tabs : [...s.tabs, site], ...extra };
  }, wait: 800 },
  { do: 'scene', set: { loading: false }, wait: 450 },
];
const point = (target: string, wait = 850): Step => ({ do: 'scene', set: { cursor: target, halo: target }, wait });
const press = (target: string, after: Partial<Scene> = {}): Step[] => [
  point(target, 800),
  { do: 'scene', set: after, click: true, wait: 600 },
];
const read = (target: string): Step[] => [
  { do: 'scene', set: { scrollTo: target, glow: true, cursor: target, halo: target }, wait: 1000 },
  { do: 'scene', set: { glow: false }, wait: 250 },
];
const check = (target: string, verdict: 'verified' | 'ruledOut' = 'verified'): Step[] => [
  { do: 'scene', set: { scrollTo: target, cursor: target, halo: target }, wait: 750 },
  { do: 'scene', set: (s) => ({ [verdict]: [...s[verdict], target] }), wait: 450 },
];
const act = (label: string, tool: string): Step => ({ do: 'act', label, tool });

const GRANTS_SEARCH: Step[] = [
  act('Opening grants.gov', 'navigate'), ...go('grants-search'),
  act('Entering text', 'type'), point('gg-search', 700), { do: 'type', text: 'community empowerment youth' },
  act('Clicking Search', 'click'), ...press('gg-submit', { results: true }),
  act('Reading the page', 'read_page'), ...read('gg-row-1'),
  act('Clicking Community Empowerment Pathways Program', 'click'), ...press('gg-row-1'), ...go('grants-detail'),
  act('Extracting page information', 'extract'), ...check('gg-elig'), ...check('gg-award'), ...check('gg-close'),
];
const INTL_SEARCH: Step[] = [
  act('Opening a new tab', 'new_tab'), ...go('intl-search'),
  act('Choosing an option', 'select_option'), ...press('intl-open', { filtered: true }),
  act('Entering text', 'type'), point('intl-search', 700), { do: 'type', text: 'community youth' },
  act('Clicking Search', 'click'), ...press('intl-submit', { results: true, filtered: true }),
  act('Reading the page', 'read_page'), ...check('intl-who-1', 'ruledOut'), ...check('intl-who-2'),
  act('Clicking Global Community Resilience Fund', 'click'), ...press('intl-card-2'), ...go('intl-call'),
  act('Extracting page information', 'extract'), ...check('intl-elig'), ...check('intl-budget'), ...check('intl-deadline'),
];
const FUNDER_TOUR: Step[] = [
  act('Opening harborline-foundation.example', 'navigate'), ...go('funder-home'),
  act('Clicking Priorities', 'click'), ...press('fd-nav-priorities'), ...go('funder-priorities'),
  act('Reading the page', 'read_page'), ...check('fd-p1'), ...check('fd-p2'), ...read('fd-p3'),
  act('Clicking Grants', 'click'), ...press('fd-nav-grants'), ...go('funder-grants'),
  act('Extracting page information', 'extract'), ...check('fd-elig'), ...check('fd-range'), ...check('fd-region'), ...check('fd-loi'),
];

interface Script { title: string; start: Partial<Scene>; steps: Step[] }

const OPTION_SCRIPTS: Script[] = [
  {
    title: WORKFLOWS[0].label,
    start: {},
    steps: [
      { do: 'ask', text: questions[0]! },
      { do: 'reply', text: 'We’re a 501(c)(3) CBO in Newark, NJ and Los Angeles. We need funding for a community empowerment program for young adults.' },
      { do: 'access' },
      { do: 'plan', goals: ['Search official federal listings', 'Check international calls', 'Verify eligibility, amounts and deadlines', 'Report matches with sources'] },
      ...GRANTS_SEARCH,
      { do: 'goal' },
      ...INTL_SEARCH,
      { do: 'goal' }, { do: 'goal' },
      { do: 'answer', answer: {
        lead: 'Two programs fit your organization. I ruled one out:',
        items: [
          { status: 'match', title: 'Community Empowerment Pathways Program', detail: 'Up to $250,000 · Closes Mar 15, 2027 · Nonprofits, including CBOs', source: 'grants.gov' },
          { status: 'match', title: 'Global Community Resilience Fund', detail: '€150,000–€400,000 · Deadline 30 April 2027 · Open to US nonprofits', source: 'ec.europa.eu' },
          { status: 'no', title: 'Youth Inclusion and Civic Participation Partnerships', detail: 'The lead applicant must be established in an EU Member State', source: 'ec.europa.eu' },
        ],
        next: 'Every detail was read on the official page. Nothing was submitted.',
      } },
    ],
  },
  {
    title: WORKFLOWS[1].label,
    start: {},
    steps: [
      { do: 'ask', text: questions[1]! },
      { do: 'reply', text: 'Harborline Community Foundation. We’re a 501(c)(3) CBO in Newark, NJ and Los Angeles running a youth leadership and job-readiness program.' },
      { do: 'access' },
      { do: 'plan', goals: ['Open the funder’s official website', 'Read its priorities', 'Check grant guidelines and deadlines', 'Summarize fit and next steps'] },
      act('Opening harborline-foundation.example', 'navigate'), ...go('funder-home'), { do: 'goal' },
      act('Clicking Priorities', 'click'), ...press('fd-nav-priorities'), ...go('funder-priorities'),
      act('Reading the page', 'read_page'), ...check('fd-p1'), ...check('fd-p2'), ...read('fd-p3'), { do: 'goal' },
      act('Clicking Grants', 'click'), ...press('fd-nav-grants'), ...go('funder-grants'),
      act('Extracting page information', 'extract'), ...check('fd-elig'), ...check('fd-range'), ...check('fd-region'), ...check('fd-loi'),
      point('fd-apply', 900), { do: 'goal' },
      { do: 'answer', answer: {
        lead: 'Harborline Community Foundation is a strong fit:',
        items: [
          { status: 'match', title: 'Priorities match', detail: 'Economic mobility and youth leadership', source: 'harborline-foundation.example' },
          { status: 'match', title: 'You can apply', detail: 'Nonprofits and fiscally sponsored community groups in New Jersey and Southern California', source: 'harborline-foundation.example' },
          { status: 'info', title: 'Grant range and timing', detail: '$25,000–$100,000 · Letter of inquiry due February 1, 2027', source: 'harborline-foundation.example' },
        ],
        next: 'Next step: start a letter of inquiry. I stopped at the button; nothing is submitted without your approval.',
      } },
    ],
  },
  {
    title: WORKFLOWS[2].label,
    start: {},
    steps: [
      { do: 'ask', text: questions[2]! },
      { do: 'reply', text: 'We’re a 501(c)(3) CBO in Newark, NJ and Los Angeles. Compare federal, international and foundation funding for our youth program.' },
      { do: 'access' },
      { do: 'plan', goals: ['Read the Grants.gov listing', 'Read the international call', 'Read the funder’s guidelines', 'Compare award, deadline and eligibility'] },
      act('Opening grants.gov', 'navigate'), ...go('grants-detail'),
      act('Extracting page information', 'extract'), ...check('gg-award'), ...check('gg-close'), ...check('gg-elig'), { do: 'goal' },
      act('Opening a new tab', 'new_tab'), ...go('intl-call'),
      act('Extracting page information', 'extract'), ...check('intl-budget'), ...check('intl-deadline'), ...check('intl-elig'), { do: 'goal' },
      act('Opening a new tab', 'new_tab'), ...go('funder-grants'),
      act('Extracting page information', 'extract'), ...check('fd-elig'), ...check('fd-range'), ...check('fd-loi'), ...check('fd-region'), { do: 'goal' },
      { do: 'answer', answer: {
        lead: 'All three accept organizations like yours. Side by side:',
        items: [],
        compare: [
          { name: 'Community Empowerment Pathways', amount: 'Up to $250,000', deadline: 'Mar 15, 2027', source: 'grants.gov' },
          { name: 'Global Community Resilience Fund', amount: '€150k–€400k', deadline: 'Apr 30, 2027', source: 'ec.europa.eu' },
          { name: 'Harborline Community Foundation', amount: '$25k–$100k', deadline: 'Feb 1, 2027 (inquiry)', source: 'harborline-foundation.example' },
        ],
        next: 'The earliest deadline is the Harborline letter of inquiry. Every figure was read on the official page.',
      } },
    ],
  },
  {
    title: WORKFLOWS[3].label,
    start: { tabs: ['grants'], page: 'grants-detail' },
    steps: [
      { do: 'ask', text: questions[3]! },
      { do: 'reply', text: 'We’re a 501(c)(3) CBO. Do we qualify, and what does the application need?' },
      { do: 'access' },
      { do: 'plan', goals: ['Read the page you have open', 'Check the eligibility rules', 'Follow the relevant links', 'Summarize what you need'] },
      act('Reading the page', 'read_page'), ...read('gg-award'), { do: 'goal' },
      act('Extracting page information', 'extract'), ...check('gg-elig'), ...check('gg-close'), { do: 'goal' },
      act('Clicking Related documents', 'click'), ...press('gg-docs-tab'), ...go('grants-docs'),
      act('Reading the page', 'read_page'), ...check('gg-file-1'), ...check('gg-file-2'), ...check('gg-file-3'), ...check('gg-file-4'),
      { do: 'goal' },
      { do: 'answer', answer: {
        lead: 'Yes. Nonprofits with 501(c)(3) status, including CBOs, may apply. The package needs:',
        items: [
          { status: 'info', title: 'SF-424 application form', detail: 'Standard application cover form', source: 'grants.gov' },
          { status: 'info', title: 'Project narrative', detail: '15 pages maximum', source: 'grants.gov' },
          { status: 'info', title: 'Budget justification and letters of support', detail: 'Listed under Related documents', source: 'grants.gov' },
        ],
        next: 'The closing date is Mar 15, 2027.',
      } },
    ],
  },
];

const SOURCE_SCRIPTS: Record<SiteId, Script> = {
  grants: {
    title: 'Grants.gov',
    start: {},
    steps: [
      { do: 'note', text: 'I’ll search official federal listings on Grants.gov and check the most relevant opportunity.' },
      { do: 'access' },
      ...GRANTS_SEARCH,
      { do: 'answer', answer: {
        lead: 'The most relevant Grants.gov listing for community empowerment:',
        items: [{ status: 'info', title: 'Community Empowerment Pathways Program', detail: 'Up to $250,000 · Closes Mar 15, 2027 · Nonprofits, including CBOs', source: 'grants.gov' }],
      } },
    ],
  },
  international: {
    title: 'International Grants',
    start: {},
    steps: [
      { do: 'note', text: 'I’ll check open calls on an international funding portal and confirm who may apply.' },
      { do: 'access' },
      ...INTL_SEARCH.map((step) => (step.do === 'act' && step.tool === 'new_tab' ? act('Opening ec.europa.eu', 'navigate') : step)),
      { do: 'answer', answer: {
        lead: 'International calls checked. One is open to US nonprofits:',
        items: [
          { status: 'match', title: 'Global Community Resilience Fund', detail: '€150,000–€400,000 · Deadline 30 April 2027', source: 'ec.europa.eu' },
          { status: 'no', title: 'Youth Inclusion and Civic Participation Partnerships', detail: 'Lead applicant must be established in an EU Member State', source: 'ec.europa.eu' },
        ],
      } },
    ],
  },
  funder: {
    title: 'Funder website',
    start: {},
    steps: [
      { do: 'note', text: 'I’ll read the funder’s own priorities and grant guidelines before you decide to apply.' },
      { do: 'access' },
      ...FUNDER_TOUR,
      { do: 'answer', answer: {
        lead: 'Harborline Community Foundation’s priorities and guidelines, as published:',
        items: [
          { status: 'info', title: 'Priorities', detail: 'Economic mobility, youth leadership and neighborhood health', source: 'harborline-foundation.example' },
          { status: 'info', title: 'Guidelines', detail: '$25,000–$100,000 · Letter of inquiry due February 1, 2027', source: 'harborline-foundation.example' },
        ],
      } },
    ],
  },
};

// ── The live task, as the app's activity card shows it.
interface Task {
  title: string;
  access: boolean;
  goals: { text: string; status: 'pending' | 'active' | 'done' | 'stopped' }[];
  actions: { label: string; status: 'running' | 'done' | 'stopped' }[];
}
type Item =
  | { kind: 'ask' | 'note' | 'user'; text: string }
  | { kind: 'task' }
  | { kind: 'answer'; answer: Answer }
  | { kind: 'stopped' };
type Status = 'idle' | 'running' | 'done' | 'stopped';

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

export function BrowserWalkthrough() {
  const t = useT();
  const reduced = usePrefersReducedMotion();
  const [scene, setScene] = useState<Scene>(BLANK);
  const [items, setItems] = useState<Item[]>([]);
  const [task, setTask] = useState<Task | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [draft, setDraft] = useState('');
  const [selected, setSelected] = useState<{ kind: 'option'; index: number } | { kind: 'source'; site: SiteId } | null>(null);
  const [announce, setAnnounce] = useState('');
  const run = useRef(0);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  // ── Place the pointer and outline on the actual target elements.
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const offsetRef = useRef(0);
  const [pointer, setPointer] = useState<{ x: number; y: number; flip: boolean } | null>(null);
  const [outline, setOutline] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const stopRun = useCallback(() => { run.current += 1; }, []);
  useEffect(() => stopRun, [stopRun]);

  const start = useCallback((script: Script, choice: NonNullable<typeof selected>) => {
    const id = ++run.current;
    const live = () => run.current === id;
    const sleep = (ms: number) => new Promise<void>((resolve) => {
      setTimeout(resolve, reducedRef.current ? Math.min(ms, 160) : ms);
    });
    setSelected(choice);
    setStatus('running');
    setItems([]);
    setDraft('');
    setTask({ title: script.title, access: false, goals: [], actions: [] });
    setScene({ ...BLANK, ...script.start });
    setPointer(null);
    setOutline(null);
    offsetRef.current = 0;
    // Every wait re-checks that this run is still current, so an older run
    // can never write into the new one's transcript or page.
    const pause = async (ms: number) => { await sleep(ms); return live(); };
    let plan: string[] = [];
    let finished = 0;
    void (async () => {
      if (!(await pause(350))) return;
      for (const step of script.steps) {
        switch (step.do) {
          case 'ask':
          case 'note':
            setItems((list) => [...list, { kind: step.do, text: step.text }]);
            setAnnounce(step.text);
            if (!(await pause(900))) return;
            break;
          case 'reply': {
            for (let i = 1; i <= step.text.length; i += reducedRef.current ? step.text.length : 2) {
              setDraft(step.text.slice(0, i));
              if (!(await pause(28))) return;
            }
            setDraft(step.text);
            if (!(await pause(350))) return;
            setDraft('');
            setItems((list) => [...list, { kind: 'user', text: step.text }]);
            setAnnounce(`Your answer: ${step.text}`);
            if (!(await pause(700))) return;
            break;
          }
          case 'access':
            setTask((current) => current && { ...current, access: true });
            setItems((list) => (list.some((item) => item.kind === 'task') ? list : [...list, { kind: 'task' }]));
            if (!(await pause(700))) return;
            break;
          case 'plan':
            plan = step.goals;
            finished = 0;
            setTask((current) => current && { ...current, goals: step.goals.map((text, i) => ({ text, status: i === 0 ? 'active' : 'pending' })) });
            setAnnounce(`Task plan: ${plan.join('; ')}.`);
            if (!(await pause(900))) return;
            break;
          case 'goal':
            setTask((current) => {
              if (!current) return current;
              const goals = current.goals.map((goal) => ({ ...goal }));
              const active = goals.findIndex((goal) => goal.status === 'active');
              if (active >= 0) goals[active]!.status = 'done';
              const next = goals.find((goal) => goal.status === 'pending');
              if (next) next.status = 'active';
              return { ...current, goals };
            });
            if (plan[finished]) {
              const next = plan[finished + 1];
              setAnnounce(`Completed: ${plan[finished]}.${next ? ` Next: ${next}.` : ''}`);
              finished += 1;
              if (!(await pause(500))) return;
            }
            break;
          case 'act':
            setTask((current) => current && {
              ...current,
              actions: [...current.actions.map((action) => ({ ...action, status: 'done' as const })), { label: step.label, status: 'running' }],
            });
            setScene((s) => ({ ...s, toast: `${step.tool.replace(/_/g, ' ')}…` }));
            setAnnounce(step.label);
            if (!(await pause(250))) return;
            break;
          case 'scene':
            setScene((s) => {
              const patch = typeof step.set === 'function' ? step.set(s) : step.set;
              return { ...s, ...patch, click: step.click ? s.click + 1 : s.click };
            });
            if (!(await pause(step.wait ?? 600))) return;
            break;
          case 'type':
            for (let i = 1; i <= step.text.length; i += reducedRef.current ? step.text.length : 1) {
              setScene((s) => ({ ...s, typed: step.text.slice(0, i) }));
              if (!(await pause(55))) return;
            }
            setScene((s) => ({ ...s, typed: step.text }));
            if (!(await pause(350))) return;
            break;
          case 'answer':
            setTask((current) => current && {
              ...current,
              goals: current.goals.map((goal) => ({ ...goal, status: 'done' })),
              actions: current.actions.map((action) => ({ ...action, status: 'done' })),
            });
            setScene((s) => ({ ...s, halo: null, toast: null }));
            setItems((list) => [...list, { kind: 'answer', answer: step.answer }]);
            setAnnounce(`Task complete. ${step.answer.lead} ${[...step.answer.items.map((item) => `${item.title}: ${item.detail}.`), ...(step.answer.compare ?? []).map((row) => `${row.name}: ${row.amount}, ${row.deadline}.`), step.answer.next ?? ''].join(' ').trim()}`);
            break;
        }
      }
      if (live()) setStatus('done');
    })();
  }, []);

  const stop = () => {
    stopRun();
    setStatus('stopped');
    setDraft('');
    setTask((current) => current && {
      ...current,
      goals: current.goals.map((goal) => (goal.status === 'active' ? { ...goal, status: 'stopped' } : goal)),
      actions: current.actions.map((action) => (action.status === 'running' ? { ...action, status: 'stopped' } : action)),
    });
    setScene((s) => ({ ...s, loading: false, halo: null, toast: null, glow: false }));
    setItems((list) => [...list, { kind: 'stopped' }]);
    setAnnounce('Stopped');
  };
  const replay = () => {
    if (!selected) return;
    start(selected.kind === 'option' ? OPTION_SCRIPTS[selected.index]! : SOURCE_SCRIPTS[selected.site], selected);
  };

  const measure = useCallback(() => {
    const root = viewport.current;
    const inner = content.current;
    if (!root || !inner) return;
    const find = (name: string | null) => (name ? root.querySelector<HTMLElement>(`[data-target="${name}"]`) : null);
    const box = root.getBoundingClientRect();
    // The content's top includes its current (possibly mid-transition) shift,
    // so positions below are measured within the page, then placed where the
    // page will settle. Pointer, outline and scroll then move together.
    const top = inner.getBoundingClientRect().top;
    const scrollTarget = find(scene.scrollTo);
    let next = offsetRef.current;
    if (scrollTarget) {
      const max = Math.max(0, inner.scrollHeight - root.clientHeight);
      next = Math.min(max, Math.max(0, scrollTarget.getBoundingClientRect().top - top - root.clientHeight * 0.35));
    } else if (!scene.scrollTo) {
      next = 0;
    }
    offsetRef.current = next;
    setOffset(next);
    const place = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return { x: r.left - box.left, y: r.top - top - next, w: r.width, h: r.height };
    };
    const target = find(scene.cursor);
    if (target) {
      const r = place(target);
      const x = r.x + Math.min(r.w / 2, 48);
      // Keep the label inside the view near the right edge.
      setPointer({ x, y: r.y + r.h / 2, flip: x > box.width - 110 });
    } else if (scene.cursor) {
      // Its element is gone (the page changed): never point at unrelated content.
      setPointer(null);
    }
    const haloTarget = find(scene.halo);
    if (haloTarget) {
      const r = place(haloTarget);
      setOutline({ x: r.x - 4, y: r.y - 3, w: r.w + 8, h: r.h + 6 });
    } else {
      setOutline(null);
    }
  }, [scene.cursor, scene.halo, scene.scrollTo]);

  useLayoutEffect(() => { measure(); }, [measure, scene.page, scene.results, scene.typed, scene.loading, scene.verified, scene.ruledOut, scene.filtered, offset]);
  useEffect(() => {
    const root = viewport.current;
    const inner = content.current;
    if (!root || !inner) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(root);
    inner.addEventListener('transitionend', measure);
    return () => { observer.disconnect(); inner.removeEventListener('transitionend', measure); };
  }, [measure]);

  const page = PAGES[scene.page];
  const activeSite = page.site;
  const running = status === 'running';
  const transcript = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = transcript.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
  }, [items, task, reduced]);

  return (
    <section className="mx-auto max-w-7xl px-6 py-20 md:py-28" aria-labelledby="walkthrough-title">
      <div className="mb-10 grid gap-5 lg:grid-cols-2 lg:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-ink-secondary">
            {t('preview.eyebrow')}
          </p>
          <h2 id="walkthrough-title" className="mt-4 max-w-xl text-3xl font-semibold tracking-tight md:text-4xl">
            {t('preview.h2')}
          </h2>
        </div>
        <p className="max-w-lg text-sm leading-relaxed text-ink-secondary lg:justify-self-end">
          {t('preview.body')}
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-brand-navy/10 bg-brand-ice shadow-[0_40px_100px_-55px_rgba(7,20,34,0.55)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-navy/10 bg-white px-5 py-3 text-xs text-ink-secondary">
          <span className="flex items-center gap-2 font-semibold text-brand-navy">
            <BrandMark className="h-[18px] w-[18px]" />
            BulleBrowser
          </span>
          <span>{t('common.illustration')}</span>
        </div>

        <div lang="en" dir="ltr" className="grid md:h-[580px] md:grid-cols-[1.55fr_1fr]">
          {/* The browser, with the agent's tabs. */}
          <div className="flex min-h-0 min-w-0 flex-col border-b border-brand-navy/10 md:border-b-0 md:border-r">
            <div className="flex items-end gap-1 bg-brand-navy px-3 pt-2">
              <span className="mb-2.5 mr-2 hidden gap-1.5 sm:flex" aria-hidden="true">
                <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
              </span>
              <div aria-label="Sample source tabs" className="flex min-w-0 gap-1 overflow-x-auto">
                {(Object.keys(SITES) as SiteId[]).map((site) => {
                  const open = scene.tabs.includes(site);
                  const active = activeSite === site && open;
                  const busy = active && scene.loading;
                  return (
                    <button
                      key={site}
                      type="button"
                      aria-pressed={active}
                      onClick={() => start(SOURCE_SCRIPTS[site], { kind: 'source', site })}
                      className={`group flex max-w-[12rem] shrink-0 items-center gap-2 rounded-t-lg px-3 py-2 text-[11px] transition-colors ${
                        active
                          ? 'bg-white font-semibold text-brand-navy'
                          : open
                            ? 'bg-white/15 text-white hover:bg-white/25'
                            : 'border border-dashed border-white/25 text-white/70 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {busy ? (
                        <span className="wt-spin h-3.5 w-3.5 shrink-0 rounded-full border-2 border-brand-teal border-t-transparent" aria-hidden="true" />
                      ) : (
                        <span aria-hidden="true" className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[4px] text-[8px] font-bold ${SITES[site].markClass}`}>
                          {SITES[site].mark}
                        </span>
                      )}
                      <span className="truncate">{SITES[site].tab}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="relative flex items-center gap-2 border-b border-brand-navy/10 bg-white px-3 py-2">
              <span className="hidden gap-2 text-ink-secondary sm:flex" aria-hidden="true">
                <Icon name="arrow" className="h-3.5 w-3.5 rotate-180" />
                <Icon name="arrow" className="h-3.5 w-3.5" />
                <Icon name="replay" className="h-3.5 w-3.5" />
              </span>
              <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full bg-brand-ice px-3 py-1.5 text-[11px] text-ink-secondary">
                <Icon name="lock" className="h-3 w-3 shrink-0 text-brand-navy/70" />
                <span className="min-w-0 truncate">
                  <span className="font-semibold text-brand-navy">{page.host}</span>
                  {page.path === '/' ? '' : page.path}
                </span>
              </div>
              <span
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                  running ? 'bg-brand-teal/15 text-[#0f7f91]' : 'bg-brand-ice text-ink-secondary'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${running ? 'animate-pulse bg-brand-teal' : 'bg-ink-secondary/50'}`} />
                {running ? 'Browsing' : 'Agent tab'}
              </span>
              {scene.loading && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden" aria-hidden="true">
                  <span className="wt-progress block h-full w-1/3 bg-brand-teal" />
                </span>
              )}
            </div>

            <div
              ref={viewport}
              aria-hidden="true"
              className={`relative h-[340px] overflow-hidden bg-white transition-shadow md:h-auto md:min-h-0 md:flex-1 ${running ? 'shadow-[inset_0_0_0_2px_rgba(32,186,209,0.55)]' : ''}`}
            >
              <div
                ref={content}
                className={`wt-scroll h-full ${scene.loading ? 'opacity-40' : 'opacity-100'}`}
                style={{ transform: `translateY(${-offset}px)` }}
              >
                <SitePage state={scene} />
              </div>
              {scene.loading && <div className="wt-shimmer pointer-events-none absolute inset-0 opacity-60" />}
              {scene.glow && <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_42px_rgba(32,186,209,0.3)]" />}
              {outline && (
                <div
                  className="wt-halo pointer-events-none absolute rounded-md border-2 border-brand-teal shadow-[0_0_0_4px_rgba(32,186,209,0.18)]"
                  style={{ left: outline.x, top: outline.y, width: outline.w, height: outline.h }}
                />
              )}
              {pointer && (
                <div className="wt-pointer pointer-events-none absolute left-0 top-0 z-10" style={{ transform: `translate(${pointer.x}px, ${pointer.y}px)` }}>
                  {scene.click > 0 && <span key={scene.click} className="wt-ring absolute left-0 top-0 h-4 w-4 rounded-full border-2 border-brand-teal" />}
                  <svg width="22" height="22" viewBox="0 0 24 24" className="-ml-0.5 -mt-0.5 drop-shadow-[0_1px_3px_rgba(0,0,0,0.4)]">
                    <path d="M5 3l14 8.5-6.2 1.4L9.8 19 5 3z" fill="#fff" stroke="#111" strokeWidth="1.3" strokeLinejoin="round" />
                  </svg>
                  <span className={`mt-0.5 block w-max rounded bg-brand-navy px-1.5 py-0.5 text-[9px] font-semibold text-white ${pointer.flip ? '-ml-20' : 'ml-4'}`}>BulleBrowser</span>
                </div>
              )}
              {scene.toast && running && (
                <span className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-[#10232b] px-2.5 py-1.5 text-[11px] text-white">{scene.toast}</span>
              )}
            </div>
          </div>

          {/* The assistant, as the app's side panel shows it. */}
          <div className="flex h-[560px] min-h-0 min-w-0 flex-col bg-white md:h-full">
            <div className="flex items-center justify-between border-b border-brand-navy/10 px-5 py-3 text-xs font-semibold text-brand-navy">
              <span>Your Assistant</span>
              <span className="flex items-center gap-1.5 text-[10px] font-medium text-ink-secondary">
                {status === 'running' && <><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-teal" />BulleBrowser Agentic AI is working…</>}
                {status === 'done' && <><Icon name="check-circle" className="h-3.5 w-3.5 text-brand-teal" />Task complete</>}
                {status === 'stopped' && 'Stopped'}
                {status === 'idle' && <span aria-hidden="true">···</span>}
              </span>
            </div>

            <div ref={transcript} className="flex-1 overflow-y-auto px-5 py-4">
              <p className={`font-semibold tracking-tight text-brand-navy ${status === 'idle' ? 'mb-4 mt-4 text-xl' : 'mb-2 text-xs'}`}>
                Where should we browse?
              </p>
              <div className={status === 'idle' ? 'grid grid-cols-2 gap-2' : 'flex flex-wrap gap-1.5'}>
                {WORKFLOWS.map((workflow, i) => {
                  const chosen = selected?.kind === 'option' && selected.index === i;
                  return (
                    <button
                      key={workflow.id}
                      type="button"
                      aria-pressed={chosen}
                      onClick={() => start(OPTION_SCRIPTS[i]!, { kind: 'option', index: i })}
                      className={
                        status === 'idle'
                          ? `group flex min-h-[78px] flex-col justify-between rounded-xl border p-3 text-left text-xs font-medium leading-snug text-brand-navy transition hover:-translate-y-0.5 hover:border-brand-teal hover:shadow-md ${i === 0 ? 'border-brand-teal/60 bg-brand-teal/5' : 'border-brand-navy/10 bg-white'}`
                          : `flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors ${chosen ? 'border-brand-teal bg-brand-teal/10 text-brand-navy' : 'border-brand-navy/10 text-ink-secondary hover:border-brand-teal hover:text-brand-navy'}`
                      }
                    >
                      <Icon name={OPTION_ICONS[i]!} className={status === 'idle' ? 'h-4 w-4 text-brand-teal' : 'h-3.5 w-3.5 text-brand-teal'} />
                      {workflow.label}
                    </button>
                  );
                })}
              </div>
              {status === 'idle' && (
                <p className="mt-5 text-sm leading-relaxed text-ink-secondary">
                  Choose an option to watch BulleBrowser browse, or pick a source tab.
                </p>
              )}

              <div className="mt-4 space-y-3 text-[13px] leading-relaxed">
                {items.map((item, i) => {
                  if (item.kind === 'ask' || item.kind === 'note') {
                    return <p key={i} className="text-brand-navy">{item.text}</p>;
                  }
                  if (item.kind === 'user') {
                    return (
                      <p key={i} className="ml-auto w-fit max-w-[88%] rounded-2xl rounded-br-md bg-brand-navy px-3.5 py-2 text-white">
                        {item.text}
                      </p>
                    );
                  }
                  if (item.kind === 'task' && task) return <TaskCard key={i} task={task} running={running} />;
                  if (item.kind === 'answer') return <AnswerCard key={i} answer={item.answer} onReplay={replay} />;
                  if (item.kind === 'stopped') {
                    return <p key={i} className="text-xs text-ink-secondary">Task stopped at your request. Nothing was submitted.</p>;
                  }
                  return null;
                })}
              </div>
            </div>

            <div className="border-t border-brand-navy/10 p-4">
              <div tabIndex={0} className="halo flex items-center gap-2 rounded-xl border border-brand-navy/10 bg-white px-4 py-3 text-xs">
                <svg className="preview-border-track" aria-hidden="true">
                  <rect x="0" y="0" width="100%" height="100%" rx="12" pathLength="100" />
                </svg>
                <span className={`min-w-0 flex-1 truncate ${draft ? 'wt-caret text-brand-navy' : 'text-ink-secondary'}`}>
                  {draft || 'Ask BulleBrowser to browse…'}
                </span>
                {running ? (
                  <button type="button" onClick={stop} className="flex items-center gap-1 rounded-lg bg-brand-navy px-2.5 py-1.5 text-[11px] font-semibold text-white">
                    <Icon name="stop" className="h-3 w-3" />
                    Stop
                  </button>
                ) : (
                  <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-lg bg-brand-teal text-white">
                    <Icon name="arrow" className="h-3.5 w-3.5 -rotate-90" />
                  </span>
                )}
              </div>
            </div>
            <p className="sr-only" aria-live="polite">{announce}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function TaskCard({ task, running }: { task: Task; running: boolean }) {
  const shown = task.actions.slice(-4);
  const earlier = task.actions.length - shown.length;
  return (
    <div className="rounded-xl border border-brand-navy/10 bg-brand-ice/60 p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-brand-navy">{task.title}</span>
        {running && <span className="wt-spin h-3 w-3 rounded-full border-2 border-brand-teal border-t-transparent" aria-hidden="true" />}
      </div>
      {task.access && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-secondary">
          <Icon name="lock" className="h-3 w-3 text-brand-teal" />
          Session access granted · Agent tabs
        </p>
      )}
      {task.goals.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-secondary">Task plan</p>
          <ol className="mt-1.5 space-y-1">
            {task.goals.map((goal) => (
              <li key={goal.text} className={`flex items-center gap-2 ${goal.status === 'pending' || goal.status === 'stopped' ? 'text-ink-secondary' : 'text-brand-navy'}`}>
                <span
                  aria-hidden="true"
                  className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border text-[8px] ${
                    goal.status === 'done' ? 'border-brand-teal bg-brand-teal text-white' : goal.status === 'active' ? 'border-brand-teal' : 'border-brand-navy/20'
                  }`}
                >
                  {goal.status === 'done' ? '✓' : goal.status === 'active' ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-teal" /> : goal.status === 'stopped' ? <span className="h-1.5 w-1.5 rounded-[1px] bg-ink-secondary" /> : ''}
                </span>
                <span className="sr-only">{goal.status === 'done' ? 'Completed: ' : goal.status === 'active' ? 'In progress: ' : goal.status === 'stopped' ? 'Stopped: ' : 'Pending: '}</span>
                {goal.text}
              </li>
            ))}
          </ol>
        </div>
      )}
      {task.actions.length > 0 && (
        <div className="mt-3 border-t border-brand-navy/10 pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-secondary">
            Activity{earlier > 0 ? ` · ${earlier} earlier step${earlier === 1 ? '' : 's'}` : ''}
          </p>
          <ul className="mt-1.5 space-y-1">
            {shown.map((action, i) => (
              <li key={`${task.actions.length - shown.length + i}-${action.label}`} className="flex items-center gap-2 text-brand-navy">
                {action.status === 'running' ? (
                  <span className="wt-spin h-3 w-3 shrink-0 rounded-full border-2 border-brand-teal border-t-transparent" aria-hidden="true" />
                ) : action.status === 'stopped' ? (
                  <Icon name="stop" className="h-3 w-3 text-ink-secondary" />
                ) : (
                  <Icon name="check" className="h-3 w-3 text-brand-teal" />
                )}
                <span className="truncate">
                  <span className="sr-only">{action.status === 'running' ? 'Running: ' : action.status === 'stopped' ? 'Stopped: ' : 'Done: '}</span>
                  {action.label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AnswerCard({ answer, onReplay }: { answer: Answer; onReplay: () => void }) {
  const sources = [...new Set([...answer.items.map((item) => item.source), ...(answer.compare ?? []).map((row) => row.source)])];
  return (
    <div className="rounded-xl border border-brand-teal/30 bg-white p-3.5 shadow-[0_12px_30px_-22px_rgba(7,20,34,0.45)]">
      <p className="text-brand-navy">{answer.lead}</p>
      {answer.items.length > 0 && (
        <ul className="mt-2.5 space-y-2">
          {answer.items.map((item) => (
            <li key={item.title} className="flex gap-2 text-xs">
              <span
                aria-hidden="true"
                className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] font-bold ${
                  item.status === 'match' ? 'bg-brand-teal text-white' : item.status === 'no' ? 'bg-[#fdecec] text-[#b42318]' : 'bg-brand-gold text-brand-navy'
                }`}
              >
                {item.status === 'match' ? '✓' : item.status === 'no' ? '✕' : 'i'}
              </span>
              <span>
                <span className="font-semibold text-brand-navy">{item.title}</span>
                <span className="block text-ink-secondary">{item.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {answer.compare && (
        <div className="mt-2.5 overflow-hidden rounded-lg border border-brand-navy/10">
          <table className="w-full table-fixed text-left text-[11px]">
            <caption className="sr-only">Programs compared by award and deadline</caption>
            <thead className="bg-brand-ice text-brand-navy">
              <tr>
                <th scope="col" className="w-[42%] px-2.5 py-1.5 font-semibold">Program</th>
                <th scope="col" className="px-2.5 py-1.5 font-semibold">Award</th>
                <th scope="col" className="px-2.5 py-1.5 font-semibold">Deadline</th>
              </tr>
            </thead>
            <tbody>
              {answer.compare.map((row) => (
                <tr key={row.name} className="border-t border-brand-navy/10 align-top text-ink-secondary">
                  <th scope="row" className="px-2.5 py-1.5 font-medium text-brand-navy">{row.name}</th>
                  <td className="px-2.5 py-1.5">{row.amount}</td>
                  <td className="px-2.5 py-1.5">{row.deadline}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {answer.next && <p className="mt-2.5 text-xs text-ink-secondary">{answer.next}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {sources.map((source) => (
          <span key={source} className="flex items-center gap-1 rounded-full bg-brand-ice px-2 py-0.5 text-[10px] font-medium text-brand-navy">
            <Icon name="globe" className="h-3 w-3 text-brand-teal" />
            {source}
          </span>
        ))}
        <button type="button" onClick={onReplay} className="ml-auto flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold text-[#0f7f91] hover:bg-brand-teal/10">
          <Icon name="replay" className="h-3 w-3" />
          Replay
        </button>
      </div>
    </div>
  );
}
