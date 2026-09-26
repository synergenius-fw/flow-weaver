/**
 * @module jsdoc-port-sync/port-tag-placement
 *
 * The steps of `updatePortsInFunctionText`: decides which existing JSDoc
 * port lines stay (removed ports go, lines being typed stay as they are), and
 * where the tag of each new port goes: into an orphan line first, then next to
 * its signature neighbours, after the last line of its kind, or before the
 * closing `*\/`.
 */

import type { TPortDefinition } from '../ast/types';
import { generateJSDocPortTag } from '../generator/annotation-generator';
import { parsePortLine } from '../chevrotain-parser/port-parser';
import { PORT_TAG_REGEX, ORPHAN_PORT_LINE_REGEX } from './constants';
import { isIncompletePortLine, partialPortTag } from './incomplete-lines';

type PortRecord = Record<string, TPortDefinition>;
type PortEntry = [string, TPortDefinition];
type Direction = 'input' | 'output';

/** An orphan line (`@input` with no name yet) waiting for a port. */
interface OrphanLine {
  index: number;
  type: string;
}

/** The existing JSDoc lines to keep, and what they say about the ports. */
export interface PortLineScan {
  preservedLines: string[];
  hasFlowWeaverTag: boolean;
  /** Ports that already have a line (complete or still being typed). */
  seenInputs: Set<string>;
  seenOutputs: Set<string>;
  orphanInputLines: OrphanLine[];
  orphanOutputLines: OrphanLine[];
  /** Index in `preservedLines` of the last input / output line, or -1. */
  lastInputLineIndex: number;
  lastOutputLineIndex: number;
}

/** Render a port as a JSDoc tag line. */
function tagLine(name: string, port: TPortDefinition, direction: Direction): string {
  return ` * ${generateJSDocPortTag(name, port, direction)}`;
}

function markInputLine(scan: PortLineScan, name: string, index: number): void {
  scan.seenInputs.add(name);
  scan.lastInputLineIndex = index;
}

function markOutputLine(scan: PortLineScan, name: string, index: number): void {
  scan.seenOutputs.add(name);
  scan.lastOutputLineIndex = index;
}

/** Keep an orphan line and remember it as a slot for a new port. */
function keepOrphanLine(scan: PortLineScan, line: string, tagType: string): void {
  const lineIndex = scan.preservedLines.length;
  scan.preservedLines.push(line);
  if (tagType === 'input') {
    scan.orphanInputLines.push({ index: lineIndex, type: 'ANY' });
    scan.lastInputLineIndex = lineIndex;
  } else if (tagType === 'output' || tagType === 'step') {
    scan.orphanOutputLines.push({ index: lineIndex, type: 'ANY' });
    scan.lastOutputLineIndex = lineIndex;
  }
}

/** Keep a line the user is still typing, untouched, and count its port as present. */
function keepIncompleteLine(scan: PortLineScan, line: string): void {
  const lineIndex = scan.preservedLines.length;
  scan.preservedLines.push(line);
  const partial = partialPortTag(line);
  if (!partial) return;
  const { tagType, portName } = partial;
  if (tagType === 'input') {
    markInputLine(scan, portName, lineIndex);
  } else if (tagType === 'output') {
    markOutputLine(scan, portName, lineIndex);
  } else if (tagType === 'step') {
    scan.seenInputs.add(portName);
    scan.seenOutputs.add(portName);
  }
}

/**
 * Keep a parsed port line when its port still exists (trailing whitespace
 * trimmed); drop it when the port was removed. A `@step` line counts for
 * whichever side still has the port.
 */
function keepParsedLine(
  scan: PortLineScan,
  line: string,
  parsed: { type: 'input' | 'output' | 'step'; name: string },
  inputs: PortRecord,
  outputs: PortRecord
): void {
  const lineIndex = scan.preservedLines.length;
  if (parsed.type === 'input') {
    if (!inputs[parsed.name]) return;
    scan.preservedLines.push(line.trimEnd());
    markInputLine(scan, parsed.name, lineIndex);
  } else if (parsed.type === 'output') {
    if (!outputs[parsed.name]) return;
    scan.preservedLines.push(line.trimEnd());
    markOutputLine(scan, parsed.name, lineIndex);
  } else if (parsed.type === 'step') {
    const isInput = inputs[parsed.name] !== undefined;
    const isOutput = outputs[parsed.name] !== undefined;
    if (!isInput && !isOutput) return;
    scan.preservedLines.push(line.trimEnd());
    if (isInput) markInputLine(scan, parsed.name, lineIndex);
    if (isOutput) markOutputLine(scan, parsed.name, lineIndex);
  }
}

