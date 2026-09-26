/**
 * Two versions of a workflow as one picture with the changes marked on it.
 *
 * The semantic differ says what changed. This turns that into what the
 * console draws. The two versions are merged into a union -- every step
 * and control edge from either -- and laid out once, so a removed step
 * keeps the place it had and an added one sits where it now runs. Rows and
 * edges are then marked added, removed or changed, and the same facts are
 * listed for the Changes pane: steps, wiring, contract, and the differ's
 * verdict in words.
 */
import type { TWorkflowAST, TNodeInstanceAST, TNodeTypeAST, TConnectionAST } from '../ast/types.js';
import { WorkflowDiffer } from '../diff/WorkflowDiffer.js';
import { getImpactReasons } from '../diff/impact.js';
import type { TImpactLevel, TInstanceDiff, TNodeTypeDiff } from '../diff/types.js';
import { buildProcessModel, type ProcessModel } from '../diagram/process-view.js';
import { stepLabel } from '../diagram/labels.js';

export type Change = 'added' | 'removed' | 'changed';
export interface DiffStep { id: string; label: string; change: Change; detail: string }
export interface DiffWire { change: 'added' | 'removed'; from: string; to: string; fromPort: string; toPort: string; kind: 'ok' | 'fail' | 'data'; label: string }
export interface DiffPort { side: 'in' | 'out'; name: string; change: Change; detail: string }
export interface DiffMarks { added: string[]; removed: string[]; changed: string[]; edgesAdded: Array<[string, string]>; edgesRemoved: Array<[string, string]> }
/** What a row and its tile need to draw a step that no longer exists in the file. */
export interface DiffNode {
  id: string; type: string; label: string; description: string; builtin: boolean; color: string | null; icon: string | null;
  pull: boolean; gate: 'approval' | 'input' | 'agent' | 'timer' | null; expression: boolean; durablePure: boolean; effect: boolean; async: boolean;
  inputs: Array<{ name: string; tsType: string; optional: boolean; description: string }>; outputs: Array<{ name: string; tsType: string; optional: boolean; description: string }>;
  source: string; file: string; line: number | null; outputSchema: null; expr: Array<{ port: string; expr: string }>; pack: null; deploy: null;
}
export interface DiffView {
  identical: boolean;
  impact: TImpactLevel;
  reasons: string[];
  steps: DiffStep[];
  wiring: DiffWire[];
  contract: DiffPort[];
  marks: DiffMarks;
  /** The union of both versions as a process, or null when the two cannot be laid out together. */
  model: ProcessModel | null;
  /** Steps that exist only in the older version, so their rows can still be drawn. */
  nodes: Record<string, DiffNode>;
}

const CONTROL = new Set(['execute', 'onSuccess', 'onFailure']);
const isControl = (c: { from: { port: string }; to: { port: string } }) => CONTROL.has(c.from.port) || c.to.port === 'execute';

function typeOf(ast: TWorkflowAST, inst: TNodeInstanceAST): TNodeTypeAST | undefined {
  return ast.nodeTypes.find((n) => n.name === inst.nodeType) ?? ast.nodeTypes.find((n) => n.functionName === inst.nodeType);
}

const portList = (map: TNodeTypeAST['inputs'] | undefined) => Object.entries(map ?? {})
  .filter(([k, p]) => !CONTROL.has(k) && !p.isControlFlow)
  .map(([k, p]) => ({ name: k, tsType: p.tsType ?? String(p.dataType).toLowerCase(), optional: !!p.optional, description: p.description ?? '' }));

function nodeOf(ast: TWorkflowAST, inst: TNodeInstanceAST): DiffNode {
  const nt = typeOf(ast, inst);
  return {
    id: inst.id, type: inst.nodeType, label: stepLabel(inst, nt), description: nt?.description ?? '', builtin: !nt?.functionText,
    color: inst.config?.color ?? nt?.visuals?.color ?? null, icon: inst.config?.icon ?? nt?.visuals?.icon ?? null,
    pull: inst.config?.pullExecution !== undefined, gate: nt?.durableGate ?? null,
    expression: !!nt?.expression, durablePure: !!nt?.durablePure, effect: !!nt?.durableEffect, async: !!nt?.isAsync,
    inputs: portList(nt?.inputs), outputs: portList(nt?.outputs),
    source: nt?.functionText ?? '', file: nt?.sourceLocation?.file ?? ast.sourceFile, line: nt?.sourceLocation?.line ?? null,
    outputSchema: null, expr: (inst.config?.portConfigs ?? []).filter((c) => c.expression).map((c) => ({ port: c.portName, expr: String(c.expression) })), pack: null, deploy: null,
  };
}

