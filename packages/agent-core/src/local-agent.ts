import { isResearchRequest } from './research.js';
import type { ToolCallOutcome } from './agent-loop.js';
import { StepBudget } from './budget.js';
import type { AgentInput } from './types.js';
import { AGENT_IDENTITY, protectAssistantIdentity } from './product-identity.js';
import { FUNDING_SCREENS, applyTerminology } from './terminology.js';
import { isBlockedDestination } from './destinations.js';
import { isFundingDiscoveryRequest, isGrantSearchService } from './funding-sources.js';
import { requestIntent } from './intent.js';

type Call = (name: string, input: Record<string, unknown>) => Promise<ToolCallOutcome>;

// Funding work needs written analysis, which the keyless assistant cannot do.
// Rather than answer with the list of browser commands — or with a summary of
// whatever page is open — it says so, and names the screen that still helps.
type FundingWork = 'guide' | 'alignment' | 'priorities' | 'opportunities' | 'knowledge' | 'general';

const NO_ASSISTANT =
  'needs a connected assistant for the written analysis, and none is connected. You can connect one in Settings.';

const FUNDING_REPLIES: Record<FundingWork, string> = {
  opportunities:
    `Finding funding opportunities and writing up which ones fit ${NO_ASSISTANT} ` +
    `Without one, the ${FUNDING_SCREENS.opportunities} screen still searches official sources: you can filter by ` +
    'place, applicant type, category, award amount and deadline, and every listing is labelled Active, Expired ' +
    'or Unverified.',
  alignment:
    `Assessing how your organization aligns with a funding opportunity ${NO_ASSISTANT} ` +
    `Without one, you can still compare the two yourself: the ${FUNDING_SCREENS.knowledgeHub} screen searches your ` +
    `uploaded documents and shows the matching passages word for word, and the ${FUNDING_SCREENS.rfpAnalysis} ` +
    'screen lists the dates, amounts and requirements it finds in a funding document.',
  priorities:
    `Explaining what a funder is asking for ${NO_ASSISTANT} ` +
    `Without one, the ${FUNDING_SCREENS.rfpAnalysis} screen still reads a funding document you upload and lists ` +
    'the text it matches for dates, amounts and requirements.',
  guide:
    `Building a proposal guide around your organization and a funder, or giving feedback on a draft, ${NO_ASSISTANT} ` +
    `Without one, the ${FUNDING_SCREENS.proposalGuide} screen still offers the standard guide: an outline with ` +
    'reflective questions for you to answer in your own words.',
  knowledge:
    `Answering questions about your organization from its documents ${NO_ASSISTANT} ` +
    `Without one, the ${FUNDING_SCREENS.knowledgeHub} screen still searches your uploaded documents and shows the ` +
    'matching passages word for word.',
  general:
    `Answering a funding question ${NO_ASSISTANT} ` +
    `Without one, four screens still work: ${FUNDING_SCREENS.knowledgeHub} searches your uploaded documents and ` +
    `shows the matching passages word for word; ${FUNDING_SCREENS.opportunities} searches official sources with ` +
    `filters and labels every listing Active, Expired or Unverified; ${FUNDING_SCREENS.rfpAnalysis} lists the ` +
    `dates, amounts and requirements it finds in a funding document; and ${FUNDING_SCREENS.proposalGuide} offers ` +
    'the standard guide.',
};

// Added when the request read like "summarize …", so the user knows how to get
// the one summary that does work here.
const PAGE_SUMMARY_HINT =
  ' If the document is open in a tab, ask me to "summarize this page" and I will show its opening sentences.';

const HELP =
  'I can summarize the current page, list tabs, show page details, open a URL, list links, extract page data, ' +
  'click "a target", or type "text" into "a field". Funding questions need a connected assistant for a written ' +
  `answer; without one, the ${FUNDING_SCREENS.knowledgeHub}, ${FUNDING_SCREENS.opportunities}, ` +
  `${FUNDING_SCREENS.rfpAnalysis} and ${FUNDING_SCREENS.proposalGuide} screens still work.`;

