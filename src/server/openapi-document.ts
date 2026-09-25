/**
 * The OpenAPI document for the workflows in a directory: the same
 * discovery `fw serve` does (WorkflowRegistry), the same route plan and the
 * same builder, so a document written to a file, returned by the command
 * runner or served at `/openapi.json` never disagree.
 */
import yaml from 'js-yaml';
import { WorkflowRegistry } from './workflow-registry.js';
import { planRoutes } from './api.js';
import { buildOpenApi } from './openapi.js';

export interface OpenApiDocumentOptions {
  /** API title. Default "Flow Weaver API". */
  title?: string;
  /** API version. Default: the Flow Weaver version. */
  version?: string;
  /** API description. Default: a count of endpoints and workflows. */
  description?: string;
  /** The server's URL, when known. */
  serverUrl?: string;
  /** Describe the bearer scheme, as a server with a token has. Default true. */
  auth?: boolean;
  /** Include `POST /workflows/<name>` for every workflow. Default true. */
  legacy?: boolean;
}

export interface OpenApiDocument {
  /** The document, ready for `formatOpenApi` or `JSON.stringify`. */
  doc: Record<string, unknown>;
  /** Every workflow found in the directory. */
  workflowCount: number;
  /** The declared `@http` routes that were mounted. */
  routeCount: number;
  /** The declared routes that could not be mounted, and why. */
  problems: string[];
}

/**
 * Discover the workflows under `workflowDir` and build their OpenAPI
 * document. A directory with no workflows gives a document with only the
 * run and meta endpoints; the caller decides whether that is an error.
 */
export async function openApiForDirectory(workflowDir: string, options: OpenApiDocumentOptions = {}): Promise<OpenApiDocument> {
  const registry = new WorkflowRegistry(workflowDir);
  await registry.initialize();
  const endpoints = registry.getAllEndpoints();

  const plan = planRoutes(endpoints.map((endpoint) => ({ name: endpoint.name, routes: endpoint.routes ?? [], endpoint })));
  const mounted = plan.mounted.map(({ owner, route }) => ({
    endpoint: owner.endpoint,
    route,
    keys: [...route.path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]),
  }));

  const doc = buildOpenApi({
    endpoints,
    mounted,
    legacy: options.legacy !== false,
    secured: options.auth !== false,
    serverUrl: options.serverUrl,
    info: { title: options.title, version: options.version, description: options.description },
  });

  return { doc, workflowCount: endpoints.length, routeCount: mounted.length, problems: plan.problems };
}

/** The document as text: YAML, or pretty-printed JSON. */
export function formatOpenApi(doc: Record<string, unknown>, format: 'json' | 'yaml'): string {
  return format === 'yaml' ? yaml.dump(doc, { lineWidth: 120, noRefs: true }) : JSON.stringify(doc, null, 2);
}