/** Handle one port tag line: orphan, still being typed, parsed, or unparseable (kept). */
function scanPortLine(scan: PortLineScan, line: string, inputs: PortRecord, outputs: PortRecord): void {
  const orphanMatch = line.match(ORPHAN_PORT_LINE_REGEX);
  if (orphanMatch) {
    keepOrphanLine(scan, line, orphanMatch[1]);
    return;
  }

  if (isIncompletePortLine(line)) {
    keepIncompleteLine(scan, line);
    return;
  }

  const cleanLine = line.replace(/^\s*\*\s*/, '').trim();
  const parsed = parsePortLine(cleanLine, []);
  if (parsed) {
    keepParsedLine(scan, line, parsed, inputs, outputs);
    return;
  }

  scan.preservedLines.push(line);
}

/**
 * Walk the existing JSDoc lines and decide which to keep. Every non-port line
 * is kept; port lines are kept unless their port was removed.
 */
export function scanPortLines(lines: string[], inputs: PortRecord, outputs: PortRecord): PortLineScan {
  const scan: PortLineScan = {
    preservedLines: [],
    hasFlowWeaverTag: false,
    seenInputs: new Set<string>(),
    seenOutputs: new Set<string>(),
    orphanInputLines: [],
    orphanOutputLines: [],
    lastInputLineIndex: -1,
    lastOutputLineIndex: -1,
  };

  for (const line of lines) {
    if (line.trim() === '/**' || line.trim() === '*/') {
      scan.preservedLines.push(line);
      continue;
    }

    if (PORT_TAG_REGEX.test(line)) {
      scanPortLine(scan, line, inputs, outputs);
      continue;
    }

    if (line.includes('@flowWeaver')) {
      scan.hasFlowWeaverTag = true;
    }
    scan.preservedLines.push(line);
  }

  return scan;
}

/**
 * Write new ports into orphan lines: an orphan of the port's type first, then
 * the earliest orphan. Returns the ports left without a line.
 */
export function fillOrphanLines(
  newLines: string[],
  portsToAdd: PortEntry[],
  orphanLines: OrphanLine[],
  direction: Direction
): PortEntry[] {
  const remaining: PortEntry[] = [];
  for (const [name, port] of portsToAdd) {
    const orphanIndex = orphanLines.findIndex((o) => o.type === port.dataType);
    if (orphanIndex !== -1) {
      const orphan = orphanLines[orphanIndex];
      newLines[orphan.index] = tagLine(name, port, direction);
      orphanLines.splice(orphanIndex, 1);
    } else if (orphanLines.length > 0) {
      const orphan = orphanLines.shift()!;
      newLines[orphan.index] = tagLine(name, port, direction);
    } else {
      remaining.push([name, port]);
    }
  }
  return remaining;
}

/**
 * Insert new output tags after the last output line, else after the last input
 * line, else before the closing `*\/`.
 */
export function insertOutputTags(newLines: string[], outputsToAdd: PortEntry[], scan: PortLineScan): void {
  const newOutputTags = outputsToAdd.map(([name, port]) => tagLine(name, port, 'output'));
  const closingIndex = newLines.findIndex((l) => l.trim() === '*/');
  if (newOutputTags.length === 0) return;
  const outputInsertIndex =
    scan.lastOutputLineIndex >= 0
      ? scan.lastOutputLineIndex + 1
      : scan.lastInputLineIndex >= 0
        ? scan.lastInputLineIndex + 1
        : closingIndex;
  newLines.splice(outputInsertIndex, 0, ...newOutputTags);
}

/**
 * Insert non-scoped inputs next to their neighbours in the signature: before
 * the first later parameter that has a line, else after the closest earlier
 * one, else right after `@flowWeaver`. Inputs not in the signature are skipped.
 */
