import type { TaskRunLog } from './ipc.js';
import type { AgentStepEvent } from './agent-events.js';

export interface TaskSource { url: string; title: string; excerpt: string; read: boolean }

// An http(s) page address safe to show and export, or null.
function cleanUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    // Keep signed URLs and credentials out of reports and link tooltips.
    for (const key of [...url.searchParams.keys()]) if (/token|key|secret|signature|credential|auth|code/i.test(key)) url.searchParams.set(key, '[redacted]');
    return url;
  } catch {
    return null;
  }
}

/** A navigation is not evidence. Only nonempty page reads earn the Read marker. */
export function taskSources(steps: readonly AgentStepEvent[]): TaskSource[] {
  const sources = new Map<string, TaskSource>();
  for (const step of steps) {
    if (step.kind !== 'source' && (step.kind !== 'tool_result' || !['navigate', 'new_tab', 'read_page'].includes(step.toolName))) continue;
    const output = (step.kind === 'source' ? step : step.output) as { url?: unknown; title?: unknown; text?: unknown } | null;
    if (typeof output?.url !== 'string') continue;
    const url = cleanUrl(output.url);
    if (!url) continue;
    const prior = sources.get(url.href);
    const read = (step.kind === 'source' || step.toolName === 'read_page') && typeof output.text === 'string' && !!output.text.trim();
    sources.set(url.href, {
      url: url.href,
      title: typeof output.title === 'string' ? output.title.slice(0, 160) : prior?.title ?? url.hostname,
      excerpt: read ? String(output.text).slice(0, 400) : prior?.excerpt ?? '',
      read: read || prior?.read || false,
    });
  }
  return [...sources.values()];
}

export interface PageInstructionWarning {
  /** Cleaned page address, or a label such as "web search results". */
  source: string;
  /** What to show: the page's host, or the label. */
  label: string;
  excerpt: string;
  signals: string[];
}
/** Pages whose text tried to instruct the AI, one entry per source. */
export function pageInstructionWarnings(steps: readonly AgentStepEvent[]): PageInstructionWarning[] {
  const warnings = new Map<string, PageInstructionWarning>();
  for (const step of steps) {
    if (step.kind !== 'page_instructions') continue;
    const isUrl = /^https?:/i.test(step.source);
    const url = isUrl ? cleanUrl(step.source) : null;
    // An address that fails cleaning (it embeds credentials) is never shown.
    const source = url ? url.href : isUrl ? 'a page' : step.source.slice(0, 120) || 'a page';
    if (warnings.has(source)) continue;
    warnings.set(source, { source, label: url ? url.hostname : source, excerpt: step.excerpt.slice(0, 400), signals: step.signals });
  }
  return [...warnings.values()];
}
export function taskReport(steps: readonly AgentStepEvent[], audit?: Pick<TaskRunLog, 'calls' | 'consents'>): string {
  const lines = ['# BulleBrowser task report', '', '## Sources', ''];
  for (const source of taskSources(steps)) lines.push(`- ${source.read ? 'Read' : 'Opened, unverified'}: <${source.url}>`, ...(source.excerpt ? ['', ...source.excerpt.split('\n').map((line) => '> ' + line), ''] : []));
  const warnings = pageInstructionWarnings(steps);
  if (warnings.length) {
    lines.push('', '## Page instructions ignored', '', 'This text read like instructions to the AI. It was treated as page data and not followed.', '');
    for (const warning of warnings) lines.push(`- ${/^https?:/.test(warning.source) ? `<${warning.source}>` : warning.source}`, '', `> ${warning.excerpt}`, '');
  }
  lines.push('', '## Timeline', '');
  for (const step of steps) {
    if (step.kind === 'thinking') continue;
    if (step.kind === 'tool_call') lines.push(`- ${new Date(step.ts).toISOString()} ${step.callId ?? ''} ${step.toolName}: started`);
    else if (step.kind === 'tool_result') lines.push(`- ${new Date(step.ts).toISOString()} ${step.callId ?? ''} ${step.toolName}: returned${step.durationMs !== undefined ? ` (${step.durationMs} ms)` : ''}`);
    else if (step.kind === 'error') lines.push(`- ${new Date(step.ts).toISOString()} ${step.code ?? 'ERROR'}: ${step.message}`);
  }
  const answer = [...steps].reverse().find((step) => step.kind === 'text');
  if (answer?.kind === 'text') lines.push('', '## Final assistant text', '', answer.text);
  if (audit) {
    lines.push('', '## Consent events', '');
    for (const event of audit.consents) lines.push(`- ${new Date(event.at).toISOString()} ${event.kind}: ${event.approved ? 'approved' : 'declined'}`);
    lines.push('', '## Tool audit (redacted, bounded results)', '', '```json', JSON.stringify(audit.calls ?? [], null, 2).replace(/`/g, '\u0060'), '```');
  }
  return lines.join('\n') + '\n';
}

/** Export bounded audit records, never raw page bodies or private thinking. */
export function taskAuditJson(steps: readonly AgentStepEvent[], audit: Pick<TaskRunLog, 'calls' | 'consents'>): string {
  return JSON.stringify({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    scope: 'Redacted tool records with bounded results; not a full page recording',
    sources: taskSources(steps),
    pageInstructions: pageInstructionWarnings(steps).map(({ source, excerpt, signals }) => ({ source, excerpt, signals })),
    calls: audit.calls ?? [],
    consents: audit.consents,
    timeline: steps.flatMap((step) => step.kind === 'tool_call' || step.kind === 'tool_result'
      ? [{ at: step.ts, kind: step.kind, callId: step.callId, toolName: step.toolName,
        ...(step.kind === 'tool_result' ? { durationMs: step.durationMs } : {}) }]
      : []),
  }, null, 2) + '\n';
}
