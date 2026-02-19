// Example workflow with expressions (Phase 9)
// Demonstrates: Default values, optional inputs, simple expressions

// ============================================================================
// NODE DEFINITIONS
// ============================================================================

/**
 * Node with default values
 *
 * @flowWeaver nodeType
 * @label Calculate
 * @input value
 * @input [multiplier=2] - Default if not connected
 * @input [offset=0] - Default if not connected
 * @output result
 */
function calculate(execute: boolean, value: number, multiplier: number = 2, offset: number = 0) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  console.log(`Calculating: (${value} * ${multiplier}) + ${offset}`);
  return { onSuccess: true, onFailure: false, result: (value * multiplier) + offset };
}

/**
 * Node with optional input
 *
 * @flowWeaver nodeType
 * @label Format
 * @input value
 * @input [label] - Optional input
 * @output formatted
 */
function format(execute: boolean, value: number, label?: string) {
  if (!execute) return { onSuccess: false, onFailure: false, formatted: '' };
  const prefix = label || 'Result';
  console.log(`Formatting: ${prefix}: ${value}`);
  return { onSuccess: true, onFailure: false, formatted: `${prefix}: ${value}` };
}

// ============================================================================
// WORKFLOW DEFINITION
// ============================================================================

/**
 * Workflow demonstrating expressions
 * - calculate uses default values for multiplier and offset
 * - format uses optional label (not connected, so undefined)
 *
 * @flowWeaver workflow
 * @name expressionsWorkflow
 * @node calculate calculate
 * @node format format
 * @path Start -> calculate -> format -> Exit
 * @connect Start.input -> calculate.value
 * @connect calculate.result -> format.value
 * @connect format.formatted -> Exit.output
 */
export async function expressionsWorkflow(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; output: string }> {
  throw new Error('Not implemented');
}

export { calculate, format };