/** What changed on a step, in a few words. */
function instanceDetail(d: TInstanceDiff, typeChanged: TNodeTypeDiff | undefined): string {
  const bits: string[] = [];
  if (d.changes.nodeType) bits.push(`now ${d.changes.nodeType.after}, was ${d.changes.nodeType.before}`);
  if (d.changes.config?.portConfigs) bits.push('expressions changed');
  if (d.changes.config?.pullExecution) bits.push(d.changes.config.pullExecution.after ? 'now pulled on demand' : 'no longer pulled');
  if (d.changes.parent) {
    const a = d.changes.parent.after, b = d.changes.parent.before;
    bits.push(a ? `moved into ${a.id} (${a.scope})` : b ? `moved out of ${b.id} (${b.scope})` : 'scope changed');
  }
  if (typeChanged) bits.push(typeDetail(typeChanged));
  return bits.join(', ');
}

function typeDetail(d: TNodeTypeDiff): string {
  const bits: string[] = [];
  const io = (list: TNodeTypeDiff['changes']['inputs'], word: string) => {
    for (const p of list ?? []) bits.push(`${p.type === 'ADDED' ? '+' : p.type === 'REMOVED' ? '−' : '~'}${word} ${p.portName}`);
  };
  io(d.changes.inputs, 'in'); io(d.changes.outputs, 'out');
  if (d.changes.executeWhen) bits.push('execute-when changed');
  if (d.changes.isAsync) bits.push(d.changes.isAsync.after ? 'now async' : 'no longer async');
  if (d.changes.scope) bits.push('scope changed');
  if (d.changes.functionName) bits.push(`function ${d.changes.functionName.after}`);
  return bits.join(', ');
}

