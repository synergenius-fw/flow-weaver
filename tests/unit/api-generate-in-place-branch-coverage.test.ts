/**
 * Branch coverage tests for src/api/generate-in-place.ts.
 * Exercises conditional branches: production vs dev, inline vs external runtime,
 * skipParamReturns, moduleFormat, missing functions, async detection, markers,
 * stripGeneratedSections, and hasInPlaceMarkers.
 */

import {
  generateInPlace,
  hasInPlaceMarkers,
  stripGeneratedSections,
  MARKERS,
} from '../../src/api/generate-in-place';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

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

describe('generate-in-place branch coverage', () => {
  describe('production option', () => {
    it('generates production code without debug client when production=true', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST();
      const result = generateInPlace(source, ast, { production: true });

      expect(result.code).not.toContain('createFlowWeaverDebugClient');
      expect(result.code).toContain(MARKERS.RUNTIME_START);
      expect(result.hasChanges).toBe(true);
    });

    it('generates dev code without debug client when production=false (debug client removed)', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST();
      const result = generateInPlace(source, ast, { production: false });

      // Debug client was removed — should not appear
      expect(result.code).not.toContain('createFlowWeaverDebugClient');
      expect(result.hasChanges).toBe(true);
    });
  });

  describe('skipParamReturns option', () => {
    it('omits @param/@returns when skipParamReturns=true', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({
        startPorts: {
          execute: { dataType: 'STEP' },
          inputVal: { dataType: 'NUMBER' },
        },
        exitPorts: {
          onSuccess: { dataType: 'STEP' },
          outputVal: { dataType: 'NUMBER' },
        },
      });
      const result = generateInPlace(source, ast, { skipParamReturns: true });

      // The workflow JSDoc should NOT have @param or @returns for the ports
      expect(result.code).not.toMatch(/@param\s+inputVal/);
      expect(result.code).not.toMatch(/@returns\s+outputVal/);
    });

    it('includes @param/@returns when skipParamReturns=false', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({
        startPorts: {
          execute: { dataType: 'STEP' },
          inputVal: { dataType: 'NUMBER' },
        },
        exitPorts: {
          onSuccess: { dataType: 'STEP' },
          outputVal: { dataType: 'NUMBER' },
        },
      });
      const result = generateInPlace(source, ast, { skipParamReturns: false });

      expect(result.code).toContain('@param');
      expect(result.code).toContain('@returns');
    });
  });

  describe('inlineRuntime option', () => {
    it('generates inline runtime when inlineRuntime=true', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST();
      const result = generateInPlace(source, ast, { inlineRuntime: true });

      // Inline runtime should NOT have import from @synergenius/flow-weaver/runtime
      expect(result.code).not.toContain("from '@synergenius/flow-weaver/runtime'");
      expect(result.hasChanges).toBe(true);
    });
  });

  describe('moduleFormat option', () => {
    it('accepts cjs moduleFormat without errors', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST();
      const result = generateInPlace(source, ast, { moduleFormat: 'cjs', inlineRuntime: true });

      expect(result.code).toContain(MARKERS.RUNTIME_START);
      expect(result.hasChanges).toBe(true);
    });

    it('defaults to esm moduleFormat', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST();
      const result = generateInPlace(source, ast, { inlineRuntime: true });

      expect(result.code).toContain(MARKERS.RUNTIME_START);
      expect(result.hasChanges).toBe(true);
    });
  });

  describe('allWorkflows option', () => {
    it('does not orphan node types used by sibling workflows', () => {
      const nodeA = makeNodeType('nodeA');
      const nodeB = makeNodeType('nodeB');

      // nodeB is used by a sibling workflow but not the primary AST
      const siblingAST: TWorkflowAST = {
        type: 'Workflow',
        name: 'siblingWorkflow',
        functionName: 'siblingWorkflow',
        sourceFile: 'test.ts',
        nodeTypes: [nodeB],
        instances: [{ type: 'NodeInstance', id: 'b', nodeType: 'nodeB' }],
        connections: [],
        startPorts: { execute: { dataType: 'STEP' } },
        exitPorts: { onSuccess: { dataType: 'STEP' } },
        imports: [],
      };

      const source = `/**
 * @flowWeaver nodeType
 * @input value {NUMBER}
 * @output result {NUMBER}
 */
function nodeA(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } { return { onSuccess: true, onFailure: false, result: value }; }

/**
 * @flowWeaver nodeType
 * @input value {NUMBER}
 * @output result {NUMBER}
 */
function nodeB(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } { return { onSuccess: true, onFailure: false, result: value }; }

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

      const ast = makeMinimalAST({ nodeTypes: [nodeA] });
      const result = generateInPlace(source, ast, { allWorkflows: [ast, siblingAST] });

      // nodeB should NOT be removed because it's used by siblingWorkflow
      expect(result.code).toContain('function nodeB');
    });
  });

  describe('nodeType variant skipping', () => {
    it('skips IMPORTED_WORKFLOW variant node types', () => {
      const importedNode = makeNodeType('importedWf', {
        variant: 'IMPORTED_WORKFLOW',
      });
      const nodeA = makeNodeType('nodeA');

      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({ nodeTypes: [nodeA, importedNode] });
      const result = generateInPlace(source, ast);

      // Should still produce output without errors
      expect(result.code).toContain(MARKERS.RUNTIME_START);
    });

    it('skips MAP_ITERATOR variant node types', () => {
      const iteratorNode = makeNodeType('mapIterator', {
        variant: 'MAP_ITERATOR',
      });
      const nodeA = makeNodeType('nodeA');

      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({ nodeTypes: [nodeA, iteratorNode] });
      const result = generateInPlace(source, ast);

      expect(result.code).toContain(MARKERS.RUNTIME_START);
    });
  });

  describe('async detection and keyword insertion', () => {
    it('adds async keyword when a node type is async', () => {
      const asyncNode = makeNodeType('nodeA', { isAsync: true });

      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({ nodeTypes: [asyncNode] });
      const result = generateInPlace(source, ast);

      expect(result.code).toContain('async function myWorkflow');
      expect(result.code).toContain('Promise<');
    });

    it('preserves existing async keyword', () => {
      const source = `/**
 * @flowWeaver nodeType
 * @input value {NUMBER}
 * @output result {NUMBER}
 */
function nodeA(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } { return { onSuccess: true, onFailure: false, result: value }; }

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

      const ast = makeMinimalAST();
      const result = generateInPlace(source, ast);

      // Should not double-add async
      expect(result.code).not.toContain('async async');
    });
  });

  describe('__abortSignal__ parameter insertion', () => {
    it('adds __abortSignal__ parameter when not present', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST();
      const result = generateInPlace(source, ast);

      expect(result.code).toContain('__abortSignal__');
    });

    it('does not duplicate __abortSignal__ if already present', () => {
      const source = `/**
 * @flowWeaver nodeType
 * @input value {NUMBER}
 * @output result {NUMBER}
 */
function nodeA(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } { return { onSuccess: true, onFailure: false, result: value }; }

/**
 * @flowWeaver workflow
 * @node a nodeA
 * @connect Start.execute -> a.execute
 * @connect a.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(
  execute: boolean = true,
  params: Record<string, unknown> = {},
  __abortSignal__?: AbortSignal
): { onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}`;

      const ast = makeMinimalAST();
      const result = generateInPlace(source, ast);

      const matches = result.code.match(/__abortSignal__/g);
      // Should appear in parameter list and possibly in body, but NOT duplicated in params
      const paramSection = result.code.slice(0, result.code.indexOf('{'));
      const paramMatches = paramSection.match(/__abortSignal__/g);
      expect(paramMatches?.length ?? 0).toBeLessThanOrEqual(2); // param name + type annotation
    });
  });

  describe('workflow body replacement', () => {
    it('inserts body markers when not present', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST();
      const result = generateInPlace(source, ast);

      expect(result.code).toContain(MARKERS.BODY_START);
      expect(result.code).toContain(MARKERS.BODY_END);
    });

    it('replaces content between existing body markers', () => {
      const source = `/**
 * @flowWeaver nodeType
 * @input value {NUMBER}
 * @output result {NUMBER}
 */
function nodeA(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } { return { onSuccess: true, onFailure: false, result: value }; }

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
  // @flow-weaver-body-start
  // old generated body
  // @flow-weaver-body-end
}`;

      const ast = makeMinimalAST();
      const result = generateInPlace(source, ast);

      expect(result.code).toContain(MARKERS.BODY_START);
      expect(result.code).toContain(MARKERS.BODY_END);
      // Old body content should be replaced
      expect(result.code).not.toContain('// old generated body');
    });
  });

  describe('runtime section replacement', () => {
    it('inserts runtime markers when not present', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST();
      const result = generateInPlace(source, ast);

      expect(result.code).toContain(MARKERS.RUNTIME_START);
      expect(result.code).toContain(MARKERS.RUNTIME_END);
    });

    it('replaces content between existing runtime markers', () => {
      const source = `${MARKERS.RUNTIME_START}
// old runtime content
${MARKERS.RUNTIME_END}
/**
 * @flowWeaver nodeType
 * @input value {NUMBER}
 * @output result {NUMBER}
 */
function nodeA(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } { return { onSuccess: true, onFailure: false, result: value }; }

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

      expect(result.code).toContain(MARKERS.RUNTIME_START);
      // Old runtime should be replaced
      expect(result.code).not.toContain('// old runtime content');
    });
  });

  describe('hasInPlaceMarkers', () => {
    it('returns true when all markers are present', () => {
      const source = `
${MARKERS.RUNTIME_START}
${MARKERS.RUNTIME_END}
${MARKERS.BODY_START}
${MARKERS.BODY_END}
`;
      expect(hasInPlaceMarkers(source)).toBe(true);
    });

    it('returns false when runtime start marker is missing', () => {
      const source = `
${MARKERS.RUNTIME_END}
${MARKERS.BODY_START}
${MARKERS.BODY_END}
`;
      expect(hasInPlaceMarkers(source)).toBe(false);
    });

    it('returns false when body markers are missing', () => {
      const source = `
${MARKERS.RUNTIME_START}
${MARKERS.RUNTIME_END}
`;
      expect(hasInPlaceMarkers(source)).toBe(false);
    });

    it('returns false for empty source', () => {
      expect(hasInPlaceMarkers('')).toBe(false);
    });
  });

  describe('stripGeneratedSections', () => {
    it('removes runtime section between markers', () => {
      const source = `some code before
${MARKERS.RUNTIME_START}
// generated runtime
${MARKERS.RUNTIME_END}
some code after`;

      const result = stripGeneratedSections(source);
      expect(result).not.toContain('// generated runtime');
      expect(result).toContain('some code after');
    });

    it('replaces body section with throw placeholder', () => {
      const source = `function test() {
  ${MARKERS.BODY_START}
  // generated body
  ${MARKERS.BODY_END}
}`;

      const result = stripGeneratedSections(source);
      expect(result).not.toContain('// generated body');
      expect(result).toContain("throw new Error('Not implemented');");
    });

    it('handles multiple body sections in multi-workflow files', () => {
      const source = `function wf1() {
  ${MARKERS.BODY_START}
  // body 1
  ${MARKERS.BODY_END}
}
function wf2() {
  ${MARKERS.BODY_START}
  // body 2
  ${MARKERS.BODY_END}
}`;

      const result = stripGeneratedSections(source);
      expect(result).not.toContain('// body 1');
      expect(result).not.toContain('// body 2');
      const throwCount = (result.match(/throw new Error/g) || []).length;
      expect(throwCount).toBe(2);
    });

    it('returns source unchanged when no markers exist', () => {
      const source = 'function test() { return 42; }';
      const result = stripGeneratedSections(source);
      expect(result).toBe(source);
    });
  });

  describe('no-change detection', () => {
    it('reports hasChanges=false when re-generating identical output', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST();

      // First pass generates changes
      const first = generateInPlace(source, ast);
      expect(first.hasChanges).toBe(true);

      // Second pass on the generated output should detect no changes
      const second = generateInPlace(first.code, ast);
      expect(second.hasChanges).toBe(false);
      expect(second.code).toBe(first.code);
    });
  });

  describe('workflow options round-trip', () => {
    it('emits @strictTypes and @autoConnect when set', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({
        options: { strictTypes: true, autoConnect: true },
      });
      const result = generateInPlace(source, ast, { skipParamReturns: true });

      expect(result.code).toContain('@strictTypes');
      expect(result.code).toContain('@autoConnect');
    });

    it('emits @trigger when trigger option is set', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({
        options: { trigger: { event: 'user.created' } },
      });
      const result = generateInPlace(source, ast, { skipParamReturns: true });

      expect(result.code).toContain('@trigger');
      expect(result.code).toContain('event="user.created"');
    });

    it('emits @cancelOn when cancelOn option is set', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({
        options: { cancelOn: { event: 'user.deleted', match: 'id', timeout: '30s' } },
      });
      const result = generateInPlace(source, ast, { skipParamReturns: true });

      expect(result.code).toContain('@cancelOn');
      expect(result.code).toContain('event="user.deleted"');
      expect(result.code).toContain('match="id"');
      expect(result.code).toContain('timeout="30s"');
    });

    it('emits @retries when retries option is set', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({
        options: { retries: 3 },
      });
      const result = generateInPlace(source, ast, { skipParamReturns: true });

      expect(result.code).toContain('@retries 3');
    });

    it('emits @timeout when timeout option is set', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({
        options: { timeout: '5m' },
      });
      const result = generateInPlace(source, ast, { skipParamReturns: true });

      expect(result.code).toContain('@timeout "5m"');
    });

    it('emits @throttle when throttle option is set', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({
        options: { throttle: { limit: 10, period: '1m' } },
      });
      const result = generateInPlace(source, ast, { skipParamReturns: true });

      expect(result.code).toContain('@throttle limit=10');
      expect(result.code).toContain('period="1m"');
    });

    it('skips connections when autoConnect is true', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({
        options: { autoConnect: true },
      });
      const result = generateInPlace(source, ast, { skipParamReturns: true });

      expect(result.code).not.toContain('@connect');
    });
  });

  describe('workflow name vs functionName', () => {
    it('emits @name tag when name differs from functionName', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({
        name: 'My Workflow',
        functionName: 'myWorkflow',
      });
      const result = generateInPlace(source, ast, { skipParamReturns: true });

      expect(result.code).toContain('@name My Workflow');
    });

    it('omits @name tag when name matches functionName', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({
        name: 'myWorkflow',
        functionName: 'myWorkflow',
      });
      const result = generateInPlace(source, ast, { skipParamReturns: true });

      // Should NOT have @name in the workflow JSDoc (may have @name in nodeType)
      const workflowJSDocMatch = result.code.match(/\* @flowWeaver workflow[\s\S]*?\*\//);
      expect(workflowJSDocMatch).toBeTruthy();
      expect(workflowJSDocMatch![0]).not.toContain('@name');
    });
  });

  describe('workflow description', () => {
    it('emits description in workflow JSDoc when present', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({
        description: 'Processes user data in batch',
      });
      const result = generateInPlace(source, ast, { skipParamReturns: true });

      expect(result.code).toContain('Processes user data in batch');
    });
  });

  describe('connection scope suffixes', () => {
    it('emits scope suffix on connections with scopes', () => {
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({
        connections: [
          { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
          { type: 'Connection', from: { node: 'a', port: 'result', scope: 'iterate' }, to: { node: 'Exit', port: 'onSuccess' } },
        ],
      });
      const result = generateInPlace(source, ast, { skipParamReturns: true });

      expect(result.code).toContain('a.result:iterate -> Exit.onSuccess');
    });
  });

  describe('nodeType description and expression', () => {
    it('emits description in nodeType JSDoc', () => {
      const nodeA = makeNodeType('nodeA', {
        description: 'Adds two numbers together',
      });
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({ nodeTypes: [nodeA] });
      const result = generateInPlace(source, ast);

      expect(result.code).toContain('Adds two numbers together');
    });

    it('emits @expression tag for expression node types', () => {
      const nodeA = makeNodeType('nodeA', {
        expression: true,
      });
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({ nodeTypes: [nodeA] });
      const result = generateInPlace(source, ast);

      expect(result.code).toContain('@expression');
    });
  });

  describe('nodeType visual annotations', () => {
    it('emits @color and @icon tags', () => {
      const nodeA = makeNodeType('nodeA', {
        visuals: { color: '#ff0000', icon: 'bolt' },
      });
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({ nodeTypes: [nodeA] });
      const result = generateInPlace(source, ast);

      expect(result.code).toContain('@color #ff0000');
      expect(result.code).toContain('@icon bolt');
    });

    it('emits @tag with and without tooltip', () => {
      const nodeA = makeNodeType('nodeA', {
        visuals: {
          tags: [
            { label: 'async', tooltip: 'Runs asynchronously' },
            { label: 'pure' },
          ],
        },
      });
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({ nodeTypes: [nodeA] });
      const result = generateInPlace(source, ast);

      expect(result.code).toContain('@tag async "Runs asynchronously"');
      expect(result.code).toContain('@tag pure');
    });
  });

  describe('nodeType scope and pullExecution', () => {
    it('emits @scope tag on nodeType JSDoc', () => {
      const nodeA = makeNodeType('nodeA', {
        scope: 'iterate',
      });
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({ nodeTypes: [nodeA] });
      const result = generateInPlace(source, ast);

      expect(result.code).toContain('@scope iterate');
    });

    it('emits @pullExecution tag when defaultConfig has pullExecution', () => {
      const nodeA = makeNodeType('nodeA', {
        defaultConfig: { pullExecution: { triggerPort: 'onSuccess' } },
      });
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({ nodeTypes: [nodeA] });
      const result = generateInPlace(source, ast);

      expect(result.code).toContain('@pullExecution onSuccess');
    });
  });

  describe('nodeType label', () => {
    it('emits @label tag when present', () => {
      const nodeA = makeNodeType('nodeA', {
        label: 'Add Numbers',
      });
      const source = makeSourceWithNodeType();
      const ast = makeMinimalAST({ nodeTypes: [nodeA] });
      const result = generateInPlace(source, ast);

      expect(result.code).toContain('@label Add Numbers');
    });
  });
});
