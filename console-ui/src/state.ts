import { signal, computed, batch } from '@preact/signals';
import { get, post, put, del, stream, store, q } from './api';
import { applyEvent, emptyTrace, valueAt, type RunTrace, type Pass } from './run-events';
import { quoteArg } from './shell';

// ------------------------------------------------------------------ types
export interface FieldSchema { type: 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'object' | 'any'; optional?: boolean; values?: Array<string | number>; items?: FieldSchema; fields?: Record<string, FieldSchema>; text?: string; /** What the field is for, from the port's description. */ help?: string }
export interface Port { name: string; tsType: string; optional: boolean; description: string }
export type Deploy = Record<string, Record<string, unknown>>;
export interface Node { id: string; type: string; label: string; description: string; builtin: boolean; color: string | null; icon: string | null; pull: boolean; source: string; file: string; line: number | null; gate: 'approval' | 'input' | 'agent' | 'timer' | null; expression: boolean; durablePure: boolean; effect: boolean; async: boolean; inputs: Port[]; outputs: Port[]; outputSchema: Record<string, FieldSchema> | null; expr: Array<{ port: string; expr: string }>; pack: string | null; deploy: Deploy | null }
export interface Step { id: string; label: string; type: string; kind: 'step' | 'pause' | 'effect' | 'loop'; gate: string | null; scope: string | null; inScope: string | null; pure: boolean; expression: boolean; pull: boolean; stage: number; reads: Array<{ port: string; from: string; fromPort: string }>; exprs: Array<{ port: string; expr: string }>; produces: Array<{ port: string; to: string[] }>; children: Step[]; entered: Array<{ from: string; arm: 'ok' | 'fail' }>; successTo: string[]; failureTo: string[]; gateInputs: string[]; gateOutputs: string[]; description: string }
export interface PortEnd { node: string; port: string }
export interface Model { name: string; steps: Step[]; startTo: string[]; exitFrom: Array<{ from: string; arm: 'ok' | 'fail' }> }
export interface Issue { severity: 'error' | 'warning'; code: string; message: string; node: string | null; line: number | null; hint: string | null }
/**
 * A file that did not parse has none of the rest: no model, no ports, no
 * issues. The two shapes are a union rather than one type with optional
 * fields, so reading `issues` on an unparsed workflow is a type error
 * instead of a crash that leaves the previous workflow on screen.
 */
export type Workflow = ParsedWorkflow | UnparsedWorkflow;

export interface UnparsedWorkflow { file: string; rel: string; name: string; parseErrors: string[] }

/** One `@http` line: the route a workflow is served on. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface HttpRoute { method: HttpMethod; path: string; mode?: 'sync' | 'async'; auth?: 'bearer' | 'none'; callback?: boolean }

export interface ParsedWorkflow {
  file: string; rel: string; name: string; description: string; compiled: boolean;
  params: Port[]; paramsSchema: Record<string, FieldSchema> | null; returns: Port[];
  model: Model; nodes: Record<string, Node>; issues: Issue[]; source: string; sourceLine: number;
  /** Which input each parameter feeds, and which output becomes each return value. */
  wiring: { start: Record<string, PortEnd[]>; exit: Record<string, PortEnd> };
  /** What pack tags said at the workflow level, by namespace. */
  deploy: Deploy | null;
  /** The routes the workflow declares with `@http`. */
  http: HttpRoute[];
  /** The annotations as what they declare, for the Reference pane. */
  reference: {
    options: Record<string, unknown>;
    paths: Array<Array<{ node: string; route?: 'ok' | 'fail' }>>;
    connects: Array<{ from: PortEnd; to: PortEnd }>;
    exprs: Array<{ node: string; port: string; expr: string }>;
    importsFrom: Array<{ type: string; from: string }>;
  };
  parseErrors?: undefined;
}

