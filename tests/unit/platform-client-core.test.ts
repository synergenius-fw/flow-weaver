/**
 * Tests for PlatformClient core methods (getUser, pushWorkflow, deploy,
 * undeploy, listDeployments, getUsage, streamChat, validate).
 * No module mocks — tests the real PlatformClient with a stubbed global fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlatformClient, createPlatformClient } from '../../src/cli/config/platform-client';
import type { StoredCredentials } from '../../src/cli/config/credentials';

const MOCK_CREDS: StoredCredentials = {
  token: 'test-jwt-token',
  email: 'user@test.com',
  plan: 'free',
  platformUrl: 'https://api.flowweaver.ai',
  expiresAt: Date.now() + 86_400_000,
};

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// createPlatformClient factory
// ---------------------------------------------------------------------------

describe('createPlatformClient', () => {
  it('returns a PlatformClient instance', () => {
    const client = createPlatformClient(MOCK_CREDS);
    expect(client).toBeInstanceOf(PlatformClient);
  });
});

// ---------------------------------------------------------------------------
// getUser
// ---------------------------------------------------------------------------

describe('PlatformClient.getUser', () => {
  it('returns user data from /auth/me', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    const user = { id: 'u1', email: 'a@b.com', name: 'Alice', plan: 'pro' };
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user }),
    });

    const result = await client.getUser();

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.flowweaver.ai/auth/me',
      expect.any(Object),
    );
    expect(result).toEqual(user);
  });

  it('throws on non-ok response', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 401 });

    await expect(client.getUser()).rejects.toThrow('Auth failed: 401');
  });
});

// ---------------------------------------------------------------------------
// pushWorkflow
// ---------------------------------------------------------------------------

describe('PlatformClient.pushWorkflow', () => {
  it('updates existing workflow via PUT', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ workflow: { slug: 'my-wf', version: 2 } }),
    });

    const result = await client.pushWorkflow('My WF', 'source code');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.flowweaver.ai/workflows/my-wf',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(result).toEqual({ slug: 'my-wf', version: 2 });
  });

  it('falls back to POST on 404 (new workflow)', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 404 }) // PUT returns 404
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ workflow: { slug: 'new-wf', version: 1 } }),
      }); // POST succeeds

    const result = await client.pushWorkflow('new-wf', 'source');

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toBe('https://api.flowweaver.ai/workflows');
    expect(mockFetch.mock.calls[1][1]).toEqual(expect.objectContaining({ method: 'POST' }));
    expect(result).toEqual({ slug: 'new-wf', version: 1 });
  });

  it('throws with error from response body', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'Invalid source' }),
    });

    await expect(client.pushWorkflow('wf', 'bad')).rejects.toThrow('Invalid source');
  });

  it('throws with fallback when json has no error field', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      json: () => Promise.resolve({}),
    });

    await expect(client.pushWorkflow('wf', 'src')).rejects.toThrow('Push failed: 500');
  });

  it('throws with statusText when json parsing fails', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      json: () => Promise.reject(new Error('not json')),
    });

    await expect(client.pushWorkflow('wf', 'src')).rejects.toThrow('Server Error');
  });

  it('normalizes workflow name to slug', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ workflow: { slug: 'hello--world', version: 1 } }),
    });

    await client.pushWorkflow('Hello  World!', 'src');

    // 'Hello  World!' → lowercase → replace non-alnum with - → collapse -- → 'hello-world-'
    const expectedSlug = 'Hello  World!'.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
    expect(mockFetch.mock.calls[0][0]).toBe(`https://api.flowweaver.ai/workflows/${expectedSlug}`);
  });
});

// ---------------------------------------------------------------------------
// deploy
// ---------------------------------------------------------------------------

describe('PlatformClient.deploy', () => {
  it('sends POST to /workflows/:slug/deploy', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ deployment: { slug: 'my-wf', status: 'active' } }),
    });

    const result = await client.deploy('my-wf');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.flowweaver.ai/workflows/my-wf/deploy',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result).toEqual({ slug: 'my-wf', status: 'active' });
  });

  it('throws with error from response body', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: 'Deployment limit reached' }),
    });

    await expect(client.deploy('wf')).rejects.toThrow('Deployment limit reached');
  });

  it('throws with fallback when json has no error field', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      json: () => Promise.resolve({}),
    });

    await expect(client.deploy('wf')).rejects.toThrow('Deploy failed: 500');
  });

  it('throws with statusText when json parsing fails', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: () => Promise.reject(new Error('nope')),
    });

    await expect(client.deploy('wf')).rejects.toThrow('Bad Gateway');
  });
});

// ---------------------------------------------------------------------------
// undeploy
// ---------------------------------------------------------------------------

describe('PlatformClient.undeploy', () => {
  it('sends DELETE to /deployments/:slug', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: true, status: 204 });

    await client.undeploy('my-wf');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.flowweaver.ai/deployments/my-wf',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('succeeds silently on 404 (already undeployed)', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    await expect(client.undeploy('gone')).resolves.toBeUndefined();
  });

  it('throws on other non-ok status', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    await expect(client.undeploy('wf')).rejects.toThrow('Undeploy failed: 500');
  });
});

// ---------------------------------------------------------------------------
// listDeployments
// ---------------------------------------------------------------------------

describe('PlatformClient.listDeployments', () => {
  it('returns deployments array', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    const deployments = [{ slug: 'wf-1', status: 'active', workflowName: 'WF 1' }];
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ deployments }),
    });

    const result = await client.listDeployments();

    expect(result).toEqual(deployments);
  });

  it('throws on non-ok response', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    await expect(client.listDeployments()).rejects.toThrow('List failed: 500');
  });
});

// ---------------------------------------------------------------------------
// getUsage
// ---------------------------------------------------------------------------

describe('PlatformClient.getUsage', () => {
  it('returns usage data', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    const usage = { executions: 42, aiCalls: 10, plan: 'pro' };
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(usage),
    });

    const result = await client.getUsage();

    expect(result).toEqual(usage);
  });

  it('returns default values on non-ok response', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const result = await client.getUsage();

    expect(result).toEqual({ executions: 0, aiCalls: 0, plan: 'unknown' });
  });
});

// ---------------------------------------------------------------------------
// streamChat
// ---------------------------------------------------------------------------

describe('PlatformClient.streamChat', () => {
  it('yields parsed SSE data events', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    const chunks = [
      new TextEncoder().encode('data: {"type":"text","content":"hello"}\n'),
      new TextEncoder().encode('data: {"type":"done"}\n'),
    ];
    let chunkIndex = 0;
    mockFetch.mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: () => {
            if (chunkIndex < chunks.length) {
              return Promise.resolve({ done: false, value: chunks[chunkIndex++] });
            }
            return Promise.resolve({ done: true, value: undefined });
          },
        }),
      },
    });

    const events: Record<string, unknown>[] = [];
    for await (const event of client.streamChat('hello')) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'text', content: 'hello' },
      { type: 'done' },
    ]);
  });

  it('skips non-data lines and invalid JSON', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    const chunk = new TextEncoder().encode(
      'event: ping\ndata: not-json\ndata: {"valid":true}\n',
    );
    let sent = false;
    mockFetch.mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: () => {
            if (!sent) {
              sent = true;
              return Promise.resolve({ done: false, value: chunk });
            }
            return Promise.resolve({ done: true, value: undefined });
          },
        }),
      },
    });

    const events: Record<string, unknown>[] = [];
    for await (const event of client.streamChat('test')) {
      events.push(event);
    }

    expect(events).toEqual([{ valid: true }]);
  });

  it('returns immediately when response has no body', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: true, body: null });

    const events: Record<string, unknown>[] = [];
    for await (const event of client.streamChat('test')) {
      events.push(event);
    }

    expect(events).toEqual([]);
  });

  it('throws on non-ok response', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Plan required'),
    });

    const gen = client.streamChat('test');
    await expect(gen.next()).rejects.toThrow('AI chat failed: 403 Plan required');
  });

  it('sends conversationId when provided', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: true, body: null });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of client.streamChat('hello', 'conv-123')) { /* drain */ }

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ message: 'hello', conversationId: 'conv-123' });
  });
});

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

