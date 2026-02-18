/**
 * Transformer Node Template
 * Data transformation and mapping
 */

import type { NodeTemplate } from "../index";
import { toPascalCase } from "../index";

export const transformerNodeTemplate: NodeTemplate = {
  id: "transformer",
  name: "Transformer",
  description: "Data transformation and mapping",
  category: "data",
  generate: (name: string): string => {
    const pascalName = toPascalCase(name);

    return `
/**
 * Transforms input data into a new shape
 *
 * @flowWeaver nodeType
 * @label ${pascalName}
 * @color pink
 * @icon changeCircle
 * @input data [order:1] - Input data to transform
 * @input execute [order:0] - Execute
 * @output result [order:2] - Transformed data
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function ${name}(
  execute: boolean,
  data: any
): { onSuccess: boolean; onFailure: boolean; result: any } {
  if (!execute) {
    return { onSuccess: false, onFailure: false, result: null };
  }

  try {
    // TODO: Implement your transformation logic
    // Examples:

    // Map array items
    // const result = data.map(item => ({ ...item, processed: true }));

    // Reshape object
    // const result = {
    //   id: data.userId,
    //   fullName: \`\${data.firstName} \${data.lastName}\`,
    //   email: data.contactEmail
    // };

    // Filter and transform
    // const result = data
    //   .filter(item => item.active)
    //   .map(item => item.name);

    const result = {
      ...data,
      transformedAt: new Date().toISOString()
    };

    return { onSuccess: true, onFailure: false, result };
  } catch (err) {
    console.error("[${pascalName}] Transform error:", err);
    return { onSuccess: false, onFailure: true, result: null };
  }
}
`.trim();
  },
};
