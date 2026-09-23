import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractFunctionLikes } from '../../../src/parser/function-like';
import { jsdocParser } from '../../../src/parser/jsdoc-parser';
import { getSharedProject } from '../../../src/parser/shared-project';

const source = `
/**
 * @flowWeaver nodeType
 * @input spec - Month specifier
 * @output value - Month specifier
 */
export function pass(execute: boolean, spec: string) {
  return { onSuccess: execute, onFailure: false, value: spec };
}

/**
 * @flowWeaver workflow
 * @param {string} [targetMonth=""] - Empty means the previous month.
 * @returns {string} value - Resolved input.
 * @node resolve pass
 * @connect Start.targetMonth -> resolve.spec
 * @connect Start.execute -> resolve.execute
 * @connect resolve.value -> Exit.value
 */
export async function defaulted(execute: boolean, params: { targetMonth?: string }) {
  void execute;
  void params;
  throw new Error('generated');
}
`.trim();

describe('generated workflow parameter defaults', () => {
  it('retains a bracketed empty-string default in the parsed workflow contract', () => {
    const file = getSharedProject().createSourceFile(
      `defaulted-param-${Date.now()}-${Math.random()}.ts`,
      source,
      { overwrite: true },
    );
    const workflow = extractFunctionLikes(file).find((candidate) => candidate.getName() === 'defaulted');
    expect(workflow).toBeDefined();
    const parsed = jsdocParser.parseWorkflow(workflow!, []);
    expect(parsed?.startPorts?.['targetMonth']).toMatchObject({ optional: true, default: '' });
  });

  it('materializes the declared default before the Start value enters durable state', async () => {
    const testFile = path.join(global.testHelpers.outputDir, 'defaulted-start-param.ts');
    fs.writeFileSync(testFile, source);
    try {
      const code = await global.testHelpers.generateFast(testFile, 'defaulted', { production: true });
      expect(code).toContain(
        `params.targetMonth === undefined ? "" : params.targetMonth`,
      );
      expect(code).not.toContain(
        `portName: 'targetMonth', executionIndex: startIdx, nodeTypeName: 'Start' }, params.targetMonth);`,
      );
    } finally {
      global.testHelpers.cleanupOutput('defaulted-start-param.ts');
    }
  });
});
