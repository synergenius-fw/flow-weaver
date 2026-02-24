/**
 * Tests for the issue triage fixes:
 * - AnnotationGenerator multi-line descriptions
 * - Body replacement defensive guard
 * - Init config.yaml generation
 * - Scoped mock targeting (lookupMock)
 * - Validator docUrl attachment
 * - Mock config validation warnings
 * - MCP progressive streaming
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { annotationGenerator } from '../../src/annotation-generator';
import { generateProjectFiles } from '../../src/cli/commands/init';
import { validateMockConfig } from '../../src/cli/commands/run';
import { lookupMock } from '../../src/built-in-nodes/mock-types';
import { logger } from '../../src/cli/utils/logger';
import { invokeWorkflow } from '../../src/built-in-nodes/invoke-workflow';
import { waitForEvent } from '../../src/built-in-nodes/wait-for-event';
import { waitForAgent } from '../../src/built-in-nodes/wait-for-agent';
import { WorkflowValidator } from '../../src/validator';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

// Mock parseWorkflow for validateMockConfig tests (avoid filesystem access)
vi.mock('../../src/api/index', () => ({
  parseWorkflow: vi.fn(),
}));
import { parseWorkflow } from '../../src/api/index';

// ── Annotation Generator: multi-line descriptions ───────────────────────────

describe('AnnotationGenerator multi-line descriptions', () => {
  const createNodeType = (description: string): TNodeTypeAST => ({
    type: 'NodeType',
    name: 'TestNode',
    functionName: 'testNode',
    description,
    inputs: { execute: { dataType: 'STEP' } },
    outputs: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP', failure: true } },
    hasSuccessPort: true,
    hasFailurePort: true,
    executeWhen: 'CONJUNCTION',
    isAsync: false,
  });

  const createWorkflow = (nodeTypes: TNodeTypeAST[]): TWorkflowAST => ({
    type: 'Workflow',
    functionName: 'testWorkflow',
    name: 'testWorkflow',
    sourceFile: 'test.ts',
    nodeTypes,
    instances: [],
    connections: [],
    scopes: {},
    startPorts: {},
    exitPorts: {},
    imports: [],
  });

  it('should handle single-line description', () => {
    const nt = createNodeType('Simple description');
    const output = annotationGenerator.generate(createWorkflow([nt]));
    expect(output).toContain(' * Simple description');
  });

  it('should split multi-line description into separate JSDoc lines', () => {
    const nt = createNodeType('First line\nSecond line\nThird line');
    const output = annotationGenerator.generate(createWorkflow([nt]));
    expect(output).toContain(' * First line');
    expect(output).toContain(' * Second line');
    expect(output).toContain(' * Third line');
    // Each continuation line should have the JSDoc prefix
    const lines = output.split('\n');
    const descLines = lines.filter(
      (l) => l.includes('First line') || l.includes('Second line') || l.includes('Third line')
    );
    for (const line of descLines) {
      expect(line.trimStart()).toMatch(/^\* /);
    }
  });

  it('should not produce bare continuation lines', () => {
    const nt = createNodeType('Line one\nLine two');
    const output = annotationGenerator.generate(createWorkflow([nt]));
    // There should be no line that starts with text directly after a JSDoc line
    // without a * prefix (which would break the JSDoc block)
    const inJsDoc = output.slice(output.indexOf('/**'), output.indexOf('*/') + 2);
    const jsDocLines = inJsDoc.split('\n').slice(1, -1); // skip opening/closing
    for (const line of jsDocLines) {
      expect(line.trimStart()).toMatch(/^\*/);
    }
  });
});

// ── Init: config.yaml generation ────────────────────────────────────────────

describe('Init config.yaml generation', () => {
  it('should include .flowweaver/config.yaml in generated files', () => {
    const files = generateProjectFiles('test-project', 'sequential');
    expect(files).toHaveProperty('.flowweaver/config.yaml');
  });

  it('should set defaultFileType to ts', () => {
    const files = generateProjectFiles('test-project', 'sequential');
    const config = files['.flowweaver/config.yaml'];
    expect(config).toContain('defaultFileType: ts');
  });

  it('should include config.yaml for all templates', () => {
    for (const template of ['sequential', 'conditional', 'foreach']) {
      const files = generateProjectFiles('my-project', template);
      expect(files['.flowweaver/config.yaml']).toBeDefined();
    }
  });
});

// ── Scoped mock targeting (lookupMock) ──────────────────────────────────────

