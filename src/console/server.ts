/**
 * `fw console`: a local operator console over a project's workflows.
 *
 * A thin HTTP + SSE layer over what the runtime already exposes:
 * parseWorkflow / validateWorkflow / buildProcessModel for the static side,
 * the local coordinator for real runs, searchDocs / readTopicStructured for
 * documentation.
 *
 * Runs live in the coordinator's store (`~/.fw/runs`), the same one `fw_run`
 * and `fw_resume` write to. So a run started here can be answered by an
 * assistant over MCP and the other way round, a gate waiting here survives
 * a restart, effects get receipts, and the console holds only the segment
 * of execution it is driving at this moment.
 */
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { FSWatcher } from 'chokidar';
import { parseWorkflow } from '../api/parse.js';
import { validateWorkflow } from '../api/validate.js';
import { hasInPlaceMarkers } from '../api/generate-in-place.js';
import { buildProcessModel } from '../diagram/index.js';
import { stepLabel } from '../diagram/labels.js';
import type { ExecutionTraceEvent } from '../mcp/workflow-executor.js';
import { buildGateResolution, computeBundleDigest, createLocalCoordinator, defaultRunsDir, answerAgentGate, transcriptName, isAnswering, reclaimStaleAgentAnswers, type RunRecord, type RunSummary, type RunStore, type TraceEntry } from '../coordinator/index.js';
import { loadAgentProfiles, saveAgentProfiles, validateProfile, readiness, keyEnvOf, agentsFile, STARTER_AGENTS_YAML, DEFAULT_MODEL, SUGGESTED_MODELS, type AgentProfiles, type AgentProfile } from '../agent/profiles.js';
import { tryProfile, type AgentGateEvent } from '../agent/gate.js';
import { VERSION } from '../generated-version.js';
import { ERROR_HINTS } from '../mcp/response-utils.js';
import { searchDocs, readTopic, readTopicStructured, listTopics, getPackDocTopics } from '../docs/index.js';
import { loadPackDocTopics } from '../docs/pack-topics.js';
import { guideOutline } from '../docs/guide.js';
import { cliCatalog } from './cli-catalog.js';
import { planFwCommand, spawnFw } from './cli-run.js';
import { DebugSessions, type DebugView } from './debug.js';
import { Supervisor, type ManagedKind, type SupervisorOptions } from './services.js';
import type { FwMockConfig } from '../built-in-nodes/mock-types.js';
import { fileHistory, fileAt, stamp as gitStamp } from './git.js';
import { buildDiffView } from './diff-view.js';
import { describePacks, installedRefs, packForFile, packForSpecifier } from './packs.js';
import { listTargets, runExport } from './export.js';
import { detectPackProject, checkPackProject } from './author.js';
import { describeStatus } from './status.js';
import { renderArtifact, ARTIFACT_KINDS, type ArtifactKind } from '../artifacts/index.js';
import { searchAllRegistries } from '../marketplace/registry.js';
import type { TWorkflowAST, TNodeTypeAST, TNodeInstanceAST, TPortDefinition, TValidationError } from '../ast/types.js';
import { workflowParamsSchema, gateOutputSchemas, type FieldSchema } from './schema.js';
import { scanWorkflowNames, checkWorkflows, invalidateListing, toPosix } from './scan.js';
import { workflowSource } from './source.js';
import { terminalWiring } from './terminals.js';
import { isConnectionCoveredByMacroStatic, httpRouteText } from '../generator/annotation-generator.js';
import { planRoutes, RESERVED_PATHS } from '../server/api.js';
import type { THttpRoute } from '../ast/types.js';

export interface ConsoleServerOptions {
  /** Directory whose workflows the console shows. */
  projectDir: string;
  port?: number;
  host?: string;
  /** Directory holding the built client (`index.html`, `app.js`, `styles.css`). Resolved automatically when omitted. */
  assetsDir?: string;
  /** Re-list and re-validate when files under the project change. Default true. */
  watch?: boolean;
  /** Called when the project is switched from the console. */
  onProject?: (dir: string) => void;
  /**
   * The run store to show and drive, in place of the directory under
   * `~/.fw/runs`: the same store your `createWorkflowApi` instances use, so
   * a person here answers the gates they reach. Changes made elsewhere are
   * picked up by polling, since a store of yours has no directory to watch.
   */
  store?: RunStore;
  /** How the project's services are started. A test hands in a fake spawn and its own directories. */
  services?: Pick<SupervisorOptions, 'spawn' | 'settingsDir' | 'registryDir'>;
}

export interface ConsoleServer {
  url: string;
  close(): Promise<void>;
}

type Json = Record<string, unknown>;
const CONTROL = new Set(['execute', 'onSuccess', 'onFailure']);

// -------------------------------------------------------------- describing

function nodeTypeOf(ast: TWorkflowAST, inst: TNodeInstanceAST): TNodeTypeAST | undefined {
  return ast.nodeTypes.find((n) => n.name === inst.nodeType) ?? ast.nodeTypes.find((n) => n.functionName === inst.nodeType);
}

export { stepLabel } from '../diagram/labels.js';

function ports(map: Record<string, TPortDefinition> | undefined) {
  return Object.entries(map ?? {})
    .filter(([k, p]) => !CONTROL.has(k) && !p.isControlFlow)
    // Without a TypeScript type the engine's own `STRING`/`OBJECT` stands
    // in. Shown to a person, it reads better as `string`.
    .map(([k, p]) => ({ name: k, tsType: p.tsType ?? String(p.dataType).toLowerCase(), optional: !!p.optional, description: p.description ?? '' }));
}

async function parseOne(file: string, name: string): Promise<{ ast?: TWorkflowAST; errors: string[] }> {
  const p = await parseWorkflow(file, { workflowName: name, projectDir: path.dirname(file) });
  return { ast: p.errors.length ? undefined : p.ast, errors: p.errors };
}

function describeIssue(e: TValidationError) {
  return {
    severity: e.type,
    code: e.code,
    message: e.message,
    node: e.node ?? null,
    line: e.location?.line ?? null,
    hint: ERROR_HINTS[e.code] ? ERROR_HINTS[e.code].replace(/<nodeId>/g, e.node ?? '<nodeId>') : null,
  };
}

/**
 * A workflow as it was at a git ref. The old text is written beside the
 * file for a moment under a `.fw-diff-` name, so its relative imports still
 * resolve, parsed, and removed. The scanner and the watcher both skip it.
 */