export const isParsed = (w: Workflow | null): w is ParsedWorkflow => !!w && !w.parseErrors;
export interface WorkflowSummary { file: string; rel: string; name: string; steps: number; gates: number; errors: number; warnings: number; waiting: number; checked: boolean; codes: string[]; uses: string[] }
export interface Gate { id: string; kind: 'approval' | 'input' | 'agent' | 'timer'; node: string; inputs: Record<string, unknown>; absent: string[]; outputs: string[]; outputTypes: Record<string, string>; outputSchema: Record<string, FieldSchema> | null; hasSuccessPort: boolean; hasFailurePort: boolean; /** The gate function's description: what is being asked, in the author's words. */ description?: string; /** Each output's @output label, the words for the field that answers it. */ outputLabels?: Record<string, string>; inputLabels?: Record<string, string> }
/** When the clock moves a waiting run: a sleep wakes, or a gate with a timeout takes its failure path. */
export interface Due { at: number; action: 'wake' | 'timeout' }
export interface RunSnapshot {
  id: string; file: string; name: string; params: Record<string, unknown>;
  status: 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  startedAt: number; updatedAt: number; gate?: Gate; due?: Due; result?: any; error?: string;
  /** The step that threw, when the trace said which. */
  failedAt?: string;
  /** Who started the run: `console`, `http`, `mcp`. Absent on older records. */
  origin?: string;
  /** The mocks the run was started with, so it can be run again the same way. */
  mocks?: Record<string, unknown>;
  /** The commit the file stood at when the run started, and whether it had uncommitted changes. */
  source?: { commit?: string; dirty?: boolean };
  /** False for a run whose driver kept no step trace (`fw_run` over MCP). */
  traced?: boolean;
  /** Present on a step-through session; `status` is then `running` while it is paused too. */
  debug?: DebugInfo;
  /** What an agent profile is doing, or did, about the run's latest agent gate. */
  agent?: AgentNote;
  /** Whether agent gates are answered by a profile (`auto`) or wait for a person (`manual`). */
  agents?: 'auto' | 'manual';
}
export interface DebugInfo { status: 'running' | 'paused' | 'completed' | 'failed' | 'aborted' | 'yielded'; node?: string; phase?: 'before' | 'after'; position: number; order: string[]; breakpoints: string[] }
/** The record the coordinator keeps of an agent profile's work on a gate (`src/coordinator/run-store.ts`). */
export interface AgentNote { gateId: string; node: string; profile: string; provider: string; model?: string; status: 'answering' | 'answered' | 'rejected' | 'failed'; startedAt: string; endedAt?: string; usage?: { promptTokens: number; completionTokens: number; costUsd?: number }; toolCalls?: number; error?: string }
/** What the agent said and did, as it streams in over the run's events. */
export interface AgentLog {
  phase: 'idle' | 'answering' | 'done';
  profile?: string; provider?: string; model?: string;
  text: string;
  thinking: string;
  tools: Array<{ name: string; args?: unknown; result?: string; isError?: boolean; done: boolean }>;
  usage?: { promptTokens: number; completionTokens: number; costUsd?: number };
  outcome?: 'answer' | 'reject' | 'failed';
  error?: string;
  reason?: string;
  ms?: number;
}
export const emptyAgentLog = (): AgentLog => ({ phase: 'idle', text: '', thinking: '', tools: [] });
/** Fold one `agent` event from the run's stream into the log. */
export function applyAgentEvent(log: AgentLog, e: any): void {
  switch (e.phase) {
    case 'start': Object.assign(log, emptyAgentLog(), { phase: 'answering', profile: e.profile, provider: e.provider, model: e.model }); break;
    case 'text': log.text += e.text; break;
    case 'thinking': log.thinking += e.text; break;
    case 'tool':
      if (e.stage === 'start') log.tools.push({ name: e.name, args: e.args, done: false });
      else {
        const open = [...log.tools].reverse().find((t) => t.name === e.name && !t.done);
        if (open) Object.assign(open, { result: e.result, isError: e.isError, done: true });
        else log.tools.push({ name: e.name, args: e.args, result: e.result, isError: e.isError, done: true });
      }
      break;
    case 'usage': log.usage = { promptTokens: e.promptTokens, completionTokens: e.completionTokens, ...(e.costUsd ? { costUsd: e.costUsd } : {}) }; break;
    case 'done': Object.assign(log, { phase: 'done', outcome: e.outcome, error: e.error, reason: e.reason, ms: e.ms }); break;
  }
}
export type { Pass, StepSummary } from './run-events';
export interface RunState extends RunSnapshot, Omit<RunTrace, 'result'> { synced: boolean; agentLog: AgentLog }

// ---------------------------------------------------------------- signals
export const project = signal<{ dir: string; name: string; parent: string }>({ dir: '', name: '', parent: '' });
export const workflows = signal<WorkflowSummary[]>([]);
export const wf = signal<Workflow | null>(null);
export const runs = signal<RunSnapshot[]>([]);
export const run = signal<RunState | null>(null);
export const sel = signal<string | null>(null);
export const now = signal(Date.now());
export const toastMsg = signal('');
export type SidePane = 'run' | 'step' | 'issues' | 'reference' | 'changes' | 'export' | 'serve';

// --------------------------------------------------------------- changes
export type Change = 'added' | 'removed' | 'changed';
export interface Commit { sha: string; short: string; author: string; at: number; subject: string }
export interface FileHistory { repo: boolean; head?: string; dirty: boolean; commits: Commit[] }
/** Two versions of the open workflow as one marked picture, from `/api/diff`. */
export interface DiffView {
  from: string; to: string;
  identical: boolean; impact: 'CRITICAL' | 'BREAKING' | 'MINOR' | 'COSMETIC'; reasons: string[];
  steps: Array<{ id: string; label: string; change: Change; detail: string }>;
  wiring: Array<{ change: 'added' | 'removed'; from: string; to: string; fromPort: string; toPort: string; kind: 'ok' | 'fail' | 'data'; label: string }>;
  contract: Array<{ side: 'in' | 'out'; name: string; change: Change; detail: string }>;
  marks: { added: string[]; removed: string[]; changed: string[]; edgesAdded: Array<[string, string]>; edgesRemoved: Array<[string, string]> };
  model: Model | null;
  nodes: Record<string, Node>;
}
/** The diff the spine is showing, if the Changes pane has one, and how: marked, or one side only. */
export const diffView = signal<DiffView | null>(null);
export type DiffMode = 'diff' | 'before' | 'after';
export const diffMode = signal<DiffMode>('diff');
/** A comparison another pane asked for -- a run card, say -- that the Changes pane picks up when it opens. */
export const diffRequest = signal<{ from: string; to: string } | null>(null);
/** Open the Changes pane on a comparison. */
export function openChanges(from: string, to = 'worktree') { diffRequest.value = { from, to }; ui.side.value = 'changes'; }
export type DocSidePane = 'contents' | 'project';

