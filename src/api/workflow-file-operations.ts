/**
 * Workflow File Operations
 * Functions for adding, removing, and managing workflows in source files
 */

import * as ts from "typescript";

export interface WorkflowInfo {
  name: string;
  functionName: string;
  isExported: boolean;
}

export interface AddWorkflowOptions {
  exported?: boolean;
}

// Marker for runtime section
const RUNTIME_END_MARKER = "// @flow-weaver-runtime-end";

/**
 * Parse source and find all workflow functions
 */
function findWorkflowFunctions(source: string): Array<{
  node: ts.FunctionDeclaration;
  name: string;
  functionName: string;
  isExported: boolean;
  jsdocStart: number;
  jsdocEnd: number;
}> {
  const sourceFile = ts.createSourceFile(
    "temp.ts",
    source,
    ts.ScriptTarget.Latest,
    true
  );

  const workflows: Array<{
    node: ts.FunctionDeclaration;
    name: string;
    functionName: string;
    isExported: boolean;
    jsdocStart: number;
    jsdocEnd: number;
  }> = [];

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      const functionName = node.name.text;
      const functionStart = node.getFullStart();
      const leadingComments = ts.getLeadingCommentRanges(source, functionStart);

      if (!leadingComments) return;

      // Check for @flowWeaver workflow JSDoc
      for (const comment of leadingComments) {
        if (comment.kind === ts.SyntaxKind.MultiLineCommentTrivia) {
          const commentText = source.slice(comment.pos, comment.end);
          if (commentText.includes("@flowWeaver workflow")) {
            // Check for @name tag
            const nameMatch = commentText.match(/@name\s+(\S+)/);
            const name = nameMatch ? nameMatch[1] : functionName;

            const isExported = node.modifiers?.some(
              (m) => m.kind === ts.SyntaxKind.ExportKeyword
            ) ?? false;

            workflows.push({
              node,
              name,
              functionName,
              isExported,
              jsdocStart: comment.pos,
              jsdocEnd: comment.end,
            });
            break;
          }
        }
      }
    }
  });

  return workflows;
}

/**
 * Generate a new workflow function scaffold
 */
function generateWorkflowScaffold(
  workflowName: string,
  exported: boolean
): string {
  const exportKeyword = exported ? "export " : "";
  return `/**
 * @flowWeaver workflow
 */
${exportKeyword}function ${workflowName}(execute: boolean, data: {}): { onSuccess: boolean; onFailure: boolean } {
  throw new Error("Not implemented");
}`;
}

/**
 * Add a new workflow function to the source code
 */
export function addWorkflowToSource(
  source: string,
  workflowName: string,
  options: AddWorkflowOptions = {}
): string {
  const { exported = true } = options;

  // Check if workflow already exists
  const existingWorkflows = findWorkflowFunctions(source);
  const exists = existingWorkflows.some(
    (w) => w.name === workflowName || w.functionName === workflowName
  );

  if (exists) {
    throw new Error(`Workflow "${workflowName}" already exists`);
  }

  // Generate the new workflow
  const newWorkflow = generateWorkflowScaffold(workflowName, exported);

  // Find insertion point
  let insertPosition: number;

  // Try to insert after runtime section
  const runtimeEndPos = source.indexOf(RUNTIME_END_MARKER);
  if (runtimeEndPos !== -1) {
    const afterMarker = source.indexOf("\n", runtimeEndPos);
    insertPosition = afterMarker !== -1 ? afterMarker + 1 : runtimeEndPos + RUNTIME_END_MARKER.length;
  } else if (existingWorkflows.length > 0) {
    // Insert before the first existing workflow
    insertPosition = existingWorkflows[0].jsdocStart;
  } else {
    // Insert at the end
    insertPosition = source.length;
  }

  // Insert the new workflow
  const before = source.slice(0, insertPosition);
  const after = source.slice(insertPosition);

  // Add proper spacing
  const needsLeadingNewline = before.length > 0 && !before.endsWith("\n\n");
  const needsTrailingNewline = after.length > 0 && !after.startsWith("\n");

  return (
    before +
    (needsLeadingNewline ? "\n\n" : "") +
    newWorkflow +
    (needsTrailingNewline ? "\n\n" : "") +
    after
  );
}

/**
 * Remove a workflow function from the source code
 */
export function removeWorkflowFromSource(
  source: string,
  workflowName: string
): string {
  const workflows = findWorkflowFunctions(source);

  // Find the workflow to remove
  const workflowToRemove = workflows.find(
    (w) => w.name === workflowName || w.functionName === workflowName
  );

  if (!workflowToRemove) {
    throw new Error(`Workflow "${workflowName}" not found`);
  }

  // Check if it's the last workflow
  if (workflows.length === 1) {
    throw new Error(`Cannot remove the last workflow from file`);
  }

  // Calculate the range to remove (including JSDoc and trailing newlines)
  const startPos = workflowToRemove.jsdocStart;
  let endPos = workflowToRemove.node.end;

  // Include trailing newlines
  while (endPos < source.length && (source[endPos] === '\n' || source[endPos] === '\r')) {
    endPos++;
  }

  // Remove the workflow
  const before = source.slice(0, startPos);
  const after = source.slice(endPos);

  return before + after;
}

/**
 * Toggle the export status of a workflow
 */
export function toggleWorkflowExport(
  source: string,
  workflowName: string
): string {
  const workflows = findWorkflowFunctions(source);

  // Find the workflow to toggle
  const workflow = workflows.find(
    (w) => w.name === workflowName || w.functionName === workflowName
  );

  if (!workflow) {
    throw new Error(`Workflow "${workflowName}" not found`);
  }

  // Find the function keyword position
  let functionKeywordPos = -1;

  // Find the 'function' keyword
  for (let i = workflow.jsdocEnd; i < source.length - 7; i++) {
    if (source.slice(i, i + 8) === "function") {
      functionKeywordPos = i;
      break;
    }
    if (source.slice(i, i + 15) === "export function") {
      functionKeywordPos = i;
      break;
    }
  }

  if (functionKeywordPos === -1) {
    throw new Error(`Could not find function declaration for "${workflowName}"`);
  }

  if (workflow.isExported) {
    // Remove 'export ' keyword
    const exportPos = source.lastIndexOf("export", functionKeywordPos);
    if (exportPos !== -1 && exportPos >= workflow.jsdocEnd) {
      // Find the space after export
      let spaceEnd = exportPos + 6;
      while (spaceEnd < source.length && (source[spaceEnd] === ' ' || source[spaceEnd] === '\t')) {
        spaceEnd++;
      }
      return source.slice(0, exportPos) + source.slice(spaceEnd);
    }
  } else {
    // Add 'export ' keyword before 'function'
    return source.slice(0, functionKeywordPos) + "export " + source.slice(functionKeywordPos);
  }

  return source;
}

/**
 * Get all available workflows from source code
 */
export function getAvailableWorkflows(source: string): WorkflowInfo[] {
  const workflows = findWorkflowFunctions(source);

  return workflows.map((w) => ({
    name: w.name,
    functionName: w.functionName,
    isExported: w.isExported,
  }));
}
