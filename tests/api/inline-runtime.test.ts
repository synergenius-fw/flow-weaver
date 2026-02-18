/**
 * Tests for Inline Runtime API
 * Tests generateInlineRuntime and generateInlineDebugClient
 */

import { generateInlineRuntime, generateInlineDebugClient } from '../../src/api/inline-runtime';
import * as ts from 'typescript';

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

      it('should have simple constructor without debugger', () => {
        const code = generateInlineRuntime(true);

        expect(code).toContain('constructor(isAsync: boolean = true, abortSignal?: AbortSignal)');
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

      it('should declare __flowWeaverDebugger__', () => {
        const code = generateInlineRuntime(false);

        expect(code).toContain('declare const __flowWeaverDebugger__');
      });

      it('should have constructor with debugger parameter', () => {
        const code = generateInlineRuntime(false);

        expect(code).toContain(
          'constructor(isAsync: boolean = true, flowWeaverDebugger?: TDebugger, abortSignal?: AbortSignal)'
        );
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

  describe('generateInlineDebugClient', () => {
    it('should generate valid TypeScript code', () => {
      const code = generateInlineDebugClient();

      const result = ts.transpileModule(code, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 },
      });

      expect(result.diagnostics).toHaveLength(0);
    });

    it('should generate WebSocket client factory', () => {
      const code = generateInlineDebugClient();

      expect(code).toContain('function createFlowWeaverDebugClient');
      expect(code).toContain('url: string');
      expect(code).toContain('workflowExportName: string');
    });

    it('should include WebSocket connection logic', () => {
      const code = generateInlineDebugClient();

      expect(code).toContain("await import('ws')");
      expect(code).toContain('ws = new WS(url)');
      expect(code).toContain("ws.on('open'");
      expect(code).toContain("ws.on('error'");
      expect(code).toContain("ws.on('close'");
    });

    it('should include session ID generation', () => {
      const code = generateInlineDebugClient();

      expect(code).toContain('const sessionId = Math.random()');
    });

    it('should include event queueing', () => {
      const code = generateInlineDebugClient();

      expect(code).toContain('let queue: string[] = []');
      expect(code).toContain('queue.push(message)');
      expect(code).toContain('queue.shift()');
    });

    it('should return debug client interface', () => {
      const code = generateInlineDebugClient();

      expect(code).toContain('sendEvent: (event: unknown) =>');
      expect(code).toContain('innerFlowInvocation: false');
      expect(code).toContain('sessionId');
    });

    it('should handle connection errors gracefully', () => {
      const code = generateInlineDebugClient();

      expect(code).toContain('try {');
      expect(code).toContain('catch (err: unknown)');
      expect(code).toContain("console.warn('[Flow Weaver] Debug client failed");
    });

    it('should send connect message with client info', () => {
      const code = generateInlineDebugClient();

      expect(code).toContain("type: 'connect'");
      expect(code).toContain('clientInfo:');
      expect(code).toContain('platform: process.platform');
      expect(code).toContain('nodeVersion: process.version');
      expect(code).toContain('pid: process.pid');
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

    it('should use string[] for message queue in debug client', () => {
      const code = generateInlineDebugClient();
      expect(code).toContain('let queue: string[] = []');
      expect(code).not.toContain('let queue: any[] = []');
    });

    it('should use unknown for catch and event types in debug client', () => {
      const code = generateInlineDebugClient();
      expect(code).toContain('catch (err: unknown)');
      expect(code).toContain('sendEvent: (event: unknown)');
      expect(code).not.toContain('catch (err: any)');
      expect(code).not.toContain('sendEvent: (event: any)');
    });
  });
});