describe('PlatformClient.validate', () => {
  it('returns true when /ready is ok', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: true });

    expect(await client.validate()).toBe(true);
  });

  it('returns false when /ready is not ok', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false });

    expect(await client.validate()).toBe(false);
  });

  it('returns false when fetch throws', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockRejectedValue(new Error('network error'));

    expect(await client.validate()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AI Credentials
// ---------------------------------------------------------------------------

describe('PlatformClient.createAiCredential', () => {
  it('sends POST /ai-credentials and returns credential', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    const cred = { id: 'c1', provider: 'anthropic', label: 'key', createdAt: '2026-01-01' };
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ credential: cred }) });

    const result = await client.createAiCredential({ provider: 'anthropic', label: 'key', apiKey: 'sk-test' });
    expect(result).toEqual(cred);
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });

  it('throws with error from response', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 400, json: () => Promise.resolve({ error: 'Invalid provider' }) });
    await expect(client.createAiCredential({ provider: 'bad', label: 'k', apiKey: 'k' })).rejects.toThrow('Invalid provider');
  });

  it('throws with fallback when no error field', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Error', json: () => Promise.resolve({}) });
    await expect(client.createAiCredential({ provider: 'a', label: 'k', apiKey: 'k' })).rejects.toThrow('Failed to add credential: 500');
  });

  it('throws statusText when json fails', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Err', json: () => Promise.reject(new Error()) });
    await expect(client.createAiCredential({ provider: 'a', label: 'k', apiKey: 'k' })).rejects.toThrow('Err');
  });
});

