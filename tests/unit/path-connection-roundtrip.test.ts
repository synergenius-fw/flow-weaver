/**
 * Sugar macro + connection mutation round-trip tests.
 *
 * Verifies that removing/adding connections interacts correctly with @path,
 * @fanOut, and @fanIn macros across parse -> mutate -> generateInPlace ->
 * re-parse cycles.
 *
 * The core invariant: if you remove a connection from the AST and round-trip
 * through generateInPlace, the connection must NOT reappear on re-parse.
 */

import { describe, it, expect } from 'vitest';
import { AnnotationParser } from '../../src/parser';
import { generateInPlace } from '../../src/api/generate-in-place';
import { removeConnection, addConnection } from '../../src/api/manipulation';

// =============================================================================
// Source helpers
// =============================================================================

/**
 * Two nodes with a matching data port ("context") connected via @path.
 * @path auto-wires classify.context → route.context because names match.
 */
function twoNodePathSource(extra = '') {
  return `
/**
 * @flowWeaver nodeType
 * @expression
 * @output context - Classification context
 */
declare function classifyNode(): { context: string };

/**
 * @flowWeaver nodeType
 * @expression
 * @input context - Routing context
 */
declare function routeNode(context: string): void;

/**
 * @flowWeaver workflow
 * @node classify classifyNode [position: 0 0]
 * @node route routeNode [position: 270 0]
 * @path Start -> classify -> route -> Exit
 * ${extra}
 * @position Start -270 0
 * @position Exit 540 0
 * @param execute [order:-1] - Execute
 * @param params [order:0] - Params
 * @returns onSuccess [order:-2] - On Success
 * @returns onFailure [order:-1] - On Failure
 */
export function testWorkflow(
  execute: boolean,
  params: Record<string, never> = {},
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  // @flow-weaver-body-start
  // @flow-weaver-body-end
  throw new Error('Not implemented');
}
`;
}

/**
 * Three nodes: A outputs "data" + "extra", B inputs "data" + "extra", C inputs "data".
 * @path Start -> A -> B -> C -> Exit
 * Auto-wires: A.data→B.data, A.extra→B.extra, B.data→C.data (scope walking: A.extra skips C since C has no extra input)
 */
function threeNodePathSource() {
  return `
/**
 * @flowWeaver nodeType
 * @expression
 * @output data
 * @output extra
 */
declare function nodeA(): { data: string; extra: string };

/**
 * @flowWeaver nodeType
 * @expression
 * @input data
 * @input extra
 * @output data
 * @output extra
 */
declare function nodeB(data: string, extra: string): { data: string; extra: string };

/**
 * @flowWeaver nodeType
 * @expression
 * @input data
 */
declare function nodeC(data: string): void;

/**
 * @flowWeaver workflow
 * @node a nodeA [position: 0 0]
 * @node b nodeB [position: 270 0]
 * @node c nodeC [position: 540 0]
 * @path Start -> a -> b -> c -> Exit
 * @position Start -270 0
 * @position Exit 810 0
 */
export function threeNodeWorkflow(
  execute: boolean,
  params: Record<string, never> = {},
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  // @flow-weaver-body-start
  // @flow-weaver-body-end
  throw new Error('Not implemented');
}
`;
}

/**
 * Two nodes with multiple matching ports: "data", "metadata", "status".
 * Tests removing one data connection while keeping others.
 */
function multiPortPathSource() {
  return `
/**
 * @flowWeaver nodeType
 * @expression
 * @output data
 * @output metadata
 * @output status
 */
declare function producer(): { data: string; metadata: string; status: string };

/**
 * @flowWeaver nodeType
 * @expression
 * @input data
 * @input metadata
 * @input status
 */
declare function consumer(data: string, metadata: string, status: string): void;

/**
 * @flowWeaver workflow
 * @node prod producer [position: 0 0]
 * @node cons consumer [position: 270 0]
 * @path Start -> prod -> cons -> Exit
 * @position Start -270 0
 * @position Exit 540 0
 */
export function multiPortWorkflow(
  execute: boolean,
  params: Record<string, never> = {},
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  // @flow-weaver-body-start
  // @flow-weaver-body-end
  throw new Error('Not implemented');
}
`;
}

/**
 * Scope walking: A → B → C where A.token is consumed by C (not B).
 * @path auto-wires A.token → C.token via backward scope walking.
 */
