/**
 * The top of a generated module: the inlined runtime and the type
 * declarations preserved from the workflow source.
 *
 * Decides that the runtime is always inlined (a compiled workflow has no
 * runtime dependency) and that every interface and type alias of the source
 * file is carried over, in source order, so node signatures that name them
 * still compile.
 */

import type { TModuleFormat } from '../../ast/types';
import { generateInlineRuntime } from '../inline-runtime';
import { extractTypeDeclarationsFromFile } from '../extract-types';
import type { ModuleWriter } from './module-writer';

/** Emits the inlined runtime for the production or development build, in the module format. */
export function emitInlineRuntime(writer: ModuleWriter, production: boolean, moduleFormat: TModuleFormat): void {
  writer.push(generateInlineRuntime(production, false, 'typescript', moduleFormat));
  writer.push('');
}

/** Emits the interfaces and type aliases declared in the workflow's source file, if any. */
export function emitPreservedTypeDeclarations(writer: ModuleWriter, sourceFile: string | undefined): void {
  if (!sourceFile) return;
  const extractedTypes = extractTypeDeclarationsFromFile(sourceFile);
  if (extractedTypes.all.length === 0) return;

  writer.push('');
  writer.push('// ============================================================================');
  writer.push('// Type Declarations (preserved from source)');
  writer.push('// ============================================================================');
  writer.push('');
  extractedTypes.all.forEach((typeDecl) => {
    writer.push(typeDecl);
    writer.push('');
  });
}
