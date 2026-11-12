import { describe, expect, it, vi } from 'vitest';
import { FEDERATION_AUDIENCE, federatedAnthropicCredentials } from './federated-credentials.js';

const env = {
  ANTHROPIC_FEDERATION_RULE_ID: 'fdrl_test',
  ANTHROPIC_ORGANIZATION_ID: '00000000-0000-0000-0000-000000000000',
  ANTHROPIC_SERVICE_ACCOUNT_ID: 'svac_test',
  ANTHROPIC_WORKSPACE_ID: 'wrkspc_test',
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.example/request?api-version=2.0',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
};

function network() {
  let issued = 0;
  const exchanges: Record<string, unknown>[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === 'token.actions.example') {
      expect(url.searchParams.get('audience')).toBe(FEDERATION_AUDIENCE);
      expect(url.searchParams.get('api-version')).toBe('2.0');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer request-token');
      issued += 1;
      return Response.json({ value: `github-jwt-${issued}` });
    }
    expect(url.href).toBe('https://api.anthropic.com/v1/oauth/token');
    exchanges.push(JSON.parse(String(init?.body)));
    return Response.json({ access_token: 'sk-ant-oat01-test', token_type: 'Bearer', expires_in: 600 });
  });
  return { fetchMock: fetchMock as unknown as typeof fetch, exchanges };
}

describe('federated Claude credentials', () => {
  it('exchanges a fresh GitHub token for every Anthropic token', async () => {
    const { fetchMock, exchanges } = network();
    const provider = federatedAnthropicCredentials(env, false, fetchMock)!;
    expect(provider).toBeTypeOf('function');
    const first = await provider();
    await provider({ forceRefresh: true });
    expect(first.token).toBe('sk-ant-oat01-test');
    expect(first.expiresAt).toBeGreaterThan(Date.now() / 1000);
    expect(exchanges).toEqual([1, 2].map((n) => expect.objectContaining({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `github-jwt-${n}`,
      federation_rule_id: 'fdrl_test',
      organization_id: '00000000-0000-0000-0000-000000000000',
      service_account_id: 'svac_test',
      workspace_id: 'wrkspc_test',
    })));
  });

  it('is never used by an installed build', () => {
    expect(federatedAnthropicCredentials(env, true, network().fetchMock)).toBeNull();
  });

  it('stays off unless the rule and GitHub token endpoint are all configured', () => {
    for (const name of Object.keys(env).filter((key) => key !== 'ANTHROPIC_WORKSPACE_ID')) {
      expect(federatedAnthropicCredentials({ ...env, [name]: ' ' }, false, network().fetchMock)).toBeNull();
    }
    const { ANTHROPIC_WORKSPACE_ID: _workspace, ...withoutWorkspace } = env;
    expect(federatedAnthropicCredentials(withoutWorkspace, false, network().fetchMock)).not.toBeNull();
  });

  it('reports a refused GitHub token request without exchanging', async () => {
    const fetchMock = vi.fn(async () => new Response('denied', { status: 403 })) as unknown as typeof fetch;
    const provider = federatedAnthropicCredentials(env, false, fetchMock)!;
    await expect(provider()).rejects.toThrow('GitHub did not issue an identity token (HTTP 403).');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
