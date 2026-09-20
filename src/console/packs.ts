/**
 * The packs installed in a project, as the console shows them.
 *
 * A pack's manifest already says everything: what it adds (node types,
 * workflows, patterns), what it plugs into (export targets, tags, rule
 * sets, docs, CLI commands, MCP tools) and which engine it expects. What
 * is added here is the reading of it for a person: the namespace a pack's
 * commands live under, whether this engine is new enough, and which pack a
 * node type's source file belongs to -- the parser resolves the file and
 * says nothing about where it came from.
 */
import { listInstalledPackages } from '../marketplace/registry.js';
import type { TInstalledPackage, TManifestPort } from '../marketplace/types.js';
import { VERSION } from '../generated-version.js';

export interface PackPort { name: string; type: string; optional: boolean; description: string }

export interface PackView {
  /** The npm name, as installed. */
  name: string;
  /** The words after `fw` its commands live under: `@acme/flow-weaver-pack-audio` → `audio`. */
  namespace: string;
  version: string;
  path: string;
  description: string;
  engineVersion: string | null;
  /** Whether this Flow Weaver satisfies `engineVersion`. Null when it cannot be read. */
  compatible: boolean | null;
  nodeTypes: Array<{ name: string; functionName: string; description: string; inputs: PackPort[]; outputs: PackPort[]; color: string | null; icon: string | null }>;
  workflows: Array<{ name: string; description: string; params: PackPort[]; returns: PackPort[]; nodes: number }>;
  patterns: Array<{ name: string; description: string; nodes: number }>;
  exportTargets: Array<{ name: string; description: string }>;
  tagHandlers: Array<{ tags: string[]; namespace: string; scope: string }>;
  validationRuleSets: Array<{ name: string; namespace: string }>;
  docs: Array<{ slug: string; name: string; description: string }>;
  cliCommands: Array<{ name: string; description: string; usage: string; flags: Array<{ flag: string; description: string; default: string }> }>;
  mcpTools: Array<{ name: string; description: string }>;
}

/** The namespace a pack's CLI commands are registered under. */
export function packNamespace(name: string): string {
  return name.replace(/^@[^/]+\//, '').replace(/^flow-weaver-pack-/, '');
}

/** What provenance needs of an installed pack: its name and where it sits. */
export interface InstalledRef { name: string; path: string }

const posix = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '');

/**
 * The installed pack a source file belongs to, or null for the project's
 * own files and for ordinary dependencies. Decided against the packs that
 * are actually installed, on either separator, the longest path winning.
 */
export function packForFile(file: string, packs: InstalledRef[]): string | null {
  const f = posix(file);
  let best: InstalledRef | null = null;
  for (const p of packs) {
    const root = posix(p.path);
    if ((f === root || f.startsWith(`${root}/`)) && (!best || root.length > posix(best.path).length)) best = p;
  }
  return best?.name ?? null;
}

/** The package an import specifier names: `@acme/pipelines/dist/x.js` → `@acme/pipelines`. */
export function packageOfSpecifier(specifier: string): string | null {
  const parts = specifier.split('/');
  if (!parts[0] || parts[0].startsWith('.')) return null;
  return parts[0].startsWith('@') ? (parts[1] ? `${parts[0]}/${parts[1]}` : null) : parts[0];
}

/**
 * The installed pack an import specifier points into, or null. `@fwImport x
 * fn from "@acme/pipelines/dist/x.js"` is resolved by the parser into a node
 * type whose source is the importing file, so the specifier is the only
 * trace of where it came from.
 */
export function packForSpecifier(specifier: string | undefined, packs: InstalledRef[]): string | null {
  const name = specifier ? packageOfSpecifier(specifier) : null;
  return name && packs.some((p) => p.name === name) ? name : null;
}

/**
 * The installed packs' names and paths, memoised briefly: provenance is
 * asked for every node of every workflow, and the answer changes only when
 * something is installed.
 */
const refsCache = new Map<string, { at: number; refs: InstalledRef[] }>();
export async function installedRefs(projectDir: string): Promise<InstalledRef[]> {
  const hit = refsCache.get(projectDir);
  if (hit && Date.now() - hit.at < 2000) return hit.refs;
  const refs = (await listInstalledPackages(projectDir)).map((p) => ({ name: p.name, path: p.path }));
  refsCache.set(projectDir, { at: Date.now(), refs });
  return refs;
}

