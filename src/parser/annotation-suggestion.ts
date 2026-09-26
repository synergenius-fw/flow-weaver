/**
 * The editor-facing annotation suggestion: given a file and a cursor line,
 * the JSDoc text to insert for the function at or below the cursor.
 *
 * Decides which function the cursor targets, whether to suggest at all (never
 * over a plain JSDoc the user wrote), the ports the signature implies that the
 * existing annotation lacks, `@connect` lines between same-named ports of a
 * workflow's nodes, and where the text goes (a full block above the function,
 * the continuation of a just-typed JSDoc opener, or lines appended to the end
 * of an existing block).
 */
import type { Project, SourceFile } from 'ts-morph';
import { type FunctionLike, extractFunctionLikes } from './function-like';
import type { TNodeTypeAST } from '../ast/types';
import { isControlFlowPort } from '../constants';
import { generateJSDocPortTag } from '../generator/annotation-generator';
import { inferNodeTypeFromFunction, hasFlowWeaverAnnotation } from './node-inference';

/**
 * Suggest the `@flowWeaver` JSDoc for the function at or below `cursorLine`
 * (0-based) in `content`, parsed as `virtualPath` in `project`. Returns null
 * when there is nothing to suggest.
 */
export function generateAnnotationSuggestion(
  project: Project,
  content: string,
  cursorLine: number,
  virtualPath: string = 'virtual.ts'
): { text: string; insertLine: number; replaceLinesCount: number } | null {
  // Create virtual SourceFile
  const existingFile = project.getSourceFile(virtualPath);
  if (existingFile) {
    project.removeSourceFile(existingFile);
  }
  // A "/**" the user has just typed is an unterminated comment that swallows
  // every function below it, so the one it is meant for could never be
  // found. Parse with that line blanked; the continuation branch below still
  // reads the original line. A "/**" that opens a finished block (comment
  // lines down to its "*/") is left alone.
  const contentLines = content.split(/\r?\n/);
  let typedJsDocStart = /^\s*\/\*\*\s*$/.test(contentLines[cursorLine] ?? '');
  for (let i = cursorLine + 1; typedJsDocStart && i < contentLines.length; i++) {
    const line = contentLines[i].trim();
    if (!line.startsWith('*')) break;
    if (line.includes('*/')) typedJsDocStart = false;
  }
  const parseContent = typedJsDocStart
    ? contentLines.map((line, i) => (i === cursorLine ? '' : line)).join('\n')
    : content;
  const sourceFile = project.createSourceFile(virtualPath, parseContent, { overwrite: true });

  try {
    const allFunctions = extractFunctionLikes(sourceFile);
    if (allFunctions.length === 0) return null;

    // Find the function nearest to cursorLine (below or containing the cursor)
    // cursorLine is 0-based; getStartLineNumber() is 1-based
    let targetFn: FunctionLike | null = null;
    let bestDistance = Infinity;

    for (const fn of allFunctions) {
      const fnLine = fn.getStartLineNumber(false) - 1; // 0-based
      // Prefer functions at or below the cursor
      const distance = fnLine >= cursorLine ? fnLine - cursorLine : (cursorLine - fnLine) + 1000;
      if (distance < bestDistance) {
        bestDistance = distance;
        targetFn = fn;
      }
    }

    if (!targetFn) return null;

    const fnName = targetFn.getName() || 'anonymous';
    const fnStartLine = targetFn.getStartLineNumber(false) - 1; // 0-based

    // Don't suggest if cursor is too far from the function (more than 30 lines above)
    if (cursorLine < fnStartLine - 30) return null;

    // Check existing JSDoc state
    const hasAnnotation = hasFlowWeaverAnnotation(targetFn);
    const hasAnyJsDoc = targetFn.getJsDocs().length > 0;

    // If function has a JSDoc but NOT a @flowWeaver annotation, don't suggest
    // a competing JSDoc block — the user has an intentional regular JSDoc
    if (hasAnyJsDoc && !hasAnnotation) return null;

    // Infer full node type from function signature
    const inferred = inferNodeTypeFromFunction(targetFn, fnName, virtualPath);

    // Extract @param descriptions from existing JSDoc (if any)
    const paramDescriptions = new Map<string, string>();
    for (const doc of targetFn.getJsDocs()) {
      for (const tag of doc.getTags()) {
        if (tag.getTagName() === 'param') {
          const comment = tag.getCommentText?.()?.trim() || '';
          // Extract param name and description: "{type} name - desc" or "name - desc" or "name desc"
          const paramMatch = comment.match(/^(?:\{[^}]*\}\s+)?(\w+)(?:\s*-\s*|\s+)(.+)/);
          if (paramMatch) {
            paramDescriptions.set(paramMatch[1], paramMatch[2]);
          }
        }
      }
    }

    // Merge @param descriptions into inferred port labels
    for (const [portName, portDef] of Object.entries(inferred.inputs)) {
      const desc = paramDescriptions.get(portName);
      if (desc) {
        portDef.label = desc;
      }
    }

    // Parse existing JSDoc to find what's already annotated
    const existingPorts = extractExistingAnnotatedPorts(targetFn);

    // Build missing port lines
    const missingLines: string[] = [];

    // Filter out mandatory ports (execute, onSuccess, onFailure) from suggestions
    for (const [portName, portDef] of Object.entries(inferred.inputs)) {
      if (isControlFlowPort(portName)) continue;
      if (existingPorts.inputs.has(portName)) continue;
      missingLines.push(` * ${generateJSDocPortTag(portName, portDef, 'input')}`);
    }

    for (const [portName, portDef] of Object.entries(inferred.outputs)) {
      if (isControlFlowPort(portName)) continue;
      if (existingPorts.outputs.has(portName)) continue;
      missingLines.push(` * ${generateJSDocPortTag(portName, portDef, 'output')}`);
    }

    if (hasAnnotation) {
      // Check if this is a workflow block — if so, suggest missing connections
      const isWorkflow = isWorkflowBlock(targetFn);
      if (isWorkflow) {
        const connectionLines = generateWorkflowStructureSuggestion(targetFn, sourceFile);
        missingLines.push(...connectionLines);
      }

      // Partial JSDoc: suggest only missing ports / connections
      if (missingLines.length === 0) return null;

      // Find the insertion point: just before the closing */
      const lines = content.split(/\r?\n/);
      let jsDocEndLine = -1;
      for (let i = fnStartLine - 1; i >= 0; i--) {
        if (lines[i].includes('*/')) {
          jsDocEndLine = i;
          break;
        }
      }

      if (jsDocEndLine < 0) return null;

      const text = missingLines.join('\n') + '\n';
      return {
        text,
        insertLine: jsDocEndLine,
        replaceLinesCount: 0,
      };
    }

    // No @flowWeaver JSDoc — check if user just typed "/**" on the cursor line
    const lines = content.split(/\r?\n/);
    const cursorLineText = lines[cursorLine] || '';
    if (/^\s*\/\*\*\s*$/.test(cursorLineText)) {
      // User typed "/**" — generate only the continuation lines after it
      const continuationLines = [
        ` * @flowWeaver nodeType ${fnName}`,
        ...(inferred.expression ? [' * @expression'] : []),
        ...missingLines,
        ' */',
      ];
      const text = continuationLines.join('\n') + '\n';
      return {
        text,
        insertLine: cursorLine + 1,
        replaceLinesCount: 0,
      };
    }

    // Generate full annotation block
    const allLines = [
      '/**',
      ` * @flowWeaver nodeType ${fnName}`,
      ...(inferred.expression ? [' * @expression'] : []),
      ...missingLines,
      ' */',
    ];
    const text = allLines.join('\n') + '\n';

    // Insert on the line above the function
    return {
      text,
      insertLine: fnStartLine,
      replaceLinesCount: 0,
    };
  } finally {
    // Clean up virtual source file
    const sf = project.getSourceFile(virtualPath);
    if (sf) project.removeSourceFile(sf);
  }
}