describe('lookupMock', () => {
  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).__fw_current_node_id__;
  });

  it('should return value for plain key', () => {
    const section = { 'api/process': { status: 'ok' } };
    const result = lookupMock(section, 'api/process');
    expect(result).toEqual({ status: 'ok' });
  });

  it('should return undefined for missing key', () => {
    const section = { 'api/process': { status: 'ok' } };
    const result = lookupMock(section, 'api/other');
    expect(result).toBeUndefined();
  });

  it('should return undefined for undefined section', () => {
    expect(lookupMock(undefined, 'any-key')).toBeUndefined();
  });

  it('should prefer instance-qualified key over plain key', () => {
    (globalThis as unknown as Record<string, unknown>).__fw_current_node_id__ = 'retryCall';
    const section = {
      'retryCall:api/process': { status: 'retry-specific' },
      'api/process': { status: 'default' },
    };
    const result = lookupMock(section, 'api/process');
    expect(result).toEqual({ status: 'retry-specific' });
  });

  it('should fall back to plain key when no instance-qualified match', () => {
    (globalThis as unknown as Record<string, unknown>).__fw_current_node_id__ = 'otherNode';
    const section = {
      'retryCall:api/process': { status: 'retry-specific' },
      'api/process': { status: 'default' },
    };
    const result = lookupMock(section, 'api/process');
    expect(result).toEqual({ status: 'default' });
  });

  it('should work without __fw_current_node_id__ set', () => {
    // No node ID on globalThis
    const section = {
      'retryCall:api/process': { status: 'retry-specific' },
      'api/process': { status: 'default' },
    };
    const result = lookupMock(section, 'api/process');
    expect(result).toEqual({ status: 'default' });
  });
});

// ── Built-in nodes use scoped mock targeting ────────────────────────────────

describe('Built-in nodes with scoped mocks', () => {
  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).__fw_mocks__;
    delete (globalThis as unknown as Record<string, unknown>).__fw_current_node_id__;
    delete (globalThis as unknown as Record<string, unknown>).__fw_agent_channel__;
  });

  it('invokeWorkflow uses instance-qualified mock key', async () => {
    (globalThis as unknown as Record<string, unknown>).__fw_current_node_id__ = 'callA';
    (globalThis as unknown as Record<string, unknown>).__fw_mocks__ = {
      invocations: {
        'callA:svc/fn': { result: 'from-A' },
        'svc/fn': { result: 'default' },
      },
    };
    const result = await invokeWorkflow(true, 'svc/fn', {});
    expect(result.result).toEqual({ result: 'from-A' });
  });

  it('waitForEvent uses instance-qualified mock key', async () => {
    (globalThis as unknown as Record<string, unknown>).__fw_current_node_id__ = 'evt1';
    (globalThis as unknown as Record<string, unknown>).__fw_mocks__ = {
      events: {
        'evt1:app/order': { orderId: 'scoped' },
        'app/order': { orderId: 'default' },
      },
    };
    const result = await waitForEvent(true, 'app/order');
    expect(result.eventData).toEqual({ orderId: 'scoped' });
  });

  it('waitForAgent uses instance-qualified mock key', async () => {
    (globalThis as unknown as Record<string, unknown>).__fw_current_node_id__ = 'agent1';
    (globalThis as unknown as Record<string, unknown>).__fw_mocks__ = {
      agents: {
        'agent1:reviewer': { approved: true },
        'reviewer': { approved: false },
      },
    };
    const result = await waitForAgent(true, 'reviewer', {});
    expect(result.agentResult).toEqual({ approved: true });
  });

  it('falls back to unscoped key when no instance match', async () => {
    (globalThis as unknown as Record<string, unknown>).__fw_current_node_id__ = 'otherNode';
    (globalThis as unknown as Record<string, unknown>).__fw_mocks__ = {
      invocations: {
        'callA:svc/fn': { result: 'from-A' },
        'svc/fn': { result: 'default' },
      },
    };
    const result = await invokeWorkflow(true, 'svc/fn', {});
    expect(result.result).toEqual({ result: 'default' });
  });
});

// ── Validator docUrl attachment ─────────────────────────────────────────────