// ------------------------------------------------------------------- docs
export interface GuideEntry { slug: string; name: string; description: string; related?: { codes?: boolean; uses?: string[] } }
export interface GuideGroup { title: string; topics: GuideEntry[] }
export interface Doc { slug: string; name: string; description: string; sections: Array<{ heading: string; level: number }>; markdown: string; compact: string }
/**
 * What the centre shows. A topic is not a mode the console switches into:
 * it is a thing opened in the same place a workflow is, and the workflow
 * stays loaded behind it, one click away.
 */
export type View = { kind: 'workflow' } | { kind: 'doc'; slug: string } | { kind: 'pack'; name: string } | { kind: 'market' } | { kind: 'author' } | { kind: 'project' } | { kind: 'agents' } | { kind: 'endpoints' };
/** The pages about the project as a whole, which share one header. */
export const isProjectView = (v: View): boolean => v.kind === 'project' || v.kind === 'agents' || v.kind === 'endpoints';
export const view = signal<View>({ kind: 'workflow' });
export const guide = signal<GuideGroup[]>([]);
export const doc = signal<Doc | null>(null);
export const docAnchor = signal<string>('');
/** The heading currently in view, for the contents pane. */
export const docHeading = signal('');

// ------------------------------------------------------------------ packs
export interface PackPort { name: string; type: string; optional: boolean; description: string }
export interface Pack {
  name: string; namespace: string; version: string; path: string; description: string;
  engineVersion: string | null; compatible: boolean | null;
  nodeTypes: Array<{ name: string; functionName: string; description: string; inputs: PackPort[]; outputs: PackPort[]; color: string | null; icon: string | null }>;
  workflows: Array<{ name: string; description: string; params: PackPort[]; returns: PackPort[]; nodes: number }>;
  exportTargets: Array<{ name: string; description: string }>;
  tagHandlers: Array<{ tags: string[]; namespace: string; scope: string }>;
  validationRuleSets: Array<{ name: string; namespace: string }>;
  docs: Array<{ slug: string; name: string; description: string }>;
  cliCommands: Array<{ name: string; description: string; usage: string }>;
  mcpTools: Array<{ name: string; description: string }>;
}
export const packs = signal<Pack[]>([]);

// ----------------------------------------------------------------- export
export interface Target { name: string; description: string; pack: string | null; deploySchema: Record<string, { type: string; description: string; default?: unknown }> | null }
export interface ExportOutcome { target: string; outputDir: string; written: boolean; files: Array<{ path: string; content: string }>; warnings: string[]; instructions: { title: string; steps: string[]; prerequisites: string[]; localTestSteps?: string[]; links?: Array<{ label: string; url: string }> } | null }
/** The export targets the project's packs provide. */
export const targets = signal<Target[]>([]);
/** Whether the open project is itself a pack. */
export const packProject = signal<{ isPack: boolean; name?: string; version?: string }>({ isPack: false });

// -------------------------------------------------------------------- cli
export interface CliCommand { name: string; words: string[]; group: string; description: string; usage: string; flags: Array<{ flag: string; description: string; default: string }>; examples: string[] }
export interface CliRun { id: string; args: string[]; out: string; err: string; code: number | null; error?: string; ms?: number; running: boolean; stop: () => void }
export const cliCommands = signal<CliCommand[]>([]);
export const cli = {
  line: signal(''),
  /** Set when a staged command wants the input's focus. */
  focus: signal(false),
  /** Whether the command builder is open. */
  build: signal(false),
  runs: signal<CliRun[]>([]),
  history: signal<string[]>(store.get<string[]>('cli-history', [])),
};

export const ui = {
  /** Which pane the inspector shows. Selecting a step switches to `step`. */
  side: signal<SidePane>('run'),
  /** A pass the timeline sent the Step card to, for a step that ran more than once. */
  pass: signal<{ id: string; index: number } | null>(null),
  /** Which pane the right column shows while a topic is open. */
  docSide: signal<DocSidePane>('contents'),
  railW: signal(store.get('railW', 284)),
  sideW: signal(store.get('sideW', 420)),
  railOpen: signal(false),
  /** Folder keys the user has collapsed. Everything else is open. */
  collapsed: signal<Set<string>>(new Set(store.get<string[]>('collapsed', []))),
  /** Which of the rail's lists is showing: the project, the guide, or the packs. */
  railTab: signal<'workflows' | 'guide' | 'packs'>(store.get<'workflows' | 'guide' | 'packs'>('railTab', 'workflows')),
  /** Which pane the right column shows while a pack is open. */
  packSide: signal<'project' | 'cli'>('project'),
  /** Guide groups the user has folded. The rest stay open, since the tab has the whole rail. */
  guideShut: signal<Set<string>>(new Set(store.get<string[]>('guideShut', []))),
  picker: signal(false),
  /** The search palette (⌘K). */
  search: signal(false),
  width: signal(window.innerWidth),
  /** The bottom drawer, when open: which stream it shows, and how tall it is. */
  drawer: signal<DrawerTab | null>(store.get<DrawerTab | null>('drawer', null)),
  drawerH: signal(store.get('drawerH', 240)),
};
export const iconsReady = signal(false);

/** Below this the rail becomes an overlay and needs a control to open it. */
export const NARROW = 620;
export const isNarrow = computed(() => ui.width.value < NARROW);

