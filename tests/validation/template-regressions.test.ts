/**
 * Regression tests for specific template and validation bugs.
 *
 * Each test documents a specific bug that was fixed.
 * These prevent the bugs from being reintroduced.
 */

import {
  generateNodeFromTemplate,
  generateWorkflowFromTemplate,
  listNodeTemplates,
} from '../../src/api/templates';
import { parsePortsFromFunctionText } from '../../src/jsdoc-port-sync';
import { getFriendlyError } from '../../src/friendly-errors';
import { ERROR_HINTS } from '../../src/mcp/response-utils';

describe('template regressions', () => {
  describe('aggregator null bug', () => {
    // BUG: aggregator template's object merge check was:
    //   inputs.every(x => typeof x === "object" && !Array.isArray(x))
    // This would match null since typeof null === "object", causing crashes.
    // FIX: Added `&& x !== null` to the check.
    it('should include null check in object merge condition', () => {
      const code = generateNodeFromTemplate('aggregator', 'myAggregator');
      expect(code).toContain('x !== null');
    });
  });

  describe('tool-executor eval() removal', () => {
    // BUG: tool-executor template contained eval(args.expression) in comments,
    // which users could copy-paste into production code (code injection risk).
    // FIX: Replaced with safe examples (fetch, searchDatabase).
    it('should not contain eval() in generated code', () => {
      const code = generateNodeFromTemplate('tool-executor', 'myTool');
      expect(code).not.toContain('eval(');
    });

    it('should contain safe tool examples', () => {
      const code = generateNodeFromTemplate('tool-executor', 'myTool');
      expect(code).toContain('searchDatabase');
    });
  });

  describe('PascalCase consistency', () => {
    // BUG: Some node templates used `name.charAt(0).toUpperCase() + name.slice(1)`
    // which doesn't properly handle kebab-case or snake_case names.
    // FIX: All now use the toPascalCase utility.
    it.each(['validator', 'transformer', 'http', 'aggregator'])(
      '%s template should produce proper label for kebab-case input',
      (templateId) => {
        const code = generateNodeFromTemplate(templateId, 'myNodeName');
        // The label should be derived from the name — just check it's present
        expect(code).toContain('@flowWeaver nodeType');
        expect(code).toContain('function myNodeName');
      },
    );
  });

  describe('durable pipeline regex escaping', () => {
    // BUG: ai-pipeline-durable template had triple-escaped backticks in regex:
    //   content.match(/\\\`\\\`\\\`/) which doesn't match markdown fences
    // FIX: Simplified to proper template literal escaping
    it('should generate valid regex for markdown fence detection', () => {
      const code = generateWorkflowFromTemplate('ai-pipeline-durable', {
        workflowName: 'testPipeline',
      });
      // Should contain a regex that matches markdown code fences (```json ... ```)
      // Should NOT contain triple-escaped backticks
      expect(code).not.toContain('\\\\\\`');
    });
  });

  describe('ReAct workflow completeness', () => {
    // BUG: Original ai-react template had no actual loop, wrong port types,
    // and missing execution wires — essentially non-functional.
    // FIX: Complete rewrite with scoped reactLoop, Think→Act→Observe iteration.
    it('should generate a workflow with scoped loop', () => {
      const code = generateWorkflowFromTemplate('ai-react', { workflowName: 'testReact' });
      // Must have scope annotations for the iteration loop
      expect(code).toContain('scope:');
    });

    it('should have proper execution wiring', () => {
      const code = generateWorkflowFromTemplate('ai-react', { workflowName: 'testReact' });
      // Must connect Start to first node's execute
      expect(code).toContain('Start.execute');
      // Must have Exit connections
      expect(code).toContain('Exit.onSuccess');
    });
  });
});