const parse = (v: string): [number, number, number] | null => {
  const m = v.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
const cmp = (a: [number, number, number], b: [number, number, number]): number =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * Whether `version` satisfies a simple range: `>=x.y.z`, `^x.y.z`, `~x.y.z`,
 * `x.y.z` or `*`. Anything more elaborate answers null rather than a guess.
 */
export function engineCompatible(range: string | undefined, version: string = VERSION): boolean | null {
  if (!range || range.trim() === '*') return true;
  const have = parse(version);
  // One operator and one version, nothing after it: `>=0.1.0 <1.0.0` is
  // more than this reads, and the answer for it is "don't know".
  const m = range.trim().match(/^(>=|\^|~)?\s*(v?\d+\.\d+\.\d+)$/);
  const want = m ? parse(m[2]) : null;
  if (!have || !want) return null;
  const op = m![1] ?? '';
  if (op === '>=') return cmp(have, want) >= 0;
  if (op === '^') return want[0] === 0 ? have[0] === 0 && have[1] === want[1] && have[2] >= want[2] : have[0] === want[0] && cmp(have, want) >= 0;
  if (op === '~') return have[0] === want[0] && have[1] === want[1] && have[2] >= want[2];
  return cmp(have, want) === 0;
}

const CONTROL = new Set(['execute', 'onSuccess', 'onFailure']);

/** Data ports only: the manifest records the control ports too, and a person reads past them. */
const ports = (map: Record<string, TManifestPort> | undefined): PackPort[] =>
  Object.entries(map ?? {})
    .filter(([name]) => !CONTROL.has(name))
    .map(([name, p]) => ({ name, type: String(p.dataType).toLowerCase(), optional: !!p.optional, description: p.description ?? '' }));

/** One installed pack, read for a person. */
export function describePack(pkg: TInstalledPackage): PackView {
  const m = pkg.manifest;
  const namespace = packNamespace(pkg.name);
  return {
    name: pkg.name,
    namespace,
    version: pkg.version,
    path: pkg.path,
    description: m.description ?? '',
    engineVersion: m.engineVersion ?? null,
    compatible: engineCompatible(m.engineVersion),
    nodeTypes: (m.nodeTypes ?? []).map((n) => ({
      name: n.name, functionName: n.functionName, description: n.description ?? '',
      inputs: ports(n.inputs), outputs: ports(n.outputs),
      color: n.visuals?.color ?? null, icon: n.visuals?.icon ?? null,
    })),
    workflows: (m.workflows ?? []).map((w) => ({ name: w.name, description: w.description ?? '', params: ports(w.startPorts), returns: ports(w.exitPorts), nodes: w.nodeCount })),
    patterns: (m.patterns ?? []).map((p) => ({ name: p.name, description: p.description ?? '', nodes: p.nodeCount })),
    exportTargets: (m.exportTargets ?? []).map((t) => ({ name: t.name, description: t.description ?? '' })),
    tagHandlers: (m.tagHandlers ?? []).map((t) => ({ tags: t.tags, namespace: t.namespace, scope: t.scope })),
    validationRuleSets: (m.validationRuleSets ?? []).map((r) => ({ name: r.name, namespace: r.namespace })),
    docs: (m.docs ?? []).map((d) => ({ slug: d.slug, name: d.name, description: d.description ?? '' })),
    // A pack with an entrypoint but no commands contributes none: the CLI skips it.
    cliCommands: m.cliEntrypoint ? (m.cliCommands ?? []).map((c) => ({
      name: c.name, description: c.description,
      usage: ['fw', namespace, c.name, ...(c.arguments?.map((a) => a.syntax) ?? (c.usage ? [c.usage] : []))].join(' '),
      flags: (c.options ?? []).map((o) => ({ flag: o.flags, description: o.description, default: o.default === undefined ? '' : String(o.default) })),
    })) : [],
    mcpTools: m.mcpEntrypoint ? (m.mcpTools ?? []).map((t) => ({ name: t.name, description: t.description })) : [],
  };
}

/** Every pack installed in the project, by namespace. */
export async function describePacks(projectDir: string): Promise<PackView[]> {
  const installed = await listInstalledPackages(projectDir);
  return installed.map(describePack).sort((a, b) => a.namespace.localeCompare(b.namespace));
}