export function buildDiffView(before: TWorkflowAST, after: TWorkflowAST): DiffView {
  const diff = WorkflowDiffer.compare(before, after);
  const reasons = diff.identical ? [] : getImpactReasons(diff);
  const beforeInst = new Map(before.instances.map((i) => [i.id, i]));
  const afterInst = new Map(after.instances.map((i) => [i.id, i]));
  const label = (id: string) => {
    if (id === 'Start' || id === 'Exit') return id;
    const inst = afterInst.get(id) ?? beforeInst.get(id);
    return inst ? stepLabel(inst, typeOf(afterInst.has(id) ? after : before, inst)) : id;
  };

  // Steps: added, removed, changed -- a step also counts as changed when its node type changed underneath it.
  const typeDiffs = new Map(diff.nodeTypes.filter((n) => n.changeType === 'MODIFIED').map((n) => [n.name, n]));
  const steps: DiffStep[] = [];
  for (const d of diff.instances) {
    const inst = afterInst.get(d.id) ?? beforeInst.get(d.id);
    if (!inst) continue;
    if (d.changeType === 'ADDED') steps.push({ id: d.id, label: label(d.id), change: 'added', detail: `${inst.nodeType}` });
    else if (d.changeType === 'REMOVED') steps.push({ id: d.id, label: label(d.id), change: 'removed', detail: `${inst.nodeType}` });
    else {
      const t = typeDiffs.get(inst.nodeType) ?? [...typeDiffs.values()].find((x) => typeOf(after, inst)?.functionName === x.name);
      const detail = instanceDetail(d, t);
      if (detail) steps.push({ id: d.id, label: label(d.id), change: 'changed', detail });
    }
  }
  const touched = new Set(steps.map((s) => s.id));
  for (const inst of after.instances) {
    if (touched.has(inst.id)) continue;
    const nt = typeOf(after, inst);
    const t = typeDiffs.get(inst.nodeType) ?? (nt ? typeDiffs.get(nt.name) : undefined);
    if (t) { steps.push({ id: inst.id, label: label(inst.id), change: 'changed', detail: typeDetail(t) }); touched.add(inst.id); }
  }

  // Wiring: every connection that came or went; control edges also mark the picture.
  const wiring: DiffWire[] = [];
  const edgesAdded = new Map<string, [string, string]>();
  const edgesRemoved = new Map<string, [string, string]>();
  for (const c of diff.connections) {
    const change = c.changeType === 'ADDED' ? 'added' : 'removed';
    const kind: DiffWire['kind'] = isControl(c) ? (c.from.port === 'onFailure' ? 'fail' : 'ok') : 'data';
    const text = kind === 'data'
      ? `${label(c.from.node)}.${c.from.port} → ${label(c.to.node)}.${c.to.port}`
      : `${label(c.from.node)}${kind === 'fail' ? ' on failure' : ''} → ${label(c.to.node)}`;
    wiring.push({ change, from: c.from.node, to: c.to.node, fromPort: c.from.port, toPort: c.to.port, kind, label: text });
    if (kind !== 'data') (change === 'added' ? edgesAdded : edgesRemoved).set(`${c.from.node}>${c.to.node}`, [c.from.node, c.to.node]);
  }

  // Contract: what goes in and comes out.
  const contract: DiffPort[] = [];
  const ports = (side: 'in' | 'out', p: typeof diff.startPorts) => {
    for (const x of p.added) contract.push({ side, name: x.name, change: 'added', detail: x.definition.tsType ?? String(x.definition.dataType ?? '') });
    for (const x of p.removed) contract.push({ side, name: x.name, change: 'removed', detail: x.definition.tsType ?? String(x.definition.dataType ?? '') });
    for (const x of p.modified) contract.push({ side, name: x.name, change: 'changed', detail: `${x.before.tsType ?? x.before.dataType} → ${x.after.tsType ?? x.after.dataType}` });
  };
  ports('in', diff.startPorts); ports('out', diff.exitPorts);

  // The union: the newer version plus whatever the older one had that it no longer has.
  const removedInstances = before.instances.filter((i) => !afterInst.has(i.id));
  const afterTypes = new Set(after.nodeTypes.map((n) => n.name));
  const unionTypes = [...after.nodeTypes, ...before.nodeTypes.filter((n) => !afterTypes.has(n.name))];
  const unionIds = new Set([...after.instances, ...removedInstances].map((i) => i.id));
  const afterConn = new Set(after.connections.map(connKey));
  const removedConnections = before.connections.filter((c) => !afterConn.has(connKey(c)) && (c.from.node === 'Start' || unionIds.has(c.from.node)) && (c.to.node === 'Exit' || unionIds.has(c.to.node)));
  const union: TWorkflowAST = { ...after, nodeTypes: unionTypes, instances: [...after.instances, ...removedInstances], connections: [...after.connections, ...removedConnections] };
  let model: ProcessModel | null;
  try { model = buildProcessModel(union); } catch { model = null; }
  // As the workflow endpoint does: the label rule and pull execution live on
  // the instance, not in the process model, so the rows read the same here.
  if (model) {
    const unionInst = new Map(union.instances.map((i) => [i.id, i]));
    type Stamped = { id: string; label: string; pull?: boolean; children: Stamped[] };
    const stampAll = (steps: Stamped[]) => steps.forEach((s) => {
      const inst = unionInst.get(s.id);
      if (inst) { s.label = label(s.id); s.pull = inst.config?.pullExecution !== undefined; }
      stampAll(s.children);
    });
    stampAll(model.steps);
  }

  const nodes: Record<string, DiffNode> = {};
  for (const inst of removedInstances) nodes[inst.id] = nodeOf(before, inst);

  return {
    identical: diff.identical, impact: diff.impact, reasons, steps, wiring, contract,
    marks: {
      added: steps.filter((s) => s.change === 'added').map((s) => s.id),
      removed: steps.filter((s) => s.change === 'removed').map((s) => s.id),
      changed: steps.filter((s) => s.change === 'changed').map((s) => s.id),
      edgesAdded: [...edgesAdded.values()], edgesRemoved: [...edgesRemoved.values()],
    },
    model, nodes,
  };
}

const connKey = (c: TConnectionAST) => `${c.from.node}.${c.from.port}${c.from.scope ? ':' + c.from.scope : ''}>${c.to.node}.${c.to.port}${c.to.scope ? ':' + c.to.scope : ''}`;
