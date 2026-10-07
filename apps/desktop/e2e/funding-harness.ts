// What the funding end-to-end specs share: launching the real app with a
// user-data directory that can be kept between launches, answering the system
// file dialog, standing in for the official sources with answers recorded from
// them, and a scripted assistant.
//
// Nothing here reaches the network. The app runs hidden (see
// playwright.config.ts), so the suite never opens a window or takes focus.

import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
export const appRoot = resolve(here, '..');
export const fixtures = resolve(appRoot, 'test-fixtures/funding');
export const fixture = (...parts: string[]): string => join(fixtures, ...parts);

/** The day the source answers were recorded. Listings keep the status they had then. */
export const RECORDED_AT = Date.UTC(2026, 9, 6, 16, 0, 0);

export interface Launched {
  app: ElectronApplication;
  win: Page;
  userData: string;
  /** The funding workspace, which shares some wording with the assistant panel. */
  workspace: Locator;
  /** The assistant panel. */
  panel: Locator;
}

export function freshUserData(): string {
  return mkdtempSync(join(tmpdir(), 'bullebrowser-funding-e2e-'));
}

export function removeUserData(userData: string): void {
  rmSync(userData, { recursive: true, force: true });
}

/**
 * Starts the app. Pass the same `userData` again to start it as the same
 * person on the same device, which is how persistence between sessions is
 * checked. With `assistantUrl` the app has a key and sends document questions
 * to that address; without it no assistant is connected.
 */
export async function launchApp(options: { userData?: string; assistantUrl?: string; openFunding?: boolean } = {}): Promise<Launched> {
  const userData = options.userData ?? freshUserData();
  const env: Record<string, string> = { ...(process.env as Record<string, string>), NODE_ENV: 'test' };
  // See smoke.spec.ts: with this set, Electron starts as plain Node.
  delete env.ELECTRON_RUN_AS_NODE;
  env.BULLEBROWSER_TEST_HOOKS = '1';
  // Empty rather than absent, so a key in a developer's .env is never picked up.
  env.OPENAI_API_KEY = '';
  env.ANTHROPIC_API_KEY = options.assistantUrl ? 'sk-ant-e2e-fixture-key-not-real-0000000000000000' : '';
  if (options.assistantUrl) env.BULLEBROWSER_ASSISTANT_URL = options.assistantUrl;
  else delete env.BULLEBROWSER_ASSISTANT_URL;

  const app = await electron.launch({
    args: ['.', '--no-sandbox', `--user-data-dir=${userData}`],
    cwd: appRoot,
    env,
  });
  const win = await app.firstWindow({ timeout: 30_000 });
  await win.waitForLoadState('domcontentloaded');
  const workspace = win.getByRole('region', { name: 'Funding workspace' });
  const panel = win.getByRole('complementary', { name: 'Assistant chat' });
  if (options.openFunding !== false) {
    await win.getByRole('button', { name: 'Organization Knowledge Hub', exact: true }).click();
  }
  if (options.openFunding === false) return { app, win, userData, workspace, panel };
  await expect(workspace).toBeVisible({ timeout: 20_000 });
  return { app, win, userData, workspace, panel };
}

/** The next time the app asks for files, these are what the person "chose". */
export async function chooseFiles(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate((_electron, chosen) => {
    const hooks = (globalThis as unknown as { __bbTest: { funding: { answerFileDialog(answer: () => string[]): void } } }).__bbTest;
    hooks.funding.answerFileDialog(() => chosen);
  }, paths);
}

/** Resolves once no document is waiting to be read. */
export async function documentsRead(app: ElectronApplication): Promise<void> {
  await app.evaluate(async () => {
    const hooks = (globalThis as unknown as { __bbTest: { funding: { whenIdle(): Promise<void> } } }).__bbTest;
    await hooks.funding.whenIdle();
  });
}

interface RecordedListing {
  id: string;
  record: Record<string, unknown>;
}

