// Slash-command expansions for the AI panel. Each command rewrites a
// short user shorthand into a fully formed agent prompt before it leaves
// the renderer. The user's bubble still shows the raw "/foo …" they
// typed; only the prompt the agent receives is the expanded version.

export interface SlashCommand {
  name: string;
  description: string;
  /** Pre-fill the textarea with this when the user clicks the suggestion. */
  fillTemplate?: string;
  expand: (rest: string) => { prompt?: string; echo?: 'help' };
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: '/summarize',
    description: 'Summarize the active page (or pass extra focus, e.g. /summarize risks).',
    expand: (rest) => ({
      prompt: rest
        ? `Read the current tab and summarize it. Focus on: ${rest}. ` +
          'Output a one-paragraph TL;DR followed by the key points as a bulleted list. Cite the URL.'
        : 'Read the current tab and give me a one-paragraph TL;DR followed by ' +
          'key points as a bulleted list. Note any action items and cite the URL.',
    }),
  },
  {
    name: '/compare-tabs',
    description: 'Compare all open tabs side by side (no focus switch).',
    expand: (rest) => ({
      prompt:
        'Call list_tabs, then read_page on each tab id silently (without switching focus). ' +
        'Produce a Markdown comparison table with one column per tab. ' +
        (rest
          ? `Compare on these dimensions: ${rest}.`
          : 'Compare on: topic, main claim, source quality, and what each is best for.') +
        ' Cite each tab with its URL. End with a one-paragraph "Which to read first" recommendation.',
    }),
  },
  {
    name: '/find',
    description: 'Find text or a concept on the current page and quote the matches.',
    fillTemplate: '/find ',
    expand: (rest) => ({
      prompt: rest
        ? `Read the current tab. Find every mention of "${rest}". Quote 1–2 sentences of context ` +
          'around each hit and report how many total matches there are. If none, say so plainly.'
        : 'Read the current tab and list the most important phrases or named entities, each ' +
          'with one sentence of context. Useful for navigating a long page quickly.',
    }),
  },
  {
    name: '/extract',
    description: 'Pull structured data from the page (describe the fields you want).',
    fillTemplate: '/extract ',
    expand: (rest) => ({
      prompt:
        'Use extract on the current page. ' +
        (rest
          ? `Shape the result to capture: ${rest}.`
          : 'Pull the main entities, headings, links, and any tables.') +
        ' Return clean Markdown — use tables where appropriate. Cite the URL.',
    }),
  },
  {
    name: '/help',
    description: 'Show all slash commands.',
    expand: () => ({ echo: 'help' }),
  },
];

export function expandSlashCommand(
  input: string,
): { prompt?: string; echo?: 'help' } | null {
  if (!input.startsWith('/')) return null;
  const [head, ...rest] = input.split(/\s+/);
  const cmd = SLASH_COMMANDS.find((c) => c.name === head?.toLowerCase());
  if (!cmd) return null;
  return cmd.expand(rest.join(' ').trim());
}
