// The Session Scratchpad's strategy brief.
//
// While the assistant works on funding opportunities it shares a strategy
// playbook for each promising one (what wins it, what a successful proposal
// must have, the dates and the next move). The scratchpad gathers those
// playbooks for the whole conversation, puts them in the order to pursue them,
// and turns them into a one or two page brief the user can download as a PDF.
//
// Everything here is pure: the panel and the PDF are built from the same brief.

import type { StrategyPlaybook } from '@bullebrowser/agent-core';

interface RunLike {
  startedAt: number;
  steps: readonly { kind: string; ts?: number; playbook?: StrategyPlaybook }[];
}

const OUTLOOK_ORDER: Record<string, number> = { strong: 0, promising: 1, 'long shot': 2, 'not a fit': 3 };
const OUTLOOK_WORDS: Record<string, string> = {
  strong: 'Strong fit',
  promising: 'Promising',
  'long shot': 'Long shot',
  'not a fit': 'Not a fit',
};

/** How many opportunities the brief covers in full; the rest are listed briefly. */
export const BRIEF_FULL_LIMIT = 4;
/** How many points each part of an opportunity keeps in the brief. */
export const BRIEF_POINTS = 4;

const keyOf = (playbook: StrategyPlaybook): string =>
  (playbook.opportunity || playbook.headline).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Every playbook shared in the conversation, one per opportunity: a later
 * playbook for the same opportunity replaces the earlier one.
 */
export function collectPlaybooks(runs: readonly RunLike[]): StrategyPlaybook[] {
  const latest = new Map<string, { playbook: StrategyPlaybook; at: number }>();
  const ordered = [...runs].sort((a, b) => a.startedAt - b.startedAt);
  for (const run of ordered) {
    for (const step of run.steps) {
      if (step.kind !== 'strategy' || !step.playbook?.headline) continue;
      const key = keyOf(step.playbook);
      if (!key) continue;
      const previous = latest.get(key);
      latest.set(key, { playbook: step.playbook, at: previous?.at ?? step.ts ?? run.startedAt });
    }
  }
  return [...latest.values()].map((entry) => entry.playbook);
}

/** The first date a deadline line names, when one can be read from it. */
export function deadlineTime(playbook: StrategyPlaybook): number | null {
  for (const line of playbook.deadlines ?? []) {
    const iso = line.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const words = line.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/i);
    if (words) {
      const parsed = Date.parse(`${words[1]} ${words[2]}, ${words[3]} UTC`);
      if (!Number.isNaN(parsed)) return parsed;
    }
    const numeric = line.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
    if (numeric) return Date.UTC(Number(numeric[3]), Number(numeric[1]) - 1, Number(numeric[2]));
  }
  return null;
}

/**
 * The order to pursue them in: a deadline already passed goes last, then the
 * best fit first, then the nearest deadline, then the order they were found.
 */
export function rankPlaybooks(playbooks: readonly StrategyPlaybook[], now: number): StrategyPlaybook[] {
  return playbooks
    .map((playbook, index) => ({ playbook, index, due: deadlineTime(playbook) }))
    .sort((a, b) => {
      const passedA = a.due !== null && a.due < now - 86_400_000;
      const passedB = b.due !== null && b.due < now - 86_400_000;
      if (passedA !== passedB) return passedA ? 1 : -1;
      const outlook = (OUTLOOK_ORDER[a.playbook.outlook ?? ''] ?? 1.5) - (OUTLOOK_ORDER[b.playbook.outlook ?? ''] ?? 1.5);
      if (outlook !== 0) return outlook;
      if (a.due !== null && b.due !== null && a.due !== b.due) return a.due - b.due;
      if ((a.due === null) !== (b.due === null)) return a.due === null ? 1 : -1;
      return a.index - b.index;
    })
    .map((entry) => entry.playbook);
}

export interface BriefOpportunity {
  rank: number;
  name: string;
  funder?: string;
  award?: string;
  outlook?: string;
  angle: string;
  fit?: string;
  requirements: string[];
  winThemes: string[];
  actions: string[];
  deadlines: string[];
  risks: string[];
  nextMove?: string;
  sources: string[];
}

export interface StrategyBrief {
  title: string;
  date: string;
  summary: string[];
  /** Points that hold across the opportunities, in priority order. */
  priorities: string[];
  opportunities: BriefOpportunity[];
  /** Further opportunities named in one line each, to keep the brief to two pages. */
  alsoConsidered: { name: string; outlook?: string; angle: string }[];
}

const sentence = (text: string): string => {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const capital = clean.charAt(0).toUpperCase() + clean.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
};

const listInWords = (items: string[]): string =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

const nameOf = (playbook: StrategyPlaybook): string => playbook.opportunity || playbook.headline;

