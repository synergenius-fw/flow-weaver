import { getGeneratedBranding } from '../generated-branding.js';

export type TOutputFormat = 'typescript' | 'javascript';

/**
 * Strip TypeScript type syntax from code using esbuild.
 * Removes type declarations, interfaces, declare statements, and type annotations
 * while preserving runtime JavaScript code.
 * Uses a lazy import so esbuild is only loaded when actually needed.
 */
export function stripTypeScript(code: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { transformSync } = require('esbuild') as typeof import('esbuild');
  const result = transformSync(code, {
    loader: 'ts',
    target: 'es2020',
    // Keep the code readable (no minification)
    minify: false,
    // Preserve formatting as much as possible
    keepNames: true,
  });
  return result.code;
}

/**
 * Generates inline runtime code for standalone execution
 *
 * This includes all types and the GeneratedExecutionContext class
 * so generated workflows have zero runtime dependencies.
 *
 * @param production - Whether to generate production-optimized code (no debug events)
 * @param exportClasses - Whether to add 'export' keyword to classes (for shared modules)
 * @param outputFormat - Output format: 'typescript' (default) or 'javascript' (strips types)
 */
export function generateInlineRuntime(production: boolean, exportClasses: boolean = false, outputFormat: TOutputFormat = 'typescript'): string {
  const exportKeyword = exportClasses ? 'export ' : '';
  const lines: string[] = [];

  // Type definitions
  lines.push('// ============================================================================');
  lines.push('// Runtime Types');
  lines.push('// ============================================================================');
  lines.push('');
  lines.push('type TStatusType =');
  lines.push('  | "RUNNING"');
  lines.push('  | "SCHEDULED"');
  lines.push('  | "SUCCEEDED"');
  lines.push('  | "FAILED"');
  lines.push('  | "CANCELLED"');
  lines.push('  | "PENDING";');
  lines.push('');
  lines.push('type TVariableIdentification = {');
  lines.push('  nodeTypeName: string;');
  lines.push('  id: string;');
  lines.push('  scope?: string | undefined;');
  lines.push('  side?: "start" | "exit" | undefined;');
  lines.push('  portName: string;');
  lines.push('  executionIndex: number;');
  lines.push('  key?: string | undefined;');
  lines.push('};');
  lines.push('');

  if (!production) {
    // Debug types only in development mode
    lines.push('type TStatusChangedEvent = {');
    lines.push('  type: "STATUS_CHANGED";');
    lines.push('  nodeTypeName: string;');
    lines.push('  id: string;');
    lines.push('  scope?: string;');
    lines.push('  side?: "start" | "exit";');
    lines.push('  executionIndex: number;');
    lines.push('  status: TStatusType;');
    lines.push('  innerFlowInvocation?: boolean;');
    lines.push('};');
    lines.push('');
    lines.push('type TVariableSetEvent = {');
    lines.push('  type: "VARIABLE_SET";');
    lines.push('  identifier: TVariableIdentification;');
    lines.push('  value?: unknown;');
    lines.push('  innerFlowInvocation?: boolean;');
    lines.push('};');
    lines.push('');
    lines.push('type TErrorLogEvent = {');
    lines.push('  type: "LOG_ERROR";');
    lines.push('  nodeTypeName: string;');
    lines.push('  id: string;');
    lines.push('  scope?: string;');
    lines.push('  side?: "start" | "exit";');
    lines.push('  executionIndex: number;');
    lines.push('  error: string;');
    lines.push('  innerFlowInvocation?: boolean;');
    lines.push('};');
    lines.push('');
    lines.push('type TWorkflowCompletedEvent = {');
    lines.push('  type: "WORKFLOW_COMPLETED";');
    lines.push('  executionIndex: number;');
    lines.push('  status: "SUCCEEDED" | "FAILED" | "CANCELLED";');
    lines.push('  result?: unknown;');
    lines.push('  innerFlowInvocation?: boolean;');
    lines.push('};');
    lines.push('');
    lines.push(`${exportKeyword}type TEvent =`);
    lines.push('  | TStatusChangedEvent');
    lines.push('  | TVariableSetEvent');
    lines.push('  | TErrorLogEvent');
    lines.push('  | TWorkflowCompletedEvent;');
    lines.push('');
    lines.push(`${exportKeyword}type TDebugger = {`);
    lines.push('  sendEvent: (event: TEvent) => void;');
    lines.push('  innerFlowInvocation: boolean;');
    lines.push('  sessionId?: string;');
    lines.push('};');
    lines.push('');
    // Declare __flowWeaverDebugger__ so TypeScript knows it might exist at runtime
    // (e.g., passed as a function parameter or injected by execution harness)
    lines.push('declare const __flowWeaverDebugger__: TDebugger | undefined;');
    lines.push('');

    // Debug controller type for step-through debugging and checkpoint/resume
    lines.push('type TDebugController = {');
    lines.push('  beforeNode(nodeId: string, ctx: GeneratedExecutionContext): Promise<boolean> | boolean;');
    lines.push('  afterNode(nodeId: string, ctx: GeneratedExecutionContext): Promise<void> | void;');
    lines.push('};');
    lines.push('');
  }

  // Declare __abortSignal__ so TypeScript knows it might exist at runtime
  // (passed as a function parameter for cancellation support)
  lines.push('declare const __abortSignal__: AbortSignal | undefined;');
  lines.push('');

  lines.push('interface VariableAddress {');
  lines.push('  id: string;');
  lines.push('  portName: string;');
  lines.push('  executionIndex: number;');
  lines.push('  nodeTypeName?: string | undefined;');
  lines.push('  scope?: string | undefined;');
  lines.push("  side?: 'start' | 'exit' | undefined;");
  lines.push('}');
  lines.push('');
  lines.push('interface ExecutionInfo {');
  lines.push('  id: string;');
  lines.push('  index: number;');
  lines.push('  parentIndex?: number | undefined;');
  lines.push('  scopeName?: string | undefined;');
  lines.push('}');
  lines.push('');
  lines.push('type VariableValue = unknown | (() => unknown) | (() => Promise<unknown>);');
  lines.push('');

  // CancellationError class
  lines.push('// ============================================================================');
  lines.push('// Cancellation Error');
  lines.push('// ============================================================================');
  lines.push('');
  lines.push(`${exportKeyword}class CancellationError extends Error {`);
  lines.push('  public readonly executionIndex: number;');
  lines.push('  public readonly nodeId?: string;');
  lines.push('  public readonly timestamp: number;');
  lines.push('');
  lines.push('  constructor(');
  lines.push("    message: string = 'Workflow execution cancelled',");
  lines.push('    executionIndex: number = 0,');
  lines.push('    nodeId?: string,');
  lines.push('    timestamp: number = Date.now()');
  lines.push('  ) {');
  lines.push('    super(message);');
  lines.push("    this.name = 'CancellationError';");
  lines.push('    this.executionIndex = executionIndex;');
  lines.push('    this.nodeId = nodeId;');
  lines.push('    this.timestamp = timestamp;');
  lines.push('  }');
  lines.push('');
  lines.push('  static isCancellationError(error: unknown): error is CancellationError {');
  lines.push('    return (');
  lines.push('      error instanceof CancellationError ||');
  lines.push("      (error instanceof Error && error.name === 'CancellationError')");
  lines.push('    );');
  lines.push('  }');
  lines.push('}');
  lines.push('');

  // GeneratedExecutionContext class
  lines.push('// ============================================================================');
  lines.push('// Execution Context');
  lines.push('// ============================================================================');
  lines.push('');
  lines.push(`${exportKeyword}class GeneratedExecutionContext {`);
  lines.push('  private variables: Map<string, VariableValue> = new Map();');
  lines.push('  private executions: Map<string, ExecutionInfo> = new Map();');
  lines.push('  private executionCounter: number = 0;');
  lines.push('  private nodeExecutionCounts: Map<string, number> = new Map();');
  lines.push('  private isAsync: boolean;');

  if (!production) {
    lines.push('  private flowWeaverDebugger?: TDebugger | undefined;');
  }

  lines.push('  private pullExecutors: Map<string, () => void | Promise<void>> = new Map();');
  lines.push('  private nodeExecutionIndices: Map<string, number> = new Map();');
  lines.push('  private abortSignal?: AbortSignal | undefined;');
  lines.push('');

  // Constructor
  if (production) {
    lines.push('  constructor(isAsync: boolean = true, abortSignal?: AbortSignal) {');
    lines.push('    this.isAsync = isAsync;');
    lines.push('    this.abortSignal = abortSignal;');
    lines.push('  }');
  } else {
    lines.push(
      '  constructor(isAsync: boolean = true, flowWeaverDebugger?: TDebugger, abortSignal?: AbortSignal) {'
    );
    lines.push('    this.isAsync = isAsync;');
    lines.push('    this.flowWeaverDebugger = flowWeaverDebugger;');
    lines.push('    this.abortSignal = abortSignal;');
    lines.push('  }');
  }
  lines.push('');

  // Core methods (always included)
  lines.push('  registerPullExecutor(id: string, executor: () => void | Promise<void>): void {');
  lines.push('    this.pullExecutors.set(id, executor);');
  lines.push('  }');
  lines.push('');
  lines.push('  addExecution(id: string, parentIndex?: number, scopeName?: string): number {');
  lines.push('    // Use per-node execution counter (each node starts at 0)');
  lines.push('    const currentCount = this.nodeExecutionCounts.get(id) || 0;');
  lines.push('    const index = currentCount;');
  lines.push('    this.nodeExecutionCounts.set(id, currentCount + 1);');
  lines.push('    this.executionCounter++;');
  lines.push('    this.executions.set(this.getExecutionKey(id, index), {');
  lines.push('      id,');
  lines.push('      index,');
  lines.push('      parentIndex,');
  lines.push('      scopeName,');
  lines.push('    });');
  lines.push('    this.nodeExecutionIndices.set(id, index);');
  lines.push('    return index;');
  lines.push('  }');
  lines.push('');

  // setVariable with conditional debug code
  lines.push(
    '  setVariable(address: VariableAddress, value: VariableValue): void | Promise<void> {'
  );
  lines.push('    const key = this.getVariableKey(address);');
  lines.push('    this.variables.set(key, value);');

  if (!production) {
    lines.push('    if (this.flowWeaverDebugger) {');
    lines.push('      const actualValue = typeof value === "function" ? value() : value;');
    lines.push('      this.sendVariableSetEvent({');
    lines.push('        identifier: {');
    lines.push('          nodeTypeName: address.nodeTypeName || "unknown",');
    lines.push('          id: address.id,');
    lines.push('          portName: address.portName,');
    lines.push('          executionIndex: address.executionIndex,');
    lines.push('          key: "default",');
    lines.push('          ...(address.scope && { scope: address.scope }),');
    lines.push('          ...(address.side && { side: address.side }),');
    lines.push('        },');
    lines.push('        value: actualValue,');
    lines.push('      });');
    lines.push('    }');
  }

  lines.push('    return this.isAsync ? Promise.resolve() : undefined;');
  lines.push('  }');
  lines.push('');

  // getVariable
  lines.push('  getVariable(address: VariableAddress): unknown | Promise<unknown> {');
  lines.push('    const executor = this.pullExecutors.get(address.id);');
  lines.push('    if (executor) {');
  lines.push('      if (!this.hasVariable(address)) {');
  lines.push('        const result = executor();');
  lines.push('        // Handle async executor (returns Promise)');
  lines.push('        if (result instanceof Promise) {');
  lines.push('          return result.then(() => {');
  lines.push('            const trackedIndex = this.nodeExecutionIndices.get(address.id);');
  lines.push('            const finalAddress = trackedIndex !== undefined');
  lines.push('              ? { ...address, executionIndex: trackedIndex }');
  lines.push('              : address;');
  lines.push('            return this.retrieveVariable(finalAddress);');
  lines.push('          });');
  lines.push('        }');
  lines.push('        // Handle sync executor (returns void)');
  lines.push('        const trackedIndex = this.nodeExecutionIndices.get(address.id);');
  lines.push('        const finalAddress = trackedIndex !== undefined');
  lines.push('          ? { ...address, executionIndex: trackedIndex }');
  lines.push('          : address;');
  lines.push('        return this.retrieveVariable(finalAddress);');
  lines.push('      }');
  lines.push('    }');
  lines.push('    return this.retrieveVariable(address);');
  lines.push('  }');
  lines.push('');

  // retrieveVariable
  lines.push('  private retrieveVariable(address: VariableAddress): unknown | Promise<unknown> {');
  lines.push('    const key = this.getVariableKey(address);');
  lines.push('    if (!this.variables.has(key)) {');
  lines.push(
    '      throw new Error(`Variable not found: ${address.id}.${address.portName}[${address.executionIndex}]`);'
  );
  lines.push('    }');
  lines.push('    const value = this.variables.get(key);');
  lines.push('    if (typeof value === "function") {');
  lines.push('      const result = value();');
  lines.push('      if (result instanceof Promise) {');
  lines.push('        return result;');
  lines.push('      }');
  lines.push('      return this.isAsync ? Promise.resolve(result) : result;');
  lines.push('    }');
  lines.push('    return this.isAsync ? Promise.resolve(value) : value;');
  lines.push('  }');
  lines.push('');

  // hasVariable
  lines.push('  hasVariable(address: VariableAddress): boolean {');
  lines.push('    const key = this.getVariableKey(address);');
  lines.push('    return this.variables.has(key);');
  lines.push('  }');
  lines.push('');

  // getExecution
  lines.push('  getExecution(id: string, index: number): ExecutionInfo | undefined {');
  lines.push('    return this.executions.get(this.getExecutionKey(id, index));');
  lines.push('  }');
  lines.push('');

  // createScope
  lines.push(
    '  createScope(_parentNodeName: string, _parentIndex: number, _scopeName: string, cleanScope: boolean = false): GeneratedExecutionContext {'
  );
  if (production) {
    lines.push(
      '    const scopedContext = new GeneratedExecutionContext(this.isAsync, this.abortSignal);'
    );
  } else {
    lines.push(
      '    const scopedContext = new GeneratedExecutionContext(this.isAsync, this.flowWeaverDebugger, this.abortSignal);'
    );
  }
  lines.push('    // For per-port function scopes (cleanScope=true), start with empty variables');
  lines.push('    // For node-level scopes (cleanScope=false), inherit parent variables');
  lines.push('    scopedContext.variables = cleanScope ? new Map() : new Map(this.variables);');
  lines.push('    scopedContext.executions = new Map(this.executions);');
  lines.push('    scopedContext.executionCounter = this.executionCounter;');
  lines.push('    scopedContext.nodeExecutionCounts = new Map(this.nodeExecutionCounts);');
  lines.push('    return scopedContext;');
  lines.push('  }');
  lines.push('');

  // mergeScope
  lines.push('  mergeScope(scopedContext: GeneratedExecutionContext): void {');
  lines.push('    scopedContext.executions.forEach((info, key) => {');
  lines.push('      this.executions.set(key, info);');
  lines.push('    });');
  lines.push('    scopedContext.variables.forEach((value, key) => {');
  lines.push('      this.variables.set(key, value);');
  lines.push('    });');
  lines.push(
    '    this.executionCounter = Math.max(this.executionCounter, scopedContext.executionCounter);'
  );
  lines.push('    scopedContext.nodeExecutionCounts.forEach((count, id) => {');
  lines.push('      const currentCount = this.nodeExecutionCounts.get(id) || 0;');
  lines.push('      this.nodeExecutionCounts.set(id, Math.max(currentCount, count));');
  lines.push('    });');
  lines.push('  }');
  lines.push('');

  // Helper methods
  lines.push('  private getVariableKey(address: VariableAddress): string {');
  lines.push('    return `${address.id}:${address.portName}:${address.executionIndex}`;');
  lines.push('  }');
  lines.push('');
  lines.push('  private getExecutionKey(id: string, index: number): string {');
  lines.push('    return `${id}:${index}`;');
  lines.push('  }');
  lines.push('');
  lines.push('  getExecutionCount(): number {');
  lines.push('    return this.executionCounter;');
  lines.push('  }');
  lines.push('');
  lines.push('  reset(): void {');
  lines.push('    this.variables.clear();');
  lines.push('    this.executions.clear();');
  lines.push('    this.executionCounter = 0;');
  lines.push('    this.nodeExecutionCounts.clear();');
  lines.push('  }');
  lines.push('');

  // Cancellation methods
  lines.push('  isAborted(): boolean {');
  lines.push('    return this.abortSignal?.aborted ?? false;');
  lines.push('  }');
  lines.push('');
  lines.push('  checkAborted(nodeId?: string): void {');
  lines.push('    if (this.abortSignal?.aborted) {');
  lines.push('      throw new CancellationError(');
  lines.push("        `Workflow execution cancelled${nodeId ? ` at ${nodeId}` : ''}`,");
  lines.push('        this.executionCounter,');
  lines.push('        nodeId');
  lines.push('      );');
  lines.push('    }');
  lines.push('  }');
  lines.push('');

  // Debug event methods (only in development mode)
  if (!production) {
    lines.push('  sendStatusChangedEvent(args: {');
    lines.push('    nodeTypeName: string;');
    lines.push('    id: string;');
    lines.push('    scope?: string;');
    lines.push('    side?: "start" | "exit";');
    lines.push('    executionIndex: number;');
    lines.push('    status: TStatusType;');
    lines.push('  }): void {');
    lines.push('    if (this.flowWeaverDebugger) {');
    lines.push('      this.flowWeaverDebugger.sendEvent({');
    lines.push('        type: "STATUS_CHANGED",');
    lines.push('        ...args,');
    lines.push('        innerFlowInvocation: this.flowWeaverDebugger.innerFlowInvocation,');
    lines.push('      });');
    lines.push('    }');
    lines.push('  }');
    lines.push('');
    lines.push('  private sendVariableSetEvent(args: {');
    lines.push('    identifier: TVariableIdentification;');
    lines.push('    value: unknown;');
    lines.push('  }): void {');
    lines.push('    if (this.flowWeaverDebugger) {');
    lines.push('      this.flowWeaverDebugger.sendEvent({');
    lines.push('        type: "VARIABLE_SET",');
    lines.push('        ...args,');
    lines.push('        innerFlowInvocation: this.flowWeaverDebugger.innerFlowInvocation,');
    lines.push('      });');
    lines.push('    }');
    lines.push('  }');
    lines.push('');
    lines.push('  sendLogErrorEvent(args: {');
    lines.push('    nodeTypeName: string;');
    lines.push('    id: string;');
    lines.push('    scope?: string;');
    lines.push('    side?: "start" | "exit";');
    lines.push('    executionIndex: number;');
    lines.push('    error: string;');
    lines.push('  }): void {');
    lines.push('    if (this.flowWeaverDebugger) {');
    lines.push('      this.flowWeaverDebugger.sendEvent({');
    lines.push('        type: "LOG_ERROR",');
    lines.push('        ...args,');
    lines.push('        innerFlowInvocation: this.flowWeaverDebugger.innerFlowInvocation,');
    lines.push('      });');
    lines.push('    }');
    lines.push('  }');
    lines.push('');
    lines.push('  sendWorkflowCompletedEvent(args: {');
    lines.push('    executionIndex: number;');
    lines.push('    status: "SUCCEEDED" | "FAILED" | "CANCELLED";');
    lines.push('    result?: unknown;');
    lines.push('  }): void {');
    lines.push('    if (this.flowWeaverDebugger) {');
    lines.push('      this.flowWeaverDebugger.sendEvent({');
    lines.push('        type: "WORKFLOW_COMPLETED",');
    lines.push('        ...args,');
    lines.push('        innerFlowInvocation: this.flowWeaverDebugger.innerFlowInvocation,');
    lines.push('      });');
    lines.push('    }');
    lines.push('  }');
  } else {
    // Production mode: stub implementations (no-ops)
    lines.push('  sendStatusChangedEvent(_args: unknown): void {');
    lines.push('    // No-op in production mode');
    lines.push('  }');
    lines.push('');
    lines.push('  sendLogErrorEvent(_args: unknown): void {');
    lines.push('    // No-op in production mode');
    lines.push('  }');
    lines.push('');
    lines.push('  sendWorkflowCompletedEvent(_args: unknown): void {');
    lines.push('    // No-op in production mode');
    lines.push('  }');
  }

  // Serialize/restore methods (dev mode only, used by debug controller and checkpointing)
  if (!production) {
    lines.push('');
    lines.push('  serialize(): {');
    lines.push('    variables: Record<string, unknown>;');
    lines.push('    executions: Record<string, ExecutionInfo>;');
    lines.push('    executionCounter: number;');
    lines.push('    nodeExecutionCounts: Record<string, number>;');
    lines.push('  } {');
    lines.push('    const vars: Record<string, unknown> = {};');
    lines.push('    for (const [key, value] of this.variables) {');
    lines.push('      if (typeof value === "function") {');
    lines.push('        try { vars[key] = (value as () => unknown)(); } catch { vars[key] = value; }');
    lines.push('      } else {');
    lines.push('        vars[key] = value;');
    lines.push('      }');
    lines.push('    }');
    lines.push('    const execs: Record<string, ExecutionInfo> = {};');
    lines.push('    for (const [key, info] of this.executions) { execs[key] = { ...info }; }');
    lines.push('    const nodeCounts: Record<string, number> = {};');
    lines.push('    for (const [key, count] of this.nodeExecutionIndices) { nodeCounts[key] = count; }');
    lines.push('    return { variables: vars, executions: execs, executionCounter: this.executionCounter, nodeExecutionCounts: nodeCounts };');
    lines.push('  }');
    lines.push('');
    lines.push('  restore(data: {');
    lines.push('    variables: Record<string, unknown>;');
    lines.push('    executions: Record<string, ExecutionInfo>;');
    lines.push('    executionCounter: number;');
    lines.push('    nodeExecutionCounts: Record<string, number>;');
    lines.push('  }): void {');
    lines.push('    this.variables = new Map(Object.entries(data.variables));');
    lines.push('    this.executions = new Map(Object.entries(data.executions));');
    lines.push('    this.executionCounter = data.executionCounter;');
    lines.push('    this.nodeExecutionIndices = new Map(Object.entries(data.nodeExecutionCounts));');
    lines.push('  }');
  }

  lines.push('}');
  lines.push('');

  const output = lines.join('\n');
  if (outputFormat === 'javascript') {
    return stripTypeScript(output);
  }
  return output;
}