function recordedListings(): RecordedListing[] {
  const folder = fixture('sources', 'grants-gov');
  return readdirSync(folder)
    .filter((name) => /^detail-\d+\.json$/.test(name))
    .map((name) => {
      const recorded = JSON.parse(readFileSync(join(folder, name), 'utf8')) as { response: { data: Record<string, unknown> } };
      return { id: String(recorded.response.data.id), record: recorded.response.data };
    });
}

/**
 * Replaces the network for official sources. Grants.gov answers from the
 * records in test-fixtures (applying the status, keyword, applicant and
 * category parts of a search as the real service does); every other source is
 * unreachable, which is how a failed source is shown. The date is held at the
 * day of recording.
 */
export async function standInForSources(app: ElectronApplication): Promise<void> {
  await app.evaluate(
    (_electron, { listings, recordedAt }) => {
      type Json = Record<string, unknown>;
      const hooks = (
        globalThis as unknown as {
          __bbTest: {
            funding: {
              setSourceFetch(stand: (url: string, init?: RequestInit) => Promise<Response>): void;
              setListingClock(time: number): void;
            };
          };
        }
      ).__bbTest.funding;

      const answer = (body: unknown) =>
        new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      const part = (record: Json): Json => ((record.synopsis ?? record.forecast ?? {}) as Json);
      // "2026-11-02-00-00-00" as the search service writes a date: "11/02/2026".
      const shortDate = (stamp: unknown): string => {
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof stamp === 'string' ? stamp : '');
        return match ? `${match[2]}/${match[3]}/${match[1]}` : '';
      };
      const codes = (list: unknown): string[] =>
        Array.isArray(list) ? list.map((item) => String((item as Json).id ?? '')) : [];

      const rowFor = ({ id, record }: { id: string; record: Json }): Json => {
        const detail = part(record);
        return {
          id,
          number: record.opportunityNumber ?? '',
          title: record.opportunityTitle ?? '',
          agencyCode: record.owningAgencyCode ?? '',
          agency: detail.agencyName ?? '',
          openDate: shortDate(detail.postingDateStr),
          closeDate: shortDate(detail.responseDateStr ?? detail.estApplicationResponseDateStr),
          oppStatus: String(record.ost ?? '').toLowerCase(),
          docType: record.docType ?? 'synopsis',
          cfdaList: [],
        };
      };

      hooks.setListingClock(recordedAt);
      hooks.setSourceFetch(async (url, init) => {
        const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Json) : {};
        if (url === 'https://api.grants.gov/v1/api/search2') {
          const statuses = String(body.oppStatuses ?? '').split('|');
          const terms = String(body.keyword ?? '')
            .split(' AND ')
            .map((term) => term.trim().toLowerCase())
            .filter(Boolean);
          const wantedApplicants = String(body.eligibilities ?? '').split('|').filter(Boolean);
          const wantedCategories = String(body.fundingCategories ?? '').split('|').filter(Boolean);
          const matching = listings.filter(({ record }) => {
            const detail = part(record);
            const text = `${String(record.opportunityTitle ?? '')} ${String(detail.synopsisDesc ?? detail.forecastDesc ?? '')}`.toLowerCase();
            return (
              statuses.includes(String(record.ost ?? '').toLowerCase()) &&
              terms.every((term) => text.includes(term)) &&
              (wantedApplicants.length === 0 || codes(detail.applicantTypes).some((code) => wantedApplicants.includes(code))) &&
              (wantedCategories.length === 0 ||
                codes(detail.fundingActivityCategories).some((code) => wantedCategories.includes(code)))
            );
          });
          return answer({
            errorcode: 0,
            msg: 'Webservice Succeeds',
            data: {
              searchParams: {
                resultType: 'json',
                searchOnly: false,
                oppNum: '',
                cfda: '',
                sortBy: body.sortBy ?? '',
                oppStatuses: body.oppStatuses ?? '',
                startRecordNum: body.startRecordNum ?? 0,
                eligibilities: body.eligibilities ?? '',
                fundingInstruments: '',
                fundingCategories: body.fundingCategories ?? '',
                agencies: '',
                rows: body.rows ?? 0,
                keyword: body.keyword ?? '',
                keywordEncoded: false,
              },
              hitCount: matching.length,
              startRecord: 0,
              oppHits: matching.map(rowFor),
              oppStatusOptions: ['posted', 'forecasted', 'closed', 'archived'].map((value) => ({
                label: value,
                value,
                count: listings.filter(({ record }) => String(record.ost ?? '').toLowerCase() === value).length,
              })),
              suggestion: '',
              accessKey: '',
              errorMsgs: [],
            },
          });
        }
        if (url === 'https://api.grants.gov/v1/api/fetchOpportunity') {
          const found = listings.find(({ id }) => id === String(body.opportunityId));
          return answer({
            errorcode: 0,
            msg: 'Webservice Succeeds',
            data: found ? found.record : { revision: 0, errorMessages: ['There is no record found for your search.'] },
          });
        }
        // Every other source is out of reach for the suite.
        return new Response('Service unavailable', { status: 503 });
      });
    },
    { listings: recordedListings(), recordedAt: RECORDED_AT },
  );
}

