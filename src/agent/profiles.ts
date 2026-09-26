/**
 * Agent profiles: what answers an agent gate when nobody is watching.
 *
 * A `waitForAgent` step names a task with its `agentId` and yields. Something
 * has to do the task and hand back `agentResult`. Until now that something
 * was a person at the console, or an assistant over MCP. A profile makes it
 * a model called from inside the process: which provider, which model, what
 * it is told, how long it may take.
 *
 * Profiles live in the project, in `.flowweaver/agents.yaml`, so they are
 * versioned with the workflows that use them. They never hold a secret: a
 * profile names the environment variable the key is read from, and the
 * console shows whether that variable is set, never its value.
 *
 *   default: reviewer
 *   agents:
 *     reviewer:
 *       provider: anthropic          # anthropic | openai | claude-cli
 *       model: claude-sonnet-5
 *       apiKeyEnv: ANTHROPIC_API_KEY # the variable, not the key
 *       system: You review files for risk. Be terse.
 *       maxIterations: 8
 *   gates:
 *     review: reviewer               # a gate's agentId → profile
 *     figmaToPage/plan: planner      # or one step: workflow/node → profile
 *
 * A gate is matched by `workflow/node` first, then by its `agentId`, then
 * the default. With no match the gate pauses for a person, as before.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as YAML from 'js-yaml';

export type AgentProviderKind = 'anthropic' | 'openai' | 'claude-cli';

export interface AgentProfile {
  name: string;
  provider: AgentProviderKind;
  /** Model id. Each provider has a default. */
  model?: string;
  /** Name of the environment variable holding the API key. */
  apiKeyEnv?: string;
  /** OpenAI-compatible endpoints (Ollama, Groq, vLLM…) and Anthropic proxies. */
  baseUrl?: string;
  /** What the model is told about itself, before the gate's own instructions. */
  system?: string;
  /** Model turns before the attempt is given up. Default 8. */
  maxIterations?: number;
  maxTokens?: number;
  /** `claude-cli` only: the binary, when it is not `claude` on PATH. */
  bin?: string;
  /** Free text shown beside the profile. */
  description?: string;
}

export interface AgentProfiles {
  /** Where the profiles were looked for. */
  file: string;
  exists: boolean;
  agents: Record<string, AgentProfile>;
  default?: string;
  /** `agentId` or `workflow/node` → profile name. */
  gates: Record<string, string>;
  /** What was wrong with the file, if anything. A bad file yields no profiles. */
  errors: string[];
}

export interface Readiness {
  ready: boolean;
  /** Why it is not ready, in a sentence. */
  reason?: string;
  /** The environment variable that would make it ready. */
  keyEnv?: string;
}

const PROVIDERS: ReadonlySet<string> = new Set(['anthropic', 'openai', 'claude-cli']);

export const DEFAULT_MODEL: Record<AgentProviderKind, string> = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-4o',
  'claude-cli': '',
};

const DEFAULT_KEY_ENV: Record<AgentProviderKind, string | undefined> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  'claude-cli': undefined,
};

export const DEFAULT_MAX_ITERATIONS = 8;

/** The starter file the console offers when a project has none. */
export const STARTER_AGENTS_YAML = `# Agent profiles: what answers a waitForAgent gate when nobody is watching.
# Keys are read from the environment variable named here, never stored.
default: assistant
agents:
  assistant:
    provider: anthropic          # anthropic | openai | claude-cli
    model: claude-sonnet-5
    apiKeyEnv: ANTHROPIC_API_KEY
    system: |
      You are a careful assistant answering one step of a workflow.
      Do exactly the task described and return only what is asked for.
    maxIterations: 8
gates: {}                        # agentId or workflow/node -> profile name
`;

