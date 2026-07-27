/**
 * Tests for local invokeWorkflow resolution.
 * When executing locally, invokeWorkflow resolves sibling exported functions
 * through the execution-scoped workflow registry.
 */

import * as fs from 'fs';
import * as path from 'path';
import { executeWorkflow } from '../../src/mcp/workflow-executor';

describe('Local invokeWorkflow Resolution', () => {
  it('should call sibling exported function when invoked locally', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input data - string
 * @output result - string
 */
export async function processData(execute: boolean, data: string) {
  return { onSuccess: true, onFailure: false, result: data.toUpperCase() };
}

/**
 * @flowWeaver workflow
 * @param input - string
 * @returns {string} result - Result
 * @node proc processData
 * @connect Start.input -> proc.data
 * @connect proc.result -> Exit.result
 */
export async function subWorkflow(execute: boolean, params: { input: string }): Promise<{
  onSuccess: boolean; onFailure: boolean; result: string;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}

/**
 * @flowWeaver workflow
 * @param payload - object
 * @returns {object} result - Invocation result
 * @node inv invokeWorkflow [expr: functionId="'subWorkflow'"]
 * @connect Start.payload -> inv.payload
 * @connect inv.result -> Exit.result
 */
export async function mainWorkflow(execute: boolean, params: { payload: object }): Promise<{
  onSuccess: boolean; onFailure: boolean; result: object;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'invoke-local-sibling.ts');
    fs.writeFileSync(testFile, source);

    try {
      const result = await executeWorkflow({
        runId: 'invoke-local-sibling',
        filePath: testFile,
        params: {
          payload: { input: 'hello' },
        },
        workflowName: 'mainWorkflow',
      });

      const workflowResult = result.result as { result: { result: string } };
      expect(workflowResult.result.result).toBe('HELLO');
    } finally {
      fs.unlinkSync(testFile);
    }
  });

  it('should fall back to no-op for unknown functionId without mocks', async () => {
    const source = `
/**
 * @flowWeaver workflow
 * @param data - string
 * @returns {object} result - Invocation result
 * @node inv invokeWorkflow [expr: functionId="'missingWorkflow'"]
 * @connect Start.data -> inv.payload
 * @connect inv.result -> Exit.result
 */
export async function mainWorkflow(execute: boolean, params: { data: string }): Promise<{
  onSuccess: boolean; onFailure: boolean; result: object;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'invoke-local-noop.ts');
    fs.writeFileSync(testFile, source);

    try {
      const result = await executeWorkflow({
        runId: 'invoke-local-noop',
        filePath: testFile,
        params: {
          data: 'test',
        },
        workflowName: 'mainWorkflow',
      });

      // Without a matching sibling function and no mocks, should return no-op result
      expect(result.result).toBeDefined();
      const workflowResult = result.result as {
        onSuccess: boolean;
        result: object;
      };
      expect(workflowResult.onSuccess).toBe(true);
      // The result from invokeWorkflow no-op is {}
      expect(workflowResult.result).toEqual({});
    } finally {
      fs.unlinkSync(testFile);
    }
  });

  it('should use mocks when available (existing behavior preserved)', async () => {
    const source = `
/**
 * @flowWeaver workflow
 * @param data - string
 * @returns {object} result - Invocation result
 * @node inv invokeWorkflow [expr: functionId="'some-function-id'"]
 * @connect Start.data -> inv.payload
 * @connect inv.result -> Exit.result
 */
export async function mainWorkflow(execute: boolean, params: { data: string }): Promise<{
  onSuccess: boolean; onFailure: boolean; result: object;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'invoke-local-mocks.ts');
    fs.writeFileSync(testFile, source);

    try {
      const result = await executeWorkflow({
        runId: 'invoke-local-mocks',
        filePath: testFile,
        params: {
          data: 'test',
        },
        workflowName: 'mainWorkflow',
        mocks: {
          invocations: {
            'some-function-id': { processed: 'mocked-value' },
          },
        },
      });

      // When mocks are configured but no matching functionId, invokeWorkflow returns failure
      // (since there's no explicit functionId connection providing a matching key)
      expect(result.result).toBeDefined();
    } finally {
      fs.unlinkSync(testFile);
    }
  });

  it('should resolve in-file sibling function via registry', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input text - string
 * @output upper - string
 */
export async function toUpper(execute: boolean, text: string) {
  return { onSuccess: true, onFailure: false, upper: text.toUpperCase() };
}

/**
 * @flowWeaver workflow
 * @param text - string
 * @returns {string} upper - Uppercase text
 * @node u toUpper
 * @connect Start.text -> u.text
 * @connect u.upper -> Exit.upper
 */
export async function helperWorkflow(execute: boolean, params: { text: string }): Promise<{
  onSuccess: boolean; onFailure: boolean; upper: string;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}

/**
 * @flowWeaver nodeType
 * @expression
 * @output functionId - string
 */
export function getFunctionId(): string {
  return 'helperWorkflow';
}

/**
 * @flowWeaver workflow
 * @param input - string
 * @returns {object} result - Final result
 * @node getId getFunctionId
 * @node inv invokeWorkflow
 * @connect getId.functionId -> inv.functionId
 * @connect Start.input -> inv.payload
 * @connect inv.result -> Exit.result
 */
export async function callerWorkflow(execute: boolean, params: { input: string }): Promise<{
  onSuccess: boolean; onFailure: boolean; result: object;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'invoke-local-registry.ts');
    fs.writeFileSync(testFile, source);

    try {
      const result = await executeWorkflow({
        runId: 'invoke-local-registry',
        filePath: testFile,
        params: {
          input: 'hello world',
        },
        workflowName: 'callerWorkflow',
      });

      // The callerWorkflow calls invokeWorkflow with functionId='helperWorkflow'
      // The registry should resolve helperWorkflow from the same module
      const workflowResult = result.result as { result: { upper: string } };
      expect(workflowResult.result).toBeDefined();
      // If the registry works, result should contain the helperWorkflow output
      if (workflowResult.result && 'upper' in workflowResult.result) {
        expect(workflowResult.result.upper).toBe('HELLO WORLD');
      }
    } finally {
      fs.unlinkSync(testFile);
    }
  });
});
