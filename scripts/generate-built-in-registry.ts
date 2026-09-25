#!/usr/bin/env tsx
/**
 * Generates src/built-in-nodes/generated-registry.ts from the actual source files.
 *
 * This eliminates divergence risk between the source implementations and the
 * registry's hardcoded function bodies.
 *
 * Run: tsx scripts/generate-built-in-registry.ts
 *      tsx scripts/generate-built-in-registry.ts --check
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { AnnotationParser } from '../src/parser/annotation-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BUILT_IN_FILES: Array<{
  file: string;
  functionName: string;
  receivesAbortSignal?: boolean;
  receivesRuntime?: boolean;
  durableGate?: 'approval' | 'input' | 'agent' | 'timer';
  durablePure?: boolean;
}> = [
  { file: 'delay.ts', functionName: 'delay', receivesAbortSignal: true, receivesRuntime: true, durablePure: true },
  { file: 'sleep.ts', functionName: 'sleep', receivesRuntime: true, durableGate: 'timer' as const },
  { file: 'wait-for-event.ts', functionName: 'waitForEvent', receivesRuntime: true, durableGate: 'input' as const },
  { file: 'invoke-workflow.ts', functionName: 'invokeWorkflow', receivesAbortSignal: true, receivesRuntime: true, durablePure: true },
  { file: 'wait-for-agent.ts', functionName: 'waitForAgent', receivesAbortSignal: true, receivesRuntime: true, durableGate: 'agent' as const },
];

const BUILT_IN_DIR = path.join(ROOT, 'src', 'built-in-nodes');
const OUTPUT_PATH = path.join(BUILT_IN_DIR, 'generated-registry.ts');

// ---------------------------------------------------------------------------
// Mock helpers, extracted from mock-types.ts and transpiled to JS
// ---------------------------------------------------------------------------

function extractMockHelpers(): string {
  const mockSrc = fs.readFileSync(path.join(BUILT_IN_DIR, 'mock-types.ts'), 'utf-8');

  // Extract getMockConfig function body
  const getMockMatch = mockSrc.match(/export function getMockConfig\([^)]*\)[^{]*\{([\s\S]*?\n\})/);
  if (!getMockMatch) throw new Error('Could not extract getMockConfig from mock-types.ts');

  // Extract lookupMock function body
  const lookupMockMatch = mockSrc.match(/export function lookupMock[^{]*\{([\s\S]*?\n\})/);
  if (!lookupMockMatch) throw new Error('Could not extract lookupMock from mock-types.ts');

  const getMockFull = getMockMatch[0];
  const lookupMockFull = `export function lookupMock${lookupMockMatch[0].slice(lookupMockMatch[0].indexOf('<'))}`;

  // Keep the TypeScript (see the note in main()) and rename to __fw_ prefix.
  const getMockJS = getMockFull
    .replace('export function getMockConfig', 'function __fw_getMockConfig')
    .trim();
  const lookupMockJS = lookupMockFull
    .replace('export function lookupMock', 'function __fw_lookupMock')
    .trim();

  return `${getMockJS}\n\n${lookupMockJS}`;
}

// Extracted once, and loudly: an empty helper text would compile into every
// workflow that uses a built-in node and fail there instead of here.
const MOCK_HELPERS = extractMockHelpers();

// ---------------------------------------------------------------------------
// Source file processing
// ---------------------------------------------------------------------------

function readSource(fileName: string): string {
  return fs.readFileSync(path.join(BUILT_IN_DIR, fileName), 'utf-8');
}

/**
 * Extract function bodies from source, stripping imports and JSDoc annotations.
 * Returns raw TypeScript (still has types).
 */
function extractFunctionBodies(source: string): string {
  let code = source;
  // Remove import lines
  code = code.replace(/^import\s.*;\s*$/gm, '');
  // Remove JSDoc block above `export async function`
  code = code.replace(/\/\*\*[\s\S]*?\*\/\s*(?=export\s+async\s+function)/g, '');
  // Remove `export` keyword
  code = code.replace(/^export\s+/gm, '');
  return code.trim();
}

/**
 * Inline mock calls: getMockConfig() → __fw_getMockConfig(),
 * lookupMock( → __fw_lookupMock(
 */
