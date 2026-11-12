// The sample pages the walkthrough browses. Every opportunity, agency, call and
// funder here is fictional; the section is labelled as an illustration. Each
// element the agent acts on carries a data-target, so the pointer and outline
// land on the actual element, as they do on real pages in the desktop app.

import type { ReactNode } from 'react';
import { BrandMark } from '../BrandMark';

export type SiteId = 'grants' | 'international' | 'funder';
export type PageId =
  | 'start'
  | 'grants-search'
  | 'grants-detail'
  | 'grants-docs'
  | 'intl-search'
  | 'intl-call'
  | 'funder-home'
  | 'funder-priorities'
  | 'funder-grants';

export const SITES: Record<SiteId, { tab: string; mark: string; markClass: string }> = {
  grants: { tab: 'Grants.gov', mark: 'G', markClass: 'bg-[#112e51] text-white' },
  international: { tab: 'International Grants', mark: 'I', markClass: 'bg-[#1f4fa8] text-[#ffd617]' },
  funder: { tab: 'Funder website', mark: 'H', markClass: 'bg-brand-teal text-white' },
};

export const PAGES: Record<PageId, { site: SiteId | null; host: string; path: string }> = {
  start: { site: null, host: 'BulleBrowser', path: ' · New tab' },
  'grants-search': { site: 'grants', host: 'grants.gov', path: '/search-grants' },
  'grants-detail': { site: 'grants', host: 'grants.gov', path: '/search-results-detail/OCP-27-014' },
  'grants-docs': { site: 'grants', host: 'grants.gov', path: '/search-results-detail/OCP-27-014/documents' },
  'intl-search': { site: 'international', host: 'ec.europa.eu', path: '/info/funding-tenders/opportunities/portal' },
  'intl-call': { site: 'international', host: 'ec.europa.eu', path: '/info/funding-tenders/opportunities/topic-details/GCR-2027-02' },
  'funder-home': { site: 'funder', host: 'harborline-foundation.example', path: '/' },
  'funder-priorities': { site: 'funder', host: 'harborline-foundation.example', path: '/priorities' },
  'funder-grants': { site: 'funder', host: 'harborline-foundation.example', path: '/grants' },
};

export interface PageState {
  page: PageId;
  /** Text the agent has typed into the page's search field. */
  typed: string;
  /** Search results are on screen. */
  results: boolean;
  /** A status filter the agent switched on. */
  filtered: boolean;
  /** Targets the agent checked against the page, and those it ruled out. */
  verified: string[];
  ruledOut: string[];
}

function Mark({ name, state, children }: { name: string; state: PageState; children: ReactNode }) {
  const verified = state.verified.includes(name);
  const ruledOut = state.ruledOut.includes(name);
  return (
    <span data-target={name} className="relative inline-flex flex-wrap items-center gap-1.5">
      {children}
      {verified && (
        <span className="rounded-full bg-brand-teal/15 px-1.5 py-0.5 text-[9px] font-semibold text-[#0f7f91]">
          ✓ Verified
        </span>
      )}
      {ruledOut && (
        <span className="rounded-full bg-[#fdecec] px-1.5 py-0.5 text-[9px] font-semibold text-[#b42318]">
          ✕ Not eligible
        </span>
      )}
    </span>
  );
}

