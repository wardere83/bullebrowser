// Claude access for test builds running in GitHub Actions, through Anthropic
// workload identity federation: the job proves who it is with GitHub's OIDC
// token, and no API key is stored anywhere. Installed builds never use this;
// they authenticate with the key saved in Settings.

import { app } from 'electron';
import { oidcFederationProvider } from '@anthropic-ai/sdk/lib/credentials/oidc-federation';
import type { AnthropicCredentials } from '@bullebrowser/agent-core';

/** The audience the federation rule expects on GitHub's token. */
export const FEDERATION_AUDIENCE = 'https://api.anthropic.com';

function read(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return env[name]?.trim() || undefined;
}

/**
 * Credentials when the federation rule and GitHub's token endpoint are both
 * configured in an unpackaged build, otherwise null.
 */
export function federatedAnthropicCredentials(
  env: NodeJS.ProcessEnv = process.env,
  // Outside Electron (unit tests) `app` is undefined: treat that as installed.
  packaged: boolean = app?.isPackaged ?? true,
  fetchImpl: typeof fetch = fetch,
): AnthropicCredentials | null {
  if (packaged) return null;
  const federationRuleId = read(env, 'ANTHROPIC_FEDERATION_RULE_ID');
  const organizationId = read(env, 'ANTHROPIC_ORGANIZATION_ID');
  const serviceAccountId = read(env, 'ANTHROPIC_SERVICE_ACCOUNT_ID');
  const requestUrl = read(env, 'ACTIONS_ID_TOKEN_REQUEST_URL');
  const requestToken = read(env, 'ACTIONS_ID_TOKEN_REQUEST_TOKEN');
  if (!federationRuleId || !organizationId || !serviceAccountId || !requestUrl || !requestToken) return null;
  const workspaceId = read(env, 'ANTHROPIC_WORKSPACE_ID');
  return oidcFederationProvider({
    federationRuleId,
    organizationId,
    serviceAccountId,
    ...(workspaceId ? { workspaceId } : {}),
    baseURL: read(env, 'ANTHROPIC_BASE_URL') ?? 'https://api.anthropic.com',
    fetch: fetchImpl,
    // A fresh GitHub token for every exchange: each one is accepted once and
    // expires within minutes, while the request URL lasts the whole job.
    identityTokenProvider: async () => {
      const url = new URL(requestUrl);
      url.searchParams.set('audience', FEDERATION_AUDIENCE);
      const response = await fetchImpl(url, { headers: { authorization: `Bearer ${requestToken}` } });
      if (!response.ok) throw new Error(`GitHub did not issue an identity token (HTTP ${response.status}).`);
      const body = (await response.json()) as { value?: unknown };
      if (typeof body.value !== 'string' || !body.value) throw new Error('GitHub returned no identity token.');
      return body.value;
    },
  });
}
