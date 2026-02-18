/**
 * Approval Strategy Code Generators
 * Generate approval provider implementation code for different strategies.
 *
 * Mirrors the LLM provider pattern in providers/index.ts.
 */

export function generateMockApproval(): string {
  return `/* ============================================================
 * MOCK APPROVAL PROVIDER (For Testing)
 * Auto-approves all requests. Replace with a real strategy for production.
 * ============================================================ */

const _defaultApprovalProvider: ApprovalProvider = {
  async requestApproval(request) {
    console.log('[Mock Approval] Auto-approving:', request.prompt);
    return {
      approved: true,
      response: 'Auto-approved (mock)',
      reviewer: 'system',
    };
  },
};

const approvalProvider: ApprovalProvider = (globalThis as unknown as { __fw_approval_provider__?: ApprovalProvider }).__fw_approval_provider__ ?? _defaultApprovalProvider;`;
}

export function generateCallbackApproval(): string {
  return `/* ============================================================
 * CALLBACK APPROVAL PROVIDER
 *
 * Pauses the workflow on a Promise. Call resolveApproval() from
 * your HTTP handler, webhook, or external system to resume.
 *
 * Example integration:
 *   app.post('/approve/:id', (req, res) => {
 *     resolveApproval(req.params.id, true, req.body.response, req.body.reviewer);
 *     res.json({ ok: true });
 *   });
 * ============================================================ */

const _pendingApprovals = new Map<string, {
  resolve: (result: ApprovalResult) => void;
  request: ApprovalRequest;
  createdAt: number;
}>();

/**
 * Resolve a pending approval. Call this from your HTTP handler or external system.
 * Returns true if the approval was found and resolved, false if not found.
 */
function resolveApproval(
  id: string,
  approved: boolean,
  response?: string,
  reviewer?: string,
): boolean {
  const pending = _pendingApprovals.get(id);
  if (!pending) return false;
  pending.resolve({ approved, response, reviewer });
  _pendingApprovals.delete(id);
  return true;
}

/** Get all currently pending approval requests */
function getPendingApprovals(): Array<{ id: string; request: ApprovalRequest; createdAt: number }> {
  return [..._pendingApprovals.entries()].map(([id, entry]) => ({
    id,
    request: entry.request,
    createdAt: entry.createdAt,
  }));
}

const _defaultApprovalProvider: ApprovalProvider = {
  async requestApproval(request) {
    const id = request.id || crypto.randomUUID();
    console.log(\`[Approval] Waiting for approval: \${id} — "\${request.prompt}"\`);

    return new Promise<ApprovalResult>((resolve) => {
      _pendingApprovals.set(id, { resolve, request, createdAt: Date.now() });

      // Set up timeout if specified
      if (request.timeout) {
        const ms = parseTimeout(request.timeout);
        if (ms > 0) {
          setTimeout(() => {
            if (_pendingApprovals.has(id)) {
              _pendingApprovals.delete(id);
              resolve({ approved: false, response: 'Timed out' });
            }
          }, ms);
        }
      }
    });
  },
};

/** Parse timeout string like "7d", "24h", "30m" to milliseconds */
function parseTimeout(timeout: string): number {
  const match = timeout.match(/^(\\d+)\\s*(ms|s|m|h|d)$/);
  if (!match) return 0;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * (multipliers[unit] ?? 0);
}

const approvalProvider: ApprovalProvider = (globalThis as unknown as { __fw_approval_provider__?: ApprovalProvider }).__fw_approval_provider__ ?? _defaultApprovalProvider;`;
}

export function generateWebhookApproval(): string {
  return `/* ============================================================
 * WEBHOOK APPROVAL PROVIDER
 *
 * Extends the callback pattern with a ready-made request handler.
 * Mount createApprovalHandler() in your HTTP framework:
 *
 *   Express:  app.use('/approvals', createApprovalHandler());
 *   Hono:     app.route('/approvals', createApprovalHandler());
 *   Node.js:  http.createServer(createApprovalHandler());
 *
 * Endpoints:
 *   POST /approve/:id  — Approve a request  (body: { response?, reviewer? })
 *   POST /reject/:id   — Reject a request   (body: { response?, reviewer? })
 *   GET  /pending       — List pending approvals
 * ============================================================ */

const _pendingApprovals = new Map<string, {
  resolve: (result: ApprovalResult) => void;
  request: ApprovalRequest;
  createdAt: number;
}>();

function resolveApproval(
  id: string,
  approved: boolean,
  response?: string,
  reviewer?: string,
): boolean {
  const pending = _pendingApprovals.get(id);
  if (!pending) return false;
  pending.resolve({ approved, response, reviewer });
  _pendingApprovals.delete(id);
  return true;
}

function getPendingApprovals(): Array<{ id: string; request: ApprovalRequest; createdAt: number }> {
  return [..._pendingApprovals.entries()].map(([id, entry]) => ({
    id,
    request: entry.request,
    createdAt: entry.createdAt,
  }));
}

/** Parse timeout string like "7d", "24h", "30m" to milliseconds */
function parseTimeout(timeout: string): number {
  const match = timeout.match(/^(\\d+)\\s*(ms|s|m|h|d)$/);
  if (!match) return 0;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * (multipliers[unit] ?? 0);
}

/**
 * Creates an HTTP request handler for approval webhooks.
 * Returns a function compatible with Node.js http.createServer(),
 * or mount it as middleware in Express/Hono/Fastify.
 */
function createApprovalHandler(): (req: { method?: string; url?: string; }, res: { writeHead: (status: number, headers?: Record<string, string>) => void; end: (body?: string) => void; }) => Promise<void> {
  return async (req, res) => {
    const url = req.url ?? '';
    const method = req.method ?? 'GET';

    // GET /pending
    if (method === 'GET' && url.match(/\\/pending\\/?$/)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ pending: getPendingApprovals() }));
      return;
    }

    // POST /approve/:id or POST /reject/:id
    const match = url.match(/\\/(approve|reject)\\/([^/?]+)/);
    if (method === 'POST' && match) {
      const [, action, id] = match;
      const resolved = resolveApproval(
        id,
        action === 'approve',
        undefined,
        undefined,
      );
      res.writeHead(resolved ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ resolved, id, action }));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  };
}

const _defaultApprovalProvider: ApprovalProvider = {
  async requestApproval(request) {
    const id = request.id || crypto.randomUUID();
    console.log(\`[Approval Webhook] Waiting for approval: \${id} — "\${request.prompt}"\`);
    console.log(\`  POST /approve/\${id}  to approve\`);
    console.log(\`  POST /reject/\${id}   to reject\`);

    return new Promise<ApprovalResult>((resolve) => {
      _pendingApprovals.set(id, { resolve, request, createdAt: Date.now() });

      if (request.timeout) {
        const ms = parseTimeout(request.timeout);
        if (ms > 0) {
          setTimeout(() => {
            if (_pendingApprovals.has(id)) {
              _pendingApprovals.delete(id);
              resolve({ approved: false, response: 'Timed out' });
            }
          }, ms);
        }
      }
    });
  },
};

const approvalProvider: ApprovalProvider = (globalThis as unknown as { __fw_approval_provider__?: ApprovalProvider }).__fw_approval_provider__ ?? _defaultApprovalProvider;`;
}

/**
 * Get approval provider code for a given strategy.
 * Mirrors getProviderCode() from providers/index.ts.
 */
export function getApprovalCode(strategy: string): string {
  switch (strategy) {
    case 'callback':
      return generateCallbackApproval();
    case 'webhook':
      return generateWebhookApproval();
    case 'mock':
    default:
      return generateMockApproval();
  }
}