function Field({ value, active, placeholder, target }: { value: string; active: boolean; placeholder: string; target: string }) {
  return (
    <div
      data-target={target}
      className={`flex h-9 min-w-0 flex-1 items-center gap-2 rounded border bg-white px-3 text-[11px] ${active ? 'border-brand-teal ring-2 ring-brand-teal/20' : 'border-[#a9aeb1]'}`}
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-[#71767a]" fill="none" stroke="currentColor" strokeWidth={2}>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.8-3.8" />
      </svg>
      <span className={`truncate ${value ? 'text-[#1b1b1b]' : 'text-[#71767a]'} ${active ? 'wt-caret' : ''}`}>
        {value || placeholder}
      </span>
    </div>
  );
}

const Bars = ({ rows = 3 }: { rows?: number }) => (
  <div className="space-y-1.5" aria-hidden="true">
    {Array.from({ length: rows }, (_, i) => (
      <div key={i} className="h-1.5 rounded-full bg-[#e6ebee]" style={{ width: `${92 - i * 14}%` }} />
    ))}
  </div>
);

// ── Grants.gov, in its own layout: navy navigation, search with a filter
//    sidebar and a results table, then the opportunity synopsis.

const GRANT_ROWS = [
  { id: 'gg-row-1', title: 'Community Empowerment Pathways Program', agency: 'Office of Community Programs', close: 'Mar 15, 2027' },
  { id: 'gg-row-2', title: 'Neighborhood Youth Workforce Initiative', agency: 'Bureau of Workforce Partnerships', close: 'Feb 2, 2027' },
  { id: 'gg-row-3', title: 'Local Capacity Building Grants', agency: 'Office of Civic Infrastructure', close: 'Jan 20, 2027' },
];

function GrantsShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full bg-white font-[system-ui] text-[#1b1b1b]">
      <div className="h-2 bg-[#f0f0f0]" />
      <div className="flex items-center gap-4 bg-[#112e51] px-4 py-2.5 text-white">
        <span className="text-[13px] font-bold tracking-wide">GRANTS.GOV</span>
        <span className="hidden gap-3 text-[10px] text-white/80 sm:flex">
          <span className="font-semibold text-white">Search Grants</span>
          <span>Applicants</span>
          <span>Grantors</span>
          <span>Learn</span>
        </span>
      </div>
      {children}
    </div>
  );
}

function GrantsSearch({ state }: { state: PageState }) {
  return (
    <GrantsShell>
      <div className="flex gap-4 p-4">
        <aside className="hidden w-32 shrink-0 space-y-3 text-[10px] sm:block">
          {[
            ['Opportunity status', ['Posted', 'Forecasted']],
            ['Eligibility', ['Nonprofits', 'Small businesses']],
            ['Category', ['Community development', 'Employment']],
          ].map(([title, options]) => (
            <div key={title as string}>
              <p className="mb-1 font-semibold">{title as string}</p>
              {(options as string[]).map((option, i) => (
                <p key={option} className="flex items-center gap-1.5 py-0.5 text-[#3d4551]">
                  <span className={`grid h-2.5 w-2.5 place-items-center rounded-sm border ${i === 0 ? 'border-[#005ea2] bg-[#005ea2]' : 'border-[#a9aeb1]'}`} />
                  {option}
                </p>
              ))}
            </div>
          ))}
        </aside>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold">Search Grants</p>
          <div className="mt-2 flex gap-2">
            <Field target="gg-search" value={state.typed} active={!!state.typed && !state.results} placeholder="Keyword, opportunity number or agency" />
            <span data-target="gg-submit" className="grid h-9 place-items-center rounded bg-[#005ea2] px-4 text-[11px] font-semibold text-white">
              Search
            </span>
          </div>
          <div className="mt-4 overflow-hidden rounded border border-[#dfe1e2] text-[10px]">
            <div className="grid grid-cols-[1fr_auto] gap-3 bg-[#f0f0f0] px-3 py-1.5 font-semibold sm:grid-cols-[1.6fr_1fr_auto]">
              <span>Opportunity title</span>
              <span className="hidden sm:block">Agency</span>
              <span>Close date</span>
            </div>
            {state.results ? (
              GRANT_ROWS.map((row) => (
                <div key={row.id} className="grid grid-cols-[1fr_auto] items-center gap-3 border-t border-[#dfe1e2] px-3 py-2 sm:grid-cols-[1.6fr_1fr_auto]">
                  <span data-target={row.id} className="font-semibold text-[#005ea2] underline decoration-[#005ea2]/30">
                    {row.title}
                  </span>
                  <span className="hidden text-[#3d4551] sm:block">{row.agency}</span>
                  <span className="text-[#3d4551]">{row.close}</span>
                </div>
              ))
            ) : (
              <div className="border-t border-[#dfe1e2] px-3 py-6 text-center text-[#71767a]">
                Enter a keyword to search posted opportunities.
              </div>
            )}
          </div>
        </div>
      </div>
    </GrantsShell>
  );
}

function SynopsisRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 border-t border-[#dfe1e2] px-3 py-2 sm:grid-cols-[9rem_1fr]">
      <span className="font-semibold text-[#3d4551]">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function GrantsDetail({ state }: { state: PageState }) {
  return (
    <GrantsShell>
      <div className="p-4 text-[10px]">
        <p className="text-[#71767a]">View Grant Opportunity</p>
        <p className="mt-1 text-[15px] font-bold leading-snug">Community Empowerment Pathways Program</p>
        <p className="mt-1 text-[#3d4551]">OCP-27-014 · Office of Community Programs</p>
        <div className="mt-3 flex gap-2 text-[10px]">
          <span className="border-b-2 border-[#005ea2] pb-1 font-semibold">Synopsis</span>
          <span data-target="gg-docs-tab" className="pb-1 text-[#005ea2]">Related documents</span>
          <span className="pb-1 text-[#71767a]">Package</span>
        </div>
        <div className="mt-2 overflow-hidden rounded border border-[#dfe1e2]">
          <SynopsisRow label="Category">Community development</SynopsisRow>
          <SynopsisRow label="Eligible applicants">
            <Mark name="gg-elig" state={state}>Nonprofits with 501(c)(3) status, including CBOs</Mark>
          </SynopsisRow>
          <SynopsisRow label="Award ceiling">
            <Mark name="gg-award" state={state}>$250,000</Mark>
          </SynopsisRow>
          <SynopsisRow label="Expected awards">40</SynopsisRow>
          <SynopsisRow label="Closing date">
            <Mark name="gg-close" state={state}>Mar 15, 2027</Mark>
          </SynopsisRow>
          <SynopsisRow label="Description">
            <Bars rows={4} />
          </SynopsisRow>
        </div>
      </div>
    </GrantsShell>
  );
}

function GrantsDocs({ state }: { state: PageState }) {
  const files = ['SF-424 application form', 'Project narrative (15 pages max.)', 'Budget justification', 'Letters of support'];
  return (
    <GrantsShell>
      <div className="p-4 text-[10px]">
        <p className="text-[#71767a]">View Grant Opportunity</p>
        <p className="mt-1 text-[15px] font-bold leading-snug">Community Empowerment Pathways Program</p>
        <div className="mt-3 flex gap-2">
          <span className="pb-1 text-[#005ea2]">Synopsis</span>
          <span className="border-b-2 border-[#005ea2] pb-1 font-semibold">Related documents</span>
        </div>
        <p className="mt-3 font-semibold">Application package</p>
        <ul className="mt-2 space-y-1.5">
          {files.map((file, i) => (
            <li key={file} className="flex items-center gap-2 rounded border border-[#dfe1e2] px-3 py-2">
              <span className="grid h-5 w-4 place-items-center rounded-sm bg-[#e7f2f8] text-[7px] font-bold text-[#005ea2]">PDF</span>
              <Mark name={`gg-file-${i + 1}`} state={state}>{file}</Mark>
            </li>
          ))}
        </ul>
      </div>
    </GrantsShell>
  );
}

// ── International calls, in the layout of an international funding portal.

const CALLS = [
  { id: 'intl-card-1', title: 'Youth Inclusion and Civic Participation Partnerships', code: 'CIVIC-2027-YOUTH-01', deadline: '16 February 2027', who: 'Lead applicant established in an EU Member State' },
  { id: 'intl-card-2', title: 'Global Community Resilience Fund', code: 'GCR-2027-02', deadline: '30 April 2027', who: 'Open to applicants from any country' },
];

function IntlShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full bg-[#f5f7fb] font-[system-ui] text-[#262b38]">
      <div className="flex items-center justify-between bg-[#1f4fa8] px-4 py-2.5 text-white">
        <span className="flex items-center gap-2 text-[12px] font-semibold">
          <span className="grid h-5 w-5 place-items-center rounded-full border border-[#ffd617] text-[9px] text-[#ffd617]">★</span>
          Funding &amp; tender opportunities
        </span>
        <span className="hidden text-[10px] text-white/80 sm:block">Search funding · How to participate</span>
      </div>
      {children}
    </div>
  );
}