function scopeWalkingSource() {
  return `
/**
 * @flowWeaver nodeType
 * @expression
 * @output token
 * @output data
 */
declare function auth(): { token: string; data: string };

/**
 * @flowWeaver nodeType
 * @expression
 * @input data
 * @output data
 */
declare function transform(data: string): { data: string };

/**
 * @flowWeaver nodeType
 * @expression
 * @input token
 * @input data
 */
declare function publish(token: string, data: string): void;

/**
 * @flowWeaver workflow
 * @node auth auth [position: 0 0]
 * @node transform transform [position: 270 0]
 * @node publish publish [position: 540 0]
 * @path Start -> auth -> transform -> publish -> Exit
 * @position Start -270 0
 * @position Exit 810 0
 */
export function scopeWalkWorkflow(
  execute: boolean,
  params: Record<string, never> = {},
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  // @flow-weaver-body-start
  // @flow-weaver-body-end
  throw new Error('Not implemented');
}
`;
}

// =============================================================================
// Helpers
// =============================================================================

function parseSource(source: string) {
  const parser = new AnnotationParser();
  return parser.parseFromString(source, 'test.ts');
}

function roundTrip(source: string, workflow: ReturnType<typeof parseSource>['workflows'][0]) {
  const result = generateInPlace(source, workflow);
  const reparsed = parseSource(result.code);
  return { code: result.code, workflow: reparsed.workflows[0] };
}

function connectionKey(c: { from: { node: string; port: string }; to: { node: string; port: string } }) {
  return `${c.from.node}.${c.from.port} → ${c.to.node}.${c.to.port}`;
}

function hasConnection(workflow: { connections: Array<{ from: { node: string; port: string }; to: { node: string; port: string } }> }, from: string, to: string) {
  const [fromNode, fromPort] = from.split('.');
  const [toNode, toPort] = to.split('.');
  return workflow.connections.some(
    c => c.from.node === fromNode && c.from.port === fromPort &&
         c.to.node === toNode && c.to.port === toPort
  );
}

// =============================================================================
// Tests
// =============================================================================

