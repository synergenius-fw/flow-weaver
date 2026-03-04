/**
 * Tests that all 4 CI/CD templates produce valid, parseable workflows.
 *
 * These tests scaffold each template with default config, parse the output,
 * validate the AST, and confirm that secret declarations/references are
 * consistent. Before the secret:NAME parser fix, these all failed silently
 * because secret connections were dropped during parsing.
 */

import { describe, it, expect } from 'vitest';
import { workflowTemplates } from '../../src/cli/templates/index';
import { parser } from '../../src/parser';
import { validateWorkflow } from '../../src/api/validate';
import { isCICDWorkflow, getDeclaredSecrets, getReferencedSecrets } from '../../src/validation/cicd-detection';

const CICD_TEMPLATE_IDS = [
  'cicd-test-deploy',
  'cicd-docker',
  'cicd-matrix',
  'cicd-multi-env',
];

describe('CI/CD template validation', () => {
  for (const templateId of CICD_TEMPLATE_IDS) {
    describe(templateId, () => {
      const template = workflowTemplates.find(t => t.id === templateId);

      it('should exist in the template registry', () => {
        expect(template).toBeDefined();
      });

      it('should generate code that parses without errors', () => {
        const code = template!.generate({ workflowName: 'testPipeline' });
        const result = parser.parseFromString(code);
        expect(result.errors).toEqual([]);
        expect(result.workflows.length).toBeGreaterThanOrEqual(1);
      });

      it('should produce a valid workflow with zero errors', () => {
        const code = template!.generate({ workflowName: 'testPipeline' });
        const result = parser.parseFromString(code);
        const wf = result.workflows[0];
        const validation = validateWorkflow(wf);
        expect(validation.errors).toEqual([]);
      });

      it('should be detected as a CI/CD workflow', () => {
        const code = template!.generate({ workflowName: 'testPipeline' });
        const result = parser.parseFromString(code);
        const wf = result.workflows[0];
        expect(isCICDWorkflow(wf)).toBe(true);
      });

      it('should have consistent secret declarations and references', () => {
        const code = template!.generate({ workflowName: 'testPipeline' });
        const result = parser.parseFromString(code);
        const wf = result.workflows[0];

        const declared = getDeclaredSecrets(wf);
        const referenced = getReferencedSecrets(wf);

        // Every referenced secret must be declared
        for (const ref of referenced) {
          expect(declared).toContain(ref);
        }

        // Every declared secret should be referenced (no dead declarations)
        // Note: some templates may declare secrets used in shell commands rather
        // than via @connect, so we only check that referenced is a subset of declared.
      });
    });
  }
});