describe('PlatformClient.listAiCredentials', () => {
  it('returns credentials array', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    const creds = [{ id: 'c1', provider: 'anthropic', label: 'k', isDefault: true, createdAt: '2026-01-01' }];
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ credentials: creds }) });
    expect(await client.listAiCredentials()).toEqual(creds);
  });

  it('throws on error', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 401 });
    await expect(client.listAiCredentials()).rejects.toThrow('Failed to list credentials: 401');
  });

  it('returns empty array on malformed JSON', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.reject(new Error('bad')) });
    expect(await client.listAiCredentials()).toEqual([]);
  });

  it('returns empty array when response lacks credentials field', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    expect(await client.listAiCredentials()).toEqual([]);
  });
});

describe('PlatformClient.revokeAiCredential', () => {
  it('sends DELETE', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: true, status: 204 });
    await client.revokeAiCredential('c1');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
  });

  it('throws on 404', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 404 });
    await expect(client.revokeAiCredential('c1')).rejects.toThrow('Credential not found');
  });

  it('throws on other error', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(client.revokeAiCredential('c1')).rejects.toThrow('Failed to revoke credential: 500');
  });
});

describe('PlatformClient.testAiCredential', () => {
  it('returns test result', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) });
    expect(await client.testAiCredential('c1')).toEqual({ success: true });
  });

  it('throws with error from response', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 400, json: () => Promise.resolve({ error: 'Bad key' }) });
    await expect(client.testAiCredential('c1')).rejects.toThrow('Bad key');
  });

  it('throws fallback when no error field', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Err', json: () => Promise.resolve({}) });
    await expect(client.testAiCredential('c1')).rejects.toThrow('Test failed: 500');
  });

  it('throws statusText when json fails', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 502, statusText: 'GW', json: () => Promise.reject(new Error()) });
    await expect(client.testAiCredential('c1')).rejects.toThrow('GW');
  });

  it('returns success fallback on malformed JSON', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.reject(new Error('bad')) });
    expect(await client.testAiCredential('c1')).toEqual({ success: true });
  });
});

// ---------------------------------------------------------------------------
// Detailed Usage
// ---------------------------------------------------------------------------

describe('PlatformClient.getDetailedUsage', () => {
  it('returns usage data from /billing/usage', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    const usage = { plan: 'free', usage: { workflows: { used: 1, limit: 3 }, deployments: { used: 0, limit: 1 }, executions: { used: 10, limit: 100, period: 'month' } }, limits: { timeoutMs: 10000 } };
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(usage) });
    expect(await client.getDetailedUsage()).toEqual(usage);
  });

  it('throws on error', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(client.getDetailedUsage()).rejects.toThrow('Failed to fetch usage: 500');
  });

  it('throws on malformed JSON response', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.reject(new Error('bad json')) });
    await expect(client.getDetailedUsage()).rejects.toThrow('Invalid usage response');
  });
});

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