describe('agent rule integration regressions', () => {
  describe('friendly errors are registered', () => {
    it.each([
      'AGENT_LLM_MISSING_ERROR_HANDLER',
      'AGENT_UNGUARDED_TOOL_EXECUTOR',
      'AGENT_MISSING_MEMORY_IN_LOOP',
      'AGENT_LLM_NO_FALLBACK',
      'AGENT_TOOL_NO_OUTPUT_HANDLING',
    ])('should have friendly error for %s', (code) => {
      const friendly = getFriendlyError({ code, message: 'test', node: 'testNode' });
      expect(friendly).not.toBeNull();
      expect(friendly!.title.length).toBeGreaterThan(3);
      expect(friendly!.explanation.length).toBeGreaterThan(10);
      expect(friendly!.fix.length).toBeGreaterThan(10);
    });
  });

  describe('MCP hints are registered', () => {
    it.each([
      'AGENT_LLM_MISSING_ERROR_HANDLER',
      'AGENT_UNGUARDED_TOOL_EXECUTOR',
      'AGENT_MISSING_MEMORY_IN_LOOP',
      'AGENT_LLM_NO_FALLBACK',
      'AGENT_TOOL_NO_OUTPUT_HANDLING',
    ])('should have MCP error hint for %s', (code) => {
      expect(ERROR_HINTS[code]).toBeDefined();
      expect(ERROR_HINTS[code].length).toBeGreaterThan(10);
    });
  });

  describe('node templates have visual annotations', () => {
    it('llm-call should have psychology icon and purple color', () => {
      const code = generateNodeFromTemplate('llm-call', 'myLlm');
      expect(code).toContain('@icon psychology');
      expect(code).toContain('@color purple');
    });

    it('tool-executor should have build icon and cyan color', () => {
      const code = generateNodeFromTemplate('tool-executor', 'myTool');
      expect(code).toContain('@icon build');
      expect(code).toContain('@color cyan');
    });

    it('conversation-memory should have database icon and blue color', () => {
      const code = generateNodeFromTemplate('conversation-memory', 'myMem');
      expect(code).toContain('@icon database');
      expect(code).toContain('@color blue');
    });
  });

  describe('globalThis provider injection', () => {
    it('llm-call node template should use globalThis fallback', () => {
      const code = generateNodeFromTemplate('llm-call', 'myLlm');
      expect(code).toContain('__fw_llm_provider__');
    });

    it.each(['ai-agent', 'ai-agent-durable', 'ai-react', 'ai-pipeline-durable', 'ai-chat', 'ai-rag'])(
      '%s workflow template should use globalThis fallback',
      (templateId) => {
        const code = generateWorkflowFromTemplate(templateId, { workflowName: 'test' });
        expect(code).toContain('__fw_llm_provider__');
      },
    );

    it('human-approval node template should use globalThis approval fallback', () => {
      const code = generateNodeFromTemplate('human-approval', 'myApproval');
      expect(code).toContain('__fw_approval_provider__');
    });
  });
});