const CAPABILITIES =
  'I can browse the web for you and answer your questions. For example:\n\n' +
  '- **Browse:** "Find youth workforce grants in New Jersey". I search, open the best sources in tabs and read them.\n' +
  '- **Ask:** "What is a 501(c)(3)?" I look it up and show you what the sources say.\n' +
  '- **This page:** "Summarize this page" or "List the links on this page".\n' +
  '- **Act:** "Open grants.gov", click "a button", or type "text" into "a field".\n\n' +
  'What would you like to do?';

/** A reply to conversation: greetings, thanks, "what can you do?". */
function chatReply(message: string): string {
  const text = message.trim().toLowerCase();
  if (/^(?:bye|goodbye|see you|good night)\b/.test(text)) {
    return 'Goodbye! This conversation stays in History whenever you want to pick it up again.';
  }
  if (/\b(?:thank|thanks|ty|cheers|you rock|the best|great|awesome|perfect|nice|cool)\b/.test(text)) {
    return "You're welcome! What would you like to look into next?";
  }
  if (/^(?:ok(?:ay)?|got it|sounds good)\b/.test(text)) return 'Great. What would you like to do next?';
  if (/how are you|how's it going|what's up/.test(text)) return "I'm doing well and ready to help! What would you like me to look up or browse?";
  if (/^(?:hi|hello|hey|hiya|yo|good (?:morning|afternoon|evening|day))\b/.test(text) || !text) {
    return `Hi! I'm ${AGENT_IDENTITY}. ${CAPABILITIES}`;
  }
  return CAPABILITIES;
}

// Writing and editing are not lookups; searching for "write a novel" would not help.
const WRITING_REQUEST = /^(?:please\s+)?(?:(?:can|could|would) you\s+)?(?:write|draft|compose|create|generate|rewrite|edit|proofread|translate)\b/i;
// "Is this a good fit?" points at something not named in the message.
const VAGUE_QUESTION = /^(?:is|are|was|were|does|do|did|can|could|should|would|will)\s+(?:this|that|it|these|those|they)\b/i;

const QUESTION_STOPWORDS = new Set(('a an and are as at be between by can could define describe difference do does for from get ' +
  'has have how i in is it its me my of on or our please should tell that the their there they this to us was we what ' +
  "what's when where which who why will with would you your about explain").split(' '));

function keywords(text: string): string[] {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !QUESTION_STOPWORDS.has(word));
  return [...new Set(words.map((word) => word.replace(/(?:ies)$/, 'y').replace(/(?<=[a-z]{3})s$/, '')))];
}

/** The page's sentences that best match the question, in page order. */
export function relevantPassages(text: string, words: string[], max = 3): string[] {
  if (!words.length) return [];
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 40 && sentence.length <= 360 && !/cookie|javascript|sign in|log in|subscribe/i.test(sentence));
  const needed = Math.min(2, words.length);
  const scored = sentences.map((sentence, index) => {
    const lower = sentence.toLowerCase();
    return { sentence, index, score: words.filter((word) => lower.includes(word)).length };
  }).filter((entry) => entry.score >= needed);
  const seen = new Set<string>();
  return scored.sort((a, b) => b.score - a.score || a.index - b.index)
    .filter((entry) => !seen.has(entry.sentence) && seen.add(entry.sentence))
    .slice(0, max)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.sentence);
}

const SUMMARY_COMMAND = /^(?:please\s+)?(?:summari[sz]e|summary|read|what (?:does this page say|is this page about))\b/i;