async function astAt(file: string, name: string, ref: string): Promise<{ ast?: TWorkflowAST; error?: string }> {
  if (ref === 'worktree') {
    const p = await parseOne(file, name);
    return p.ast ? { ast: p.ast } : { error: p.errors.join('\n') || 'the file does not parse' };
  }
  const text = await fileAt(file, ref);
  if (text === undefined) return { error: `${path.basename(file)} does not exist at ${ref}` };
  const tmp = path.join(path.dirname(file), `.fw-diff-${randomUUID().slice(0, 8)}-${path.basename(file)}`);
  fs.writeFileSync(tmp, text, 'utf8');
  try {
    const p = await parseWorkflow(tmp, { workflowName: name, projectDir: path.dirname(file) });
    if (p.errors.length) return { error: `${path.basename(file)} at ${ref} does not parse: ${p.errors[0]}` };
    return { ast: { ...p.ast, sourceFile: file } };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

async function describeWorkflow(projectDir: string, file: string, name: string) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = toPosix(path.relative(projectDir, file));
  const { ast, errors } = await parseOne(file, name);
  if (!ast) return { file, rel, name, parseErrors: errors };
  const v = validateWorkflow(ast);
  const packs = await installedRefs(projectDir);
  const nodes: Record<string, Json> = {};
  for (const inst of ast.instances) {
    const nt = nodeTypeOf(ast, inst);
    const nodeFile = nt?.sourceLocation?.file ?? file;
    nodes[inst.id] = {
      id: inst.id,
      type: inst.nodeType,
      label: stepLabel(inst, nt),
      description: nt?.description ?? '',
      builtin: !nt?.functionText,
      color: inst.config?.color ?? nt?.visuals?.color ?? null,
      icon: inst.config?.icon ?? nt?.visuals?.icon ?? null,
      pull: inst.config?.pullExecution !== undefined,
      source: nt?.functionText ?? '',
      file: nodeFile,
      line: nt?.sourceLocation?.line ?? null,
      gate: nt?.durableGate ?? null,
      // Where the node type came from, and what a pack's tags said about
      // this step: the parser resolves both and then shows neither.
      pack: packForFile(nodeFile, packs) ?? packForSpecifier(nt?.importSource, packs),
      deploy: Object.keys({ ...nt?.deploy, ...inst.deploy }).length ? { ...nt?.deploy, ...inst.deploy } : null,
      // What a step can and cannot do is the thing an author gets wrong:
      // an expression node has no onFailure, so a throw aborts the run,
      // and only a pure node may re-run when a gated workflow resumes.
      expression: !!nt?.expression,
      durablePure: !!nt?.durablePure,
      effect: !!nt?.durableEffect,
      async: !!nt?.isAsync,
      inputs: ports(nt?.inputs),
      outputs: ports(nt?.outputs),
      outputSchema: nt?.durableGate !== undefined ? gateOutputSchemas(ast, inst.id, file) : null,
      expr: (inst.config?.portConfigs ?? []).filter((c) => c.expression).map((c) => ({ port: c.portName, expr: c.expression })),
    };
  }
  const model = buildProcessModel(ast);
  // The process model does not know about pull execution or the label rule
  // above; the client reads both from the step, so stamp them on.
  type Stamped = { id: string; label: string; pull?: boolean; children: Stamped[] };
  const stamp = (steps: Stamped[]) =>
    steps.forEach((s) => { s.label = (nodes[s.id]?.label as string) ?? s.label; s.pull = !!nodes[s.id]?.pull; stamp(s.children); });
  stamp(model.steps as unknown as Stamped[]);
  const ws = workflowSource(text, ast.functionName);
  return {
    file, rel, name: ast.functionName,
    description: ast.description ?? '',
    compiled: hasInPlaceMarkers(text),
    params: ports(ast.startPorts),
    paramsSchema: workflowParamsSchema(file, ast.functionName),
    returns: ports(ast.exitPorts),
    // Port level, for the Start and Exit cards: which input each parameter
    // feeds, and which output becomes each return value.
    wiring: terminalWiring(ast),
    model,
    nodes,
    issues: [...v.errors, ...v.warnings].map(describeIssue),
    source: ws.source,
    sourceLine: ws.line,
    deploy: ast.options?.deploy && Object.keys(ast.options.deploy).length ? ast.options.deploy : null,
    // The routes the workflow declares with @http, for the Serve pane.
    http: ast.options?.http ?? [],
    reference: referenceOf(ast),
  };
}

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

/** A route as the client sent it, checked; a string says what is wrong. */
function routeFrom(raw: unknown): THttpRoute | string {
  if (typeof raw !== 'object' || raw === null) return 'a route is an object';
  const r = raw as Record<string, unknown>;
  const method = String(r.method ?? '').toUpperCase();
  if (!HTTP_METHODS.has(method)) return `method must be one of ${[...HTTP_METHODS].join(', ')}`;
  const p = String(r.path ?? '').trim();
  if (!p.startsWith('/') || /\s/.test(p)) return 'a path starts with / and has no spaces';
  if (RESERVED_PATHS.some((x) => p === x || p.startsWith(`${x}/`))) return `${p} is under a reserved path (${RESERVED_PATHS.join(', ')})`;
  const route: THttpRoute = { method: method as THttpRoute['method'], path: p };
  if (r.mode === 'async') route.mode = 'async';
  if (r.auth === 'none') route.auth = 'none';
  if (r.callback === true) route.callback = true;
  return route;
}

/**
 * Rewrite a workflow's `@http` lines: the existing ones go, the given ones
 * land after `@flowWeaver workflow`. A textual edit of the JSDoc only, and
 * the file is parsed again before it stands -- a result that does not parse
 * is put back.
 */
async function setHttpRoutes(file: string, name: string, routes: THttpRoute[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const before = fs.readFileSync(file, 'utf8');
  const ws = workflowSource(before, name);
  if (!ws.source) return { ok: false, error: `${name} was not found in ${path.basename(file)}` };
  const start = before.indexOf(ws.source);
  const block = ws.source;
  const marker = block.match(/^([ \t]*\*[ \t]*)@flowWeaver[ \t]+workflow[^\n]*\n/m);
  if (!marker || marker.index === undefined) return { ok: false, error: `${name} has no @flowWeaver workflow line` };
  const kept = block.replace(/^[ \t]*\*[ \t]*@http\b[^\n]*\n/gm, '');
  const at = kept.match(/^([ \t]*\*[ \t]*)@flowWeaver[ \t]+workflow[^\n]*\n/m)!;
  const insertAt = at.index! + at[0].length;
  const lines = routes.map((r) => `${at[1]}@http ${httpRouteText(r)}\n`).join('');
  const rewritten = kept.slice(0, insertAt) + lines + kept.slice(insertAt);
  const after = before.slice(0, start) + rewritten + before.slice(start + block.length);
  fs.writeFileSync(file, after, 'utf8');
  const p = await parseOne(file, name);
  if (!p.ast) { fs.writeFileSync(file, before, 'utf8'); return { ok: false, error: `the file no longer parsed, so it was put back: ${p.errors[0] ?? 'unknown error'}` }; }
  return { ok: true };
}

/**
 * The annotations as what they declare, for the Reference pane: options,
 * the @path chains, the @connect lines that are not implied by a path or
 * an expression, the expressions, and node types imported from packages.
 */
function referenceOf(ast: TWorkflowAST) {
  const { deploy: _deploy, ...options } = ast.options ?? {};
  const macros = ast.macros ?? [];
  const paths = macros.filter((m): m is Extract<typeof m, { type: 'path' }> => m.type === 'path').map((m) => m.steps);
  const connects = ast.connections
    .filter((c) => !c.derived && !(macros.length && isConnectionCoveredByMacroStatic(c, macros)))
    .map((c) => ({ from: { node: c.from.node, port: c.from.port }, to: { node: c.to.node, port: c.to.port } }));
  const exprs = ast.instances.flatMap((i) => (i.config?.portConfigs ?? []).filter((p) => p.expression).map((p) => ({ node: i.id, port: p.portName, expr: p.expression as string })));
  const importsFrom = ast.nodeTypes.filter((nt) => nt.importSource).map((nt) => ({ type: nt.name, from: nt.importSource as string }));
  return { options, paths, connects, exprs, importsFrom };
}

/**
 * An absolute path as clickable segments.
 *
 * `path.parse().root` is `/` on POSIX and `C:\\` on Windows, and the rest
 * splits on the platform's own separator, so the dialog works on both
 * without the client knowing which it is on.
 */
function crumbsFor(at: string): Array<{ name: string; dir: string }> {
  const { root } = path.parse(at);
  const rest = at.slice(root.length).split(path.sep).filter(Boolean);
  const crumbs: Array<{ name: string; dir: string }> = [];
  let dir = root;
  for (const name of rest) {
    dir = path.join(dir, name);
    crumbs.push({ name, dir });
  }
  return crumbs;
}

function errorCodeSection(code: string) {
  const section = readTopicStructured('error-codes')?.sections.find((s) => s.heading.includes(code));
  return section ? { heading: section.heading, content: section.content, codeBlocks: section.codeBlocks } : null;
}

// -------------------------------------------------------------------- runs

/**
 * A segment of execution this process is driving right now.
 *
 * Everything else about a run is in the store. What is held here is the
 * segment in flight -- its events so far, and the way to stop it -- and a
 * run that failed before the store had a record for it, which has nowhere
 * else to be shown.
 */
interface Live {
  id: string;
  file: string;
  name: string;
  params: Json;
  mocks?: FwMockConfig;
  source?: { commit?: string; dirty?: boolean };
  startedAt: number;
  status: 'running' | 'failed';
  error?: string;
  events: TraceEntry[];
  abort: AbortController;
}

/** The mocks a request carried, or nothing: only the four known sections, only objects. */
function mocksFrom(b: Record<string, unknown>): FwMockConfig | undefined {
  const m = b.mocks;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return undefined;
  const src = m as Record<string, unknown>;
  const out: FwMockConfig = {};
  for (const k of ['events', 'agents', 'invocations', 'gates'] as const) {
    if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && Object.keys(src[k] as object).length) out[k] = src[k] as Record<string, object>;
  }
  if (src.fast === true) out.fast = true;
  return Object.keys(out).length ? out : undefined;
}

const at = (iso: string): number => Date.parse(iso);

/**
 * A debug session as a run. Paused counts as running -- the run is alive
 * and holds the process -- and a session that stopped at a gate or was
 * aborted is neither a success nor a failure, so it is shown as cancelled
 * with the debugger's own account of why.
 */
const DEBUG_STATUS: Record<DebugView['status'], RunStatus> = {
  running: 'running', paused: 'running', completed: 'completed', failed: 'failed', aborted: 'cancelled', yielded: 'cancelled',
};
type RunStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';

function debugSnapshot(d: DebugView, source?: { commit?: string; dirty?: boolean }): Json {
  return {
    id: d.id, file: d.file, name: d.name, params: d.params, source, status: DEBUG_STATUS[d.status],
    startedAt: d.startedAt, updatedAt: d.updatedAt, result: d.result, error: d.error, traced: true,
    debug: { status: d.status, node: d.node, phase: d.phase, position: d.position, order: d.order, breakpoints: d.breakpoints },
  };
}

// ----------------------------------------------------------------- assets

/**
 * The built client lives in `dist/console`. Depending on how this module is
 * loaded that is beside it (`dist/console/server.js`), beside the CLI bundle
 * (`dist/cli/flow-weaver.mjs`) or, when running from source with tsx, two
 * levels up.
 */
function resolveAssets(explicit?: string): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [explicit, here, path.join(here, '..', 'console'), path.join(here, '..', '..', 'dist', 'console')].filter(Boolean) as string[];
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'index.html')) && fs.existsSync(path.join(dir, 'app.js')));
}

