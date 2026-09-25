/**
 * A workflow as the console shows it: parsed, validated and described for
 * the client, compared across git refs, and its `@http` lines rewritten.
 * Pure of the server: every function takes the file it works on.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseWorkflow } from '../api/parse.js';
import { validateWorkflow } from '../api/validate.js';
import { hasInPlaceMarkers } from '../api/generate-in-place.js';
import { buildProcessModel } from '../diagram/index.js';
import { stepLabel } from '../diagram/labels.js';
import { ERROR_HINTS } from '../mcp/response-utils.js';
import { readTopicStructured } from '../docs/index.js';
import { isConnectionCoveredByMacroStatic, httpRouteText } from '../generator/annotation-generator.js';
import { RESERVED_PATHS } from '../server/api.js';
import type { TWorkflowAST, TNodeTypeAST, TNodeInstanceAST, TPortDefinition, TValidationError, THttpRoute } from '../ast/types.js';
import { fileAt } from './git.js';
import { installedRefs, packForFile, packForSpecifier } from './packs.js';
import { gateOutputSchemas, workflowParamsSchema } from './schema.js';
import { toPosix } from './scan.js';
import { workflowSource } from './source.js';
import { terminalWiring } from './terminals.js';
import type { Json } from './respond.js';

const CONTROL = new Set(['execute', 'onSuccess', 'onFailure']);

// -------------------------------------------------------------- describing

export function nodeTypeOf(ast: TWorkflowAST, inst: TNodeInstanceAST): TNodeTypeAST | undefined {
  return ast.nodeTypes.find((n) => n.name === inst.nodeType) ?? ast.nodeTypes.find((n) => n.functionName === inst.nodeType);
}


export function ports(map: Record<string, TPortDefinition> | undefined) {
  return Object.entries(map ?? {})
    .filter(([k, p]) => !CONTROL.has(k) && !p.isControlFlow)
    // Without a TypeScript type the engine's own `STRING`/`OBJECT` stands
    // in. Shown to a person, it reads better as `string`.
    .map(([k, p]) => ({ name: k, tsType: p.tsType ?? String(p.dataType).toLowerCase(), optional: !!p.optional, description: p.description ?? '' }));
}

export async function parseOne(file: string, name: string): Promise<{ ast?: TWorkflowAST; errors: string[] }> {
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
export async function astAt(file: string, name: string, ref: string): Promise<{ ast?: TWorkflowAST; error?: string }> {
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

export async function describeWorkflow(projectDir: string, file: string, name: string) {
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
export function routeFrom(raw: unknown): THttpRoute | string {
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
export async function setHttpRoutes(file: string, name: string, routes: THttpRoute[]): Promise<{ ok: true } | { ok: false; error: string }> {
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
export function crumbsFor(at: string): Array<{ name: string; dir: string }> {
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

export function errorCodeSection(code: string) {
  const section = readTopicStructured('error-codes')?.sections.find((s) => s.heading.includes(code));
  return section ? { heading: section.heading, content: section.content, codeBlocks: section.codeBlocks } : null;
}
