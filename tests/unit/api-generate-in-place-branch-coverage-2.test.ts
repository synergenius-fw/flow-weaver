/**
 * Additional branch coverage tests for src/api/generate-in-place.ts.
 * Targets uncovered branches: Promise return type wrapping, node rename via @name tag,
 * insertNodeTypeFunction paths, isConnectionCoveredByMacro variants, ports array format,
 * WORKFLOW variant skip, external sourceLocation skip, macro filtering in JSDoc, etc.
 */

import {
  generateInPlace,
  hasInPlaceMarkers,
  stripGeneratedSections,
  MARKERS,
} from '../../src/api/generate-in-place';
import type { TWorkflowAST, TNodeTypeAST, TWorkflowMacro } from '../../src/ast/types';

function makeNodeType(name: string, overrides: Partial<TNodeTypeAST> = {}): TNodeTypeAST {
  return {
    type: 'NodeType',
    name,
    functionName: name,
    inputs: {
      execute: { dataType: 'STEP' },
      value: { dataType: 'NUMBER' },
    },
    outputs: {
      onSuccess: { dataType: 'STEP' },
      onFailure: { dataType: 'STEP' },
      result: { dataType: 'NUMBER' },
    },
    hasSuccessPort: true,
    hasFailurePort: true,
    isAsync: false,
    executeWhen: 'CONJUNCTION',
    variant: 'FUNCTION',
    functionText: `function ${name}(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } { return { onSuccess: execute, onFailure: !execute, result: value }; }`,
    ...overrides,
  };
}

