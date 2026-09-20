/**
 * Lifting a workflow's own JSDoc and signature out of its file.
 *
 * Node types arrive from the parser with a complete `functionText`, but a
 * workflow does not, so the console reads it from the source itself. The
 * naive way -- everything up to the first `{` after the name -- cuts a
 * signature in half the moment a parameter has an inline object type, which
 * every workflow's `params` does.
 */

/** Where a workflow's declaration begins, or -1. */
function findDeclaration(text: string, fnName: string): number {
  // `export function name(`, with optional `async`, not a longer name that
  // merely starts the same way.
  const re = new RegExp(`\\bexport\\s+(?:async\\s+)?function\\s+${fnName}\\s*[(<]`);
  return text.search(re);
}

/**
 * The index just past the `{` that opens the function body.
 *
 * Scans from the parameter list, tracking depth so the braces of an inline
 * object type are passed over, and skipping strings, template literals and
 * comments so a brace inside one is never mistaken for syntax.
 *
 * A return type may hold braces too -- `): { onSuccess: boolean } {` and
 * `): Promise<{ ... }> {` both do -- so the body brace is the first one at
 * depth zero *after* the parameter list has closed, with `<…>` counted as
 * nesting for the generic case.
 */
function endOfSignature(text: string, from: number): number {
  let depth = 0;
  let closedParams = false;
  let inReturnType = false;
  // Start *at* the opening parenthesis so it is counted like any other
  // bracket; starting after it leaves the depth permanently one short.
  const i0 = text.indexOf('(', from);
  if (i0 < 0) return -1;
  let i = i0;

  for (; i < text.length; i++) {
    const c = text[i];

    if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      if (nl < 0) return -1;
      i = nl;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) return -1;
      i = end + 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') i++;
        i++;
      }
      continue;
    }

    // After the parameters close, a `:` introduces the return type. Its
    // own braces (`): { onSuccess: boolean } {`) are not the body.
    if (c === ':' && depth === 0 && closedParams) {
      inReturnType = true;
      continue;
    }

    if (c === '(' || c === '[' || c === '{' || c === '<') {
      // The body is the first `{` at depth zero once the parameters have
      // closed and any return-type annotation has been passed over.
      if (c === '{' && depth === 0 && closedParams && !inReturnType) return i + 1;
      depth++;
      continue;
    }
    if (c === ')' || c === ']' || c === '}' || c === '>') {
      // `=>` inside a parameter's type is an arrow, not a closing bracket.
      if (c === '>' && text[i - 1] === '=') continue;
      depth--;
      if (c === ')' && depth === 0) closedParams = true;
      // The return type ends when its own brackets balance. What follows
      // at depth zero is the body.
      if (depth === 0 && inReturnType && c !== ')') inReturnType = false;
      continue;
    }
  }
  return -1;
}

export interface WorkflowSource {
  source: string;
  line: number;
}

/**
 * The workflow's JSDoc block and full signature, up to the opening brace.
 *
 * @param text - The file's contents.
 * @param fnName - The exported workflow function's name.
 * @returns The source and the 1-based line it starts on. Empty when the
 *   declaration cannot be found.
 */
export function workflowSource(text: string, fnName: string): WorkflowSource {
  const declaration = findDeclaration(text, fnName);
  if (declaration < 0) return { source: '', line: 1 };

  const bodyStart = endOfSignature(text, declaration);
  const end = bodyStart < 0 ? text.length : bodyStart;

  // The JSDoc directly above, when there is one: it carries the annotations.
  const commentStart = text.lastIndexOf('/**', declaration);
  const between = commentStart >= 0 ? text.slice(text.indexOf('*/', commentStart) + 2, declaration) : '';
  const attached = commentStart >= 0 && /^\s*$/.test(between);
  const from = attached ? commentStart : declaration;

  return {
    source: text.slice(from, end).trimEnd(),
    line: text.slice(0, from).split('\n').length,
  };
}
