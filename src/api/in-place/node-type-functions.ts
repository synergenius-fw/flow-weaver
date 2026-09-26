/**
 * Node type functions authored in the workflow file.
 *
 * Decides which node types this file owns (declared here, not imported, not a
 * sibling workflow, not a built-in) and brings each one's function in line
 * with its AST: the JSDoc is regenerated, a renamed node type is found by its
 * `@name` tag and renamed, stale duplicate `@flowWeaver` comments are
 * dropped, a changed function text replaces the old one, and a node type
 * with no function in the file yet has one inserted.
 */

import * as ts from 'typescript';
import * as path from 'path';
import type { TNodeTypeAST, TWorkflowAST } from '../../ast/types';
import { MARKERS } from '../../parser/generated-sections';
import { generateNodeTypeJSDoc } from './node-type-jsdoc';
import { type SourceEdit, findFunctionDeclaration, parseSource } from './source-file';

/**
 * Rewrite the JSDoc (and, when the AST carries new text, the function) of
 * every node type the workflow file owns.
 */
export function syncNodeTypeFunctions(source: string, ast: TWorkflowAST): SourceEdit {
  let code = source;
  let changed = false;
  for (const nodeType of ast.nodeTypes) {
    if (!isOwnedByFile(nodeType, ast.sourceFile)) {
      continue;
    }
    const nodeTypeResult = replaceNodeTypeJSDoc(code, nodeType);
    if (nodeTypeResult.changed) {
      code = nodeTypeResult.code;
      changed = true;
    }
  }
  return { code, changed };
}

/** Whether `nodeType`'s function belongs to the workflow file at `workflowFile`. */
function isOwnedByFile(nodeType: TNodeTypeAST, workflowFile: string): boolean {
  // Skip sibling workflows (variant IMPORTED_WORKFLOW/WORKFLOW). Their JSDoc should not be rewritten.
  if (nodeType.variant === 'IMPORTED_WORKFLOW' || nodeType.variant === 'WORKFLOW' || nodeType.variant === 'MAP_ITERATOR') {
    return false;
  }
  // Skip node types imported from other files. The import statement handles them.
  // Inlining would create duplicate declarations (TS2440) and duplicate node type names.
  // Compare basenames as a fallback: after a client roundtrip (JSON serialization),
  // sourceLocation.file may contain a virtual path ("/testing.ts") instead of the
  // real workspace path. Full-path comparison would incorrectly skip the node type.
  // Normalize separators for cross-platform (Windows backslash → forward slash).
  if (nodeType.sourceLocation?.file) {
    const ntFile = nodeType.sourceLocation.file.replace(/\\/g, '/');
    const astFile = workflowFile.replace(/\\/g, '/');
    const ntBase = ntFile.split('/').filter(Boolean).pop() ?? '';
    const astBase = astFile.split('/').filter(Boolean).pop() ?? '';
    if (
      path.resolve(ntFile) !== path.resolve(astFile) &&
      ntBase !== astBase
    ) {
      return false;
    }
  }
  // Skip built-in auto-injected nodes. They are inlined separately.
  if (!nodeType.sourceLocation && nodeType.helperText != null) {
    return false;
  }
  return true;
}

/** The function text a node type carries: `code` (added dynamically in some contexts) or `functionText`. */
function nodeTypeFunctionText(nodeType: TNodeTypeAST): string | undefined {
  const nodeTypeWithCode = nodeType as TNodeTypeAST & { code?: string };
  return nodeTypeWithCode.code || nodeType.functionText;
}

/**
 * Rename a function in the provided code to a new name.
 * Handles both regular functions and arrow functions.
 */
function renameFunctionInCode(code: string, newName: string): string {
  const codeSourceFile = parseSource(code);

  let functionName: string | undefined;
  let functionNameStart: number | undefined;
  let functionNameEnd: number | undefined;

  // Find the function declaration
  ts.forEachChild(codeSourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      functionName = node.name.text;
      functionNameStart = node.name.getStart();
      functionNameEnd = node.name.getEnd();
    }
  });

  if (!functionName || functionNameStart === undefined || functionNameEnd === undefined) {
    // No function found - return as-is
    return code;
  }

  if (functionName === newName) {
    // Already has the correct name
    return code;
  }

  // Replace the function name
  const before = code.slice(0, functionNameStart);
  const after = code.slice(functionNameEnd);
  return before + newName + after;
}

