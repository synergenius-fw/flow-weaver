/**
 * Tests for Inline Runtime API
 * Tests generateInlineRuntime
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateInlineRuntime } from '../../src/api/inline-runtime';
import { createWorkflowRuntime } from '../../src/runtime/durable-execution';
import * as ts from 'typescript';

const EXECUTION_CONTEXT_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../../src/runtime/ExecutionContext.ts'),
  'utf8',
);

/** A method of the package class, from its signature to its closing brace at member depth. */
function packageMethod(name: string): string {
  const start = EXECUTION_CONTEXT_SOURCE.indexOf(`\n  ${name}(`);
  const end = EXECUTION_CONTEXT_SOURCE.indexOf('\n  }\n', start);
  if (start < 0 || end < 0) throw new Error(`${name} not found in ExecutionContext.ts`);
  return EXECUTION_CONTEXT_SOURCE.slice(start + 1, end + 4);
}

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

      it('carries the durable engine, with its debugger types erased', () => {
        const code = generateInlineRuntime(true);

        expect(code).toContain('class DurableExecution implements DurableEngine');
        expect(code).toContain('interface WorkflowRuntime');
        expect(code).toContain('function createWorkflowRuntime(');
        expect(code).toContain('export { createWorkflowRuntime, acceptContinuation');
        expect(code).not.toContain('DebugController');
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

      it('types the engine services against the debug types it declares', () => {
        const code = generateInlineRuntime(false);

        expect(code).toContain('type DebugController = TDebugController;');
        expect(code).toContain('readonly debugger?: TDebugger;');
        expect(code).toContain('class DurableExecution implements DurableEngine');
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

  describe('one source for the execution context', () => {
    // A compiled file's GeneratedExecutionContext is src/runtime/ExecutionContext.ts
    // as text, not a second copy typed out in inline-runtime.ts.
    it('writes the package class verbatim into a development build, markers and doc-comment openers aside', () => {
      const classStart = EXECUTION_CONTEXT_SOURCE.indexOf('export class GeneratedExecutionContext {');
      const expected = EXECUTION_CONTEXT_SOURCE.slice(classStart)
        .replace(/^export /, '')
        .replace(/^[ \t]*\/\/ inline: .*\n/gm, '')
        .replace(/^(\s*)\/\*\*/gm, '$1/*')
        .trimEnd();
      const code = generateInlineRuntime(false);
      expect(code).toContain(expected);
      expect(code.match(/class GeneratedExecutionContext\b/g)).toHaveLength(1);
    });

    it('carries the same scope, merge and fork logic into a production build', () => {
      const code = generateInlineRuntime(true);
      for (const name of ['createScope', 'mergeScope', 'forkParallel', 'mergeParallel', 'private retrieveVariable', 'addExecution']) {
        expect(code).toContain(packageMethod(name));
      }
      expect(packageMethod('createScope')).toContain('isAsyncOverride?: boolean');
      expect(packageMethod('createScope')).toContain('scopedContext.nodeExecutionCounts = new Map(this.nodeExecutionCounts);');
      expect(code).not.toContain('// inline:');
      expect(code).not.toContain('resumedScopeHighWater');
    });

    it('exports the class by keyword for a shared runtime module', () => {
      expect(generateInlineRuntime(true, true)).toContain('export class GeneratedExecutionContext {');
      expect(generateInlineRuntime(true, false)).not.toContain('export class GeneratedExecutionContext');
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
