/**
 * Inlined built-in node types.
 *
 * Built-in node types (sleep, waitForEvent, and the like) are injected by the
 * parser and have no source in the workflow file. This module decides which
 * of them a compiled file needs (those the workflow's instances use), and
 * writes their shared helpers and annotated functions just above the
 * workflow's JSDoc, so the compiled file is self-contained and a re-parse
 * still recognizes them, durable classification included.
 */

import type { TWorkflowAST } from '../../ast/types';
import { durableClassificationLines } from './node-type-jsdoc';
import type { SourceEdit } from './source-file';

/**
 * Insert the built-in node functions `ast` uses, in their production or
 * development form, before the workflow function's JSDoc.
 */
export function inlineBuiltInNodes(
  source: string,
  ast: TWorkflowAST,
  production: boolean
): SourceEdit {
  const usedNodeTypes = new Set(ast.instances.map((i) => i.nodeType));
  const builtInNodes = ast.nodeTypes.filter(
    (nt) => !nt.sourceLocation && nt.functionText && nt.helperText != null && usedNodeTypes.has(nt.name)
  );
  if (builtInNodes.length === 0) {
    return { code: source, changed: false };
  }

  // Find insertion point: just before the workflow function's JSDoc. The
  // comment match must not cross a `*/`, or it would start at the first
  // doc comment in the file (there are many in the runtime section) and
  // the built-ins would land inside a section that is regenerated.
  const workflowFnPattern = new RegExp(
    `(/\\*\\*(?:(?!\\*/)[\\s\\S])*?@flowWeaver\\s+workflow(?:(?!\\*/)[\\s\\S])*?\\*/)\\s*\\n\\s*(?:export\\s+)?(?:async\\s+)?function\\s+${ast.functionName}\\b`
  );
  const match = source.match(workflowFnPattern);
  if (!match || match.index === undefined) {
    return { code: source, changed: false };
  }

  const insertionLines: string[] = [];

  // Emit shared helpers once: not twice for two built-ins of this
  // workflow, and not again when an earlier pass over another workflow
  // in the same file already put them there (a file with a `sleep` in
  // one workflow and a `waitForEvent` in another is compiled workflow
  // by workflow, and both need `__fw_getMockConfig`).
  const emittedHelpers = new Set<string>();
  for (const node of builtInNodes) {
    const helperText = production ? (node.helperTextProduction ?? null) : (node.helperText ?? null);
    if (helperText && !emittedHelpers.has(helperText) && !source.includes(helperText)) {
      emittedHelpers.add(helperText);
      insertionLines.push(helperText);
      insertionLines.push('');
    }
  }

  // Emit each built-in function with its JSDoc
  for (const node of builtInNodes) {
    const funcText = (production && node.functionTextProduction != null) ? node.functionTextProduction : node.functionText;
    if (funcText) {
      // Add JSDoc annotation so the function is recognized on re-parse.
      // The durable classification must travel with it: without it a
      // re-parse sees waitForAgent/waitForEvent as ordinary node types,
      // the gate boundary is not applied, and the inlined fallback body
      // throws at run time.
      const portAnnotations: string[] = [];
      portAnnotations.push('/**');
      portAnnotations.push(` * @flowWeaver nodeType`);
      portAnnotations.push(...durableClassificationLines(node));
      for (const [name, port] of Object.entries(node.inputs)) {
        if (name === 'execute') continue;
        const optPrefix = port.optional ? '[' : '';
        const optSuffix = port.optional ? ']' : '';
        portAnnotations.push(` * @input ${optPrefix}${name}${optSuffix} - ${port.label || name}`);
      }
      for (const [name, port] of Object.entries(node.outputs)) {
        if (name === 'onSuccess' || name === 'onFailure') continue;
        portAnnotations.push(` * @output ${name} - ${port.label || name}`);
      }
      portAnnotations.push(' */');
      insertionLines.push(portAnnotations.join('\n'));
      insertionLines.push(funcText);
      insertionLines.push('');
    }
  }

  const insertionCode = insertionLines.join('\n');
  return {
    code: source.slice(0, match.index) + insertionCode + '\n' + source.slice(match.index),
    changed: true,
  };
}
