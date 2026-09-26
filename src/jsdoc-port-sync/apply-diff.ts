/**
 * @module jsdoc-port-sync/apply-diff
 *
 * Applies a port diff to code as targeted text edits, without regenerating
 * existing lines, so lines the user is still typing survive. Decides where a
 * new tag goes so the standard order holds: inputs, scoped outputs, scoped
 * inputs, outputs. Type changes edit the signature, since types come from it.
 */

import type { TDataType } from "../ast/types";
import type { TPortDiff } from "./diff";
import { portTypeToTsType } from "./signature-parser";

type Direction = "INPUT" | "OUTPUT";

function tagFor(direction: Direction): "@input" | "@output" {
  return direction === "INPUT" ? "@input" : "@output";
}

/** Remove the whole tag line of each removed port. */
function removePortLines(code: string, removed: TPortDiff["removed"]): string {
  let result = code;
  for (const { name, direction } of removed) {
    const tag = tagFor(direction);
    const lineRegex = new RegExp(`^\\s*\\*\\s*${tag}\\s+\\[?${name}\\]?(?:[^\\S\\n]+|[^\\S\\n]*-|[^\\S\\n]*\\[order|$).*$\\n?`, "gm");
    result = result.replace(lineRegex, "");
  }
  return result;
}

/** Rename the port in its tag, keeping optional brackets. */
function renamePortTags(code: string, renamed: TPortDiff["renamed"]): string {
  let result = code;
  for (const { from, to, direction } of renamed) {
    const tag = tagFor(direction);
    const renameRegex = new RegExp(`(${tag}\\s+)(\\[?)${from}(\\]?\\b)`, "g");
    result = result.replace(renameRegex, `$1$2${to}$3`);
  }
  return result;
}

/**
 * Rewrite the label of each tag as `name [scope:s] - label`, dropping its
 * `[order:N]`. When no tag matches, a new tag line is added before `*\/`.
 */
function updatePortLabels(code: string, labelChanged: TPortDiff["labelChanged"]): string {
  let result = code;
  for (const { name, label, direction, scope } of labelChanged) {
    const tag = tagFor(direction);
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
      result = insertBeforeClose(result, newLine);
    }
  }
  return result;
}

/** Simple types: word characters, [], and optional ? */
const SIMPLE_TYPE_PATTERN = `[\\w\\[\\]\\?]+`;
/**
 * The standard function type we generate, `(...args: any[]) => any`. Safe to
 * replace because its exact structure is known.
 */
const STANDARD_FUNCTION_PATTERN = `\\(\\.\\.\\.args:\\s*any\\[\\]\\)\\s*=>\\s*any`;

/** Change a parameter's type when it is a simple type or the standard function type. */
function updateParamType(code: string, name: string, tsType: string): string {
  const simpleParamRegex = new RegExp(
    `(\\b${name}\\??\\s*):\\s*(${SIMPLE_TYPE_PATTERN})\\s*([,)])`,
    "g"
  );
  const result = code.replace(simpleParamRegex, `$1: ${tsType}$3`);
  if (result !== code) return result;

  const funcParamRegex = new RegExp(
    `(\\b${name}\\??\\s*):\\s*(${STANDARD_FUNCTION_PATTERN})\\s*([,)])`,
    "g"
  );
  return code.replace(funcParamRegex, `$1: ${tsType}$3`);
}

/**
 * Change a field's type inside the return type annotation only (between `): {`
 * and the `}` before the body's `{` or `=>`), never in return statements.
 */
function updateReturnFieldType(code: string, name: string, tsType: string): string {
  const returnTypeMatch = code.match(/(\)\s*:\s*)(\{[^}]+\})(\s*(?:\{|=>))/);
  if (!returnTypeMatch) return code;

  const beforeReturnType = code.substring(0, returnTypeMatch.index! + returnTypeMatch[1].length);
  const returnTypeContent = returnTypeMatch[2];
  const afterReturnType = code.substring(returnTypeMatch.index! + returnTypeMatch[1].length + returnTypeContent.length);

  const simpleReturnRegex = new RegExp(
    `(\\b${name}\\s*):\\s*(${SIMPLE_TYPE_PATTERN})\\s*([,;}])`,
    "g"
  );
  let newReturnType = returnTypeContent.replace(simpleReturnRegex, `$1: ${tsType}$3`);

  if (newReturnType === returnTypeContent) {
    const funcReturnRegex = new RegExp(
      `(\\b${name}\\s*):\\s*(${STANDARD_FUNCTION_PATTERN})\\s*([,;}])`,
      "g"
    );
    newReturnType = returnTypeContent.replace(funcReturnRegex, `$1: ${tsType}$3`);
  }

  return beforeReturnType + newReturnType + afterReturnType;
}