import type { TModuleFormat } from '../ast/types';

/**
 * Generates inline WebSocket debug client for auto-detection from env var
 * Only included in development mode builds
 *
 * @param moduleFormat - The module format to use for imports ('esm' or 'cjs')
 * @param outputFormat - Output format: 'typescript' (default) or 'javascript' (strips types)
 */
export function generateInlineDebugClient(moduleFormat: TModuleFormat = 'esm', outputFormat: TOutputFormat = 'typescript'): string {
  const lines: string[] = [];

  lines.push('// ============================================================================');
  lines.push('// Inline Debug Client (auto-created from FLOW_WEAVER_DEBUG env var)');
  lines.push('// ============================================================================');
  lines.push('');
  lines.push('/* eslint-disable @typescript-eslint/no-explicit-any, no-console */');
  lines.push(
    'function createFlowWeaverDebugClient(url: string, workflowExportName: string): any {'
  );
  lines.push('  let ws: any = null;');
  lines.push('  let connected = false;');
  lines.push('  let queue: string[] = [];');
  lines.push('  const sessionId = Math.random().toString(36).substring(2, 15);');
  lines.push('');
  lines.push('  const connect = async () => {');
  lines.push('    try {');
  lines.push("      // Node.js environment - dynamically load 'ws' package");

  // Generate format-appropriate import for 'ws' package
  if (moduleFormat === 'cjs') {
    // CommonJS: use require() directly
    lines.push("      const wsModule = require('ws');");
  } else {
    // ESM: use dynamic import
    lines.push("      const wsModule = await import('ws');");
  }

  lines.push('      const WS: any = wsModule.default || wsModule;');
  lines.push('      ws = new WS(url);');
  lines.push('');
  lines.push("      ws.on('open', () => {");
  lines.push('        connected = true;');
  lines.push('        // Send connect message');
  lines.push('        ws.send(JSON.stringify({');
  lines.push("          type: 'connect',");
  lines.push('          sessionId,');
  lines.push('          workflowExportName,');
  lines.push('          clientInfo: {');
  lines.push('            platform: process.platform,');
  lines.push('            nodeVersion: process.version,');
  lines.push('            pid: process.pid');
  lines.push('          }');
  lines.push('        }));');
  lines.push('');
  lines.push('        // Flush queued events');
  lines.push('        while (queue.length > 0) {');
  lines.push('          const msg = queue.shift();');
  lines.push('          if (ws.readyState === 1) ws.send(msg);');
  lines.push('        }');
  lines.push('      });');
  lines.push('');
  lines.push("      ws.on('error', () => { connected = false; });");
  lines.push("      ws.on('close', () => { connected = false; });");
  lines.push('    } catch (err: unknown) {');
  lines.push("      // Silently fail if 'ws' package not available");
  lines.push(
    "      console.warn('[Flow Weaver] Debug client failed to connect:', err instanceof Error ? err.message : String(err));"
  );
  lines.push('    }');
  lines.push('  };');
  lines.push('');
  lines.push('  return {');
  lines.push('    sendEvent: (event: unknown) => {');
  lines.push("      const message = JSON.stringify({ type: 'event', sessionId, event });");
  lines.push('      if (!ws) connect().catch(() => {});');
  lines.push('      if (connected && ws.readyState === 1) {');
  lines.push('        ws.send(message);');
  lines.push('      } else {');
  lines.push('        queue.push(message);');
  lines.push('      }');
  lines.push('    },');
  lines.push('    innerFlowInvocation: false,');
  lines.push('    sessionId');
  lines.push('  };');
  lines.push('}');
  lines.push('/* eslint-enable @typescript-eslint/no-explicit-any, no-console */');
  lines.push('');

  const output = lines.join('\n');
  if (outputFormat === 'javascript') {
    return stripTypeScript(output);
  }
  return output;
}

