/**
 * Tests for agent node role detection
 *
 * Tests the multi-signal detection hierarchy:
 * 1. Port signatures (strongest)
 * 2. @icon annotation
 * 3. @color annotation
 * 4. Function name heuristics (weakest)
 */

import { detectNodeRole, findNodesByRole } from '../../src/validation/agent-detection';
import type { TNodeTypeAST } from '../../src/ast/types';

/** Minimal node type factory for testing */
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

/** Creates STEP port definitions for execute/onSuccess/onFailure */
function stepInputs() {
  return { execute: { dataType: 'STEP' as const } };
}

function stepOutputs() {
  return {
    onSuccess: { dataType: 'STEP' as const },
    onFailure: { dataType: 'STEP' as const },
  };
}

describe('agent-detection', () => {
  describe('port signature detection', () => {
    it('should detect LLM node by messages input + content output', () => {
      const nt = makeNodeType({
        name: 'myCustomLlm',
        inputs: { ...stepInputs(), messages: { dataType: 'OBJECT' as any } },
        outputs: { ...stepOutputs(), content: { dataType: 'STRING' as any }, toolCalls: { dataType: 'OBJECT' as any } },
      });
      expect(detectNodeRole(nt)).toBe('llm');
    });

    it('should detect LLM node by messages input + toolCalls output only', () => {
      const nt = makeNodeType({
        name: 'streamingLlm',
        inputs: { ...stepInputs(), messages: { dataType: 'OBJECT' as any } },
        outputs: { ...stepOutputs(), toolCalls: { dataType: 'OBJECT' as any } },
      });
      expect(detectNodeRole(nt)).toBe('llm');
    });

    it('should detect tool-executor by toolCall input + result output', () => {
      const nt = makeNodeType({
        name: 'myToolRunner',
        inputs: { ...stepInputs(), toolCall: { dataType: 'OBJECT' as any } },
        outputs: { ...stepOutputs(), result: { dataType: 'ANY' as any }, resultMessage: { dataType: 'OBJECT' as any } },
      });
      expect(detectNodeRole(nt)).toBe('tool-executor');
    });

    it('should detect tool-executor by toolCalls (plural) input', () => {
      const nt = makeNodeType({
        name: 'batchExecutor',
        inputs: { ...stepInputs(), toolCalls: { dataType: 'OBJECT' as any } },
        outputs: { ...stepOutputs(), result: { dataType: 'ANY' as any } },
      });
      expect(detectNodeRole(nt)).toBe('tool-executor');
    });

    it('should detect human-approval by approved + rejected outputs', () => {
      const nt = makeNodeType({
        name: 'reviewGate',
        inputs: { ...stepInputs(), action: { dataType: 'STRING' as any } },
        outputs: { ...stepOutputs(), approved: { dataType: 'STEP' as any }, rejected: { dataType: 'STEP' as any } },
      });
      expect(detectNodeRole(nt)).toBe('human-approval');
    });

    it('should detect memory by conversationId input + messages output', () => {
      const nt = makeNodeType({
        name: 'chatStore',
        inputs: { ...stepInputs(), conversationId: { dataType: 'STRING' as any } },
        outputs: { ...stepOutputs(), messages: { dataType: 'OBJECT' as any } },
      });
      expect(detectNodeRole(nt)).toBe('memory');
    });

    it('should return null for unrelated node', () => {
      const nt = makeNodeType({
        name: 'add',
        inputs: { a: { dataType: 'NUMBER' as any }, b: { dataType: 'NUMBER' as any } },
        outputs: { result: { dataType: 'NUMBER' as any } },
      });
      expect(detectNodeRole(nt)).toBeNull();
    });
  });

  describe('icon annotation detection', () => {
    it('should detect LLM from psychology icon', () => {
      const nt = makeNodeType({
        name: 'customNode',
        visuals: { icon: 'psychology' },
      });
      expect(detectNodeRole(nt)).toBe('llm');
    });

    it('should detect tool-executor from wrench icon', () => {
      const nt = makeNodeType({
        name: 'runner',
        visuals: { icon: 'build' },
      });
      expect(detectNodeRole(nt)).toBe('tool-executor');
    });

    it('should detect human-approval from verified icon', () => {
      const nt = makeNodeType({
        name: 'gate',
        visuals: { icon: 'verified' },
      });
      expect(detectNodeRole(nt)).toBe('human-approval');
    });

    it('should detect memory from database icon', () => {
      const nt = makeNodeType({
        name: 'store',
        visuals: { icon: 'database' },
      });
      expect(detectNodeRole(nt)).toBe('memory');
    });

    it('should not detect from unknown icon', () => {
      const nt = makeNodeType({
        name: 'widget',
        visuals: { icon: 'star' },
      });
      expect(detectNodeRole(nt)).toBeNull();
    });
  });

  describe('color annotation detection', () => {
    it('should detect LLM from purple color', () => {
      const nt = makeNodeType({
        name: 'customNode',
        visuals: { color: 'purple' },
      });
      expect(detectNodeRole(nt)).toBe('llm');
    });

    it('should detect tool-executor from cyan color', () => {
      const nt = makeNodeType({
        name: 'runner',
        visuals: { color: 'cyan' },
      });
      expect(detectNodeRole(nt)).toBe('tool-executor');
    });

    it('should detect human-approval from orange color', () => {
      const nt = makeNodeType({
        name: 'gate',
        visuals: { color: 'orange' },
      });
      expect(detectNodeRole(nt)).toBe('human-approval');
    });
  });

  describe('name heuristic detection', () => {
    it('should detect LLM from llm-prefixed name', () => {
      const nt = makeNodeType({ functionName: 'llmCall' });
      expect(detectNodeRole(nt)).toBe('llm');
    });

    it('should detect LLM from chat-prefixed name', () => {
      const nt = makeNodeType({ functionName: 'chatCompletion' });
      expect(detectNodeRole(nt)).toBe('llm');
    });

    it('should detect tool-executor from tool-prefixed name', () => {
      const nt = makeNodeType({ functionName: 'toolRunner' });
      expect(detectNodeRole(nt)).toBe('tool-executor');
    });

    it('should detect tool-executor from execute-prefixed name', () => {
      const nt = makeNodeType({ functionName: 'executeTool' });
      expect(detectNodeRole(nt)).toBe('tool-executor');
    });

    it('should detect human-approval from approval-prefixed name', () => {
      const nt = makeNodeType({ functionName: 'approvalGate' });
      expect(detectNodeRole(nt)).toBe('human-approval');
    });

    it('should detect memory from memory-prefixed name', () => {
      const nt = makeNodeType({ functionName: 'memoryStore' });
      expect(detectNodeRole(nt)).toBe('memory');
    });

    it('should not detect from generic name', () => {
      const nt = makeNodeType({ functionName: 'processData' });
      expect(detectNodeRole(nt)).toBeNull();
    });
  });

  describe('signal priority', () => {
    it('should prefer port signature over icon annotation', () => {
      // Port says tool-executor, icon says psychology (LLM)
      const nt = makeNodeType({
        name: 'confusing',
        inputs: { ...stepInputs(), toolCall: { dataType: 'OBJECT' as any } },
        outputs: { ...stepOutputs(), result: { dataType: 'ANY' as any } },
        visuals: { icon: 'psychology' },
      });
      expect(detectNodeRole(nt)).toBe('tool-executor');
    });

    it('should prefer icon over color', () => {
      // Icon says tool-executor (build), color says LLM (purple)
      const nt = makeNodeType({
        name: 'mixed',
        visuals: { icon: 'build', color: 'purple' },
      });
      expect(detectNodeRole(nt)).toBe('tool-executor');
    });

    it('should prefer icon over name heuristic', () => {
      // Icon says LLM (psychology), name says tool (executeTool)
      const nt = makeNodeType({
        functionName: 'executeTool',
        visuals: { icon: 'psychology' },
      });
      expect(detectNodeRole(nt)).toBe('llm');
    });

    it('should prefer color over name heuristic', () => {
      // Color says LLM (purple), name says tool (toolRunner)
      const nt = makeNodeType({
        functionName: 'toolRunner',
        visuals: { color: 'purple' },
      });
      expect(detectNodeRole(nt)).toBe('llm');
    });
  });

  describe('findNodesByRole', () => {
    it('should find all LLM node types', () => {
      const nodeTypes: TNodeTypeAST[] = [
        makeNodeType({
          name: 'llm1',
          inputs: { ...stepInputs(), messages: { dataType: 'OBJECT' as any } },
          outputs: { ...stepOutputs(), content: { dataType: 'STRING' as any } },
        }),
        makeNodeType({
          name: 'add',
          inputs: { a: { dataType: 'NUMBER' as any } },
          outputs: { result: { dataType: 'NUMBER' as any } },
        }),
        makeNodeType({
          name: 'llm2',
          visuals: { icon: 'psychology' },
        }),
      ];

      const result = findNodesByRole(nodeTypes, 'llm');
      expect(result).toHaveLength(2);
      expect(result.map((nt) => nt.name)).toEqual(['llm1', 'llm2']);
    });

    it('should return empty array when no matches', () => {
      const nodeTypes: TNodeTypeAST[] = [
        makeNodeType({ name: 'add' }),
      ];
      expect(findNodesByRole(nodeTypes, 'llm')).toHaveLength(0);
    });
  });
});
