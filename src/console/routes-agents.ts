/**
 * The project's agent profiles: listed with their readiness, edited, tried,
 * made the default, and assigned to gates.
 */
import * as fs from 'node:fs';
import { loadAgentProfiles, saveAgentProfiles, validateProfile, readiness, keyEnvOf, agentsFile, STARTER_AGENTS_YAML, DEFAULT_MODEL, SUGGESTED_MODELS, type AgentProfiles, type AgentProfile } from '../agent/profiles.js';
import { tryProfile } from '../agent/gate.js';
import { json, type Json } from './respond.js';
import type { Call, ConsoleContext, Route } from './router.js';

export interface ProfileCache {
  /** The project's profiles, read again when the file or the project changes. */
  get(): AgentProfiles;
  /** Write them, and read them fresh next time. */
  save(profiles: Pick<AgentProfiles, 'agents' | 'default' | 'gates'>): void;
  /** The profiles as the Agents view shows them: readiness by environment, never a key. */
  describe(): Json;
}

export function createProfileCache(projectDir: () => string): ProfileCache {
  let cache: { dir: string; mtime: number; profiles: AgentProfiles } | undefined;
  const get = (): AgentProfiles => {
    const dir = projectDir();
    let mtime: number;
    try { mtime = fs.statSync(agentsFile(dir)).mtimeMs; } catch { mtime = 0; }
    if (!cache || cache.dir !== dir || cache.mtime !== mtime) cache = { dir, mtime, profiles: loadAgentProfiles(dir) };
    return cache.profiles;
  };
  return {
    get,
    save(profiles) {
      saveAgentProfiles(projectDir(), profiles);
      cache = undefined;
    },
    describe() {
      const p = get();
      return {
        file: p.file, exists: p.exists, default: p.default ?? null, errors: p.errors, gates: p.gates, starter: STARTER_AGENTS_YAML, suggestedModels: SUGGESTED_MODELS,
        agents: Object.values(p.agents).map((a) => {
          const r = readiness(a);
          return { name: a.name, provider: a.provider, model: a.model || DEFAULT_MODEL[a.provider] || null, keyEnv: keyEnvOf(a) ?? null, ready: r.ready, reason: r.reason ?? null, description: a.description ?? null, system: a.system ?? null, maxIterations: a.maxIterations ?? null, baseUrl: a.baseUrl ?? null, bin: a.bin ?? null };
        }),
      };
    },
  };
}

/** A profile as the editor sent it: blank fields left out, numbers read from text. */
function profileFrom(name: string, b: Json): AgentProfile {
  const str = (k: string) => (typeof b[k] === 'string' && (b[k]).trim() ? (b[k]).trim() : undefined);
  const num = (k: string) => (typeof b[k] === 'number' ? (b[k]) : typeof b[k] === 'string' && (b[k]).trim() ? Number(b[k]) : undefined);
  return {
    name, provider: b.provider as AgentProfile['provider'],
    model: str('model'), apiKeyEnv: str('apiKeyEnv'), baseUrl: str('baseUrl'), system: typeof b.system === 'string' && b.system.trim() ? b.system : undefined,
    maxIterations: num('maxIterations'), maxTokens: num('maxTokens'), bin: str('bin'), description: str('description'),
  };
}

const PROFILE = /^\/api\/agents\/profiles\/([^/]+)$/;
const TRY = /^\/api\/agents\/try\/([^/]+)$/;
const nameIn = ({ match }: Call) => decodeURIComponent(match[1] ?? '');

export function agentRoutes(ctx: ConsoleContext): Route[] {
  const { profiles } = ctx;
  const describe = (call: Call) => json(call.res, 200, profiles.describe());

  return [
    { path: '/api/agents', handle: describe },
    // Whether an environment variable is set here -- never its value.
    {
      path: '/api/agents/env', handle: ({ res, q }) =>
        json(res, 200, { name: q('name'), set: /^[A-Z_][A-Z0-9_]*$/.test(q('name')) && !!process.env[q('name')] }),
    },
    {
      method: 'PUT', path: '/api/agents/default', handle: async (call) => {
        const b = await call.body();
        const p = profiles.get();
        const name = typeof b.name === 'string' && b.name ? b.name : undefined;
        if (name && !p.agents[name]) return json(call.res, 400, { error: `no profile named ${name}` });
        profiles.save({ agents: p.agents, default: name, gates: p.gates });
        return describe(call);
      },
    },
    {
      method: 'PUT', path: '/api/agents/gates', handle: async (call) => {
        const b = await call.body();
        const p = profiles.get();
        const key = typeof b.key === 'string' ? b.key.trim() : '';
        if (!key) return json(call.res, 400, { error: 'a gate key is an agentId or workflow/node' });
        const gates = { ...p.gates };
        if (typeof b.profile === 'string' && b.profile) {
          if (!p.agents[b.profile]) return json(call.res, 400, { error: `no profile named ${b.profile}` });
          gates[key] = b.profile;
        } else delete gates[key];
        profiles.save({ agents: p.agents, default: p.default, gates });
        return describe(call);
      },
    },
    {
      method: 'POST', path: TRY, handle: async (call) => {
        const profile = profiles.get().agents[nameIn(call)];
        if (!profile) return json(call.res, 404, { error: `no profile named ${nameIn(call)}` });
        return json(call.res, 200, await tryProfile(profile, process.env, { cwd: ctx.projectDir() }));
      },
    },
    {
      method: 'PUT', path: PROFILE, handle: async (call) => {
        const name = nameIn(call);
        const p = profiles.get();
        const profile = profileFrom(name, await call.body());
        const problems = validateProfile(profile);
        if (problems.length) return json(call.res, 400, { error: problems.join('; ') });
        const agents = { ...p.agents, [name]: profile };
        // The first profile becomes the default: one profile with no
        // default would answer nothing, which is never what adding one means.
        const def = p.default && agents[p.default] ? p.default : (Object.keys(agents).length === 1 ? name : p.default);
        profiles.save({ agents, default: def, gates: p.gates });
        return describe(call);
      },
    },
    {
      method: 'DELETE', path: PROFILE, handle: (call) => {
        const name = nameIn(call);
        const p = profiles.get();
        if (!p.agents[name]) return json(call.res, 404, { error: `no profile named ${name}` });
        const agents = { ...p.agents }; delete agents[name];
        const gates = Object.fromEntries(Object.entries(p.gates).filter(([, v]) => v !== name));
        profiles.save({ agents, default: p.default === name ? undefined : p.default, gates });
        return describe(call);
      },
    },
  ];
}
