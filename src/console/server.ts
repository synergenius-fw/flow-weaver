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
import { buildGateResolution, computeBundleDigest, createLocalCoordinator, defaultRunsDir, type RunRecord, type TraceEntry } from '../coordinator/index.js';
import { ERROR_HINTS } from '../mcp/response-utils.js';
import { searchDocs, readTopic, readTopicStructured, listTopics, getPackDocTopics } from '../docs/index.js';
import { loadPackDocTopics } from '../docs/pack-topics.js';
import { guideOutline } from '../docs/guide.js';
import { cliCatalog } from './cli-catalog.js';
import { planFwCommand, spawnFw } from './cli-run.js';
import { DebugSessions, type DebugView } from './debug.js';
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
import { workflowParamsSchema, nodeOutputSchema, nodeInputSchema, type FieldSchema } from './schema.js';
import { scanWorkflowNames, checkWorkflows, invalidateListing, toPosix } from './scan.js';
import { workflowSource } from './source.js';
import { terminalWiring } from './terminals.js';
import { isConnectionCoveredByMacroStatic } from '../annotation-generator.js';

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
    // in; shown to a person, it reads better as `string`.
    .map(([k, p]) => ({ name: k, tsType: p.tsType ?? String(p.dataType).toLowerCase(), optional: !!p.optional, description: p.description ?? '' }));
}

async function parseOne(file: string, name: string): Promise<{ ast?: TWorkflowAST; errors: string[] }> {
  const p = await parseWorkflow(file, { workflowName: name, projectDir: path.dirname(file) });
  return { ast: p.errors.length ? undefined : p.ast, errors: p.errors };
}

/**
 * The shape of each data output of a gate node.
 *
 * An authored gate declares it in its own return type. A built-in gate
 * (`waitForEvent`, `waitForAgent`) has no source, so the schema is taken
 * from the parameter that consumes the output downstream; without that, the
 * client falls back to a JSON field.
 */