/** Write each changed type into the signature: inputs as parameters, outputs as return type fields. */
function updateSignatureTypes(code: string, typeChanged: TPortDiff["typeChanged"]): string {
  let result = code;
  for (const { name, type, direction } of typeChanged) {
    const tsType = portTypeToTsType(type as TDataType);
    result = direction === "INPUT"
      ? updateParamType(result, name, tsType)
      : updateReturnFieldType(result, name, tsType);
  }
  return result;
}

/** Insert a line before the JSDoc's closing `*\/`. */
function insertBeforeClose(result: string, newLine: string): string {
  return result.replace(/(\n)(\s*\*\/)/, `$1${newLine}\n$2`);
}

/**
 * Insert a line before the first line matching the first predicate that
 * matches any line; before `*\/` when none does. Splits on "\n" only, as the
 * lines are rejoined with it and a CRLF text must come back byte for byte.
 */
function insertBeforeFirstLine(result: string, newLine: string, predicates: Array<(line: string) => boolean>): string {
  const lines = result.split("\n");
  for (const matches of predicates) {
    const insertIndex = lines.findIndex(matches);
    if (insertIndex !== -1) {
      lines.splice(insertIndex, 0, newLine);
      return lines.join("\n");
    }
  }
  return insertBeforeClose(result, newLine);
}

/** Anchors for a new non-scoped input, in order of preference: it goes before the first one found. */
const UNSCOPED_INPUT_ANCHORS = [
  /(\n)(\s*\*\s*@output\s+\w+\s+scope:)/,
  /(\n)(\s*\*\s*@input\s+\w+\s+scope:)/,
  /(\n)(\s*\*\s*@output\s+)/,
];

const isScopedInputLine = (line: string): boolean => /@input\s+\w+/.test(line) && line.includes("scope:");
const isUnscopedOutputLine = (line: string): boolean => /@output\s+\w+/.test(line) && !line.includes("scope:");

/**
 * Place a new tag line: a non-scoped input before the first scoped output,
 * scoped input or output; a scoped output before the first scoped input or
 * non-scoped output; a scoped input before the first non-scoped output; a
 * non-scoped output before `*\/`.
 */
function insertPortLine(code: string, newLine: string, direction: Direction, scope: string | undefined): string {
  if (direction === "INPUT" && !scope) {
    const anchor = UNSCOPED_INPUT_ANCHORS.find((regex) => regex.test(code));
    return anchor ? code.replace(anchor, `$1${newLine}\n$2`) : insertBeforeClose(code, newLine);
  }
  if (direction === "OUTPUT" && scope) {
    return insertBeforeFirstLine(code, newLine, [isScopedInputLine, isUnscopedOutputLine]);
  }
  if (direction === "INPUT" && scope) {
    return insertBeforeFirstLine(code, newLine, [isUnscopedOutputLine]);
  }
  return insertBeforeClose(code, newLine);
}

/** Add a tag line for each added port that has none yet. */
function addPortLines(code: string, added: TPortDiff["added"]): string {
  let result = code;
  for (const { name, direction, label, scope, placement } of added) {
    const tag = tagFor(direction);

    const existsRegex = new RegExp(`@${tag === "@input" ? "input" : "output"}\\s+\\[?${name}[\\]\\s\\[\\-]?`, "i");
    if (existsRegex.test(result)) {
      continue;
    }

    const scopePart = scope ? ` scope:${scope}` : "";
    const placementPart = placement ? ` [placement:${placement}]` : "";
    const labelPart = label ? ` - ${label}` : "";
    const newLine = ` * ${tag} ${name}${scopePart}${placementPart}${labelPart}`;

    result = insertPortLine(result, newLine, direction, scope);
  }
  return result;
}

/**
 * Apply a port diff to code without regenerating existing lines.
 * This preserves incomplete/in-progress lines the user is typing.
 */
export function applyPortsDiffToCode(code: string, diff: TPortDiff): string {
  let result = removePortLines(code, diff.removed);
  result = renamePortTags(result, diff.renamed);
  result = updatePortLabels(result, diff.labelChanged);
  result = updateSignatureTypes(result, diff.typeChanged);
  return addPortLines(result, diff.added);
}