function opportunityOf(playbook: StrategyPlaybook, rank: number): BriefOpportunity {
  const outlook = playbook.outlook ? OUTLOOK_WORDS[playbook.outlook] : undefined;
  return {
    rank,
    name: nameOf(playbook),
    ...(playbook.funder ? { funder: playbook.funder } : {}),
    ...(playbook.award ? { award: playbook.award } : {}),
    ...(outlook ? { outlook } : {}),
    angle: sentence(playbook.headline),
    ...(playbook.fit ? { fit: sentence(playbook.fit) } : {}),
    requirements: (playbook.requirements ?? []).slice(0, BRIEF_POINTS).map(sentence),
    winThemes: playbook.winThemes.slice(0, BRIEF_POINTS).map(sentence),
    actions: playbook.actions.slice(0, BRIEF_POINTS).map((action) => {
      const who = action.owner ? ` (${action.owner}${action.when ? `, ${action.when}` : ''})` : action.when ? ` (${action.when})` : '';
      return sentence(`${action.step.replace(/[.!?]$/, '')}${who}`);
    }),
    deadlines: (playbook.deadlines ?? []).slice(0, 3),
    risks: (playbook.risks ?? []).slice(0, 3).map(sentence),
    ...(playbook.nextMove ? { nextMove: sentence(playbook.nextMove) } : {}),
    sources: (playbook.sources ?? []).slice(0, 2),
  };
}

const dateWords = (now: number): string =>
  new Date(now).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

/** The brief for the conversation's playbooks, best first. */
export function buildBrief(playbooks: readonly StrategyPlaybook[], now: number): StrategyBrief {
  const ranked = rankPlaybooks(playbooks, now);
  const full = ranked.slice(0, BRIEF_FULL_LIMIT).map((playbook, index) => opportunityOf(playbook, index + 1));
  const rest = ranked.slice(BRIEF_FULL_LIMIT).map((playbook) => ({
    name: nameOf(playbook),
    ...(playbook.outlook ? { outlook: OUTLOOK_WORDS[playbook.outlook] } : {}),
    angle: sentence(playbook.headline),
  }));

  const summary: string[] = [];
  const lead = full[0];
  if (lead) {
    const count = ranked.length;
    summary.push(
      count === 1
        ? `This brief sets out what a winning proposal for ${lead.name} needs and the steps to get there.`
        : `This brief ranks the ${count} funding opportunities reviewed in this session and sets out what a winning proposal for each one needs.`,
    );
    const strong = full.filter((item) => item.outlook === OUTLOOK_WORDS.strong).map((item) => item.name);
    summary.push(
      count === 1
        ? `${lead.angle}${lead.nextMove ? ` The next move: ${lead.nextMove.charAt(0).toLowerCase()}${lead.nextMove.slice(1)}` : ''}`
        : `Pursue ${lead.name} first. ${lead.angle}${strong.length > 1 ? ` ${listInWords(strong)} are the strongest fits overall.` : ''}`,
    );
    const firstDue = ranked
      .map((playbook) => ({ playbook, due: deadlineTime(playbook) }))
      .filter((entry): entry is { playbook: StrategyPlaybook; due: number } => entry.due !== null && entry.due >= now - 86_400_000)
      .sort((a, b) => a.due - b.due)[0];
    if (firstDue) {
      summary.push(`The nearest deadline is for ${nameOf(firstDue.playbook)}: ${firstDue.playbook.deadlines?.[0] ?? ''}. Confirm every date on the funder's own page before you plan around it.`);
    } else {
      summary.push("Confirm every date and requirement on the funder's own page before you plan around it.");
    }
  }

  // What to start now, in priority order: each opportunity's next move (or its
  // first step), then what each must have in place, without repeats.
  const priorities: string[] = [];
  const seen = new Set<string>();
  const add = (text: string | undefined, name: string) => {
    if (!text) return;
    const key = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    priorities.push(full.length > 1 ? `${text.replace(/[.!?]$/, '')} (${name}).` : text);
  };
  for (const item of full) add(item.nextMove ?? item.actions[0], item.name);
  for (const item of full) {
    const need = item.requirements[0];
    if (need) add(`Have in place: ${need.charAt(0).toLowerCase()}${need.slice(1)}`, item.name);
  }

  return {
    title: 'Funding Strategy Brief',
    date: dateWords(now),
    summary,
    priorities: priorities.slice(0, 5),
    opportunities: full,
    alsoConsidered: rest,
  };
}

const escape = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const bullets = (items: string[]): string =>
  items.length ? `<ul>${items.map((item) => `<li>${escape(item)}</li>`).join('')}</ul>` : '';