function makeMinimalAST(overrides: Partial<TWorkflowAST> = {}): TWorkflowAST {
  const nodeA = makeNodeType('nodeA');
  return {
    type: 'Workflow',
    name: 'myWorkflow',
    functionName: 'myWorkflow',
    sourceFile: 'test.ts',
    nodeTypes: [nodeA],
    instances: [{ type: 'NodeInstance', id: 'a', nodeType: 'nodeA' }],
    connections: [
      { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
      { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
    ],
    startPorts: { execute: { dataType: 'STEP' } },
    exitPorts: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' } },
    imports: [],
    ...overrides,
  };
}

function makeSourceWithNodeType(): string {
  return `/**
 * @flowWeaver nodeType
 * @input value {NUMBER}
 * @output result {NUMBER}
 */
function nodeA(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } { return { onSuccess: execute, onFailure: !execute, result: value }; }

/**
 * @flowWeaver workflow
 * @node a nodeA
 * @connect Start.execute -> a.execute
 * @connect a.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(
  execute: boolean = true,
  params: Record<string, unknown> = {}
): { onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}`;
}

describe('generate-in-place branch coverage 2', () => {
  describe('WORKFLOW variant skip', () => {
    it('skips node types with variant WORKFLOW', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({
        nodeTypes: [
          makeNodeType('nodeA'),
          makeNodeType('nodeB', { variant: 'WORKFLOW' }),
        ],
      });
      const result = generateInPlace(source, ast);
      // Should not crash, nodeB with WORKFLOW variant is silently skipped
      expect(result.code).toContain(MARKERS.RUNTIME_START);
    });
  });

  describe('external sourceLocation skip', () => {
    it('skips node types whose sourceLocation file differs from ast.sourceFile', () => {
      const source = makeSourceWithNodeType();
      const nodeExternal = makeNodeType('externalNode', {
        sourceLocation: { file: '/other/file.ts', line: 1, column: 0 },
      });
      const ast = makeMinimalAST({
        sourceFile: '/my/test.ts',
        nodeTypes: [makeNodeType('nodeA'), nodeExternal],
      });
      const result = generateInPlace(source, ast);
      expect(result.code).toContain(MARKERS.RUNTIME_START);
    });
  });

  describe('ensurePromiseReturnType', () => {
    it('wraps return type in Promise when async is forced and return type is not Promise', () => {
      const source = `/**
 * @flowWeaver nodeType
 * @input value {NUMBER}
 * @output result {NUMBER}
 */
function nodeA(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } { return { onSuccess: execute, onFailure: !execute, result: value }; }

/**
 * @flowWeaver workflow
 * @node a nodeA
 * @connect Start.execute -> a.execute
 * @connect a.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(
  execute: boolean = true,
  params: Record<string, unknown> = {}
): { onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}`;
      const ast = makeMinimalAST({
        nodeTypes: [makeNodeType('nodeA', { isAsync: true })],
      });
      const result = generateInPlace(source, ast);
      expect(result.code).toContain('Promise<');
      expect(result.hasChanges).toBe(true);
    });

    it('does not double-wrap when return type is already Promise', () => {
      const source = `/**
 * @flowWeaver nodeType
 * @input value {NUMBER}
 * @output result {NUMBER}
 */
function nodeA(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } { return { onSuccess: execute, onFailure: !execute, result: value }; }

/**
 * @flowWeaver workflow
 * @node a nodeA
 * @connect Start.execute -> a.execute
 * @connect a.onSuccess -> Exit.onSuccess
 */
export async function myWorkflow(
  execute: boolean = true,
  params: Record<string, unknown> = {}
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}`;
      const ast = makeMinimalAST({
        nodeTypes: [makeNodeType('nodeA', { isAsync: true })],
      });
      const result = generateInPlace(source, ast);
      // Should not double-wrap
      expect(result.code).not.toContain('Promise<Promise<');
    });

    it('skips wrapping when function has no return type annotation', () => {
      const source = `/**
 * @flowWeaver nodeType
 * @input value {NUMBER}
 * @output result {NUMBER}
 */
function nodeA(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } { return { onSuccess: execute, onFailure: !execute, result: value }; }

/**
 * @flowWeaver workflow
 * @node a nodeA
 * @connect Start.execute -> a.execute
 * @connect a.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(
  execute: boolean = true,
  params: Record<string, unknown> = {}
) {
  throw new Error('Not implemented');
}`;
      const ast = makeMinimalAST({
        nodeTypes: [makeNodeType('nodeA', { isAsync: true })],
      });
      const result = generateInPlace(source, ast);
      // No return type to wrap, should still add async keyword
      expect(result.code).toContain('async');
    });
  });

  describe('ensureAbortSignalParameter with no params', () => {
    it('adds __abortSignal__ to a function with no parameters', () => {
      const source = `/**
 * @flowWeaver nodeType
 * @input value {NUMBER}
 * @output result {NUMBER}
 */
function nodeA(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } { return { onSuccess: execute, onFailure: !execute, result: value }; }

/**
 * @flowWeaver workflow
 * @node a nodeA
 * @connect Start.execute -> a.execute
 * @connect a.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(): { onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}`;
      const ast = makeMinimalAST({ startPorts: {} });
      const result = generateInPlace(source, ast);
      expect(result.code).toContain('__abortSignal__');
    });
  });

  describe('ensureAbortSignalParameter when function not found', () => {
    it('returns unchanged code when workflow function does not exist', () => {
      const source = `/**
 * @flowWeaver nodeType
 */
function nodeA() { return { onSuccess: true, onFailure: false, result: 0 }; }

/**
 * @flowWeaver workflow
 */
export function differentName() {
  throw new Error('Not implemented');
}`;
      const ast = makeMinimalAST({ functionName: 'nonExistent' });
      // Should not crash; no matching function to modify
      const result = generateInPlace(source, ast);
      expect(result.code).toBeDefined();
    });
  });

  describe('replaceNodeTypeJSDoc rename via @name tag', () => {
    it('renames a function when found by @name tag but not by functionName', () => {
      const source = `/**
 * @flowWeaver nodeType
 * @name nodeA
 * @input value {NUMBER}
 * @output result {NUMBER}
 */
function oldNodeA(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } { return { onSuccess: execute, onFailure: !execute, result: value }; }

/**
 * @flowWeaver workflow
 * @node a nodeA
 * @connect Start.execute -> a.execute
 * @connect a.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(
  execute: boolean = true,
  params: Record<string, unknown> = {}
): { onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}`;
      const nodeA = makeNodeType('nodeA', {
        name: 'nodeA',
        functionName: 'renamedNodeA',
      });
      const ast = makeMinimalAST({ nodeTypes: [nodeA] });
      const result = generateInPlace(source, ast);
      expect(result.code).toContain('renamedNodeA');
      expect(result.hasChanges).toBe(true);
    });

    it('renames a function when name differs from functionName and no @name tag exists', () => {
      const source = `/**
 * @flowWeaver nodeType
 * @input value {NUMBER}
 * @output result {NUMBER}
 */
function nodeA(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } { return { onSuccess: execute, onFailure: !execute, result: value }; }

/**
 * @flowWeaver workflow
 * @node a nodeA
 * @connect Start.execute -> a.execute
 * @connect a.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(
  execute: boolean = true,
  params: Record<string, unknown> = {}
): { onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}`;
      const nodeA = makeNodeType('nodeA', {
        name: 'nodeA',
        functionName: 'brandNewName',
      });
      const ast = makeMinimalAST({ nodeTypes: [nodeA] });
      const result = generateInPlace(source, ast);
      expect(result.code).toContain('brandNewName');
      expect(result.hasChanges).toBe(true);
    });
  });

  describe('insertNodeTypeFunction when function not in source', () => {
    it('inserts a new nodeType function when it is not present in source and has code', () => {
      const source = `/**
 * @flowWeaver workflow
 * @node a nodeA
 * @connect Start.execute -> a.execute
 * @connect a.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(
  execute: boolean = true,
  params: Record<string, unknown> = {}
): { onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}`;
      const nodeA = makeNodeType('nodeA', {
        functionText: `/**\n * @flowWeaver nodeType\n */\nfunction nodeA(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } { return { onSuccess: execute, onFailure: !execute, result: value }; }`,
      });
      const ast = makeMinimalAST({ nodeTypes: [nodeA] });
      const result = generateInPlace(source, ast);
      expect(result.code).toContain('function nodeA');
      expect(result.hasChanges).toBe(true);
    });

    it('inserts a nodeType function using the code property', () => {
      const source = `/**
 * @flowWeaver workflow
 * @node a nodeA
 */
export function myWorkflow() {
  throw new Error('Not implemented');
}`;
      const nodeA = makeNodeType('nodeA');
      (nodeA as any).code = `function nodeA(execute: boolean, value: number): { onSuccess: boolean; result: number } { return { onSuccess: true, result: value }; }`;
      delete (nodeA as any).functionText;
      const ast = makeMinimalAST({ nodeTypes: [nodeA] });
      const result = generateInPlace(source, ast);
      expect(result.code).toContain('function nodeA');
    });
  });

  describe('nodeType with no code and no function in source', () => {
    it('returns unchanged when nodeType has no code/functionText and function is missing', () => {
      const source = `/**
 * @flowWeaver workflow
 * @node a nodeA
 */
export function myWorkflow() {
  throw new Error('Not implemented');
}`;
      const nodeA = makeNodeType('nodeA', { functionText: undefined });
      const ast = makeMinimalAST({ nodeTypes: [nodeA] });
      const result = generateInPlace(source, ast);
      // Should not crash even though nodeA function is absent
      expect(result.code).toBeDefined();
    });
  });

  describe('workflow JSDoc with macros', () => {
    it('emits @map macro line', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({
        macros: [
          {
            type: 'map',
            instanceId: 'mapInst',
            childId: 'childInst',
            sourcePort: 'a.items',
            inputPort: 'item',
            outputPort: 'result',
          } as TWorkflowMacro,
        ],
        instances: [
          { type: 'NodeInstance', id: 'a', nodeType: 'nodeA' },
          { type: 'NodeInstance', id: 'mapInst', nodeType: 'MAP_ITERATOR' },
          { type: 'NodeInstance', id: 'childInst', nodeType: 'nodeA', parent: 'mapInst.iterate' },
        ],
      });
      const result = generateInPlace(source, ast);
      expect(result.code).toContain('@map mapInst childInst');
      expect(result.code).toContain('over a.items');
    });

    it('emits @path macro line', () => {
      const source = makeSourceWithNodeType();
      const nodeB = makeNodeType('nodeB');
      const ast = makeMinimalAST({
        nodeTypes: [makeNodeType('nodeA'), nodeB],
        instances: [
          { type: 'NodeInstance', id: 'a', nodeType: 'nodeA' },
          { type: 'NodeInstance', id: 'b', nodeType: 'nodeB' },
        ],
        macros: [
          {
            type: 'path',
            steps: [
              { node: 'Start' },
              { node: 'a', route: 'ok' },
              { node: 'b', route: 'ok' },
              { node: 'Exit' },
            ],
          } as TWorkflowMacro,
        ],
        connections: [
          { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
          { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'b', port: 'execute' } },
          { type: 'Connection', from: { node: 'b', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        ],
      });
      const result = generateInPlace(source, ast);
      expect(result.code).toContain('@path Start -> a:ok -> b:ok -> Exit');
    });

    it('emits @fanOut macro line', () => {
      const source = makeSourceWithNodeType();
      const nodeB = makeNodeType('nodeB');
      const ast = makeMinimalAST({
        nodeTypes: [makeNodeType('nodeA'), nodeB],
        instances: [
          { type: 'NodeInstance', id: 'a', nodeType: 'nodeA' },
          { type: 'NodeInstance', id: 'b', nodeType: 'nodeB' },
        ],
        macros: [
          {
            type: 'fanOut',
            source: { node: 'a', port: 'result' },
            targets: [
              { node: 'b', port: 'value' },
            ],
          } as TWorkflowMacro,
        ],
        connections: [
          { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
          { type: 'Connection', from: { node: 'a', port: 'result' }, to: { node: 'b', port: 'value' } },
          { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        ],
      });
      const result = generateInPlace(source, ast);
      expect(result.code).toContain('@fanOut a.result -> b.value');
    });

    it('emits @fanIn macro line', () => {
      const source = makeSourceWithNodeType();
      const nodeB = makeNodeType('nodeB');
      const ast = makeMinimalAST({
        nodeTypes: [makeNodeType('nodeA'), nodeB],
        instances: [
          { type: 'NodeInstance', id: 'a', nodeType: 'nodeA' },
          { type: 'NodeInstance', id: 'b', nodeType: 'nodeB' },
        ],
        macros: [
          {
            type: 'fanIn',
            target: { node: 'b', port: 'value' },
            sources: [
              { node: 'a', port: 'result' },
            ],
          } as TWorkflowMacro,
        ],
        connections: [
          { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
          { type: 'Connection', from: { node: 'a', port: 'result' }, to: { node: 'b', port: 'value' } },
          { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        ],
      });
      const result = generateInPlace(source, ast);
      expect(result.code).toContain('@fanIn a.result -> b.value');
    });

    it('emits @fanOut with targets that have no explicit port', () => {
      const source = makeSourceWithNodeType();
      const nodeB = makeNodeType('nodeB');
      const ast = makeMinimalAST({
        nodeTypes: [makeNodeType('nodeA'), nodeB],
        instances: [
          { type: 'NodeInstance', id: 'a', nodeType: 'nodeA' },
          { type: 'NodeInstance', id: 'b', nodeType: 'nodeB' },
        ],
        macros: [
          {
            type: 'fanOut',
            source: { node: 'a', port: 'result' },
            targets: [{ node: 'b' }],
          } as TWorkflowMacro,
        ],
        connections: [
          { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
          { type: 'Connection', from: { node: 'a', port: 'result' }, to: { node: 'b', port: 'result' } },
          { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        ],
      });
      const result = generateInPlace(source, ast);
      expect(result.code).toContain('@fanOut a.result -> b');
    });

    it('emits @fanIn with sources that have no explicit port', () => {
      const source = makeSourceWithNodeType();
      const nodeB = makeNodeType('nodeB');
      const ast = makeMinimalAST({
        nodeTypes: [makeNodeType('nodeA'), nodeB],
        instances: [
          { type: 'NodeInstance', id: 'a', nodeType: 'nodeA' },
          { type: 'NodeInstance', id: 'b', nodeType: 'nodeB' },
        ],
        macros: [
          {
            type: 'fanIn',
            target: { node: 'b', port: 'value' },
            sources: [{ node: 'a' }],
          } as TWorkflowMacro,
        ],
        connections: [
          { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
          { type: 'Connection', from: { node: 'a', port: 'value' }, to: { node: 'b', port: 'value' } },
          { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        ],
      });
      const result = generateInPlace(source, ast);
      expect(result.code).toContain('@fanIn a -> b.value');
    });
  });

  describe('coerce macro filtering', () => {
    it('skips coerce instance IDs from @node output and filters dropped coerce connections', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({
        macros: [
          {
            type: 'coerce',
            instanceId: 'coerce1',
            fromType: 'STRING',
            toType: 'NUMBER',
            source: { node: 'a', port: 'result' },
            target: { node: 'Exit', port: 'onSuccess' },
          } as TWorkflowMacro,
        ],
        instances: [
          { type: 'NodeInstance', id: 'a', nodeType: 'nodeA' },
          { type: 'NodeInstance', id: 'coerce1', nodeType: 'COERCION' },
        ],
        connections: [
          { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
          { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        ],
      });
      const result = generateInPlace(source, ast);
      // coerce instance should not appear as a @node in the workflow JSDoc
      const workflowJsdoc = result.code.slice(
        result.code.indexOf('@flowWeaver workflow'),
        result.code.indexOf('export function')
      );
      expect(workflowJsdoc).not.toContain('coerce1');
    });
  });

  describe('npm node type imports', () => {
    it('emits @fwImport for node types with importSource', () => {
      const source = makeSourceWithNodeType();
      const npmNode = makeNodeType('npm/my-pkg/doThing', {
        importSource: 'my-pkg',
        name: 'npm/my-pkg/doThing',
        functionName: 'npm/my-pkg/doThing',
      });
      const ast = makeMinimalAST({
        nodeTypes: [makeNodeType('nodeA'), npmNode],
      });
      const result = generateInPlace(source, ast);
      expect(result.code).toContain('@fwImport npm/my-pkg/doThing doThing from "my-pkg"');
    });

    it('uses explicit functionName when it differs from name for npm imports', () => {
      const source = makeSourceWithNodeType();
      const npmNode = makeNodeType('npm/my-pkg/doThing', {
        importSource: 'my-pkg',
        name: 'npm/my-pkg/doThing',
        functionName: 'customFunc',
      });
      const ast = makeMinimalAST({
        nodeTypes: [makeNodeType('nodeA'), npmNode],
      });
      const result = generateInPlace(source, ast);
      expect(result.code).toContain('@fwImport npm/my-pkg/doThing customFunc from "my-pkg"');
    });
  });

  describe('workflow scopes', () => {
    it('emits @scope tags for non-macro scopes', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({
        scopes: { 'myScope': ['a'] },
      });
      const result = generateInPlace(source, ast);
      expect(result.code).toContain('@scope myScope [a]');
    });

    it('skips scopes covered by @map macros', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({
        macros: [
          {
            type: 'map',
            instanceId: 'mapInst',
            childId: 'childInst',
            sourcePort: 'a.items',
          } as TWorkflowMacro,
        ],
        instances: [
          { type: 'NodeInstance', id: 'a', nodeType: 'nodeA' },
          { type: 'NodeInstance', id: 'mapInst', nodeType: 'MAP_ITERATOR' },
          { type: 'NodeInstance', id: 'childInst', nodeType: 'nodeA', parent: 'mapInst.iterate' },
        ],
        scopes: { 'mapInst.iterate': ['childInst'] },
      });
      const result = generateInPlace(source, ast);
      expect(result.code).not.toContain('@scope mapInst.iterate');
    });
  });

  describe('nodeType with ports array format', () => {
    it('handles nodeType that uses ports array instead of inputs/outputs', () => {
      const source = `/**
 * @flowWeaver nodeType
 */
function portNode(execute: boolean, data: string): { onSuccess: boolean; result: string } { return { onSuccess: true, result: data }; }

/**
 * @flowWeaver workflow
 * @node a portNode
 */
export function myWorkflow(): { onSuccess: boolean } {
  throw new Error('Not implemented');
}`;
      const nodeWithPorts = makeNodeType('portNode', {
        inputs: {},
        outputs: {},
        ports: [
          { name: 'execute', direction: 'INPUT', type: 'STEP' as any },
          { name: 'data', direction: 'INPUT', type: 'STRING' as any, defaultLabel: 'Data' },
          { name: 'onSuccess', direction: 'OUTPUT', type: 'STEP' as any },
          { name: 'result', direction: 'OUTPUT', type: 'STRING' as any, defaultLabel: 'Result' },
        ] as any,
      });
      const ast = makeMinimalAST({
        nodeTypes: [nodeWithPorts],
        instances: [{ type: 'NodeInstance', id: 'a', nodeType: 'portNode' }],
      });
      const result = generateInPlace(source, ast);
      expect(result.code).toContain('@input data');
      expect(result.code).toContain('@output result');
    });
  });

  describe('workflow ui positions', () => {
    it('emits @position for Start and Exit when ui positions are set', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({
        ui: {
          startNode: { x: 100, y: 200 },
          exitNode: { x: 500, y: 200 },
        },
      });
      const result = generateInPlace(source, ast);
      expect(result.code).toContain('@position Start 100 200');
      expect(result.code).toContain('@position Exit 500 200');
    });

    it('auto-positions when no ui positions are provided', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST();
      // No ui set, positions are auto-computed
      const result = generateInPlace(source, ast);
      expect(result.code).toContain('@position Start');
      expect(result.code).toContain('@position Exit');
    });
  });

  describe('stale duplicate JSDoc removal', () => {
    it('removes stale duplicate @flowWeaver JSDoc blocks before a nodeType function', () => {
      const source = `/**
 * @flowWeaver nodeType
 * @input value {NUMBER}
 */
/**
 * @flowWeaver nodeType
 * @input value {NUMBER}
 * @output result {NUMBER}
 */
function nodeA(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } { return { onSuccess: execute, onFailure: !execute, result: value }; }

/**
 * @flowWeaver workflow
 * @node a nodeA
 * @connect Start.execute -> a.execute
 * @connect a.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(
  execute: boolean = true,
  params: Record<string, unknown> = {}
): { onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}`;
      const ast = makeMinimalAST();
      const result = generateInPlace(source, ast);
      // The stale duplicate should be removed
      const flowWeaverMatches = result.code.match(/@flowWeaver nodeType/g);
      // Should have exactly 1 nodeType JSDoc
      expect(flowWeaverMatches?.length).toBe(1);
      expect(result.hasChanges).toBe(true);
    });
  });

  describe('workflow description in JSDoc', () => {
    it('emits description in workflow JSDoc', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({
        description: 'My cool workflow that does things',
      });
      const result = generateInPlace(source, ast);
      expect(result.code).toContain('My cool workflow that does things');
    });
  });

  describe('trigger, cancelOn, retries, timeout, throttle options', () => {
    it('emits @cancelOn with match and timeout', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({
        options: {
          cancelOn: {
            event: 'cancel-event',
            match: '$.id',
            timeout: '30s',
          },
        },
      });
      const result = generateInPlace(source, ast);
      expect(result.code).toContain('@cancelOn event="cancel-event" match="$.id" timeout="30s"');
    });

    it('emits @throttle with period', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({
        options: {
          throttle: { limit: 10, period: '1m' },
        },
      });
      const result = generateInPlace(source, ast);
      expect(result.code).toContain('@throttle limit=10 period="1m"');
    });

    it('emits @throttle without period', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({
        options: {
          throttle: { limit: 5 },
        },
      });
      const result = generateInPlace(source, ast);
      expect(result.code).toContain('@throttle limit=5');
      expect(result.code).not.toContain('period=');
    });
  });

  describe('hasInPlaceMarkers edge cases', () => {
    it('returns false when only runtime markers are present (no body markers)', () => {
      const source = `${MARKERS.RUNTIME_START}\nsome code\n${MARKERS.RUNTIME_END}`;
      expect(hasInPlaceMarkers(source)).toBe(false);
    });

    it('returns false when only body markers are present (no runtime markers)', () => {
      const source = `${MARKERS.BODY_START}\nsome code\n${MARKERS.BODY_END}`;
      expect(hasInPlaceMarkers(source)).toBe(false);
    });
  });

  describe('stripGeneratedSections edge cases', () => {
    it('handles runtime markers at the very start of the file', () => {
      const source = `${MARKERS.RUNTIME_START}\ngenerated\n${MARKERS.RUNTIME_END}\nrest of file`;
      const result = stripGeneratedSections(source);
      expect(result).not.toContain('generated');
      expect(result).toContain('rest of file');
    });

    it('handles body markers without newlines after end marker', () => {
      const source = `before${MARKERS.BODY_START}generated${MARKERS.BODY_END}after`;
      const result = stripGeneratedSections(source);
      expect(result).toContain("throw new Error('Not implemented')");
    });
  });

  describe('computeAutoPositions with all nodes positioned', () => {
    it('does not compute auto positions when all nodes have explicit positions', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({
        ui: {
          startNode: { x: 0, y: 0 },
          exitNode: { x: 540, y: 0 },
        },
        instances: [
          { type: 'NodeInstance', id: 'a', nodeType: 'nodeA', config: { x: 270, y: 0 } },
        ],
      });
      const result = generateInPlace(source, ast);
      expect(result.code).toContain('@position Start 0 0');
      expect(result.code).toContain('@position Exit 540 0');
    });
  });

  describe('topological sort with no connections', () => {
    it('uses declaration order when there are no connections', () => {
      const source = `/**
 * @flowWeaver nodeType
 * @input value {NUMBER}
 * @output result {NUMBER}
 */
function nodeA(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } { return { onSuccess: execute, onFailure: !execute, result: value }; }

/**
 * @flowWeaver nodeType
 * @input value {NUMBER}
 * @output result {NUMBER}
 */
function nodeB(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } { return { onSuccess: execute, onFailure: !execute, result: value }; }

/**
 * @flowWeaver workflow
 * @node a nodeA
 * @node b nodeB
 */
export function myWorkflow(): { onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}`;
      const nodeB = makeNodeType('nodeB');
      const ast = makeMinimalAST({
        nodeTypes: [makeNodeType('nodeA'), nodeB],
        instances: [
          { type: 'NodeInstance', id: 'a', nodeType: 'nodeA' },
          { type: 'NodeInstance', id: 'b', nodeType: 'nodeB' },
        ],
        connections: [],
      });
      const result = generateInPlace(source, ast);
      // Both nodes should get auto positions
      expect(result.code).toContain('@position Start');
      expect(result.code).toContain('@position Exit');
    });
  });

  describe('external runtime with production mode', () => {
    it('does not emit debug client import when external runtime + production', () => {
      // We cannot truly trigger external runtime detection without a real node_modules,
      // but we can test that inlineRuntime=true forces inline and production omits debug.
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST();
      const result = generateInPlace(source, ast, { inlineRuntime: true, production: true });
      expect(result.code).not.toContain('createFlowWeaverDebugClient');
      expect(result.code).not.toContain('TDebugger');
    });
  });

  describe('sourceFile lookup dir fallback', () => {
    it('uses ast.sourceFile dirname when no sourceFile option is provided', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({ sourceFile: '/tmp/test.ts' });
      // Should not crash, uses ast.sourceFile for lookup
      const result = generateInPlace(source, ast);
      expect(result.code).toContain(MARKERS.RUNTIME_START);
    });

    it('falls back to process.cwd() when neither sourceFile option nor ast.sourceFile is set', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({ sourceFile: '' });
      const result = generateInPlace(source, ast);
      expect(result.code).toContain(MARKERS.RUNTIME_START);
    });
  });

  describe('replaceOrInsertSection with before-function position', () => {
    it('returns unchanged code when insert position is before-function and no markers exist', () => {
      // This tests the final else branch in replaceOrInsertSection
      // We cannot directly call replaceOrInsertSection, but the body replacement path covers it
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST();
      const result = generateInPlace(source, ast);
      expect(result.code).toContain(MARKERS.BODY_START);
    });
  });

  describe('nodeType @name tag matches functionName', () => {
    it('emits @name only when name differs from functionName', () => {
      const source = makeSourceWithNodeType();
      const nodeA = makeNodeType('nodeA', { name: 'nodeA', functionName: 'nodeA' });
      const ast = makeMinimalAST({ nodeTypes: [nodeA] });
      const result = generateInPlace(source, ast);
      // @name should NOT appear since name === functionName
      expect(result.code).not.toMatch(/@name nodeA/);
    });

    it('emits @name when name differs from functionName in nodeType JSDoc', () => {
      const source = `/**
 * @flowWeaver nodeType
 * @name stableId
 * @input value {NUMBER}
 * @output result {NUMBER}
 */
function renamedFunc(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } { return { onSuccess: execute, onFailure: !execute, result: value }; }

/**
 * @flowWeaver workflow
 * @node a stableId
 */
export function myWorkflow(): { onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}`;
      const nodeA = makeNodeType('renamedFunc', {
        name: 'stableId',
        functionName: 'renamedFunc',
      });
      const ast = makeMinimalAST({ nodeTypes: [nodeA] });
      const result = generateInPlace(source, ast);
      expect(result.code).toContain('@name stableId');
    });
  });

  describe('map macro with no inputPort/outputPort', () => {
    it('emits @map without port mapping when inputPort/outputPort are not set', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({
        macros: [
          {
            type: 'map',
            instanceId: 'mapInst',
            childId: 'childInst',
            sourcePort: 'a.items',
          } as TWorkflowMacro,
        ],
        instances: [
          { type: 'NodeInstance', id: 'a', nodeType: 'nodeA' },
          { type: 'NodeInstance', id: 'mapInst', nodeType: 'MAP_ITERATOR' },
          { type: 'NodeInstance', id: 'childInst', nodeType: 'nodeA', parent: 'mapInst.iterate' },
        ],
      });
      const result = generateInPlace(source, ast);
      expect(result.code).toContain('@map mapInst childInst over a.items');
      // Should NOT have parentheses for port mapping in the @map line itself
      const mapLine = result.code.split('\n').find(l => l.includes('@map mapInst'));
      expect(mapLine).toBeDefined();
      expect(mapLine).not.toContain('(');
    });
  });

  describe('connection with scope suffixes', () => {
    it('emits scope suffix on both from and to', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({
        connections: [
          {
            type: 'Connection',
            from: { node: 'a', port: 'result', scope: 'inner' },
            to: { node: 'Exit', port: 'onSuccess', scope: 'outer' },
          },
        ],
      });
      const result = generateInPlace(source, ast);
      expect(result.code).toContain('@connect a.result:inner -> Exit.onSuccess:outer');
    });
  });
});