/**
 * Check if a function's JSDoc marks it as a workflow (vs nodeType).
 */
function isWorkflowBlock(fn: FunctionLike): boolean {
  for (const doc of fn.getJsDocs()) {
    for (const tag of doc.getTags()) {
      if (tag.getTagName() !== 'flowWeaver') continue;
      const comment = tag.getCommentText?.()?.trim() || '';
      const firstWord = comment.split(/\s/)[0];
      // Anything that is not a node type is a workflow candidate: 'workflow'
      // explicitly, bare @flowWeaver (no qualifier), or a named workflow.
      if (firstWord !== 'nodeType') {
        return true;
      }
    }
  }
  return false;
}

/**
 * Generate missing @connect suggestions for a workflow block.
 * Finds @node declarations, resolves their types, and suggests connections
 * for matching port names that aren't already wired.
 */
function generateWorkflowStructureSuggestion(fn: FunctionLike, sourceFile: SourceFile): string[] {
  // Extract @node declarations: { nodeId -> nodeTypeName }
  const nodeDecls = new Map<string, string>();
  // Extract existing @connect lines: set of "sourceNode.sourcePort->targetNode.targetPort"
  const existingConnections = new Set<string>();

  for (const doc of fn.getJsDocs()) {
    for (const tag of doc.getTags()) {
      const tagName = tag.getTagName();
      const comment = tag.getCommentText?.()?.trim() || '';

      if (tagName === 'node') {
        const nodeMatch = comment.match(/^(\w+)\s+(\w+)/);
        if (nodeMatch) {
          nodeDecls.set(nodeMatch[1], nodeMatch[2]);
        }
      } else if (tagName === 'connect') {
        const connMatch = comment.match(/^(\w+)\.(\w+)\s*->\s*(\w+)\.(\w+)/);
        if (connMatch) {
          existingConnections.add(`${connMatch[1]}.${connMatch[2]}->${connMatch[3]}.${connMatch[4]}`);
        }
      }
    }
  }

  if (nodeDecls.size < 2) return [];

  // Resolve node types from the same file
  const allFunctions = extractFunctionLikes(sourceFile);
  const resolvedTypes = new Map<string, TNodeTypeAST>();

  for (const [nodeId, typeName] of nodeDecls) {
    const matchedFn = allFunctions.find((f) => f.getName() === typeName);
    if (matchedFn) {
      resolvedTypes.set(nodeId, inferNodeTypeFromFunction(matchedFn, typeName, sourceFile.getFilePath()));
    }
  }

  // Find matching unconnected port pairs
  const suggestions: string[] = [];
  const nodeIds = [...nodeDecls.keys()];

  for (let i = 0; i < nodeIds.length; i++) {
    for (let j = 0; j < nodeIds.length; j++) {
      if (i === j) continue;
      const srcId = nodeIds[i];
      const tgtId = nodeIds[j];
      const srcType = resolvedTypes.get(srcId);
      const tgtType = resolvedTypes.get(tgtId);
      if (!srcType || !tgtType) continue;

      for (const [outputName, outputDef] of Object.entries(srcType.outputs)) {
        if (isControlFlowPort(outputName)) continue;
        if (outputDef.dataType === 'STEP') continue;

        // Check if target has a matching input with the same name
        if (outputName in tgtType.inputs && !isControlFlowPort(outputName)) {
          const connKey = `${srcId}.${outputName}->${tgtId}.${outputName}`;
          if (!existingConnections.has(connKey)) {
            suggestions.push(` * @connect ${srcId}.${outputName} -> ${tgtId}.${outputName}`);
            existingConnections.add(connKey); // prevent duplicates
          }
        }
      }
    }
  }

  return suggestions;
}

/**
 * Extract port names that are already annotated in a function's JSDoc.
 * Returns sets of input and output port names found in existing annotations.
 */
function extractExistingAnnotatedPorts(fn: FunctionLike): {
  inputs: Set<string>;
  outputs: Set<string>;
} {
  const inputs = new Set<string>();
  const outputs = new Set<string>();

  for (const doc of fn.getJsDocs()) {
    for (const tag of doc.getTags()) {
      const tagName = tag.getTagName();
      const comment = tag.getCommentText?.()?.trim() || '';
      // Extract port name: first word, possibly wrapped in brackets [name] or [name=default]
      const nameMatch = comment.match(/^\[?(\w+)/);
      if (!nameMatch) continue;
      const portName = nameMatch[1];

      if (tagName === 'input' || tagName === 'step') {
        inputs.add(portName);
      } else if (tagName === 'output') {
        outputs.add(portName);
      }
    }
  }

  return { inputs, outputs };
}
