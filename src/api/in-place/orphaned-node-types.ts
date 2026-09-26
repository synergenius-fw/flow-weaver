/**
 * Orphaned node type functions.
 *
 * Decides which `@flowWeaver nodeType` functions in the file no longer belong
 * to any workflow (typically left behind by a rename) and removes them with
 * their JSDoc. In a multi-workflow file a function is kept while any of the
 * file's workflows still uses it.
 */

import * as ts from 'typescript';
import type { TWorkflowAST } from '../../ast/types';
import { type SourceEdit, parseSource } from './source-file';

/**
 * Remove nodeType functions that don't match any AST nodeType.
 * This cleans up orphaned functions left behind after renames.
 */
export function removeOrphanedNodeTypeFunctions(
  source: string,
  ast: TWorkflowAST,
  allWorkflows?: TWorkflowAST[]
): SourceEdit {
  const sourceFile = parseSource(source);

  // Get all valid functionNames from AST — include ALL workflows' node types when available
  const validFunctionNames = new Set(ast.nodeTypes.map((nt) => nt.functionName));
  if (allWorkflows) {
    for (const workflow of allWorkflows) {
      for (const nt of workflow.nodeTypes) {
        validFunctionNames.add(nt.functionName);
      }
    }
  }

  // Find all nodeType functions to potentially remove
  const functionsToRemove: { start: number; end: number }[] = [];

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      const functionName = node.name.text;

      // Check if this function has @flowWeaver nodeType JSDoc
      const functionStart = node.getFullStart();
      const leadingComments = ts.getLeadingCommentRanges(source, functionStart);

      if (!leadingComments) return;

      let isNodeTypeFunction = false;
      let jsdocStart = functionStart;

      for (const comment of leadingComments) {
        if (comment.kind === ts.SyntaxKind.MultiLineCommentTrivia) {
          const commentText = source.slice(comment.pos, comment.end);
          if (commentText.includes('@flowWeaver nodeType')) {
            isNodeTypeFunction = true;
            jsdocStart = comment.pos;
            break;
          }
        }
      }

      if (!isNodeTypeFunction) return;

      // If this nodeType function's name doesn't match any valid functionName, mark for removal
      if (!validFunctionNames.has(functionName)) {
        // Find the start (including JSDoc) and end of the function
        const fullStart = jsdocStart;
        const fullEnd = node.end;

        // Include any trailing newlines
        let endPos = fullEnd;
        while (endPos < source.length && (source[endPos] === '\n' || source[endPos] === '\r')) {
          endPos++;
        }

        functionsToRemove.push({ start: fullStart, end: endPos });
      }
    }
  });

  if (functionsToRemove.length === 0) {
    return { code: source, changed: false };
  }

  // Remove functions from end to start to preserve positions
  let result = source;
  for (const { start, end } of functionsToRemove.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, start) + result.slice(end);
  }

  return { code: result, changed: true };
}
