// The connected assistant, as the funding pipelines see it.
//
// This is the only funding file that knows a provider exists. It chooses the
// engine from the assistant the user picked in Settings and the keys they have
// saved, sends one question at a time, and turns every failure into an error
// that is safe to show. Pipelines receive `complete` and nothing else.

import {
  DEFAULT_MODEL,
  ModelCallError,
  MODEL_ERRORS,
  TERMINOLOGY_INSTRUCTIONS,
  UNTRUSTED_RULES,
  analysisModelFor,
  modelErrorMessage,
  providerFor,
  structuredCompletion,
  type ModelId,
  type ProviderId,
} from '@bullebrowser/agent-core';
import type { AssistantAvailability } from '../../shared/funding.js';
import { FundingError, isCancellation } from './errors.js';
import type { Complete, CompletionRequest } from './pipeline.js';

export interface AssistantDeps {
  /** The assistant chosen in Settings, or undefined when none was chosen. */
  selectedModel(): ModelId | undefined;
  /** The saved key for a provider, or null. */
  apiKey(provider: ProviderId): string | null;
  /**
   * Stands in for a provider's address. Set only by the end-to-end suite, so
   * that analysis can be exercised against a scripted server.
   */
  baseUrl?(provider: ProviderId): string | undefined;
}

export interface Assistant {
  /** True when a saved key lets document analysis run. */
  connected(): boolean;
  availability(): AssistantAvailability;
  complete: Complete;
}

interface Engine {
  model: string;
  apiKey: string;
  baseURL?: string;
}

/** The engine each provider is asked for when the user's own choice has no key. */
const PROVIDER_DEFAULTS: ModelId[] = [DEFAULT_MODEL, 'gpt-4o'];

const WITHOUT_ASSISTANT =
  'BulleBrowser still reads and searches your documents on this device, finds listings from official sources and shows text matches.';

export function createAssistant(deps: AssistantDeps): Assistant {
  // The user's own choice first. If its provider has no key but another does,
  // analysis uses that one rather than refusing work the user can pay for.
  const engine = (): Engine | null => {
    const preferred = deps.selectedModel() ?? DEFAULT_MODEL;
    for (const candidate of [preferred, ...PROVIDER_DEFAULTS]) {
      const provider = providerFor(candidate);
      const apiKey = deps.apiKey(provider);
      if (!apiKey) continue;
      const baseURL = deps.baseUrl?.(provider);
      return { model: analysisModelFor(candidate), apiKey, ...(baseURL ? { baseURL } : {}) };
    }
    return null;
  };

  const complete = async <T>(request: CompletionRequest<T>): Promise<T> => {
    const chosen = engine();
    if (!chosen) throw new FundingError('NO_ASSISTANT', MODEL_ERRORS.NO_ASSISTANT.message);
    if (request.signal.aborted) throw new FundingError('CANCELLED', 'Cancelled.');
    try {
      const result = await structuredCompletion<T>({
        engine: { apiKey: chosen.apiKey, ...(chosen.baseURL ? { baseURL: chosen.baseURL } : {}) },
        model: chosen.model,
        // Trusted text only. The documents travel in the user turn, sealed.
        system: [request.system, TERMINOLOGY_INSTRUCTIONS, UNTRUSTED_RULES].join('\n\n'),
        messages: [
          {
            role: 'user',
            content: [
              // First and marked, so several questions about the same documents reuse them.
              { text: request.documents, cache: true },
              { text: request.task },
            ],
          },
        ],
        schema: request.schema,
        signal: request.signal,
        ...(request.maxTokens ? { maxTokens: request.maxTokens } : {}),
        refusalFallback: true,
      });
      return result.value;
    } catch (error) {
      if (request.signal.aborted || isCancellation(error)) throw new FundingError('CANCELLED', 'Cancelled.');
      if (error instanceof ModelCallError) {
        // The provider's own wording stays in the log; people see the fixed sentence.
        console.warn(`[funding] assistant call failed: ${error.code}${error.status ? ` (${error.status})` : ''}`);
        throw new FundingError(
          error.code === 'NO_ASSISTANT' ? 'NO_ASSISTANT' : 'ASSISTANT_ERROR',
          modelErrorMessage(error),
        );
      }
      console.error('[funding] assistant call failed unexpectedly', error);
      throw new FundingError('ASSISTANT_ERROR', modelErrorMessage(error));
    }
  };

  return {
    connected: () => engine() !== null,
    availability: () => ({ connected: engine() !== null, note: WITHOUT_ASSISTANT }),
    complete: complete as Complete,
  };
}