export function agentsFile(projectDir: string): string {
  return path.join(projectDir, '.flowweaver', 'agents.yaml');
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Read the project's profiles. Never throws: a missing or broken file is reported in `errors`. */
export function loadAgentProfiles(projectDir: string): AgentProfiles {
  const file = agentsFile(projectDir);
  const out: AgentProfiles = { file, exists: false, agents: {}, gates: {}, errors: [] };
  if (!fs.existsSync(file)) return out;
  out.exists = true;
  let doc: unknown;
  try {
    doc = YAML.load(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    out.errors.push(`could not parse: ${e instanceof Error ? e.message : String(e)}`);
    return out;
  }
  if (doc == null) return out;
  if (!isRecord(doc)) { out.errors.push('the file must be a mapping'); return out; }

  const agents = doc.agents;
  if (agents !== undefined) {
    if (!isRecord(agents)) out.errors.push('`agents` must be a mapping of name → profile');
    else {
      for (const [name, raw] of Object.entries(agents)) {
        if (!isRecord(raw)) { out.errors.push(`agents.${name} must be a mapping`); continue; }
        const provider = raw.provider;
        if (typeof provider !== 'string' || !PROVIDERS.has(provider)) {
          out.errors.push(`agents.${name}.provider must be one of anthropic, openai, claude-cli`);
          continue;
        }
        const str = (k: string): string | undefined => (typeof raw[k] === 'string' && (raw[k]).trim() ? (raw[k]) : undefined);
        const num = (k: string): number | undefined => (typeof raw[k] === 'number' && Number.isFinite(raw[k]) ? (raw[k]) : undefined);
        out.agents[name] = {
          name,
          provider: provider as AgentProviderKind,
          model: str('model'),
          apiKeyEnv: str('apiKeyEnv'),
          baseUrl: str('baseUrl'),
          system: str('system'),
          maxIterations: num('maxIterations'),
          maxTokens: num('maxTokens'),
          bin: str('bin'),
          description: str('description'),
        };
      }
    }
  }

  if (doc.default !== undefined) {
    if (typeof doc.default !== 'string') out.errors.push('`default` must be a profile name');
    else if (!out.agents[doc.default]) out.errors.push(`default names an unknown profile: ${doc.default}`);
    else out.default = doc.default;
  }

  const gates = doc.gates;
  if (gates !== undefined) {
    if (!isRecord(gates)) out.errors.push('`gates` must be a mapping of agentId or workflow/node → profile name');
    else {
      for (const [key, target] of Object.entries(gates)) {
        if (typeof target !== 'string') { out.errors.push(`gates.${key} must be a profile name`); continue; }
        if (!out.agents[target]) { out.errors.push(`gates.${key} names an unknown profile: ${target}`); continue; }
        out.gates[key] = target;
      }
    }
  }
  return out;
}

/** The profile a paused gate should be answered by, or undefined to leave it to a person. */
export function profileForGate(
  profiles: AgentProfiles,
  gate: { workflow: string; node: string; agentId?: unknown },
): AgentProfile | undefined {
  const byStep = profiles.gates[`${gate.workflow}/${gate.node}`];
  if (byStep) return profiles.agents[byStep];
  if (typeof gate.agentId === 'string' && gate.agentId && profiles.gates[gate.agentId]) return profiles.agents[profiles.gates[gate.agentId]];
  if (profiles.default) return profiles.agents[profiles.default];
  return undefined;
}

/** The environment variable a profile's key comes from, if it needs one. */
export function keyEnvOf(profile: AgentProfile): string | undefined {
  if (profile.provider === 'claude-cli') return undefined;
  return profile.apiKeyEnv ?? DEFAULT_KEY_ENV[profile.provider];
}

/** Is the binary on PATH, or at the given path? */
function binaryFound(bin: string, env: NodeJS.ProcessEnv): boolean {
  if (bin.includes('/') || bin.includes('\\')) return fs.existsSync(bin);
  const dirs = (env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  return dirs.some((d) => exts.some((x) => fs.existsSync(path.join(d, bin + x))));
}

/** The models a provider is most likely wanted with, for a form's suggestions. */
export const SUGGESTED_MODELS: Record<AgentProviderKind, string[]> = {
  anthropic: ['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4.1', 'gpt-4o-mini', 'llama3', 'qwen2.5'],
  'claude-cli': ['', 'sonnet', 'opus', 'haiku'],
};

const NAME = /^[a-z][a-z0-9_-]{0,40}$/i;

/** What is wrong with a profile someone typed, in sentences; empty when nothing is. */
export function validateProfile(p: Partial<AgentProfile>): string[] {
  const errors: string[] = [];
  if (!p.name || !NAME.test(p.name)) errors.push('the name is letters, digits, - and _, starting with a letter');
  if (!p.provider || !PROVIDERS.has(p.provider)) errors.push('pick a provider: anthropic, openai or claude-cli');
  if (p.provider === 'openai' && p.baseUrl && !/^https?:\/\//.test(p.baseUrl)) errors.push('the base URL starts with http:// or https://');
  if (p.apiKeyEnv && !/^[A-Z_][A-Z0-9_]*$/.test(p.apiKeyEnv)) errors.push('the key variable is an environment variable name, like MY_API_KEY');
  if (p.maxIterations !== undefined && (!Number.isInteger(p.maxIterations) || p.maxIterations < 1 || p.maxIterations > 50)) errors.push('turns is a whole number from 1 to 50');
  return errors;
}

/**
 * Write the profiles back. The file is regenerated from its structure, so
 * a comment someone wrote in it does not survive; the console says so
 * where it offers to edit.
 */
export function saveAgentProfiles(projectDir: string, profiles: Pick<AgentProfiles, 'agents' | 'default' | 'gates'>): string {
  const agents: Record<string, Record<string, unknown>> = {};
  for (const [name, p] of Object.entries(profiles.agents)) {
    const out: Record<string, unknown> = { provider: p.provider };
    for (const k of ['model', 'apiKeyEnv', 'baseUrl', 'bin', 'description', 'system', 'maxIterations', 'maxTokens'] as const) {
      const v = p[k];
      if (v !== undefined && v !== '' && v !== null) out[k] = v;
    }
    agents[name] = out;
  }
  const doc: Record<string, unknown> = {};
  if (profiles.default && profiles.agents[profiles.default]) doc.default = profiles.default;
  doc.agents = agents;
  if (Object.keys(profiles.gates).length) doc.gates = profiles.gates;
  const header = '# Agent profiles: what answers a waitForAgent gate when nobody is watching.\n# Keys are read from the environment variable named here, never stored.\n# Edited by fw console. See the Agents page.\n';
  const text = header + YAML.dump(doc, { lineWidth: 100, noRefs: true, quoteStyle: 'double' });
  const file = agentsFile(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
  return file;
}

/**
 * Whether a profile can run here, now: its key is in the environment, or
 * its binary is on PATH. Checked without touching the network.
 */
export function readiness(profile: AgentProfile, env: NodeJS.ProcessEnv = process.env): Readiness {
  if (profile.provider === 'claude-cli') {
    const bin = profile.bin ?? 'claude';
    return binaryFound(bin, env) ? { ready: true } : { ready: false, reason: `the \`${bin}\` command is not on PATH` };
  }
  const keyEnv = keyEnvOf(profile)!;
  if (env[keyEnv]) return { ready: true, keyEnv };
  // A local OpenAI-compatible server (Ollama, vLLM) takes any key or none.
  if (profile.provider === 'openai' && profile.baseUrl) return { ready: true, keyEnv, reason: 'not set, and not needed with a base URL' };
  return { ready: false, keyEnv, reason: `${keyEnv} is not set in the environment` };
}
