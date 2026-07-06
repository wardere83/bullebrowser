import type { ClaudeModelId } from './types.js';

export interface SynthesisProvider {
  id: string;
  summarize(input: {
    model: ClaudeModelId;
    goal: string;
    facts: unknown[];
    apiKey?: string;
  }): Promise<string>;
}

export class LocalSynthesisProvider implements SynthesisProvider {
  id = 'local-default';

  async summarize(input: {
    model: ClaudeModelId;
    goal: string;
    facts: unknown[];
  }): Promise<string> {
    const compact = input.facts
      .map((f) => {
        if (!f || typeof f !== 'object') return '';
        const rec = f as Record<string, unknown>;
        if (typeof rec.summary === 'string') return rec.summary;
        if (typeof rec.text === 'string') return rec.text.slice(0, 400);
        return JSON.stringify(rec).slice(0, 400);
      })
      .filter(Boolean)
      .slice(0, 6);

    const body = compact.length > 0 ? compact.join('\n\n') : 'No verifiable facts were captured.';
    return [`Goal: ${input.goal}`, '', body].join('\n');
  }
}

export class AnthropicSynthesisProvider implements SynthesisProvider {
  id = 'anthropic';

  async summarize(input: {
    model: ClaudeModelId;
    goal: string;
    facts: unknown[];
    apiKey?: string;
  }): Promise<string> {
    if (!input.apiKey) {
      throw new Error('Anthropic synthesis requires an API key.');
    }

    const { default: AnthropicClient } = await import('@anthropic-ai/sdk');
    const client = new AnthropicClient({ apiKey: input.apiKey });

    const response = await client.messages.create({
      model: input.model,
      max_tokens: 1200,
      system:
        'You are a privacy-first synthesis module. Use only provided facts. ' +
        'Do not fabricate actions or tool executions. Keep output concise and cite URLs when present.',
      messages: [
        {
          role: 'user',
          content: JSON.stringify({ goal: input.goal, facts: input.facts }),
        },
      ],
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => ('text' in b ? b.text : ''))
      .join('\n\n')
      .trim();

    return text || 'No synthesis output.';
  }
}
