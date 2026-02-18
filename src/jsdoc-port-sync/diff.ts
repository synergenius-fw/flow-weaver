/**
 * @module jsdoc-port-sync/diff
 *
 * Port diff system for UI sync without regeneration.
 */

import type { TPortDefinition, TDataType } from "../ast/types";
import { generateJSDocPortTag } from "../annotation-generator";
import { JSDOC_BLOCK_REGEX, PORT_TAG_REGEX } from "./constants";
import { portTypeToTsType } from "./signature-parser";

// =============================================================================
// Types
// =============================================================================

/**
 * Represents a diff between two port arrays
 */
export interface TPortDiff {
  added: Array<{ name: string; type: string; direction: "INPUT" | "OUTPUT"; label?: string; scope?: string; placement?: string }>;
  removed: Array<{ name: string; direction: "INPUT" | "OUTPUT" }>;
  renamed: Array<{ from: string; to: string; direction: "INPUT" | "OUTPUT" }>;
  labelChanged: Array<{ name: string; label: string; direction: "INPUT" | "OUTPUT"; type: string; scope?: string }>;
  typeChanged: Array<{ name: string; type: string; direction: "INPUT" | "OUTPUT" }>;
}

// =============================================================================
// Diff Computation
// =============================================================================

/**
 * Compute the diff between two port arrays.
 * Used to detect what changed when user edits ports via UI.
 */
export function computePortsDiff(
  before: Array<{ name: string; type: string; direction: string; label?: string; scope?: string; placement?: string }>,
  after: Array<{ name: string; type: string; direction: string; label?: string; scope?: string; placement?: string }>
): TPortDiff {
  const diff: TPortDiff = { added: [], removed: [], renamed: [], labelChanged: [], typeChanged: [] };

  const beforeMap = new Map(before.map(p => [p.name, p]));
  const afterMap = new Map(after.map(p => [p.name, p]));

  // Find removed ports
  for (const [name, port] of beforeMap) {
    if (!afterMap.has(name)) {
      diff.removed.push({ name, direction: port.direction as "INPUT" | "OUTPUT" });
    }
  }

  // Find added ports, label changes, and type changes
  for (const [name, port] of afterMap) {
    if (!beforeMap.has(name)) {
      diff.added.push({
        name,
        type: port.type,
        direction: port.direction as "INPUT" | "OUTPUT",
        label: port.label,
        scope: port.scope,
        placement: port.placement
      });
    } else {
      const beforePort = beforeMap.get(name)!;
      if (beforePort.label !== port.label && port.label) {
        diff.labelChanged.push({
          name,
          label: port.label,
          direction: port.direction as "INPUT" | "OUTPUT",
          type: port.type,
          scope: port.scope
        });
      }
      if (beforePort.type !== port.type) {
        diff.typeChanged.push({
          name,
          type: port.type,
          direction: port.direction as "INPUT" | "OUTPUT"
        });
      }
    }
  }

  // Detect renames: exactly one removed and one added with same type/direction
  if (diff.removed.length === 1 && diff.added.length === 1) {
    const removed = diff.removed[0];
    const added = diff.added[0];
    const removedPort = before.find(p => p.name === removed.name);
    if (removedPort && removedPort.type === added.type && removedPort.direction === added.direction) {
      diff.renamed.push({ from: removed.name, to: added.name, direction: added.direction });
      diff.removed = [];
      diff.added = [];
    }
  }

  return diff;
}

// =============================================================================
// Format Ports (Aggressive Mode)
// =============================================================================

/**
 * Format/regenerate all port tags in JSDoc.
 * AGGRESSIVE MODE - for Cmd+Shift+P formatting.
 *
 * Unlike updatePortsInFunctionText() which preserves incomplete lines,
 * this function:
 * 1. Removes ALL existing port lines (valid or invalid)
 * 2. Regenerates them in proper order based on [order:N] metadata
 * 3. Ensures consistent formatting
 */
