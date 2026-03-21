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
      'Content-Type': 'application/json',
      ...(isApiKey
        ? { 'X-API-Key': this.token }
        : { Authorization: `Bearer ${this.token}` }),
      ...(opts.headers as Record<string, string> ?? {}),
    };
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
