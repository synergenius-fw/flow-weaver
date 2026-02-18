/**
 * Validator Node Template
 * Input validation with success/failure routing
 */

import type { NodeTemplate } from "../index";
import { toPascalCase } from "../index";

export const validatorNodeTemplate: NodeTemplate = {
  id: "validator",
  name: "Validator",
  description: "Input validation with success/failure routing",
  category: "validation",
  generate: (name: string): string => {
    const pascalName = toPascalCase(name);

    return `
/**
 * Validates input data against rules
 *
 * @flowWeaver nodeType
 * @label ${pascalName}
 * @color green
 * @icon rule
 * @input data [order:1] - Data to validate
 * @input execute [order:0] - Execute
 * @output isValid [order:2] - Whether data is valid
 * @output validData [order:3] - Validated data (if valid)
 * @output errors [order:4] - Validation errors (if invalid)
 * @output onSuccess [order:0] - Validation passed
 * @output onFailure [order:1] - Validation failed
 */
function ${name}(
  execute: boolean,
  data: any
): { onSuccess: boolean; onFailure: boolean; isValid: boolean; validData: any; errors: string[] } {
  if (!execute) {
    return { onSuccess: false, onFailure: false, isValid: false, validData: null, errors: [] };
  }

  const errors: string[] = [];

  // TODO: Add your validation rules
  // Example validations:
  if (data === null || data === undefined) {
    errors.push("Data is required");
  }

  // if (typeof data.email === 'string' && !data.email.includes('@')) {
  //   errors.push("Invalid email format");
  // }

  // if (typeof data.age === 'number' && (data.age < 0 || data.age > 150)) {
  //   errors.push("Age must be between 0 and 150");
  // }

  if (errors.length > 0) {
    return { onSuccess: false, onFailure: true, isValid: false, validData: null, errors };
  }

  return { onSuccess: true, onFailure: false, isValid: true, validData: data, errors: [] };
}
`.trim();
  },
};
