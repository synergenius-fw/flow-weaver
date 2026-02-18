import type { NodeTemplate } from '../index';
import { toPascalCase } from '../index';

export const promptTemplateNodeTemplate: NodeTemplate = {
  id: 'prompt-template',
  name: 'Prompt Template',
  description: 'Interpolate variables into a prompt template string',
  category: 'ai',
  generate: (name: string): string => {
    const funcName = name || 'promptTemplate';
    const label = toPascalCase(funcName);
    return `
/**
 * Interpolate variables into a prompt template string.
 * Uses {{variableName}} syntax for placeholders.
 *
 * Example:
 *   template: "Hello {{name}}, your order {{orderId}} is ready."
 *   variables: { name: "Alice", orderId: "12345" }
 *   → prompt: "Hello Alice, your order 12345 is ready."
 *
 * @flowWeaver nodeType
 * @expression
 * @label ${label}
 * @color pink
 * @icon textSnippet
 * @input template [order:0] - Template string with {{variable}} placeholders
 * @input variables [order:1] - Key-value pairs to interpolate
 * @output prompt [order:0] - Rendered prompt string
 * @output unresolvedCount [order:1] - Number of unresolved placeholders
 */
function ${funcName}(
  template: string,
  variables: Record<string, string>
): {
  prompt: string;
  unresolvedCount: number;
} {
  let unresolved = 0;

  const prompt = template.replace(/\\{\\{\\s*(\\w+)\\s*\\}\\}/g, (match, key) => {
    if (key in variables) {
      return variables[key];
    }
    unresolved++;
    return match; // Leave unresolved placeholders as-is
  });

  return { prompt, unresolvedCount: unresolved };
}
`.trim();
  },
};