// The keyless command runner cannot infer arbitrary follow-ups. Resolve only
// explicit retries from the user's own turns, never from page/assistant text.
const RETRY = /^(?:please\s+)?(?:try again|retry|continue|carry on|resume|do that again)(?:\s+please)?[.!?]*$/i;
function localRequest(input: AgentInput): string {
  const latest = (input.userRequest ?? input.userMessage).trim();
  if (!RETRY.test(latest)) return latest;
  const previous = [...input.history].reverse().find((turn) => turn.role === 'user' && !RETRY.test(turn.content.trim()));
  const request = previous?.content.trim();
  // Never replay a potentially consequential command automatically. Research
  // is limited below to simple discovery requests, not arbitrary task text.
  if (request && (/^(?:please\s+)?(?:summari[sz]e|summary|read|list|show)\b/i.test(request)
    || /^(?:please\s+)?(?:find|search(?: for)?|look for)\b/i.test(request))
    && !/\b(?:submit|send|pay|buy|purchase|delete|remove|upload|download|click|type|enter|apply)\b/i.test(request)) return request;
  return latest;
}

// "this page", "the current tab", "what I'm looking at": the tab in front of
// the user. "The page limits in this RFP" is not a reference to it.
const CURRENT_PAGE =
  /\b(?:this|current|open|active)\s+(?:web\s?)?(?:page|tab|site|website|window)\b|\bthe\s+(?:web\s?)?(?:page|tab)(?=\s*(?:[?.!,;:]|$)|\s+(?:please|for|and|in|i|that|which|here|now|again|briefly|quickly)\b)|\bon\s+(?:my\s+|the\s+)?screen\b|\b(?:i'?m|i\s+am|we'?re|we\s+are)\s+(?:looking\s+at|viewing|reading)\b/i;

const FUNDING_TOPIC =
  /\b(?:grants?|fund(?:s|ed|ing|ers?)?|rf[paqi]s?|nof[oa]s?|foas?|solicitations?|proposals?|awards?|opportunit(?:y|ies)|cbos?|nonprofits?)\b/i;
// The same, without the words that are as common outside funding ("job
// opportunities", "an award-winning film").
const FUNDING_SUBJECT = /\b(?:grants?|grant\s?(?:making|writing)|funding|funders?|rf[paq]s?|nof[oa]s?|foas?|solicitations?|cbos?|nonprofits?)\b/i;
const OUR_ORGANIZATION = /\b(?:we|us|our|ours|my|i|organi[sz]ation|business|company|nonprofit|cbo)\b/i;

const WRITING =
  '(?:writ(?:e|ing)|draft(?:ing)?|outlin(?:e|ing)|revis(?:e|ing)|rewrit(?:e|ing)|edit(?:ing)?|improv(?:e|ing)|strengthen(?:ing)?|polish(?:ing)?|proofread(?:ing)?|critiqu(?:e|ing)|review(?:ing)?|feedback|structur(?:e|ing)|prepar(?:e|ing)|start(?:ing)?|begin(?:ning)?|work(?:ing)?\\s+on|help\\s+(?:me|us)\\s+with)';
const WRITTEN =
  '(?:proposals?|narratives?|needs\\s+statements?|statements?\\s+of\\s+need|letters?\\s+of\\s+(?:intent|inquiry|interest|support)|lois?|cover\\s+letters?|budget\\s+(?:narrative|justification)s?|abstracts?|executive\\s+summar(?:y|ies)|logic\\s+models?|applications?|case\\s+for\\s+support|drafts?)';
// "Review the application requirements" asks about the funder's rules, not
// about the user's own writing.
const FUNDER_RULES = '(?:requirements?|guidelines?|instructions?|process|deadlines?|portal|criteria|questions?|forms?|package|checklist|rules|steps)';
// How far apart, within one sentence, a verb and its object may stand.
const NEARBY = '[^.?!\\n]{0,120}?';
const GUIDE = new RegExp(
  '\\bproposal\\s+guide\\b|\\bstrengths[- ]based\\b|\\breflective\\s+questions?\\b' +
    `|\\b${WRITING}\\b${NEARBY}\\b${WRITTEN}\\b(?!\\s+${FUNDER_RULES}\\b)` +
    `|\\b${WRITTEN}\\b${NEARBY}\\b(?:feedback|critique)\\b`,
  'i',
);

