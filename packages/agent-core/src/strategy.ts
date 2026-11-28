// The strategy playbook: what the user sees in the thinking area while a task
// runs. The model's private reasoning stays private; this is a deliberate,
// user-facing read of the opportunity being browsed (a grant, an RFP, a
// contract, a partner) and the moves that would win it, written for the person
// and updated as the agent learns more.

import type { AgentStepHandler, ApiTool } from './types.js';

export const STRATEGY_TOOL = 'share_strategy';

export interface StrategyAction {
  step: string;
  /** Who does it, in plain words ("you", "your finance lead"). */
  owner?: string;
  /** When, as the source states it or as a plain suggestion. */
  when?: string;
}

export interface StrategyPlaybook {
  /** The opportunity's own name, as the source gives it. One playbook per opportunity. */
  opportunity?: string;
  /** Who funds it. */
  funder?: string;
  /** The award as the source states it ("Up to $250,000"). */
  award?: string;
  /** One line: the opportunity and the angle that wins it. */
  headline: string;
  /** How well the organization fits, and why, in a sentence or two. */
  fit?: string;
  /** A rough read of the chance of success. */
  outlook?: 'strong' | 'promising' | 'long shot' | 'not a fit';
  /** What a successful proposal must have: eligibility, required documents,
   *  match, letters, data, registrations. */
  requirements?: string[];
  /** The creative angles that would make this application stand out. */
  winThemes: string[];
  /** Concrete, ordered steps the user can execute. */
  actions: StrategyAction[];
  /** Dates that matter, as the source gives them. */
  deadlines?: string[];
  /** What could sink it, each with its counter. */
  risks?: string[];
  /** The single best next move, right now. */
  nextMove?: string;
  /** Pages the strategy rests on. */
  sources?: string[];
}

const MAX_ITEMS = 8;
const MAX_TEXT = 400;

const text = (value: unknown, max = MAX_TEXT): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, max) : undefined;
};
const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => text(item)).filter((item): item is string => !!item).slice(0, MAX_ITEMS) : [];

/** Bounds and cleans what the model sent, so the panel never renders raw input. */
export function normalizeStrategy(input: Record<string, unknown>): StrategyPlaybook {
  const headline = text(input.headline, 200);
  if (!headline) throw new Error('A strategy needs a headline.');
  const outlook = ['strong', 'promising', 'long shot', 'not a fit'].includes(input.outlook as string)
    ? (input.outlook as StrategyPlaybook['outlook'])
    : undefined;
  const actions = (Array.isArray(input.actions) ? input.actions : [])
    .map((raw): StrategyAction | null => {
      if (typeof raw === 'string') return text(raw) ? { step: text(raw)! } : null;
      if (!raw || typeof raw !== 'object') return null;
      const item = raw as Record<string, unknown>;
      const step = text(item.step);
      if (!step) return null;
      return { step, ...(text(item.owner, 80) ? { owner: text(item.owner, 80) } : {}), ...(text(item.when, 80) ? { when: text(item.when, 80) } : {}) };
    })
    .filter((item): item is StrategyAction => !!item)
    .slice(0, MAX_ITEMS);
  const sources = list(input.sources).filter((url) => /^https?:\/\//i.test(url));
  return {
    ...(text(input.opportunity, 160) ? { opportunity: text(input.opportunity, 160) } : {}),
    ...(text(input.funder, 160) ? { funder: text(input.funder, 160) } : {}),
    ...(text(input.award, 120) ? { award: text(input.award, 120) } : {}),
    headline,
    ...(text(input.fit) ? { fit: text(input.fit) } : {}),
    ...(outlook ? { outlook } : {}),
    ...(list(input.requirements).length ? { requirements: list(input.requirements) } : {}),
    winThemes: list(input.winThemes),
    actions,
    ...(list(input.deadlines).length ? { deadlines: list(input.deadlines) } : {}),
    ...(list(input.risks).length ? { risks: list(input.risks) } : {}),
    ...(text(input.nextMove) ? { nextMove: text(input.nextMove) } : {}),
    ...(sources.length ? { sources } : {}),
  };
}

/** How the model is told to use the playbook. Stable text: it sits in the cached system prompt. */
export const STRATEGY_INSTRUCTIONS =
  'Strategy playbook: while you work on an opportunity (a grant, RFP, contract, solicitation, partnership, ' +
  `sponsorship, market or client), call ${STRATEGY_TOOL} to show the user how to win it. Call it as soon as you ` +
  'have a first real picture of the opportunity, and again whenever something you read changes the picture ' +
  '(an eligibility rule, a deadline, a scoring criterion, a funder priority). Name the opportunity in ' +
  '`opportunity`: a call for the same opportunity replaces its earlier playbook, and a call for another ' +
  'opportunity adds one, so when you find several promising opportunities, share a playbook for each of the ' +
  'best ones (up to five). In `requirements`, list what a successful proposal must have: eligibility, required ' +
  'documents and registrations, match, letters of support, data and outcomes to show. ' +
  'Write it for the user, not as notes to yourself: be specific to this opportunity and to the applicant as the user describes them, ' +
  'name concrete angles a reviewer would remember, and turn each idea into a step someone can do this week. ' +
  'Ground every claim in what you have read and never invent dates, amounts or requirements. Skip the ' +
  'playbook for small talk, quick facts and tasks with nothing to win.';

export function strategyTool(onStep: AgentStepHandler): ApiTool {
  return {
    name: STRATEGY_TOOL,
    description:
      'Show the user a live strategy playbook for the opportunity you are working on: the winning angle, fit, ' +
      'win themes, concrete action steps, deadlines, risks and the best next move. It appears in the panel ' +
      'beside the browser while you keep working and collects in the Session Scratchpad. A call for the same ' +
      'opportunity replaces its playbook; a call for another opportunity adds one. It changes ' +
      'nothing on any website.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['headline', 'winThemes', 'actions'],
      properties: {
        opportunity: { type: 'string', description: 'The opportunity\'s name as the source gives it.' },
        funder: { type: 'string', description: 'Who funds it.' },
        award: { type: 'string', description: 'The award amount or range exactly as the source states it.' },
        headline: { type: 'string', description: 'One line: the opportunity and the angle that wins it.' },
        fit: { type: 'string', description: 'How well the organization fits and why, in one or two sentences.' },
        outlook: { type: 'string', enum: ['strong', 'promising', 'long shot', 'not a fit'] },
        requirements: { type: 'array', items: { type: 'string' }, description: 'What a successful proposal must have: eligibility, required documents and registrations, match, letters, data to show. Each as the source states it.' },
        winThemes: { type: 'array', items: { type: 'string' }, description: 'Two to five creative angles that would make this stand out to the reviewer.' },
        actions: {
          type: 'array',
          description: 'Ordered steps the user can execute.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['step'],
            properties: {
              step: { type: 'string' },
              owner: { type: 'string', description: 'Who does it, in plain words.' },
              when: { type: 'string', description: 'When, as the source states it or as a suggestion.' },
            },
          },
        },
        deadlines: { type: 'array', items: { type: 'string' }, description: 'Dates that matter, exactly as the source gives them.' },
        risks: { type: 'array', items: { type: 'string' }, description: 'What could sink it, each with how to counter it.' },
        nextMove: { type: 'string', description: 'The single best next move, right now.' },
        sources: { type: 'array', items: { type: 'string' }, description: 'The page addresses this rests on.' },
      },
    },
    execute: async (input) => {
      const playbook = normalizeStrategy(input);
      onStep({ type: 'strategy', detail: playbook.headline, data: playbook });
      return { shown: true };
    },
  };
}
