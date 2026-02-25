import { describe, it, expect } from 'vitest';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';
import { validator } from '../../src/validator';
import { generateCode } from '../../src/api/generate';
import { AnnotationGenerator, generateFunctionSignature } from '../../src/annotation-generator';

// -- Factories --

function makeStubNodeType(name: string, inputs: Record<string, string>, outputs: Record<string, string>): TNodeTypeAST {
  const inputPorts: TNodeTypeAST['inputs'] = {};
  for (const [pName, dt] of Object.entries(inputs)) {
    inputPorts[pName] = { dataType: dt };
  }
  const outputPorts: TNodeTypeAST['outputs'] = {};
  for (const [pName, dt] of Object.entries(outputs)) {
    outputPorts[pName] = { dataType: dt };
  }
  return {
    type: 'NodeType',
    name,
    functionName: name,
    inputs: inputPorts,
    outputs: outputPorts,
    hasSuccessPort: true,
    hasFailurePort: true,
    isAsync: false,
    executeWhen: 'CONJUNCTION',
    variant: 'STUB',
    expression: true,
  };
}

function makeImplementedNodeType(name: string): TNodeTypeAST {
  return {
    type: 'NodeType',
    name,
    functionName: name,
    inputs: { value: { dataType: 'NUMBER' } },
    outputs: { result: { dataType: 'NUMBER' } },
    hasSuccessPort: true,
    hasFailurePort: true,
    isAsync: false,
    executeWhen: 'CONJUNCTION',
    variant: 'FUNCTION',
  };
}