export const runActive = computed(() => !!run.value && (run.value.status === 'running' || run.value.status === 'waiting'));
export const errorCount = computed(() => (isParsed(wf.value) ? wf.value.issues.filter((i) => i.severity === 'error').length : 0));

setInterval(() => { if (runActive.value) now.value = Date.now(); }, 500);
window.addEventListener('resize', () => { ui.width.value = window.innerWidth; });
(document as any).fonts?.load('15px "Material Symbols Outlined"').then((f: any[]) => { iconsReady.value = f.length > 0; }).catch(() => {});

export function toast(t: string) { toastMsg.value = t; setTimeout(() => { if (toastMsg.value === t) toastMsg.value = ''; }, 1800); }

// ------------------------------------------------------------- run state
let closeRun: (() => void) | null = null;

export function openRun(id: string) {
  closeRun?.();
  let draft: RunState | null = null;
  closeRun = stream(`/api/runs/${id}/events`, (msg) => {
    if (msg.type === 'run') {
      // A new snapshot may drop `agent` (the run moved on); a stale note
      // must not survive the spread.
      const { agent: _a, agents: _b, ...rest } = draft ?? ({} as RunState);
      draft = draft ? { ...rest, ...msg.run } as RunState : { ...msg.run, ...emptyTrace(), synced: false, agentLog: emptyAgentLog() };
      if (['completed', 'failed', 'cancelled'].includes(msg.run.status)) refreshRuns();
    } else if (msg.type === 'event' && draft) {
      applyEvent(draft, msg.t, msg.e);
    } else if (msg.type === 'agent' && draft) {
      applyAgentEvent(draft.agentLog, msg);
    } else if (msg.type === 'synced' && draft) {
      draft.synced = true;
    }
    if (draft?.synced) run.value = { ...draft, states: { ...draft.states }, passes: { ...draft.passes }, values: { ...draft.values }, agentLog: { ...draft.agentLog, tools: [...draft.agentLog.tools] } };
  });
}

export function leaveRun() { closeRun?.(); closeRun = null; run.value = null; }

export function stepState(id: string): string {
  const r = run.value; if (!r) return '';
  if (r.status === 'waiting' && r.gate?.node === id) return 'WAITING';
  if (r.debug?.status === 'paused' && r.debug.node === id) return 'PAUSED';
  const st = r.states[id];
  // A step is only running while the run is. A RUNNING with no end seen is
  // a segment that went on without a trace -- resumed by `fw_resume` -- so
  // nothing is claimed about how it finished.
  if (st?.status === 'RUNNING' && r.status !== 'running') return '';
  // The engine marks the untaken branch's successors CANCELLED; to a person they were skipped.
  if (st?.status === 'CANCELLED' && r.status !== 'cancelled') return 'skipped';
  if (st?.status) return st.status;
  // "Skipped" is a claim about the whole run. A segment driven without a
  // trace -- resumed by `fw_resume` -- leaves steps that ran unrecorded,
  // and those must not be shown as skipped.
  return r.traced !== false && ['completed', 'failed', 'cancelled'].includes(r.status) ? 'skipped' : '';
}
/** How long a step took, every pass added up; null until a pass has ended. */
export function stepDuration(id: string): number | null { const st = run.value?.states[id]; return st && st.total > 0 ? st.total : st?.start != null && st?.end != null ? st.end - st.start : null; }
/** The passes of a step in the open run, in order; empty when it has not run. */
export function passesOf(id: string): Pass[] { return run.value?.passes[id] ?? []; }
/** How many times a step ran in the open run. */
export function passCount(id: string): number { return run.value?.states[id]?.count ?? 0; }
/** A value a step produced on one pass, or the latest when no pass is named or it had none. */
export function passValue(id: string, port: string, index?: number): unknown {
  const r = run.value;
  return r ? valueAt(r, id, port, index) : undefined;
}
export function runDuration(r: RunSnapshot): number { return (r.status === 'running' || r.status === 'waiting' ? now.value : r.updatedAt) - r.startedAt; }

// ------------------------------------------------------------------ data
/**
 * How long a loading state stays on screen once shown.
 *
 * A warm project lists in tens of milliseconds, and a spinner that appears
 * for one frame is a flicker rather than feedback -- worse than not showing
 * one. Once loading starts it is held for this long, whether the answer
 * arrives in 40ms or four seconds.
 */
const MIN_LOADING_MS = 900;

/** True while the project is being listed, or a verdict is still pending. */
export const loading = signal(false);
let loadingUntil = 0;

function startLoading(): void {
  loading.value = true;
  loadingUntil = Date.now() + MIN_LOADING_MS;
}

/** Drop the loading state, but never sooner than the minimum. */
function settleLoading(): void {
  const wait = Math.max(0, loadingUntil - Date.now());
  setTimeout(() => {
    // Anything still unchecked keeps the rail loading on its own.
    if (workflows.value.every((w) => w.checked)) loading.value = false;
  }, wait);
}

export async function loadWorkflows(): Promise<void> {
  startLoading();
  try {
    workflows.value = await get('/api/workflows');
  } finally {
    settleLoading();
  }
}
export async function refreshRuns() {
  const w = wf.value; if (!w) return;
  runs.value = await get(`/api/runs?${q({ file: w.file, name: w.name })}`);
}
/**
 * Which workflow is being opened, or null.
 *
 * Parsing and validating one takes long enough to notice, and the spine
 * goes blank while it happens. The rail marks the entry that was clicked,
 * held for the same minimum as any other loading state so a fast answer
 * does not flicker.
 */
