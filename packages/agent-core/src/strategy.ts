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
  /** One line: the opportunity and the angle that wins it. */
  headline: string;
  /** How well the organization fits, and why, in a sentence or two. */
  fit?: string;
  /** A rough read of the chance of success. */
  outlook?: 'strong' | 'promising' | 'long shot' | 'not a fit';
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
    headline,
    ...(text(input.fit) ? { fit: text(input.fit) } : {}),
    ...(outlook ? { outlook } : {}),
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
  '(an eligibility rule, a deadline, a scoring criterion, a funder priority). Each call replaces the last one. ' +
  'Write it for the user, not as notes to yourself: be specific to this opportunity and this organization, ' +
  'name concrete angles a reviewer would remember, and turn each idea into a step someone can do this week. ' +
  'Ground every claim in what you have read and never invent dates, amounts or requirements. Skip the ' +
  'playbook for small talk, quick facts and tasks with nothing to win.';

export function strategyTool(onStep: AgentStepHandler): ApiTool {
  return {
    name: STRATEGY_TOOL,
    description:
      'Show the user a live strategy playbook for the opportunity you are working on: the winning angle, fit, ' +
      'win themes, concrete action steps, deadlines, risks and the best next move. It appears in the panel ' +
      'beside the browser while you keep working, and each call replaces the previous playbook. It changes ' +
      'nothing on any website.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['headline', 'winThemes', 'actions'],
      properties: {
        headline: { type: 'string', description: 'One line: the opportunity and the angle that wins it.' },
        fit: { type: 'string', description: 'How well the organization fits and why, in one or two sentences.' },
        outlook: { type: 'string', enum: ['strong', 'promising', 'long shot', 'not a fit'] },
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