const ALIGNMENT =
  /\balign(?:ment|ed|s|ing)?\b|\b(?:good|strong|right|best|close|poor|bad)\s+(?:fit|match)\b|\bfit\s+(?:for|with)\b|\bfits?\s+(?:us|our|my)\b|\b(?:we|i|our\s+\w+|my\s+\w+)\s+(?:(?:would|might|may|could|still|even)\s+)?qualif(?:y|ies)\b|\bshould\s+(?:we|i)\s+apply\b|\bworth\s+applying\b|\b(?:are|is|am|would)\s+(?:we|i|our\s+\w+|my\s+\w+)\s+(?:be\s+)?eligible\b|\b(?:our|my)\s+eligibility\b|\bstrengths\s+and\s+gaps\b|\bgap\s+analysis\b|\bhow\s+competitive\b/i;

// One named funding document: "this RFP", "the NOFA". The plural ("find RFPs
// for …") is a search and belongs to the finder.
const FUNDING_DOCUMENT =
  /\b(?:rf[paqi]|nof[oa]|foa|solicitation|funding\s+(?:notice|announcement|document)|notice\s+of\s+funding|request\s+for\s+(?:proposals?|applications?|qualifications|quotes?)|grant\s+(?:document|guidelines|announcement|notice|agreement)|(?:application|program|funding)\s+guidelines|call\s+for\s+proposals)\b/i;
const FUNDER =
  /\bfunders?\b|\bgrant\s?makers?\b|\b(?:evaluation|scoring|review|selection)\s+criteria\b|\bscoring\s+rubric\b|\b(?:this|the|that)\s+(?:grant|opportunity|listing|award|notice|announcement)\b/i;

const SEEKING =
  '(?:find|search(?:ing)?|look(?:ing)?\\s+for|show|list|discover|identify|recommend|suggest|get|need|want|seek(?:ing)?|are\\s+there|is\\s+there|where\\s+can)';
// A search for listings, in the plural: "find grants …", "which funders …".
const SEARCH = new RegExp(
  `\\b${SEEKING}\\b${NEARBY}\\b(?:grants|funders|opportunities|rfps|rfas|nofos|nofas|solicitations)\\b` +
    '|\\b(?:what|which)\\s+(?:\\w+\\s+){0,2}?(?:grants|funders|opportunities|rfps|solicitations)\\b' +
    '|\\bwho\\s+(?:funds|would\\s+fund|might\\s+fund|gives\\s+grants|offers\\s+grants)\\b',
  'i',
);
// Looser signs of the same: "funding for a food pantry", "any grant for …".
const SEEKING_FUNDING = new RegExp(
  `\\b${SEEKING}\\b${NEARBY}\\b(?:funding|awards|(?:a|an|any|some|another|new|more|other)\\s+(?:\\w+\\s+){0,2}?(?:grant|funder|opportunity|rfp|solicitation))\\b` +
    '|\\b(?:what|which)\\s+(?:\\w+\\s+){0,2}?funding\\b' +
    '|\\b(?:grants?|funding)\\s+(?:for|to|available)\\b|\\bfunding\\s+(?:sources?|options?)\\b',
  'i',
);

