/**
 * Upstream references inside `[expr: port="..."]`.
 *
 * `Start.<param>` and `<node>.<port>` inside an expression are data
 * dependencies. The parser turns each into a connection flagged `derived`,
 * the generator fetches the values and substitutes them, and everything
 * that reads `workflow.connections` (ordering, cycles, queries, the
 * annotation generators) sees the edge. These tests pin the syntax that is
 * recognised, the syntax that is not, every error, the validation
 * exemptions, and the behaviour end to end.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AnnotationParser } from '../../src/parser/annotation-parser';
import { parseWorkflow, validateWorkflow } from '../../src/api/index';
import { generateInPlace } from '../../src/api/generate-in-place';
import { executeWorkflow } from '../../src/mcp/workflow-executor';
import { getDataDependencies, getTopologicalOrder } from '../../src/api/query';
import { removeConnection } from '../../src/api/manipulation/connections';
import { findExpressionReferences, rewriteExpressionReferences } from '../../src/parser/expression-references';

const NODES = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input value - Number in
 * @output doubled - Twice the value
 */
function double(value: number): { doubled: number } {
  return { doubled: value * 2 };
}

/**
 * @flowWeaver nodeType
 * @expression
 * @input id - Task id
 * @input context - Context object
 * @input prompt - Instructions
 * @output task - The task, serialised
 */
function describeTask(id: string, context: object, prompt: string): { task: string } {
  return { task: JSON.stringify({ id, context, prompt }) };
}
`;

function source(workflowBlock: string, returns = 'task: string', extra = ''): string {
  return `${NODES}
${extra}
/**
 * @flowWeaver workflow
${workflowBlock}
 */
