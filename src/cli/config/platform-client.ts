import type { StoredCredentials } from './credentials.js';

export class PlatformClient {
  private baseUrl: string;
  private token: string;

  constructor(creds: StoredCredentials) {
    this.baseUrl = creds.platformUrl.replace(/\/+$/, '');
    this.token = creds.token;
  }

  private async fetch(path: string, opts: RequestInit = {}): Promise<Response> {
    const isApiKey = this.token.startsWith('fw_');
    const headers: Record<string, string> = {
      ...(isApiKey
        ? { 'X-API-Key': this.token }
        : { Authorization: `Bearer ${this.token}` }),
      ...(opts.headers as Record<string, string> ?? {}),
    };
    // Only set Content-Type for requests with a body (Fastify rejects empty body with application/json)
    if (opts.body) {
      headers['Content-Type'] = 'application/json';
    }
    return fetch(`${this.baseUrl}${path}`, { ...opts, headers });
  }

  // Auth
  async getUser(): Promise<{ id: string; email: string; name: string; plan: string }> {
    const resp = await this.fetch('/auth/me');
    if (!resp.ok) throw new Error(`Auth failed: ${resp.status}`);
    const data = await resp.json() as { user: { id: string; email: string; name: string; plan: string } };
    return data.user;
  }

  // Workflows
  async pushWorkflow(name: string, source: string): Promise<{ slug: string; version: number }> {
    // Try update first, then create
    const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
    let resp = await this.fetch(`/workflows/${slug}`, {
      method: 'PUT',
      body: JSON.stringify({ source, name }),
    });
    if (resp.status === 404) {
      resp = await this.fetch('/workflows', {
        method: 'POST',
        body: JSON.stringify({ source, name }),
      });
    }
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText })) as { error: string };
      throw new Error(err.error ?? `Push failed: ${resp.status}`);
    }
    const data = await resp.json() as { workflow: { slug: string; version: number } };
    return data.workflow;
  }

  async deploy(slug: string): Promise<{ slug: string; status: string }> {
    const resp = await this.fetch(`/workflows/${slug}/deploy`, { method: 'POST' });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText })) as { error: string };
      throw new Error(err.error ?? `Deploy failed: ${resp.status}`);
    }
    const data = await resp.json() as { deployment: { slug: string; status: string } };
    return data.deployment;
  }

  async undeploy(slug: string): Promise<void> {
    const resp = await this.fetch(`/deployments/${slug}`, { method: 'DELETE' });
    if (!resp.ok && resp.status !== 404) throw new Error(`Undeploy failed: ${resp.status}`);
  }

  async listDeployments(): Promise<Array<{ slug: string; status: string; workflowName?: string }>> {
    const resp = await this.fetch('/deployments');
    if (!resp.ok) throw new Error(`List failed: ${resp.status}`);
    const data = await resp.json() as { deployments: Array<{ slug: string; status: string; workflowName?: string }> };
    return data.deployments;
  }

  // Usage
  async getUsage(): Promise<{ executions: number; aiCalls: number; plan: string }> {
    const resp = await this.fetch('/monitoring/usage');
    if (!resp.ok) return { executions: 0, aiCalls: 0, plan: 'unknown' };
    return await resp.json() as { executions: number; aiCalls: number; plan: string };
  }

  // AI Chat streaming
  async *streamChat(message: string, conversationId?: string): AsyncGenerator<Record<string, unknown>> {
    const resp = await this.fetch('/ai-chat/stream', {
      method: 'POST',
      body: JSON.stringify({ message, conversationId }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`AI chat failed: ${resp.status} ${err.slice(0, 200)}`);
    }
    if (!resp.body) return;
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          yield JSON.parse(line.slice(6));
        } catch { /* skip non-JSON */ }
      }
    }
  }

  // API Keys
  async createApiKey(name: string): Promise<{ id: string; name: string; keyPrefix: string; key: string; createdAt: string }> {
    const resp = await this.fetch('/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText })) as { error: string };
      throw new Error(err.error ?? `Failed to create API key: ${resp.status}`);
    }
    const data = await resp.json() as { apiKey: { id: string; name: string; keyPrefix: string; key: string; createdAt: string } };
    return data.apiKey;
  }

  async listApiKeys(): Promise<Array<{ id: string; name: string; keyPrefix: string; createdAt: string }>> {
    const resp = await this.fetch('/api-keys');
    if (!resp.ok) {
      throw new Error(`Failed to list API keys: ${resp.status}`);
    }
    const data = await resp.json().catch(() => ({ apiKeys: [] })) as { apiKeys: Array<{ id: string; name: string; keyPrefix: string; createdAt: string }> };
    return data.apiKeys ?? [];
  }

  async revokeApiKey(id: string): Promise<void> {
    const resp = await this.fetch(`/api-keys/${id}`, { method: 'DELETE' });
    if (resp.status === 404) {
      throw new Error('API key not found or already revoked');
    }
    if (!resp.ok) {
      throw new Error(`Failed to revoke API key: ${resp.status}`);
    }
  }

  // AI Credentials
  async createAiCredential(opts: {
    provider: string;
    label: string;
    apiKey: string;
    baseUrl?: string;
    defaultModel?: string;
    isDefault?: boolean;
  }): Promise<{ id: string; provider: string; label: string; createdAt: string }> {
    const resp = await this.fetch('/ai-credentials', {
      method: 'POST',
      body: JSON.stringify(opts),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText })) as { error: string };
      throw new Error(err.error ?? `Failed to add credential: ${resp.status}`);
    }
    const data = await resp.json() as { credential: { id: string; provider: string; label: string; createdAt: string } };
    return data.credential;
  }

  async listAiCredentials(): Promise<Array<{ id: string; provider: string; label: string; defaultModel?: string; isDefault: boolean; createdAt: string }>> {
    const resp = await this.fetch('/ai-credentials');
    if (!resp.ok) throw new Error(`Failed to list credentials: ${resp.status}`);
    const data = await resp.json().catch(() => ({ credentials: [] })) as { credentials: Array<{ id: string; provider: string; label: string; defaultModel?: string; isDefault: boolean; createdAt: string }> };
    return data.credentials ?? [];
  }

  async revokeAiCredential(id: string): Promise<void> {
    const resp = await this.fetch(`/ai-credentials/${id}`, { method: 'DELETE' });
    if (resp.status === 404) throw new Error('Credential not found');
    if (!resp.ok) throw new Error(`Failed to revoke credential: ${resp.status}`);
  }

  async testAiCredential(id: string): Promise<{ success: boolean; message?: string }> {
    const resp = await this.fetch(`/ai-credentials/${id}/test`, { method: 'POST' });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText })) as { error: string };
      throw new Error(err.error ?? `Test failed: ${resp.status}`);
    }
    return await resp.json().catch(() => ({ success: true })) as { success: boolean; message?: string };
  }

  // Billing / Usage
  async getDetailedUsage(): Promise<{
    plan: string;
    usage: {
      workflows: { used: number; limit: number };
      deployments: { used: number; limit: number };
      executions: { used: number; limit: number; period: string };
    };
    limits: { timeoutMs: number };
  }> {
    const resp = await this.fetch('/billing/usage');
    if (!resp.ok) throw new Error(`Failed to fetch usage: ${resp.status}`);
    const data = await resp.json().catch(() => null) as { plan: string; usage: { workflows: { used: number; limit: number }; deployments: { used: number; limit: number }; executions: { used: number; limit: number; period: string } }; limits: { timeoutMs: number } } | null;
    if (!data?.usage) throw new Error('Invalid usage response');
    return data;
  }

  // Organizations
  async listOrgs(): Promise<Array<{ id: string; name: string; slug: string; role: string; createdAt: string }>> {
    const resp = await this.fetch('/organizations');
    if (!resp.ok) throw new Error(`Failed to list organizations: ${resp.status}`);
    const data = await resp.json().catch(() => []);
    return Array.isArray(data) ? data : [];
  }

  async createOrg(name: string): Promise<{ id: string; name: string; slug: string }> {
    const resp = await this.fetch('/organizations', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText })) as { error: string };
      throw new Error(err.error ?? `Failed to create organization: ${resp.status}`);
    }
    const data = await resp.json().catch(() => null) as { id: string; name: string; slug: string } | null;
    if (!data) throw new Error('Invalid organization response');
    return data;
  }

  async getOrg(orgId: string): Promise<{
    id: string;
    name: string;
    slug: string;
    members: Array<{ userId: string; name: string; email: string; role: string; joinedAt: string }>;
  }> {
    const resp = await this.fetch(`/organizations/${orgId}`);
    if (!resp.ok) throw new Error(`Failed to get organization: ${resp.status}`);
    const data = await resp.json().catch(() => null) as { id: string; name: string; slug: string; members: Array<{ userId: string; name: string; email: string; role: string; joinedAt: string }> } | null;
    if (!data) throw new Error('Invalid organization response');
    return data;
  }

  async inviteOrgMember(orgId: string, email: string, role: string = 'editor'): Promise<void> {
    const resp = await this.fetch(`/organizations/${orgId}/members`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText })) as { error: string };
      throw new Error(err.error ?? `Failed to invite member: ${resp.status}`);
    }
  }

  async removeOrgMember(orgId: string, userId: string): Promise<void> {
    const resp = await this.fetch(`/organizations/${orgId}/members/${userId}`, { method: 'DELETE' });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText })) as { error: string };
      throw new Error(err.error ?? `Failed to remove member: ${resp.status}`);
    }
  }

  // Validate connection
  async validate(): Promise<boolean> {
    try {
      const resp = await this.fetch('/ready');
      return resp.ok;
    } catch { return false; }
  }
}

export function createPlatformClient(creds: StoredCredentials): PlatformClient {
  return new PlatformClient(creds);
}
