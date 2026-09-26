/**
 * Workflow function signature.
 *
 * Decides the parameter list and the async shape of the compiled workflow
 * function: `params` is always the second parameter, `__runtime__` is always
 * the last of at most three, and a workflow that must be async is declared
 * `async` with a `Promise<T>` return type. Everything else in the authored
 * signature is left as written.
 */

import * as ts from 'typescript';
import { type SourceEdit, findFunctionDeclaration, parseSource } from './source-file';

/**
 * Detect if a workflow function is declared as async
 */
export function detectFunctionIsAsync(source: string, functionName: string): boolean {
  const functionNode = findFunctionDeclaration(parseSource(source), functionName);
  return !!functionNode?.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
}

/**
 * Ensure the workflow function has the `params` parameter.
 *
 * The generated body always references `params`: the recursion-depth guard
 * reads `params.__rd__`, and every Start data port is read as
 * `params.<portName>`. A workflow whose author signature declares data ports
 * already has `params`, but one with NO Start data ports (a single zero-input
 * node, author signature `(execute)`) omits it, and the generated body then
 * throws `ReferenceError: params is not defined` at runtime.
 *
 * `params` must be the SECOND positional parameter (right after `execute`),
 * because the runtime invokes the workflow as `fn(execute, params, ...)`.
 * Insert it immediately after the first parameter. If the function somehow
 * has no parameters, insert it after the opening paren (the `execute` guard
 * param is always present in practice, so this is defensive).
 */
export function ensureParamsParameter(source: string, functionName: string): SourceEdit {
  const functionNode = findFunctionDeclaration(parseSource(source), functionName);

  if (!functionNode) {
    return { code: source, changed: false };
  }

  // Already has a `params` parameter: nothing to do.
  const hasParams = functionNode.parameters.some(
    (param) => ts.isIdentifier(param.name) && param.name.text === 'params'
  );
  if (hasParams) {
    return { code: source, changed: false };
  }

  const PARAMS_DECL = 'params: Record<string, unknown> = {}';

  const firstParam = functionNode.parameters[0];
  if (!firstParam) {
    // No parameters at all: insert right after the opening paren.
    const openParen = source.indexOf('(', functionNode.name?.end || 0);
    if (openParen === -1) {
      return { code: source, changed: false };
    }
    const before = source.slice(0, openParen + 1);
    const after = source.slice(openParen + 1);
    return { code: before + PARAMS_DECL + after, changed: true };
  }

  // Insert after the first parameter (execute) with a comma so `params`
  // lands in the second positional slot.
  const firstParamEnd = firstParam.end;
  const before = source.slice(0, firstParamEnd);
  const after = source.slice(firstParamEnd);
  return { code: before + ', ' + PARAMS_DECL + after, changed: true };
}

/**
 * Ensure the workflow function has exactly one __runtime__ parameter.
 * The A2 major cutover removes generated debugger and AbortSignal parameters.
 */
export function ensureRuntimeParameter(source: string, functionName: string): SourceEdit {
  const sourceFile = parseSource(source);
  const functionNode = findFunctionDeclaration(sourceFile, functionName);

  if (!functionNode) {
    return { code: source, changed: false };
  }

  const parameters = functionNode.parameters
    .slice(0, 2)
    .map((parameter) => parameter.getText(sourceFile));
  parameters.push('__runtime__: WorkflowRuntime');

  const openParen = source.indexOf('(', functionNode.name?.end ?? 0);
  if (openParen === -1) return { code: source, changed: false };
  const closeParen = functionNode.parameters.end;
  const replacement = parameters.join(', ');
  const current = source.slice(openParen + 1, closeParen);
  if (current.trim() === replacement) return { code: source, changed: false };
  return {
    code: source.slice(0, openParen + 1) + replacement + source.slice(closeParen),
    changed: true,
  };
}

/**
 * Ensure the workflow function has the correct async/non-async modifier.
 * If shouldBeAsync is true and the function is not async, adds the `async` keyword.
 */
export function ensureAsyncKeyword(
  source: string,
  functionName: string,
  shouldBeAsync: boolean
): SourceEdit {
  if (!shouldBeAsync) {
    return { code: source, changed: false };
  }

  const functionNode = findFunctionDeclaration(parseSource(source), functionName);

  if (!functionNode) {
    return { code: source, changed: false };
  }

  const alreadyAsync = !!functionNode.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);

  if (alreadyAsync) {
    return { code: source, changed: false };
  }

  // Find the 'function' keyword position and insert 'async ' before it
  const funcStart = functionNode.getStart();
  const textAfter = source.slice(funcStart);

  // The text at funcStart starts with optional 'export' then 'function'
  // Insert 'async ' right before 'function'
  const functionKeywordOffset = textAfter.indexOf('function');
  if (functionKeywordOffset === -1) {
    return { code: source, changed: false };
  }

  const insertPos = funcStart + functionKeywordOffset;
  const before = source.slice(0, insertPos);
  const after = source.slice(insertPos);

  return {
    code: before + 'async ' + after,
    changed: true,
  };
}

/**
 * Ensure the workflow function's return type is wrapped in Promise<T> when async is required.
 * If shouldBeAsync is true and the return type is not already Promise<...>, wraps it.
 */
export function ensurePromiseReturnType(
  source: string,
  functionName: string,
  shouldBeAsync: boolean
): SourceEdit {
  if (!shouldBeAsync) {
    return { code: source, changed: false };
  }

  const functionNode = findFunctionDeclaration(parseSource(source), functionName);

  if (!functionNode || !functionNode.type) {
    return { code: source, changed: false };
  }

  const returnTypeText = source.slice(functionNode.type.pos, functionNode.type.end).trim();

  // Already wrapped in Promise<...>
  if (returnTypeText.startsWith('Promise<')) {
    return { code: source, changed: false };
  }

  const before = source.slice(0, functionNode.type.pos);
  const after = source.slice(functionNode.type.end);

  return {
    code: before + ' Promise<' + returnTypeText + '>' + after,
    changed: true,
  };
}