/**
 * Insert a new node type function into the source code.
 * Inserts before the workflow function (exported function).
 * Renames the function to match nodeType.functionName if different.
 */
function insertNodeTypeFunction(
  source: string,
  nodeType: TNodeTypeAST,
  functionCode: string
): SourceEdit {
  const sourceFile = parseSource(source);

  // Find position AFTER the runtime section end marker to avoid being overwritten
  // when the runtime section is replaced
  const runtimeEndMarker = MARKERS.RUNTIME_END;
  const runtimeEndPos = source.indexOf(runtimeEndMarker);

  let insertPosition = -1;

  if (runtimeEndPos !== -1) {
    // Insert after the runtime-end marker line
    const afterMarker = source.indexOf('\n', runtimeEndPos);
    insertPosition = afterMarker !== -1 ? afterMarker + 1 : runtimeEndPos + runtimeEndMarker.length;
  } else {
    // No runtime marker - find the first exported function to insert before it
    let foundExportedFunction = false;

    ts.forEachChild(sourceFile, (node) => {
      if (
        !foundExportedFunction &&
        ts.isFunctionDeclaration(node) &&
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        insertPosition = node.getFullStart();
        foundExportedFunction = true;
      }
    });

    if (insertPosition === -1) {
      insertPosition = source.length;
    }
  }

  // Rename the function in the code to match nodeType.functionName
  const renamedCode = renameFunctionInCode(functionCode, nodeType.functionName);

  // The functionCode should already have JSDoc, but ensure it does
  const hasJSDoc = renamedCode.trim().startsWith('/**');
  let finalCode = renamedCode;

  if (!hasJSDoc) {
    // Generate JSDoc for the function
    const jsdoc = generateNodeTypeJSDoc(nodeType);
    finalCode = jsdoc + '\n' + renamedCode;
  }

  // Insert the function with proper spacing
  const before = source.slice(0, insertPosition);
  const after = source.slice(insertPosition);

  // Ensure proper newlines
  const needsLeadingNewline = before.length > 0 && !before.endsWith('\n\n');
  const needsTrailingNewline = after.length > 0 && !after.startsWith('\n');

  const newCode =
    before +
    (needsLeadingNewline ? '\n\n' : '') +
    finalCode +
    (needsTrailingNewline ? '\n\n' : '') +
    after;

  return { code: newCode, changed: true };
}

/**
 * Find a function by @name tag in its JSDoc comment.
 * Returns the function node and the @name value if found.
 */
function findFunctionByNameTag(
  source: string,
  sourceFile: ts.SourceFile,
  targetName: string
): ts.FunctionDeclaration | undefined {
  let result: ts.FunctionDeclaration | undefined;

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      // Check if this function has a @name tag matching targetName
      const functionStart = node.getFullStart();
      const leadingComments = ts.getLeadingCommentRanges(source, functionStart);

      if (leadingComments) {
        for (const comment of leadingComments) {
          if (comment.kind === ts.SyntaxKind.MultiLineCommentTrivia) {
            const commentText = source.slice(comment.pos, comment.end);
            // Look for @name tag
            const nameMatch = commentText.match(/@name\s+(\S+)/);
            if (nameMatch && nameMatch[1] === targetName) {
              result = node;
              return;
            }
          }
        }
      }
    }
  });

  return result;
}

/**
 * Replace a node type function's JSDoc comment with updated annotations.
 * If the function doesn't exist but nodeType has code/functionText, INSERT the function.
 * Handles function renames by looking up @name tag when functionName doesn't match.
 */
