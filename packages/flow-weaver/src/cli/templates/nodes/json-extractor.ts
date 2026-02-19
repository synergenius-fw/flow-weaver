import type { NodeTemplate } from '../index';
import { toPascalCase } from '../index';

export const jsonExtractorNodeTemplate: NodeTemplate = {
  id: 'json-extractor',
  name: 'JSON Extractor',
  description: 'Extract structured JSON from LLM text output',
  category: 'ai',
  generate: (name: string): string => {
    const funcName = name || 'jsonExtractor';
    const label = toPascalCase(funcName);
    return `
/**
 * Extract structured JSON from LLM text output.
 * Handles markdown code fences, leading/trailing text, and optional schema validation.
 *
 * Strips \\\`\\\`\\\`json ... \\\`\\\`\\\` fences, finds the first valid JSON object or array,
 * and optionally validates that expected field names are present.
 *
 * @flowWeaver nodeType
 * @expression
 * @label ${label}
 * @color cyan
 * @icon dataObject
 * @input text [order:0] - Raw text potentially containing JSON
 * @input schema [order:1] - Expected field names for validation (optional)
 * @output extracted [order:0] - Parsed JSON object (null if extraction failed)
 * @output valid [order:1] - Whether extraction and validation succeeded
 * @output raw [order:2] - The raw JSON string that was found
 */
function ${funcName}(
  text: string,
  schema?: string[]
): {
  extracted: Record<string, unknown> | null;
  valid: boolean;
  raw: string;
} {
  if (!text || typeof text !== 'string') {
    return { extracted: null, valid: false, raw: '' };
  }

  // Strip markdown code fences
  let cleaned = text;
  const fenceMatch = cleaned.match(/\\\`\\\`\\\`(?:json)?\\s*([\\s\\S]*?)\\\`\\\`\\\`/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Find first JSON object or array via brace/bracket matching
  const startChar = cleaned.indexOf('{') !== -1 && (cleaned.indexOf('[') === -1 || cleaned.indexOf('{') < cleaned.indexOf('['))
    ? '{'
    : '[';
  const endChar = startChar === '{' ? '}' : ']';
  const startIdx = cleaned.indexOf(startChar);

  if (startIdx === -1) {
    return { extracted: null, valid: false, raw: '' };
  }

  // Walk forward to find the matching closing brace/bracket
  let depth = 0;
  let inString = false;
  let escape = false;
  let endIdx = -1;

  for (let i = startIdx; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\\\') {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === startChar) depth++;
    if (ch === endChar) depth--;

    if (depth === 0) {
      endIdx = i;
      break;
    }
  }

  if (endIdx === -1) {
    return { extracted: null, valid: false, raw: '' };
  }

  const raw = cleaned.slice(startIdx, endIdx + 1);

  try {
    const parsed = JSON.parse(raw);

    // Validate schema if provided
    if (schema && schema.length > 0 && typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const missingFields = schema.filter(field => !(field in parsed));
      if (missingFields.length > 0) {
        return { extracted: parsed, valid: false, raw };
      }
    }

    return { extracted: parsed, valid: true, raw };
  } catch {
    return { extracted: null, valid: false, raw };
  }
}
`.trim();
  },
};