const KNOWLEDGE =
  /\bknowledge\s+hub\b|\b(?:organi[sz]ation(?:'s|al)?|approved|our)\s+profile\b|\buploaded\s+(?:documents?|files?)\b|\b(?:our|my)\s+(?:\w+\s+){0,2}?(?:documents?|strategic\s+plan|impact\s+report|annual\s+report|budget|mission|programs?|proposals?|applications?|narratives?)\b/i;

// The most specific reading wins: writing help; a search for listings; the
// organization's fit; one named document; funding sought in looser words; the
// funder in general; the organization's own documents; and last anything else
// that is plainly about funding.
function fundingWork(request: string): FundingWork | null {
  if (GUIDE.test(request)) return 'guide';
  if (SEARCH.test(request)) return 'opportunities';
  if (ALIGNMENT.test(request) && (FUNDING_TOPIC.test(request) || OUR_ORGANIZATION.test(request))) return 'alignment';
  if (FUNDING_DOCUMENT.test(request)) return 'priorities';
  if (SEEKING_FUNDING.test(request)) return 'opportunities';
  if (FUNDER.test(request)) return 'priorities';
  if (KNOWLEDGE.test(request)) return 'knowledge';
  if (FUNDING_SUBJECT.test(request)) return 'general';
  return null;
}

// The original local-first assistant used explicit commands and extractive
// summaries. Keep that capability without pretending to be a cloud model.
export async function runLocalAgent(input: AgentInput, call: Call): Promise<string> {
  // The user's own words. Text the host attached must not turn "list tabs"
  // into an unknown request, or a browser command into funding work.
  const message = localRequest(input);
  const intent = requestIntent(message, input.browserTask ? { browserTask: input.browserTask } : {});
  let report: string;
  const budget = new StepBudget(input.budget);
  const run = async (name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
    if (input.context.signal.aborted) throw new Error('cancelled');
    if (!budget.charge(name).ok) throw new Error('Step budget exhausted.');
    const result = await call(name, args);
    if (input.context.signal.aborted) throw new Error('cancelled');
    if (result.isError) throw new Error(result.errorMessage ?? 'The requested action could not complete. Check the task activity for details.');
    // executeToolCall contains and neutralizes page data for cloud callers.
    // Local commands consume it only as data, never as another instruction.
    // The output itself: the text is shortened on a long page, and parsing it
    // ended the task with "Unexpected end of JSON input".
    if (result.data && typeof result.data === 'object') return result.data as Record<string, unknown>;
    const data = result.text.replace(/^<untrusted_page_data[^>]*>\n/, '').replace(/\n<\/untrusted_page_data>$/, '');
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      throw new Error(`The ${name.replace(/_/g, ' ')} result could not be read in full. Try a narrower request.`);
    }
  };
  const navigate = message.match(/^(?:please\s+)?(?:open|go to|navigate to)\s+(\S+)\s*$/i);
  const click = message.match(/^(?:please\s+)?(?:click|tap|press)\s+["']([^"']+)["']\s*$/i);
  const type = message.match(/^(?:please\s+)?(?:type|enter)\s+["']([^"']*)["']\s+(?:into|in)\s+["']([^"']+)["']\s*$/i);
  // "Summarize this RFP" names a document, not the tab: a summary of whatever
  // page happens to be open would be a wrong answer that looks right. The page
  // is summarized when the request plainly means it, or is not funding work.
  const summaryRequested = SUMMARY_COMMAND.test(message);
  const funding = fundingWork(message);
  const summarizeOpenPage = summaryRequested && (CURRENT_PAGE.test(message) || !funding);
  if (navigate) {
    const page = await run('navigate', { url: navigate[1] });
    report = `Opened ${String(page.title ?? '')}\n${String(page.url ?? '')}`;
  } else if (/^(?:please\s+)?(?:list|show|what)\s+(?:are\s+)?(?:the\s+)?(?:open\s+)?tabs\??$/i.test(message)) {
    const result = await run('listTabs');
    const tabs = result.tabs as Array<{ title: string; url: string }>;
    report = tabs.length ? tabs.map((tab) => `${tab.title}\n${tab.url}`).join('\n\n') : 'There are no open tabs.';
  } else if (/^(?:show\s+)?(?:page details|metadata|title|url of this page)\??$/i.test(message)) {
    const page = await run('getPageMetadata');
    report = `${String(page.title ?? '')}\n${String(page.url ?? '')}`;
  } else if (/^(?:please\s+)?(?:list|show)\s+(?:the\s+)?links(?: on (?:this|the) page)?\s*$/i.test(message)) {
    const result = await run('listLinks');
    const links = result.links as Array<{ text: string; href: string }>;
    report = links.length ? links.slice(0, 50).map((link) => `${link.text}\n${link.href}`).join('\n\n') : 'No links were found.';
  } else if (/^(?:please\s+)?extract(?:\s+(?:structured\s+)?(?:page\s+)?data)?(?:\s+(?:from\s+)?(?:this|the)\s+page)?\s*$/i.test(message)) {
    const result = await run('extract', { schema: {
      type: 'object', properties: { title: { type: 'string' }, keyPoints: { type: 'array', items: { type: 'string' } } }, required: ['title'],
    } });
    report = JSON.stringify(result.data, null, 2);
  } else if (click) {
    await run('click', { target: click[1] });
    report = `Clicked "${click[1]}".`;
  } else if (type) {
    await run('type', { target: type[2], text: type[1] });
    report = `Entered text into "${type[2]}".`;
  } else if (summarizeOpenPage) {
    const page = await run('read_page');
    const result = await run('summarizePage', { text: String(page.text ?? ''), sourceUrl: String(page.url ?? '') });
    report = result.summary ? `${String(result.summary)}\n\nSource: ${String(page.url ?? '')}` : 'This page has no readable text to summarize.';
  } else if (input.browserTask || (input.researchMode && isResearchRequest(message))) {
    input.onStep({ type: 'thinking', detail: 'Opening relevant options in the browser…' });
    const explicitUrls = message.match(/https?:\/\/[^\s<>]+/g) ?? [];
    const exploring = input.browserTask === 'explore_page' || (!input.browserTask && (CURRENT_PAGE.test(message) || explicitUrls.length > 0));
    const query = input.browserTask === 'find_grants' ? `open grants funding ${message}`
      : input.browserTask === 'research_funder' ? `${message} official grants programs eligibility`
      : input.browserTask === 'compare_grants' ? `grants funding eligibility ${message}` : message;
    if (exploring && explicitUrls[0]) await run('navigate', { url: explicitUrls[0] });
    const search = !exploring ? await run('web_search', { query, count: 10 }) : null;
    const firstPage = exploring ? await run('read_page') : { url: '', text: '' };
    if (exploring && !String(firstPage.text ?? '').trim()) {
      report = 'There is no readable page open. Enter a website URL and I’ll explore it.';
    } else {
      const found = search ? { links: (Array.isArray(search.results) ? search.results : []).map((r) => ({ href: r.url, text: r.title })) } : await run('listLinks');
      const links = Array.isArray(found.links) ? found.links as Array<{ text?: string; href?: string }> : [];
      const base = String(firstPage.url || 'https://search.invalid/');
      const candidates = new Map<string, number>();
      const words = message.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3);
      for (const link of [...explicitUrls.map((href) => ({ href, text: message })), ...links]) {
        try {
          const url = new URL(link.href ?? '', base);
          if ((isFundingDiscoveryRequest(message) || ['find_grants', 'research_funder', 'compare_grants'].includes(input.browserTask ?? '')) && isGrantSearchService(url)) continue;
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || isBlockedDestination(url) || /(^|\.)(?:google\.[a-z.]+|bing\.com)$/.test(url.hostname)) continue;
          if (/\b(?:privacy|cookies?|login|sign in|terms of use)\b/i.test(link.text ?? '')) continue;
          url.hash = '';
          const label = `${link.text ?? ''} ${url.href}`.toLowerCase();
          const score = words.filter((word) => label.includes(word)).length + (/\b(?:grant|funding|eligibility|program|application)/i.test(label) ? 2 : 0);
          candidates.set(url.href, Math.max(candidates.get(url.href) ?? 0, score));
        } catch { /* Ignore unusable links. */ }
      }
      const options: Array<{ id: string; url: string }> = [];
      const readUrls = new Set<string>();
      const ranked = [...candidates].sort((a, b) => b[1] - a[1]).slice(0, 10);
      for (const [url] of ranked) {
        if (options.length >= 6 || budget.used + 3.5 > budget.total) break;
        try {
          const tab = await run('new_tab', { url });
          const page = await run('read_page', { tabId: String(tab.id) });
          const sourceUrl = String(page.url ?? url).replace(/#.*$/, '');
          if (String(page.text ?? '').trim() && !readUrls.has(sourceUrl)) {
            readUrls.add(sourceUrl);
            options.push({ id: String(tab.id), url: sourceUrl });
          }
        } catch (error) {
          if (input.context.signal.aborted || /USER_DECLINED|cancelled|budget/i.test(String(error))) throw error;
          // A blocked source must not prevent checking the remaining results.
        }
      }
      if (options[0]) await run('switch_tab', { tabId: options[0].id });
      report = options.length
        ? `I opened and read ${options.length} source pages in browser tabs. The top result is selected on the left. Review those options there; eligibility and deadlines still need verification.`
        : exploring ? 'I checked this page but found no readable linked options. The page remains open on the left.'
          : 'Search returned no readable verified source pages. Try a more specific funding goal or an official website URL.';
    }
  } else if (funding) {
    report = FUNDING_REPLIES[funding] + (summaryRequested ? PAGE_SUMMARY_HINT : '');
  } else if (intent === 'chat') {
    report = chatReply(message);
  } else if (RETRY.test(message)) {
    // A retry with nothing safe to repeat: ask rather than guess.
    report = "Tell me what you'd like me to try again, and I'll do it.";
  } else if (WRITING_REQUEST.test(message)) {
    report = "I can't draft that here, but I can look up examples and guidance for it. Want me to search for some?";
  } else if (intent === 'question' && (keywords(message).length < 2 || VAGUE_QUESTION.test(message))) {
    report = "Could you tell me a bit more about what you're asking? Name the program, funder, topic or website, and I'll look it up.";
  } else if (intent === 'question') {
    // Looked up, then answered with the sources' own words: the passages that
    // best match the question, each with the page it came from.
    input.onStep({ type: 'thinking', detail: 'Looking that up…' });
    const words = keywords(message);
    const found: Array<{ id: string; url: string; title: string; passages: string[] }> = [];
    let declined = false;
    try {
      const search = await run('web_search', { query: message, count: 8 });
      const results = (Array.isArray(search.results) ? search.results : []) as Array<{ url?: string; title?: string }>;
      for (const result of results) {
        if (found.length >= 2 || budget.used + 3.5 > budget.total) break;
        let url: URL;
        try { url = new URL(result.url ?? ''); } catch { continue; }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || isBlockedDestination(url)
          || /(^|\.)(?:google\.[a-z.]+|bing\.com|startpage\.com)$/.test(url.hostname)) continue;
        try {
          const tab = await run('new_tab', { url: url.href });
          const page = await run('read_page', { tabId: String(tab.id) });
          const passages = relevantPassages(String(page.text ?? ''), words);
          if (passages.length) {
            found.push({ id: String(tab.id), url: String(page.url ?? url.href).replace(/#.*$/, ''),
              title: String(page.title || result.title || url.hostname).slice(0, 120), passages });
          }
        } catch (error) {
          if (input.context.signal.aborted || /USER_DECLINED|declined|cancelled|budget/i.test(String(error))) throw error;
          // An unreadable source must not stop the others.
        }
      }
    } catch (error) {
      if (input.context.signal.aborted || !/declined|PERMISSION_DENIED/i.test(String(error))) throw error;
      declined = true;
    }
    if (found[0]) await run('switch_tab', { tabId: found[0].id });
    report = declined
      ? 'To answer that I need to look it up in the browser. Ask again and choose Allow Access when I ask, and I will show you what the sources say.'
      : found.length
        ? `Here's what I found:\n\n${found.map((source) => `${source.passages.map((passage) => `> ${passage}`).join('\n>\n')}\n\nSource: [${source.title.replace(/[[\]]/g, '')}](${source.url})`).join('\n\n')}\n\n` +
          'These passages are quoted from the sources, which are open in tabs on the left. Want me to look further or check another source?'
        : 'I looked that up but could not find a readable source that answers it. Try rephrasing it, or ask me to open a specific website.';
  } else {
    report = `${AGENT_IDENTITY} is ready. ${HELP}`;
  }
  report = applyTerminology(protectAssistantIdentity(report));
  input.onStep({ type: 'text', detail: report });
  input.onStep({ type: 'done' });
  return report;
}
