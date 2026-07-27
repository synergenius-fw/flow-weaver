/**
 * Tests for Inline Runtime API
 * Tests generateInlineRuntime
 */

import { generateInlineRuntime } from '../../src/api/inline-runtime';
import { createWorkflowRuntime } from '../../src/runtime/durable-execution';
import * as ts from 'typescript';

interface GeneratedContext {
  setVariable(address: {
    id: string;
    portName: string;
    executionIndex: number;
    nodeTypeName: string;
  }, value: unknown): void | Promise<void>;
  getVariable(address: {
    id: string;
    portName: string;
    executionIndex: number;
    nodeTypeName: string;
  }): unknown | Promise<unknown>;
  hasVariable(address: {
    id: string;
    portName: string;
    executionIndex: number;
    nodeTypeName: string;
  }): boolean;
  createScope(
    parentNodeName: string,
    parentIndex: number,
    scopeName: string,
    cleanScope: boolean,
  ): GeneratedContext;
}

type GeneratedContextConstructor = new (
  isAsync: boolean,
  runtime: ReturnType<typeof createWorkflowRuntime>,
) => GeneratedContext;

function loadGeneratedExecutionContext(): GeneratedContextConstructor {
  const source = generateInlineRuntime(true, true);
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  const generatedExports: {
    GeneratedExecutionContext?: GeneratedContextConstructor;
  } = {};
  new Function('exports', compiled)(generatedExports);
  if (generatedExports.GeneratedExecutionContext === undefined) {
    throw new Error('GeneratedExecutionContext was not exported');
  }
  return generatedExports.GeneratedExecutionContext;
}

