/**
 * Source text lookup for the in-place rewriter.
 *
 * Every rewrite step works on plain text and re-parses it before it edits, so
 * positions always match the text in hand. This module decides how a function
 * is found in that text: a top-level function declaration by name, and when a
 * name is declared twice, the last declaration wins.
 */

import * as ts from 'typescript';

/** The outcome of one rewrite step: the new text, and whether the step changed anything. */
export type SourceEdit = { code: string; changed: boolean };

/** Parse source text with parent pointers set, so nodes can report their own text and positions. */
export function parseSource(source: string): ts.SourceFile {
  return ts.createSourceFile('temp.ts', source, ts.ScriptTarget.Latest, true);
}

/** The last top-level function declaration named `functionName`, if any. */
export function findFunctionDeclaration(
  sourceFile: ts.SourceFile,
  functionName: string
): ts.FunctionDeclaration | undefined {
  let functionNode: ts.FunctionDeclaration | undefined;
  ts.forEachChild(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
      functionNode = node;
    }
  });
  return functionNode;
}