describe('PlatformClient.listOrgs', () => {
  it('returns orgs array', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    const orgs = [{ id: 'o1', name: 'Acme', slug: 'acme', role: 'owner', createdAt: '2026-01-01' }];
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(orgs) });
    expect(await client.listOrgs()).toEqual(orgs);
  });

  it('throws on error', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 401 });
    await expect(client.listOrgs()).rejects.toThrow('Failed to list organizations: 401');
  });

  it('returns empty array on malformed JSON', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.reject(new Error('bad')) });
    expect(await client.listOrgs()).toEqual([]);
  });

  it('returns empty array when response is not an array', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ organizations: [] }) });
    expect(await client.listOrgs()).toEqual([]);
  });
});

describe('PlatformClient.createOrg', () => {
  it('creates org and returns data', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    const org = { id: 'o1', name: 'New', slug: 'new' };
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(org) });
    expect(await client.createOrg('New')).toEqual(org);
  });

  it('throws on malformed JSON response', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.reject(new Error('bad')) });
    await expect(client.createOrg('X')).rejects.toThrow('Invalid organization response');
  });

  it('throws with error from response', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 403, json: () => Promise.resolve({ error: 'Pro required' }) });
    await expect(client.createOrg('x')).rejects.toThrow('Pro required');
  });

  it('throws fallback', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'E', json: () => Promise.resolve({}) });
    await expect(client.createOrg('x')).rejects.toThrow('Failed to create organization: 500');
  });

  it('throws statusText when json fails', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'E', json: () => Promise.reject(new Error()) });
    await expect(client.createOrg('x')).rejects.toThrow('E');
  });
});

describe('PlatformClient.getOrg', () => {
  it('returns org with members', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    const org = { id: 'o1', name: 'A', slug: 'a', members: [] };
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(org) });
    expect(await client.getOrg('o1')).toEqual(org);
  });

  it('throws on error', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 403 });
    await expect(client.getOrg('o1')).rejects.toThrow('Failed to get organization: 403');
  });

  it('throws on malformed JSON response', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.reject(new Error('bad')) });
    await expect(client.getOrg('o1')).rejects.toThrow('Invalid organization response');
  });
});

describe('PlatformClient.inviteOrgMember', () => {
  it('sends POST with email and role', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) });
    await client.inviteOrgMember('o1', 'a@b.com', 'viewer');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ email: 'a@b.com', role: 'viewer' });
  });

  it('defaults role to editor', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) });
    await client.inviteOrgMember('o1', 'a@b.com');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.role).toBe('editor');
  });

  it('throws with error from response', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 403, json: () => Promise.resolve({ error: 'Not owner' }) });
    await expect(client.inviteOrgMember('o1', 'a@b.com')).rejects.toThrow('Not owner');
  });

  it('throws fallback', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'E', json: () => Promise.resolve({}) });
    await expect(client.inviteOrgMember('o1', 'a@b.com')).rejects.toThrow('Failed to invite member: 500');
  });

  it('throws statusText when json fails', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'E', json: () => Promise.reject(new Error()) });
    await expect(client.inviteOrgMember('o1', 'a@b.com')).rejects.toThrow('E');
  });
});

describe('PlatformClient.removeOrgMember', () => {
  it('sends DELETE to correct path', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: true });
    await client.removeOrgMember('o1', 'u2');
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.flowweaver.ai/organizations/o1/members/u2');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
  });

  it('throws with error from response', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({ error: 'Not found' }) });
    await expect(client.removeOrgMember('o1', 'u2')).rejects.toThrow('Not found');
  });

  it('throws fallback', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'E', json: () => Promise.resolve({}) });
    await expect(client.removeOrgMember('o1', 'u2')).rejects.toThrow('Failed to remove member: 500');
  });

  it('throws statusText when json fails', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'E', json: () => Promise.reject(new Error()) });
    await expect(client.removeOrgMember('o1', 'u2')).rejects.toThrow('E');
  });
});