describe('@path + removeConnection round-trip', () => {
  describe('removing a single data connection between adjacent @path nodes', () => {
    it('should NOT reappear after generateInPlace + re-parse', () => {
      const source = twoNodePathSource();
      const parsed = parseSource(source);
      const workflow = parsed.workflows[0];

      // Verify the auto-wired data connection exists
      expect(hasConnection(workflow, 'classify.context', 'route.context')).toBe(true);

      // Remove the data connection
      const updated = removeConnection(workflow, 'classify.context', 'route.context');
      expect(hasConnection(updated, 'classify.context', 'route.context')).toBe(false);

      // Round-trip: generateInPlace + re-parse
      const { workflow: reparsed } = roundTrip(source, updated);

      // The removed connection must stay removed
      expect(hasConnection(reparsed, 'classify.context', 'route.context')).toBe(false);

      // Control flow connections must survive
      expect(hasConnection(reparsed, 'Start.execute', 'classify.execute')).toBe(true);
      expect(hasConnection(reparsed, 'classify.onSuccess', 'route.execute')).toBe(true);
      expect(hasConnection(reparsed, 'route.onSuccess', 'Exit.onSuccess')).toBe(true);
    });
  });

  describe('removing one of multiple data connections between adjacent nodes', () => {
    it('should only remove the targeted connection', () => {
      const source = multiPortPathSource();
      const parsed = parseSource(source);
      const workflow = parsed.workflows[0];

      // All three data connections should be auto-wired
      expect(hasConnection(workflow, 'prod.data', 'cons.data')).toBe(true);
      expect(hasConnection(workflow, 'prod.metadata', 'cons.metadata')).toBe(true);
      expect(hasConnection(workflow, 'prod.status', 'cons.status')).toBe(true);

      // Remove only "metadata"
      const updated = removeConnection(workflow, 'prod.metadata', 'cons.metadata');

      const { workflow: reparsed } = roundTrip(source, updated);

      // metadata must stay removed
      expect(hasConnection(reparsed, 'prod.metadata', 'cons.metadata')).toBe(false);
      // others must survive
      expect(hasConnection(reparsed, 'prod.data', 'cons.data')).toBe(true);
      expect(hasConnection(reparsed, 'prod.status', 'cons.status')).toBe(true);
    });

    it('should handle removing ALL data connections (keep only control flow)', () => {
      const source = multiPortPathSource();
      const parsed = parseSource(source);
      let workflow = parsed.workflows[0];

      workflow = removeConnection(workflow, 'prod.data', 'cons.data');
      workflow = removeConnection(workflow, 'prod.metadata', 'cons.metadata');
      workflow = removeConnection(workflow, 'prod.status', 'cons.status');

      const { workflow: reparsed } = roundTrip(source, workflow);

      expect(hasConnection(reparsed, 'prod.data', 'cons.data')).toBe(false);
      expect(hasConnection(reparsed, 'prod.metadata', 'cons.metadata')).toBe(false);
      expect(hasConnection(reparsed, 'prod.status', 'cons.status')).toBe(false);

      // Control flow still intact
      expect(hasConnection(reparsed, 'Start.execute', 'prod.execute')).toBe(true);
      expect(hasConnection(reparsed, 'prod.onSuccess', 'cons.execute')).toBe(true);
      expect(hasConnection(reparsed, 'cons.onSuccess', 'Exit.onSuccess')).toBe(true);
    });
  });

  describe('removing a scope-walked data connection (non-adjacent)', () => {
    it('should not reappear after round-trip', () => {
      const source = scopeWalkingSource();
      const parsed = parseSource(source);
      const workflow = parsed.workflows[0];

      // auth.token → publish.token is wired via scope walking (skips transform)
      expect(hasConnection(workflow, 'auth.token', 'publish.token')).toBe(true);

      const updated = removeConnection(workflow, 'auth.token', 'publish.token');
      const { workflow: reparsed } = roundTrip(source, updated);

      expect(hasConnection(reparsed, 'auth.token', 'publish.token')).toBe(false);
      // auth.data → transform.data must survive
      expect(hasConnection(reparsed, 'auth.data', 'transform.data')).toBe(true);
      // transform.data → publish.data must survive
      expect(hasConnection(reparsed, 'transform.data', 'publish.data')).toBe(true);
    });
  });

  describe('removing data connections in a 3-node chain', () => {
    it('should handle removing a middle-segment data connection', () => {
      const source = threeNodePathSource();
      const parsed = parseSource(source);
      const workflow = parsed.workflows[0];

      // a.data→b.data, a.extra→b.extra, b.data→c.data should all exist
      expect(hasConnection(workflow, 'a.data', 'b.data')).toBe(true);
      expect(hasConnection(workflow, 'a.extra', 'b.extra')).toBe(true);
      expect(hasConnection(workflow, 'b.data', 'c.data')).toBe(true);

      // Remove only a.data → b.data
      const updated = removeConnection(workflow, 'a.data', 'b.data');
      const { workflow: reparsed } = roundTrip(source, updated);

      expect(hasConnection(reparsed, 'a.data', 'b.data')).toBe(false);
      expect(hasConnection(reparsed, 'a.extra', 'b.extra')).toBe(true);
      expect(hasConnection(reparsed, 'b.data', 'c.data')).toBe(true);
    });
  });
});

describe('@path + addConnection round-trip', () => {
  it('should preserve an explicitly added connection that matches @path auto-wiring', () => {
    const source = twoNodePathSource();
    const parsed = parseSource(source);
    const workflow = parsed.workflows[0];

    // Connection already exists via @path auto-wiring — remove then re-add
    const removed = removeConnection(workflow, 'classify.context', 'route.context');
    const readded = addConnection(removed, 'classify.context', 'route.context');

    const { workflow: reparsed } = roundTrip(source, readded);

    // Should still be present
    expect(hasConnection(reparsed, 'classify.context', 'route.context')).toBe(true);
  });
});

describe('@path + removeConnection + addConnection cycle', () => {
  it('remove -> round-trip -> add -> round-trip should work without "already exists" error', () => {
    const source = twoNodePathSource();
    const parsed = parseSource(source);
    const workflow = parsed.workflows[0];

    // Step 1: Remove
    const afterRemove = removeConnection(workflow, 'classify.context', 'route.context');

    // Step 2: Round-trip (simulates server write + re-read)
    const { code: code1, workflow: afterRemoveRT } = roundTrip(source, afterRemove);
    expect(hasConnection(afterRemoveRT, 'classify.context', 'route.context')).toBe(false);

    // Step 3: Add the connection back — must NOT throw "already exists"
    const afterAdd = addConnection(afterRemoveRT, 'classify.context', 'route.context');
    expect(hasConnection(afterAdd, 'classify.context', 'route.context')).toBe(true);

    // Step 4: Round-trip again
    const { workflow: afterAddRT } = roundTrip(code1, afterAdd);
    expect(hasConnection(afterAddRT, 'classify.context', 'route.context')).toBe(true);
  });
});