export function formatPortsInFunctionText(
  functionText: string,
  inputs: Record<string, TPortDefinition>,
  outputs: Record<string, TPortDefinition>,
): string {
  const jsdocMatch = functionText.match(JSDOC_BLOCK_REGEX);

  // Helper to safely get order from metadata (metadata is Record<string, unknown>)
  const getOrder = (port: TPortDefinition): number => {
    const order = port.metadata?.order;
    return typeof order === "number" ? order : Infinity;
  };

  // Sort by order metadata
  const sortedInputs = Object.entries(inputs)
    .sort((a, b) => getOrder(a[1]) - getOrder(b[1]));
  const sortedOutputs = Object.entries(outputs)
    .sort((a, b) => getOrder(a[1]) - getOrder(b[1]));

  // Separate into 4 groups based on scope
  const externalInputs = sortedInputs.filter(([_, p]) => !p.scope);
  const scopedInputs = sortedInputs.filter(([_, p]) => p.scope);
  const externalOutputs = sortedOutputs.filter(([_, p]) => !p.scope);
  const scopedOutputs = sortedOutputs.filter(([_, p]) => p.scope);

  // Generate tags in correct order
  const externalInputTags = externalInputs.map(([name, port]) =>
    ` * ${generateJSDocPortTag(name, port, "input")}`
  );
  const scopedOutputTags = scopedOutputs.map(([name, port]) =>
    ` * ${generateJSDocPortTag(name, port, "output")}`
  );
  const scopedInputTags = scopedInputs.map(([name, port]) =>
    ` * ${generateJSDocPortTag(name, port, "input")}`
  );
  const externalOutputTags = externalOutputs.map(([name, port]) =>
    ` * ${generateJSDocPortTag(name, port, "output")}`
  );

  // Combined order
  const allPortTags = [...externalInputTags, ...scopedOutputTags, ...scopedInputTags, ...externalOutputTags];

  if (!jsdocMatch) {
    const newJsDoc = [
      "/**",
      " * @flowWeaver nodeType",
      ...allPortTags,
      " */",
    ].join("\n");
    return newJsDoc + "\n" + functionText;
  }

  // Parse existing JSDoc to preserve non-port content
  const existingJsDoc = jsdocMatch[0];
  const lines = existingJsDoc.split("\n");

  const preservedLines: string[] = [];
  let hasFlowWeaverTag = false;

  for (const line of lines) {
    if (line.trim() === "/**" || line.trim() === "*/") {
      preservedLines.push(line);
      continue;
    }

    // REMOVE ALL port lines (aggressive mode)
    if (PORT_TAG_REGEX.test(line)) {
      continue;
    }

    if (line.includes("@flowWeaver")) {
      hasFlowWeaverTag = true;
    }

    preservedLines.push(line);
  }

  const newLines = [...preservedLines];

  if (!hasFlowWeaverTag) {
    newLines.splice(1, 0, " * @flowWeaver nodeType");
  }

  // Remove trailing empty JSDoc lines before inserting ports
  // This prevents extra blank lines between @label and port tags
  // Matches: " *", " * ", empty lines, or lines with only whitespace
  let closingIdx = newLines.findIndex((l) => l.trim() === "*/");
  while (closingIdx > 1) {
    const prevLine = newLines[closingIdx - 1];
    const isEmptyJsDocLine = /^\s*\*\s*$/.test(prevLine); // " *" or " * "
    const isBlankLine = prevLine.trim() === ""; // empty or whitespace only
    if (isEmptyJsDocLine || isBlankLine) {
      newLines.splice(closingIdx - 1, 1);
      closingIdx--;
    } else {
      break;
    }
  }

  // Insert ALL port tags before closing */
  const insertIndex = newLines.findIndex((l) => l.trim() === "*/");
  newLines.splice(insertIndex, 0, ...allPortTags);

  const newJsDoc = newLines.join("\n");

  return functionText.replace(JSDOC_BLOCK_REGEX, newJsDoc);
}