/**
 * Running from a source checkout without a build: bundle the client on the
 * fly and rebuild on change. Never taken from an installed package.
 */
async function devBuild(onRebuilt: () => void): Promise<{ serveFrom: string; scriptFrom: string } | undefined> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const uiDir = path.join(here, '..', '..', 'console-ui');
  if (!fs.existsSync(path.join(uiDir, 'src', 'main.tsx'))) return undefined;
  let esbuild: typeof import('esbuild');
  try { esbuild = await import('esbuild'); } catch { return undefined; }
  // Its own directory: `npm run build:console` writes a minified bundle to
  // dist/console, and sharing the path would have the two overwrite each
  // other depending on which ran last.
  const out = path.join(here, '..', '..', 'dist', '.console-dev');
  fs.mkdirSync(out, { recursive: true });
  const ctx = await esbuild.context({
    entryPoints: [path.join(uiDir, 'src', 'main.tsx')],
    bundle: true, outfile: path.join(out, 'app.js'), format: 'esm', target: 'es2022',
    jsx: 'automatic', jsxImportSource: 'preact', sourcemap: 'inline', logLevel: 'warning', absWorkingDir: uiDir,
    plugins: [{ name: 'reload', setup(b) { b.onEnd((res) => { if (!res.errors.length) onRebuilt(); }); } }],
  });
  await ctx.watch();
  // `index.html`, `styles.css` and `assets/` are served from source in dev,
  // so editing them needs no restart; a reload is pushed when any changes.
  const chokidar = await import('chokidar');
  chokidar.watch([path.join(uiDir, 'index.html'), path.join(uiDir, 'styles.css')], { ignoreInitial: true }).on('all', onRebuilt);
  return { serveFrom: uiDir, scriptFrom: out };
}

// ----------------------------------------------------------------- server