// =============================================================================
// @fanOut sources
// =============================================================================

/**
 * One producer fanning out "data" to two consumers.
 */
function fanOutSource() {
  return `
/**
 * @flowWeaver nodeType
 * @expression
 * @output data
 */
declare function producer(): { data: string };

/**
 * @flowWeaver nodeType
 * @expression
 * @input data
 */
declare function consumerA(data: string): void;

/**
 * @flowWeaver nodeType
 * @expression
 * @input data
 */
declare function consumerB(data: string): void;

/**
 * @flowWeaver workflow
 * @node prod producer [position: 0 0]
 * @node a consumerA [position: 270 -100]
 * @node b consumerB [position: 270 100]
 * @fanOut prod.data -> a, b
 * @connect Start.execute -> prod.execute
 * @connect prod.onSuccess -> a.execute
 * @connect prod.onSuccess -> b.execute
 * @connect a.onSuccess -> Exit.onSuccess
 * @position Start -270 0
 * @position Exit 540 0
 */
export function fanOutWorkflow(
  execute: boolean,
  params: Record<string, never> = {},
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  // @flow-weaver-body-start
  // @flow-weaver-body-end
  throw new Error('Not implemented');
}
`;
}

// =============================================================================
// @fanIn sources
// =============================================================================

/**
 * Two producers fanning in "result" to one aggregator.
 */
function fanInSource() {
  return `
/**
 * @flowWeaver nodeType
 * @expression
 * @output result
 */
declare function workerA(): { result: string };

/**
 * @flowWeaver nodeType
 * @expression
 * @output result
 */
declare function workerB(): { result: string };

/**
 * @flowWeaver nodeType
 * @expression
 * @input result
 */
declare function aggregator(result: string): void;

/**
 * @flowWeaver workflow
 * @node wa workerA [position: 0 -100]
 * @node wb workerB [position: 0 100]
 * @node agg aggregator [position: 270 0]
 * @fanIn wa, wb -> agg.result
 * @connect Start.execute -> wa.execute
 * @connect Start.execute -> wb.execute
 * @connect wa.onSuccess -> agg.execute
 * @connect agg.onSuccess -> Exit.onSuccess
 * @position Start -270 0
 * @position Exit 540 0
 */
export function fanInWorkflow(
  execute: boolean,
  params: Record<string, never> = {},
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  // @flow-weaver-body-start
  // @flow-weaver-body-end
  throw new Error('Not implemented');
}
`;
}

// =============================================================================
// @fanOut tests
// =============================================================================

describe('@fanOut + removeConnection round-trip', () => {
  it('removing one fanOut target connection should not reappear after round-trip', () => {
    const source = fanOutSource();
    const parsed = parseSource(source);
    const workflow = parsed.workflows[0];

    // Both fanOut connections should exist
    expect(hasConnection(workflow, 'prod.data', 'a.data')).toBe(true);
    expect(hasConnection(workflow, 'prod.data', 'b.data')).toBe(true);

    // Remove one
    const updated = removeConnection(workflow, 'prod.data', 'b.data');
    const { workflow: reparsed } = roundTrip(source, updated);

    expect(hasConnection(reparsed, 'prod.data', 'b.data')).toBe(false);
    expect(hasConnection(reparsed, 'prod.data', 'a.data')).toBe(true);
  });

  it('removing all fanOut connections should drop the macro entirely', () => {
    const source = fanOutSource();
    const parsed = parseSource(source);
    let workflow = parsed.workflows[0];

    workflow = removeConnection(workflow, 'prod.data', 'a.data');
    workflow = removeConnection(workflow, 'prod.data', 'b.data');

    const { workflow: reparsed } = roundTrip(source, workflow);

    expect(hasConnection(reparsed, 'prod.data', 'a.data')).toBe(false);
    expect(hasConnection(reparsed, 'prod.data', 'b.data')).toBe(false);
  });
});

// =============================================================================
// @fanIn tests
// =============================================================================

