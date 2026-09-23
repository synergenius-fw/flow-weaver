/**
 * `@path` resolves Exit data ports by name.
 *
 * Before this rule, the same-name walk that wires every other step's inputs
 * stopped at Exit, so every `@returns` port needed an explicit `@connect`.
 * These tests pin the rule, its one exception (a Start param never passes
 * straight through to Exit), the precedence of an explicit `@connect`, the
 * stability of connection order, and the round trip through the annotation
 * generator and the sugar optimizer.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AnnotationParser } from '../../src/parser/annotation-parser';
import { parseWorkflow, validateWorkflow } from '../../src/api/index';
import { generateInPlace } from '../../src/api/generate-in-place';
import { detectSugarPatterns, filterStaleMacros, validatePathMacro } from '../../src/generator/sugar-optimizer';
import {
  impliedPathDataEdges,
  isPathImpliedDataEdge,
  pathDataEdgesSatisfied,
} from '../../src/parser/path-data-resolution';
import { executeWorkflow } from '../../src/mcp/workflow-executor';

const NODES = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input value - Number in
 * @output doubled - Twice the value
 * @output label - A label
 */
function double(value: number): { doubled: number; label: string } {
  return { doubled: value * 2, label: 'x2' };
}

/**
 * @flowWeaver nodeType
 * @expression
 * @input doubled - Number in
 * @output result - Plus one
 * @output label - Overrides the earlier label
 */
function addOne(doubled: number): { result: number; label: string } {
  return { result: doubled + 1, label: '+1' };
}
`;

// The stub's return type declares Exit ports too, so each test states exactly
// the ports its @returns lines declare.
function source(workflowBlock: string, returns = 'result: number; label: string'): string {
  return `${NODES}
/**
 * @flowWeaver workflow
${workflowBlock}
 */