/** One question the app put to the assistant, as the scripted assistant saw it. */
export interface AssistantRequest {
  system: string;
  /** The sealed reference material: everything that came from a document. */
  documents: string;
  task: string;
  /** The schema the answer has to follow. */
  schema: Record<string, unknown>;
}

export interface ScriptedAssistant {
  url: string;
  requests: AssistantRequest[];
  close(): Promise<void>;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
    request.on('error', fail);
  });
}

const textOf = (content: unknown): string[] =>
  typeof content === 'string'
    ? [content]
    : Array.isArray(content)
      ? content.map((block) => String((block as { text?: unknown }).text ?? ''))
      : [];

/**
 * An assistant that answers each question with whatever `reply` returns, in
 * the form the provider streams it. It records every question, so a spec can
 * check what was sent and, just as important, what was not.
 */
export async function scriptedAssistant(reply: (request: AssistantRequest) => unknown): Promise<ScriptedAssistant> {
  const requests: AssistantRequest[] = [];
  const server: Server = createServer((request, response) => {
    void (async () => {
      const body = JSON.parse(await readBody(request)) as {
        model?: string;
        system?: unknown;
        messages?: { content: unknown }[];
        output_config?: { format?: { schema?: Record<string, unknown> } };
      };
      const parts = textOf(body.messages?.at(-1)?.content);
      const asked: AssistantRequest = {
        system: textOf(body.system).join('\n') || String(body.system ?? ''),
        documents: parts[0] ?? '',
        task: parts.slice(1).join('\n'),
        schema: body.output_config?.format?.schema ?? {},
      };
      requests.push(asked);
      const text = JSON.stringify(reply(asked));
      const events: [string, unknown][] = [
        [
          'message_start',
          {
            type: 'message_start',
            message: {
              id: `msg_${requests.length}`,
              type: 'message',
              role: 'assistant',
              model: body.model ?? 'scripted',
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
            },
          },
        ],
        ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } }],
        ['message_stop', { type: 'message_stop' }],
      ];
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''));
    })().catch((error: unknown) => {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: String(error) } }));
    });
  });
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((closed) => server.close(() => closed())),
  };
}

/** A passage as the app shows it to the assistant: its id, where it is, and its text. */
export interface ShownPassage {
  id: string;
  text: string;
}

/** The passages in a sealed block of reference material, in order. */
export function passagesIn(documents: string): ShownPassage[] {
  const found: ShownPassage[] = [];
  for (const line of documents.split('\n')) {
    const match = /^\[([A-Z]{1,2}\d{1,3}:b\d{1,6})\](?: \([^)]*\))? (?:# )?(.+)$/.exec(line);
    if (match?.[1] && match[2]) found.push({ id: match[1], text: match[2] });
  }
  return found;
}

/** The first passage containing the words, or a clear failure naming what was looked for. */
export function passageWith(documents: string, words: string): ShownPassage {
  const found = passagesIn(documents).find((passage) => passage.text.includes(words));
  if (!found) throw new Error(`No passage shown to the assistant contains "${words}".`);
  return found;
}