function IntlSearch({ state }: { state: PageState }) {
  return (
    <IntlShell>
      <div className="p-4 text-[10px]">
        <p className="text-[15px] font-bold">Calls for proposals</p>
        <div className="mt-2 flex gap-2">
          <Field target="intl-search" value={state.typed} active={!!state.typed && !state.results} placeholder="Search calls by keyword" />
          <span data-target="intl-submit" className="grid h-9 place-items-center rounded bg-[#1f4fa8] px-4 text-[11px] font-semibold text-white">
            Search
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span
            data-target="intl-open"
            className={`rounded-full border px-2.5 py-1 font-semibold ${state.filtered ? 'border-[#1f4fa8] bg-[#1f4fa8] text-white' : 'border-[#c3cad9] bg-white'}`}
          >
            {state.filtered ? '✓ ' : ''}Open for submission
          </span>
          <span className="rounded-full border border-[#c3cad9] bg-white px-2.5 py-1">Forthcoming</span>
          <span className="rounded-full border border-[#c3cad9] bg-white px-2.5 py-1">Closed</span>
        </div>
        <div className="mt-3 space-y-2">
          {state.results ? (
            CALLS.map((call, i) => (
              <div key={call.id} className="rounded-lg border border-[#d6dcea] bg-white p-3">
                <span data-target={call.id} className="font-semibold text-[#1f4fa8]">{call.title}</span>
                <p className="mt-1 text-[#5b6476]">{call.code} · Deadline {call.deadline}</p>
                <p className="mt-1"><Mark name={`intl-who-${i + 1}`} state={state}>{call.who}</Mark></p>
                <span className="mt-1.5 inline-block rounded bg-[#e3f4e8] px-1.5 py-0.5 text-[9px] font-semibold text-[#1f7a3d]">Open for submission</span>
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-[#c3cad9] bg-white p-5 text-center text-[#5b6476]">
              Search open calls from international funding programmes.
            </div>
          )}
        </div>
      </div>
    </IntlShell>
  );
}

function IntlCall({ state }: { state: PageState }) {
  return (
    <IntlShell>
      <div className="p-4 text-[10px]">
        <p className="text-[#5b6476]">Topic details · GCR-2027-02</p>
        <p className="mt-1 text-[15px] font-bold leading-snug">Global Community Resilience Fund</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {[
            ['Status', <span key="s" className="font-semibold text-[#1f7a3d]">Open for submission</span>],
            ['Deadline', <Mark key="d" name="intl-deadline" state={state}>30 April 2027</Mark>],
            ['Budget per project', <Mark key="b" name="intl-budget" state={state}>€150,000 – €400,000</Mark>],
            ['Type of action', 'Community partnership grant'],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-lg border border-[#d6dcea] bg-white p-2.5">
              <p className="text-[#5b6476]">{label}</p>
              <p className="mt-0.5 font-semibold">{value}</p>
            </div>
          ))}
        </div>
        <div className="mt-2 rounded-lg border border-[#d6dcea] bg-white p-2.5">
          <p className="font-semibold">Eligibility conditions</p>
          <p className="mt-1">
            <Mark name="intl-elig" state={state}>Legal entities from any country, including US nonprofits, may lead a consortium.</Mark>
          </p>
          <div className="mt-2"><Bars rows={2} /></div>
        </div>
      </div>
    </IntlShell>
  );
}

// ── A funder's own website.

function FunderShell({ children, active }: { children: ReactNode; active: 'home' | 'priorities' | 'grants' }) {
  const link = (id: 'priorities' | 'grants', label: string) => (
    <span data-target={`fd-nav-${id}`} className={active === id ? 'font-semibold text-brand-navy underline decoration-brand-gold decoration-2 underline-offset-4' : ''}>
      {label}
    </span>
  );
  return (
    <div className="min-h-full bg-[#fbfaf6] font-[Georgia,serif] text-[#23201a]">
      <div className="flex items-center justify-between border-b border-[#e8e2d3] px-4 py-3">
        <span className="flex items-center gap-2 text-[12px] font-semibold">
          <span className="h-4 w-4 rounded-full bg-gradient-to-br from-brand-teal to-brand-navy" />
          Harborline Community Foundation
        </span>
        <span className="flex gap-3 font-[system-ui] text-[10px] text-[#5d574a]">
          <span className="hidden sm:inline">About</span>
          {link('priorities', 'Priorities')}
          {link('grants', 'Grants')}
          <span className="hidden sm:inline">Apply</span>
        </span>
      </div>
      {children}
    </div>
  );
}

function FunderHome() {
  return (
    <FunderShell active="home">
      <div className="p-5">
        <p className="font-[system-ui] text-[9px] font-semibold uppercase tracking-[0.2em] text-[#8a8270]">New Jersey · Southern California</p>
        <p className="mt-2 max-w-xs text-[20px] leading-tight">Opportunity starts close to home.</p>
        <p className="mt-2 max-w-sm font-[system-ui] text-[10px] leading-relaxed text-[#5d574a]">
          We invest in community-led work that widens economic mobility for young people and their families.
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {['#d9efe9', '#f3ead0', '#e3e9f4'].map((color) => (
            <div key={color} className="h-16 rounded-lg" style={{ background: color }} />
          ))}
        </div>
      </div>
    </FunderShell>
  );
}

function FunderPriorities({ state }: { state: PageState }) {
  const items = [
    ['fd-p1', 'Economic mobility', 'Pathways into stable work and careers.'],
    ['fd-p2', 'Youth leadership', 'Young adults leading change in their neighborhoods.'],
    ['fd-p3', 'Neighborhood health', 'Access to care, food and safe public spaces.'],
  ];
  return (
    <FunderShell active="priorities">
      <div className="p-5">
        <p className="text-[18px] leading-tight">Our priorities</p>
        <div className="mt-3 space-y-2 font-[system-ui] text-[10px]">
          {items.map(([id, title, body]) => (
            <div key={id} className="rounded-lg border border-[#e8e2d3] bg-white p-3">
              <Mark name={id!} state={state}><span className="font-semibold">{title}</span></Mark>
              <p className="mt-0.5 text-[#5d574a]">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </FunderShell>
  );
}

function FunderGrants({ state }: { state: PageState }) {
  return (
    <FunderShell active="grants">
      <div className="p-5 font-[system-ui] text-[10px]">
        <p className="font-[Georgia,serif] text-[18px] leading-tight">Grant guidelines</p>
        <div className="mt-3 overflow-hidden rounded-lg border border-[#e8e2d3] bg-white">
          {[
            ['Grant range', <Mark key="r" name="fd-range" state={state}>$25,000 – $100,000</Mark>],
            ['Geography', <Mark key="g" name="fd-region" state={state}>New Jersey and Southern California</Mark>],
            ['Letter of inquiry', <Mark key="l" name="fd-loi" state={state}>Due February 1, 2027</Mark>],
          ].map(([label, value]) => (
            <div key={label as string} className="grid grid-cols-[7rem_1fr] gap-3 border-b border-[#f0ebdf] px-3 py-2 last:border-0">
              <span className="font-semibold text-[#5d574a]">{label}</span>
              <span>{value}</span>
            </div>
          ))}
        </div>
        <span data-target="fd-apply" className="mt-3 inline-block rounded-full bg-brand-navy px-4 py-2 font-semibold text-white">
          Start a letter of inquiry
        </span>
      </div>
    </FunderShell>
  );
}

// The app's own new-tab page, where a task starts.
function StartPage() {
  return (
    <div className="grid h-full min-h-[340px] place-items-center bg-gradient-to-b from-brand-ice to-white px-6">
      <div className="w-full max-w-sm text-center">
        <BrandMark className="mx-auto h-11 w-11 drop-shadow-[0_12px_18px_rgba(32,186,209,0.45)]" />
        <p className="mt-3 text-lg font-semibold tracking-tight text-brand-navy">BulleBrowser</p>
        <div className="mt-4 flex items-center gap-2 rounded-full border border-brand-navy/10 bg-white px-4 py-2.5 text-left text-[11px] text-ink-secondary shadow-sm">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-brand-teal" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.8-3.8" />
          </svg>
          Search the web or ask BulleBrowser
        </div>
        <div className="mt-4 flex justify-center gap-2 text-[10px] text-brand-navy">
          {(Object.keys(SITES) as SiteId[]).map((site) => (
            <span key={site} className="flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 shadow-sm">
              <span className={`grid h-3.5 w-3.5 place-items-center rounded-[4px] text-[8px] font-bold ${SITES[site].markClass}`}>{SITES[site].mark}</span>
              {SITES[site].tab}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SitePage({ state }: { state: PageState }) {
  switch (state.page) {
    case 'start': return <StartPage />;
    case 'grants-search': return <GrantsSearch state={state} />;
    case 'grants-detail': return <GrantsDetail state={state} />;
    case 'grants-docs': return <GrantsDocs state={state} />;
    case 'intl-search': return <IntlSearch state={state} />;
    case 'intl-call': return <IntlCall state={state} />;
    case 'funder-home': return <FunderHome />;
    case 'funder-priorities': return <FunderPriorities state={state} />;
    case 'funder-grants': return <FunderGrants state={state} />;
  }
}