export function flow(execute: boolean, params: { value: number }): { onSuccess: boolean; onFailure: boolean; ${returns} } {
  throw new Error('stub');
}
`;
}

const parser = new AnnotationParser();

function exitEdges(connections: Array<{ from: { node: string; port: string }; to: { node: string; port: string } }>) {
  return connections
    .filter((c) => c.to.node === 'Exit' && c.to.port !== 'onSuccess' && c.to.port !== 'onFailure')
    .map((c) => `${c.from.node}.${c.from.port}->Exit.${c.to.port}`)
    .sort();
}

describe('@path resolves Exit ports by name', () => {
  it('wires each @returns port to the nearest ancestor with a same-name output', () => {
    const result = parser.parseFromString(source(` * @param value - Number in
 * @returns result - Final number
 * @returns label - Label of the last step
 * @node d double
 * @node a addOne
 * @path Start -> d -> a -> Exit`));
    expect(result.errors).toEqual([]);
    const wf = result.workflows[0];
    // label exists on both d and a; the nearest ancestor (a) wins
    expect(exitEdges(wf.connections)).toEqual(['a.label->Exit.label', 'a.result->Exit.result']);
    expect(validateWorkflow(wf).errors).toEqual([]);
    expect(validateWorkflow(wf).warnings.map((w) => w.code)).not.toContain('UNREACHABLE_EXIT_PORT');
  });

  it('never passes a Start param straight through to Exit', () => {
    const result = parser.parseFromString(source(` * @param value - Number in
 * @returns value - Same name as the param, but no node produces it
 * @returns result - Final number
 * @node d double
 * @node a addOne
 * @path Start -> d -> a -> Exit`, 'result: number; value: number'));
    expect(result.errors).toEqual([]);
    const wf = result.workflows[0];
    expect(exitEdges(wf.connections)).toEqual(['a.result->Exit.result']);
    // The port is left for the author to wire; the existing warning still says so
    expect(validateWorkflow(wf).warnings.map((w) => w.code)).toContain('UNREACHABLE_EXIT_PORT');
  });

  it('leaves an Exit port alone when an explicit @connect already targets it', () => {
    const result = parser.parseFromString(source(` * @param value - Number in
 * @returns result - Final number
 * @returns label - Label, explicitly taken from the first step
 * @node d double
 * @node a addOne
 * @path Start -> d -> a -> Exit
 * @connect d.label -> Exit.label`));
    expect(result.errors).toEqual([]);
    const wf = result.workflows[0];
    expect(exitEdges(wf.connections)).toEqual(['a.result->Exit.result', 'd.label->Exit.label']);
    expect(validateWorkflow(wf).warnings.map((w) => w.code)).not.toContain('MULTIPLE_EXIT_CONNECTIONS');
  });

  it('keeps control-flow ports out of the rule', () => {
    expect(isPathImpliedDataEdge('a', 'onSuccess', 'Exit', 'onSuccess')).toBe(false);
    expect(isPathImpliedDataEdge('a', 'result', 'Exit', 'result')).toBe(true);
    expect(isPathImpliedDataEdge('Start', 'value', 'Exit', 'value')).toBe(false);
    expect(isPathImpliedDataEdge('a', 'result', 'Exit', 'other')).toBe(false);
  });

  it('keeps the connection order of an unchanged file identical', () => {
    // A file whose Exit ports were already wired by @connect must parse to the
    // same connection list, in the same order, as before the rule existed:
    // connection order feeds the graph fingerprint that guards resumption.
    const withConnects = parser.parseFromString(source(` * @param value - Number in
 * @returns result - Final number
 * @node d double
 * @node a addOne
 * @path Start -> d -> a -> Exit
 * @connect a.result -> Exit.result`, 'result: number')).workflows[0];
    const keys = withConnects.connections.map((c) => `${c.from.node}.${c.from.port}->${c.to.node}.${c.to.port}`);
    // Explicit @connect lines first, then the @path expansion step by step,
    // each step's control edge followed by its data edges: the pre-existing order.
    expect(keys).toEqual([
      'a.result->Exit.result',
      'Start.execute->d.execute',
      'Start.value->d.value',
      'd.onSuccess->a.execute',
      'd.doubled->a.doubled',
      'a.onSuccess->Exit.onSuccess',
    ]);
  });
});

describe('the rule as one helper', () => {
  const steps = [{ node: 'Start' }, { node: 'd' }, { node: 'a' }, { node: 'Exit' }];
  const ports = {
    inputs: (id: string) =>
      ({ d: { value: 1 }, a: { doubled: 1 }, Exit: { result: 1, label: 1, value: 1 } })[id] ?? {},
    outputs: (id: string) =>
      ({ Start: { value: 1 }, d: { doubled: 1, label: 1 }, a: { result: 1, label: 1 } })[id] ?? {},
  };

  it('lists the implied edges in path order, Exit included, Start pass-through excluded', () => {
    const edges = impliedPathDataEdges(steps, ports).map((e) => `${e.from.node}.${e.from.port}->${e.to.node}.${e.to.port}`);
    expect(edges).toEqual(['Start.value->d.value', 'd.doubled->a.doubled', 'a.result->Exit.result', 'a.label->Exit.label']);
  });

  it('treats an explicitly overridden target port as satisfied', () => {
    const conns = [
      { from: { node: 'Start', port: 'value' }, to: { node: 'd', port: 'value' } },
      { from: { node: 'd', port: 'doubled' }, to: { node: 'a', port: 'doubled' } },
      { from: { node: 'a', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      { from: { node: 'd', port: 'label' }, to: { node: 'Exit', port: 'label' } }, // override
    ];
    expect(pathDataEdgesSatisfied(steps, ports, conns)).toBe(true);
    expect(pathDataEdgesSatisfied(steps, ports, conns.slice(0, 3))).toBe(false);
  });
});

describe('round trip', () => {
  const block = ` * @param value - Number in
 * @returns result - Final number
 * @returns label - Label of the last step
 * @node d double
 * @node a addOne
 * @path Start -> d -> a -> Exit`;

  it('does not emit @connect lines for Exit ports the @path already covers', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-path-exit-'));
    try {
      const file = path.join(dir, 'flow.ts');
      fs.writeFileSync(file, source(block));
      const parsed = await parseWorkflow(file);
      expect(parsed.errors).toEqual([]);
      const regenerated = generateInPlace(fs.readFileSync(file, 'utf8'), parsed.ast, { annotationsOnly: true });
      expect(regenerated.code).toContain('@path Start -> d -> a -> Exit');
      expect(regenerated.code).not.toMatch(/@connect a\.result -> Exit\.result/);
      expect(regenerated.code).not.toMatch(/@connect a\.label -> Exit\.label/);
      // and the regenerated file parses to the same edges
      fs.writeFileSync(file, regenerated.code);
      const again = await parseWorkflow(file);
      expect(exitEdges(again.ast.connections)).toEqual(['a.label->Exit.label', 'a.result->Exit.result']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('marks the @path stale when an implied Exit edge is removed', () => {
    const wf = parser.parseFromString(source(block)).workflows[0];
    const pathMacro = (wf.macros ?? []).find((m) => m.type === 'path');
    expect(pathMacro).toBeDefined();
    const intact = validatePathMacro(pathMacro!, wf.connections, wf.instances, wf.nodeTypes, wf.startPorts, wf.exitPorts);
    expect(intact).toBe(true);
    const withoutExitEdge = wf.connections.filter((c) => !(c.to.node === 'Exit' && c.to.port === 'result'));
    const stale = validatePathMacro(pathMacro!, withoutExitEdge, wf.instances, wf.nodeTypes, wf.startPorts, wf.exitPorts);
    expect(stale).toBe(false);
    expect(filterStaleMacros(wf.macros ?? [], withoutExitEdge, wf.instances, wf.nodeTypes, wf.startPorts, wf.exitPorts)).toEqual([]);
  });

  it('detects the @path from a connection set that includes the Exit edges', () => {
    const wf = parser.parseFromString(source(block)).workflows[0];
    const detected = detectSugarPatterns(wf.connections, wf.instances, [], wf.nodeTypes, wf.startPorts, wf.exitPorts);
    expect(detected.paths.map((p) => p.steps.map((s) => s.node).join('->'))).toContain('Start->d->a->Exit');
  });
});

describe('end to end', () => {
  it('runs and returns the Exit values wired by @path', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-path-exit-run-'));
    try {
      const file = path.join(dir, 'flow.ts');
      fs.writeFileSync(
        file,
        source(` * @param value - Number in
 * @returns result - Final number
 * @returns label - Label of the last step
 * @node d double
 * @node a addOne
 * @path Start -> d -> a -> Exit`),
      );
      const outcome = await executeWorkflow({
        runId: 'path-exit-resolution-run',
        bundleDigest: `sha256:${'c'.repeat(64)}`,
        filePath: file,
        workflowName: 'flow',
        params: { value: 20 },
        production: false,
      });
      expect(outcome.kind).toBe('completed');
      if (outcome.kind !== 'completed') return;
      expect(outcome.result).toMatchObject({ onSuccess: true, result: 41, label: '+1' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