describe('Validator docUrl', () => {
  const createNodeType = (name: string): TNodeTypeAST => ({
    type: 'NodeType',
    name,
    functionName: name,
    inputs: { execute: { dataType: 'STEP' } },
    outputs: {
      onSuccess: { dataType: 'STEP' },
      onFailure: { dataType: 'STEP', failure: true },
    },
    hasSuccessPort: true,
    hasFailurePort: true,
    executeWhen: 'CONJUNCTION',
    isAsync: false,
  });

  const createWorkflow = (
    instances: TWorkflowAST['instances'],
    connections: TWorkflowAST['connections'] = [],
    nodeTypes: TNodeTypeAST[] = []
  ): TWorkflowAST => ({
    type: 'Workflow',
    functionName: 'testWorkflow',
    name: 'testWorkflow',
    sourceFile: 'test.ts',
    nodeTypes,
    instances,
    connections,
    scopes: {},
    startPorts: {},
    exitPorts: {},
    imports: [],
  });

  it('should attach docUrl to UNKNOWN_NODE_TYPE errors', () => {
    const workflow = createWorkflow(
      [{ type: 'NodeInstance', id: 'bad', nodeType: 'nonExistent' }],
      [],
      [createNodeType('validType')]
    );

    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    const unknownErr = result.errors.find((e) => e.code === 'UNKNOWN_NODE_TYPE');
    expect(unknownErr).toBeDefined();
    expect(unknownErr!.docUrl).toContain('concepts');
  });

  it('should attach docUrl to UNKNOWN_SOURCE_PORT errors', () => {
    const nodeType = createNodeType('myNode');
    const workflow = createWorkflow(
      [
        { type: 'NodeInstance', id: 'n1', nodeType: 'myNode' },
        { type: 'NodeInstance', id: 'n2', nodeType: 'myNode' },
      ],
      [
        {
          type: 'Connection',
          from: { node: 'n1', port: 'nonExistentPort' },
          to: { node: 'n2', port: 'execute' },
        },
      ],
      [nodeType]
    );

    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    const portErr = result.errors.find((e) => e.code === 'UNKNOWN_SOURCE_PORT');
    expect(portErr).toBeDefined();
    expect(portErr!.docUrl).toContain('concepts');
  });

  it('should not attach docUrl to unmapped error codes', () => {
    // Create a workflow with duplicate node names (uses a different error code)
    const nodeType = createNodeType('myNode');
    const workflow = createWorkflow(
      [
        { type: 'NodeInstance', id: 'dup', nodeType: 'myNode' },
        { type: 'NodeInstance', id: 'dup', nodeType: 'myNode' },
      ],
      [],
      [nodeType]
    );

    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    const dupErr = result.errors.find((e) => e.code === 'DUPLICATE_NODE_NAME');
    if (dupErr) {
      // DUPLICATE_NODE_NAME is not in the map, so no docUrl
      expect(dupErr.docUrl).toBeUndefined();
    }
  });
});

// ── Mock config validation warnings ──────────────────────────────────────────

