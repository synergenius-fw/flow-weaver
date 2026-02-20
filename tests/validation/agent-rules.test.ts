/**
 * Tests for agent-specific validation rules
 *
 * Each rule is tested with:
 * 1. Positive case — triggers the rule
 * 2. Negative case — satisfies the rule
 * 3. Edge cases — renamed nodes, expression nodes, etc.
 */

import {
  missingErrorHandlerRule,
  unguardedToolExecutorRule,
  missingMemoryInLoopRule,
  llmWithoutFallbackRule,
  toolNoOutputHandlingRule,
  getAgentValidationRules,
} from '../../src/validation/agent-rules';
import type {
  TWorkflowAST,
  TNodeTypeAST,
  TNodeInstanceAST,
  TConnectionAST,
} from '../../src/ast/types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeNodeType(overrides: Partial<TNodeTypeAST> = {}): TNodeTypeAST {
  return {
    type: 'NodeType',
    name: overrides.name || 'testNode',
    functionName: overrides.functionName || overrides.name || 'testNode',
    inputs: overrides.inputs || {},
    outputs: overrides.outputs || {},
    hasSuccessPort: overrides.hasSuccessPort ?? false,
    hasFailurePort: overrides.hasFailurePort ?? false,
    executeWhen: overrides.executeWhen || ('PULL_ANY' as TNodeTypeAST['executeWhen']),
    isAsync: overrides.isAsync ?? false,
    visuals: overrides.visuals,
    ...overrides,
  };
}

function makeInstance(id: string, nodeType: string, parent?: { id: string; scope: string }): TNodeInstanceAST {
  return {
    type: 'NodeInstance',
    id,
    nodeType,
    ...(parent ? { parent } : {}),
  };
}

function conn(fromNode: string, fromPort: string, toNode: string, toPort: string): TConnectionAST {
  return {
    type: 'Connection',
    from: { node: fromNode, port: fromPort },
    to: { node: toNode, port: toPort },
  };
}

function makeWorkflow(overrides: Partial<TWorkflowAST> = {}): TWorkflowAST {
  return {
    type: 'Workflow',
    sourceFile: 'test.ts',
    name: 'testWorkflow',
    functionName: 'testWorkflow',
    nodeTypes: overrides.nodeTypes || [],
    instances: overrides.instances || [],
    connections: overrides.connections || [],
    startPorts: overrides.startPorts || {},
    exitPorts: overrides.exitPorts || {},
    imports: [],
    ...overrides,
  };
}

/** LLM node type with standard ports */
function llmNodeType(name = 'llmCall'): TNodeTypeAST {
  return makeNodeType({
    name,
    functionName: name,
    inputs: {
      execute: { dataType: 'STEP' as any },
      messages: { dataType: 'OBJECT' as any },
      tools: { dataType: 'OBJECT' as any },
    },
    outputs: {
      onSuccess: { dataType: 'STEP' as any },
      onFailure: { dataType: 'STEP' as any },
      content: { dataType: 'STRING' as any },
      toolCalls: { dataType: 'OBJECT' as any },
    },
    hasSuccessPort: true,
    hasFailurePort: true,
  });
}

/** Tool executor node type with standard ports */
function toolNodeType(name = 'executeTool'): TNodeTypeAST {
  return makeNodeType({
    name,
    functionName: name,
    inputs: {
      execute: { dataType: 'STEP' as any },
      toolCall: { dataType: 'OBJECT' as any },
    },
    outputs: {
      onSuccess: { dataType: 'STEP' as any },
      onFailure: { dataType: 'STEP' as any },
      result: { dataType: 'ANY' as any },
      resultMessage: { dataType: 'OBJECT' as any },
      toolName: { dataType: 'STRING' as any },
    },
    hasSuccessPort: true,
    hasFailurePort: true,
  });
}