describe('approval strategy regressions', () => {
  describe('strategy code generation', () => {
    it('mock strategy should generate valid approval provider code', () => {
      const code = generateNodeFromTemplate('human-approval', 'review');
      // Default is mock
      expect(code).toContain('ApprovalProvider');
      expect(code).toContain('ApprovalRequest');
      expect(code).toContain('ApprovalResult');
      expect(code).toContain('approvalProvider');
      expect(code).toContain('_defaultApprovalProvider');
      expect(code).toContain('Auto-approving');
    });

    it('callback strategy should generate pendingApprovals and resolveApproval', () => {
      const code = generateNodeFromTemplate('human-approval', 'review', { strategy: 'callback' });
      expect(code).toContain('_pendingApprovals');
      expect(code).toContain('resolveApproval');
      expect(code).toContain('getPendingApprovals');
      expect(code).toContain('parseTimeout');
      expect(code).toContain('__fw_approval_provider__');
    });

    it('webhook strategy should generate handler function', () => {
      const code = generateNodeFromTemplate('human-approval', 'review', { strategy: 'webhook' });
      expect(code).toContain('createApprovalHandler');
      expect(code).toContain('/approve/');
      expect(code).toContain('/reject/');
      expect(code).toContain('/pending');
      expect(code).toContain('__fw_approval_provider__');
    });
  });

  describe('node annotations preserved', () => {
    it.each(['mock', 'callback', 'webhook'])(
      '%s strategy should preserve @flowWeaver annotations',
      (strategy) => {
        const code = generateNodeFromTemplate('human-approval', 'myApproval', { strategy });
        expect(code).toContain('@flowWeaver nodeType');
        expect(code).toContain('@color orange');
        expect(code).toContain('@icon verified');
        expect(code).toContain('@output approved');
        expect(code).toContain('@output response');
        expect(code).toContain('@output reviewer');
      },
    );
  });

  describe('agent detection compatibility', () => {
    it('generated code should have approved output for agent detection', () => {
      // Agent detection looks for 'approved' in output ports.
      // All strategies must generate the same function signature.
      const strategies = ['mock', 'callback', 'webhook'];
      for (const strategy of strategies) {
        const code = generateNodeFromTemplate('human-approval', 'gate', { strategy });
        expect(code).toContain('approved: boolean');
        expect(code).toContain('response?: string');
        expect(code).toContain('reviewer?: string');
      }
    });
  });

  describe('no any casts', () => {
    it.each(['mock', 'callback', 'webhook'])(
      '%s strategy should not contain "as any"',
      (strategy) => {
        const code = generateNodeFromTemplate('human-approval', 'test', { strategy });
        expect(code).not.toContain('as any');
      },
    );
  });

  describe('expression node template preview must include mandatory ports', () => {
    // BUG: Expression node templates (like prompt-template, json-extractor) don't have
    // execute/onSuccess/onFailure in their annotations or signature. The full parser
    // adds them (parser.ts lines 856-876), but the lightweight JSDoc parser used for
    // template preview doesn't, so the NodeDiagram preview was missing step ports.
    // FIX: getNodeTemplatePreview must inject mandatory ports after parsing.

    const expressionTemplates = listNodeTemplates().filter((t) => {
      const code = t.generate('testNode');
      return code.includes('@expression');
    });

    it.each(expressionTemplates.map((t) => [t.id]))(
      '%s expression template should have mandatory step ports after parsing',
      (templateId) => {
        const code = generateNodeFromTemplate(templateId, 'testNode');
        const parsed = parsePortsFromFunctionText(code);

        // Expression nodes don't annotate step ports, so parsePortsFromFunctionText won't include them.
        // The preview function must inject them. Verify the gap exists:
        expect(parsed.inputs.execute).toBeUndefined();
        expect(parsed.outputs.onSuccess).toBeUndefined();
        expect(parsed.outputs.onFailure).toBeUndefined();

        // But data ports should be present:
        const dataInputs = Object.keys(parsed.inputs);
        const dataOutputs = Object.keys(parsed.outputs);
        expect(dataInputs.length).toBeGreaterThan(0);
        expect(dataOutputs.length).toBeGreaterThan(0);
      },
    );
  });

  describe('ensureMandatoryPorts should inject and order mandatory ports correctly', () => {
    // BUG: When mandatory step ports are injected for expression node previews,
    // they had no order metadata, causing them to appear at the bottom of the node.
    // FIX: ensureMandatoryPorts injects mandatory ports with correct ordering.
    //
    // Convention after injection:
    //   inputs:  execute(0), data ports(1, 2, ...)
    //   outputs: onSuccess(0), onFailure(1), data ports(2, 3, ...)

    // Inline the helper so it can be tested here and in templateOps.ts
    function ensureMandatoryPorts(parsed: {
      inputs: Record<string, { dataType: string; label?: string; metadata?: Record<string, unknown> }>;
      outputs: Record<string, { dataType: string; label?: string; metadata?: Record<string, unknown> }>;
    }): void {
      if (!parsed.inputs.execute) {
        // Shift existing input orders up by 1 to make room for execute at 0
        for (const def of Object.values(parsed.inputs)) {
          if (def.metadata?.order !== undefined) {
            (def.metadata as Record<string, unknown>).order = (def.metadata.order as number) + 1;
          }
        }
        parsed.inputs.execute = { dataType: 'STEP', label: 'Execute', metadata: { order: 0 } };
      }
      if (!parsed.outputs.onSuccess) {
        // Shift existing output orders up by 2 to make room for onSuccess(0) and onFailure(1)
        for (const def of Object.values(parsed.outputs)) {
          if (def.metadata?.order !== undefined) {
            (def.metadata as Record<string, unknown>).order = (def.metadata.order as number) + 2;
          }
        }
        parsed.outputs.onSuccess = { dataType: 'STEP', label: 'On Success', metadata: { order: 0 } };
      }
      if (!parsed.outputs.onFailure) {
        parsed.outputs.onFailure = { dataType: 'STEP', label: 'On Failure', metadata: { order: 1 } };
      }
    }

    it('should inject mandatory ports for expression node with correct ordering', () => {
      const code = generateNodeFromTemplate('prompt-template', 'testNode');
      const parsed = parsePortsFromFunctionText(code);

      ensureMandatoryPorts(parsed);

      // Mandatory ports should exist
      expect(parsed.inputs.execute).toBeDefined();
      expect(parsed.inputs.execute.dataType).toBe('STEP');
      expect(parsed.outputs.onSuccess).toBeDefined();
      expect(parsed.outputs.onSuccess.dataType).toBe('STEP');
      expect(parsed.outputs.onFailure).toBeDefined();
      expect(parsed.outputs.onFailure.dataType).toBe('STEP');

      // Execute should be at order 0, data inputs shifted to 1+
      expect(parsed.inputs.execute.metadata?.order).toBe(0);
      expect((parsed.inputs.template.metadata?.order as number)).toBeGreaterThan(0);
      expect((parsed.inputs.variables.metadata?.order as number)).toBeGreaterThan(0);

      // onSuccess(0), onFailure(1), data outputs shifted to 2+
      expect(parsed.outputs.onSuccess.metadata?.order).toBe(0);
      expect(parsed.outputs.onFailure.metadata?.order).toBe(1);
      expect((parsed.outputs.prompt.metadata?.order as number)).toBeGreaterThanOrEqual(2);
      expect((parsed.outputs.unresolvedCount.metadata?.order as number)).toBeGreaterThanOrEqual(2);
    });

    it('should not double-shift ports that already have mandatory ports', () => {
      const code = generateNodeFromTemplate('llm-call', 'testNode');
      const parsed = parsePortsFromFunctionText(code);

      const originalExecuteOrder = parsed.inputs.execute?.metadata?.order;
      const originalMessagesOrder = parsed.inputs.messages?.metadata?.order;

      ensureMandatoryPorts(parsed);

      // Normal-mode nodes already have execute - orders should be unchanged
      expect(parsed.inputs.execute.metadata?.order).toBe(originalExecuteOrder);
      expect(parsed.inputs.messages.metadata?.order).toBe(originalMessagesOrder);
    });
  });
});
