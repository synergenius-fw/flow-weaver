import { describe, it, expect } from 'vitest';
import { parser } from '../../../src/parser';
import { sourceToSVG } from '../../../src/diagram/index';

/**
 * Non-expression nodes with explicit @input/@output annotations should
 * render their custom data ports alongside the mandatory control-flow ports
 * (execute, onSuccess, onFailure).
 */
describe('non-expression node custom ports in diagram', () => {
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

  it('SVG renders custom data ports on non-expression nodes', () => {
    const svg = sourceToSVG(code, { theme: 'dark', showPortLabels: true });

    // The router node should have a context input port and context output port
    expect(svg).toContain('data-port-id="r.context:input"');
    expect(svg).toContain('data-port-id="r.context:output"');
  });

  it('[hidden] annotation suppresses port from diagram', () => {
    const hiddenCode = `
/**
 * @flowWeaver nodeType
 * @expression
 * @label Worker
 * @input data [type: STRING] - Input data
 * @output result [type: STRING] - Result
 * @output onFailure [hidden] - Hidden failure port
 */
function worker(data: string): { result: string } {
  return { result: data.toUpperCase() };
}

/**
 * @flowWeaver workflow
 * @node w worker
 * @path Start -> w -> Exit
 * @connect Start.input -> w.data
 * @connect w.result -> Exit.output
 */
export function hiddenPortWorkflow(
  execute: boolean,
  input: string,
): { onSuccess: boolean; onFailure: boolean; output: string } {
  throw new Error('Not implemented');
}
`;
    const svg = sourceToSVG(hiddenCode, { theme: 'dark' });

    // Worker node should have data and result ports but NOT onFailure
    expect(svg).toContain('data-port-id="w.data:input"');
    expect(svg).toContain('data-port-id="w.result:output"');
    expect(svg).not.toContain('data-port-id="w.onFailure:output"');
  });
});