export function flow(execute: boolean, params: { path: string; question: string }): { onSuccess: boolean; onFailure: boolean; ${returns} } {
  throw new Error('stub');
}
`;
}

const parser = new AnnotationParser();

function derivedEdges(connections: Array<{ from: { node: string; port: string }; to: { node: string; port: string }; derived?: unknown }>) {
  return connections
    .filter((c) => c.derived)
    .map((c) => `${c.from.node}.${c.from.port}->${c.to.node}.${c.to.port}`)
    .sort();
}

async function inTempFile<T>(code: string, fn: (file: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-expr-refs-'));
  const file = path.join(dir, 'flow.ts');
  fs.writeFileSync(file, code);
  try {
    return await fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const bundleDigest = `sha256:${'e'.repeat(64)}`;

// ---------------------------------------------------------------------------
// The reference finder on its own
// ---------------------------------------------------------------------------

describe('findExpressionReferences', () => {
  const candidates = new Set(['Start', 'd']);

  it('finds identifier.property accesses on candidates, once per access', () => {
    const refs = findExpressionReferences('{ a: Start.path, b: d.doubled + d.doubled }', candidates);
    expect(refs.map((r) => `${r.root}.${r.port}`)).toEqual(['Start.path', 'd.doubled', 'd.doubled']);
  });

  it('keeps nested access after the port in the expression', () => {
    const expr = 'Start.expense.id + 1';
    const refs = findExpressionReferences(expr, candidates);
    expect(refs).toHaveLength(1);
    expect(expr.slice(refs[0].start, refs[0].end)).toBe('Start.expense');
    expect(rewriteExpressionReferences(expr, refs, () => 'v')).toBe('v.id + 1');
  });

  it('recognises references inside template literal substitutions but not inside string text', () => {
    expect(findExpressionReferences('`Open ${Start.path} for Start.path`', candidates).map((r) => r.port)).toEqual(['path']);
    expect(findExpressionReferences("'Start.path'", candidates)).toEqual([]);
    expect(findExpressionReferences('"d.doubled"', candidates)).toEqual([]);
  });

  it('ignores identifiers that are not candidates, bracket access, and shadowed parameters', () => {
    expect(findExpressionReferences('other.path', candidates)).toEqual([]);
    expect(findExpressionReferences('Start["path"]', candidates)).toEqual([]);
    expect(findExpressionReferences('(Start) => Start.path', candidates)).toEqual([]);
    expect(findExpressionReferences('(ctx) => Start.path', candidates).map((r) => r.port)).toEqual(['path']);
  });

  it('rewrites several references without disturbing offsets', () => {
    const expr = '{ p: Start.path, q: Start.question, n: d.doubled }';
    const refs = findExpressionReferences(expr, candidates);
    expect(rewriteExpressionReferences(expr, refs, (r) => `$${r.root}_${r.port}`)).toBe(
      '{ p: $Start_path, q: $Start_question, n: $d_doubled }',
    );
  });
});

// ---------------------------------------------------------------------------
// Parsing into derived connections
// ---------------------------------------------------------------------------

describe('references become derived connections', () => {
  const block = ` * @param path - File
 * @param question - What to look for
 * @returns task - The task
 * @node d double [expr: value="Start.path.length"]
 * @node t describeTask [expr: id="'inspect'", context="{ path: Start.path, doubled: d.doubled }", prompt="'Open ' + Start.path + ' and answer ' + Start.question"]
 * @path Start -> d -> t -> Exit`;

  it('adds one derived connection per distinct upstream port and keeps the expression', () => {
    const result = parser.parseFromString(source(block));
    expect(result.errors).toEqual([]);
    const wf = result.workflows[0];
    expect(derivedEdges(wf.connections)).toEqual([
      'Start.path->d.value',
      'Start.path->t.context',
      'Start.path->t.prompt',
      'Start.question->t.prompt',
      'd.doubled->t.context',
    ]);
    const ctxEdge = wf.connections.find((c) => c.derived && c.to.port === 'context' && c.from.node === 'd');
    expect(ctxEdge?.derived).toEqual({ kind: 'expression', expression: '{ path: Start.path, doubled: d.doubled }' });
    // The expression on the instance is untouched
    const t = wf.instances.find((i) => i.id === 't')!;
    expect(t.config?.portConfigs?.find((pc) => pc.portName === 'context')?.expression).toBe('{ path: Start.path, doubled: d.doubled }');
  });

  it('is exempt from the one-source rule and from type checks, and satisfies the required-input rule', () => {
    const wf = parser.parseFromString(source(block)).workflows[0];
    const v = validateWorkflow(wf);
    expect(v.errors).toEqual([]);
    const codes = v.warnings.map((w) => w.code);
    expect(codes).not.toContain('MULTIPLE_CONNECTIONS_TO_INPUT');
    expect(codes).not.toContain('OBJECT_TYPE_MISMATCH');
    expect(codes).not.toContain('TYPE_MISMATCH');
    expect(codes).not.toContain('LOSSY_TYPE_COERCION');
    expect(codes).not.toContain('MISSING_REQUIRED_INPUT');
  });

  it('shows up in data-dependency queries and in the topological order', () => {
    const wf = parser.parseFromString(source(block)).workflows[0];
    expect(getDataDependencies(wf, 't')).toContain('d');
    const order = getTopologicalOrder(wf);
    expect(order.indexOf('d')).toBeLessThan(order.indexOf('t'));
  });

  it('leaves an expression without references exactly as before: no derived connections', () => {
    const wf = parser.parseFromString(
      source(` * @param path - File
 * @param question - Q
 * @returns task - The task
 * @node d double [expr: value="21"]
 * @node t describeTask [expr: id="'x'", context="{ literal: true }", prompt="'static'"]
 * @path Start -> d -> t -> Exit`),
    ).workflows[0];
    expect(derivedEdges(wf.connections)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

describe('reference errors are reported at parse time, naming the instance and port', () => {
  const base = ` * @param path - File
 * @param question - Q
 * @returns task - The task
 * @node d double [expr: value="Start.path.length"]`;

  function errorsFor(nodeLine: string, extra = ''): string[] {
    return parser.parseFromString(source(`${base}\n${nodeLine}\n * @path Start -> d -> t -> Exit`, 'task: string', extra)).errors;
  }

  it('unknown workflow param', () => {
    const errors = errorsFor(` * @node t describeTask [expr: id="'x'", context="Start.nope", prompt="'p'"]`);
    expect(errors).toEqual([
      '[expr] t.context: "Start.nope" is not a workflow param. Available: path, question.',
    ]);
  });

  it('unknown output port, listing the data outputs', () => {
    const errors = errorsFor(` * @node t describeTask [expr: id="'x'", context="d.nope", prompt="'p'"]`);
    expect(errors).toEqual(['[expr] t.context: "d.nope" is not an output of "d". Available: doubled.']);
  });

  it('control port', () => {
    const errors = errorsFor(` * @node t describeTask [expr: id="'x'", context="d.onSuccess", prompt="'p'"]`);
    expect(errors).toEqual(['[expr] t.context: "d.onSuccess" is a control port. Expressions can only reference data ports.']);
  });

  it('self reference', () => {
    const errors = errorsFor(` * @node t describeTask [expr: id="'x'", context="t.task", prompt="'p'"]`);
    expect(errors).toEqual(['[expr] t.context: an expression cannot reference its own node ("t.task").']);
  });

  it('ambiguous when the node id is also a top-level binding and the property is a port', () => {
    const errors = errorsFor(
      ` * @node t describeTask [expr: id="'x'", context="d.doubled", prompt="'p'"]`,
      `const d = { doubled: 99 };`,
    );
    expect(errors).toEqual([
      '[expr] t.context: "d.doubled" is ambiguous. "d" is both a node in this workflow and a top-level binding of this file. Rename one of them, or read the binding through a helper.',
    ]);
  });

  it('plain JavaScript when the node id is also a top-level binding but the property is not a port', () => {
    const result = parser.parseFromString(
      source(`${base}
 * @node t describeTask [expr: id="'x'", context="{ limit: d.limit }", prompt="'p'"]
 * @path Start -> d -> t -> Exit`, 'task: string', `const d = { limit: 3 };`),
    );
    expect(result.errors).toEqual([]);
    expect(derivedEdges(result.workflows[0].connections)).toEqual(['Start.path->d.value']);
  });

  it('a node id that matches its own node type function name is not a shadowing binding', () => {
    const result = parser.parseFromString(
      source(` * @param path - File
 * @param question - Q
 * @returns task - The task
 * @node double double [expr: value="Start.path.length"]
 * @node t describeTask [expr: id="'x'", context="{ n: double.doubled }", prompt="'p'"]
 * @path Start -> double -> t -> Exit`),
    );
    expect(result.errors).toEqual([]);
    expect(derivedEdges(result.workflows[0].connections)).toContain('double.doubled->t.context');
  });

  it('references across a scope boundary are refused', () => {
    const code = `
