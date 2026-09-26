/**
 * @module jsdoc-port-sync/diff
 *
 * Port diff system for UI sync without regeneration: computes what changed
 * between two port lists and regenerates all port tags in canonical order.
 * Applying a diff to code lives in apply-diff.
 */

import type { TPortDefinition } from "../ast/types";
import { generateJSDocPortTag } from "../generator/annotation-generator";
import { JSDOC_BLOCK_REGEX, PORT_TAG_REGEX } from "./constants";

export { applyPortsDiffToCode } from "./apply-diff";

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

/** The `[order:N]` of a port, or Infinity when it has none. */
function portOrder(port: TPortDefinition): number {
  const order = port.metadata?.order;
  return typeof order === "number" ? order : Infinity;
}

/**
 * Every port tag in canonical order: each group sorted by `[order:N]`, the
 * groups in the order external inputs, scoped outputs, scoped inputs,
 * external outputs.
 */
function orderedPortTags(
  inputs: Record<string, TPortDefinition>,
  outputs: Record<string, TPortDefinition>,
): string[] {
  const sortedInputs = Object.entries(inputs)
    .sort((a, b) => portOrder(a[1]) - portOrder(b[1]));
  const sortedOutputs = Object.entries(outputs)
    .sort((a, b) => portOrder(a[1]) - portOrder(b[1]));

  const externalInputs = sortedInputs.filter(([_, p]) => !p.scope);
  const scopedInputs = sortedInputs.filter(([_, p]) => p.scope);
  const externalOutputs = sortedOutputs.filter(([_, p]) => !p.scope);
  const scopedOutputs = sortedOutputs.filter(([_, p]) => p.scope);

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

  return [...externalInputTags, ...scopedOutputTags, ...scopedInputTags, ...externalOutputTags];
}

/**
 * The JSDoc's lines with every port line removed (valid or not), and
 * `@flowWeaver nodeType` added after the opening line when missing.
 */
function jsdocLinesWithoutPorts(existingJsDoc: string): string[] {
  const preservedLines: string[] = [];
  let hasFlowWeaverTag = false;

  for (const line of existingJsDoc.split("\n")) {
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

  if (!hasFlowWeaverTag) {
    preservedLines.splice(1, 0, " * @flowWeaver nodeType");
  }
  return preservedLines;
}

/**
 * Remove the empty JSDoc lines (" *", " * ", or blank) right before the
 * closing line, so no gap is left between the last kept line and the port tags.
 */
function dropTrailingEmptyLines(lines: string[]): void {
  let closingIdx = lines.findIndex((l) => l.trim() === "*/");
  while (closingIdx > 1) {
    const prevLine = lines[closingIdx - 1];
    const isEmptyJsDocLine = /^\s*\*\s*$/.test(prevLine); // " *" or " * "
    const isBlankLine = prevLine.trim() === ""; // empty or whitespace only
    if (isEmptyJsDocLine || isBlankLine) {
      lines.splice(closingIdx - 1, 1);
      closingIdx--;
    } else {
      break;
    }
  }
}

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
  const allPortTags = orderedPortTags(inputs, outputs);

  if (!jsdocMatch) {
    const newJsDoc = [
      "/**",
      " * @flowWeaver nodeType",
      ...allPortTags,
      " */",
    ].join("\n");
    return newJsDoc + "\n" + functionText;
  }

  const newLines = jsdocLinesWithoutPorts(jsdocMatch[0]);
  dropTrailingEmptyLines(newLines);

  // Insert ALL port tags before closing */
  const insertIndex = newLines.findIndex((l) => l.trim() === "*/");
  newLines.splice(insertIndex, 0, ...allPortTags);

  const newJsDoc = newLines.join("\n");

  return functionText.replace(JSDOC_BLOCK_REGEX, newJsDoc);
}