function inlineMockCalls(code: string): string {
  return code
    .replace(/\bgetMockConfig\(/g, '__fw_getMockConfig(')
    .replace(/\blookupMock\(/g, '__fw_lookupMock(');
}

/**
 * Prefix file-level helper function names with __fw_ to avoid collisions.
 * E.g., parseDuration → __fw_parseDuration
 */
function prefixHelpers(code: string, mainFunctionName: string): string {
  // Find all function declarations that are NOT the main function
  const funcPattern = /\bfunction\s+(\w+)\s*\(/g;
  const helpers: string[] = [];
  let m;
  while ((m = funcPattern.exec(code)) !== null) {
    const name = m[1];
    if (name !== mainFunctionName) {
      helpers.push(name);
    }
  }
  let result = code;
  for (const helper of helpers) {
    // Replace all references to the helper (as whole word)
    result = result.replace(new RegExp(`\\b${helper}\\b`, 'g'), `__fw_${helper}`);
  }
  return result;
}

/**
 * Create production version of a TypeScript source by removing mock-related code.
 *
 * This works on the TypeScript source (before transpilation) where the patterns
 * are clean and predictable. Each built-in node follows one of two patterns:
 *
 * Pattern A (delay):
 *   const mocks = __fw_getMockConfig();
 *   if (mocks?.fast) { ... } else { <real code> }
 *   → keep only the <real code> from the else branch
 *
 * Pattern B (waitForEvent, invokeWorkflow):
 *   const mocks = __fw_getMockConfig();
 *   if (mocks) { <mock code> }
 *   <real code>
 *   → remove const mocks line and the if (mocks) block, keep the rest
 *
 * Pattern C (waitForAgent):
 *   const mocks = __fw_getMockConfig();
 *   const mockResult = __fw_lookupMock(mocks?.agents, agentId);
 *   if (mockResult !== undefined) { ... }
 *   if (mocks?.agents) { ... }
 *   <real code>
 *   → remove all four lines/blocks, keep the rest
 */
function createProductionTS(tsCode: string, functionName: string): string {
  const lines = tsCode.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip import lines (shouldn't be any, but just in case)
    if (trimmed.startsWith('import ')) {
      i++;
      continue;
    }

    // Skip `const mocks = __fw_getMockConfig();`
    if (trimmed.startsWith('const mocks = __fw_getMockConfig(')) {
      i++;
      // For delay: the next line is `if (mocks?.fast) { ... } else { ... }`
      // For waitForEvent/invokeWorkflow: `if (mocks) { ... }` block
      // For waitForAgent: `const mockResult = ...`
      // We handle each in their respective patterns below
      continue;
    }

    // Skip `const mockResult = __fw_lookupMock(...)` or `const mockData = __fw_lookupMock(...)`
    if (trimmed.match(/^const mock\w+ = __fw_lookupMock\(/)) {
      i++;
      continue;
    }

    // Handle `if (mocks?.fast)` (delay pattern) - extract else branch content
    if (trimmed.startsWith('if (mocks?.fast)')) {
      // Find the else branch, extract its contents
      const block = collectBlock(lines, i);
      const elseBranch = extractElseBranch(block.text);
      if (elseBranch) {
        result.push(elseBranch);
      }
      i = block.endLine + 1;
      continue;
    }

    // Handle `if (mocks)` blocks (waitForEvent, invokeWorkflow)
    if (trimmed === 'if (mocks) {' || trimmed.startsWith('if (mocks)')) {
      const block = collectBlock(lines, i);
      i = block.endLine + 1;
      continue;
    }

    // Handle `if (mockResult !== undefined)` or `if (mockData !== undefined)`
    if (trimmed.match(/^if \(mock\w+ !== undefined\)/)) {
      const block = collectBlock(lines, i);
      i = block.endLine + 1;
      continue;
    }

    // Handle `if (mocks?.agents)` or `if (mocks?.events)` etc.
    if (trimmed.match(/^if \(mocks\?\.\w+\)/)) {
      const block = collectBlock(lines, i);
      i = block.endLine + 1;
      continue;
    }

    // Skip single-line comments about mocks
    if (trimmed.startsWith('//') && trimmed.toLowerCase().includes('mock')) {
      i++;
      continue;
    }

    result.push(line);
    i++;
  }

  return result.join('\n');
}

/**
 * Collect a block starting at line i (which contains the opening `{`).
 * Returns the full text and the ending line index.
 */
function collectBlock(lines: string[], startLine: number): { text: string; endLine: number } {
  const collected: string[] = [];
  let depth = 0;
  let foundOpen = false;
  let i = startLine;

  while (i < lines.length) {
    const line = lines[i];
    collected.push(line);

    for (const ch of line) {
      if (ch === '{') {
        depth++;
        foundOpen = true;
      } else if (ch === '}') {
        depth--;
      }
    }

    if (foundOpen && depth === 0) {
      return { text: collected.join('\n'), endLine: i };
    }
    i++;
  }

  return { text: collected.join('\n'), endLine: i - 1 };
}

/**
 * From an if/else block, extract the content of the else branch.
 * Input: `if (...) { ... } else { <content> }`
 * Output: the <content> lines, de-indented by one level.
 */
function extractElseBranch(block: string): string | null {
  const elseIdx = block.indexOf('} else {');
  if (elseIdx === -1) return null;

  // Find the content between `else {` and the final `}`
  const afterElse = block.slice(elseIdx + '} else {'.length);
  // Remove the last `}`
  const lastBrace = afterElse.lastIndexOf('}');
  if (lastBrace === -1) return null;

  const content = afterElse.slice(0, lastBrace).trim();
  // De-indent by one level (remove leading 2 or 4 spaces from each line)
  return content.replace(/^    /gm, '  ');
}

// ---------------------------------------------------------------------------
// Port definition extraction using AnnotationParser
// ---------------------------------------------------------------------------

/**
 * Extract node type definition from a source file using the AnnotationParser
 * for structural info (ports, labels, optional flags) and direct return-type
 * parsing for correct data types (the annotation parser doesn't always infer
 * output types from the function's return type for non-expression nodeTypes).
 */
function extractNodeType(source: string, functionName: string) {
  // Parse with annotations
  const parser = new AnnotationParser();
  const parseResult = parser.parseFromString(source, `${functionName}.ts`);
  const annotated = parseResult.nodeTypes.find((nt) => nt.functionName === functionName);
  if (!annotated) {
    throw new Error(`Could not find nodeType for ${functionName} in parsed result`);
  }

  // Extract return type fields directly from source for correct data types.
  // The return type looks like: Promise<{ onSuccess: boolean; onFailure: boolean; elapsed: boolean }>
  const returnFields = extractReturnTypeFields(source);

  return { annotated, returnFields };
}

/**
 * Map TypeScript type strings to flow-weaver data types.
 */
function tsTypeToDataType(tsType: string): string {
  switch (tsType.trim()) {
    case 'boolean': return 'BOOLEAN';
    case 'string': return 'STRING';
    case 'number': return 'NUMBER';
    case 'object': return 'OBJECT';
    default: return 'ANY';
  }
}

/**
 * Extract field names and types from the Promise<{...}> return type in source.
 * Returns a map from field name to { dataType, tsType }.
 */
function extractReturnTypeFields(source: string): Record<string, { dataType: string; tsType: string }> {
  const result: Record<string, { dataType: string; tsType: string }> = {};

  // Match: Promise<{ field: type; field: type; ... }>
  const returnMatch = source.match(/Promise<\{([^}]+)\}>/);
  if (!returnMatch) return result;

  const fields = returnMatch[1].split(';');
  for (const field of fields) {
    const trimmed = field.trim();
    if (!trimmed) continue;
    const [name, type] = trimmed.split(':').map((s) => s.trim());
    if (name && type) {
      result[name] = { dataType: tsTypeToDataType(type), tsType: type };
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Port normalization — match the old registry's port definitions exactly
// ---------------------------------------------------------------------------

function buildInputPorts(
  annotated: { inputs: Record<string, { dataType: string; label?: string; tsType?: string; optional?: boolean }> },
): Record<string, Record<string, unknown>> {
  const inputs: Record<string, Record<string, unknown>> = {};

  // execute always first
  inputs.execute = { dataType: 'STEP', label: 'Execute' };

  // Other inputs in order (skip execute)
  for (const [name, def] of Object.entries(annotated.inputs)) {
    if (name === 'execute') continue;
    const port: Record<string, unknown> = {
      dataType: def.dataType,
      label: def.label ?? name,
    };
    if (def.tsType) port.tsType = def.tsType;
    if (def.optional) port.optional = true;
    inputs[name] = port;
  }

  return inputs;
}

function buildOutputPorts(
  annotated: { outputs: Record<string, { dataType: string; label?: string; tsType?: string }> },
  returnFields: Record<string, { dataType: string; tsType: string }>,
): Record<string, Record<string, unknown>> {
  const outputs: Record<string, Record<string, unknown>> = {};

  // onSuccess/onFailure always first
  outputs.onSuccess = { dataType: 'STEP', label: 'On Success', isControlFlow: true };
  outputs.onFailure = { dataType: 'STEP', label: 'On Failure', failure: true, isControlFlow: true };

  // Data outputs (skip onSuccess/onFailure)
  for (const [name, def] of Object.entries(annotated.outputs)) {
    if (name === 'onSuccess' || name === 'onFailure') continue;

    // Use return-type-derived data type (correct) instead of annotation-derived (may be ANY)
    const returnField = returnFields[name];
    const dataType = returnField?.dataType ?? def.dataType;
    const tsType = returnField?.tsType ?? def.tsType;

    const port: Record<string, unknown> = {
      dataType,
      label: def.label ?? name,
    };
    if (tsType) port.tsType = tsType;
    outputs[name] = port;
  }

  return outputs;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function escapeString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function serializePortDef(port: Record<string, unknown>): string {
  const parts: string[] = [];
  if (port.dataType) parts.push(`dataType: '${port.dataType}'`);
  if (port.label) parts.push(`label: '${escapeString(port.label as string)}'`);
  if (port.tsType) parts.push(`tsType: '${port.tsType}'`);
  if (port.optional) parts.push(`optional: true`);
  if (port.isControlFlow) parts.push(`isControlFlow: true`);
  if (port.failure) parts.push(`failure: true`);
  return `{ ${parts.join(', ')} }`;
}

function serializePorts(ports: Record<string, Record<string, unknown>>, indent: string): string {
  const entries = Object.entries(ports);
  if (entries.length === 0) return '{}';
  const lines = entries.map(([name, def]) => `${indent}  ${name}: ${serializePortDef(def)},`);
  return `{\n${lines.join('\n')}\n${indent}}`;
}

function escapeForTemplate(code: string): string {
  return code.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const entries: string[] = [];

  for (const { file, functionName, receivesAbortSignal, receivesRuntime, durableGate, durablePure } of BUILT_IN_FILES) {
    const source = readSource(file);

    // 1. Parse to get port definitions
    const { annotated, returnFields } = extractNodeType(source, functionName);
    const inputs = buildInputPorts(annotated);
    const outputs = buildOutputPorts(annotated, returnFields);

    // 2. Extract function bodies (TypeScript, no imports/jsdoc/export)
    const tsBodies = extractFunctionBodies(source);

    // 3. Inline mock calls and prefix helper functions
    let tsInlined = inlineMockCalls(tsBodies);
    tsInlined = prefixHelpers(tsInlined, functionName);

    // 4. Create production TypeScript version (mock code removed)
    const tsProduction = createProductionTS(tsInlined, functionName);

    // 5. Keep the TypeScript. These bodies are inlined into a generated
    // TypeScript file, where every type they name is already in scope:
    // `NodeExecutionRuntime` comes from the inlined durable engine and
    // `FwMockConfig` from the inline runtime. Stripping the types instead
    // made every parameter an implicit `any`, which fails the generated
    // file under `noImplicitAny`, and left call sites unable to recover a
    // type through `Parameters<typeof fn>`. A JavaScript output is still
    // possible: `generate.ts` strips types from the whole assembled file
    // when `outputFormat` is 'javascript'.
    let jsCode = tsInlined.replace(/^export\s+/gm, '').trim();
    let jsProduction = tsProduction.replace(/^export\s+/gm, '').trim();

    // 6. Build registry entry, with helpers separated from the main function
    const indent = '    ';
    const durableClassification =
      `${durableGate ? `    durableGate: '${durableGate}',\n` : ''}` +
      `${durablePure ? '    durablePure: true,\n' : ''}`;
    const entry = `  {
    type: 'NodeType',
    name: '${functionName}',
    functionName: '${functionName}',
    isAsync: ${annotated.isAsync},
    receivesAbortSignal: ${receivesAbortSignal ?? false},
    receivesRuntime: ${receivesRuntime ?? false},
${durableClassification}    hasSuccessPort: ${annotated.hasSuccessPort},
    hasFailurePort: ${annotated.hasFailurePort},
    executeWhen: '${annotated.executeWhen}',
    variant: '${annotated.variant ?? 'FUNCTION'}',
    inputs: ${serializePorts(inputs, indent)},
    outputs: ${serializePorts(outputs, indent)},
    helperText: \`\n${escapeForTemplate(MOCK_HELPERS)}\n\`.trim(),
    helperTextProduction: undefined,
    functionText: \`\n${escapeForTemplate(jsCode)}\n\`.trim(),
    functionTextProduction: \`\n${escapeForTemplate(jsProduction)}\n\`.trim(),
  }`;

    entries.push(entry);
  }

  const output = `/**
 * DO NOT EDIT - generated by scripts/generate-built-in-registry.ts
 *
 * Registry of built-in node types for auto-injection into the parser.
 * Generated from the actual source files in src/built-in-nodes/.
 */

import type { TNodeTypeAST } from '../ast/types';
` + `
export const BUILT_IN_NODE_TYPES: TNodeTypeAST[] = [
${entries.join(',\n')},
];
`;

  const checkMode = process.argv.includes('--check');

  if (checkMode) {
    let existing = '';
    try {
      existing = fs.readFileSync(OUTPUT_PATH, 'utf-8');
    } catch {
      console.error('generated-registry.ts does not exist. Run: npm run generate:registry');
      process.exit(1);
    }
    if (existing !== output) {
      console.error('generated-registry.ts is out of date. Run: npm run generate:registry');
      process.exit(1);
    }
    console.log('generated-registry.ts is up to date.');
    return;
  }

  fs.writeFileSync(OUTPUT_PATH, output, 'utf-8');
  console.log(`Generated ${path.relative(ROOT, OUTPUT_PATH)}`);
}

main();
