/**
 * The process model: a workflow read as the process it runs, not the graph
 * it is drawn as.
 *
 * It answers the questions an author or a reviewer actually has: in what
 * order do the steps run, where does the process stop and wait for someone,
 * what happens when a step fails, and which steps run at the same time.
 * Everything is derived from the parsed AST with the same facts the engine
 * uses -- topological order, control edges, and the durable classification
 * -- so what is shown is what would run, never a hand-placed picture. The
 * console, the brief and the spine SVG all draw from this model.
 *
 * Vocabulary:
 *   stage   -- the longest control path from Start; steps sharing a stage
 *              have no control dependency between them
 *   pause   -- a durable gate; the process stops here and waits for a resolver
 *   segment -- the run between two pauses, i.e. what one continuation covers
 *   arm     -- a failure edge
 *   loop    -- a scope owner, with its children as an inner process
 */
import type { TWorkflowAST, TConnectionAST } from '../ast/types';
import { getTopologicalOrder } from '../api/query';
import { stepLabel } from './labels';

const STEP_PORTS = new Set(['onSuccess', 'onFailure', 'execute']);

export type ProcessKind = 'step' | 'pause' | 'effect' | 'loop';

export interface ProcessStep {
  id: string;
  label: string;
  type: string;
  kind: ProcessKind;
  gate: 'approval' | 'input' | 'agent' | 'timer' | null;
  scope: string | null;
  pure: boolean;
  expression: boolean;
  stage: number;
  segment: number;
  reads: Array<{ port: string; from: string; fromPort: string }>;
  exprs: Array<{ port: string; expr: string }>;
  produces: Array<{ port: string; to: string[] }>;
  children: ProcessStep[];
  entered: Array<{ from: string; arm: 'ok' | 'fail' }>;
  successTo: string[];
  failureTo: string[];
  gateInputs: string[];
  gateOutputs: string[];
  description: string;
}

export interface ProcessModel {
  name: string;
  description: string;
  params: string[];
  returns: string[];
  steps: ProcessStep[];
  startTo: string[];
  exitFrom: Array<{ from: string; arm: 'ok' | 'fail' }>;
  segments: number;
}

const firstParagraph = (text: string | undefined): string =>
  (text ?? '').split('\n\n')[0].replace(/\s+/g, ' ').trim();

/** Build the process model for one workflow. */
export function buildProcessModel(ast: TWorkflowAST): ProcessModel {
  const nodeTypes = new Map<string, TWorkflowAST['nodeTypes'][number]>();
  for (const nt of ast.nodeTypes) {
    nodeTypes.set(nt.name, nt);
    nodeTypes.set(nt.functionName, nt);
  }
  const byId = new Map(ast.instances.map((i) => [i.id, i]));
  const isControl = (c: TConnectionAST) => STEP_PORTS.has(c.from.port) || c.to.port === 'execute';
  const control = ast.connections.filter(isControl);
  const data = ast.connections.filter((c) => !isControl(c));

  // Stage: longest control path from Start. A step with no control edge in
  // (pull/lazy or data-only) sits after whatever it reads.
  const order = getTopologicalOrder(ast);
  const stage = new Map<string, number>();
  for (const id of order) {
    const ins = control.filter((c) => c.to.node === id);
    let s = 0;
    for (const c of ins) s = Math.max(s, c.from.node === 'Start' ? 1 : (stage.get(c.from.node) ?? 0) + 1);
    if (ins.length === 0) {
      const dataIns = data.filter((c) => c.to.node === id && c.from.node !== 'Start');
      s = Math.max(1, ...dataIns.map((c) => (stage.get(c.from.node) ?? 0) + 1));
    }
    stage.set(id, s);
  }

  // Segment: increments after every pause, in execution order.
  let segment = 0;
  const segmentOf = new Map<string, number>();
  for (const id of order) {
    segmentOf.set(id, segment);
    if (nodeTypes.get(byId.get(id)?.nodeType ?? '')?.durableGate) segment++;
  }

  const describe = (inst: TWorkflowAST['instances'][number]): ProcessStep => {
    const nt = nodeTypes.get(inst.nodeType);
    const outputs = Object.keys(nt?.outputs ?? {}).filter((p) => !STEP_PORTS.has(p));
    const kind: ProcessKind = nt?.durableGate
      ? 'pause'
      : nt?.durableEffect
        ? 'effect'
        : nt?.scope || (nt?.scopes?.length ?? 0) > 0
          ? 'loop'
          : 'step';
    return {
      id: inst.id,
      label: stepLabel(inst, nt),
      type: nt?.functionName ?? inst.nodeType,
      kind,
      gate: nt?.durableGate ?? null,
      scope: nt?.scope ?? nt?.scopes?.[0] ?? null,
      pure: Boolean(nt?.expression || nt?.durablePure),
      expression: Boolean(nt?.expression),
      stage: stage.get(inst.id) ?? 0,
      segment: segmentOf.get(inst.id) ?? 0,
      reads: data
        .filter((c) => c.to.node === inst.id)
        .map((c) => ({ port: c.to.port, from: c.from.node, fromPort: c.from.port })),
      exprs: (inst.config?.portConfigs ?? [])
        .filter((p) => p.expression)
        .map((p) => ({ port: p.portName, expr: String(p.expression) })),
      produces: outputs.map((port) => ({
        port,
        to: [...new Set(data.filter((c) => c.from.node === inst.id && c.from.port === port).map((c) => c.to.node))],
      })),
      children: ast.instances.filter((i) => i.parent?.id === inst.id).map(describe),
      entered: control
        .filter((c) => c.to.node === inst.id)
        .map((c) => ({ from: c.from.node, arm: c.from.port === 'onFailure' ? 'fail' : 'ok' })),
      successTo: control.filter((c) => c.from.node === inst.id && c.from.port === 'onSuccess').map((c) => c.to.node),
      failureTo: control.filter((c) => c.from.node === inst.id && c.from.port === 'onFailure').map((c) => c.to.node),
      gateInputs: Object.keys(nt?.inputs ?? {}).filter((p) => p !== 'execute'),
      gateOutputs: outputs,
      description: firstParagraph(nt?.description),
    };
  };

  const steps = order
    .map((id) => byId.get(id))
    .filter((inst): inst is TWorkflowAST['instances'][number] => Boolean(inst && !inst.parent))
    .map(describe);

  return {
    name: ast.functionName,
    description: firstParagraph(ast.description),
    params: Object.keys(ast.startPorts ?? {}).filter((p) => !STEP_PORTS.has(p)),
    returns: Object.keys(ast.exitPorts ?? {}).filter((p) => !STEP_PORTS.has(p)),
    steps,
    startTo: control.filter((c) => c.from.node === 'Start').map((c) => c.to.node),
    exitFrom: control
      .filter((c) => c.to.node === 'Exit')
      .map((c) => ({ from: c.from.node, arm: c.from.port === 'onFailure' ? 'fail' : 'ok' })),
    segments: segment + 1,
  };
}
