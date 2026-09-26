/**
 * What the API says about itself: `/health`, the workflows it found at
 * `/workflows` and `/workflows/:name` (whose POST is the legacy start,
 * when legacy routes are on), the OpenAPI document, and Swagger UI at
 * `/docs` when docs are on.
 */
import { VERSION } from '../generated-version.js';
import type { ApiContext } from './context.js';
import { HttpError } from './http-error.js';
import { decodeSegment, html, json } from './respond.js';
import { legacyStart } from './routes-runs.js';
import type { ServerRequest, ServerResponse } from './transport.js';
import type { HealthResponse, WorkflowEndpoint, WorkflowListResponse } from './types.js';

function describeEndpoint(e: WorkflowEndpoint) {
  return { name: e.name, path: e.path, method: e.method, description: e.description, gates: e.gates, routes: e.routes ?? [], inputSchema: e.inputSchema, outputSchema: e.outputSchema };
}

function health(ctx: ApiContext): HealthResponse {
  const { registry } = ctx;
  return { status: 'ok', timestamp: new Date().toISOString(), workflows: registry.getAllEndpoints().length, uptime: registry.getUptime(), version: VERSION, auth: ctx.token ? 'token' : 'open', agents: ctx.agents, routes: ctx.mounted().compiled.length };
}

/** Answer a request for the API's own description. False when the path is not one. */
export async function serveCatalog(ctx: ApiContext, req: ServerRequest, res: ServerResponse, method: string, p: string, url: URL, base: string, given?: unknown): Promise<boolean> {
  const { registry } = ctx;
  if (method === 'GET' && p === '/health') { json(res, 200, health(ctx)); return true; }
  if (method === 'GET' && p === '/workflows') { json(res, 200, { count: registry.getAllEndpoints().length, workflows: registry.getAllEndpoints().map(describeEndpoint), problems: ctx.mounted().problems } satisfies WorkflowListResponse & { problems: string[] }); return true; }
  if (method === 'GET' && p === '/openapi.json') { json(res, 200, ctx.openapi(undefined, base)); return true; }
  if (method === 'GET' && p === '/docs') {
    if (!ctx.docs) throw new HttpError(404, 'NOT_FOUND', 'docs are off. Start with --swagger, or docs: true');
    html(res, swaggerPage(`${base}/openapi.json`)); return true;
  }

  const m = p.match(/^\/workflows\/([^/]+)$/);
  if (!m) return false;
  const endpoint = registry.getEndpoint(decodeSegment(m[1]));
  if (!endpoint) throw new HttpError(404, 'WORKFLOW_NOT_FOUND', `Workflow "${m[1]}" not found`);
  if (method === 'GET') { json(res, 200, describeEndpoint(endpoint)); return true; }
  if (method === 'POST') {
    if (!ctx.legacy && (endpoint.routes?.length ?? 0) > 0) throw new HttpError(404, 'USE_DECLARED_ROUTE', `use ${endpoint.routes!.map((r) => `${r.method} ${r.path}`).join(' or ')}`);
    if (!ctx.legacy) throw new HttpError(404, 'NOT_AN_ENDPOINT', `${endpoint.name} declares no @http route`);
    await legacyStart(ctx, req, res, endpoint, url, base, given); return true;
  }
  throw new HttpError(405, 'METHOD_NOT_ALLOWED', `${method} is not allowed here`);
}

function swaggerPage(specUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Flow Weaver API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: ${JSON.stringify(specUrl)}, dom_id: '#swagger-ui', presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset], layout: 'BaseLayout' });
  </script>
</body>
</html>`;
}