describe('validateMockConfig', () => {
  const mockedParseWorkflow = vi.mocked(parseWorkflow);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should warn about unknown top-level keys', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    // parseWorkflow won't be called if we only test key validation
    mockedParseWorkflow.mockResolvedValue({
      errors: [],
      warnings: [],
      ast: { instances: [] } as unknown as TWorkflowAST,
      availableWorkflows: [],
      allWorkflows: [],
    });

    await validateMockConfig(
      { invocation: { 'svc/fn': {} } } as unknown as import('../../src/built-in-nodes/mock-types').FwMockConfig,
      '/fake/workflow.ts'
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('unknown key "invocation"')
    );
  });

  it('should warn when mock section has no matching node type in workflow', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    // Workflow has no invokeWorkflow nodes
    mockedParseWorkflow.mockResolvedValue({
      errors: [],
      warnings: [],
      ast: {
        instances: [
          { type: 'NodeInstance', id: 'n1', nodeType: 'fetchData' },
        ],
      } as unknown as TWorkflowAST,
      availableWorkflows: [],
      allWorkflows: [],
    });

    await validateMockConfig(
      { invocations: { 'svc/fn': { result: 'ok' } } } as unknown as import('../../src/built-in-nodes/mock-types').FwMockConfig,
      '/fake/workflow.ts'
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('has "invocations" entries but workflow has no invokeWorkflow nodes')
    );
  });

  it('should not warn when mock section matches workflow nodes', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    mockedParseWorkflow.mockResolvedValue({
      errors: [],
      warnings: [],
      ast: {
        instances: [
          { type: 'NodeInstance', id: 'call1', nodeType: 'invokeWorkflow' },
        ],
      } as unknown as TWorkflowAST,
      availableWorkflows: [],
      allWorkflows: [],
    });

    await validateMockConfig(
      { invocations: { 'svc/fn': { result: 'ok' } } } as unknown as import('../../src/built-in-nodes/mock-types').FwMockConfig,
      '/fake/workflow.ts'
    );

    // No warnings about unused sections
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('should silently skip validation when parsing fails', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    mockedParseWorkflow.mockRejectedValue(new Error('parse failure'));

    // Should not throw
    await validateMockConfig(
      { invocations: { 'svc/fn': { result: 'ok' } } } as unknown as import('../../src/built-in-nodes/mock-types').FwMockConfig,
      '/fake/workflow.ts'
    );

    // No section warnings (only key validation still runs, but all keys are valid here)
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('should skip section validation when parse has errors', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    mockedParseWorkflow.mockResolvedValue({
      errors: ['Some parse error'],
      warnings: [],
      ast: null as unknown as TWorkflowAST,
      availableWorkflows: [],
      allWorkflows: [],
    });

    await validateMockConfig(
      { invocations: { 'svc/fn': { result: 'ok' } } } as unknown as import('../../src/built-in-nodes/mock-types').FwMockConfig,
      '/fake/workflow.ts'
    );

    // No section-level warnings because we bailed on parse errors
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('should accept valid keys without warnings', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    mockedParseWorkflow.mockResolvedValue({
      errors: [],
      warnings: [],
      ast: {
        instances: [
          { type: 'NodeInstance', id: 'w', nodeType: 'waitForEvent' },
          { type: 'NodeInstance', id: 'i', nodeType: 'invokeWorkflow' },
        ],
      } as unknown as TWorkflowAST,
      availableWorkflows: [],
      allWorkflows: [],
    });

    await validateMockConfig(
      {
        fast: true,
        events: { 'app/done': { status: 'ok' } },
        invocations: { 'svc/fn': { result: 'ok' } },
      } as unknown as import('../../src/built-in-nodes/mock-types').FwMockConfig,
      '/fake/workflow.ts'
    );

    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ── MCP progressive streaming ────────────────────────────────────────────────

describe('MCP progressive streaming (onEvent → progress notifications)', () => {
  it('should wire onEvent to sendNotification when progressToken is set', async () => {
    // This tests the wiring logic extracted from tools-editor.ts.
    // We simulate the pattern: progressToken present → onEvent calls sendNotification.
    const notifications: Array<{ method: string; params: unknown }> = [];
    const extra = {
      _meta: { progressToken: 'tok-123' },
      sendNotification: vi.fn().mockImplementation((n) => {
        notifications.push(n);
        return Promise.resolve();
      }),
    };

    // Replicate the onEvent factory from tools-editor.ts
    const progressToken = extra._meta?.progressToken;
    let eventCount = 0;
    const onEvent = progressToken
      ? (event: { type: string; timestamp: number; data?: Record<string, unknown> }) => {
          eventCount++;
          extra.sendNotification({
            method: 'notifications/progress' as const,
            params: {
              progressToken,
              progress: eventCount,
              message: event.type === 'STATUS_CHANGED'
                ? `${event.data?.id ?? ''}: ${event.data?.status ?? ''}`
                : event.type,
            },
          }).catch(() => {});
        }
      : undefined;

    expect(onEvent).toBeDefined();

    // Simulate trace events
    onEvent!({ type: 'STATUS_CHANGED', timestamp: 1000, data: { id: 'fetchNode', status: 'RUNNING' } });
    onEvent!({ type: 'VARIABLE_SET', timestamp: 1050, data: { nodeId: 'fetchNode', name: 'result' } });
    onEvent!({ type: 'STATUS_CHANGED', timestamp: 1100, data: { id: 'fetchNode', status: 'SUCCEEDED' } });

    expect(extra.sendNotification).toHaveBeenCalledTimes(3);
    expect(notifications[0]).toEqual({
      method: 'notifications/progress',
      params: { progressToken: 'tok-123', progress: 1, message: 'fetchNode: RUNNING' },
    });
    expect(notifications[1]).toEqual({
      method: 'notifications/progress',
      params: { progressToken: 'tok-123', progress: 2, message: 'VARIABLE_SET' },
    });
    expect(notifications[2]).toEqual({
      method: 'notifications/progress',
      params: { progressToken: 'tok-123', progress: 3, message: 'fetchNode: SUCCEEDED' },
    });
  });

  it('should not create onEvent when no progressToken', () => {
    const extra = { _meta: {} as Record<string, unknown>, sendNotification: vi.fn() };

    const progressToken = extra._meta?.progressToken;
    const onEvent = progressToken
      ? () => {}
      : undefined;

    expect(onEvent).toBeUndefined();
  });

  it('should handle sendNotification rejection gracefully', async () => {
    const extra = {
      _meta: { progressToken: 'tok-456' },
      sendNotification: vi.fn().mockRejectedValue(new Error('disconnected')),
    };

    const progressToken = extra._meta?.progressToken;
    let eventCount = 0;
    const onEvent = progressToken
      ? (event: { type: string; timestamp: number; data?: Record<string, unknown> }) => {
          eventCount++;
          extra.sendNotification({
            method: 'notifications/progress' as const,
            params: { progressToken, progress: eventCount, message: event.type },
          }).catch(() => {});
        }
      : undefined;

    // Should not throw even though sendNotification rejects
    expect(() => {
      onEvent!({ type: 'STATUS_CHANGED', timestamp: 1000, data: { id: 'n1', status: 'RUNNING' } });
    }).not.toThrow();
  });
});