export const opening = signal<string | null>(null);

export async function selectWorkflow(file: string, name: string, keepRun = false) {
  // A person opening a workflow wants to see it; a file saved while a topic
  // or a pack is open only refreshes what is behind it.
  if (!keepRun) { leaveRun(); sel.value = null; ui.railTab.value = 'workflows'; view.value = { kind: 'workflow' }; }
  const key = `${file}|${name}`;
  opening.value = key;
  const shown = Date.now() + MIN_LOADING_MS;
  try {
    const [w, rs] = await Promise.all([
      get<Workflow>(`/api/workflow?${q({ file, name })}`),
      get<RunSnapshot[]>(`/api/runs?${q({ file, name })}`),
    ]);
    batch(() => { wf.value = w; runs.value = rs; ui.railOpen.value = false; breakpoints.value = new Set(store.get<string[]>(bpKey(w), [])); });
    if (view.value.kind === 'workflow') location.hash = workflowHash(w.rel || file, name);
  } finally {
    setTimeout(() => { if (opening.value === key) opening.value = null; }, Math.max(0, shown - Date.now()));
  }
}
export interface StartOptions {
  debug?: boolean;
  /** Step-through: pause before the first step, or run on to the first breakpoint. */
  runTo?: 'first' | 'breakpoint';
  /** Answers for gates and calls, so the run goes through them unattended. */
  mocks?: Record<string, unknown>;
  /** Whether agent gates are answered by a profile, or wait for a person. */
  agents?: 'auto' | 'manual';
}
export async function startRun(params: Record<string, unknown>, options: StartOptions = {}) {
  const w = wf.value!;
  store.set(`params:${w.file}:${w.name}`, params);
  const body: Record<string, unknown> = { file: w.file, name: w.name, params };
  if (options.mocks && Object.keys(options.mocks).length) body.mocks = options.mocks;
  if (options.agents) body.agents = options.agents;
  if (options.debug) { body.debug = true; body.breakpoints = [...breakpoints.value]; body.runTo = options.runTo ?? 'first'; }
  const r = await post<RunSnapshot>('/api/runs', body);
  sel.value = null;
  openRun(r.id);
  refreshRuns();
}
/** Forget a finished run. The server refuses one in flight or waiting. */
export async function deleteRun(id: string) {
  await del(`/api/runs/${id}`);
  if (run.value?.id === id) leaveRun();
  await refreshRuns();
}
/** Every step, bodies included, in process order. */
export const flatSteps = (list: Step[]): Step[] => list.flatMap((s) => [s, ...flatSteps(s.children)]);

// ------------------------------------------------------------- debugging
/** Breakpoints of the open workflow, kept per workflow across sessions. */
export const breakpoints = signal<Set<string>>(new Set());
const bpKey = (w: { file: string; name: string }) => `bp:${w.file}:${w.name}`;

/** A step-through session is paused and can be moved. */
export const debugPaused = computed(() => run.value?.debug?.status === 'paused');

export async function debugAction(action: 'step' | 'continue' | 'toBreakpoint' | 'abort' | 'set' | 'breakpoint', extra: Record<string, unknown> = {}) {
  const r = run.value; if (!r?.debug) return;
  await post(`/api/runs/${r.id}/debug`, { action, ...extra });
}

/** Toggle a breakpoint on a step; a live session is told at once. */
export function toggleBreakpoint(id: string): void {
  const w = wf.value; if (!w) return;
  const next = new Set(breakpoints.value);
  const on = !next.has(id);
  if (on) next.add(id); else next.delete(id);
  breakpoints.value = next;
  store.set(bpKey(w), [...next]);
  const r = run.value;
  if (r?.debug && (r.debug.status === 'paused' || r.debug.status === 'running')) void debugAction('breakpoint', { op: on ? 'add' : 'remove', node: id });
}
export async function resolveGate(payload: { answer: unknown } | { reject: string }) {
  await post(`/api/runs/${run.value!.id}/resolve`, payload);
}
export async function cancelRun() { await post(`/api/runs/${run.value!.id}/cancel`); }

// ------------------------------------------------------------ live wiring
let reloadTimer: any;
stream('/api/events', (msg) => {
  if (msg.type === 'changed') {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      await loadWorkflows();
      const w = wf.value;
      if (w && msg.file === w.file) { await selectWorkflow(w.file, w.name, true); toast('file changed, reloaded'); }
    }, 250);
  }
  if (msg.type === 'runs') { refreshRuns(); loadWorkflows(); }
  if (msg.type === 'checked') {
    const w = msg.workflow as WorkflowSummary;
    workflows.value = workflows.value.map((x) => (x.file === w.file && x.name === w.name ? w : x));
    if (workflows.value.every((x) => x.checked)) settleLoading();
  }
  if (msg.type === 'project') { get('/api/project').then((p) => { project.value = p; }); loadWorkflows(); loadPacks().catch(() => undefined); }
  if (msg.type === 'client') location.reload();
  if (msg.type === 'services') {
    void loadServices().catch(() => undefined);
    void loadServe().catch(() => undefined);
    if (msg.kind === 'serve' && msg.state === 'running' && msg.url) toast(`server up at ${msg.url}`);
    if (msg.state === 'exited' && msg.error) toast(`${msg.kind === 'serve' ? 'server' : 'watch'} stopped: ${msg.error}`);
  }
});

