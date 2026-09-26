/**
 * Which declared `@http` routes are mounted, and how a request path finds
 * one. The API keeps a few paths for itself; a route under one of them, or
 * a method and path two workflows both declare, is refused with a reason.
 * What is mounted is compiled to a matcher that binds the `:name` segments.
 */
import type { THttpRoute } from '../ast/types.js';
import type { WorkflowEndpoint } from './types.js';

/** Paths the API keeps for itself. A declared route under one is refused. */
export const RESERVED_PATHS = ['/health', '/workflows', '/runs', '/openapi.json', '/docs'];
const RESERVED = RESERVED_PATHS;

/** Whether a path is one of the API's own, or under one. */
export const isReserved = (p: string) => RESERVED.some((r) => p === r || p.startsWith(`${r}/`));

/**
 * Which declared routes can be mounted together, and why the rest cannot:
 * a route under a reserved path, or the same method and path declared by
 * two workflows. The console asks this of the whole project. The API asks
 * it of what the registry found.
 */
export function planRoutes<T extends { name: string; routes: THttpRoute[] }>(list: T[]): { mounted: Array<{ owner: T; route: THttpRoute }>; problems: string[] } {
  const mounted: Array<{ owner: T; route: THttpRoute }> = [];
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const owner of list) {
    for (const route of owner.routes) {
      if (isReserved(route.path)) {
        problems.push(`${owner.name}: @http ${route.method} ${route.path} is under a reserved path (${RESERVED.join(', ')}), so it is not mounted`);
        continue;
      }
      const key = `${route.method} ${route.path}`;
      const other = seen.get(key);
      if (other) { problems.push(`${owner.name}: @http ${key} is already declared by ${other}, not mounted`); continue; }
      seen.set(key, owner.name);
      mounted.push({ owner, route });
    }
  }
  return { mounted, problems };
}

/** A mounted route: whose it is, what it declares, and the matcher for its path with the names it binds. */
export interface CompiledRoute { endpoint: WorkflowEndpoint; route: THttpRoute; regex: RegExp; keys: string[] }

/** `/reviews/:id` → a matcher and the names it binds. */
function compileRoute(routePath: string): { regex: RegExp; keys: string[] } {
  const keys: string[] = [];
  const pattern = routePath.split('/').map((seg) => {
    if (seg.startsWith(':')) { keys.push(seg.slice(1)); return '([^/]+)'; }
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  return { regex: new RegExp(`^${pattern}/?$`), keys };
}

/** The routes the registry's endpoints declare, planned and compiled, with what was refused. */
export function mountRoutes(endpoints: WorkflowEndpoint[]): { compiled: CompiledRoute[]; problems: string[] } {
  const plan = planRoutes(endpoints.map((endpoint) => ({ name: endpoint.name, routes: endpoint.routes ?? [], endpoint })));
  return { compiled: plan.mounted.map(({ owner, route }) => ({ endpoint: owner.endpoint, route, ...compileRoute(route.path) })), problems: plan.problems };
}