// =============================================================================
// Apply Diff
// =============================================================================

/**
 * Apply a port diff to code without regenerating existing lines.
 * This preserves incomplete/in-progress lines the user is typing.
 */
export function applyPortsDiffToCode(code: string, diff: TPortDiff): string {
  let result = code;

  // 1. Remove ports
  for (const { name, direction } of diff.removed) {
    const tag = direction === "INPUT" ? "@input" : "@output";
    const lineRegex = new RegExp(`^\\s*\\*\\s*${tag}\\s+\\[?${name}\\]?(?:[^\\S\\n]+|[^\\S\\n]*-|[^\\S\\n]*\\[order|$).*$\\n?`, "gm");
    result = result.replace(lineRegex, "");
  }

  // 2. Rename ports
  for (const { from, to, direction } of diff.renamed) {
    const tag = direction === "INPUT" ? "@input" : "@output";
    const renameRegex = new RegExp(`(${tag}\\s+)(\\[?)${from}(\\]?\\b)`, "g");
    result = result.replace(renameRegex, `$1$2${to}$3`);
  }

  // 3. Update labels
  for (const { name, label, direction, scope } of diff.labelChanged) {
    const tag = direction === "INPUT" ? "@input" : "@output";
    const labelRegex = new RegExp(
      `(\\*\\s*${tag}\\s+\\[?${name}\\]?)(?:\\s+scope:\\w+)?(?:\\s+\\[order:\\s*\\d+\\])?(?:\\s+-\\s+[^\\n]*)?`,
      "g"
    );
    const beforeReplace = result;
    result = result.replace(labelRegex, `$1${scope ? ` scope:${scope}` : ""} - ${label}`);

    if (result === beforeReplace) {
      const scopePart = scope ? ` scope:${scope}` : "";
      const labelPart = ` - ${label}`;
      const newLine = ` * ${tag} ${name}${scopePart}${labelPart}`;
      result = result.replace(/(\n)(\s*\*\/)/, `$1${newLine}\n$2`);
    }
  }

  // 4. Update types in signature (not JSDoc - types come from signature)
  // Handle simple types and the standard function type we generate: (...args: any[]) => any
  for (const { name, type, direction } of diff.typeChanged) {
    const tsType = portTypeToTsType(type as TDataType);

    // Pattern for simple types: word characters, [], and optional ?
    const simpleTypePattern = `[\\w\\[\\]\\?]+`;
    // Pattern for the standard function type we generate: (...args: any[]) => any
    // This is safe to replace because we know its exact structure
    const standardFunctionPattern = `\\(\\.\\.\\.args:\\s*any\\[\\]\\)\\s*=>\\s*any`;

    if (direction === "INPUT") {
      // Try simple type first
      const simpleParamRegex = new RegExp(
        `(\\b${name}\\??\\s*):\\s*(${simpleTypePattern})\\s*([,)])`,
        "g"
      );
      const beforeSimple = result;
      result = result.replace(simpleParamRegex, `$1: ${tsType}$3`);

      // If no change, try standard function type pattern
      if (result === beforeSimple) {
        const funcParamRegex = new RegExp(
          `(\\b${name}\\??\\s*):\\s*(${standardFunctionPattern})\\s*([,)])`,
          "g"
        );
        result = result.replace(funcParamRegex, `$1: ${tsType}$3`);
      }
    } else {
      // OUTPUT type change: ONLY modify within the return type annotation, NOT return statements in body
      // Return type annotation is between "): {" and the closing "}" before "{" or "=>" (function body)
      const returnTypeMatch = result.match(/(\)\s*:\s*)(\{[^}]+\})(\s*(?:\{|=>))/);
      if (returnTypeMatch) {
        const beforeReturnType = result.substring(0, returnTypeMatch.index! + returnTypeMatch[1].length);
        const returnTypeContent = returnTypeMatch[2];
        const afterReturnType = result.substring(returnTypeMatch.index! + returnTypeMatch[1].length + returnTypeContent.length);

        // Only apply replacement within the return type annotation
        const simpleReturnRegex = new RegExp(
          `(\\b${name}\\s*):\\s*(${simpleTypePattern})\\s*([,;}])`,
          "g"
        );
        let newReturnType = returnTypeContent.replace(simpleReturnRegex, `$1: ${tsType}$3`);

        // If no change, try standard function type pattern
        if (newReturnType === returnTypeContent) {
          const funcReturnRegex = new RegExp(
            `(\\b${name}\\s*):\\s*(${standardFunctionPattern})\\s*([,;}])`,
            "g"
          );
          newReturnType = returnTypeContent.replace(funcReturnRegex, `$1: ${tsType}$3`);
        }

        result = beforeReturnType + newReturnType + afterReturnType;
      }
    }
  }

  // 5. Add new ports
  for (const { name, direction, label, scope, placement } of diff.added) {
    const tag = direction === "INPUT" ? "@input" : "@output";

    const existsRegex = new RegExp(`@${tag === "@input" ? "input" : "output"}\\s+\\[?${name}[\\]\\s\\[\\-]?`, "i");
    if (existsRegex.test(result)) {
      continue;
    }

    const scopePart = scope ? ` scope:${scope}` : "";
    const placementPart = placement ? ` [placement:${placement}]` : "";
    const labelPart = label ? ` - ${label}` : "";
    const newLine = ` * ${tag} ${name}${scopePart}${placementPart}${labelPart}`;

    if (direction === "INPUT" && !scope) {
      const firstScopedOutputMatch = result.match(/(\n)(\s*\*\s*@output\s+\w+\s+scope:)/);
      if (firstScopedOutputMatch) {
        result = result.replace(
          /(\n)(\s*\*\s*@output\s+\w+\s+scope:)/,
          `$1${newLine}\n$2`
        );
      } else {
        const firstScopedInputMatch = result.match(/(\n)(\s*\*\s*@input\s+\w+\s+scope:)/);
        if (firstScopedInputMatch) {
          result = result.replace(
            /(\n)(\s*\*\s*@input\s+\w+\s+scope:)/,
            `$1${newLine}\n$2`
          );
        } else {
          const firstOutputMatch = result.match(/(\n)(\s*\*\s*@output\s+)/);
          if (firstOutputMatch) {
            result = result.replace(/(\n)(\s*\*\s*@output\s+)/, `$1${newLine}\n$2`);
          } else {
            result = result.replace(/(\n)(\s*\*\/)/, `$1${newLine}\n$2`);
          }
        }
      }
    } else if (direction === "OUTPUT" && scope) {
      const lines = result.split("\n");
      let insertIndex = -1;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/@input\s+\w+/.test(line) && line.includes("scope:")) {
          insertIndex = i;
          break;
        }
      }

      if (insertIndex === -1) {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (/@output\s+\w+/.test(line) && !line.includes("scope:")) {
            insertIndex = i;
            break;
          }
        }
      }

      if (insertIndex !== -1) {
        lines.splice(insertIndex, 0, newLine);
        result = lines.join("\n");
      } else {
        result = result.replace(/(\n)(\s*\*\/)/, `$1${newLine}\n$2`);
      }
    } else if (direction === "INPUT" && scope) {
      const lines = result.split("\n");
      let insertIndex = -1;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/@output\s+\w+/.test(line) && !line.includes("scope:")) {
          insertIndex = i;
          break;
        }
      }

      if (insertIndex !== -1) {
        lines.splice(insertIndex, 0, newLine);
        result = lines.join("\n");
      } else {
        result = result.replace(/(\n)(\s*\*\/)/, `$1${newLine}\n$2`);
      }
    } else {
      result = result.replace(/(\n)(\s*\*\/)/, `$1${newLine}\n$2`);
    }
  }

  return result;
}