export async function openProject(dir: string): Promise<void> {
  const p = await post('/api/project', { dir });
  leaveRun();
  batch(() => {
    project.value = p;
    wf.value = null;
    runs.value = [];
    sel.value = null;
    ui.picker.value = false;
  });
  await loadWorkflows();
  const first = workflows.value[0];
  if (first) await selectWorkflow(first.file, first.name);
  else location.hash = '';
}

const workflowHash = (rel: string, name: string) => `${encodeURIComponent(rel)}/${name}`;

// ------------------------------------------------------------- docs + cli
export async function loadGuide(): Promise<void> {
  guide.value = await get('/api/docs/guide');
}

/** Open a topic in the centre, at a heading when one is given. The workflow stays loaded. */
export async function openDoc(slug: string, anchor = ''): Promise<void> {
  ui.railOpen.value = false;
  ui.railTab.value = 'guide';
  if (doc.value?.slug !== slug) {
    view.value = { kind: 'doc', slug };
    docAnchor.value = anchor;
    doc.value = null;
    try { doc.value = await get<Doc>(`/api/docs/topic?slug=${encodeURIComponent(slug)}`); }
    catch (e) { toast((e as Error).message); view.value = { kind: 'workflow' }; return; }
  } else {
    batch(() => { view.value = { kind: 'doc', slug }; docAnchor.value = anchor; });
  }
  if (ui.docSide.value === 'project' && !guide.value.flatMap((g) => g.topics).find((t) => t.slug === slug)?.related) ui.docSide.value = 'contents';
  location.hash = `doc/${slug}${anchor ? `/${encodeURIComponent(anchor)}` : ''}`;
}

/** Back to the workflow that was open, if any -- from a topic or a pack. */
export function closeDoc(): void {
  view.value = { kind: 'workflow' };
  ui.railTab.value = 'workflows';
  const w = wf.value;
  location.hash = w ? workflowHash(w.rel, w.name) : '';
}

export async function loadPacks(): Promise<void> {
  packs.value = await get('/api/packs');
  targets.value = await get('/api/export/targets').catch(() => []);
  packProject.value = await get('/api/pack-project').catch(() => ({ isPack: false }));
}

/** The project's front door: its server, endpoints, agents, runs, editors and environment on one page. */
export function openOverview(): void {
  ui.railOpen.value = false;
  view.value = { kind: 'project' };
  location.hash = 'project';
  void loadServices().catch(() => undefined);
}

// -------------------------------------------------------------- services
export type ServiceKind = 'serve' | 'watch';
export interface ServiceView {
  kind: ServiceKind;
  state: 'stopped' | 'starting' | 'running' | 'exited';
  /** Started by this console, so it can be restarted and its output read. */
  owned: boolean;
  pid?: number; url?: string; startedAt?: string;
  exitCode?: number | null; error?: string;
  lines: number;
  /** The token a server this console started expects. */
  token?: string;
  activity?: { count: number; last?: string; at: string; version: string; install: string };
  others: Array<{ pid: number; url?: string; startedAt: string; version: string; install: string }>;
}
export interface ServeSettings { port: number; host: string; auth: 'token' | 'open'; agents: boolean; trace: boolean; dev: boolean; swagger: boolean; autoStart: boolean }
export interface ServicesInfo { services: ServiceView[]; settings: { serve: ServeSettings; watch: { autoStart: boolean } } }
export const services = signal<ServicesInfo | null>(null);
export const serviceOf = (kind: ServiceKind): ServiceView | undefined => services.value?.services.find((s) => s.kind === kind);
export async function loadServices(): Promise<ServicesInfo> {
  const s = await get<ServicesInfo>('/api/services');
  services.value = s;
  return s;
}
export async function startService(kind: ServiceKind, settings?: Partial<ServeSettings>): Promise<void> { services.value = await post(`/api/services/${kind}/start`, settings ?? {}); void loadServe().catch(() => undefined); }
export async function stopService(kind: ServiceKind, pid?: number): Promise<void> { services.value = await post(`/api/services/${kind}/stop`, pid ? { pid } : {}); void loadServe().catch(() => undefined); }
export async function restartService(kind: ServiceKind): Promise<void> { services.value = await post(`/api/services/${kind}/restart`, {}); void loadServe().catch(() => undefined); }
export async function saveServiceSettings(kind: ServiceKind, patch: Partial<ServeSettings> | { autoStart: boolean }): Promise<void> { services.value = await put(`/api/services/${kind}/settings`, patch); }

// ---------------------------------------------------------------- drawer
/** The bottom drawer: a service's output, or the command line. */
export type DrawerTab = 'serve' | 'watch' | 'cli';
export function openDrawer(tab: DrawerTab): void { ui.drawer.value = tab; store.set('drawer', tab); }
export function closeDrawer(): void { ui.drawer.value = null; store.set('drawer', null); }

