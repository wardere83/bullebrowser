import { isResearchRequest } from './research.js';

/**
 * What a message asks of the assistant, decided before anything runs:
 * - 'chat': conversation (greetings, thanks, "what can you do?"). Reply in
 *   the chat; nothing is browsed and no browser access is asked for.
 * - 'question': something to answer. Answer it, browsing only if the answer
 *   needs a source; access is asked for only then.
 * - 'browse': work in the browser (open, find, search, compare, this page…).
 *   Browser access is asked for up front.
 */
export type RequestIntent = 'chat' | 'question' | 'browse';

const CHAT =
  /^(?:(?:hi|hello|hey|hiya|yo|good (?:morning|afternoon|evening|day))(?: there)?|thanks?(?: you)?(?: (?:so|very) much)?|thank you(?: (?:so|very) much)?|ty|cheers|great|perfect|awesome|nice|cool|ok(?:ay)?|got it|sounds good|you rock|you're (?:the best|great|awesome)|how are you(?: doing)?(?: today)?|how's it going|what's up|bye|goodbye|see you|good night)(?:[\s,]+(?:bulle ?browser|buddy|friend|team|again|so much))*[\s!.?😊🙂👍🙏]*$/iu;

const CAPABILITY =
  /^(?:(?:so|and|ok(?:ay)?),?\s+)?(?:what (?:can|do) you do|what are you able to do|how can you help(?: me)?|what can i ask(?: you)?|how do(?:es)? (?:this|you|it|bulle ?browser) work|help|what are your (?:features|capabilities))[\s?!.]*$/i;

// Doing something in the browser, or on the page in front of the user.
const BROWSE =
  /^(?:(?:can|could|would|will) you\s+|please\s+|i (?:want|need) you to\s+|let'?s\s+)?(?:open|go to|navigate|visit|browse|search|look up|look for|find|show me|pull up|compare|research|investigate|check|verify|click|tap|press|type|enter|fill|sign (?:in|up)|log ?in|book|buy|order|download|upload|scroll|summari[sz]e|read|extract|list (?:the )?(?:links|tabs)|explore)\b/i;
// Work on text the person supplied (an attachment, pasted text), not on a page.
const SUPPLIED = /\b(?:attached|attachment|uploaded|following|below|pasted|this text|the text|my (?:file|document|notes|draft))\b/i;
const TEXT_WORK = /^(?:please\s+)?(?:summari[sz]e|read|extract|list)\b/i;
const PAGE = /\b(?:this|the current|the open|that) (?:page|site|website|tab|article|document|listing|form)\b|\bon (?:the )?screen\b/i;
// A bare domain counts, but not the end of an email address.
const URL = /\bhttps?:\/\/\S+|\bwww\.\S+\.\S+|(?<![@\w.-])[a-z0-9-]+\.(?:com|org|gov|net|edu|io|co|us)\b/i;

// A reaction that opens with thanks or praise ("Thanks, that was really
// helpful"), with no question and no new request in it.
const REACTION =
  /^(?:thanks?|thank you|ty|great|perfect|awesome|amazing|excellent|nice|cool|wonderful|ok(?:ay)?|got it|that(?:'s| is| was) (?:great|perfect|helpful|it|exactly)|this (?:is|was) (?:great|perfect|helpful))\b[\s,!.]/i;
const NEW_REQUEST = /\?|\b(?:but|now|also|next|can you|could you|please|find|search|open|look up|show me|check)\b/i;

// Questions that need current or sourced facts are browsed even when asked
// as questions; "Explain binary search" is not one of them.
const NEEDS_SOURCES =
  /\b(?:latest|today|this (?:week|month|year)|right now|recent(?:ly)?|grants?|funders?|funding|deadlines?|eligib\w*|news|prices?|current (?:deadline|rate|price|status|requirement|law|rule)s?)\b/i;
// An explicit request to research, at the start of any sentence.
const RESEARCH_ASK = /(?:^|[.!?]\s+)(?:please\s+)?(?:research|browse|search for|find|look up|compare|verify|check)\b/i;

const QUESTION =
  /\?\s*$|^(?:what|what's|whats|who|whom|whose|when|where|why|how|which|is|are|am|was|were|can|could|should|would|will|do|does|did|has|have|explain|define|describe|tell me|help me understand)\b/i;

/** Sort the user's own words, before any attached context. */
export function requestIntent(request: string, options: { browserTask?: string } = {}): RequestIntent {
  const text = request.trim();
  if (options.browserTask) return 'browse';
  if (!text) return 'chat';
  if (CHAT.test(text) || CAPABILITY.test(text) || (REACTION.test(text) && !NEW_REQUEST.test(text))) return 'chat';
  if (TEXT_WORK.test(text) && SUPPLIED.test(text) && !PAGE.test(text) && !URL.test(text)) return 'question';
  if (BROWSE.test(text) || PAGE.test(text) || URL.test(text)) return 'browse';
  if (QUESTION.test(text)) return NEEDS_SOURCES.test(text) || RESEARCH_ASK.test(text) ? 'browse' : 'question';
  if (isResearchRequest(text)) return 'browse';
  // Anything else (write me…, draft…, a statement): answer it in the chat.
  return 'question';
}
