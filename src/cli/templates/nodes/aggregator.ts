/**
 * Aggregator Node Template
 * Combine multiple inputs into a single output
 */

import type { NodeTemplate } from "../index";
import { toPascalCase } from "../index";

export const aggregatorNodeTemplate: NodeTemplate = {
  id: "aggregator",
  name: "Aggregator",
  description: "Combine multiple inputs into a single output",
  category: "data",
  generate: (name: string): string => {
    const pascalName = toPascalCase(name);

    return `
/**
 * Combines multiple inputs into a single output
 *
 * @flowWeaver nodeType
 * @label ${pascalName}
 * @color orange
 * @icon callMerge
 * @input inputA [order:1] - First input
 * @input inputB [order:2] - Second input
 * @input inputC [order:3] - Third input (optional)
 * @input execute [order:0] - Execute
 * @output combined [order:2] - Combined result
 * @output count [order:3] - Number of non-null inputs combined
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function ${name}(
  execute: boolean,
  inputA: any,
  inputB: any,
  inputC: any
): { onSuccess: boolean; onFailure: boolean; combined: any; count: number } {
  if (!execute) {
    return { onSuccess: false, onFailure: false, combined: null, count: 0 };
  }

  // TODO: Customize aggregation logic based on your data types
  const inputs = [inputA, inputB, inputC].filter(x => x !== null && x !== undefined);
  const count = inputs.length;

  // Default: merge arrays or objects, or collect into array
  let combined: any;

  if (inputs.every(Array.isArray)) {
    // Merge arrays
    combined = inputs.flat();
  } else if (inputs.every(x => typeof x === "object" && x !== null && !Array.isArray(x))) {
    // Merge objects
    combined = Object.assign({}, ...inputs);
  } else {
    // Collect as array
    combined = inputs;
  }

  return { onSuccess: true, onFailure: false, combined, count };
}
`.trim();
  },
};