// ---------------------------------------------------------------- agents
/** One agent profile as `/api/agents` describes it: readiness by environment, never a key. */
export interface AgentProfileView { name: string; provider: 'anthropic' | 'openai' | 'claude-cli'; model: string | null; keyEnv: string | null; ready: boolean; reason: string | null; description: string | null; system: string | null; maxIterations: number | null; baseUrl: string | null; bin: string | null }
export interface AgentsInfo { file: string; exists: boolean; default: string | null; errors: string[]; gates: Record<string, string>; starter: string; agents: AgentProfileView[]; suggestedModels: Record<string, string[]> }
export const agents = signal<AgentsInfo | null>(null);
export async function loadAgents(): Promise<AgentsInfo> {
  const a = await get<AgentsInfo>('/api/agents');
  agents.value = a;
  return a;
}
/** What a profile form sends; the name is in the URL. */
export interface ProfileFields { provider: AgentProfileView['provider']; model?: string; apiKeyEnv?: string; baseUrl?: string; system?: string; maxIterations?: number; bin?: string; description?: string }
export async function saveProfile(name: string, fields: ProfileFields): Promise<void> { agents.value = await put(`/api/agents/profiles/${encodeURIComponent(name)}`, fields); }
export async function deleteProfile(name: string): Promise<void> { agents.value = await del(`/api/agents/profiles/${encodeURIComponent(name)}`); }
export async function setDefaultProfile(name: string | null): Promise<void> { agents.value = await put('/api/agents/default', { name }); }
/** Send a gate to a profile, or back to a person; `key` is an agentId or `workflow/node`. */
export async function setGateProfile(key: string, profile: string | null): Promise<void> { agents.value = await put('/api/agents/gates', { key, profile }); }
export interface TryOutcome { ok: boolean; ms: number; text?: string; usage?: { promptTokens: number; completionTokens: number; costUsd?: number }; error?: string }
export async function tryAgentProfile(name: string): Promise<TryOutcome> { return post(`/api/agents/try/${encodeURIComponent(name)}`); }
/** Whether an environment variable is set where the console runs; its value is never sent. */
export async function envIsSet(name: string): Promise<boolean> { return (await get<{ set: boolean }>(`/api/agents/env?name=${encodeURIComponent(name)}`)).set; }
/** The profile that would answer a step of the open workflow, from the static mapping; the gate's agentId may still pick another at run time. */
export function profileForStep(workflowName: string, node: string): { name: string; via: 'step' | 'default' } | null {
  const a = agents.value;
  if (!a) return null;
  const byStep = a.gates[`${workflowName}/${node}`];
  if (byStep) return { name: byStep, via: 'step' };
  if (a.default) return { name: a.default, via: 'default' };
  return null;
}
/** The agent profiles page. */
export function openAgents(): void {
  ui.railOpen.value = false;
  view.value = { kind: 'agents' };
  location.hash = 'agents';
  void loadAgents();
}
/** Ask the profile to answer the open run's gate now -- after it failed, or on a run started manual. */
export async function askAgent(): Promise<void> {
  await post(`/api/runs/${run.value!.id}/agent`, {});
}
/** Whether `fw serve` is running for this project, and how to reach it. */
export interface ServeInfo { running: { url: string | null; pid: number; startedAt: string; version: string; install: string; owned: boolean; token: string | null } | null; state: 'stopped' | 'starting' | 'running' | 'exited'; command: string }
export const serveInfo = signal<ServeInfo | null>(null);
export async function loadServe(): Promise<ServeInfo> {
  const s = await get<ServeInfo>('/api/serve');
  serveInfo.value = s;
  return s;
}

/** A workflow with its declared routes, as the Endpoints page lists them. */
export interface EndpointWorkflow { file: string; rel: string; name: string; description: string; routes: Array<HttpRoute & { mounted: boolean }>; gates: number; params: Port[]; returns: Port[]; parses: boolean }
export interface EndpointsInfo { workflows: EndpointWorkflow[]; candidates: Array<Omit<EndpointWorkflow, 'routes'>>; problems: string[]; serve: ServeInfo }
export const endpoints = signal<EndpointsInfo | null>(null);
export async function loadEndpoints(): Promise<EndpointsInfo> {
  const e = await get<EndpointsInfo>('/api/endpoints');
  endpoints.value = e;
  serveInfo.value = e.serve;
  return e;
}
/** The project's endpoints page. */
export function openEndpoints(): void {
  ui.railOpen.value = false;
  view.value = { kind: 'endpoints' };
  location.hash = 'endpoints';
  void loadEndpoints();
}
/** Rewrite a workflow's `@http` lines. The open workflow is refreshed when it is the one. */
export async function setHttpRoutes(file: string, name: string, routes: HttpRoute[]): Promise<void> {
  const w = await put<ParsedWorkflow>('/api/workflow/http', { file, name, routes });
  if (wf.value && wf.value.file === file && wf.value.name === name) wf.value = w;
  if (endpoints.value) void loadEndpoints().catch(() => undefined);
}
/** Open a workflow on its Serve pane, where its routes are edited. */
export function openServe(file: string, name: string): void {
  void selectWorkflow(file, name);
  ui.side.value = 'serve';
}

/** The open project as a pack: its manifest as it would be written, and the rules over it. */
export function openAuthor(): void {
  ui.railOpen.value = false;
  ui.railTab.value = 'packs';
  view.value = { kind: 'author' };
  location.hash = 'author';
}

export async function exportRun(req: { target: string; outputDir?: string; preview: boolean }): Promise<ExportOutcome> {
  const w = wf.value!;
  return post<ExportOutcome>('/api/export', { file: w.file, name: w.name, ...req });
}