const part = (label: string, items: string[]): string =>
  items.length ? `<div class="part"><h4>${escape(label)}</h4>${bullets(items)}</div>` : '';

/**
 * The brief as a printable page: letter size, brand colours, sized to stay
 * within one or two pages. Nothing in it runs script or loads from the web.
 */
export function briefHtml(brief: StrategyBrief, product = 'BulleBrowser'): string {
  const opportunities = brief.opportunities
    .map((item) => {
      const facts = [item.funder ? `Funder: ${item.funder}` : '', item.award ? `Award: ${item.award}` : '', item.deadlines[0] ? `Deadline: ${item.deadlines[0]}` : '']
        .filter(Boolean)
        .map(escape)
        .join(' &nbsp;·&nbsp; ');
      return `<section class="opportunity">
  <div class="head"><span class="rank">${item.rank}</span><h3>${escape(item.name)}</h3>${item.outlook ? `<span class="tag">${escape(item.outlook)}</span>` : ''}</div>
  ${facts ? `<p class="facts">${facts}</p>` : ''}
  <p class="angle">${escape(item.angle)}${item.fit ? ` ${escape(item.fit)}` : ''}</p>
  <div class="grid">
    ${part('What a successful proposal needs', item.requirements)}
    ${part('How to stand out', item.winThemes)}
    ${part('Steps to take', item.actions)}
    ${part('Risks to manage', item.risks)}
  </div>
  ${item.nextMove ? `<p class="next"><strong>Next move:</strong> ${escape(item.nextMove)}</p>` : ''}
</section>`;
    })
    .join('\n');
  const rest = brief.alsoConsidered.length
    ? `<section class="rest"><h2>Also considered</h2><ul>${brief.alsoConsidered
        .map((item) => `<li><strong>${escape(item.name)}</strong>${item.outlook ? ` (${escape(item.outlook)})` : ''}: ${escape(item.angle)}</li>`)
        .join('')}</ul></section>`
    : '';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escape(brief.title)}</title>
<style>
  @page { size: Letter; margin: 0.6in 0.65in; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "DM Sans", "Helvetica Neue", Arial, sans-serif; color: #191825; font-size: 10pt; line-height: 1.42; }
  header { border-bottom: 3px solid #20BAD1; padding-bottom: 8px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: flex-end; }
  header h1 { margin: 0; font-size: 19pt; letter-spacing: -0.01em; }
  header .meta { color: #818891; font-size: 9pt; text-align: right; }
  h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: 0.06em; color: #1A9BAE; margin: 14px 0 6px; }
  .summary p { margin: 0 0 6px; }
  .priorities { background: #EFF7F8; border-left: 4px solid #E8D833; padding: 8px 12px; margin: 10px 0 4px; }
  .priorities ol { margin: 4px 0 0 18px; padding: 0; }
  .priorities li { margin: 2px 0; }
  .opportunity { border: 1px solid #DCE9EC; border-radius: 8px; padding: 10px 12px; margin: 10px 0; page-break-inside: avoid; }
  .head { display: flex; align-items: center; gap: 8px; }
  .head h3 { margin: 0; font-size: 12pt; flex: 1; }
  .rank { background: #20BAD1; color: #fff; border-radius: 50%; width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; font-size: 9pt; font-weight: 700; }
  .tag { background: #071422; color: #fff; border-radius: 10px; padding: 1px 8px; font-size: 8pt; }
  .facts { color: #818891; font-size: 8.5pt; margin: 4px 0 0; }
  .angle { margin: 6px 0; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; }
  .part h4 { margin: 4px 0 2px; font-size: 9pt; color: #1A9BAE; }
  .part ul, .rest ul { margin: 0 0 0 16px; padding: 0; }
  .part li { margin: 1px 0; font-size: 9pt; }
  .next { margin: 6px 0 0; font-size: 9.5pt; }
  .rest li { margin: 2px 0; font-size: 9pt; }
  footer { margin-top: 12px; border-top: 1px solid #DCE9EC; padding-top: 6px; color: #818891; font-size: 8pt; }
</style></head>
<body>
<header><h1>${escape(brief.title)}</h1><div class="meta">${escape(product)}<br>${escape(brief.date)}</div></header>
<section class="summary"><h2>Executive summary</h2>${brief.summary.map((line) => `<p>${escape(line)}</p>`).join('')}</section>
${brief.priorities.length ? `<div class="priorities"><strong>Start with</strong><ol>${brief.priorities.map((line) => `<li>${escape(line)}</li>`).join('')}</ol></div>` : ''}
<h2>Opportunities in priority order</h2>
${opportunities}
${rest}
<footer>Prepared with ${escape(product)} from official funding sources read during this session. Funders decide eligibility and awards; confirm every requirement and date on the funder's own page.</footer>
</body></html>`;
}
