/**
 * Grammar Compatibility Tests
 *
 * Ensures all example workflow files:
 * 1. Parse without errors with the current parser
 * 2. Round-trip (parse → generate → re-parse) without structural breaking changes
 *
 * Files are discovered dynamically via glob — adding new examples
 * automatically expands test coverage with zero maintenance.
 */

import { parser } from '../../src/parser';
import { annotationGenerator } from '../../src/annotation-generator';
import { WorkflowDiffer } from '../../src/diff/WorkflowDiffer';
import { globSync } from 'glob';
import * as path from 'path';

const examplesDir = path.join(__dirname, '../../fixtures');
const allFiles = globSync('**/*.ts', { cwd: examplesDir, ignore: ['**/*.generated.ts'] });

// Separate files that contain @flowWeaver annotations from utility-only files
const annotatedFiles: string[] = [];
const utilityFiles: string[] = [];

for (const file of allFiles) {
  const result = parser.parse(path.join(examplesDir, file));
  if (result.workflows.length + result.nodeTypes.length > 0) {
    annotatedFiles.push(file);
  } else {
    utilityFiles.push(file);
  }
}

describe('Grammar Compatibility', () => {
  it('should have annotated example files to test', () => {
    expect(annotatedFiles.length).toBeGreaterThan(0);
  });

  describe('Annotated files', () => {
    it.each(annotatedFiles)('should parse %s without errors', (file) => {
      const result = parser.parse(path.join(examplesDir, file));
      expect(result.errors).toEqual([]);
      expect(result.workflows.length + result.nodeTypes.length).toBeGreaterThan(0);
    });

    it.each(annotatedFiles)('should round-trip %s without structural breaks', (file) => {
      const result = parser.parse(path.join(examplesDir, file));

      for (const workflow of result.workflows) {
        const regenerated = annotationGenerator.generate(workflow, {
          includeComments: true,
          includeMetadata: true,
        });
        const reparsed = parser.parseFromString(regenerated);

        expect(reparsed.errors).toEqual([]);
        expect(reparsed.workflows.length).toBeGreaterThan(0);

        const diff = WorkflowDiffer.compare(workflow, reparsed.workflows[0]);

        // Check for structural breaking changes that affect the workflow itself.
        // Node type modifications are expected in multi-workflow files (sibling
        // workflow metadata changes when regenerated standalone).
        const structuralBreaks: string[] = [];

        if (diff.summary.instancesRemoved > 0) {
          structuralBreaks.push(`${diff.summary.instancesRemoved} instance(s) removed`);
        }
        if (diff.summary.connectionsRemoved > 0) {
          structuralBreaks.push(`${diff.summary.connectionsRemoved} connection(s) removed`);
        }
        if (diff.startPorts.removed.length > 0) {
          structuralBreaks.push(`Start port(s) removed: ${diff.startPorts.removed.map((p) => p.name).join(', ')}`);
        }
        if (diff.exitPorts.removed.length > 0) {
          structuralBreaks.push(`Exit port(s) removed: ${diff.exitPorts.removed.map((p) => p.name).join(', ')}`);
        }

        if (structuralBreaks.length > 0) {
          expect.fail(
            `Round-trip of ${file} (workflow: ${workflow.functionName}) introduced structural breaks:\n` +
              structuralBreaks.map((b) => `  - ${b}`).join('\n')
          );
        }
      }
    });
  });

  if (utilityFiles.length > 0) {
    describe('Utility files (no @flowWeaver annotations)', () => {
      it.each(utilityFiles)('should parse %s without errors', (file) => {
        const result = parser.parse(path.join(examplesDir, file));
        expect(result.errors).toEqual([]);
      });
    });
  }
});
