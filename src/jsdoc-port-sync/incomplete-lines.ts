/**
 * @module jsdoc-port-sync/incomplete-lines
 *
 * Decides which JSDoc port lines the user is still typing, so a sync never
 * rewrites or duplicates them: orphan lines (a tag with no name yet) and
 * incomplete lines (a tag the port grammar does not accept yet).
 */

import { isValidPortLine as chevrotainIsValidPortLine } from '../chevrotain-parser/port-parser';
import { JSDOC_BLOCK_REGEX, PORT_TAG_REGEX, ORPHAN_PORT_LINE_REGEX } from './constants';

type PortTagType = 'input' | 'output' | 'step';

/**
 * The tag type and port name of a port line, read loosely enough to work on a
 * line that does not parse yet (`@input [name` counts).
 */
export function partialPortTag(line: string): { tagType: PortTagType; portName: string } | null {
  const partialMatch = line.match(/\*\s*@(input|output|step)\s+\[?(\w+)/);
  if (!partialMatch) return null;
  return { tagType: partialMatch[1] as PortTagType, portName: partialMatch[2] };
}

/**
 * Check if the code has any orphan port lines (type but no name).
 * Used to skip rename detection when user is editing port names.
 */
export function hasOrphanPortLines(functionText: string): { inputs: boolean; outputs: boolean } {
  const jsdocMatch = functionText.match(JSDOC_BLOCK_REGEX);
  if (!jsdocMatch) return { inputs: false, outputs: false };

  const lines = jsdocMatch[0].split('\n');
  let hasOrphanInputs = false;
  let hasOrphanOutputs = false;

  for (const line of lines) {
    const orphanMatch = line.match(ORPHAN_PORT_LINE_REGEX);
    if (orphanMatch) {
      const [, tagType] = orphanMatch;
      if (tagType === 'input') hasOrphanInputs = true;
      else hasOrphanOutputs = true;
    }
  }

  return { inputs: hasOrphanInputs, outputs: hasOrphanOutputs };
}

/**
 * Extract port names from incomplete JSDoc lines.
 * These are lines where the user is still typing.
 * Used to prevent generating duplicate tags for ports being edited.
 */
export function getIncompletePortNames(functionText: string): {
  inputs: Set<string>;
  outputs: Set<string>;
  steps: Set<string>;
} {
  const inputs = new Set<string>();
  const outputs = new Set<string>();
  const steps = new Set<string>();

  const jsdocMatch = functionText.match(JSDOC_BLOCK_REGEX);
  if (!jsdocMatch) return { inputs, outputs, steps };

  const lines = jsdocMatch[0].split('\n');

  for (const line of lines) {
    // Check if it looks like a port line but doesn't parse
    if (!PORT_TAG_REGEX.test(line)) continue;
    if (chevrotainIsValidPortLine(line)) continue;

    // Try to extract partial port name from incomplete line
    const partial = partialPortTag(line);
    if (partial) {
      const { tagType, portName } = partial;
      if (tagType === 'input') {
        inputs.add(portName);
      } else if (tagType === 'output') {
        outputs.add(portName);
      } else if (tagType === 'step') {
        steps.add(portName);
      }
    }
  }

  return { inputs, outputs, steps };
}

/**
 * Check if a line is incomplete (port tag but not fully valid).
 * Also detects "incomplete description" patterns like "@input name -" (dash but no text).
 */
export function isIncompletePortLine(line: string): boolean {
  if (!PORT_TAG_REGEX.test(line)) return false;

  // Check if Chevrotain considers it invalid
  if (!chevrotainIsValidPortLine(line)) return true;

  // Also treat trailing dash (user typing description) as incomplete
  const cleanLine = line.replace(/^\s*\*\s*/, '').trim();
  if (/\s-\s*$/.test(cleanLine)) return true;

  return false;
}