/**
 * @flowWeaver nodeType
 * @input items - Items
 * @output start scope:each - Triggers child
 * @output item scope:each - Current item
 * @input success scope:each - Child done
 * @input failure scope:each - Child failed
 * @input result scope:each - Child result
 * @output results - All results
 */
function each(execute: boolean, items: unknown[], each: (start: boolean, item: unknown) => { success: boolean; failure: boolean; result: unknown }) {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  return { onSuccess: true, onFailure: false, results: items.map((item) => each(true, item).result) };
}

/**
 * @flowWeaver nodeType
 * @expression
 * @input item - One item
 * @input tag - A tag
 * @output result - Tagged
 */
function tagItem(item: unknown, tag: string): { result: string } {
  return { result: tag + String(item) };
}

/**
 * @flowWeaver workflow
 * @param items - Items
 * @param tag - Tag
 * @returns results - All
 * @node loop each
 * @node child tagItem loop.each [expr: tag="Start.tag"]
 * @connect Start.execute -> loop.execute
 * @connect Start.items -> loop.items
 * @connect loop.start:each -> child.execute
 * @connect loop.item:each -> child.item
 * @connect child.result -> loop.result:each
 * @connect child.onSuccess -> loop.success:each
 * @connect child.onFailure -> loop.failure:each
 * @connect loop.results -> Exit.results
 * @connect loop.onSuccess -> Exit.onSuccess
 */
