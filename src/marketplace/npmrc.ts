/**
 * The registries npm would use, read from where npm reads them.
 *
 * A private pack lives on a private registry, reached through `.npmrc`:
 * `@scope:registry=` routes a scope there, and `//host/path/:_authToken=`
 * holds the token. `npm install` reads both, so installing already works
 * everywhere, while searching only asked the public registry. This reads the
 * same files, in npm's order (project over user over defaults), so a
 * search reaches every registry an install would.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';

export interface Registry {
  /** Base URL, with a trailing slash. */
  url: string;
  /** Scopes routed here (`@synergenius`), empty for the default registry. */
  scopes: string[];
  /** Whether this is the unscoped default. */
  isDefault: boolean;
  /** The `Authorization` header value, when `.npmrc` has credentials for this host. */
  authorization?: string;
}

/** Parse `.npmrc` text into key/value pairs, expanding `${VAR}` from the environment as npm does. */
export function parseNpmrc(text: string, env: NodeJS.ProcessEnv = process.env): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof text !== 'string') return out;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    let missing = false;
    value = value.replace(/\$\{([^}]+)\}/g, (_, name: string) => {
      const v = env[name];
      if (v === undefined) missing = true;
      return v ?? '';
    });
    // npm refuses a config whose variable is unset. Here the line is skipped
    // rather than a registry being asked with an empty token.
    if (missing) continue;
    out.set(key, value);
  }
  return out;
}

/** npm's "nerf dart": the part of a registry URL an auth key is written against. */
export function nerfDart(url: string): string {
  const u = new URL(url);
  const p = u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`;
  return `//${u.host}${p}`;
}

const withSlash = (u: string): string => (u.endsWith('/') ? u : `${u}/`);

/**
 * Merge the config files npm would read for a project: user first, then the
 * project's, so the project's lines win. `npm_config_registry` in the
 * environment wins over both for the default registry.
 */
export function readNpmConfig(projectDir: string, env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): Map<string, string> {
  const merged = new Map<string, string>();
  for (const file of [path.join(home, '.npmrc'), path.join(projectDir, '.npmrc')]) {
    let text: string;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const [k, v] of parseNpmrc(text, env)) merged.set(k, v);
  }
  const envRegistry = env.npm_config_registry ?? env.NPM_CONFIG_REGISTRY;
  if (envRegistry) merged.set('registry', envRegistry);
  return merged;
}

/** The credentials for a registry, found the way npm finds them: the longest auth key that prefixes the URL's nerf dart. */
function authorizationFor(url: string, config: Map<string, string>): string | undefined {
  const dart = nerfDart(url);
  let best: { len: number; value: string } | undefined;
  for (const [key, value] of config) {
    const m = key.match(/^(\/\/[^:]+\/):(_authToken|_auth|_password)$/);
    if (!m || !dart.startsWith(m[1]) || !value) continue;
    if (best && m[1].length <= best.len) continue;
    if (m[2] === '_authToken') best = { len: m[1].length, value: `Bearer ${value}` };
    else if (m[2] === '_auth') best = { len: m[1].length, value: `Basic ${value}` };
    else {
      const user = config.get(`${m[1]}:username`);
      if (user) best = { len: m[1].length, value: `Basic ${Buffer.from(`${user}:${value}`).toString('base64')}` };
    }
  }
  return best?.value;
}

/** Every registry a project's npm would talk to, the default first. */
export function resolveRegistries(projectDir: string, config: Map<string, string> = readNpmConfig(projectDir)): Registry[] {
  const byUrl = new Map<string, Registry>();
  const defaultUrl = withSlash(config.get('registry') || PUBLIC_REGISTRY);
  byUrl.set(defaultUrl, { url: defaultUrl, scopes: [], isDefault: true });
  for (const [key, value] of config) {
    const m = key.match(/^(@[^:]+):registry$/);
    if (!m || !value) continue;
    const url = withSlash(value);
    const r = byUrl.get(url) ?? { url, scopes: [], isDefault: false };
    r.scopes.push(m[1]);
    byUrl.set(url, r);
  }
  for (const r of byUrl.values()) {
    const authorization = authorizationFor(r.url, config);
    if (authorization) r.authorization = authorization;
  }
  return [...byUrl.values()];
}