function makeStubWorkflow(nodeTypes: TNodeTypeAST[]): TWorkflowAST {
  const instances = nodeTypes.map((nt) => ({
    type: 'NodeInstance' as const,
    id: nt.functionName,
    nodeType: nt.functionName,
  }));

  // Minimal connections: Start -> first node -> Exit (control flow only)
  const connections = [
    { type: 'Connection' as const, from: { node: 'Start', port: 'execute' }, to: { node: instances[0].id, port: 'execute' } },
    { type: 'Connection' as const, from: { node: instances[instances.length - 1].id, port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
  ];

  return {
    type: 'Workflow',
    name: 'testWorkflow',
    functionName: 'testWorkflow',
    sourceFile: 'test.ts',
    nodeTypes,
    instances,
    connections,
    scopes: {},
    startPorts: {},
    exitPorts: {},
    imports: [],
  };
}

// -- Tests --

describe('Model-Driven Workflows', () => {
  describe('Validator: draft mode post-processing', () => {
    const stubA = makeStubNodeType('validateEmail', { email: 'STRING' }, { valid: 'BOOLEAN', reason: 'STRING' });
    const stubB = makeStubNodeType('sendWelcome', { email: 'STRING' }, { sent: 'BOOLEAN' });

    it('strict mode emits STUB_NODE as errors', () => {
      const workflow = makeStubWorkflow([stubA, stubB]);
      const result = validator.validate(workflow);

      const stubErrors = result.errors.filter((e) => e.code === 'STUB_NODE');
      expect(stubErrors.length).toBe(2);
      expect(result.valid).toBe(false);
    });

    it('draft mode moves STUB_NODE from errors to warnings', () => {
      const workflow = makeStubWorkflow([stubA, stubB]);
      const result = validator.validate(workflow, { mode: 'draft' });

      const stubErrors = result.errors.filter((e) => e.code === 'STUB_NODE');
      const stubWarnings = result.warnings.filter((e) => e.code === 'STUB_NODE');
      expect(stubErrors.length).toBe(0);
      expect(stubWarnings.length).toBe(2);
    });

    it('draft mode moves MISSING_REQUIRED_INPUT for stubs to warnings', () => {
      // Stub with a required input that has no connection
      const stub = makeStubNodeType('process', { data: 'STRING' }, { result: 'STRING' });
      // Remove optional flag — port is required by default
      const workflow = makeStubWorkflow([stub]);

      const result = validator.validate(workflow, { mode: 'draft' });

      const missingErrors = result.errors.filter((e) => e.code === 'MISSING_REQUIRED_INPUT');
      const missingWarnings = result.warnings.filter((e) => e.code === 'MISSING_REQUIRED_INPUT');
      expect(missingErrors.length).toBe(0);
      expect(missingWarnings.length).toBeGreaterThan(0);
    });

    it('structural errors still surface in draft mode', () => {
      const workflow = makeStubWorkflow([stubA]);
      // Add a connection to a non-existent node — a structural error unrelated to stubs
      workflow.connections.push({
        type: 'Connection',
        from: { node: 'ghost', port: 'out' },
        to: { node: 'validateEmail', port: 'email' },
      });

      const result = validator.validate(workflow, { mode: 'draft' });

      // Should have errors beyond just stub-related ones
      const nonStubErrors = result.errors.filter(
        (e) => e.code !== 'STUB_NODE' && e.code !== 'MISSING_REQUIRED_INPUT',
      );
      expect(nonStubErrors.length).toBeGreaterThan(0);
    });

    it('workflow with only implemented nodes has no STUB_NODE diagnostics', () => {
      const impl = makeImplementedNodeType('doubler');
      const workflow = makeStubWorkflow([impl]);

      const result = validator.validate(workflow, { mode: 'draft' });

      const stubDiags = [...result.errors, ...result.warnings].filter((e) => e.code === 'STUB_NODE');
      expect(stubDiags.length).toBe(0);
    });
  });

  describe('Generator: stub handling', () => {
    it('rejects generation when stubs exist and generateStubs is false', () => {
      const stub = makeStubNodeType('process', { data: 'STRING' }, { result: 'STRING' });
      const workflow = makeStubWorkflow([stub]);

      expect(() => generateCode(workflow, { generateStubs: false })).toThrow(/stub node/i);
    });

    it('generates code with throw when generateStubs is true', () => {
      const stub = makeStubNodeType('process', { data: 'STRING' }, { result: 'STRING' });
      const workflow = makeStubWorkflow([stub]);

      const code = generateCode(workflow, { generateStubs: true });
      expect(code).toContain('throw new Error');
      expect(code).toContain('process');
    });
  });

  describe('Annotation generator: round-trip', () => {
    it('generates declare function for stub node types', () => {
      const stub = makeStubNodeType('validateEmail', { email: 'STRING' }, { valid: 'BOOLEAN', reason: 'STRING' });
      const workflow = makeStubWorkflow([stub]);

      const gen = new AnnotationGenerator();
      const output = gen.generate(workflow);

      expect(output).toContain('declare function validateEmail');
      // The stub node type itself should not have a function body
      const stubSection = output.split('declare function validateEmail')[1].split('\n')[0];
      expect(stubSection).toMatch(/;$/);
    });

    it('generates const declaration for stub workflows', () => {
      const stub = makeStubNodeType('process', { data: 'STRING' }, { result: 'STRING' });
      const workflow = makeStubWorkflow([stub]);
      workflow.stub = true;

      const gen = new AnnotationGenerator();
      const output = gen.generate(workflow);

      expect(output).toContain("export const testWorkflow = 'flowWeaver:draft'");
    });

    it('uses @flowWeaver node shorthand for stubs', () => {
      const stub = makeStubNodeType('process', { data: 'STRING' }, { result: 'STRING' });
      const workflow = makeStubWorkflow([stub]);

      const gen = new AnnotationGenerator();
      const output = gen.generate(workflow);

      expect(output).toContain('@flowWeaver node');
      expect(output).not.toContain('@flowWeaver nodeType');
    });
  });

  describe('generateFunctionSignature (exported)', () => {
    it('generates declare function for STUB variant', () => {
      const stub = makeStubNodeType('validate', { email: 'STRING' }, { valid: 'BOOLEAN' });
      const lines = generateFunctionSignature(stub);

      expect(lines[0]).toBe('declare function validate(email: string): boolean;');
    });

    it('generates expression function for FUNCTION + expression variant', () => {
      const nt: TNodeTypeAST = {
        ...makeStubNodeType('transform', { data: 'NUMBER' }, { result: 'NUMBER' }),
        variant: 'FUNCTION',
      };
      const lines = generateFunctionSignature(nt);

      expect(lines[0]).toContain('function transform(data: number): number {');
      expect(lines).toContainEqual(expect.stringContaining('throw new Error'));
    });

    it('generates normal-mode function without expression flag', () => {
      const nt: TNodeTypeAST = {
        type: 'NodeType',
        name: 'process',
        functionName: 'process',
        inputs: { value: { dataType: 'NUMBER' } },
        outputs: { result: { dataType: 'NUMBER' } },
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false,
        executeWhen: 'CONJUNCTION',
      };
      const lines = generateFunctionSignature(nt);

      expect(lines[0]).toContain('function process(execute: boolean');
      expect(lines[0]).toContain('value: number');
    });

    it('handles multiple output ports as object return type', () => {
      const stub = makeStubNodeType('check', { input: 'STRING' }, { valid: 'BOOLEAN', reason: 'STRING' });
      const lines = generateFunctionSignature(stub);

      expect(lines[0]).toContain('{ valid: boolean; reason: string }');
    });
  });

  describe('validateWorkflow API: single options object', () => {
    it('accepts mode in options without customRules placeholder', async () => {
      const { validateWorkflow } = await import('../../src/api/validate');
      const stub = makeStubNodeType('process', { data: 'STRING' }, { result: 'STRING' });
      const workflow = makeStubWorkflow([stub]);

      // This should work without passing undefined as second arg
      const result = validateWorkflow(workflow, { mode: 'draft' });

      const stubErrors = result.errors.filter((e) => e.code === 'STUB_NODE');
      expect(stubErrors.length).toBe(0);
      expect(result.warnings.some((w) => w.code === 'STUB_NODE')).toBe(true);
    });
  });
});