function gateOutputSchemas(ast: TWorkflowAST, gateId: string, nt: TNodeTypeAST | undefined, fallbackFile: string): Record<string, FieldSchema> | null {
  const nodeFile = nt?.sourceLocation?.file ?? fallbackFile;
  if (nt?.functionText) {
    const own = nodeOutputSchema(nodeFile, nt.functionName);
    if (own && Object.keys(own).length) return own;
  }
  const out: Record<string, FieldSchema> = {};
  for (const conn of ast.connections) {
    // `onSuccess`/`onFailure` are filled in by `buildGateResolution`; a
    // control port wired onward must never become an answer field.
    if (conn.from.node !== gateId || CONTROL.has(conn.from.port)) continue;
    const target = ast.instances.find((i) => i.id === conn.to.node);
    const targetType = target ? nodeTypeOf(ast, target) : undefined;
    if (!targetType?.functionText) continue;
    const schema = nodeInputSchema(targetType.sourceLocation?.file ?? fallbackFile, targetType.functionName, conn.to.port);
    if (schema) out[conn.from.port] = schema;
  }
  return Object.keys(out).length ? out : null;
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
 * resolve, parsed, and removed; the scanner and the watcher both skip it.
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
      outputSchema: nt?.durableGate !== undefined ? gateOutputSchemas(ast, inst.id, nt, file) : null,
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
    reference: referenceOf(ast),
  };
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
  const subs = new Map<string, Set<http.ServerResponse>>();
  const globalSubs = new Set<http.ServerResponse>();
  const runsDir = defaultRunsDir();
  const coordinator = createLocalCoordinator({ rootDir: runsDir });

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
  let listed: { at: number; rows: ReturnType<typeof coordinator.list> } | undefined;
  const storeList = () => {
    if (!listed || Date.now() - listed.at > 500) listed = { at: Date.now(), rows: coordinator.list() };
    return listed.rows;
  };
  const waitingCounts = () => {
    const counts = new Map<string, number>();
    for (const s of storeList()) if (s.status === 'waiting') counts.set(`${s.filePath}|${s.workflowName}`, (counts.get(`${s.filePath}|${s.workflowName}`) ?? 0) + 1);
    return counts;
  };
  const withWaiting = (w: { file: string; name: string }, counts = waitingCounts()) => ({
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
      outputSchema: ast ? gateOutputSchemas(ast, g.node, nt, rec.filePath) : null,
    };
  }

  /** A run as the client sees it: the live segment if there is one, else the record. */
  function snapshot(id: string): Json | undefined {
    const d = debug.get(id);
    if (d) return debugSnapshot(d, debugSource.get(id));
    const l = live.get(id);
    if (l) return { id, file: l.file, name: l.name, params: l.params, mocks: l.mocks, source: l.source, status: l.status, startedAt: l.startedAt, updatedAt: Date.now(), error: l.error, traced: true };
    const rec = coordinator.record(id);
    if (!rec) return undefined;
    return {
      id, file: rec.filePath, name: rec.workflowName, params: rec.params, mocks: rec.mocks, source: rec.source, status: rec.status,
      startedAt: at(rec.createdAt), updatedAt: at(rec.updatedAt),
      gate: rec.gate ? { node: rec.gate.node, kind: rec.gate.kind } : undefined,
      result: rec.result, error: rec.error, failedAt: rec.failedNode, traced: !!rec.traced,
    };
  }
  /** The same, with the gate fully labelled -- what an open run shows. */
  async function fullSnapshot(id: string): Promise<Json | undefined> {
    const snap = snapshot(id);
    const rec = live.has(id) ? undefined : coordinator.record(id);
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
      if (coordinator.record(l.id)) live.delete(l.id);
      else { l.status = 'failed'; l.error = err instanceof Error ? err.message : String(err); }
    }
    listed = undefined;
    await pushRun(l.id);
    broadcast({ type: 'runs' });
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
    return snapshot(id)!;
  }

  async function startRun(file: string, name: string, params: Json, mocks?: FwMockConfig, source?: { commit?: string; dirty?: boolean }): Promise<Json> {
    // Refuse a broken file now, with the parser's message, rather than as a
    // failed run a moment later.
    const ast = await astFor(file, name);
    if (!ast) throw new Error((await parseOne(file, name)).errors.join('\n'));
    const id = randomUUID();
    const l: Live = { id, file, name, params, mocks, source, startedAt: Date.now(), status: 'running', events: [], abort: new AbortController() };
    void drive(l, (onEvent) =>
      coordinator.start({ filePath: file, workflowName: name, params, runId: id, mocks, source }, { onEvent, abortSignal: l.abort.signal }));
    return snapshot(id)!;
  }

  async function resumeRun(id: string, input: { answer?: unknown; reject?: string }): Promise<void> {
    const rec = coordinator.record(id);
    if (!rec || rec.status !== 'waiting' || !rec.gate) throw new Error('run is not waiting');
    if (live.has(id)) throw new Error('run is already resuming');
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
    if (coordinator.record(id)?.status === 'waiting') {
      coordinator.cancel(id);
      listed = undefined;
      await pushRun(id);
      broadcast({ type: 'runs' });
    }
  }

  /** Runs of one workflow, or all: what is in flight here, then the store, newest first. */
  function listRuns(file: string, name: string): Json[] {
    const inFlight = [
      ...debug.list().filter((d) => (!file || d.file === file) && (!name || d.name === name)).map((d) => debugSnapshot(d, debugSource.get(d.id))),
      ...[...live.values()].filter((l) => (!file || l.file === file) && (!name || l.name === name)).map((l) => snapshot(l.id)!),
    ];
    const stored = (file ? coordinator.list({ filePath: file }) : storeList())
      .filter((s) => (!name || s.workflowName === name) && !live.has(s.runId))
      .map((s) => ({
        id: s.runId, file: s.filePath, name: s.workflowName, status: s.status, params: s.params, mocks: s.mocks, source: s.source,
        startedAt: at(s.createdAt), updatedAt: at(s.updatedAt), gate: s.gate, failedAt: s.failedNode,
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
  if (watching) {
    fs.mkdirSync(runsDir, { recursive: true });
    const chokidar = await import('chokidar');
    storeWatcher = chokidar.watch(runsDir, { ignoreInitial: true, depth: 1 });
    storeWatcher.on('all', (_event, file) => {
      if (typeof file !== 'string' || path.basename(file) !== 'run.json') return;
      listed = undefined;
      broadcast({ type: 'runs' });
      void pushRun(path.basename(path.dirname(file)));
    });
  }

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
  const body = async (req: http.IncomingMessage): Promise<Json> => {
    let s = '';
    for await (const c of req) s += c;
    return s ? (JSON.parse(s) as Json) : {};
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
        const counts = waitingCounts();
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
          name: `${p.namespace} ${c.name}`, words: [p.namespace, c.name], group: `Pack · ${p.namespace}`,
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
      // the environment, registries and the platform. Probes are brief.
      if (url.pathname === '/api/status') {
        return json(res, 200, await describeStatus(projectDir, { url: `http://${host}:${actualPortRef.value}`, watching, runsDir }));
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
      if (url.pathname === '/api/events') { sse(res); globalSubs.add(res); req.on('close', () => globalSubs.delete(res)); return; }

      if (url.pathname === '/api/runs' && req.method === 'GET') {
        return json(res, 200, listRuns(q('file'), q('name')));
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
        return json(res, 200, await startRun(target, String(b.name), (b.params as Json) ?? {}, mocks, source));
      }
      const m = url.pathname.match(/^\/api\/runs\/([^/]+)(?:\/(events|resolve|cancel|debug))?$/);
      if (m) {
        const id = m[1];
        const snap = snapshot(id);
        if (!snap) return json(res, 404, { error: 'no such run' });
        // Forgetting a run: only one that is over, and only from the store --
        // what is in flight is stopped first, with cancel.
        if (!m[2] && req.method === 'DELETE') {
          if (live.has(id) || debug.get(id)) return json(res, 409, { error: 'the run is in flight; cancel it first' });
          try { coordinator.remove(id); } catch (err) { return json(res, 409, { error: err instanceof Error ? err.message : String(err) }); }
          listed = undefined;
          broadcast({ type: 'runs' });
          return json(res, 200, { removed: id });
        }
        if (m[2] === 'events') {
          sse(res);
          res.write(`data: ${JSON.stringify({ type: 'run', run: await fullSnapshot(id) })}\n\n`);
          // What the store kept from earlier segments, then the segment in flight.
          for (const entry of [...coordinator.trace(id), ...(live.get(id)?.events ?? []), ...(debugEvents.get(id) ?? [])]) {
            res.write(`data: ${JSON.stringify({ type: 'event', ...entry })}\n\n`);
          }
          res.write(`data: ${JSON.stringify({ type: 'synced' })}\n\n`);
          const set = subs.get(id) ?? subs.set(id, new Set()).get(id)!;
          set.add(res);
          req.on('close', () => { set.delete(res); if (!set.size) subs.delete(id); });
          return;
        }
        if (m[2] === 'resolve' && req.method === 'POST') {
          try { await resumeRun(id, (await body(req)) as { answer?: unknown; reject?: string }); return json(res, 200, snapshot(id)); }
          catch (err) { return json(res, 400, { error: err instanceof Error ? err.message : String(err) }); }
        }
        if (m[2] === 'cancel' && req.method === 'POST') {
          await cancelRun(id);
          return json(res, 200, snapshot(id));
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
            return json(res, 200, snapshot(id));
          } catch (err) {
            return json(res, 400, { error: err instanceof Error ? err.message : String(err) });
          }
        }
        return json(res, 200, { ...(await fullSnapshot(id)), events: [...coordinator.trace(id), ...(live.get(id)?.events ?? [])] });
      }
      json(res, 404, { error: 'not found' });
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  actualPortRef.value = actualPort;

  return {
    url: `http://${host}:${actualPort}`,
    async close() {
      clearInterval(heartbeat);
      await watcher?.close();
      await storeWatcher?.close();
      for (const res of globalSubs) res.end();
      for (const set of subs.values()) for (const res of set) res.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