describe('Inline Runtime API', () => {
  describe('generateInlineRuntime', () => {
    describe('production mode (production=true)', () => {
      it('should generate valid TypeScript code', () => {
        const code = generateInlineRuntime(true);

        const result = ts.transpileModule(code, {
          compilerOptions: { target: ts.ScriptTarget.ES2020 },
        });

        expect(result.diagnostics).toHaveLength(0);
      });

      it('should not include debug types', () => {
        const code = generateInlineRuntime(true);

        expect(code).not.toContain('TStatusChangedEvent');
        expect(code).not.toContain('TVariableSetEvent');
        expect(code).not.toContain('TErrorLogEvent');
        expect(code).not.toContain('TWorkflowCompletedEvent');
        expect(code).not.toContain('TDebugger');
        expect(code).not.toContain('__flowWeaverDebugger__');
      });

      it('should include GeneratedExecutionContext class', () => {
        const code = generateInlineRuntime(true);

        expect(code).toContain('class GeneratedExecutionContext');
      });

      it('should include core methods', () => {
        const code = generateInlineRuntime(true);

        expect(code).toContain('setVariable(');
        expect(code).toContain('getVariable(');
        expect(code).toContain('hasVariable(');
        expect(code).toContain('addExecution(');
        expect(code).toContain('createScope(');
        expect(code).toContain('mergeScope(');
        expect(code).toContain('reset()');
      });

      it('should have no-op debug methods in production', () => {
        const code = generateInlineRuntime(true);

        expect(code).toContain('sendStatusChangedEvent(_args: unknown): void');
        expect(code).toContain('// No-op in production mode');
      });

      it('should include basic types', () => {
        const code = generateInlineRuntime(true);

        expect(code).toContain('type TStatusType');
        expect(code).toContain('type TVariableIdentification');
        expect(code).toContain('interface VariableAddress');
        expect(code).toContain('interface ExecutionInfo');
      });

      it('should require the explicit workflow runtime', () => {
        const code = generateInlineRuntime(true);

        expect(code).toContain('constructor(isAsync: boolean = true, runtime: WorkflowRuntime)');
        expect(code).not.toContain('flowWeaverDebugger');
      });
    });

    describe('development mode (production=false)', () => {
      it('should generate valid TypeScript code', () => {
        const code = generateInlineRuntime(false);

        const result = ts.transpileModule(code, {
          compilerOptions: { target: ts.ScriptTarget.ES2020 },
        });

        expect(result.diagnostics).toHaveLength(0);
      });

      it('should include debug types', () => {
        const code = generateInlineRuntime(false);

        expect(code).toContain('type TStatusChangedEvent');
        expect(code).toContain('type TVariableSetEvent');
        expect(code).toContain('type TErrorLogEvent');
        expect(code).toContain('type TWorkflowCompletedEvent');
        expect(code).toContain('type TEvent');
        expect(code).toContain('type TDebugger');
      });

      it('should not declare a process-global debugger', () => {
        const code = generateInlineRuntime(false);

        expect(code).not.toContain('__flowWeaverDebugger__');
      });

      it('should read debugger services from the explicit runtime', () => {
        const code = generateInlineRuntime(false);

        expect(code).toContain('constructor(isAsync: boolean = true, runtime: WorkflowRuntime)');
        expect(code).toContain('runtime.services.debugger');
      });

      it('should include debug event methods', () => {
        const code = generateInlineRuntime(false);

        expect(code).toContain('sendStatusChangedEvent(args:');
        expect(code).toContain('sendLogErrorEvent(args:');
        expect(code).toContain('sendWorkflowCompletedEvent(args:');
        expect(code).toContain('sendVariableSetEvent(args:');
      });

      it('should include debug event dispatch logic', () => {
        const code = generateInlineRuntime(false);

        expect(code).toContain('if (this.flowWeaverDebugger)');
        expect(code).toContain('this.flowWeaverDebugger.sendEvent');
        expect(code).toContain('innerFlowInvocation: this.flowWeaverDebugger.innerFlowInvocation');
      });
    });

    describe('common functionality', () => {
      it('does not recover ancestor durable state into a generated clean scope', async () => {
        const GeneratedExecutionContext = loadGeneratedExecutionContext();
        const runtime = createWorkflowRuntime({
          runId: 'inline-clean-scope-resume',
          workflowId: 'inline-clean-scope',
        });
        const rootContext = new GeneratedExecutionContext(true, runtime);
        const address = {
          id: 'source',
          portName: 'value',
          executionIndex: 0,
          nodeTypeName: 'Source',
        };
        await rootContext.setVariable(address, 'recovered-root-value');

        const inheritingScope = rootContext.createScope('scope', 0, 'inheriting', false);
        expect(inheritingScope.hasVariable(address)).toBe(true);
        await expect(inheritingScope.getVariable(address)).resolves.toBe('recovered-root-value');

        const cleanScope = rootContext.createScope('scope', 0, 'clean', true);
        expect(cleanScope.hasVariable(address)).toBe(false);
        expect(() => cleanScope.getVariable(address)).toThrow('Variable not found: source.value[0]');

        const nestedInheritingScope = cleanScope.createScope('nested', 0, 'inheriting', false);
        expect(nestedInheritingScope.hasVariable(address)).toBe(false);
        expect(() => nestedInheritingScope.getVariable(address)).toThrow(
          'Variable not found: source.value[0]',
        );
      });

      it('should include pull executor registration', () => {
        const prodCode = generateInlineRuntime(true);
        const devCode = generateInlineRuntime(false);

        [prodCode, devCode].forEach((code) => {
          expect(code).toContain('registerPullExecutor(id: string, executor:');
          expect(code).toContain('this.pullExecutors.set(id, executor)');
        });
      });

      it('should include per-node execution indexing', () => {
        const code = generateInlineRuntime(true);

        expect(code).toContain('nodeExecutionCounts');
        expect(code).toContain('nodeExecutionIndices');
      });

      it('should include variable key generation', () => {
        const code = generateInlineRuntime(true);

        expect(code).toContain('getVariableKey(address: VariableAddress): string');
        expect(code).toContain('${address.id}:${address.portName}:${address.executionIndex}');
      });
    });
  });

  describe('Edge Cases', () => {
    it('should produce different output for production vs development', () => {
      const prodCode = generateInlineRuntime(true);
      const devCode = generateInlineRuntime(false);

      expect(prodCode).not.toBe(devCode);
      expect(prodCode.length).toBeLessThan(devCode.length);
    });

    it('should generate consistent output for same mode', () => {
      const code1 = generateInlineRuntime(true);
      const code2 = generateInlineRuntime(true);

      expect(code1).toBe(code2);
    });
  });

  describe("Type Safety - no 'any' types", () => {
    it("should use 'unknown' instead of 'any' for VariableValue", () => {
      const code = generateInlineRuntime(true);
      expect(code).toContain('type VariableValue = unknown');
      expect(code).not.toContain('type VariableValue = any');
    });

    it("should use 'unknown' for event value types in development mode", () => {
      const code = generateInlineRuntime(false);
      expect(code).toContain('value?: unknown;');
      expect(code).toContain('result?: unknown;');
    });

    it("should use 'unknown' for getVariable return type", () => {
      const code = generateInlineRuntime(true);
      expect(code).toContain('getVariable(address: VariableAddress): unknown');
    });

    it("should use 'unknown' for retrieveVariable return type", () => {
      const code = generateInlineRuntime(true);
      expect(code).toContain('private retrieveVariable(address: VariableAddress): unknown');
    });

    it('should generate typed production stubs (no any)', () => {
      const code = generateInlineRuntime(true);
      expect(code).not.toContain('_args: any');
      expect(code).toContain('sendStatusChangedEvent(_args: unknown)');
      expect(code).toContain('sendLogErrorEvent(_args: unknown)');
      expect(code).toContain('sendWorkflowCompletedEvent(_args: unknown)');
    });
  });
});
