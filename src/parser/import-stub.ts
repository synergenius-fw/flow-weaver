/**
 * The generic node type an `@fwImport` degrades to when its source cannot be
 * read, and how to recognize one later.
 *
 * Decides the stub's shape (no inputs, a single `{ result }` output, marked as
 * an expression) and the structural test that lets a real node type with the
 * same name, supplied by the caller or found elsewhere, take its place.
 */
import type { TNodeTypeAST } from '../ast/types';

/**
 * Create a stub node type for @fwImport when proper inference fails.
 * This provides graceful degradation rather than failing completely.
 */
export function createImportStub(imp: {
  name: string;
  functionName: string;
  importSource: string;
}): TNodeTypeAST {
  return {
    type: 'NodeType',
    name: imp.name,
    functionName: imp.functionName,
    importSource: imp.importSource,
    variant: 'FUNCTION',
    inputs: {},
    outputs: { result: { dataType: 'ANY' } },
    hasSuccessPort: true,
    hasFailurePort: true,
    executeWhen: 'CONJUNCTION',
    isAsync: false,
    // Mark as expression since most npm functions are pure
    // This is a reasonable default for stubs
    expression: true,
  };
}

/**
 * Is `nt` the generic import stub `createImportStub` emits when an
 * `@fwImport` package cannot be resolved on disk? Such a stub carries an
 * `importSource`, no inputs, and a single `{ result }` output. We detect
 * it structurally (rather than tagging the AST) so a caller-supplied
 * `externalNodeType` with the real port shape can replace it during the
 * `fullParse` merge. A real imported type (resolved from a readable
 * `.d.ts`) has its actual ports and is left untouched.
 */
export function isImportStub(nt: TNodeTypeAST): boolean {
  if (!(nt as { importSource?: string }).importSource) return false;
  const inputKeys = Object.keys(nt.inputs ?? {});
  const outputKeys = Object.keys(nt.outputs ?? {});
  return inputKeys.length === 0 && outputKeys.length === 1 && outputKeys[0] === 'result';
}