/**
 * Generates a standalone runtime module file for multi-workflow bundles.
 * This exports all runtime types and classes so individual workflow files can import them.
 *
 * @param production - Whether to generate production-optimized code (no debug events)
 * @param moduleFormat - The module format to use ('esm' or 'cjs')
 */
export function generateStandaloneRuntimeModule(
  production: boolean,
  moduleFormat: TModuleFormat = 'esm'
): string {
  const lines: string[] = [];

  lines.push('// ============================================================================');
  lines.push('// Shared Runtime Module');
  lines.push(getGeneratedBranding().header());
  lines.push('// ============================================================================');
  lines.push('');

  // Include the inline runtime (all types and GeneratedExecutionContext class)
  // Pass exportClasses=true to add 'export' keywords for module use
  const inlineRuntime = generateInlineRuntime(production, true);
  lines.push(inlineRuntime);
  lines.push('');

  // Include debug client in development mode
  if (!production) {
    const debugClient = generateInlineDebugClient(moduleFormat);
    // Add export to the createFlowWeaverDebugClient function
    const exportedDebugClient = debugClient.replace(
      'function createFlowWeaverDebugClient',
      'export function createFlowWeaverDebugClient'
    );
    lines.push(exportedDebugClient);
    lines.push('');
  }

  if (moduleFormat === 'cjs') {
    // CommonJS exports
    lines.push('// ============================================================================');
    lines.push('// Exports');
    lines.push('// ============================================================================');
    lines.push('');
    const exports = ['GeneratedExecutionContext', 'CancellationError'];
    if (!production) {
      exports.push('createFlowWeaverDebugClient', 'TDebugger');
    }
    lines.push(`module.exports = { ${exports.join(', ')} };`);
  }
  // For ESM, exports are added via 'export' keyword in the generated code

  lines.push('');

  return lines.join('\n');
}