describe('@fanIn + removeConnection round-trip', () => {
  it('removing one fanIn source connection should not reappear after round-trip', () => {
    const source = fanInSource();
    const parsed = parseSource(source);
    const workflow = parsed.workflows[0];

    // Both fanIn connections should exist
    expect(hasConnection(workflow, 'wa.result', 'agg.result')).toBe(true);
    expect(hasConnection(workflow, 'wb.result', 'agg.result')).toBe(true);

    // Remove one
    const updated = removeConnection(workflow, 'wb.result', 'agg.result');
    const { workflow: reparsed } = roundTrip(source, updated);

    expect(hasConnection(reparsed, 'wb.result', 'agg.result')).toBe(false);
    expect(hasConnection(reparsed, 'wa.result', 'agg.result')).toBe(true);
  });

  it('removing all fanIn connections should drop the macro entirely', () => {
    const source = fanInSource();
    const parsed = parseSource(source);
    let workflow = parsed.workflows[0];

    workflow = removeConnection(workflow, 'wa.result', 'agg.result');
    workflow = removeConnection(workflow, 'wb.result', 'agg.result');

    const { workflow: reparsed } = roundTrip(source, workflow);

    expect(hasConnection(reparsed, 'wa.result', 'agg.result')).toBe(false);
    expect(hasConnection(reparsed, 'wb.result', 'agg.result')).toBe(false);
  });
});

// =============================================================================
// @coerce sources
// =============================================================================

/**
 * A producer outputs "count" (number), a consumer expects "count" (string).
 * @coerce inserts a synthetic toString node between them.
 * Generates: prod.count -> coerceCount.value, coerceCount.result -> cons.count
 */
function coerceSource() {
  return `
/**
 * @flowWeaver nodeType
 * @expression
 * @output count
 */
declare function producer(): { count: number };

/**
 * @flowWeaver nodeType
 * @expression
 * @input count
 */
declare function consumer(count: string): void;

/**
 * @flowWeaver workflow
 * @node prod producer [position: 0 0]
 * @node cons consumer [position: 540 0]
 * @coerce coerceCount prod.count -> cons.count as string
 * @connect Start.execute -> prod.execute
 * @connect prod.onSuccess -> cons.execute
 * @connect cons.onSuccess -> Exit.onSuccess
 * @position Start -270 0
 * @position Exit 810 0
 */
export function coerceWorkflow(
  execute: boolean,
  params: Record<string, never> = {},
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  // @flow-weaver-body-start
  // @flow-weaver-body-end
  throw new Error('Not implemented');
}
`;
}

// =============================================================================
// @coerce tests
// =============================================================================

describe('@coerce + removeConnection round-trip', () => {
  it('removing the source->coerce connection should drop the macro', () => {
    const source = coerceSource();
    const parsed = parseSource(source);
    const workflow = parsed.workflows[0];

    // Coerce creates: prod.count -> coerceCount.value AND coerceCount.result -> cons.count
    expect(hasConnection(workflow, 'prod.count', 'coerceCount.value')).toBe(true);
    expect(hasConnection(workflow, 'coerceCount.result', 'cons.count')).toBe(true);

    // Remove the source side
    const updated = removeConnection(workflow, 'prod.count', 'coerceCount.value');
    const { workflow: reparsed } = roundTrip(source, updated);

    // Both coerce connections should be gone (macro dropped)
    expect(hasConnection(reparsed, 'prod.count', 'coerceCount.value')).toBe(false);
    expect(hasConnection(reparsed, 'coerceCount.result', 'cons.count')).toBe(false);

    // Control flow must survive
    expect(hasConnection(reparsed, 'Start.execute', 'prod.execute')).toBe(true);
    expect(hasConnection(reparsed, 'prod.onSuccess', 'cons.execute')).toBe(true);
  });

  it('removing the coerce->target connection should drop the macro', () => {
    const source = coerceSource();
    const parsed = parseSource(source);
    const workflow = parsed.workflows[0];

    // Remove the target side
    const updated = removeConnection(workflow, 'coerceCount.result', 'cons.count');
    const { workflow: reparsed } = roundTrip(source, updated);

    // Both coerce connections should be gone (macro dropped)
    expect(hasConnection(reparsed, 'prod.count', 'coerceCount.value')).toBe(false);
    expect(hasConnection(reparsed, 'coerceCount.result', 'cons.count')).toBe(false);
  });
});

// =============================================================================
// @map note
// =============================================================================
// @map macros create scoped connections (inside an "iterate" scope). These are
// NOT affected by filterStaleMacros because it only checks unscoped connections.
// @map connections are managed internally by the MAP_ITERATOR node and are not
// directly removable by the user at the workflow level. No round-trip tests
// needed for @map connection removal.
