/**
 * Tests for PlatformClient API key methods (createApiKey, listApiKeys, revokeApiKey).
 * No module mocks — tests the real PlatformClient with a stubbed global fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlatformClient } from '../../src/cli/config/platform-client';
import type { StoredCredentials } from '../../src/cli/config/credentials';

const MOCK_CREDS: StoredCredentials = {
  token: 'test-jwt-token',
  email: 'user@test.com',
  plan: 'free',
  platformUrl: 'https://test.flowweaver.ai',
  expiresAt: Date.now() + 86_400_000,
  userId: 'user-123',
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
// createApiKey
// ---------------------------------------------------------------------------

describe('PlatformClient.createApiKey', () => {
  it('sends POST /api-keys with name and returns key data', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    const apiKeyData = { id: 'id-1', name: 'test', keyPrefix: 'fw_abc', key: 'fw_abc123', createdAt: '2026-01-01' };
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ apiKey: apiKeyData }),
    });

    const result = await client.createApiKey('test');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://test.flowweaver.ai/api-keys',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'test' }),
      }),
    );
    expect(result).toEqual(apiKeyData);
  });

  it('throws with error message from response body', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'Name is required' }),
    });

    await expect(client.createApiKey('')).rejects.toThrow('Name is required');
  });

  it('throws with fallback message when response has no error field', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({}),
    });

    await expect(client.createApiKey('test')).rejects.toThrow('Failed to create API key: 500');
  });

  it('throws with statusText when json parsing fails', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: () => Promise.reject(new Error('not json')),
    });

    await expect(client.createApiKey('test')).rejects.toThrow('Bad Gateway');
  });
});

// ---------------------------------------------------------------------------
// listApiKeys
// ---------------------------------------------------------------------------

describe('PlatformClient.listApiKeys', () => {
  it('sends GET /api-keys and returns array', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    const keys = [{ id: 'id-1', name: 'k1', keyPrefix: 'fw_a', createdAt: '2026-01-01' }];
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ apiKeys: keys }),
    });

    const result = await client.listApiKeys();

    expect(mockFetch).toHaveBeenCalledWith(
      'https://test.flowweaver.ai/api-keys',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-jwt-token' }),
      }),
    );
    expect(result).toEqual(keys);
  });

  it('throws on non-ok response', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 401 });

    await expect(client.listApiKeys()).rejects.toThrow('Failed to list API keys: 401');
  });

  it('returns empty array on malformed JSON', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.reject(new Error('bad')) });
    expect(await client.listApiKeys()).toEqual([]);
  });

  it('returns empty array when response lacks apiKeys field', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    expect(await client.listApiKeys()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// revokeApiKey
// ---------------------------------------------------------------------------

describe('PlatformClient.revokeApiKey', () => {
  it('sends DELETE /api-keys/:id', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: true, status: 204 });

    await client.revokeApiKey('key-id-123');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://test.flowweaver.ai/api-keys/key-id-123',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('throws on 404 (not found or already revoked)', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    await expect(client.revokeApiKey('bad-id')).rejects.toThrow('API key not found or already revoked');
  });

  it('throws on other non-ok status', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    await expect(client.revokeApiKey('id')).rejects.toThrow('Failed to revoke API key: 500');
  });
});

// ---------------------------------------------------------------------------
// Auth header detection
// ---------------------------------------------------------------------------

describe('PlatformClient auth headers', () => {
  it('uses X-API-Key header for fw_ tokens', async () => {
    const client = new PlatformClient({ ...MOCK_CREDS, token: 'fw_testkey123' });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ apiKeys: [] }),
    });

    await client.listApiKeys();

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['X-API-Key']).toBe('fw_testkey123');
    expect(headers['Authorization']).toBeUndefined();
  });

  it('uses Bearer header for JWT tokens', async () => {
    const client = new PlatformClient(MOCK_CREDS);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ apiKeys: [] }),
    });

    await client.listApiKeys();

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['Authorization']).toBe('Bearer test-jwt-token');
    expect(headers['X-API-Key']).toBeUndefined();
  });

  it('strips trailing slashes from platform URL', async () => {
    const client = new PlatformClient({ ...MOCK_CREDS, platformUrl: 'https://test.flowweaver.ai///' });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ apiKeys: [] }),
    });

    await client.listApiKeys();

    expect(mockFetch.mock.calls[0][0]).toBe('https://test.flowweaver.ai/api-keys');
  });
});