function insertInputsInSignatureOrder(
  newLines: string[],
  inputsToAdd: PortEntry[],
  signatureInputOrder: string[],
  flowWeaverIndex: number
): void {
  const existingInputLineIndices: Record<string, number> = {};
  for (let i = 0; i < newLines.length; i++) {
    const cleanLine = newLines[i].replace(/^\s*\*\s*/, '').trim();
    const parsed = parsePortLine(cleanLine, []);
    if (parsed && parsed.type === 'input') {
      existingInputLineIndices[parsed.name] = i;
    }
  }

  const sortedInputsToAdd = inputsToAdd
    .map(([name, port]) => ({ name, port, sigIndex: signatureInputOrder.indexOf(name) }))
    .filter((item) => item.sigIndex !== -1)
    .sort((a, b) => b.sigIndex - a.sigIndex);

  for (const { name, port, sigIndex } of sortedInputsToAdd) {
    const newTag = tagLine(name, port, 'input');

    let insertIndex = -1;
    for (let i = sigIndex + 1; i < signatureInputOrder.length; i++) {
      const nextName = signatureInputOrder[i];
      if (existingInputLineIndices[nextName] !== undefined) {
        insertIndex = existingInputLineIndices[nextName];
        break;
      }
    }
    if (insertIndex === -1) {
      for (let i = sigIndex - 1; i >= 0; i--) {
        const prevName = signatureInputOrder[i];
        if (existingInputLineIndices[prevName] !== undefined) {
          insertIndex = existingInputLineIndices[prevName] + 1;
          break;
        }
      }
      if (insertIndex === -1) {
        insertIndex = flowWeaverIndex >= 0 ? flowWeaverIndex + 1 : 1;
      }
    }

    newLines.splice(insertIndex, 0, newTag);
    for (const [portName, idx] of Object.entries(existingInputLineIndices)) {
      if (idx >= insertIndex) {
        existingInputLineIndices[portName] = idx + 1;
      }
    }
    existingInputLineIndices[name] = insertIndex;
  }
}

/**
 * Insert new input tags. Non-scoped inputs follow the signature order when one
 * is given, else go after the last input line (or after `@flowWeaver`). Scoped
 * inputs go after the last output line, else before the closing `*\/`, matching
 * the standard order: inputs, scoped outputs, scoped inputs, outputs.
 */
export function insertInputTags(
  newLines: string[],
  inputsToAdd: PortEntry[],
  scan: PortLineScan,
  signatureInputOrder?: string[]
): void {
  const flowWeaverIndex = newLines.findIndex((l) => l.includes('@flowWeaver'));
  const scopedInputsToAdd = inputsToAdd.filter(([_, port]) => port.scope);
  const nonScopedInputsToAdd = inputsToAdd.filter(([_, port]) => !port.scope);

  if (signatureInputOrder && signatureInputOrder.length > 0 && nonScopedInputsToAdd.length > 0) {
    insertInputsInSignatureOrder(newLines, nonScopedInputsToAdd, signatureInputOrder, flowWeaverIndex);
  } else if (nonScopedInputsToAdd.length > 0) {
    const nonScopedInputTags = nonScopedInputsToAdd.map(([name, port]) => tagLine(name, port, 'input'));
    const inputInsertIndex =
      scan.lastInputLineIndex >= 0
        ? scan.lastInputLineIndex + 1
        : flowWeaverIndex >= 0
          ? flowWeaverIndex + 1
          : 1;
    newLines.splice(inputInsertIndex, 0, ...nonScopedInputTags);
  }

  if (scopedInputsToAdd.length > 0) {
    const scopedInputTags = scopedInputsToAdd.map(([name, port]) => tagLine(name, port, 'input'));
    const closingIdx = newLines.findIndex((l) => l.trim() === '*/');
    const insertIdx =
      scan.lastOutputLineIndex >= 0
        ? scan.lastOutputLineIndex + 1
        : closingIdx >= 0
          ? closingIdx
          : newLines.length - 1;
    newLines.splice(insertIdx, 0, ...scopedInputTags);
  }
}
