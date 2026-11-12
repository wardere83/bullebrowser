import { providerFor, type AgentInput } from './types.js';

type Auth = Pick<AgentInput, 'apiKey' | 'anthropicCredentials'>;

/** Whether the selected model can be called. Credentials exist only for Claude. */
export function hasModelAccess(input: Auth & Pick<AgentInput, 'model'>): boolean {
  return Boolean(input.apiKey) || (providerFor(input.model) === 'anthropic' && Boolean(input.anthropicCredentials));
}

/**
 * Claude client authentication. A saved key wins. Otherwise the credentials are
 * used, with explicit nulls so the SDK does not also send a key or token it
 * finds in the environment, which the API rejects.
 */
export function anthropicAuth(input: Auth) {
  if (input.apiKey || !input.anthropicCredentials) return { apiKey: input.apiKey };
  return { apiKey: null, authToken: null, credentials: input.anthropicCredentials };
}