export function flow(execute: boolean, params: { items: unknown[]; tag: string }): { onSuccess: boolean; onFailure: boolean; results: string[] } {
  throw new Error('stub');
}
`;
    const result = parser.parseFromString(code);
    expect(result.errors).toEqual([
      '[expr] child.tag: "Start.tag" crosses a scope boundary. Expression references are only supported between top-level nodes. Use @connect with a scope qualifier instead.',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Graph consequences
// ---------------------------------------------------------------------------

describe('a reference is an edge', () => {
  it('a reference cycle is reported as CYCLE_DETECTED', () => {
    const wf = parser.parseFromString(
      source(` * @param path - File
 * @param question - Q
 * @returns task - The task
 * @node a double [expr: value="b.doubled"]
 * @node b double [expr: value="a.doubled"]
 * @node t describeTask [expr: id="'x'", context="{ n: a.doubled }", prompt="'p'"]
 * @path Start -> a -> b -> t -> Exit`),
    ).workflows[0];
    const v = validateWorkflow(wf);
    expect(v.errors.map((e) => e.code)).toContain('CYCLE_DETECTED');
  });

  it('a node reached only through references still runs before its reader', async () => {
    const code = source(` * @param path - File
 * @param question - Q
 * @returns task - The task
 * @node a double [expr: value="Start.path.length"]
 * @node b double [expr: value="Start.question.length"]
 * @node t describeTask [expr: id="'sum'", context="{ sum: a.doubled + b.doubled }", prompt="'p'"]
 * @path Start -> a -> t -> Exit`);
    await inTempFile(code, async (file) => {
      const parsed = await parseWorkflow(file);
      expect(parsed.errors).toEqual([]);
      const order = getTopologicalOrder(parsed.ast);
      expect(order.indexOf('b')).toBeLessThan(order.indexOf('t'));
      const outcome = await executeWorkflow({
        runId: 'expr-refs-order',
        bundleDigest,
        filePath: file,
        workflowName: 'flow',
        params: { path: 'abcd', question: 'xy' },
        production: false,
      });
      expect(outcome.kind).toBe('completed');
      if (outcome.kind !== 'completed') return;
      const task = JSON.parse((outcome.result as { task: string }).task);
      expect(task.context.sum).toBe(8 + 4);
    });
  });

  it('cannot be removed on its own through the manipulation API', () => {
    const wf = parser.parseFromString(
      source(` * @param path - File
 * @param question - Q
 * @returns task - The task
 * @node d double [expr: value="Start.path.length"]
 * @node t describeTask [expr: id="'x'", context="{ n: d.doubled }", prompt="'p'"]
 * @path Start -> d -> t -> Exit`),
    ).workflows[0];
    expect(() => removeConnection(wf, 'd.doubled', 't.context')).toThrow(/derived from the expression on t\.context/);
  });
});

// ---------------------------------------------------------------------------
// Round trip and execution
// ---------------------------------------------------------------------------

describe('round trip and execution', () => {
  const block = ` * @param path - File
 * @param question - What to look for
 * @returns task - The task
 * @node d double [expr: value="Start.path.length"]
 * @node t describeTask [expr: id="'inspect'", context="{ path: Start.path, doubled: d.doubled }", prompt="\`Open \${Start.path} and answer \${Start.question}\`"]
 * @path Start -> d -> t -> Exit`;

  it('regenerates the annotations with the expressions intact and no @connect for derived edges', async () => {
    await inTempFile(source(block), async (file) => {
      const parsed = await parseWorkflow(file);
      expect(parsed.errors).toEqual([]);
      const out = generateInPlace(fs.readFileSync(file, 'utf8'), parsed.ast, { annotationsOnly: true });
      expect(out.code).toContain('[expr: value="Start.path.length"]');
      expect(out.code).toContain('context="{ path: Start.path, doubled: d.doubled }"');
      expect(out.code).not.toMatch(/@connect Start\.path -> d\.value/);
      expect(out.code).not.toMatch(/@connect d\.doubled -> t\.context/);
      expect(out.code).not.toMatch(/@connect Start\.\w+ -> t\./);
      // and it parses back to the same derived edges
      fs.writeFileSync(file, out.code);
      const again = await parseWorkflow(file);
      expect(again.errors).toEqual([]);
      expect(derivedEdges(again.ast.connections)).toEqual(derivedEdges(parsed.ast.connections));
    });
  });

  it('evaluates the expression with the referenced values substituted', async () => {
    await inTempFile(source(block), async (file) => {
      const outcome = await executeWorkflow({
        runId: 'expr-refs-run',
        bundleDigest,
        filePath: file,
        workflowName: 'flow',
        params: { path: 'notes.md', question: 'is it done?' },
        production: false,
      });
      expect(outcome.kind).toBe('completed');
      if (outcome.kind !== 'completed') return;
      const task = JSON.parse((outcome.result as { task: string }).task);
      expect(task).toEqual({
        id: 'inspect',
        context: { path: 'notes.md', doubled: 'notes.md'.length * 2 },
        prompt: 'Open notes.md and answer is it done?',
      });
    });
  });

  it('a function-form expression can reference upstream ports too', async () => {
    const code = source(` * @param path - File
 * @param question - Q
 * @returns task - The task
 * @node d double [expr: value="Start.path.length"]
 * @node t describeTask [expr: id="'fn'", context="(ctx) => ({ n: d.doubled, q: Start.question })", prompt="'p'"]
 * @path Start -> d -> t -> Exit`);
    await inTempFile(code, async (file) => {
      const outcome = await executeWorkflow({
        runId: 'expr-refs-fn',
        bundleDigest,
        filePath: file,
        workflowName: 'flow',
        params: { path: 'ab', question: 'q' },
        production: false,
      });
      expect(outcome.kind).toBe('completed');
      if (outcome.kind !== 'completed') return;
      const task = JSON.parse((outcome.result as { task: string }).task);
      expect(task.context).toEqual({ n: 4, q: 'q' });
    });
  });
});