function replaceNodeTypeJSDoc(source: string, nodeType: TNodeTypeAST): SourceEdit {
  const sourceFile = parseSource(source);

  let needsRename = false;

  // First, try to find the function by its functionName
  let functionNode = findFunctionDeclaration(sourceFile, nodeType.functionName);

  // If not found by functionName, try to find by @name tag (handles renames)
  if (!functionNode && nodeType.name) {
    functionNode = findFunctionByNameTag(source, sourceFile, nodeType.name);
    if (functionNode && functionNode.name?.text !== nodeType.functionName) {
      needsRename = true;
    }
  }

  // If still not found and name !== functionName, try finding by name as function name
  // This handles the case where no @name tag exists yet (first rename after creation)
  if (!functionNode && nodeType.name && nodeType.name !== nodeType.functionName) {
    // Find by stable identifier as function name
    functionNode = findFunctionDeclaration(sourceFile, nodeType.name);
    if (functionNode) {
      needsRename = true;
    }
  }

  if (!functionNode) {
    // Function doesn't exist - try to INSERT it if we have the code
    const functionCode = nodeTypeFunctionText(nodeType);
    if (functionCode) {
      return insertNodeTypeFunction(source, nodeType, functionCode);
    }
    return { code: source, changed: false };
  }

  let result = source;
  let hasChanges = false;

  // If function needs to be renamed (found by @name but has old functionName)
  if (needsRename && functionNode.name) {
    const nameStart = functionNode.name.getStart();
    const nameEnd = functionNode.name.getEnd();

    result = result.slice(0, nameStart) + nodeType.functionName + result.slice(nameEnd);
    hasChanges = true;

    // Re-parse to get updated positions after rename
    const renamedNode = findFunctionDeclaration(parseSource(result), nodeType.functionName);
    if (renamedNode) {
      functionNode = renamedNode;
    }
  }

  // Find the JSDoc comment before the function
  const functionStart = functionNode.getFullStart();
  const leadingComments = ts.getLeadingCommentRanges(result, functionStart);

  if (!leadingComments || leadingComments.length === 0) {
    return { code: result, changed: hasChanges };
  }

  // Find ALL /** JSDoc comments in the leading trivia and separate them:
  // - flowWeaverJSDocs: contain @flowWeaver (these are node type annotations)
  // - The LAST one is the primary JSDoc to replace
  // - Any earlier @flowWeaver JSDoc blocks are stale duplicates to remove
  const jsdocComments: ts.CommentRange[] = [];
  for (const c of leadingComments) {
    if (
      c.kind === ts.SyntaxKind.MultiLineCommentTrivia &&
      result.slice(c.pos, c.pos + 3) === '/**'
    ) {
      jsdocComments.push(c);
    }
  }

  if (jsdocComments.length === 0) {
    return { code: result, changed: hasChanges };
  }

  // Use the LAST /** comment as the primary JSDoc (closest to the function).
  // This avoids picking up file headers that also start with /**.
  const jsdocComment = jsdocComments[jsdocComments.length - 1];

  // Detect stale duplicate @flowWeaver JSDoc blocks from previous buggy compilations.
  // Any earlier /** that contains @flowWeaver is a stale duplicate to remove.
  const staleDuplicates: ts.CommentRange[] = [];
  for (let i = 0; i < jsdocComments.length - 1; i++) {
    const text = result.slice(jsdocComments[i].pos, jsdocComments[i].end);
    if (text.includes('@flowWeaver')) {
      staleDuplicates.push(jsdocComments[i]);
    }
  }

  // Generate new JSDoc using AnnotationGenerator
  const newJSDoc = generateNodeTypeJSDoc(nodeType);

  // Remove stale duplicates first (process from end to start to preserve positions)
  if (staleDuplicates.length > 0) {
    for (let i = staleDuplicates.length - 1; i >= 0; i--) {
      const dupe = staleDuplicates[i];
      // Remove the duplicate and any trailing whitespace/newline
      let removeEnd = dupe.end;
      while (
        removeEnd < result.length &&
        (result[removeEnd] === '\n' || result[removeEnd] === '\r')
      ) {
        removeEnd++;
      }
      result = result.slice(0, dupe.pos) + result.slice(removeEnd);
      hasChanges = true;
    }

    // Re-parse to get updated positions after removal
    const updatedFunctionNode = findFunctionDeclaration(parseSource(result), nodeType.functionName);

    if (!updatedFunctionNode) {
      return { code: result, changed: hasChanges };
    }

    // Re-find the JSDoc comment with updated positions
    const updatedStart = updatedFunctionNode.getFullStart();
    const updatedComments = ts.getLeadingCommentRanges(result, updatedStart);
    if (!updatedComments) {
      return { code: result, changed: hasChanges };
    }

    let updatedJsdoc: ts.CommentRange | undefined;
    for (const c of updatedComments) {
      if (
        c.kind === ts.SyntaxKind.MultiLineCommentTrivia &&
        result.slice(c.pos, c.pos + 3) === '/**'
      ) {
        updatedJsdoc = c;
      }
    }

    if (!updatedJsdoc) {
      return { code: result, changed: hasChanges };
    }

    // Continue with the updated positions
    return replaceJSDocContent(
      result,
      updatedJsdoc,
      updatedFunctionNode,
      nodeType,
      newJSDoc,
      hasChanges
    );
  }

  return replaceJSDocContent(result, jsdocComment, functionNode, nodeType, newJSDoc, hasChanges);
}

