import { generateInPlace, hasInPlaceMarkers, MARKERS, type InPlaceGenerateOptions } from '../../src/api/generate-in-place';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';
import { createMultiInputNodeType, createNodeInstance } from '../helpers/test-fixtures';
import { parser } from '../../src/parser';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Test-specific type for node types with extra properties used in tests
type TestNodeType = TNodeTypeAST & {
  code?: string;
  functionText?: string;
  ports?: Array<{
    name: string;
    type?: string;
    direction: string;
    defaultLabel?: string;
    defaultOrder?: number;
    failure?: boolean;
    reference?: string;
  }>;
  portConfigs?: unknown[];
  synchronicity?: string;
  defaultLabel?: string;
  category?: string;
  variant?: string;
  inputs?: Record<string, unknown> | Array<{ name: string; typeName: string }>;
  outputs?: Record<string, unknown> | Array<{ name: string; typeName: string }>;
};

describe('In-Place Generation', () => {
  const createSimpleAST = (): TWorkflowAST => ({
    type: 'Workflow',
    functionName: 'calculate',
    name: 'calculate',
    description: 'Test workflow',
    sourceFile: 'test.ts',
    nodeTypes: [createMultiInputNodeType('add', 'add')],
    instances: [createNodeInstance('adder', 'add', { x: 200, y: 100 })],
    connections: [
      { type: 'Connection', from: { node: 'Start', port: 'a' }, to: { node: 'adder', port: 'a' } },
      { type: 'Connection', from: { node: 'Start', port: 'b' }, to: { node: 'adder', port: 'b' } },
      {
        type: 'Connection',
        from: { node: 'adder', port: 'result' },
        to: { node: 'Exit', port: 'result' },
      },
    ],
    scopes: {},
    startPorts: {
      a: { dataType: 'NUMBER' },
      b: { dataType: 'NUMBER' },
    },
    exitPorts: {
      result: { dataType: 'NUMBER' },
    },
    imports: [],
    ui: {
      startNode: { x: 0, y: 100 },
      exitNode: { x: 400, y: 100 },
    },
  });

  describe('generateInPlace', () => {
    it('should insert runtime markers when not present', () => {
      const sourceCode = `/**
 * @flowWeaver workflow
 * @node adder add
 */
export async function calculate(execute: boolean, params: { a: number; b: number }) {
  throw new Error('Not implemented');
}`;

      const result = generateInPlace(sourceCode, createSimpleAST());

      expect(result.hasChanges).toBe(true);
      expect(result.code).toContain(MARKERS.RUNTIME_START);
      expect(result.code).toContain(MARKERS.RUNTIME_END);
    });

    it('should insert body markers when not present', () => {
      const sourceCode = `/**
 * @flowWeaver workflow
 * @node adder add
 */
export async function calculate(execute: boolean, params: { a: number; b: number }) {
  throw new Error('Not implemented');
}`;

      const result = generateInPlace(sourceCode, createSimpleAST());

      expect(result.hasChanges).toBe(true);
      expect(result.code).toContain(MARKERS.BODY_START);
      expect(result.code).toContain(MARKERS.BODY_END);
    });

    it('should generate execution context initialization', () => {
      const sourceCode = `/**
 * @flowWeaver workflow
 * @node adder add
 */
export async function calculate(execute: boolean, params: { a: number; b: number }) {
  throw new Error('Not implemented');
}`;

      const result = generateInPlace(sourceCode, createSimpleAST());

      expect(result.code).toContain('GeneratedExecutionContext');
    });

    it('should update JSDoc annotations', () => {
      const sourceCode = `/**
 * @flowWeaver workflow
 */
export async function calculate(execute: boolean, params: { a: number; b: number }) {
  throw new Error('Not implemented');
}`;

      const result = generateInPlace(sourceCode, createSimpleAST());

      expect(result.hasChanges).toBe(true);
      expect(result.code).toContain('@node adder add');
      expect(result.code).toContain('@connect Start.a -> adder.a');
      expect(result.code).toContain('@position Start 0 100');
    });

    it('should replace content between existing markers', () => {
      const sourceCode = `// @flow-weaver-runtime-start
// old runtime
// @flow-weaver-runtime-end

/**
 * @flowWeaver workflow
 * @node adder add
 */
export async function calculate(execute: boolean, params: { a: number; b: number }) {
  // @flow-weaver-body-start
  throw new Error('old body');
  // @flow-weaver-body-end
}`;

      const result = generateInPlace(sourceCode, createSimpleAST());

      // Should have replaced content
      expect(result.code).not.toContain('old runtime');
      expect(result.code).not.toContain('old body');
      expect(result.code).toContain('GeneratedExecutionContext');
    });

    it('should preserve node type functions', () => {
      const sourceCode = `/**
 * @flowWeaver nodeType
 */
function add(execute: boolean, a: number, b: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: a + b };
}

/**
 * @flowWeaver workflow
 * @node adder add
 */
export async function calculate(execute: boolean, params: { a: number; b: number }) {
  throw new Error('Not implemented');
}`;

      const result = generateInPlace(sourceCode, createSimpleAST());

      // Node type function should be preserved
      expect(result.code).toContain('function add(execute: boolean, a: number, b: number)');
      expect(result.code).toContain('return { onSuccess: true, onFailure: false, result: a + b }');
    });

    it('should generate production code without debug client', () => {
      const sourceCode = `/**
 * @flowWeaver workflow
 * @node adder add
 */
export async function calculate(execute: boolean, params: { a: number; b: number }) {
  throw new Error('Not implemented');
}`;

      const result = generateInPlace(sourceCode, createSimpleAST(), { production: true });

      // Production mode should not have debug client
      expect(result.code).not.toContain('FLOW_WEAVER_DEBUG');
      expect(result.code).not.toContain('createFlowWeaverDebugClient');
    });

    it('should use typeof check for debugger parameter (regression test)', () => {
      // This test ensures generated code works when function signature lacks __flowWeaverDebugger__ param
      // Bug: Previously generated `__flowWeaverDebugger__ || (...)` which fails if param not in signature
      // Fix: Generate `typeof __flowWeaverDebugger__ !== 'undefined' ? __flowWeaverDebugger__ : (...)`
      const sourceCode = `/**
 * @flowWeaver workflow
 * @node adder add
 */
export async function calculate(execute: boolean, params: { a: number; b: number }) {
  throw new Error('Not implemented');
}`;

      const result = generateInPlace(sourceCode, createSimpleAST());

      // Should use typeof check, not direct reference
      expect(result.code).toContain("typeof __flowWeaverDebugger__ !== 'undefined'");
      // Should NOT have direct reference without typeof check
      expect(result.code).not.toMatch(/= __flowWeaverDebugger__ \|\|/);
    });

    it('should INSERT new node type function when it does not exist', () => {
      // Node type exists in AST but function doesn't exist in source
      const sourceCode = `/**
 * @flowWeaver workflow
 * @node adder add
 */
export async function calculate(execute: boolean, params: { a: number; b: number }) {
  throw new Error('Not implemented');
}`;

      // Create AST with a NEW node type that has function code
      const ast = createSimpleAST();
      (ast.nodeTypes[0] as TestNodeType).code = `/**
 * Adds two numbers
 * @flowWeaver nodeType
 */
function add(execute: boolean, a: number, b: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: a + b };
}`;

      const result = generateInPlace(sourceCode, ast);

      expect(result.hasChanges).toBe(true);
      // The new function should be inserted BEFORE the workflow function
      expect(result.code).toContain('function add(execute: boolean');
      // The workflow function should still exist
      expect(result.code).toContain('export async function calculate');
      // The new function should appear before the workflow
      const addIndex = result.code.indexOf('function add');
      const calculateIndex = result.code.indexOf('export async function calculate');
      expect(addIndex).toBeLessThan(calculateIndex);
    });

    it('should INSERT node type function using ports array format', () => {
      const sourceCode = `/**
 * @flowWeaver workflow
 */
export async function myWorkflow(execute: boolean) {
  throw new Error('Not implemented');
}`;

      // Create AST with node type using ports array (UI format)
      const ast: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'myWorkflow',
        name: 'myWorkflow',
        sourceFile: 'test.ts',
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'double',
            functionName: 'double',
            inputs: {}, // Empty - using ports array instead
            outputs: {},
            hasSuccessPort: true,
            hasFailurePort: true,
            executeWhen: 'CONJUNCTION',
            isAsync: false,
            ports: [
              {
                name: 'execute',
                type: 'STEP',
                direction: 'INPUT',
                defaultLabel: 'Execute',
                defaultOrder: 0,
              },
              {
                name: 'x',
                type: 'NUMBER',
                direction: 'INPUT',
                defaultLabel: 'X Value',
                defaultOrder: 1,
              },
              {
                name: 'onSuccess',
                type: 'STEP',
                direction: 'OUTPUT',
                defaultLabel: 'On Success',
                defaultOrder: 2,
              },
              {
                name: 'result',
                type: 'NUMBER',
                direction: 'OUTPUT',
                defaultLabel: 'Result',
                defaultOrder: 3,
              },
              {
                name: 'onFailure',
                type: 'STEP',
                direction: 'OUTPUT',
                defaultLabel: 'On Failure',
                defaultOrder: 4,
                failure: true,
              },
            ],
            code: `function double(execute: boolean, x: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: x * 2 };
}`,
          } as TestNodeType,
        ],
        instances: [],
        connections: [],
        scopes: {},
        startPorts: {},
        exitPorts: {},
        imports: [],
      };

      const result = generateInPlace(sourceCode, ast);

      expect(result.hasChanges).toBe(true);
      // Function should be inserted
      expect(result.code).toContain('function double(execute: boolean, x: number)');
      // JSDoc should include the input port (not mandatory ports like execute)
      expect(result.code).toContain('@input');
      expect(result.code).toContain('X Value');
    });

    it('should RENAME function when code has different name than functionName (UI creates with generated ID)', () => {
      // This simulates the real scenario: user writes "function myNode" in editor
      // but the nodeType.functionName is a generated ID like "abc123xyz"
      const sourceCode = `/**
 * @flowWeaver workflow
 */
export async function myWorkflow(execute: boolean) {
  throw new Error('Not implemented');
}`;

      const generatedId = 'abc123xyz456';
      const ast: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'myWorkflow',
        name: 'myWorkflow',
        sourceFile: 'test.ts',
        nodeTypes: [
          {
            type: 'NodeType',
            name: generatedId,
            functionName: generatedId, // Generated ID
            inputs: {},
            outputs: {},
            hasSuccessPort: true,
            hasFailurePort: true,
            executeWhen: 'CONJUNCTION',
            isAsync: false,
            ports: [
              {
                name: 'execute',
                type: 'STEP',
                direction: 'INPUT',
                defaultLabel: 'Execute',
                defaultOrder: 0,
              },
              {
                name: 'value',
                type: 'NUMBER',
                direction: 'INPUT',
                defaultLabel: 'Value',
                defaultOrder: 1,
              },
              {
                name: 'onSuccess',
                type: 'STEP',
                direction: 'OUTPUT',
                defaultLabel: 'On Success',
                defaultOrder: 2,
              },
              {
                name: 'result',
                type: 'NUMBER',
                direction: 'OUTPUT',
                defaultLabel: 'Result',
                defaultOrder: 3,
              },
            ],
            // Code has "myNode" as the function name - different from functionName!
            code: `/**
 * @flowWeaver nodeType
 * @label My Custom Node
 */
function myNode(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * 2 };
}`,
          } as TestNodeType,
        ],
        instances: [],
        connections: [],
        scopes: {},
        startPorts: {},
        exitPorts: {},
        imports: [],
      };

      const result = generateInPlace(sourceCode, ast);

      expect(result.hasChanges).toBe(true);
      // Function should be renamed to the generated ID
      expect(result.code).toContain(`function ${generatedId}(`);
      // Original name should NOT appear
      expect(result.code).not.toContain('function myNode(');
      // Function body should be preserved
      expect(result.code).toContain('value * 2');
    });

    it('should serialize node instance labels to @node tag [label: ...] attribute', () => {
      const sourceCode = `/**
 * @flowWeaver workflow
 * @node doubler1 double
 */
export async function myWorkflow(execute: boolean) {
  throw new Error('Not implemented');
}`;

      const ast: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'myWorkflow',
        name: 'myWorkflow',
        sourceFile: 'test.ts',
        nodeTypes: [],
        instances: [
          {
            type: 'NodeInstance',
            id: 'doubler1',
            nodeType: 'double',
            config: {
              label: 'My Custom Label',
              x: 100,
              y: 100,
            },
          },
          {
            type: 'NodeInstance',
            id: 'doubler2',
            nodeType: 'double',
            config: {
              label: 'Label with "quotes"',
              x: 200,
              y: 100,
            },
          },
          {
            type: 'NodeInstance',
            id: 'doubler3', // No label - should NOT have [label: ...]
            nodeType: 'double',
            config: {
              x: 300,
              y: 100,
            },
          },
        ],
        connections: [],
        scopes: {},
        startPorts: {},
        exitPorts: {},
        imports: [],
      };

      const result = generateInPlace(sourceCode, ast);

      expect(result.hasChanges).toBe(true);
      // Should have label attribute for doubler1
      expect(result.code).toContain('@node doubler1 double [label: "My Custom Label"]');
      // Should have escaped quotes for doubler2
      expect(result.code).toContain('@node doubler2 double [label: "Label with \\"quotes\\""]');
      // Should NOT have label attribute for doubler3 (no label set)
      expect(result.code).toMatch(/@node doubler3 double(?!\s*\[label)/);
    });

    it('should serialize port labels to @node tag [portLabel: ...] attribute', () => {
      const sourceCode = `/**
 * @flowWeaver workflow
 * @node myNode MyType
 */
export async function myWorkflow(execute: boolean) {
  throw new Error('Not implemented');
}`;

      const ast: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'myWorkflow',
        name: 'myWorkflow',
        sourceFile: 'test.ts',
        nodeTypes: [],
        instances: [
          {
            type: 'NodeInstance',
            id: 'myNode',
            nodeType: 'MyType',
            config: {
              x: 100,
              y: 100,
              portConfigs: [
                {
                  portName: 'input',
                  direction: 'INPUT',
                  label: 'Custom Input Label',
                },
                {
                  portName: 'output',
                  direction: 'OUTPUT',
                  label: 'Label with "quotes"',
                },
              ],
            },
          },
        ],
        connections: [],
        scopes: {},
        startPorts: {},
        exitPorts: {},
        imports: [],
      };

      const result = generateInPlace(sourceCode, ast);

      expect(result.hasChanges).toBe(true);
      // Should have portLabel attribute with both port labels
      expect(result.code).toContain(
        '[portLabel: input="Custom Input Label", output="Label with \\"quotes\\""]'
      );
    });

    it('should serialize port constant expressions to @node tag [expr: ...] attribute', () => {
      const sourceCode = `/**
 * @flowWeaver workflow
 * @node calc double
 */
export async function myWorkflow(execute: boolean) {
  throw new Error('Not implemented');
}`;

      const ast: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'myWorkflow',
        name: 'myWorkflow',
        sourceFile: 'test.ts',
        nodeTypes: [],
        instances: [
          {
            type: 'NodeInstance',
            id: 'calc',
            nodeType: 'double',
            config: {
              x: 100,
              y: 100,
              portConfigs: [
                {
                  portName: 'value',
                  direction: 'INPUT',
                  expression: '5',
                },
              ],
            },
          },
          {
            type: 'NodeInstance',
            id: 'calc2',
            nodeType: 'double',
            config: {
              x: 200,
              y: 100,
              portConfigs: [
                {
                  portName: 'x',
                  direction: 'INPUT',
                  expression: '(ctx) => ctx.a + "test"',
                },
              ],
            },
          },
        ],
        connections: [],
        scopes: {},
        startPorts: {},
        exitPorts: {},
        imports: [],
      };

      const result = generateInPlace(sourceCode, ast);

      expect(result.hasChanges).toBe(true);
      // Should have expr attribute for calc
      expect(result.code).toContain('@node calc double [expr: value="5"]');
      // Should have escaped quotes for calc2
      expect(result.code).toContain('@node calc2 double [expr: x="(ctx) => ctx.a + \\"test\\""]');
    });

    it('should update JSDoc for non-exported workflow functions', () => {
      // Bug fix: replaceWorkflowJSDoc was requiring export keyword
      const sourceCode = `/**
 * @flowWeaver workflow
 * @node calc double [expr: value="20"]
 */
function myWorkflow(execute: boolean) {
  throw new Error('Not implemented');
}`;

      const ast: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'myWorkflow',
        name: 'myWorkflow',
        sourceFile: 'test.ts',
        nodeTypes: [],
        instances: [
          {
            type: 'NodeInstance',
            id: 'calc',
            nodeType: 'double',
            config: {
              x: 100,
              y: 100,
              portConfigs: [
                {
                  portName: 'value',
                  direction: 'INPUT',
                  expression: '20',
                },
                {
                  portName: 'banana',
                  direction: 'INPUT',
                  expression: '15',
                },
              ],
            },
          },
        ],
        connections: [],
        scopes: {},
        startPorts: {},
        exitPorts: {},
        imports: [],
      };

      const result = generateInPlace(sourceCode, ast);

      expect(result.hasChanges).toBe(true);
      // Should update JSDoc even for non-exported function
      expect(result.code).toContain('[expr: value="20", banana="15"]');
      // CRITICAL: Should NOT add export keyword to non-exported function
      expect(result.code).not.toContain('export function myWorkflow');
      expect(result.code).toContain('function myWorkflow');
    });

    it('should preserve export keyword when updating exported workflow JSDoc', () => {
      // Ensure exported functions stay exported after JSDoc update
      const sourceCode = `/**
 * @flowWeaver workflow
 * @node calc double [expr: value="20"]
 */
export function myWorkflow(execute: boolean) {
  throw new Error('Not implemented');
}`;

      const ast: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'myWorkflow',
        name: 'myWorkflow',
        sourceFile: 'test.ts',
        nodeTypes: [],
        instances: [
          {
            type: 'NodeInstance',
            id: 'calc',
            nodeType: 'double',
            config: {
              x: 100,
              y: 100,
              portConfigs: [
                {
                  portName: 'banana',
                  direction: 'INPUT',
                  expression: '15',
                },
              ],
            },
          },
        ],
        connections: [],
        scopes: {},
        startPorts: {},
        exitPorts: {},
        imports: [],
      };

      const result = generateInPlace(sourceCode, ast);

      expect(result.hasChanges).toBe(true);
      // Should update JSDoc
      expect(result.code).toContain('[expr: banana="15"]');
      // CRITICAL: Should preserve export keyword
      expect(result.code).toContain('export function myWorkflow');
    });

    it('should generate function body for non-exported workflow functions', () => {
      // Bug fix: replaceWorkflowFunctionBody was requiring export keyword
      const sourceCode = `/**
 * @flowWeaver workflow
 * @node calc double
 */
function myWorkflow(execute: boolean) {
  return { onSuccess: true, onFailure: false };
}`;

      const ast: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'myWorkflow',
        name: 'myWorkflow',
        sourceFile: 'test.ts',
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'double',
            functionName: 'double',
            inputs: { execute: { dataType: 'STEP' }, value: { dataType: 'NUMBER' } },
            outputs: {
              onSuccess: { dataType: 'STEP' },
              onFailure: { dataType: 'STEP' },
              result: { dataType: 'NUMBER' },
            },
            hasSuccessPort: true,
            hasFailurePort: true,
            executeWhen: 'CONJUNCTION',
            isAsync: false,
          },
        ],
        instances: [
          {
            type: 'NodeInstance',
            id: 'calc',
            nodeType: 'double',
            config: { x: 100, y: 100 },
          },
        ],
        connections: [],
        scopes: {},
        startPorts: {},
        exitPorts: {},
        imports: [],
      };

      const result = generateInPlace(sourceCode, ast);

      expect(result.hasChanges).toBe(true);
      // Should generate body markers for non-exported function
      expect(result.code).toContain(MARKERS.BODY_START);
      expect(result.code).toContain(MARKERS.BODY_END);
      // Should contain execution context code
      expect(result.code).toContain('GeneratedExecutionContext');
      // CRITICAL: Should NOT add export keyword
      expect(result.code).not.toContain('export function myWorkflow');
      expect(result.code).toContain('function myWorkflow');
    });

    it('should detect async for non-exported workflow functions', () => {
      // Bug fix: detectFunctionIsAsync was requiring export keyword
      const sourceCode = `/**
 * @flowWeaver workflow
 * @node calc double
 */
async function myAsyncWorkflow(execute: boolean) {
  return { onSuccess: true, onFailure: false };
}`;

      const ast: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'myAsyncWorkflow',
        name: 'myAsyncWorkflow',
        sourceFile: 'test.ts',
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'double',
            functionName: 'double',
            inputs: { execute: { dataType: 'STEP' }, value: { dataType: 'NUMBER' } },
            outputs: {
              onSuccess: { dataType: 'STEP' },
              onFailure: { dataType: 'STEP' },
              result: { dataType: 'NUMBER' },
            },
            hasSuccessPort: true,
            hasFailurePort: true,
            executeWhen: 'CONJUNCTION',
            isAsync: true,
          },
        ],
        instances: [
          {
            type: 'NodeInstance',
            id: 'calc',
            nodeType: 'double',
            config: { x: 100, y: 100 },
          },
        ],
        connections: [],
        scopes: {},
        startPorts: {},
        exitPorts: {},
        imports: [],
      };

      const result = generateInPlace(sourceCode, ast);

      expect(result.hasChanges).toBe(true);
      // Should generate async code (with await keywords)
      expect(result.code).toContain('await');
      // Should contain async execution context
      expect(result.code).toContain('GeneratedExecutionContext');
    });

    it('should serialize MULTIPLE port expressions including stale/invalid port expressions', () => {
      // This test reproduces the exact bug scenario:
      // - Node has an existing expression for "value" port that NO LONGER exists (stale/invalid)
      // - User adds a new expression for "banana" port (valid)
      // - Both expressions should be serialized, even though "value" is invalid
      const sourceCode = `/**
 * @flowWeaver workflow
 * @node calc double [expr: value="20"]
 */
export async function myWorkflow(execute: boolean) {
  throw new Error('Not implemented');
}`;

      const ast: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'myWorkflow',
        name: 'myWorkflow',
        sourceFile: 'test.ts',
        nodeTypes: [], // No nodeTypes defined - simulates "value" being a stale/invalid port
        instances: [
          {
            type: 'NodeInstance',
            id: 'calc',
            nodeType: 'double',
            config: {
              x: 100,
              y: 100,
              portConfigs: [
                {
                  portName: 'value', // Invalid - this port doesn't exist on nodeType!
                  direction: 'OUTPUT', // Parser assigns OUTPUT for invalid ports
                  expression: '20',
                },
                {
                  portName: 'banana', // Valid port
                  direction: 'INPUT',
                  expression: '15',
                },
              ],
            },
          },
        ],
        connections: [],
        scopes: {},
        startPorts: {},
        exitPorts: {},
        imports: [],
      };

      const result = generateInPlace(sourceCode, ast);

      expect(result.hasChanges).toBe(true);
      // Should have BOTH expressions in expr attribute (even the invalid one)
      expect(result.code).toContain('[expr: value="20", banana="15"]');
    });

    it('should REMOVE orphaned nodeType functions after rename', () => {
      // When a function is renamed, the old version may still exist.
      // This test verifies that orphaned functions (old versions) are cleaned up.
      const sourceCode = `/**
 * @flowWeaver nodeType
 * @label Old Node
 */
function oldOrphanedFunction(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver nodeType
 * @name myStableId
 * @label My Node
 */
function newCorrectFunction(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 */
export async function myWorkflow(execute: boolean) {
  throw new Error('Not implemented');
}`;

      // AST only has the new function - old one should be removed
      const ast: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'myWorkflow',
        name: 'myWorkflow',
        sourceFile: 'test.ts',
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'myStableId',
            functionName: 'newCorrectFunction', // Only this function is valid
            inputs: { value: { dataType: 'NUMBER', label: 'Value' } },
            outputs: { result: { dataType: 'NUMBER', label: 'Result' } },
            hasSuccessPort: true,
            hasFailurePort: true,
            executeWhen: 'CONJUNCTION',
            isAsync: false,
          } as TestNodeType,
        ],
        instances: [],
        connections: [],
        scopes: {},
        startPorts: {},
        exitPorts: {},
        imports: [],
      };

      const result = generateInPlace(sourceCode, ast);

      expect(result.hasChanges).toBe(true);
      // Old orphaned function should be removed
      expect(result.code).not.toContain('function oldOrphanedFunction');
      expect(result.code).not.toContain('Old Node');
      // New correct function should still exist
      expect(result.code).toContain('function newCorrectFunction');
      expect(result.code).toContain('value * 2');
    });

    it('should RENAME function when name differs from functionName (no @name tag in source yet)', () => {
      // This test verifies that when a user renames a function for the FIRST time,
      // the system can still find it by using nodeType.name as the function name.
      // This handles the case where @name tag doesn't exist yet (created with name === functionName).
      const sourceCode = `/**
 * @flowWeaver nodeType
 * @label My Custom Node
 */
function qehsaqxmfbxprmhi(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 */
export async function myWorkflow(execute: boolean) {
  throw new Error('Not implemented');
}`;

      const ast: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'myWorkflow',
        name: 'myWorkflow',
        sourceFile: 'test.ts',
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'qehsaqxmfbxprmhi', // Stable identifier (same as old function name)
            functionName: 'banana', // User changed function name to "banana"
            inputs: { value: { dataType: 'NUMBER', label: 'Value' } },
            outputs: { result: { dataType: 'NUMBER', label: 'Result' } },
            hasSuccessPort: true,
            hasFailurePort: true,
            executeWhen: 'CONJUNCTION',
            isAsync: false,
          } as TestNodeType,
        ],
        instances: [],
        connections: [],
        scopes: {},
        startPorts: {},
        exitPorts: {},
        imports: [],
      };

      const result = generateInPlace(sourceCode, ast);

      expect(result.hasChanges).toBe(true);
      // Function should be renamed from qehsaqxmfbxprmhi to banana
      expect(result.code).toContain('function banana(');
      // Old function name should NOT appear as function declaration
      expect(result.code).not.toContain('function qehsaqxmfbxprmhi(');
      // The @name tag should now be generated since name !== functionName
      expect(result.code).toContain('@name qehsaqxmfbxprmhi');
      // Function body should be preserved
      expect(result.code).toContain('value * 2');
    });

    it('should RENAME function when found by @name tag but functionName changed', () => {
      // This test verifies that when a user renames a function in the editor,
      // the system correctly finds the function by its @name tag and renames it.
      // @name is the stable identifier that persists across function name changes.
      const sourceCode = `/**
 * @flowWeaver nodeType
 * @name myStableId
 * @label My Custom Node
 */
function oldFunctionName(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 */
export async function myWorkflow(execute: boolean) {
  throw new Error('Not implemented');
}`;

      const ast: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'myWorkflow',
        name: 'myWorkflow',
        sourceFile: 'test.ts',
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'myStableId', // Same as @name tag
            functionName: 'newFunctionName', // User changed function name
            inputs: { value: { dataType: 'NUMBER', label: 'Value' } },
            outputs: { result: { dataType: 'NUMBER', label: 'Result' } },
            hasSuccessPort: true,
            hasFailurePort: true,
            executeWhen: 'CONJUNCTION',
            isAsync: false,
          } as TestNodeType,
        ],
        instances: [],
        connections: [],
        scopes: {},
        startPorts: {},
        exitPorts: {},
        imports: [],
      };

      const result = generateInPlace(sourceCode, ast);

      expect(result.hasChanges).toBe(true);
      // Function should be renamed from oldFunctionName to newFunctionName
      expect(result.code).toContain('function newFunctionName(');
      // Old function name should NOT appear
      expect(result.code).not.toContain('function oldFunctionName(');
      // The @name tag should be preserved to track the stable identity
      expect(result.code).toContain('@name myStableId');
      // Function body should be preserved
      expect(result.code).toContain('value * 2');
    });
  });

  describe('invalid function names', () => {
    it('should throw when function body cannot be replaced (invalid identifier)', () => {
      const ast = createSimpleAST();
      ast.functionName = '02Sequential'; // Invalid: starts with digit

      const sourceCode = `/**
 * @flowWeaver workflow
 * @node calc adder
 * @connect Start.execute -> calc.execute
 */
export function 02Sequential(execute: boolean, params: { a: number }) {
  throw new Error("Compile with: flow-weaver compile <file>");
}`;

      // generateInPlace should throw or report no changes for invalid identifier
      // since TypeScript can't parse function with digit-starting name
      const result = generateInPlace(sourceCode, ast);
      // The function name is invalid JS - TS parser won't find it, so body won't be replaced
      // We expect either an error or no body markers inserted
      expect(result.code).not.toContain(MARKERS.BODY_START);
    });

    it('should succeed for valid function names', () => {
      const ast = createSimpleAST();
      const sourceCode = `/**
 * @flowWeaver workflow
 * @node adder add
 * @connect Start.a -> adder.a
 * @connect Start.b -> adder.b
 * @connect adder.result -> Exit.result
 */
export function calculate(execute: boolean, params: { a: number; b: number }) {
  throw new Error("Compile with: flow-weaver compile <file>");
}`;

      const result = generateInPlace(sourceCode, ast);
      expect(result.hasChanges).toBe(true);
      expect(result.code).toContain(MARKERS.BODY_START);
    });
  });

  describe('hasInPlaceMarkers', () => {
    it('should return true when all markers present', () => {
      const source = `${MARKERS.RUNTIME_START}
stuff
${MARKERS.RUNTIME_END}
more stuff
${MARKERS.BODY_START}
body
${MARKERS.BODY_END}`;

      expect(hasInPlaceMarkers(source)).toBe(true);
    });

    it('should return false when markers missing', () => {
      const source = `function test() {}`;

      expect(hasInPlaceMarkers(source)).toBe(false);
    });

    it('should return false when only some markers present', () => {
      const source = `${MARKERS.RUNTIME_START}
stuff
${MARKERS.RUNTIME_END}`;

      expect(hasInPlaceMarkers(source)).toBe(false);
    });
  });

  describe('Integration: addNodeType + generateInPlace', () => {
    it('should INSERT nodeType function when added via library addNodeType with code property', async () => {
      const { addNodeType } = await import('../../src/api/manipulation/node-types');

      // Source: workflow with NO nodeType functions
      const sourceCode = `/**
 * @flowWeaver workflow
 */
export function myWorkflow(execute: boolean) {
  throw new Error('Not implemented');
}`;

      // Minimal workflow AST (like what parser would return from above source)
      const parsedAST: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'myWorkflow',
        name: 'myWorkflow',
        sourceFile: 'test.ts',
        nodeTypes: [], // No nodeTypes yet
        instances: [],
        connections: [],
        scopes: {},
        startPorts: {},
        exitPorts: {},
        imports: [],
      };

      // New nodeType WITH code (like UI creates)
      const newNodeType: TestNodeType = {
        type: 'NodeType',
        name: 'double',
        functionName: 'double',
        inputs: { value: { dataType: 'NUMBER' } },
        outputs: { result: { dataType: 'NUMBER' } },
        hasSuccessPort: true,
        hasFailurePort: true,
        executeWhen: 'CONJUNCTION',
        isAsync: false,
        code: `/**
 * @flowWeaver nodeType
 * @label Double
 */
function double(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * 2 };
}`,
      };

      // Add nodeType via library (simulating mutateWorkflowFile flow)
      const updatedAST = addNodeType(parsedAST, newNodeType);

      // Verify code is preserved on the added nodeType
      expect((updatedAST.nodeTypes[0] as TestNodeType).code).toBeDefined();
      expect((updatedAST.nodeTypes[0] as TestNodeType).code).toContain('function double');

      // Now generate in place
      const result = generateInPlace(sourceCode, updatedAST);

      // The function MUST be inserted
      expect(result.hasChanges).toBe(true);
      expect(result.code).toContain('function double(');
      expect(result.code).toContain('value * 2');
    });

    it('should INSERT nodeType function with ports array format (exact UI scenario)', async () => {
      const { addNodeType } = await import('../../src/api/manipulation/node-types');

      // Source: workflow with runtime markers (like real workflow files have)
      const sourceCode = `// @flow-weaver-runtime-start
// runtime content
// @flow-weaver-runtime-end

/**
 * @flowWeaver workflow
 * @position Start -150 -250
 * @position Exit 350 -250
 */
export function scopedDemo(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  // @flow-weaver-body-start
  return { onSuccess: true, onFailure: false };
  // @flow-weaver-body-end
}`;

      // Parsed AST (like what parser returns from the file)
      const parsedAST: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'scopedDemo',
        name: 'scopedDemo',
        sourceFile: 'scoped-demo.ts',
        nodeTypes: [], // No nodeTypes in file yet
        instances: [],
        connections: [],
        scopes: {},
        startPorts: {},
        exitPorts: { onSuccess: { dataType: 'BOOLEAN' }, onFailure: { dataType: 'BOOLEAN' } },
        imports: [],
      };

      // NodeType exactly as UI creates it (with ports array, not inputs/outputs)
      const newNodeType: TestNodeType = {
        type: 'NodeType',
        name: 'myNode', // matches functionName since user just created it
        functionName: 'myNode',
        synchronicity: 'BOTH',
        defaultLabel: 'My Node',
        category: 'My Nodes',
        variant: 'FUNCTION',
        description: 'Executes a custom script',
        inputs: {}, // Empty - using ports array
        outputs: {},
        hasSuccessPort: true,
        hasFailurePort: true,
        executeWhen: 'CONJUNCTION',
        isAsync: false,
        ports: [
          {
            name: 'execute',
            type: 'STEP',
            direction: 'INPUT',
            defaultLabel: 'Execute',
            defaultOrder: 0,
          },
          {
            name: 'value',
            type: 'NUMBER',
            direction: 'INPUT',
            defaultLabel: 'Input value to process',
            defaultOrder: 1,
          },
          {
            name: 'onSuccess',
            type: 'STEP',
            direction: 'OUTPUT',
            defaultLabel: 'On Success',
            defaultOrder: 2,
          },
          {
            name: 'result',
            type: 'NUMBER',
            direction: 'OUTPUT',
            defaultLabel: 'Processed result',
            defaultOrder: 3,
          },
          {
            name: 'onFailure',
            type: 'STEP',
            direction: 'OUTPUT',
            defaultLabel: 'On Failure',
            defaultOrder: 4,
            failure: true,
          },
        ],
        portConfigs: [],
        code: `/**
 * Node description here
 *
 * @flowWeaver nodeType
 * @label My Node
 * @input value - Input value to process
 * @output result - Processed result
 */
function myNode(
  execute: boolean,
  value: number
): { onSuccess: boolean; onFailure: boolean; result: number } {
  if (!execute) {
    return { onSuccess: false, onFailure: false, result: 0 };
  }

  try {
    const result = value * 2;
    return { onSuccess: true, onFailure: false, result };
  } catch (error) {
    return { onSuccess: false, onFailure: true, result: 0 };
  }
}`,
      };

      // Add nodeType via library
      const updatedAST = addNodeType(parsedAST, newNodeType);

      // Verify code is preserved
      expect((updatedAST.nodeTypes[0] as TestNodeType).code).toBeDefined();
      expect((updatedAST.nodeTypes[0] as TestNodeType).code).toContain('function myNode');

      // Generate in place
      const result = generateInPlace(sourceCode, updatedAST);

      // The function MUST be inserted
      expect(result.hasChanges).toBe(true);
      expect(result.code).toContain('function myNode(');
      expect(result.code).toContain('value * 2');
      expect(result.code).toContain('@flowWeaver nodeType');

      // Function should be BEFORE the workflow function
      const myNodeIndex = result.code.indexOf('function myNode');
      const scopedDemoIndex = result.code.indexOf('export function scopedDemo');
      expect(myNodeIndex).toBeLessThan(scopedDemoIndex);
      expect(myNodeIndex).toBeGreaterThan(-1);
    });

    it('should insert nodeType with JSDoc that has NO newline before function, and parser should find it', () => {
      // This is the exact bug: UI sends code like "*/function" without newline
      // After insertion, parser must be able to find the nodeType

      const sourceCode = `// @flow-weaver-runtime-start
// Runtime code here
// @flow-weaver-runtime-end
/**
 * @flowWeaver workflow
 * @position Start 0 0
 * @position Exit 300 0
 */
export function myWorkflow(execute: boolean): { onSuccess: boolean } {
  // @flow-weaver-body-start
  return { onSuccess: true };
  // @flow-weaver-body-end
}
`;

      // Code with JSDoc but NO newline before function (the bug scenario)
      const codeWithoutNewline = `/**
 * @flowWeaver nodeType
 * @label My Node
 * @input value
 * @output result
 */function myNode(execute: boolean, value: number): { onSuccess: boolean; result: number } {
  return { onSuccess: true, result: value * 2 };
}`;

      const ast: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'myWorkflow',
        name: 'myWorkflow',
        description: 'Test workflow',
        sourceFile: 'test.ts',
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'myNode',
            functionName: 'myNode',
            label: 'My Node',
            ports: [
              { name: 'value', direction: 'INPUT', reference: 'value' },
              { name: 'result', direction: 'OUTPUT', reference: 'result' },
            ],
            code: codeWithoutNewline, // JSDoc with NO newline before function
          } as TestNodeType,
        ],
        instances: [],
        connections: [],
        scopes: {},
        startPorts: {},
        exitPorts: { onSuccess: { dataType: 'BOOLEAN' } },
        imports: [],
        ui: { startNode: { x: 0, y: 0 }, exitNode: { x: 300, y: 0 } },
      };

      // Step 1: Generate code with the nodeType
      const result = generateInPlace(sourceCode, ast);
      expect(result.hasChanges).toBe(true);
      expect(result.code).toContain('function myNode');
      expect(result.code).toContain('@flowWeaver nodeType');

      // Step 2: Parse the generated code - this is where the bug manifests
      // Write to temp file and parse
      const tempFile = path.join(
        os.tmpdir(),
        `flow-weaver-${process.pid}`,
        'jsdoc-newline-test.ts'
      );
      fs.mkdirSync(path.dirname(tempFile), { recursive: true });
      fs.writeFileSync(tempFile, result.code, 'utf-8');

      try {
        const parsed = parser.parse(tempFile);

        // The parser MUST find the nodeType we just inserted
        expect(parsed.nodeTypes.length).toBeGreaterThanOrEqual(1);
        const myNodeType = parsed.nodeTypes.find((nt) => nt.functionName === 'myNode');
        expect(myNodeType).toBeDefined();
        expect(myNodeType!.name).toBe('myNode');
      } finally {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      }
    });

    it('should NOT delete nodeType function when runtime section is replaced', () => {
      // BUG: When inserting a new nodeType with code property, the function is inserted
      // at a position that gets overwritten by the runtime section replacement.
      // The fix should insert AFTER the runtime-end marker, not before the workflow function.
      const sourceCodeWithRuntime = `// @flow-weaver-runtime-start
// Runtime code here
class GeneratedExecutionContext {}
// @flow-weaver-runtime-end
/**
 * @flowWeaver workflow
 */
export function myWorkflow(execute: boolean): { onSuccess: boolean } {
  // @flow-weaver-body-start
  return { onSuccess: true };
  // @flow-weaver-body-end
}`;

      // AST with a nodeType that has a code property (new nodeType to be inserted)
      const ast: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'myWorkflow',
        name: 'myWorkflow',
        sourceFile: 'test.ts',
        nodeTypes: [
          {
            name: 'myNode',
            functionName: 'myNode',
            label: 'My Node',
            inputs: [{ name: 'value', typeName: 'number' }],
            outputs: [{ name: 'result', typeName: 'number' }],
            // This code property simulates a newly created nodeType from the UI
            code: `/**
 * @flowWeaver nodeType
 * @label My Node
 * @input value [type: number]
 * @output result [type: number]
 */
function myNode(execute: boolean, value: number): { onSuccess: boolean; result: number } {
  return { onSuccess: true, result: value * 2 };
}`,
          } as TestNodeType,
        ],
        instances: [],
        connections: [],
        scopes: {},
        startPorts: {},
        exitPorts: { onSuccess: { dataType: 'BOOLEAN' } },
        imports: [],
        ui: { startNode: { x: 0, y: 0 }, exitNode: { x: 300, y: 0 } },
      };

      const result = generateInPlace(sourceCodeWithRuntime, ast);

      // The generated code MUST contain the nodeType function
      expect(result.code).toContain('function myNode');
      expect(result.code).toContain('@flowWeaver nodeType');
      // And the function should be AFTER the runtime-end marker
      const runtimeEndPos = result.code.indexOf('// @flow-weaver-runtime-end');
      const functionPos = result.code.indexOf('function myNode');
      expect(functionPos).toBeGreaterThan(runtimeEndPos);
    });
  });

  describe('Node Type Description', () => {
    it('should preserve description through parse -> modify -> generate round-trip', () => {
      // This test simulates the real user flow:
      // 1. User has a node type with description
      // 2. User edits something (e.g., label)
      // 3. generateInPlace is called to save
      // 4. Description should be preserved

      const sourceCode = `/**
 * This is my description.
 * It has multiple lines.
 *
 * @flowWeaver nodeType
 * @label My Node
 * @input value
 * @output result
 */
function myNode(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 */
export function myWorkflow(execute: boolean) {
  throw new Error('Not implemented');
}`;

      const tempFile = path.join(
        os.tmpdir(),
        `flow-weaver-${process.pid}`,
        'description-roundtrip.ts'
      );
      fs.mkdirSync(path.dirname(tempFile), { recursive: true });
      fs.writeFileSync(tempFile, sourceCode, 'utf-8');

      try {
        // Step 1: Parse the file
        const parsed = parser.parse(tempFile);
        const nodeType = parsed.nodeTypes[0];

        // Verify description was parsed
        expect(nodeType.description).toBe('This is my description.\nIt has multiple lines.');

        // Step 2: Create AST with same description (simulating save without changes)
        // Use a minimal valid AST structure
        const ast: TWorkflowAST = {
          type: 'Workflow',
          functionName: 'myWorkflow',
          name: 'myWorkflow',
          sourceFile: tempFile,
          nodeTypes: [
            {
              type: 'NodeType',
              name: nodeType.name,
              functionName: nodeType.functionName,
              label: nodeType.label,
              description: nodeType.description, // Keep the same description
              inputs: { value: { dataType: 'NUMBER' } },
              outputs: { result: { dataType: 'NUMBER' } },
              hasSuccessPort: true,
              hasFailurePort: true,
              executeWhen: 'CONJUNCTION',
              isAsync: false,
            } as TestNodeType,
          ],
          instances: [],
          connections: [],
          scopes: {},
          startPorts: {},
          exitPorts: { onSuccess: { dataType: 'BOOLEAN' } },
          imports: [],
        };

        // Step 3: Generate in place
        const result = generateInPlace(sourceCode, ast);

        // Step 4: Verify description is preserved
        expect(result.code).toContain('This is my description.');
        expect(result.code).toContain('It has multiple lines.');
      } finally {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      }
    });

    it('should preserve description in generated JSDoc', () => {
      const sourceCode = `/**
 * This is the original description.
 * @flowWeaver nodeType
 * @label My Node
 * @input value
 * @output result
 */
function myNode(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 */
export function myWorkflow(execute: boolean) {
  throw new Error('Not implemented');
}`;

      const ast: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'myWorkflow',
        name: 'myWorkflow',
        sourceFile: 'test.ts',
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'myNode',
            functionName: 'myNode',
            label: 'My Node',
            description: 'Updated description text.',
            inputs: { value: { dataType: 'NUMBER' } },
            outputs: { result: { dataType: 'NUMBER' } },
            hasSuccessPort: true,
            hasFailurePort: true,
            executeWhen: 'CONJUNCTION',
            isAsync: false,
          } as TestNodeType,
        ],
        instances: [],
        connections: [],
        scopes: {},
        startPorts: {},
        exitPorts: {},
        imports: [],
      };

      const result = generateInPlace(sourceCode, ast);

      expect(result.hasChanges).toBe(true);
      // Description should be in the generated JSDoc
      expect(result.code).toContain('Updated description text.');
      // Old description should be replaced
      expect(result.code).not.toContain('This is the original description.');
    });

    it('should add description to JSDoc when not present before', () => {
      const sourceCode = `/**
 * @flowWeaver nodeType
 * @label My Node
 * @input value
 * @output result
 */
function myNode(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 */
export function myWorkflow(execute: boolean) {
  throw new Error('Not implemented');
}`;

      const ast: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'myWorkflow',
        name: 'myWorkflow',
        sourceFile: 'test.ts',
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'myNode',
            functionName: 'myNode',
            label: 'My Node',
            description: 'New description added.',
            inputs: { value: { dataType: 'NUMBER' } },
            outputs: { result: { dataType: 'NUMBER' } },
            hasSuccessPort: true,
            hasFailurePort: true,
            executeWhen: 'CONJUNCTION',
            isAsync: false,
          } as TestNodeType,
        ],
        instances: [],
        connections: [],
        scopes: {},
        startPorts: {},
        exitPorts: {},
        imports: [],
      };

      const result = generateInPlace(sourceCode, ast);

      expect(result.hasChanges).toBe(true);
      // New description should be in the generated JSDoc
      expect(result.code).toContain('New description added.');
    });
  });

  describe('Node Type Function Body Updates', () => {
    it('should UPDATE existing nodeType function body when functionText changes', () => {
      // This test verifies that when a user edits the function body in the editor,
      // the changes are persisted to the file via generateInPlace.
      const sourceCode = `/**
 * @flowWeaver nodeType
 * @label Double
 * @input value
 * @output result
 */
function double(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 */
export function myWorkflow(execute: boolean) {
  throw new Error('Not implemented');
}`;

      // AST with UPDATED functionText (user changed the return from value*2 to value*3)
      const ast: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'myWorkflow',
        name: 'myWorkflow',
        sourceFile: 'test.ts',
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'double',
            functionName: 'double',
            label: 'Double',
            inputs: { value: { dataType: 'NUMBER' } },
            outputs: { result: { dataType: 'NUMBER' } },
            hasSuccessPort: true,
            hasFailurePort: true,
            executeWhen: 'CONJUNCTION',
            isAsync: false,
            // User changed value * 2 to value * 3
            functionText: `/**
 * @flowWeaver nodeType
 * @label Double
 * @input value
 * @output result
 */
function double(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * 3 };
}`,
          } as TestNodeType,
        ],
        instances: [],
        connections: [],
        scopes: {},
        startPorts: {},
        exitPorts: {},
        imports: [],
      };

      const result = generateInPlace(sourceCode, ast);

      expect(result.hasChanges).toBe(true);
      // The function body should be updated
      expect(result.code).toContain('value * 3');
      // The old function body should NOT be present
      expect(result.code).not.toContain('value * 2');
      // The JSDoc should be preserved
      expect(result.code).toContain('@flowWeaver nodeType');
      expect(result.code).toContain('@label Double');
    });

    it('should UPDATE function body while preserving generated JSDoc annotations', () => {
      // User edits only the function body, JSDoc should be regenerated from AST
      const sourceCode = `/**
 * @flowWeaver nodeType
 * @label Old Label
 * @input value
 */
function myNode(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value + 10 };
}

/**
 * @flowWeaver workflow
 */
export function myWorkflow(execute: boolean) {
  throw new Error('Not implemented');
}`;

      // AST with updated label (from "Old Label" to "New Label") AND updated function body
      const ast: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'myWorkflow',
        name: 'myWorkflow',
        sourceFile: 'test.ts',
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'myNode',
            functionName: 'myNode',
            label: 'New Label', // Label changed in AST
            inputs: { value: { dataType: 'NUMBER' } },
            outputs: { result: { dataType: 'NUMBER' } },
            hasSuccessPort: true,
            hasFailurePort: true,
            executeWhen: 'CONJUNCTION',
            isAsync: false,
            // Function body changed: value + 10 → value + 20
            functionText: `function myNode(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value + 20 };
}`,
          } as TestNodeType,
        ],
        instances: [],
        connections: [],
        scopes: {},
        startPorts: {},
        exitPorts: {},
        imports: [],
      };

      const result = generateInPlace(sourceCode, ast);

      expect(result.hasChanges).toBe(true);
      // Function body should be updated
      expect(result.code).toContain('value + 20');
      expect(result.code).not.toContain('value + 10');
      // JSDoc should be regenerated with new label
      expect(result.code).toContain('@label New Label');
      expect(result.code).not.toContain('Old Label');
    });

    it('should NOT change function when functionText is identical', () => {
      const sourceCode = `/**
 * @flowWeaver nodeType
 * @label My Node
 */
function myNode(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 */
export function myWorkflow(execute: boolean) {
  throw new Error('Not implemented');
}`;

      // AST with same functionText (just whitespace differences)
      const ast: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'myWorkflow',
        name: 'myWorkflow',
        sourceFile: 'test.ts',
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'myNode',
            functionName: 'myNode',
            label: 'My Node',
            inputs: { value: { dataType: 'NUMBER' } },
            outputs: { result: { dataType: 'NUMBER' } },
            hasSuccessPort: true,
            hasFailurePort: true,
            executeWhen: 'CONJUNCTION',
            isAsync: false,
            // Same function body with slight whitespace difference
            functionText: `function myNode(execute: boolean,  value: number) {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}`,
          } as TestNodeType,
        ],
        instances: [],
        connections: [],
        scopes: {},
        startPorts: {},
        exitPorts: {},
        imports: [],
      };

      const result = generateInPlace(sourceCode, ast);

      // Should have changes only due to JSDoc regeneration, not function body
      // The function body should remain unchanged
      expect(result.code).toContain('value * 2');
    });
  });

  describe('F1: Expression Node Result Destructuring', () => {
    it('should destructure expression node result for single data output port', () => {
      // Expression nodes return { result: value } — generated code must use dResult.result, not dResult
      const sourceCode = `/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function doubleIt(value: number): { result: number } {
  return { result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node d doubleIt
 * @connect Start.value -> d.value
 * @connect d.result -> Exit.result
 * @connect Start.execute -> d.execute
 * @connect d.onSuccess -> Exit.onSuccess
 * @param execute [order:0] - Execute
 * @param value [order:1] - Input
 * @returns result [order:0] - Result
 */
export function mathPipeline(execute: boolean, params: { value: number }) {
  throw new Error('Not implemented');
}`;

      const ast: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'mathPipeline',
        name: 'mathPipeline',
        sourceFile: 'test.ts',
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'doubleIt',
            functionName: 'doubleIt',
            expression: true,
            inputs: { value: { dataType: 'NUMBER' } },
            outputs: {
              onSuccess: { dataType: 'STEP' },
              onFailure: { dataType: 'STEP', failure: true },
              result: { dataType: 'NUMBER' },
            },
            hasSuccessPort: true,
            hasFailurePort: true,
            executeWhen: 'CONJUNCTION',
            isAsync: false,
          },
        ],
        instances: [{ type: 'NodeInstance', id: 'd', nodeType: 'doubleIt' }],
        connections: [
          {
            type: 'Connection',
            from: { node: 'Start', port: 'value' },
            to: { node: 'd', port: 'value' },
          },
          {
            type: 'Connection',
            from: { node: 'd', port: 'result' },
            to: { node: 'Exit', port: 'result' },
          },
          {
            type: 'Connection',
            from: { node: 'Start', port: 'execute' },
            to: { node: 'd', port: 'execute' },
          },
          {
            type: 'Connection',
            from: { node: 'd', port: 'onSuccess' },
            to: { node: 'Exit', port: 'onSuccess' },
          },
        ],
        scopes: {},
        startPorts: { value: { dataType: 'NUMBER' } },
        exitPorts: { result: { dataType: 'NUMBER' } },
        imports: [],
      };

      const result = generateInPlace(sourceCode, ast);

      expect(result.hasChanges).toBe(true);
      // Generated code must handle single-port expression: destructure when result is object
      // Should contain the smart destructuring pattern that checks for the port key
      expect(result.code).toContain('dResult_raw.result');
      expect(result.code).toContain("'result' in dResult_raw");
    });
  });

  describe('F2: Async Detection in In-Place Compilation', () => {
    it('should add async keyword when workflow contains async nodes but source is sync', () => {
      const sourceCode = `/**
 * @flowWeaver nodeType
 * @input url
 * @output data
 */
async function fetchData(url: string): Promise<{ data: any }> {
  return { data: url };
}

/**
 * @flowWeaver workflow
 * @node fetcher fetchData
 * @connect Start.url -> fetcher.url
 * @connect fetcher.data -> Exit.data
 * @connect Start.execute -> fetcher.execute
 * @connect fetcher.onSuccess -> Exit.onSuccess
 * @param execute [order:0] - Execute
 * @param url [order:1] - URL
 * @returns data [order:0] - Data
 */
export function asyncPipeline(execute: boolean, params: { url: string }) {
  throw new Error('Not implemented');
}`;

      const ast: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'asyncPipeline',
        name: 'asyncPipeline',
        sourceFile: 'test.ts',
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'fetchData',
            functionName: 'fetchData',
            expression: true,
            inputs: { url: { dataType: 'STRING' } },
            outputs: {
              onSuccess: { dataType: 'STEP' },
              onFailure: { dataType: 'STEP', failure: true },
              data: { dataType: 'ANY' },
            },
            hasSuccessPort: true,
            hasFailurePort: true,
            executeWhen: 'CONJUNCTION',
            isAsync: true,
          },
        ],
        instances: [{ type: 'NodeInstance', id: 'fetcher', nodeType: 'fetchData' }],
        connections: [
          {
            type: 'Connection',
            from: { node: 'Start', port: 'url' },
            to: { node: 'fetcher', port: 'url' },
          },
          {
            type: 'Connection',
            from: { node: 'fetcher', port: 'data' },
            to: { node: 'Exit', port: 'data' },
          },
          {
            type: 'Connection',
            from: { node: 'Start', port: 'execute' },
            to: { node: 'fetcher', port: 'execute' },
          },
          {
            type: 'Connection',
            from: { node: 'fetcher', port: 'onSuccess' },
            to: { node: 'Exit', port: 'onSuccess' },
          },
        ],
        scopes: {},
        startPorts: { url: { dataType: 'STRING' } },
        exitPorts: { data: { dataType: 'ANY' } },
        imports: [],
      };

      const result = generateInPlace(sourceCode, ast);

      expect(result.hasChanges).toBe(true);
      // The function signature must now have async keyword
      expect(result.code).toContain('export async function asyncPipeline');
      // The generated body should use await
      expect(result.code).toContain('await');
      // The execution context should be async
      expect(result.code).toContain('GeneratedExecutionContext(true');
    });

    it('should generate async body even when source already has async keyword', () => {
      const sourceCode = `/**
 * @flowWeaver workflow
 * @node fetcher fetchData
 */
export async function asyncPipeline(execute: boolean, params: { url: string }) {
  throw new Error('Not implemented');
}`;

      const ast: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'asyncPipeline',
        name: 'asyncPipeline',
        sourceFile: 'test.ts',
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'fetchData',
            functionName: 'fetchData',
            expression: true,
            inputs: { url: { dataType: 'STRING' } },
            outputs: {
              onSuccess: { dataType: 'STEP' },
              onFailure: { dataType: 'STEP', failure: true },
              data: { dataType: 'ANY' },
            },
            hasSuccessPort: true,
            hasFailurePort: true,
            executeWhen: 'CONJUNCTION',
            isAsync: true,
          },
        ],
        instances: [{ type: 'NodeInstance', id: 'fetcher', nodeType: 'fetchData' }],
        connections: [
          {
            type: 'Connection',
            from: { node: 'Start', port: 'url' },
            to: { node: 'fetcher', port: 'url' },
          },
          {
            type: 'Connection',
            from: { node: 'fetcher', port: 'data' },
            to: { node: 'Exit', port: 'data' },
          },
          {
            type: 'Connection',
            from: { node: 'Start', port: 'execute' },
            to: { node: 'fetcher', port: 'execute' },
          },
          {
            type: 'Connection',
            from: { node: 'fetcher', port: 'onSuccess' },
            to: { node: 'Exit', port: 'onSuccess' },
          },
        ],
        scopes: {},
        startPorts: { url: { dataType: 'STRING' } },
        exitPorts: { data: { dataType: 'ANY' } },
        imports: [],
      };

      const result = generateInPlace(sourceCode, ast);

      expect(result.hasChanges).toBe(true);
      // Should still have async keyword (no duplication)
      expect(result.code).toContain('export async function asyncPipeline');
      expect(result.code).not.toContain('async async');
      // Should generate async execution context
      expect(result.code).toContain('GeneratedExecutionContext(true');
    });
  });

  describe('F4: Multi-Workflow Compile Preservation', () => {
    it('should NOT remove node types used by other workflows', () => {
      // File has two workflows: mathPipeline uses doubleIt+addTen, negatePipeline uses negate
      // When compiling mathPipeline, negate must NOT be removed
      const sourceCode = `/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function doubleIt(value: number): { result: number } {
  return { result: value * 2 };
}

/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function negate(value: number): { result: number } {
  return { result: -value };
}

/**
 * @flowWeaver workflow
 * @node d doubleIt
 * @connect Start.value -> d.value
 * @connect d.result -> Exit.result
 */
export function mathPipeline(execute: boolean, params: { value: number }) {
  throw new Error('Not implemented');
}

/**
 * @flowWeaver workflow
 * @node n negate
 * @connect Start.value -> n.value
 * @connect n.result -> Exit.result
 */
export function negatePipeline(execute: boolean, params: { value: number }) {
  throw new Error('Not implemented');
}`;

      // AST for mathPipeline (target of compilation)
      const mathAst: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'mathPipeline',
        name: 'mathPipeline',
        sourceFile: 'test.ts',
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'doubleIt',
            functionName: 'doubleIt',
            expression: true,
            inputs: { value: { dataType: 'NUMBER' } },
            outputs: {
              onSuccess: { dataType: 'STEP' },
              onFailure: { dataType: 'STEP', failure: true },
              result: { dataType: 'NUMBER' },
            },
            hasSuccessPort: true,
            hasFailurePort: true,
            executeWhen: 'CONJUNCTION',
            isAsync: false,
          },
        ],
        instances: [{ type: 'NodeInstance', id: 'd', nodeType: 'doubleIt' }],
        connections: [
          {
            type: 'Connection',
            from: { node: 'Start', port: 'value' },
            to: { node: 'd', port: 'value' },
          },
          {
            type: 'Connection',
            from: { node: 'd', port: 'result' },
            to: { node: 'Exit', port: 'result' },
          },
        ],
        scopes: {},
        startPorts: { value: { dataType: 'NUMBER' } },
        exitPorts: { result: { dataType: 'NUMBER' } },
        imports: [],
      };

      // AST for negatePipeline (sibling workflow)
      const negateAst: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'negatePipeline',
        name: 'negatePipeline',
        sourceFile: 'test.ts',
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'negate',
            functionName: 'negate',
            expression: true,
            inputs: { value: { dataType: 'NUMBER' } },
            outputs: {
              onSuccess: { dataType: 'STEP' },
              onFailure: { dataType: 'STEP', failure: true },
              result: { dataType: 'NUMBER' },
            },
            hasSuccessPort: true,
            hasFailurePort: true,
            executeWhen: 'CONJUNCTION',
            isAsync: false,
          },
        ],
        instances: [{ type: 'NodeInstance', id: 'n', nodeType: 'negate' }],
        connections: [
          {
            type: 'Connection',
            from: { node: 'Start', port: 'value' },
            to: { node: 'n', port: 'value' },
          },
          {
            type: 'Connection',
            from: { node: 'n', port: 'result' },
            to: { node: 'Exit', port: 'result' },
          },
        ],
        scopes: {},
        startPorts: { value: { dataType: 'NUMBER' } },
        exitPorts: { result: { dataType: 'NUMBER' } },
        imports: [],
      };

      // Compile mathPipeline with allWorkflows including both
      const result = generateInPlace(sourceCode, mathAst, {
        allWorkflows: [mathAst, negateAst],
      });

      // negate function must NOT be removed
      expect(result.code).toContain('function negate(');
      // doubleIt must still be present
      expect(result.code).toContain('function doubleIt(');
      // negatePipeline function must still be present
      expect(result.code).toContain('function negatePipeline(');
    });

    it('should compile target workflow body without affecting sibling workflow body', () => {
      // Both workflows have body markers — only the target should be updated
      const sourceCode = `/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function doubleIt(value: number): { result: number } {
  return { result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node d doubleIt
 */
export function workflowA(execute: boolean, params: { value: number }) {
  // @flow-weaver-body-start
  throw new Error('old body A');
  // @flow-weaver-body-end
}

/**
 * @flowWeaver workflow
 * @node d2 doubleIt
 */
export function workflowB(execute: boolean, params: { value: number }) {
  // @flow-weaver-body-start
  throw new Error('old body B');
  // @flow-weaver-body-end
}`;

      const astA: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'workflowA',
        name: 'workflowA',
        sourceFile: 'test.ts',
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'doubleIt',
            functionName: 'doubleIt',
            expression: true,
            inputs: { value: { dataType: 'NUMBER' } },
            outputs: {
              onSuccess: { dataType: 'STEP' },
              onFailure: { dataType: 'STEP', failure: true },
              result: { dataType: 'NUMBER' },
            },
            hasSuccessPort: true,
            hasFailurePort: true,
            executeWhen: 'CONJUNCTION',
            isAsync: false,
          },
        ],
        instances: [{ type: 'NodeInstance', id: 'd', nodeType: 'doubleIt' }],
        connections: [
          {
            type: 'Connection',
            from: { node: 'Start', port: 'value' },
            to: { node: 'd', port: 'value' },
          },
          {
            type: 'Connection',
            from: { node: 'd', port: 'result' },
            to: { node: 'Exit', port: 'result' },
          },
        ],
        scopes: {},
        startPorts: { value: { dataType: 'NUMBER' } },
        exitPorts: { result: { dataType: 'NUMBER' } },
        imports: [],
      };

      const astB: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'workflowB',
        name: 'workflowB',
        sourceFile: 'test.ts',
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'doubleIt',
            functionName: 'doubleIt',
            expression: true,
            inputs: { value: { dataType: 'NUMBER' } },
            outputs: {
              onSuccess: { dataType: 'STEP' },
              onFailure: { dataType: 'STEP', failure: true },
              result: { dataType: 'NUMBER' },
            },
            hasSuccessPort: true,
            hasFailurePort: true,
            executeWhen: 'CONJUNCTION',
            isAsync: false,
          },
        ],
        instances: [{ type: 'NodeInstance', id: 'd2', nodeType: 'doubleIt' }],
        connections: [],
        scopes: {},
        startPorts: { value: { dataType: 'NUMBER' } },
        exitPorts: { result: { dataType: 'NUMBER' } },
        imports: [],
      };

      const result = generateInPlace(sourceCode, astA, {
        allWorkflows: [astA, astB],
      });

      // workflowA body should be generated (not 'old body A')
      expect(result.code).toContain('GeneratedExecutionContext');
      expect(result.code).not.toContain('old body A');
      // workflowB body should remain unchanged
      expect(result.code).toContain('old body B');
    });

    it('should not duplicate JSDoc when file has a header comment before the first node type (#35)', () => {
      // When a file starts with a /** file header */ comment, replaceNodeTypeJSDoc was
      // finding the file header as the "JSDoc" to replace (first /** match), leaving the
      // real nodeType JSDoc untouched, resulting in duplicates after runtime insertion.
      const sourceCode = `/**
 * File header comment
 * This is a description of the file, not a node type.
 */

/**
 * @flowWeaver nodeType
 * @expression
 * @input value
 * @output result
 */
function doubleIt(value: number): { result: number } {
  return { result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node d doubleIt
 * @connect Start.value -> d.value
 * @connect d.result -> Exit.result
 * @connect Start.execute -> d.execute
 * @connect d.onSuccess -> Exit.onSuccess
 * @param value
 * @returns result
 */
export function myWorkflow(execute: boolean, params: { value: number }): { onSuccess: boolean; result: number } {
  throw new Error('Not compiled');
}`;

      const ast: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'myWorkflow',
        name: 'myWorkflow',
        sourceFile: 'test.ts',
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'doubleIt',
            functionName: 'doubleIt',
            expression: true,
            inputs: { value: { dataType: 'NUMBER' } },
            outputs: {
              onSuccess: { dataType: 'STEP' },
              onFailure: { dataType: 'STEP', failure: true },
              result: { dataType: 'NUMBER' },
            },
            hasSuccessPort: true,
            hasFailurePort: true,
            executeWhen: 'CONJUNCTION',
            isAsync: false,
          },
        ],
        instances: [{ type: 'NodeInstance', id: 'd', nodeType: 'doubleIt' }],
        connections: [
          {
            type: 'Connection',
            from: { node: 'Start', port: 'value' },
            to: { node: 'd', port: 'value' },
          },
          {
            type: 'Connection',
            from: { node: 'd', port: 'result' },
            to: { node: 'Exit', port: 'result' },
          },
          {
            type: 'Connection',
            from: { node: 'Start', port: 'execute' },
            to: { node: 'd', port: 'execute' },
          },
          {
            type: 'Connection',
            from: { node: 'd', port: 'onSuccess' },
            to: { node: 'Exit', port: 'onSuccess' },
          },
        ],
        scopes: {},
        startPorts: { value: { dataType: 'NUMBER' } },
        exitPorts: { result: { dataType: 'NUMBER' } },
        imports: [],
      };

      const result = generateInPlace(sourceCode, ast);

      // Count occurrences of @flowWeaver nodeType — should be exactly 1
      const nodeTypeMatches = result.code.match(/@flowWeaver nodeType/g) || [];
      expect(nodeTypeMatches.length).toBe(1);

      // The file header comment should still exist
      expect(result.code).toContain('File header comment');

      // There should be exactly one JSDoc before doubleIt
      const doubleItIdx = result.code.indexOf('function doubleIt');
      const beforeDoubleIt = result.code.slice(0, doubleItIdx);
      const jsdocCount = (beforeDoubleIt.match(/\/\*\*/g) || []).length;
      // Should be 2: the file header comment + the nodeType JSDoc (not 3)
      expect(jsdocCount).toBe(2);
    });

    it('should not duplicate JSDoc when parser provides functionText with multiple JSDoc blocks (#35)', () => {
      // The parser's functionText includes ALL leading JSDoc (via getJsDocs()), which may include
      // file headers. The stripping logic must remove ALL leading /** blocks, not just the first one.
      const sourceCode = `/**
 * File header comment
 */

/**
 * @flowWeaver nodeType
 * @expression
 * @input value
 * @output result
 */
function doubleIt(value: number): { result: number } {
  return { result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node d doubleIt
 * @connect Start.value -> d.value
 * @connect d.result -> Exit.result
 * @connect Start.execute -> d.execute
 * @connect d.onSuccess -> Exit.onSuccess
 * @param value
 * @returns result
 */
export function myWorkflow(execute: boolean, params: { value: number }): { onSuccess: boolean; result: number } {
  throw new Error('Not compiled');
}`;

      // Simulate what the parser produces: functionText includes BOTH JSDoc blocks
      const ast: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'myWorkflow',
        name: 'myWorkflow',
        sourceFile: 'test.ts',
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'doubleIt',
            functionName: 'doubleIt',
            expression: true,
            inputs: { value: { dataType: 'NUMBER' } },
            outputs: {
              onSuccess: { dataType: 'STEP' },
              onFailure: { dataType: 'STEP', failure: true },
              result: { dataType: 'NUMBER' },
            },
            hasSuccessPort: true,
            hasFailurePort: true,
            executeWhen: 'CONJUNCTION',
            isAsync: false,
            // Parser provides functionText with ALL leading JSDoc blocks
            functionText: `/**
 * File header comment
 */
/**
 * @flowWeaver nodeType
 * @expression
 * @input value
 * @output result
 */
function doubleIt(value: number): { result: number } {
  return { result: value * 2 };
}`,
          },
        ],
        instances: [{ type: 'NodeInstance', id: 'd', nodeType: 'doubleIt' }],
        connections: [
          {
            type: 'Connection',
            from: { node: 'Start', port: 'value' },
            to: { node: 'd', port: 'value' },
          },
          {
            type: 'Connection',
            from: { node: 'd', port: 'result' },
            to: { node: 'Exit', port: 'result' },
          },
          {
            type: 'Connection',
            from: { node: 'Start', port: 'execute' },
            to: { node: 'd', port: 'execute' },
          },
          {
            type: 'Connection',
            from: { node: 'd', port: 'onSuccess' },
            to: { node: 'Exit', port: 'onSuccess' },
          },
        ],
        scopes: {},
        startPorts: { value: { dataType: 'NUMBER' } },
        exitPorts: { result: { dataType: 'NUMBER' } },
        imports: [],
      };

      const result = generateInPlace(sourceCode, ast);

      // Count occurrences of @flowWeaver nodeType — should be exactly 1
      const nodeTypeMatches = result.code.match(/@flowWeaver nodeType/g) || [];
      expect(nodeTypeMatches.length).toBe(1);

      // The file header comment should still exist
      expect(result.code).toContain('File header comment');
    });

    it('should clean up stale duplicate @flowWeaver JSDoc blocks from previous buggy compilations (#35)', () => {
      // After the previous bug created a duplicate, recompiling should remove the stale one
      const sourceWithDuplicate = `
// @flow-weaver-runtime-start
// runtime code
// @flow-weaver-runtime-end
/**
 * @flowWeaver nodeType
 * @expression
 * @input value [order:1] - stale duplicate
 * @output result [order:2] - stale duplicate
 */
/**
 * @flowWeaver nodeType
 * @expression
 * @input value - Number to double
 * @output result - Doubled result
 */
function doubleIt(value: number): { result: number } {
  return { result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node d doubleIt
 * @connect Start.value -> d.value
 * @connect d.result -> Exit.result
 * @connect Start.execute -> d.execute
 * @connect d.onSuccess -> Exit.onSuccess
 * @param value
 * @returns result
 */
export function myWorkflow(execute: boolean, params: { value: number }): { onSuccess: boolean; result: number } {
  throw new Error('Not compiled');
}`;

      const ast: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'myWorkflow',
        name: 'myWorkflow',
        sourceFile: 'test.ts',
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'doubleIt',
            functionName: 'doubleIt',
            expression: true,
            inputs: { value: { dataType: 'NUMBER' } },
            outputs: {
              onSuccess: { dataType: 'STEP' },
              onFailure: { dataType: 'STEP', failure: true },
              result: { dataType: 'NUMBER' },
            },
            hasSuccessPort: true,
            hasFailurePort: true,
            executeWhen: 'CONJUNCTION',
            isAsync: false,
          },
        ],
        instances: [{ type: 'NodeInstance', id: 'd', nodeType: 'doubleIt' }],
        connections: [
          {
            type: 'Connection',
            from: { node: 'Start', port: 'value' },
            to: { node: 'd', port: 'value' },
          },
          {
            type: 'Connection',
            from: { node: 'd', port: 'result' },
            to: { node: 'Exit', port: 'result' },
          },
          {
            type: 'Connection',
            from: { node: 'Start', port: 'execute' },
            to: { node: 'd', port: 'execute' },
          },
          {
            type: 'Connection',
            from: { node: 'd', port: 'onSuccess' },
            to: { node: 'Exit', port: 'onSuccess' },
          },
        ],
        scopes: {},
        startPorts: { value: { dataType: 'NUMBER' } },
        exitPorts: { result: { dataType: 'NUMBER' } },
        imports: [],
      };

      const result = generateInPlace(sourceWithDuplicate, ast);

      // Should have exactly 1 @flowWeaver nodeType after cleanup
      const nodeTypeMatches = result.code.match(/@flowWeaver nodeType/g) || [];
      expect(nodeTypeMatches.length).toBe(1);

      // The stale duplicate should be gone
      expect(result.code).not.toContain('stale duplicate');
    });

    it('should NOT rewrite sibling workflow JSDoc to @flowWeaver nodeType', () => {
      // When the parser includes sibling workflows as nodeTypes with variant IMPORTED_WORKFLOW,
      // replaceNodeTypeJSDoc must skip them — otherwise it rewrites @flowWeaver workflow to @flowWeaver nodeType
      const sourceCode = `/**
 * @flowWeaver nodeType
 * @expression
 * @input value
 * @output result
 */
function negate(value: number): { result: number } {
  return { result: -value };
}

/**
 * @flowWeaver workflow
 * @node d doubleIt
 * @connect Start.value -> d.value
 * @connect d.result -> Exit.result
 */
export function mathPipeline(execute: boolean, params: { value: number }) {
  throw new Error('Not implemented');
}

/**
 * @flowWeaver workflow
 * @node n negate
 * @connect Start.value -> n.value
 * @connect n.result -> Exit.result
 */
export function negatePipeline(execute: boolean, params: { value: number }) {
  throw new Error('Not implemented');
}`;

      // AST for negatePipeline — parser includes mathPipeline as IMPORTED_WORKFLOW variant
      const negateAst: TWorkflowAST = {
        type: 'Workflow',
        functionName: 'negatePipeline',
        name: 'negatePipeline',
        sourceFile: 'test.ts',
        nodeTypes: [
          {
            type: 'NodeType',
            name: 'negate',
            functionName: 'negate',
            expression: true,
            inputs: { value: { dataType: 'NUMBER' } },
            outputs: {
              onSuccess: { dataType: 'STEP' },
              onFailure: { dataType: 'STEP', failure: true },
              result: { dataType: 'NUMBER' },
            },
            hasSuccessPort: true,
            hasFailurePort: true,
            executeWhen: 'CONJUNCTION',
            isAsync: false,
          },
          {
            // mathPipeline appears as a nodeType with variant IMPORTED_WORKFLOW
            type: 'NodeType',
            name: 'mathPipeline',
            functionName: 'mathPipeline',
            variant: 'IMPORTED_WORKFLOW',
            inputs: { value: { dataType: 'NUMBER' } },
            outputs: {
              onSuccess: { dataType: 'STEP' },
              onFailure: { dataType: 'STEP', failure: true },
              result: { dataType: 'NUMBER' },
            },
            hasSuccessPort: true,
            hasFailurePort: true,
            executeWhen: 'CONJUNCTION',
            isAsync: false,
          },
        ],
        instances: [{ type: 'NodeInstance', id: 'n', nodeType: 'negate' }],
        connections: [
          {
            type: 'Connection',
            from: { node: 'Start', port: 'value' },
            to: { node: 'n', port: 'value' },
          },
          {
            type: 'Connection',
            from: { node: 'n', port: 'result' },
            to: { node: 'Exit', port: 'result' },
          },
        ],
        scopes: {},
        startPorts: { value: { dataType: 'NUMBER' } },
        exitPorts: { result: { dataType: 'NUMBER' } },
        imports: [],
      };

      const result = generateInPlace(sourceCode, negateAst);

      // mathPipeline must still have @flowWeaver workflow, NOT @flowWeaver nodeType
      const mathSection = result.code.slice(
        result.code.indexOf('export function mathPipeline') - 200,
        result.code.indexOf('export function mathPipeline')
      );
      expect(mathSection).toContain('@flowWeaver workflow');
      expect(mathSection).not.toContain('@flowWeaver nodeType');
    });
  });

  describe('skipParamReturns option', () => {
    const workflowSource = `
/** @flowWeaver nodeType @expression */
function transform(value: number): { result: number } {
  return { result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node t transform
 * @connect Start.value -> t.value
 * @connect t.result -> Exit.result
 */
export function paramTestWorkflow(
  execute: boolean,
  params: { value: number }
): { onSuccess: boolean; onFailure: boolean; result: number } {
  throw new Error("Compile with: flow-weaver compile <file>");
}
`;

    it('should omit @param/@returns when skipParamReturns is true', () => {
      const parsed = parser.parseFromString(workflowSource, 'skip-params.ts');
      expect(parsed.errors).toHaveLength(0);

      const result = generateInPlace(workflowSource, parsed.workflows[0], {
        skipParamReturns: true,
      });

      expect(result.hasChanges).toBe(true);
      // Workflow annotation present
      expect(result.code).toContain('@flowWeaver workflow');
      // @param and @returns should be omitted
      expect(result.code).not.toMatch(/^\s*\*\s*@param\b/m);
      expect(result.code).not.toMatch(/^\s*\*\s*@returns\b/m);
      // Other annotations should be present
      expect(result.code).toContain('@node t transform');
      expect(result.code).toContain('@connect');
    });

    it('should emit @param/@returns when skipParamReturns is false (default)', () => {
      const parsed = parser.parseFromString(workflowSource, 'keep-params.ts');
      expect(parsed.errors).toHaveLength(0);

      const result = generateInPlace(workflowSource, parsed.workflows[0], {});

      expect(result.hasChanges).toBe(true);
      expect(result.code).toContain('@flowWeaver workflow');
      // @param and @returns should be present
      expect(result.code).toMatch(/^\s*\*\s*@param\b/m);
      expect(result.code).toMatch(/^\s*\*\s*@returns\b/m);
    });

    it('should stabilize with skipParamReturns after multiple compilations', () => {
      const parsed = parser.parseFromString(workflowSource, 'stable-skip.ts');
      const first = generateInPlace(workflowSource, parsed.workflows[0], {
        skipParamReturns: true,
      });

      const parsed2 = parser.parseFromString(first.code, 'stable-skip2.ts');
      const second = generateInPlace(first.code, parsed2.workflows[0], {
        skipParamReturns: true,
      });

      const parsed3 = parser.parseFromString(second.code, 'stable-skip3.ts');
      const third = generateInPlace(second.code, parsed3.workflows[0], {
        skipParamReturns: true,
      });

      // Should stabilize — no @param/@returns to oscillate
      expect(second.code).toBe(third.code);
      expect(third.hasChanges).toBe(false);
    });
  });

  describe('@autoConnect and @strictTypes round-trip', () => {
    it('should preserve @autoConnect through parse → generate → re-parse', () => {
      const source = `
/** @flowWeaver nodeType @expression */
function step1(input: string): { output: string } {
  return { output: input.toUpperCase() };
}

/** @flowWeaver nodeType @expression */
function step2(output: string): { result: string } {
  return { result: output + '!' };
}

/**
 * @flowWeaver workflow
 * @autoConnect
 * @node s1 step1
 * @node s2 step2
 * @param input
 * @returns result
 * @returns onSuccess
 * @returns onFailure
 */
export function myPipeline(execute: boolean, params: { input: string }): { result: string; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;
      // Parse the original source
      const parsed1 = parser.parseFromString(source, 'autoconnect-roundtrip.ts');
      expect(parsed1.workflows).toHaveLength(1);
      expect(parsed1.workflows[0].options?.autoConnect).toBe(true);

      // Generate in-place (simulates visual editor save)
      const result1 = generateInPlace(source, parsed1.workflows[0]);

      // Verify @autoConnect is in the output
      expect(result1.code).toContain('@autoConnect');

      // Verify no @connect lines are emitted (autoConnect skips them)
      expect(result1.code).not.toMatch(/@connect\s/);

      // Re-parse to verify round-trip
      const parsed2 = parser.parseFromString(result1.code, 'autoconnect-roundtrip.ts');
      expect(parsed2.workflows[0].options?.autoConnect).toBe(true);

      // Connections should still be auto-generated by the parser
      expect(parsed2.workflows[0].connections.length).toBeGreaterThan(0);
    });

    it('should preserve @strictTypes through parse → generate → re-parse', () => {
      const source = `
/** @flowWeaver nodeType @expression */
function add(a: number, b: number): { sum: number } {
  return { sum: a + b };
}

/**
 * @flowWeaver workflow
 * @strictTypes
 * @node adder add
 * @connect Start.a -> adder.a
 * @connect Start.b -> adder.b
 * @connect adder.sum -> Exit.sum
 * @connect adder.onSuccess -> Exit.onSuccess
 * @connect adder.onFailure -> Exit.onFailure
 * @param a
 * @param b
 * @returns sum
 * @returns onSuccess
 * @returns onFailure
 */
export function strictWorkflow(execute: boolean, params: { a: number; b: number }): { sum: number; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;
      const parsed1 = parser.parseFromString(source, 'stricttypes-roundtrip.ts');
      expect(parsed1.workflows[0].options?.strictTypes).toBe(true);

      const result1 = generateInPlace(source, parsed1.workflows[0]);
      expect(result1.code).toContain('@strictTypes');

      const parsed2 = parser.parseFromString(result1.code, 'stricttypes-roundtrip.ts');
      expect(parsed2.workflows[0].options?.strictTypes).toBe(true);
    });

    it('should preserve both @autoConnect and @strictTypes together', () => {
      const source = `
/** @flowWeaver nodeType @expression */
function transform(data: string): { result: string } {
  return { result: data.trim() };
}

/**
 * @flowWeaver workflow
 * @strictTypes
 * @autoConnect
 * @node t transform
 * @param data
 * @returns result
 * @returns onSuccess
 * @returns onFailure
 */
export function bothOptions(execute: boolean, params: { data: string }): { result: string; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;
      const parsed1 = parser.parseFromString(source, 'both-options-roundtrip.ts');
      expect(parsed1.workflows[0].options?.strictTypes).toBe(true);
      expect(parsed1.workflows[0].options?.autoConnect).toBe(true);

      const result1 = generateInPlace(source, parsed1.workflows[0]);
      expect(result1.code).toContain('@strictTypes');
      expect(result1.code).toContain('@autoConnect');
      expect(result1.code).not.toMatch(/@connect\s/);

      const parsed2 = parser.parseFromString(result1.code, 'both-options-roundtrip.ts');
      expect(parsed2.workflows[0].options?.strictTypes).toBe(true);
      expect(parsed2.workflows[0].options?.autoConnect).toBe(true);
    });

    it('should emit explicit @connect lines when autoConnect is not set', () => {
      const source = `
/** @flowWeaver nodeType @expression */
function add(a: number, b: number): { sum: number } {
  return { sum: a + b };
}

/**
 * @flowWeaver workflow
 * @node adder add
 * @connect Start.a -> adder.a
 * @connect Start.b -> adder.b
 * @connect adder.sum -> Exit.sum
 * @connect adder.onSuccess -> Exit.onSuccess
 * @connect adder.onFailure -> Exit.onFailure
 * @param a
 * @param b
 * @returns sum
 * @returns onSuccess
 * @returns onFailure
 */
export function normalWorkflow(execute: boolean, params: { a: number; b: number }): { sum: number; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;
      const parsed1 = parser.parseFromString(source, 'normal-connections.ts');
      expect(parsed1.workflows[0].options?.autoConnect).toBeUndefined();

      const result1 = generateInPlace(source, parsed1.workflows[0]);
      // Should have explicit @connect lines
      expect(result1.code).toMatch(/@connect\s/);
      expect(result1.code).not.toContain('@autoConnect');
    });

    it('should transition to explicit mode when connection is added to autoConnect workflow (fw_modify path)', async () => {
      const { addConnection } = await import('../../src/api/manipulation/connections');

      const source = `
/** @flowWeaver nodeType @expression */
function step1(input: string): { output: string } {
  return { output: input.toUpperCase() };
}

/** @flowWeaver nodeType @expression */
function step2(output: string): { result: string } {
  return { result: output + '!' };
}

/**
 * @flowWeaver workflow
 * @autoConnect
 * @node s1 step1
 * @node s2 step2
 * @param input
 * @returns result
 * @returns onSuccess
 * @returns onFailure
 */
export function myPipeline(execute: boolean, params: { input: string }): { result: string; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;
      // Parse — should have autoConnect and auto-generated connections
      const parsed = parser.parseFromString(source, 'transition-test.ts');
      expect(parsed.workflows[0].options?.autoConnect).toBe(true);
      expect(parsed.workflows[0].connections.length).toBeGreaterThan(0);

      // Simulate what fw_modify does: add a new connection (not already auto-generated), then clear autoConnect
      let modifiedAST = addConnection(parsed.workflows[0], 's1.output', 'Exit.result');
      // This is the guard that applyModifyOperation now applies
      if (modifiedAST.options?.autoConnect) {
        modifiedAST = { ...modifiedAST, options: { ...modifiedAST.options, autoConnect: undefined } };
      }

      // Generate — should now have explicit @connect and no @autoConnect
      const result = generateInPlace(source, modifiedAST);
      expect(result.code).not.toContain('@autoConnect');
      expect(result.code).toMatch(/@connect\s/);

      // Re-parse should NOT have autoConnect
      const reparsed = parser.parseFromString(result.code, 'transition-test.ts');
      expect(reparsed.workflows[0].options?.autoConnect).toBeUndefined();
      // Connections should still exist (explicitly written)
      expect(reparsed.workflows[0].connections.length).toBeGreaterThan(0);
    });
  });

  describe('External runtime debug declarations', () => {
    let tempDir: string;

    beforeEach(() => {
      // Create temp dir with fake @synergenius/flow-weaver installed
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-ext-runtime-'));
      fs.mkdirSync(path.join(tempDir, 'node_modules', '@synergenius', 'flow-weaver'), { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    const createSimpleAST = (): TWorkflowAST => ({
      type: 'Workflow',
      functionName: 'calculate',
      name: 'calculate',
      description: 'Test workflow',
      sourceFile: path.join(tempDir, 'test.ts'),
      nodeTypes: [createMultiInputNodeType('add', 'add')],
      instances: [createNodeInstance('adder', 'add', { x: 200, y: 100 })],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'a' }, to: { node: 'adder', port: 'a' } },
        { type: 'Connection', from: { node: 'Start', port: 'b' }, to: { node: 'adder', port: 'b' } },
        { type: 'Connection', from: { node: 'adder', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ],
      scopes: {},
      startPorts: { a: { dataType: 'NUMBER' }, b: { dataType: 'NUMBER' } },
      exitPorts: { result: { dataType: 'NUMBER' } },
      imports: [],
      ui: { startNode: { x: 0, y: 100 }, exitNode: { x: 400, y: 100 } },
    });

    it('should declare __flowWeaverDebugger__ when using external runtime in dev mode', () => {
      const sourceCode = `/**
 * @flowWeaver workflow
 * @node adder add
 */
export async function calculate(execute: boolean, params: { a: number; b: number }) {
  throw new Error('Not implemented');
}`;

      const ast = createSimpleAST();
      const result = generateInPlace(sourceCode, ast, {
        production: false,
        sourceFile: path.join(tempDir, 'test.ts'),
      });

      // External runtime detected — should import from @synergenius/flow-weaver/runtime
      expect(result.code).toContain("from '@synergenius/flow-weaver/runtime'");
      // Must have a `declare const __flowWeaverDebugger__` for body to reference
      // (the body references it but doesn't define it — it needs a module-level declare)
      expect(result.code).toContain('declare const __flowWeaverDebugger__');
    });

    it('should define createFlowWeaverDebugClient function when using external runtime in dev mode', () => {
      const sourceCode = `/**
 * @flowWeaver workflow
 * @node adder add
 */
export async function calculate(execute: boolean, params: { a: number; b: number }) {
  throw new Error('Not implemented');
}`;

      const ast = createSimpleAST();
      const result = generateInPlace(sourceCode, ast, {
        production: false,
        sourceFile: path.join(tempDir, 'test.ts'),
      });

      // External runtime detected — should import from @synergenius/flow-weaver/runtime
      expect(result.code).toContain("from '@synergenius/flow-weaver/runtime'");
      // Must define createFlowWeaverDebugClient as a function (not just import it from runtime)
      expect(result.code).toContain('function createFlowWeaverDebugClient(');
    });

    it('should not include debug code when using external runtime in production mode', () => {
      const sourceCode = `/**
 * @flowWeaver workflow
 * @node adder add
 */
export async function calculate(execute: boolean, params: { a: number; b: number }) {
  throw new Error('Not implemented');
}`;

      const ast = createSimpleAST();
      const result = generateInPlace(sourceCode, ast, {
        production: true,
        sourceFile: path.join(tempDir, 'test.ts'),
      });

      expect(result.code).not.toContain('createFlowWeaverDebugClient');
      expect(result.code).not.toContain('TDebugger');
    });
  });
});