/** The marketplace: where a pack that is not installed yet is found. */
export function openMarket(): void {
  ui.railOpen.value = false;
  ui.railTab.value = 'packs';
  view.value = { kind: 'market' };
  location.hash = 'market';
}

/** Open an installed pack in the centre. */
export async function openPack(name: string): Promise<void> {
  ui.railOpen.value = false;
  ui.railTab.value = 'packs';
  view.value = { kind: 'pack', name };
  location.hash = `pack/${encodeURIComponent(name)}`;
  if (!packs.value.some((p) => p.name === name)) await loadPacks();
}

export async function loadCliCommands(): Promise<void> {
  if (!cliCommands.value.length) cliCommands.value = await get('/api/cli/commands');
}

/**
 * Put a command from the guide on the command line, with the open
 * workflow's file in place of the input placeholder, and bring the CLI
 * pane forward. It is not run: the person presses Run.
 */
export function stageCli(line: string): void {
  const w = wf.value;
  let staged = line.replace(/^(fw|flow-weaver)\s+/, '').replace(/\s*\[options\]/g, '');
  if (w) staged = staged.replace(/<(input|file|workflow-file|path|workflow\.ts)>/g, quoteArg(w.rel));
  cli.line.value = staged;
  cli.build.value = false;
  cli.focus.value = true;
  openDrawer('cli');
}

export function runCli(argv: string[]): void {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const args = argv[0] === 'fw' || argv[0] === 'flow-weaver' ? argv.slice(1) : argv;
  const controller = new AbortController();
  const entry: CliRun = { id, args, out: '', err: '', code: null, running: true, stop: () => controller.abort() };
  cli.runs.value = [entry, ...cli.runs.value].slice(0, 20);
  const update = (patch: Partial<CliRun>) => { cli.runs.value = cli.runs.value.map((r) => (r.id === id ? { ...r, ...patch } : r)); };
  fetch('/api/cli/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ argv: args }), signal: controller.signal })
    .then(async (res) => {
      if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); update({ running: false, error: j.error || res.statusText }); return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let cut;
        while ((cut = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, cut); buf = buf.slice(cut + 2);
          const data = frame.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
          if (!data) continue;
          const msg = JSON.parse(data);
          const cur = cli.runs.value.find((r) => r.id === id)!;
          if (msg.type === 'out') update({ out: cur.out + msg.text });
          else if (msg.type === 'err') update({ err: cur.err + msg.text });
          else if (msg.type === 'exit') update({ running: false, code: msg.code, ms: msg.ms, error: msg.error });
        }
      }
      update({ running: false });
    })
    .catch((e: Error) => update({ running: false, error: e.name === 'AbortError' ? 'stopped' : e.message }));
}

export function stopCli(id: string): void { cli.runs.value.find((r) => r.id === id)?.stop(); }
cli.history.subscribe((h) => store.set('cli-history', h));
// The server's state shows on the rail from the first paint.
void loadServices().catch(() => undefined);
ui.railTab.subscribe((t) => store.set('railTab', t));

/**
 * The URL hash is the route: `#<rel>/<name>` for a workflow, `#doc/<slug>`
 * or `#doc/<slug>/<anchor>` for a topic. Followed on load and on every
 * change, so the back button and a pasted link both land where they say.
 */
async function applyHash(initial = false): Promise<void> {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h === 'market') { if (view.value.kind !== 'market') openMarket(); return; }
  if (h === 'author') { if (view.value.kind !== 'author') openAuthor(); return; }
  if (h === 'project' || h === 'status') { if (view.value.kind !== 'project') openOverview(); return; }
  if (h === 'agents') { if (view.value.kind !== 'agents') openAgents(); return; }
  if (h === 'endpoints') { if (view.value.kind !== 'endpoints') openEndpoints(); return; }
  const asPack = h.match(/^pack\/(.+)$/);
  if (asPack) {
    const name = decodeURIComponent(asPack[1]);
    if (view.value.kind !== 'pack' || view.value.name !== name) await openPack(name);
    return;
  }
  const asDoc = h.match(/^doc\/([^/]+)(?:\/(.*))?$/);
  if (asDoc) {
    const anchor = asDoc[2] ? decodeURIComponent(asDoc[2]) : '';
    if (view.value.kind !== 'doc' || view.value.slug !== asDoc[1] || docAnchor.value !== anchor) await openDoc(asDoc[1], anchor);
    return;
  }
  // Nowhere in particular: the project's front door. A remembered place --
  // the hash of the last visit -- still lands where it says.
  if (!h && initial) { openOverview(); return; }
  const cut = h.lastIndexOf('/');
  const [rel, name] = cut > 0 ? [h.slice(0, cut), h.slice(cut + 1)] : ['', ''];
  const named = workflows.value.find((w) => w.rel === rel && w.name === name);
  const pick = named ?? (initial ? workflows.value.find((w) => /figma/.test(w.rel)) ?? workflows.value[0] : undefined);
  if (view.value.kind !== 'workflow') view.value = { kind: 'workflow' };
  if (pick && !(wf.value && wf.value.file === pick.file && wf.value.name === pick.name)) await selectWorkflow(pick.file, pick.name);
}

export async function boot() {
  const [p] = await Promise.all([get('/api/project'), loadWorkflows(), loadGuide().catch(() => undefined), loadPacks().catch(() => undefined)]);
  project.value = p;
  await applyHash(true);
  window.addEventListener('hashchange', () => { void applyHash(); });
}
