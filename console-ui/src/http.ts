import type { HttpRoute, Port } from './state';

/** `reviewFile` → `/review-file`: the path a workflow gets when it is first exposed. */
export function defaultPath(name: string): string {
  return '/' + name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^A-Za-z0-9-]+/g, '-').toLowerCase();
}

/** A route as its `@http` line reads, without the tag. */
export function routeText(r: HttpRoute): string {
  return `${r.method} ${r.path}${r.mode === 'async' ? ' mode=async' : ''}${r.auth === 'none' ? ' auth=none' : ''}${r.callback ? ' callback' : ''}`;
}

/** The parameters a route takes from its path. */
export function pathParams(route: HttpRoute): string[] {
  return [...route.path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
}

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * The request for a route as a `curl` line, with the run form's values where
 * they exist and a typed placeholder where they do not. A GET or DELETE
 * takes the parameters in the path and the query; anything else takes the
 * rest as a JSON body. Without a route, the run resource every workflow has.
 */
export function curlFor(base: string, name: string, route: HttpRoute | null, params: Port[], values: Record<string, unknown>): string {
  const typeOf = (p: string) => params.find((x) => x.name === p)?.tsType ?? 'value';
  const has = (p: string) => values[p] !== undefined;
  const bodyValue = (p: string) => (has(p) ? values[p] : `<${typeOf(p)}>`);
  const urlValue = (p: string) => (has(p) ? encodeURIComponent(String(values[p])) : `<${typeOf(p)}>`);
  const body = (names: string[]) => JSON.stringify(Object.fromEntries(names.map((p) => [p, bodyValue(p)])), null, 2);

  if (!route) {
    return [
      `curl -X POST ${base}/workflows/${name} \\`,
      `  -H "Authorization: Bearer $FW_SERVE_TOKEN" \\`,
      `  -H 'Content-Type: application/json' \\`,
      `  -d ${shellQuote(body(params.map((p) => p.name)))}`,
    ].join('\n');
  }
  const inPath = new Set(pathParams(route));
  const path = route.path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, k: string) => urlValue(k));
  const rest = params.filter((p) => !inPath.has(p.name)).map((p) => p.name);
  const bodyless = route.method === 'GET' || route.method === 'DELETE';
  let url = `${base}${path}`;
  if (bodyless && rest.length) url += `?${rest.map((p) => `${p}=${urlValue(p)}`).join('&')}`;
  const lines = [`curl -X ${route.method} ${/[?<>&]/.test(url) ? shellQuote(url) : url}`];
  if (route.auth !== 'none') lines.push(`  -H "Authorization: Bearer $FW_SERVE_TOKEN"`);
  if (!bodyless) {
    lines.push(`  -H 'Content-Type: application/json'`);
    lines.push(`  -d ${shellQuote(body(rest))}`);
  }
  return lines.map((l, i) => (i < lines.length - 1 ? `${l} \\` : l)).join('\n');
}

/** What the route answers with, in a line, for a workflow with `gates` gates. */
export function answerLine(route: HttpRoute, gates: number): string {
  if (route.mode === 'async') return '202 at once with the run to follow';
  if (gates > 0) return '200 with the return ports, or 202 with the run when a gate pauses it';
  return '200 with the return ports; 422 when it ends on the failure path';
}