/**
 * Replace a found node type's JSDoc, and its whole function when the node
 * type carries function text that differs from the file beyond whitespace.
 */
function replaceJSDocContent(
  source: string,
  jsdocComment: ts.CommentRange,
  functionNode: ts.FunctionDeclaration,
  nodeType: TNodeTypeAST,
  newJSDoc: string,
  hasChanges: boolean
): SourceEdit {
  const originalJSDoc = source.slice(jsdocComment.pos, jsdocComment.end);

  // Check if JSDoc changed
  const jsdocChanged = originalJSDoc.trim() !== newJSDoc.trim();

  // Check if function body needs updating (when functionText is provided)
  const newFunctionText = nodeTypeFunctionText(nodeType);
  let functionBodyChanged = false;
  let newFunctionDeclaration = '';

  if (newFunctionText) {
    // Extract function declaration from functionText (strip ALL leading JSDoc blocks).
    // The parser's functionText may include multiple JSDoc blocks (e.g. file header + nodeType JSDoc).
    // We must strip ALL of them, not just the first one.
    let strippedFunctionText = newFunctionText.trim();
    while (strippedFunctionText.startsWith('/**')) {
      strippedFunctionText = strippedFunctionText.replace(/^\/\*\*[\s\S]*?\*\/\s*/, '').trim();
    }
    newFunctionDeclaration = strippedFunctionText;

    // Get current function declaration (without JSDoc)
    const currentFunctionDeclaration = source
      .slice(functionNode.getStart(), functionNode.getEnd())
      .trim();

    // Normalize for comparison (strip whitespace differences)
    const normalizedNew = newFunctionDeclaration.replace(/\s+/g, ' ');
    const normalizedCurrent = currentFunctionDeclaration.replace(/\s+/g, ' ');

    functionBodyChanged = normalizedNew !== normalizedCurrent;
  }

  // If nothing changed, return early
  if (!jsdocChanged && !functionBodyChanged) {
    return { code: source, changed: hasChanges };
  }

  // Replace the JSDoc and optionally the function body
  if (functionBodyChanged && newFunctionDeclaration) {
    // Replace entire function (JSDoc + body)
    const before = source.slice(0, jsdocComment.pos);
    const after = source.slice(functionNode.getEnd());

    return {
      code: before + newJSDoc + '\n' + newFunctionDeclaration + after,
      changed: true,
    };
  } else if (jsdocChanged) {
    // Only replace JSDoc
    const before = source.slice(0, jsdocComment.pos);
    const after = source.slice(jsdocComment.end);

    return {
      code: before + newJSDoc + after,
      changed: true,
    };
  }

  return { code: source, changed: hasChanges };
}
