import { describe, it, expect } from 'vitest';
import { parser } from '../../../src/parser/annotation-parser';

/**
 * Non-expression nodes with explicit @input/@output annotations keep their
 * custom data ports alongside the mandatory control-flow ports (execute,
 * onSuccess, onFailure).
 */
describe('non-expression node custom ports', () => {
  const code = `
/**
 * @flowWeaver nodeType
 * @label Router
 * @input context [type: OBJECT] - Context data
 * @output context [type: OBJECT] - Pass-through context
 */
function router(
  execute: boolean,
  context: { value: number },
): { onSuccess: boolean; onFailure: boolean; context: { value: number } } {
  if (!execute) return { onSuccess: false, onFailure: false, context };
  return { onSuccess: true, onFailure: false, context };
}

/**
 * @flowWeaver workflow
 * @node r router
 * @path Start -> r -> Exit
 * @connect Start.data -> r.context
 * @connect r.context -> Exit.result
 */
export function myWorkflow(
  execute: boolean,
  data: { value: number },
): { onSuccess: boolean; onFailure: boolean; result: { value: number } } {
  throw new Error('Not implemented');
}
`;

  it('parser preserves custom ports on non-expression node types', () => {
    const result = parser.parseFromString(code);
    const routerType = result.workflows[0].nodeTypes.find(nt => nt.functionName === 'router');
    expect(routerType).toBeDefined();

    // Also check warnings
    expect(result.warnings).toEqual([]); // show warnings if any

    // Must have execute + context inputs
    expect(routerType!.inputs).toHaveProperty('execute');
    expect(routerType!.inputs).toHaveProperty('context');
    expect(routerType!.inputs.context.dataType).toBe('OBJECT');

    // Must have onSuccess + onFailure + context outputs
    expect(routerType!.outputs).toHaveProperty('onSuccess');
    expect(routerType!.outputs).toHaveProperty('onFailure');
    expect(routerType!.outputs).toHaveProperty('context');
    expect(routerType!.outputs.context.dataType).toBe('OBJECT');
  });
});
