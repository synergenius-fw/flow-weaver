/**
 * Tests for src/cli/config/platform-client.ts
 * Covers PlatformClient methods: auth, workflow push, deploy, undeploy,
 * deployments listing, usage, validation, and SSE chat streaming.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlatformClient, createPlatformClient } from '../../src/cli/config/platform-client.js';
import type { StoredCredentials } from '../../src/cli/config/credentials.js';

// ── Helpers ────────────────────────────────────────────────────────

function makeCreds(overrides: Partial<StoredCredentials> = {}): StoredCredentials {
  return {
    token: 'jwt-token-abc',
    email: 'user@example.com',
    plan: 'pro',
    platformUrl: 'https://api.example.com',
    expiresAt: Date.now() + 3600_000,
    ...overrides,
  };
}

function mockResponse(body: unknown, init: { status?: number; ok?: boolean; headers?: Record<string, string> } = {}): Response {
  const status = init.status ?? 200;
  const ok = init.ok ?? (status >= 200 && status < 300);
  return {
    ok,
    status,
    statusText: `Status ${status}`,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
    headers: new Headers(init.headers),
    body: null,
  } as unknown as Response;
}

function mockSSEResponse(lines: string[]): Response {
  const encoded = new TextEncoder().encode(lines.join('\n') + '\n');
  let read = false;
  const reader = {
    read: vi.fn().mockImplementation(async () => {
      if (!read) {
        read = true;
        return { done: false, value: encoded };
      }
      return { done: true, value: undefined };
    }),
  };
  return {
    ok: true,
    status: 200,
    body: { getReader: () => reader },
  } as unknown as Response;
}

// ── Tests ──────────────────────────────────────────────────────────

describe('PlatformClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  // ── Constructor ────────────────────────────────────────────────

  describe('constructor', () => {
    it('sets baseUrl and token from credentials', () => {
      const client = new PlatformClient(makeCreds({ platformUrl: 'https://api.example.com/' }));
      // Trailing slash should be stripped
      fetchMock.mockResolvedValue(mockResponse({ deployments: [] }));
      client.listDeployments(); // trigger a fetch to inspect URL
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/deployments',
        expect.any(Object),
      );
    });
  });

  // ── createPlatformClient ───────────────────────────────────────

  describe('createPlatformClient', () => {
    it('returns a PlatformClient instance', () => {
      const client = createPlatformClient(makeCreds());
      expect(client).toBeInstanceOf(PlatformClient);
    });
  });

  // ── getUser ────────────────────────────────────────────────────

  describe('getUser', () => {
    it('calls GET /auth/me and returns user', async () => {
      const user = { id: '1', email: 'u@e.com', name: 'User', plan: 'pro' };
      fetchMock.mockResolvedValue(mockResponse({ user }));

      const client = new PlatformClient(makeCreds());
      const result = await client.getUser();

      expect(result).toEqual(user);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/auth/me',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('uses X-API-Key header for API key tokens', async () => {
      const user = { id: '1', email: 'u@e.com', name: 'User', plan: 'pro' };
      fetchMock.mockResolvedValue(mockResponse({ user }));

      const client = new PlatformClient(makeCreds({ token: 'fw_apikey123' }));
      await client.getUser();

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-API-Key': 'fw_apikey123',
          }),
        }),
      );
    });

    it('uses Authorization Bearer header for JWT tokens', async () => {
      const user = { id: '1', email: 'u@e.com', name: 'User', plan: 'pro' };
      fetchMock.mockResolvedValue(mockResponse({ user }));

      const client = new PlatformClient(makeCreds({ token: 'jwt-token-abc' }));
      await client.getUser();

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer jwt-token-abc',
          }),
        }),
      );
    });

    it('throws on non-200 response', async () => {
      fetchMock.mockResolvedValue(mockResponse({}, { status: 401, ok: false }));

      const client = new PlatformClient(makeCreds());
      await expect(client.getUser()).rejects.toThrow('Auth failed: 401');
    });
  });

  // ── pushWorkflow ───────────────────────────────────────────────

  describe('pushWorkflow', () => {
    it('calls PUT first, returns slug and version on success', async () => {
      const workflow = { slug: 'my-wf', version: 3 };
      fetchMock.mockResolvedValue(mockResponse({ workflow }));

      const client = new PlatformClient(makeCreds());
      const result = await client.pushWorkflow('My WF', 'source-code');

      expect(result).toEqual(workflow);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/workflows/my-wf',
        expect.objectContaining({ method: 'PUT' }),
      );
    });

    it('falls back to POST on 404 from PUT', async () => {
      const putResp = mockResponse({}, { status: 404, ok: false });
      const workflow = { slug: 'my-wf', version: 1 };
      const postResp = mockResponse({ workflow });

      fetchMock.mockResolvedValueOnce(putResp).mockResolvedValueOnce(postResp);

      const client = new PlatformClient(makeCreds());
      const result = await client.pushWorkflow('My WF', 'source-code');

      expect(result).toEqual(workflow);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://api.example.com/workflows',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('throws on error response', async () => {
      fetchMock.mockResolvedValue(mockResponse({ error: 'Quota exceeded' }, { status: 429, ok: false }));

      const client = new PlatformClient(makeCreds());
      await expect(client.pushWorkflow('test', 'src')).rejects.toThrow('Quota exceeded');
    });

    it('slugifies workflow name correctly', async () => {
      const workflow = { slug: 'hello-world', version: 1 };
      fetchMock.mockResolvedValue(mockResponse({ workflow }));

      const client = new PlatformClient(makeCreds());
      await client.pushWorkflow('Hello World!', 'src');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/workflows/hello-world-',
        expect.objectContaining({ method: 'PUT' }),
      );
    });
  });

  // ── deploy ─────────────────────────────────────────────────────

  describe('deploy', () => {
    it('calls POST /workflows/:slug/deploy', async () => {
      const deployment = { slug: 'my-wf', status: 'active' };
      fetchMock.mockResolvedValue(mockResponse({ deployment }));

      const client = new PlatformClient(makeCreds());
      const result = await client.deploy('my-wf');

      expect(result).toEqual(deployment);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/workflows/my-wf/deploy',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('throws on error', async () => {
      fetchMock.mockResolvedValue(mockResponse({ error: 'Not found' }, { status: 404, ok: false }));

      const client = new PlatformClient(makeCreds());
      await expect(client.deploy('missing')).rejects.toThrow('Not found');
    });
  });

  // ── undeploy ───────────────────────────────────────────────────

  describe('undeploy', () => {
    it('calls DELETE /deployments/:slug', async () => {
      fetchMock.mockResolvedValue(mockResponse({}, { status: 200 }));

      const client = new PlatformClient(makeCreds());
      await client.undeploy('my-wf');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/deployments/my-wf',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('does not throw on 404', async () => {
      fetchMock.mockResolvedValue(mockResponse({}, { status: 404, ok: false }));

      const client = new PlatformClient(makeCreds());
      await expect(client.undeploy('missing')).resolves.toBeUndefined();
    });

    it('throws on other error statuses', async () => {
      fetchMock.mockResolvedValue(mockResponse({}, { status: 500, ok: false }));

      const client = new PlatformClient(makeCreds());
      await expect(client.undeploy('broken')).rejects.toThrow('Undeploy failed: 500');
    });
  });

  // ── listDeployments ────────────────────────────────────────────

  describe('listDeployments', () => {
    it('returns array of deployments', async () => {
      const deployments = [
        { slug: 'wf-1', status: 'active', workflowName: 'WF 1' },
        { slug: 'wf-2', status: 'stopped' },
      ];
      fetchMock.mockResolvedValue(mockResponse({ deployments }));

      const client = new PlatformClient(makeCreds());
      const result = await client.listDeployments();

      expect(result).toEqual(deployments);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/deployments',
        expect.any(Object),
      );
    });

    it('throws on error', async () => {
      fetchMock.mockResolvedValue(mockResponse({}, { status: 500, ok: false }));

      const client = new PlatformClient(makeCreds());
      await expect(client.listDeployments()).rejects.toThrow('List failed: 500');
    });
  });

  // ── getUsage ───────────────────────────────────────────────────

  describe('getUsage', () => {
    it('returns usage object on success', async () => {
      const usage = { executions: 42, aiCalls: 10, plan: 'pro' };
      fetchMock.mockResolvedValue(mockResponse(usage));

      const client = new PlatformClient(makeCreds());
      const result = await client.getUsage();

      expect(result).toEqual(usage);
    });

    it('returns defaults on error', async () => {
      fetchMock.mockResolvedValue(mockResponse({}, { status: 500, ok: false }));

      const client = new PlatformClient(makeCreds());
      const result = await client.getUsage();

      expect(result).toEqual({ executions: 0, aiCalls: 0, plan: 'unknown' });
    });
  });

  // ── validate ───────────────────────────────────────────────────

  describe('validate', () => {
    it('calls GET /ready and returns true on success', async () => {
      fetchMock.mockResolvedValue(mockResponse({}, { status: 200 }));

      const client = new PlatformClient(makeCreds());
      const result = await client.validate();

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/ready',
        expect.any(Object),
      );
    });

    it('returns false on non-ok response', async () => {
      fetchMock.mockResolvedValue(mockResponse({}, { status: 503, ok: false }));

      const client = new PlatformClient(makeCreds());
      expect(await client.validate()).toBe(false);
    });

    it('returns false on network error', async () => {
      fetchMock.mockRejectedValue(new Error('Network error'));

      const client = new PlatformClient(makeCreds());
      expect(await client.validate()).toBe(false);
    });
  });

  // ── streamChat ─────────────────────────────────────────────────

  describe('streamChat', () => {
    it('sends POST to /ai-chat/stream and parses SSE data lines', async () => {
      const sseResp = mockSSEResponse([
        'data: {"type":"text","content":"Hello"}',
        'data: {"type":"text","content":" World"}',
        '',
      ]);
      fetchMock.mockResolvedValue(sseResp);

      const client = new PlatformClient(makeCreds());
      const chunks: Record<string, unknown>[] = [];
      for await (const chunk of client.streamChat('Hi', 'conv-1')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        { type: 'text', content: 'Hello' },
        { type: 'text', content: ' World' },
      ]);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/ai-chat/stream',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ message: 'Hi', conversationId: 'conv-1' }),
        }),
      );
    });

    it('skips non-data lines', async () => {
      const sseResp = mockSSEResponse([
        'event: ping',
        'data: {"type":"text","content":"ok"}',
        ': comment',
      ]);
      fetchMock.mockResolvedValue(sseResp);

      const client = new PlatformClient(makeCreds());
      const chunks: Record<string, unknown>[] = [];
      for await (const chunk of client.streamChat('test')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([{ type: 'text', content: 'ok' }]);
    });

    it('skips lines with invalid JSON after data: prefix', async () => {
      const sseResp = mockSSEResponse([
        'data: not-json',
        'data: {"valid":true}',
      ]);
      fetchMock.mockResolvedValue(sseResp);

      const client = new PlatformClient(makeCreds());
      const chunks: Record<string, unknown>[] = [];
      for await (const chunk of client.streamChat('test')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([{ valid: true }]);
    });

    it('throws on error response', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('Internal Server Error'),
        body: null,
      } as unknown as Response);

      const client = new PlatformClient(makeCreds());
      const gen = client.streamChat('test');
      await expect(gen.next()).rejects.toThrow('AI chat failed: 500');
    });

    it('handles empty body gracefully', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        body: null,
      } as unknown as Response);

      const client = new PlatformClient(makeCreds());
      const chunks: Record<string, unknown>[] = [];
      for await (const chunk of client.streamChat('test')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([]);
    });
  });
});