export async function createConsoleServer(options: ConsoleServerOptions): Promise<ConsoleServer> {
  // The project can be changed from the console, so this is not a constant:
  // the watcher, the scan and the path-containment check all follow it.
  let projectDir = path.resolve(options.projectDir);
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 4311;
  const live = new Map<string, Live>();
  // Step-through sessions: live only, never in the store, gone with the process.
  const debug = new DebugSessions();
  const debugEvents = new Map<string, TraceEntry[]>();
  // What an agent profile said while answering a gate, per run, for replay
  // to a client that opens the run later in this process's life.
  const agentEvents = new Map<string, TraceEntry[]>();
  const subs = new Map<string, Set<http.ServerResponse>>();
  const globalSubs = new Set<http.ServerResponse>();
  // The store follows the project the console is opened on, not the directory
  // the console process was launched from. An MCP server started elsewhere but
  // pointed at a file in this project resolves the same <projectRoot>/.fw/runs,
  // so a run it starts shows up here. FW_RUNS_DIR still overrides both.
  const runsDir = defaultRunsDir(projectDir);
  const coordinator = createLocalCoordinator(options.store ? { store: options.store } : { rootDir: runsDir });
  // A process that died while a profile was answering must not keep the
  // gate locked against a person.
  await reclaimStaleAgentAnswers(coordinator).catch(() => undefined);

  /** The project's agent profiles, re-read when the file changes or the project does. */
  let profilesCache: { dir: string; mtime: number; profiles: AgentProfiles } | undefined;
  function profilesFor(): AgentProfiles {
    let mtime = 0;
    try { mtime = fs.statSync(agentsFile(projectDir)).mtimeMs; } catch { mtime = 0; }
    if (!profilesCache || profilesCache.dir !== projectDir || profilesCache.mtime !== mtime) profilesCache = { dir: projectDir, mtime, profiles: loadAgentProfiles(projectDir) };
    return profilesCache.profiles;
  }
  /** The profiles as the Agents view shows them: readiness by environment, never a key. */
  function describeAgents(): Json {
    const p = profilesFor();
    return {
      file: p.file, exists: p.exists, default: p.default ?? null, errors: p.errors, gates: p.gates, starter: STARTER_AGENTS_YAML, suggestedModels: SUGGESTED_MODELS,
      agents: Object.values(p.agents).map((a) => {
        const r = readiness(a);
        return { name: a.name, provider: a.provider, model: a.model || DEFAULT_MODEL[a.provider] || null, keyEnv: keyEnvOf(a) ?? null, ready: r.ready, reason: r.reason ?? null, description: a.description ?? null, system: a.system ?? null, maxIterations: a.maxIterations ?? null, baseUrl: a.baseUrl ?? null, bin: a.bin ?? null };
      }),
    };
  }
  /**
   * The project's services: ours, and those the registry knows. A change of
   * state is broadcast so every page refreshes; the lines go to whoever
   * opened the log stream.
   */
  const superviseFor = (dir: string) => new Supervisor({
    projectDir: dir,
    ...options.services,
    onChange: (e) => { if (!e.line) broadcast({ type: 'services', kind: e.kind, state: e.state, url: e.url ?? null, exitCode: e.exitCode ?? null, error: e.error ?? null }); },
  });
  let supervisor = superviseFor(projectDir);

  /** Whether `fw serve` is running for this project: ours, or from a terminal. */
  function describeServe(): Json {
    const s = supervisor.view('serve');
    return {
      running: s.state === 'running' && s.pid ? { url: s.url ?? null, pid: s.pid, startedAt: s.startedAt, version: s.activity?.version ?? VERSION, install: s.activity?.install ?? '', owned: s.owned, token: s.token ?? null } : null,
      state: s.state,
      command: 'fw serve --trace',
    };
  }

  const broadcast = (msg: Json) => {
    const line = `data: ${JSON.stringify(msg)}\n\n`;
    for (const res of globalSubs) res.write(line);
  };
  const push = (id: string, msg: Json) => {
    const line = `data: ${JSON.stringify(msg)}\n\n`;
    for (const res of subs.get(id) ?? []) res.write(line);
  };

  /**
   * The store is read for every listing and every rail refresh; a project
   * with hundreds of past runs would have each of those read hundreds of
   * files. One reading serves everything asked within the same moment.
   */
  let listed: { at: number; rows: RunSummary[] } | undefined;
  const storeList = async (): Promise<RunSummary[]> => {
    if (!listed || Date.now() - listed.at > 500) listed = { at: Date.now(), rows: await coordinator.list() };
    return listed.rows;
  };
  // The latest counts, for callers that cannot wait -- a verdict announced
  // from the checker uses the counts of the last listing.
  let lastCounts = new Map<string, number>();
  const waitingCounts = async () => {
    const counts = new Map<string, number>();
    for (const s of await storeList()) if (s.status === 'waiting') counts.set(`${s.filePath}|${s.workflowName}`, (counts.get(`${s.filePath}|${s.workflowName}`) ?? 0) + 1);
    lastCounts = counts;
    return counts;
  };
  const withWaiting = (w: { file: string; name: string }, counts = lastCounts) => ({
    ...w,
    waiting: counts.get(`${w.file}|${w.name}`) ?? 0,
  });

  /**
   * The parsed workflow behind a run, for labelling its gate. Parsing takes
   * a second; a run is looked at far more often than its file changes.
   */
  const asts = new Map<string, { mtimeMs: number; ast: TWorkflowAST | undefined }>();
  async function astFor(file: string, name: string): Promise<TWorkflowAST | undefined> {
    const key = `${file}|${name}`;
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(file).mtimeMs; } catch { return undefined; }
    const hit = asts.get(key);
    if (hit && hit.mtimeMs === mtimeMs) return hit.ast;
    const { ast } = await parseOne(file, name);
    asts.set(key, { mtimeMs, ast });
    return ast;
  }

  /** The gate as the answer form needs it: the record's labels plus the shape of each output. */
  async function gateView(rec: RunRecord): Promise<Json | undefined> {
    const g = rec.gate;
    if (!g) return undefined;
    const ast = await astFor(rec.filePath, rec.workflowName);
    const inst = ast?.instances.find((i) => i.id === g.node);
    const nt = ast && inst ? nodeTypeOf(ast, inst) : undefined;
    return {
      id: g.id, kind: g.kind, node: g.node, inputs: g.inputs, absent: g.absent, outputs: g.outputs,
      hasSuccessPort: g.hasSuccessPort, hasFailurePort: g.hasFailurePort,
      outputTypes: Object.fromEntries(g.outputs.map((o) => [o, nt?.outputs?.[o]?.tsType ?? 'unknown'])),
      outputSchema: ast ? gateOutputSchemas(ast, g.node, rec.filePath) : null,
      // The words for whoever answers: the gate function's own description,
      // and each output's label from its @output line. Types alone say what
      // shape an answer has, not what it means.
      description: nt?.description ?? '',
      outputLabels: Object.fromEntries(g.outputs.map((o) => [o, nt?.outputs?.[o]?.label ?? ''])),
      inputLabels: Object.fromEntries(Object.keys(g.inputs).map((i) => [i, nt?.inputs?.[i]?.label ?? ''])),
    };
  }

  /** A run as the client sees it: the live segment if there is one, else the record. */
  async function snapshot(id: string): Promise<Json | undefined> {
    const d = debug.get(id);
    if (d) return debugSnapshot(d, debugSource.get(id));
    const l = live.get(id);
    const rec = await coordinator.record(id);
    if (l) return { id, file: l.file, name: l.name, params: l.params, mocks: l.mocks, source: l.source, status: l.status, startedAt: l.startedAt, updatedAt: Date.now(), error: l.error, traced: true, agent: rec?.agent, agents: rec?.agents, origin: rec?.origin ?? 'console' };
    if (!rec) return undefined;
    return {
      id, file: rec.filePath, name: rec.workflowName, params: rec.params, mocks: rec.mocks, source: rec.source, status: rec.status,
      startedAt: at(rec.createdAt), updatedAt: at(rec.updatedAt),
      gate: rec.gate ? { node: rec.gate.node, kind: rec.gate.kind } : undefined,
      due: rec.due ? { at: at(rec.due.at), action: rec.due.action } : undefined,
      result: rec.result, error: rec.error, failedAt: rec.failedNode, traced: !!rec.traced,
      agent: rec.agent, agents: rec.agents, origin: rec.origin,
    };
  }
  /** The same, with the gate fully labelled -- what an open run shows. */
  async function fullSnapshot(id: string): Promise<Json | undefined> {
    const snap = await snapshot(id);
    const rec = live.has(id) ? undefined : await coordinator.record(id);
    return snap && rec?.gate ? { ...snap, gate: await gateView(rec) } : snap;
  }
  async function pushRun(id: string): Promise<void> {
    if (!subs.get(id)?.size) return;
    const run = await fullSnapshot(id);
    if (run) push(id, { type: 'run', run });
  }

  /**
   * Parse and validate in the background, announcing each verdict.
   *
   * Only one pass runs at a time: the console re-lists on every file
   * change, and a project of any size takes long enough that overlapping
   * passes would pile up.
   */
  let checking: Promise<void> | undefined;
  function queueCheck(): void {
    if (checking) return;
    const dir = projectDir;
    checking = checkWorkflows(dir, (summary) => {
      if (dir === projectDir) broadcast({ type: 'checked', workflow: withWaiting(summary) });
    })
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => { checking = undefined; });
  }

  /**
   * Drive one segment -- a start, or a resume -- through the coordinator,
   * relaying its events to whoever is watching. The coordinator commits the
   * outcome; this only announces it.
   */
  async function drive(l: Live, segment: (onEvent: (ev: ExecutionTraceEvent) => void) => Promise<unknown>): Promise<void> {
    live.set(l.id, l);
    listed = undefined;
    broadcast({ type: 'runs' });
    void pushRun(l.id);
    const onEvent = (ev: ExecutionTraceEvent) => {
      const entry = { t: ev.timestamp, e: ev.data ?? ev };
      l.events.push(entry);
      push(l.id, { type: 'event', ...entry });
    };
    try {
      await segment(onEvent);
      live.delete(l.id);
    } catch (err) {
      // With a record in the store the failure is already written there. A
      // run refused before that -- a file that stopped parsing, a bundle
      // that could not be fingerprinted -- is kept here so it is still shown.
      if (await coordinator.record(l.id)) live.delete(l.id);
      else { l.status = 'failed'; l.error = err instanceof Error ? err.message : String(err); }
    }
    listed = undefined;
    await pushRun(l.id);
    broadcast({ type: 'runs' });
    void afterSegment(l.id);
  }

  /**
   * After a segment stopped at an agent gate: the matching profile answers
   * it, with the model's words streamed to whoever is watching, and the run
   * resumes with the answer -- another segment, which may reach another
   * gate and come back here. A profile that is missing, not ready, or gave
   * nothing usable leaves the gate waiting, with the reason on the run.
   */
  async function afterSegment(id: string, asked = false): Promise<void> {
    const rec = await coordinator.record(id);
    if (!rec || rec.status !== 'waiting' || rec.gate?.kind !== 'agent' || (rec.agents === 'manual' && !asked)) return;
    // A run started manual is answered only when a person asks for it; the
    // coordinator's own guard is the record's mode, so lift it for this gate.
    if (asked && rec.agents === 'manual') await coordinator.setAgent(id, rec.agent);
    const note = async () => { listed = undefined; await pushRun(id); broadcast({ type: 'runs' }); };
    try {
      const step = await answerAgentGate(coordinator, id, {
        projectDir,
        profiles: profilesFor(),
        outputSchema: async (r) => {
          const g = await gateView(r) as { outputSchema?: Record<string, FieldSchema> | null; outputTypes?: Record<string, string> } | undefined;
          return g ? { schema: g.outputSchema ?? null, types: g.outputTypes } : undefined;
        },
        onEvent: (e: AgentGateEvent) => {
          const entry = { t: Date.now(), e };
          (agentEvents.get(id) ?? agentEvents.set(id, []).get(id)!).push(entry);
          push(id, { ...e, t: entry.t });
          if (e.phase === 'start' || e.phase === 'done') void note();
        },
      });
      await note();
      if (step.kind === 'answer') await resumeRun(id, { answer: step.answer });
      else if (step.kind === 'reject') await resumeRun(id, { reject: step.reason });
    } catch (err) {
      // A malformed answer is the model's failure, not the run's.
      const rec2 = await coordinator.record(id);
      if (rec2?.agent?.status === 'answered' || rec2?.agent?.status === 'rejected') {
        await coordinator.setAgent(id, { ...rec2.agent, status: 'failed', error: `the answer did not fit the gate: ${err instanceof Error ? err.message : String(err)}` });
      }
      await note();
    }
  }

  /**
   * Start a session that pauses before its first node. Listed at once, so
   * the answer carries the id; the first pause arrives over the stream.
   */
  /** Where the file stood when each session started; the store keeps it for ordinary runs. */
  const debugSource = new Map<string, { commit?: string; dirty?: boolean }>();
  function startDebug(file: string, name: string, params: Json, breakpoints: string[], mocks: FwMockConfig | undefined, runTo: 'first' | 'breakpoint', source?: { commit?: string; dirty?: boolean }): Json {
    const id = randomUUID();
    const events: TraceEntry[] = [];
    debugEvents.set(id, events);
    if (source) debugSource.set(id, source);
    void debug.start({
      id, file, name, params, breakpoints, mocks,
      onEvent: (ev) => {
        const entry = { t: ev.timestamp, e: ev.data ?? ev };
        events.push(entry);
        push(id, { type: 'event', ...entry });
      },
      onChange: () => { void pushRun(id); broadcast({ type: 'runs' }); },
    }).then((view) => {
      // A session always pauses before its first step; when the person asked
      // to run to the first breakpoint instead, it is let go from there.
      if (runTo === 'breakpoint' && view.status === 'paused' && breakpoints.length) return debug.continue(id, true).then(() => undefined);
    }).catch(() => undefined);
    broadcast({ type: 'runs' });
    // The session is registered before its first await, so it is here to show.
    return debugSnapshot(debug.get(id)!, debugSource.get(id));
  }

  async function startRun(file: string, name: string, params: Json, mocks?: FwMockConfig, source?: { commit?: string; dirty?: boolean }, agents?: 'auto' | 'manual'): Promise<Json> {
    // Refuse a broken file now, with the parser's message, rather than as a
    // failed run a moment later.
    const ast = await astFor(file, name);
    if (!ast) throw new Error((await parseOne(file, name)).errors.join('\n'));
    const id = randomUUID();
    const l: Live = { id, file, name, params, mocks, source, startedAt: Date.now(), status: 'running', events: [], abort: new AbortController() };
    void drive(l, (onEvent) =>
      coordinator.start({ filePath: file, workflowName: name, params, runId: id, mocks, source, agents, origin: 'console' }, { onEvent, abortSignal: l.abort.signal }));
    return (await snapshot(id))!;
  }

  async function resumeRun(id: string, input: { answer?: unknown; reject?: string }): Promise<void> {
    const rec = await coordinator.record(id);
    if (!rec || rec.status !== 'waiting' || !rec.gate) throw new Error('run is not waiting');
    if (live.has(id)) throw new Error('run is already resuming');
    if (isAnswering(rec.agent, rec.gate.id)) throw new Error(`agent profile ${rec.agent!.profile} is answering this gate. Wait for it, or cancel the run`);
    // Both refusals happen before anything runs, so they are checked here
    // and answered to the person, rather than surfacing from a background
    // segment as a run that quietly stayed waiting.
    const resolve = 'reject' in input ? { reject: input.reject ?? '' } : { answer: input.answer };
    buildGateResolution(rec.gate, rec.gate.id, resolve);
    if (await computeBundleDigest(rec.filePath, rec.workflowName) !== rec.bundleDigest) {
      throw new Error('The workflow changed since this run paused. Start a new run.');
    }
    const l: Live = { id, file: rec.filePath, name: rec.workflowName, params: rec.params, startedAt: at(rec.createdAt), status: 'running', events: [], abort: new AbortController() };
    void drive(l, (onEvent) => coordinator.resume({ runId: id, input: resolve }, { onEvent, abortSignal: l.abort.signal }));
  }

  async function cancelRun(id: string): Promise<void> {
    if (debug.get(id)) { await debug.abort(id).catch(() => undefined); return; }
    const l = live.get(id);
    if (l?.status === 'running') { l.abort.abort(); return; }
    if ((await coordinator.record(id))?.status === 'waiting') {
      await coordinator.cancel(id);
      listed = undefined;
      await pushRun(id);
      broadcast({ type: 'runs' });
    }
  }

  /** Runs of one workflow, or all: what is in flight here, then the store, newest first. */
  async function listRuns(file: string, name: string): Promise<Json[]> {
    const inFlight = [
      ...debug.list().filter((d) => (!file || d.file === file) && (!name || d.name === name)).map((d) => debugSnapshot(d, debugSource.get(d.id))),
      ...(await Promise.all([...live.values()].filter((l) => (!file || l.file === file) && (!name || l.name === name)).map(async (l) => (await snapshot(l.id))!))),
    ];
    const stored = (file ? await coordinator.list({ filePath: file }) : await storeList())
      .filter((s) => (!name || s.workflowName === name) && !live.has(s.runId))
      .map((s) => ({
        id: s.runId, file: s.filePath, name: s.workflowName, status: s.status, params: s.params, mocks: s.mocks, source: s.source,
        startedAt: at(s.createdAt), updatedAt: at(s.updatedAt), gate: s.gate, failedAt: s.failedNode, origin: s.origin,
        due: s.due ? { at: at(s.due.at), action: s.due.action } : undefined,
      }));
    // Runs accumulate indefinitely; a list of hundreds is not history a
    // person reads. What is in flight is never dropped.
    return [...inFlight, ...stored].sort((a, b) => (b.startedAt as number) - (a.startedAt as number)).filter((r, i) => i < 20 || live.has(r.id as string) || debug.get(r.id as string));
  }

  // ---- live updates
  let watcher: FSWatcher | undefined;
  const watching = options.watch !== false;
  async function watchProject(): Promise<void> {
    if (!watching) return;
    await watcher?.close();
    const chokidar = await import('chokidar');
    watcher = chokidar.watch(projectDir, {
      ignoreInitial: true,
      ignored: (p: string) => /(^|[\\/])(node_modules|dist|\.git|\.fw)([\\/]|$)/.test(p) || /(^|[\\/])\.fw-diff-/.test(p),
    });
    watcher.on('all', (_event, file) => {
      if (typeof file === 'string' && file.endsWith('.ts')) {
        // A file may have gained or lost a workflow, so the listing is stale.
        invalidateListing(projectDir);
        broadcast({ type: 'changed', file });
      }
    });
  }
  await watchProject();
  // Packs installed in the project may bring topics of their own.
  await loadPackDocTopics(projectDir).catch(() => 0);

  // The store is shared with `fw_run`/`fw_resume`: a gate answered from an
  // assistant, or a run started there, shows up here as it happens.
  let storeWatcher: FSWatcher | undefined;
  let storePoll: NodeJS.Timeout | undefined;
  if (watching && !options.store) {
    fs.mkdirSync(runsDir, { recursive: true });
    const chokidar = await import('chokidar');
    storeWatcher = chokidar.watch(runsDir, { ignoreInitial: true, depth: 1 });
    storeWatcher.on('all', (_event, file) => {
      if (typeof file !== 'string' || path.basename(file) !== 'run.json') return;
      listed = undefined;
      broadcast({ type: 'runs' });
      void pushRun(path.basename(path.dirname(file)));
    });
  } else if (watching) {
    // A store of the caller's own has nothing to watch: ask it now and then,
    // and tell the clients when a run they can see has moved on.
    let seen = new Map<string, string>();
    storePoll = setInterval(() => {
      void coordinator.list().then((rows) => {
        const now = new Map(rows.map((r) => [r.runId, r.updatedAt]));
        const changed = rows.filter((r) => seen.get(r.runId) !== r.updatedAt).map((r) => r.runId);
        const gone = [...seen.keys()].some((id) => !now.has(id));
        seen = now;
        if (!changed.length && !gone) return;
        listed = undefined;
        broadcast({ type: 'runs' });
        for (const id of changed) if (!live.has(id)) void pushRun(id);
      }).catch(() => undefined);
    }, 3000);
    storePoll.unref?.();
  }

  // The clock: a sleeping run wakes, a gate with a timeout gives up, without
  // anyone at the console. Runs the server also ticks are moved once; the
  // claim decides who, and the other side sees the record change.
  const clock = setInterval(() => {
    void coordinator.tick().then(async (moved) => {
      for (const run of [...moved.woke, ...moved.timedOut]) {
        listed = undefined;
        await pushRun(run.runId);
        broadcast({ type: 'runs' });
        void afterSegment(run.runId);
      }
    }).catch(() => undefined);
  }, 3000);
  clock.unref?.();

  const heartbeat = setInterval(() => {
    for (const res of globalSubs) res.write(': ping\n\n');
    for (const set of subs.values()) for (const res of set) res.write(': ping\n\n');
  }, 15000);

  // ---- client assets. In a source checkout the live client wins, so that
  // editing `console-ui/` takes effect even when a built dist/console from
  // an earlier `npm run build` is sitting there. An installed package has
  // no source tree, so it falls through to the built one.
  const dev = options.assetsDir ? undefined : await devBuild(() => broadcast({ type: 'client' }));
  const built = dev ? undefined : resolveAssets(options.assetsDir);
  if (!built && !dev) throw new Error('console client not found: run `npm run build:console`, or pass assetsDir');
  const pageDir = dev?.serveFrom ?? built!;
  const scriptDir = dev?.scriptFrom ?? built!;

  // ---- http
  const actualPortRef = { value: port };
  const sse = (res: http.ServerResponse) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': ok\n\n');
  };
  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const file = (res: http.ServerResponse, p: string, type: string) => {
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(fs.readFileSync(p));
  };
  /** A request body that is not a JSON object is the client's mistake, answered with 400 rather than 500. */
  class BadRequest extends Error {}
  const MAX_BODY = 1024 * 1024;
  const body = async (req: http.IncomingMessage): Promise<Json> => {
    let s = '';
    for await (const c of req) {
      s += c;
      if (s.length > MAX_BODY) throw new BadRequest(`the body may not exceed ${MAX_BODY} bytes`);
    }
    if (!s.trim()) return {};
    let parsed: unknown;
    try { parsed = JSON.parse(s); } catch { throw new BadRequest('the body is not valid JSON'); }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new BadRequest('the body must be a JSON object');
    return parsed as Json;
  };
  /**
   * The absolute path, if it is inside the project; null otherwise.
   *
   * Compared case-insensitively on Windows and macOS, where `C:\\Proj` and
   * `c:\\proj` are the same directory and a case-sensitive check would
   * refuse a file the user legitimately opened.
   */
  const inProject = (p: string): string | null => {
    if (!p) return null;
    const abs = path.resolve(p);
    const fold = (x: string) => (path.sep === '\\' || process.platform === 'darwin' ? x.toLowerCase() : x);
    const a = fold(abs);
    const root = fold(projectDir);
    return a === root || a.startsWith(root + path.sep) ? abs : null;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}`);
    const q = (k: string) => url.searchParams.get(k) ?? '';
    try {
      if (url.pathname === '/') return file(res, path.join(pageDir, 'index.html'), 'text/html');
      if (url.pathname === '/app.js') return file(res, path.join(scriptDir, 'app.js'), 'text/javascript');
      if (url.pathname === '/styles.css') return file(res, path.join(pageDir, 'styles.css'), 'text/css');
      if (url.pathname === '/synergenius.svg') return file(res, path.join(pageDir, 'assets', 'synergenius.svg'), 'image/svg+xml');

      if (url.pathname === '/api/project' && req.method === 'GET') {
        return json(res, 200, { dir: projectDir, name: path.basename(projectDir), parent: path.dirname(projectDir) });
      }

      // Opening another project. The console is a local tool driving a local
      // engine, so any directory the user can read is fair game -- but it
      // must exist, and the answer re-points the watcher and the containment
      // check together so neither is left pointing at the old project.
      if (url.pathname === '/api/project' && req.method === 'POST') {
        const target = path.resolve(String((await body(req)).dir ?? ''));
        if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
          return json(res, 400, { error: `not a directory: ${target}` });
        }
        projectDir = target;
        invalidateListing(projectDir);
        // The services were the old project's; this one gets its own.
        await supervisor.close().catch(() => undefined);
        supervisor = superviseFor(projectDir);
        await watchProject();
        await loadPackDocTopics(projectDir).catch(() => 0);
        options.onProject?.(projectDir);
        broadcast({ type: 'project' });
        return json(res, 200, { dir: projectDir, name: path.basename(projectDir), parent: path.dirname(projectDir) });
      }

      // Directories to choose from, so the console can offer a picker
      // rather than asking someone to type a path.
      if (url.pathname === '/api/browse') {
        const at = path.resolve(q('dir') || projectDir);
        try {
          const entries = fs.readdirSync(at, { withFileTypes: true })
            .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
            .map((e) => ({ name: e.name, dir: path.join(at, e.name) }))
            .sort((a, b) => a.name.localeCompare(b.name));
          // The client cannot split an absolute path safely -- `/a/b` and
          // `C:\\a\\b` need different rules -- so the segments are built here.
          return json(res, 200, { dir: at, parent: path.dirname(at), entries, crumbs: crumbsFor(at) });
        } catch (err) {
          return json(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
      }
      if (url.pathname === '/api/workflows') {
        // Names first, so the rail fills immediately; the verdicts follow
        // over the event stream as each workflow is parsed.
        const list = scanWorkflowNames(projectDir);
        queueCheck();
        const counts = await waitingCounts();
        return json(res, 200, list.map((w) => withWaiting(w, counts)));
      }
      // A workflow as something to hand to someone: a brief for people who
      // will not open the code, or the diagram. Sent as a download,
      // self-contained.
      if (url.pathname === '/api/artifact') {
        const target = inProject(q('file'));
        if (!target) return json(res, 400, { error: 'file is outside the project' });
        const { ast, errors } = await parseOne(target, q('name'));
        if (!ast) return json(res, 400, { error: errors.join('\n') || 'does not parse' });
        const theme = q('theme') === 'dark' ? 'dark' : 'light';
        const kind = q('kind') as ArtifactKind;
        if (!ARTIFACT_KINDS.includes(kind)) return json(res, 400, { error: `unknown artifact ${kind}` });
        let artifact;
        try { artifact = await renderArtifact(ast, kind, { theme, subtitle: path.basename(projectDir) }); }
        catch (e) { return json(res, 500, { error: (e as Error).message }); }
        res.writeHead(200, { 'Content-Type': artifact.type, 'Content-Disposition': `attachment; filename="${ast.functionName}${artifact.extension}"`, 'Cache-Control': 'no-cache' });
        return res.end(artifact.body);
      }
      const wfFile = url.pathname.startsWith('/api/workflow') || url.pathname === '/api/diff' || url.pathname === '/api/git/history' ? inProject(q('file')) : null;
      if (url.pathname === '/api/workflow') {
        if (!wfFile) return json(res, 400, { error: 'file is outside the project' });
        return json(res, 200, await describeWorkflow(projectDir, wfFile, q('name')));
      }
      // Expose a workflow as an endpoint, or change its routes: the @http
      // lines are rewritten, nothing else in the file is touched.
      if (url.pathname === '/api/workflow/http' && req.method === 'PUT') {
        const b = await body(req);
        const target = inProject(String(b.file ?? ''));
        if (!target) return json(res, 400, { error: 'file is outside the project' });
        const routes: THttpRoute[] = [];
        for (const raw of Array.isArray(b.routes) ? b.routes : []) {
          const r = routeFrom(raw);
          if (typeof r === 'string') return json(res, 400, { error: r });
          if (routes.some((x) => x.method === r.method && x.path === r.path)) return json(res, 400, { error: `${r.method} ${r.path} is listed twice` });
          routes.push(r);
        }
        const out = await setHttpRoutes(target, String(b.name ?? ''), routes);
        if (!out.ok) return json(res, 400, { error: out.error });
        return json(res, 200, await describeWorkflow(projectDir, target, String(b.name)));
      }
      // Every route the project declares, as one list: what `fw serve` or
      // an embedding would mount, and what it would refuse.
      if (url.pathname === '/api/endpoints') {
        const names = scanWorkflowNames(projectDir);
        const parsed = await Promise.all(names.map(async (w) => {
          const p = await parseOne(w.file, w.name);
          const ast = p.ast;
          const gates = ast ? ast.instances.filter((i) => nodeTypeOf(ast, i)?.durableGate !== undefined).length : 0;
          return { file: w.file, rel: w.rel, name: w.name, description: ast?.description ?? '', routes: ast?.options?.http ?? [], gates, params: ast ? ports(ast.startPorts) : [], returns: ast ? ports(ast.exitPorts) : [], parses: !!ast };
        }));
        const plan = planRoutes(parsed.map((w) => ({ name: w.name, routes: w.routes, w })));
        return json(res, 200, {
          workflows: parsed.filter((w) => w.routes.length).map(({ routes, ...w }) => ({ ...w, routes: routes.map((r) => ({ ...r, mounted: plan.mounted.some((m) => m.owner.name === w.name && m.route === r) })) })),
          candidates: parsed.filter((w) => !w.routes.length && w.parses).map(({ routes: _r, ...w }) => w),
          problems: plan.problems,
          serve: describeServe(),
        });
      }
      // Version control: the commits that touched a file, and two versions
      // of a workflow as one marked picture. `from`/`to` are git refs, or
      // `worktree` for the file as it is now.
      if (url.pathname === '/api/git/history') {
        if (!wfFile) return json(res, 400, { error: 'file is outside the project' });
        return json(res, 200, await fileHistory(wfFile));
      }
      if (url.pathname === '/api/diff') {
        if (!wfFile) return json(res, 400, { error: 'file is outside the project' });
        const name = q('name'), from = q('from') || 'HEAD', to = q('to') || 'worktree';
        const [a, b] = await Promise.all([astAt(wfFile, name, from), astAt(wfFile, name, to)]);
        if (!a.ast) return json(res, 400, { error: a.error });
        if (!b.ast) return json(res, 400, { error: b.error });
        return json(res, 200, { from, to, ...buildDiffView(a.ast, b.ast) });
      }
      // An empty or one-letter query matches every topic with an empty
      // heading and excerpt, which is noise rather than a result list.
      if (url.pathname === '/api/docs/search') {
        const query = q('q').trim();
        const limit = Math.min(80, Math.max(1, Number(q('limit')) || 12));
        return json(res, 200, query.length < 2 ? [] : searchDocs(query).filter((r) => r.heading).slice(0, limit));
      }
      if (url.pathname === '/api/docs/topics') return json(res, 200, listTopics());
      if (url.pathname === '/api/docs/guide') {
        return json(res, 200, guideOutline(listTopics(), new Set(getPackDocTopics().map((t) => t.slug))));
      }
      // The page as markdown for rendering, its sections for the contents
      // list, and the compact form -- what `fw_docs` hands an assistant --
      // for copying into a conversation.
      if (url.pathname === '/api/docs/topic') {
        const slug = q('slug');
        const full = readTopic(slug);
        if (!full) return json(res, 404, { error: `no topic ${slug}` });
        const structured = readTopicStructured(slug);
        return json(res, 200, {
          slug, name: full.name, description: full.description,
          sections: structured?.sections.map((s) => ({ heading: s.heading, level: s.level })) ?? [],
          markdown: full.content,
          compact: readTopic(slug, true)?.content ?? '',
        });
      }
      // Core commands from the reference, then each installed pack's, so
      // completion knows `fw audio replay` as well as `fw validate`.
      if (url.pathname === '/api/cli/commands') {
        const packCommands = (await describePacks(projectDir)).flatMap((p) => p.cliCommands.map((c) => ({
          name: `${p.namespace} ${c.name}`, words: [p.namespace, c.name], group: `Pack: ${p.namespace}`,
          description: c.description, usage: c.usage, flags: c.flags, examples: [],
        })));
        return json(res, 200, [...cliCatalog(), ...packCommands]);
      }
      if (url.pathname === '/api/packs') return json(res, 200, await describePacks(projectDir));
      if (url.pathname === '/api/export/targets') return json(res, 200, await listTargets(projectDir));
      // The project as a pack: cheap to detect, slow to check (every source
      // file is parsed), so the check is a separate call made on request.
      if (url.pathname === '/api/pack-project') return json(res, 200, detectPackProject(projectDir));
      // Everything around the project: services alive, MCP registrations,
      // the environment and registries. Probes are brief.
      if (url.pathname === '/api/status') {
        return json(res, 200, await describeStatus(projectDir, { url: `http://${host}:${actualPortRef.value}`, watching, runsDir: options.store ? 'a run store of your own' : runsDir }));
      }
      if (url.pathname === '/api/pack-project/check') {
        if (!detectPackProject(projectDir).isPack) return json(res, 400, { error: 'the project is not a pack' });
        try { return json(res, 200, await checkPackProject(projectDir)); }
        catch (err) { return json(res, 400, { error: err instanceof Error ? err.message : String(err) }); }
      }
      if (url.pathname === '/api/export' && req.method === 'POST') {
        const b = await body(req);
        const target = inProject(String(b.file));
        if (!target) return json(res, 400, { error: 'file is outside the project' });
        try {
          return json(res, 200, await runExport(projectDir, {
            file: target, name: String(b.name), target: String(b.target),
            outputDir: typeof b.outputDir === 'string' && b.outputDir ? path.resolve(projectDir, b.outputDir) : undefined,
            preview: b.preview !== false,
          }));
        } catch (err) {
          return json(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
      }
      // The marketplace is npm: a search goes to the registry, and installing
      // is `fw market install`, which the CLI pane runs when asked to.
      if (url.pathname === '/api/market/search') {
        // Every registry the project's npm uses, credentials included: a
        // private pack is on a private registry, and .npmrc says which.
        return json(res, 200, await searchAllRegistries({ query: q('q') || undefined, limit: 30, projectDir }));
      }
      // An fw command, run in the project, its output streamed back. The
      // argument list is spawned as is -- no shell -- and the child goes
      // when the page lets go of the stream.
      if (url.pathname === '/api/cli/run' && req.method === 'POST') {
        const argv = (await body(req)).argv;
        const plan = planFwCommand(Array.isArray(argv) ? (argv as string[]) : []);
        if (!plan.ok) return json(res, 400, { error: plan.error });
        sse(res);
        const started = Date.now();
        const send = (msg: Json) => res.write(`data: ${JSON.stringify(msg)}\n\n`);
        send({ type: 'start', args: plan.args });
        let child: ReturnType<typeof spawnFw>;
        try { child = spawnFw(plan.args, projectDir); }
        catch (err) { send({ type: 'exit', code: null, error: err instanceof Error ? err.message : String(err), ms: 0 }); res.end(); return; }
        child.stdout?.on('data', (d: Buffer) => send({ type: 'out', text: d.toString() }));
        child.stderr?.on('data', (d: Buffer) => send({ type: 'err', text: d.toString() }));
        const timer = setTimeout(() => child.kill(), 5 * 60 * 1000);
        child.on('error', (err) => { send({ type: 'exit', code: null, error: err.message, ms: Date.now() - started }); res.end(); });
        child.on('close', (code) => { clearTimeout(timer); send({ type: 'exit', code, ms: Date.now() - started }); res.end(); });
        req.on('close', () => { clearTimeout(timer); if (child.exitCode === null) child.kill(); });
        return;
      }
      if (url.pathname === '/api/docs/error') return json(res, 200, errorCodeSection(q('code')));
      if (url.pathname === '/api/agents') return json(res, 200, describeAgents());
      // Whether an environment variable is set here -- never its value.
      if (url.pathname === '/api/agents/env') return json(res, 200, { name: q('name'), set: /^[A-Z_][A-Z0-9_]*$/.test(q('name')) && !!process.env[q('name')] });
      if (url.pathname === '/api/agents/default' && req.method === 'PUT') {
        const b = await body(req);
        const p = profilesFor();
        const name = typeof b.name === 'string' && b.name ? b.name : undefined;
        if (name && !p.agents[name]) return json(res, 400, { error: `no profile named ${name}` });
        saveAgentProfiles(projectDir, { agents: p.agents, default: name, gates: p.gates });
        profilesCache = undefined;
        return json(res, 200, describeAgents());
      }
      if (url.pathname === '/api/agents/gates' && req.method === 'PUT') {
        const b = await body(req);
        const p = profilesFor();
        const key = typeof b.key === 'string' ? b.key.trim() : '';
        if (!key) return json(res, 400, { error: 'a gate key is an agentId or workflow/node' });
        const gates = { ...p.gates };
        if (typeof b.profile === 'string' && b.profile) {
          if (!p.agents[b.profile]) return json(res, 400, { error: `no profile named ${b.profile}` });
          gates[key] = b.profile;
        } else delete gates[key];
        saveAgentProfiles(projectDir, { agents: p.agents, default: p.default, gates });
        profilesCache = undefined;
        return json(res, 200, describeAgents());
      }
      const am = url.pathname.match(/^\/api\/agents\/(profiles|try)\/([^/]+)$/);
      if (am) {
        const name = decodeURIComponent(am[2]);
        const p = profilesFor();
        if (am[1] === 'try' && req.method === 'POST') {
          const profile = p.agents[name];
          if (!profile) return json(res, 404, { error: `no profile named ${name}` });
          return json(res, 200, await tryProfile(profile, process.env, { cwd: projectDir }));
        }
        if (am[1] === 'profiles' && req.method === 'PUT') {
          const b = await body(req);
          const str = (k: string) => (typeof b[k] === 'string' && (b[k] as string).trim() ? (b[k] as string).trim() : undefined);
          const num = (k: string) => (typeof b[k] === 'number' ? (b[k] as number) : typeof b[k] === 'string' && (b[k] as string).trim() ? Number(b[k]) : undefined);
          const profile: AgentProfile = {
            name, provider: b.provider as AgentProfile['provider'],
            model: str('model'), apiKeyEnv: str('apiKeyEnv'), baseUrl: str('baseUrl'), system: typeof b.system === 'string' && b.system.trim() ? b.system : undefined,
            maxIterations: num('maxIterations'), maxTokens: num('maxTokens'), bin: str('bin'), description: str('description'),
          };
          const problems = validateProfile(profile);
          if (problems.length) return json(res, 400, { error: problems.join('; ') });
          const agents = { ...p.agents, [name]: profile };
          // The first profile becomes the default: one profile with no
          // default would answer nothing, which is never what adding one means.
          const def = p.default && agents[p.default] ? p.default : (Object.keys(agents).length === 1 ? name : p.default);
          saveAgentProfiles(projectDir, { agents, default: def, gates: p.gates });
          profilesCache = undefined;
          return json(res, 200, describeAgents());
        }
        if (am[1] === 'profiles' && req.method === 'DELETE') {
          if (!p.agents[name]) return json(res, 404, { error: `no profile named ${name}` });
          const agents = { ...p.agents }; delete agents[name];
          const gates = Object.fromEntries(Object.entries(p.gates).filter(([, v]) => v !== name));
          saveAgentProfiles(projectDir, { agents, default: p.default === name ? undefined : p.default, gates });
          profilesCache = undefined;
          return json(res, 200, describeAgents());
        }
      }
      if (url.pathname === '/api/serve') return json(res, 200, describeServe());
      // The project's services: what runs, its settings, start and stop, its output.
      if (url.pathname === '/api/services') return json(res, 200, { services: supervisor.list(), settings: supervisor.settings() });
      const sm = url.pathname.match(/^\/api\/services\/(serve|watch)\/(start|stop|restart|settings|logs)$/);
      if (sm) {
        const kind = sm[1] as ManagedKind;
        try {
          if (sm[2] === 'logs') {
            if (q('format') === 'json') return json(res, 200, supervisor.logs(kind));
            sse(res);
            for (const line of supervisor.logs(kind)) res.write(`data: ${JSON.stringify(line)}\n\n`);
            res.write(`data: ${JSON.stringify({ synced: true })}\n\n`);
            const off = supervisor.onLog(kind, (line) => res.write(`data: ${JSON.stringify(line)}\n\n`));
            req.on('close', off);
            return;
          }
          if (req.method !== 'POST' && req.method !== 'PUT') return json(res, 405, { error: 'POST to start, stop or restart; PUT settings' });
          const b = await body(req);
          if (sm[2] === 'settings') { supervisor.saveSettings(kind, b as never); return json(res, 200, { services: supervisor.list(), settings: supervisor.settings() }); }
          if (sm[2] === 'start') { if (Object.keys(b).length) supervisor.saveSettings(kind, b as never); supervisor.start(kind); }
          if (sm[2] === 'stop') await supervisor.stop(kind, typeof b.pid === 'number' ? b.pid : undefined);
          if (sm[2] === 'restart') await supervisor.restart(kind);
          return json(res, 200, { services: supervisor.list(), settings: supervisor.settings() });
        } catch (err) {
          return json(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
      }
      if (url.pathname === '/api/events') { sse(res); globalSubs.add(res); req.on('close', () => globalSubs.delete(res)); return; }

      if (url.pathname === '/api/runs' && req.method === 'GET') {
        return json(res, 200, await listRuns(q('file'), q('name')));
      }
      if (url.pathname === '/api/runs' && req.method === 'POST') {
        const b = await body(req);
        const target = inProject(String(b.file));
        if (!target) return json(res, 400, { error: 'file is outside the project' });
        const mocks = mocksFrom(b);
        // Stamped with the commit the file stood at, and whether it had
        // uncommitted changes, so a run can later be compared with the file.
        const source = await gitStamp(target).catch(() => undefined);
        if (b.debug === true) {
          const bps = Array.isArray(b.breakpoints) ? (b.breakpoints as string[]).filter((x) => typeof x === 'string') : [];
          return json(res, 200, startDebug(target, String(b.name), (b.params as Json) ?? {}, bps, mocks, b.runTo === 'breakpoint' ? 'breakpoint' : 'first', source));
        }
        return json(res, 200, await startRun(target, String(b.name), (b.params as Json) ?? {}, mocks, source, b.agents === 'manual' ? 'manual' : 'auto'));
      }
      const m = url.pathname.match(/^\/api\/runs\/([^/]+)(?:\/(events|resolve|cancel|debug|agent))?$/);
      if (m) {
        const id = m[1];
        const snap = await snapshot(id);
        if (!snap) return json(res, 404, { error: 'no such run' });
        // Forgetting a run: only one that is over, and only from the store --
        // what is in flight is stopped first, with cancel.
        if (!m[2] && req.method === 'DELETE') {
          if (live.has(id) || debug.get(id)) return json(res, 409, { error: 'the run is in flight. Cancel it first' });
          try { await coordinator.remove(id); } catch (err) { return json(res, 409, { error: err instanceof Error ? err.message : String(err) }); }
          listed = undefined;
          broadcast({ type: 'runs' });
          return json(res, 200, { removed: id });
        }
        if (m[2] === 'events') {
          sse(res);
          res.write(`data: ${JSON.stringify({ type: 'run', run: await fullSnapshot(id) })}\n\n`);
          // What the store kept from earlier segments, then the segment in
          // flight, with what the agent said where it happened in time.
          const lines: Array<{ t: number; line: string }> = [];
          for (const entry of [...(await coordinator.trace(id)), ...(live.get(id)?.events ?? []), ...(debugEvents.get(id) ?? [])]) lines.push({ t: entry.t, line: JSON.stringify({ type: 'event', ...entry }) });
          for (const entry of agentEvents.get(id) ?? []) lines.push({ t: entry.t, line: JSON.stringify({ ...(entry.e as AgentGateEvent), t: entry.t }) });
          lines.sort((a, b) => a.t - b.t);
          for (const l of lines) res.write(`data: ${l.line}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'synced' })}\n\n`);
          const set = subs.get(id) ?? subs.set(id, new Set()).get(id)!;
          set.add(res);
          req.on('close', () => { set.delete(res); if (!set.size) subs.delete(id); });
          return;
        }
        if (m[2] === 'resolve' && req.method === 'POST') {
          try { await resumeRun(id, (await body(req)) as { answer?: unknown; reject?: string }); return json(res, 200, await snapshot(id)); }
          catch (err) { return json(res, 400, { error: err instanceof Error ? err.message : String(err) }); }
        }
        // A person asking the profile to answer now: after it failed, or on a
        // run that was started with agents off.
        if (m[2] === 'agent' && req.method === 'POST') {
          const rec = await coordinator.record(id);
          if (!rec || rec.status !== 'waiting' || rec.gate?.kind !== 'agent') return json(res, 409, { error: 'the run is not waiting at an agent gate' });
          if (isAnswering(rec.agent, rec.gate.id)) return json(res, 409, { error: `${rec.agent!.profile} is already answering` });
          void afterSegment(id, true);
          return json(res, 200, await snapshot(id));
        }
        // What the agent said and did about the run's latest agent gate.
        if (m[2] === 'agent' && req.method === 'GET') {
          const rec = await coordinator.record(id);
          const gateId = q('gate') || rec?.agent?.gateId;
          const kept = gateId ? await coordinator.kept(id, transcriptName(gateId)) : undefined;
          if (!kept) return json(res, 404, { error: 'no agent has answered this run' });
          return json(res, 200, kept as Json);
        }
        if (m[2] === 'cancel' && req.method === 'POST') {
          await cancelRun(id);
          return json(res, 200, await snapshot(id));
        }
        // Driving a debug session. Moving it (step, continue, abort) is
        // answered at once and the pause arrives over the stream; a change
        // to its state (a value, a breakpoint) is applied before answering.
        if (m[2] === 'debug' && req.method === 'POST') {
          const d = debug.get(id);
          if (!d) return json(res, 404, { error: 'not a debug session' });
          const b = await body(req);
          const action = String(b.action);
          try {
            if (action === 'step' || action === 'continue' || action === 'toBreakpoint') {
              if (d.status !== 'paused') return json(res, 400, { error: `the session is ${d.status}, not paused` });
              const move = action === 'step' ? debug.step(id) : debug.continue(id, action === 'toBreakpoint');
              move.catch(() => undefined);
            } else if (action === 'abort') {
              debug.abort(id).catch(() => undefined);
            } else if (action === 'set') {
              debug.setVariable(id, String(b.node), String(b.port), b.value);
              // The spine reads values from the trace; tell it about this one.
              push(id, { type: 'event', t: Date.now(), e: { type: 'VARIABLE_SET', identifier: { id: String(b.node), portName: String(b.port) }, value: b.value } });
            } else if (action === 'breakpoint') {
              debug.breakpoint(id, b.op === 'remove' ? 'remove' : 'add', String(b.node));
            } else {
              return json(res, 400, { error: `unknown action ${action}` });
            }
            return json(res, 200, await snapshot(id));
          } catch (err) {
            return json(res, 400, { error: err instanceof Error ? err.message : String(err) });
          }
        }
        return json(res, 200, { ...(await fullSnapshot(id)), events: [...(await coordinator.trace(id)), ...(live.get(id)?.events ?? [])] });
      }
      json(res, 404, { error: 'not found' });
    } catch (err) {
      json(res, err instanceof BadRequest ? 400 : 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  actualPortRef.value = actualPort;

  // The services this project asked to have running with the console.
  for (const kind of ['serve', 'watch'] as const) {
    if (supervisor.settings()[kind].autoStart) { try { supervisor.start(kind); } catch { /* the card says why */ } }
  }

  return {
    url: `http://${host}:${actualPort}`,
    async close() {
      clearInterval(heartbeat);
      clearInterval(clock);
      // Services the console started stop with it: one rule, no orphans.
      await supervisor.close().catch(() => undefined);
      await watcher?.close();
      if (storePoll) clearInterval(storePoll);
      await storeWatcher?.close();
      for (const res of globalSubs) res.end();
      for (const set of subs.values()) for (const res of set) res.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