/** Human approval node type */
function approvalNodeType(name = 'humanApproval'): TNodeTypeAST {
  return makeNodeType({
    name,
    functionName: name,
    inputs: {
      execute: { dataType: 'STEP' as any },
      action: { dataType: 'STRING' as any },
    },
    outputs: {
      onSuccess: { dataType: 'STEP' as any },
      onFailure: { dataType: 'STEP' as any },
      approved: { dataType: 'STEP' as any },
      rejected: { dataType: 'STEP' as any },
    },
    hasSuccessPort: true,
    hasFailurePort: true,
  });
}

/** Memory node type */
function memoryNodeType(name = 'conversationMemory'): TNodeTypeAST {
  return makeNodeType({
    name,
    functionName: name,
    inputs: {
      execute: { dataType: 'STEP' as any },
      conversationId: { dataType: 'STRING' as any },
      newMessage: { dataType: 'OBJECT' as any },
    },
    outputs: {
      onSuccess: { dataType: 'STEP' as any },
      onFailure: { dataType: 'STEP' as any },
      messages: { dataType: 'OBJECT' as any },
      messageCount: { dataType: 'NUMBER' as any },
    },
    hasSuccessPort: true,
    hasFailurePort: true,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('agent validation rules', () => {
  describe('AGENT_LLM_MISSING_ERROR_HANDLER', () => {
    it('should error when LLM onFailure is unconnected', () => {
      const ast = makeWorkflow({
        nodeTypes: [llmNodeType()],
        instances: [makeInstance('llm', 'llmCall')],
        connections: [
          conn('Start', 'execute', 'llm', 'execute'),
          conn('llm', 'onSuccess', 'Exit', 'onSuccess'),
          // NO onFailure connection
        ],
      });

      const errors = missingErrorHandlerRule.validate(ast);
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('AGENT_LLM_MISSING_ERROR_HANDLER');
      expect(errors[0].type).toBe('error');
      expect(errors[0].node).toBe('llm');
    });

    it('should pass when LLM onFailure is connected', () => {
      const ast = makeWorkflow({
        nodeTypes: [llmNodeType()],
        instances: [makeInstance('llm', 'llmCall')],
        connections: [
          conn('Start', 'execute', 'llm', 'execute'),
          conn('llm', 'onSuccess', 'Exit', 'onSuccess'),
          conn('llm', 'onFailure', 'Exit', 'onFailure'),
        ],
      });

      const errors = missingErrorHandlerRule.validate(ast);
      expect(errors).toHaveLength(0);
    });

    it('should not trigger for non-LLM nodes', () => {
      const addType = makeNodeType({
        name: 'add',
        inputs: { a: { dataType: 'NUMBER' as any } },
        outputs: { result: { dataType: 'NUMBER' as any } },
      });

      const ast = makeWorkflow({
        nodeTypes: [addType],
        instances: [makeInstance('adder', 'add')],
        connections: [],
      });

      const errors = missingErrorHandlerRule.validate(ast);
      expect(errors).toHaveLength(0);
    });

    it('should detect LLM with renamed function via port signature', () => {
      // User renamed llmCall to "fetchAnswer" but ports reveal it's an LLM
      const renamedLlm = llmNodeType('fetchAnswer');
      renamedLlm.name = 'fetchAnswer';
      renamedLlm.functionName = 'fetchAnswer';

      const ast = makeWorkflow({
        nodeTypes: [renamedLlm],
        instances: [makeInstance('fetch', 'fetchAnswer')],
        connections: [
          conn('Start', 'execute', 'fetch', 'execute'),
          conn('fetch', 'onSuccess', 'Exit', 'onSuccess'),
        ],
      });

      const errors = missingErrorHandlerRule.validate(ast);
      expect(errors).toHaveLength(1);
      expect(errors[0].node).toBe('fetch');
    });
  });

  describe('AGENT_UNGUARDED_TOOL_EXECUTOR', () => {
    it('should warn when tool executor has no approval upstream', () => {
      const ast = makeWorkflow({
        nodeTypes: [llmNodeType(), toolNodeType()],
        instances: [
          makeInstance('llm', 'llmCall'),
          makeInstance('tool', 'executeTool'),
        ],
        connections: [
          conn('Start', 'execute', 'llm', 'execute'),
          conn('llm', 'onSuccess', 'tool', 'execute'),
          conn('llm', 'toolCalls', 'tool', 'toolCall'),
          conn('tool', 'onSuccess', 'Exit', 'onSuccess'),
        ],
      });

      const errors = unguardedToolExecutorRule.validate(ast);
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('AGENT_UNGUARDED_TOOL_EXECUTOR');
      expect(errors[0].type).toBe('warning');
      expect(errors[0].node).toBe('tool');
    });

    it('should pass when approval node is upstream of tool executor', () => {
      const ast = makeWorkflow({
        nodeTypes: [llmNodeType(), approvalNodeType(), toolNodeType()],
        instances: [
          makeInstance('llm', 'llmCall'),
          makeInstance('approval', 'humanApproval'),
          makeInstance('tool', 'executeTool'),
        ],
        connections: [
          conn('Start', 'execute', 'llm', 'execute'),
          conn('llm', 'onSuccess', 'approval', 'execute'),
          conn('approval', 'approved', 'tool', 'execute'),
          conn('llm', 'toolCalls', 'tool', 'toolCall'),
          conn('tool', 'onSuccess', 'Exit', 'onSuccess'),
        ],
      });

      const errors = unguardedToolExecutorRule.validate(ast);
      expect(errors).toHaveLength(0);
    });

    it('should not trigger when no tool executors exist', () => {
      const ast = makeWorkflow({
        nodeTypes: [llmNodeType()],
        instances: [makeInstance('llm', 'llmCall')],
        connections: [],
      });

      const errors = unguardedToolExecutorRule.validate(ast);
      expect(errors).toHaveLength(0);
    });
  });

  describe('AGENT_MISSING_MEMORY_IN_LOOP', () => {
    it('should warn when loop scope has LLM but no memory', () => {
      const ast = makeWorkflow({
        nodeTypes: [llmNodeType()],
        instances: [makeInstance('llm', 'llmCall')],
        connections: [],
        scopes: { 'agent.iteration': ['llm'] },
      });

      const errors = missingMemoryInLoopRule.validate(ast);
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('AGENT_MISSING_MEMORY_IN_LOOP');
      expect(errors[0].type).toBe('warning');
      expect(errors[0].message).toContain('agent.iteration');
    });

    it('should pass when loop has both LLM and memory', () => {
      const ast = makeWorkflow({
        nodeTypes: [llmNodeType(), memoryNodeType()],
        instances: [
          makeInstance('llm', 'llmCall'),
          makeInstance('mem', 'conversationMemory'),
        ],
        connections: [],
        scopes: { 'agent.iteration': ['llm', 'mem'] },
      });

      const errors = missingMemoryInLoopRule.validate(ast);
      expect(errors).toHaveLength(0);
    });

    it('should not trigger for scopes without LLM nodes', () => {
      const addType = makeNodeType({
        name: 'add',
        inputs: { a: { dataType: 'NUMBER' as any } },
        outputs: { result: { dataType: 'NUMBER' as any } },
      });

      const ast = makeWorkflow({
        nodeTypes: [addType],
        instances: [makeInstance('adder', 'add')],
        connections: [],
        scopes: { 'loop.iteration': ['adder'] },
      });

      const errors = missingMemoryInLoopRule.validate(ast);
      expect(errors).toHaveLength(0);
    });

    it('should not trigger when no scopes exist', () => {
      const ast = makeWorkflow({
        nodeTypes: [llmNodeType()],
        instances: [makeInstance('llm', 'llmCall')],
        connections: [],
      });

      const errors = missingMemoryInLoopRule.validate(ast);
      expect(errors).toHaveLength(0);
    });
  });

  describe('AGENT_LLM_NO_FALLBACK', () => {
    it('should warn when LLM onFailure goes directly to Exit', () => {
      const ast = makeWorkflow({
        nodeTypes: [llmNodeType()],
        instances: [makeInstance('llm', 'llmCall')],
        connections: [
          conn('Start', 'execute', 'llm', 'execute'),
          conn('llm', 'onSuccess', 'Exit', 'onSuccess'),
          conn('llm', 'onFailure', 'Exit', 'onFailure'),
        ],
      });

      const errors = llmWithoutFallbackRule.validate(ast);
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('AGENT_LLM_NO_FALLBACK');
      expect(errors[0].type).toBe('warning');
      expect(errors[0].node).toBe('llm');
    });

    it('should pass when LLM onFailure goes to a retry/fallback node', () => {
      const retryType = makeNodeType({
        name: 'retry',
        inputs: { execute: { dataType: 'STEP' as any } },
        outputs: { onSuccess: { dataType: 'STEP' as any } },
        hasSuccessPort: true,
      });

      const ast = makeWorkflow({
        nodeTypes: [llmNodeType(), retryType],
        instances: [
          makeInstance('llm', 'llmCall'),
          makeInstance('retryNode', 'retry'),
        ],
        connections: [
          conn('Start', 'execute', 'llm', 'execute'),
          conn('llm', 'onSuccess', 'Exit', 'onSuccess'),
          conn('llm', 'onFailure', 'retryNode', 'execute'),
          conn('retryNode', 'onSuccess', 'Exit', 'onSuccess'),
        ],
      });

      const errors = llmWithoutFallbackRule.validate(ast);
      expect(errors).toHaveLength(0);
    });

    it('should not trigger when onFailure is unconnected (Rule 1 handles that)', () => {
      const ast = makeWorkflow({
        nodeTypes: [llmNodeType()],
        instances: [makeInstance('llm', 'llmCall')],
        connections: [
          conn('Start', 'execute', 'llm', 'execute'),
          conn('llm', 'onSuccess', 'Exit', 'onSuccess'),
        ],
      });

      const errors = llmWithoutFallbackRule.validate(ast);
      expect(errors).toHaveLength(0);
    });
  });

  describe('AGENT_TOOL_NO_OUTPUT_HANDLING', () => {
    it('should warn when tool data outputs are all unconnected', () => {
      const ast = makeWorkflow({
        nodeTypes: [toolNodeType()],
        instances: [makeInstance('tool', 'executeTool')],
        connections: [
          conn('Start', 'execute', 'tool', 'execute'),
          conn('tool', 'onSuccess', 'Exit', 'onSuccess'),
          // No data output connections — result, resultMessage, toolName all unconnected
        ],
      });

      const errors = toolNoOutputHandlingRule.validate(ast);
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('AGENT_TOOL_NO_OUTPUT_HANDLING');
      expect(errors[0].type).toBe('warning');
      expect(errors[0].node).toBe('tool');
      expect(errors[0].message).toContain('result');
    });

    it('should pass when at least one data output is connected', () => {
      const ast = makeWorkflow({
        nodeTypes: [toolNodeType()],
        instances: [makeInstance('tool', 'executeTool')],
        connections: [
          conn('Start', 'execute', 'tool', 'execute'),
          conn('tool', 'onSuccess', 'Exit', 'onSuccess'),
          conn('tool', 'result', 'Exit', 'result'), // at least one data output connected
        ],
      });

      const errors = toolNoOutputHandlingRule.validate(ast);
      expect(errors).toHaveLength(0);
    });

    it('should not trigger for non-tool nodes', () => {
      const ast = makeWorkflow({
        nodeTypes: [llmNodeType()],
        instances: [makeInstance('llm', 'llmCall')],
        connections: [
          conn('Start', 'execute', 'llm', 'execute'),
          conn('llm', 'onSuccess', 'Exit', 'onSuccess'),
        ],
      });

      const errors = toolNoOutputHandlingRule.validate(ast);
      expect(errors).toHaveLength(0);
    });
  });

  describe('getAgentValidationRules', () => {
    it('should return all 5 rules', () => {
      const rules = getAgentValidationRules();
      expect(rules).toHaveLength(5);
      expect(rules.map((r) => r.name).sort()).toEqual([
        'AGENT_LLM_MISSING_ERROR_HANDLER',
        'AGENT_LLM_NO_FALLBACK',
        'AGENT_MISSING_MEMORY_IN_LOOP',
        'AGENT_TOOL_NO_OUTPUT_HANDLING',
        'AGENT_UNGUARDED_TOOL_EXECUTOR',
      ]);
    });

    it('should not produce errors for an empty workflow', () => {
      const ast = makeWorkflow();
      const rules = getAgentValidationRules();
      const allErrors = rules.flatMap((r) => r.validate(ast));
      expect(allErrors).toHaveLength(0);
    });

    it('should not produce errors for a non-agent workflow', () => {
      const addType = makeNodeType({
        name: 'add',
        inputs: { a: { dataType: 'NUMBER' as any }, b: { dataType: 'NUMBER' as any } },
        outputs: { result: { dataType: 'NUMBER' as any } },
      });

      const ast = makeWorkflow({
        nodeTypes: [addType],
        instances: [makeInstance('adder', 'add')],
        connections: [
          conn('Start', 'a', 'adder', 'a'),
          conn('adder', 'result', 'Exit', 'result'),
        ],
      });

      const rules = getAgentValidationRules();
      const allErrors = rules.flatMap((r) => r.validate(ast));
      expect(allErrors).toHaveLength(0);
    });
  });

  describe('regression: renamed function detection', () => {
    it('should detect agent nodes by port signature even with unusual names', () => {
      // Simulate a user who renamed llmCall to "queryModel" and executeTool to "runAction"
      const renamedLlm = llmNodeType('queryModel');
      renamedLlm.name = 'queryModel';
      renamedLlm.functionName = 'queryModel';

      const renamedTool = toolNodeType('runAction');
      renamedTool.name = 'runAction';
      renamedTool.functionName = 'runAction';

      const ast = makeWorkflow({
        nodeTypes: [renamedLlm, renamedTool],
        instances: [
          makeInstance('model', 'queryModel'),
          makeInstance('action', 'runAction'),
        ],
        connections: [
          conn('Start', 'execute', 'model', 'execute'),
          conn('model', 'onSuccess', 'action', 'execute'),
          conn('model', 'toolCalls', 'action', 'toolCall'),
          conn('action', 'onSuccess', 'Exit', 'onSuccess'),
          // No onFailure, no approval, no output handling
        ],
      });

      // Rule 1: LLM missing error handler
      const rule1Errors = missingErrorHandlerRule.validate(ast);
      expect(rule1Errors).toHaveLength(1);
      expect(rule1Errors[0].node).toBe('model');

      // Rule 2: Unguarded tool executor
      const rule2Errors = unguardedToolExecutorRule.validate(ast);
      expect(rule2Errors).toHaveLength(1);
      expect(rule2Errors[0].node).toBe('action');

      // Rule 5: Tool no output handling
      const rule5Errors = toolNoOutputHandlingRule.validate(ast);
      expect(rule5Errors).toHaveLength(1);
      expect(rule5Errors[0].node).toBe('action');
    });
  });

  describe('regression: icon-based detection works for rules', () => {
    it('should detect LLM via icon annotation and trigger missing error handler', () => {
      const iconLlm = makeNodeType({
        name: 'smartNode',
        functionName: 'smartNode',
        inputs: { execute: { dataType: 'STEP' as any }, prompt: { dataType: 'STRING' as any } },
        outputs: {
          onSuccess: { dataType: 'STEP' as any },
          onFailure: { dataType: 'STEP' as any },
          // Has messages input missing — not detected by port signature
          // But has psychology icon
          response: { dataType: 'STRING' as any },
        },
        hasSuccessPort: true,
        hasFailurePort: true,
        visuals: { icon: 'psychology', color: 'purple' },
      });

      const ast = makeWorkflow({
        nodeTypes: [iconLlm],
        instances: [makeInstance('smart', 'smartNode')],
        connections: [
          conn('Start', 'execute', 'smart', 'execute'),
          conn('smart', 'onSuccess', 'Exit', 'onSuccess'),
        ],
      });

      const errors = missingErrorHandlerRule.validate(ast);
      expect(errors).toHaveLength(1);
      expect(errors[0].node).toBe('smart');
    });
  });
});
