/**
 * Executable imports for `@fwImport` node types.
 *
 * A node type declared with `@fwImport` lives in a package, and the generated
 * body calls it by bare name. This module decides the local name such a node
 * type is called by, and the import statements, between the IMPORTS markers
 * at the top of the file, that bring those names into scope.
 */

import type { TNodeTypeAST, TWorkflowAST } from '../../ast/types';
import { MARKERS } from '../../parser/generated-sections';
import type { SourceEdit } from './source-file';

/**
 * The function name an imported node type is called by. An explicitly set
 * functionName wins; otherwise an `npm/<pkg>/<fn>` name yields `<fn>`.
 */
export function fwImportFunctionName(nodeType: Pick<TNodeTypeAST, 'name' | 'functionName'>): string {
  if (nodeType.functionName === nodeType.name && nodeType.name.startsWith('npm/')) {
    const parts = nodeType.name.split('/');
    return parts[parts.length - 1];
  }
  return nodeType.functionName;
}

/**
 * Emit executable `import { <fn> } from "<pkg>"` statements for every
 * `@fwImport` node type (those carrying `importSource`), so the generated
 * body's bare call (`await waitForApproval(...)`) resolves at run time.
 *
 * The block is delimited by IMPORTS markers and inserted at the very top of
 * the file (before any other content), so it's idempotent across re-runs
 * and survives alongside the user's own imports. When the workflow uses no
 * `@fwImport` node types the block is empty (markers only) — harmless.
 *
 * The function name is derived the same way as the persisted `@fwImport`
 * JSDoc (npm/<pkg>/<fn> convention or explicit functionName).
 */
export function ensureFwImportStatements(source: string, ast: TWorkflowAST): SourceEdit {
  const importNodeTypes = ast.nodeTypes.filter((nt) => nt.importSource);

  // Build one import per (functionName, importSource), de-duped.
  const seen = new Set<string>();
  const importLines: string[] = [];
  for (const nt of importNodeTypes) {
    const fnName = fwImportFunctionName(nt);
    // Collision-proof dedup key: JSON.stringify a tuple so no separator char
    // can appear inside the operands (fnName is space-free today, but this
    // removes the assumption entirely). The key is internal-only, never emitted.
    const key = JSON.stringify([fnName, nt.importSource]);
    if (seen.has(key)) continue;
    seen.add(key);
    importLines.push(`import { ${fnName} } from '${nt.importSource}';`);
  }

  const block = [MARKERS.IMPORTS_START, ...importLines, MARKERS.IMPORTS_END].join('\n');

  // Replace an existing marker block if present (idempotent re-runs).
  const startIdx = source.indexOf(MARKERS.IMPORTS_START);
  const endIdx = source.indexOf(MARKERS.IMPORTS_END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = source.slice(0, startIdx);
    const after = source.slice(endIdx + MARKERS.IMPORTS_END.length);
    const next = `${before}${block}${after}`;
    return { code: next, changed: next !== source };
  }

  // No existing block. If there are no imports to emit, do nothing (avoid
  // littering files that don't use @fwImport with an empty marker block).
  if (importLines.length === 0) {
    return { code: source, changed: false };
  }

  // Insert at the very top so the imports precede every statement.
  const next = `${block}\n${source}`;
  return { code: next, changed: true };
}
