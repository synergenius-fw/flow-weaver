/**
 * The node functions a generated module carries itself.
 *
 * Decides, for each local node function, whether it is imported (the caller
 * maps it in `externalNodeTypes`, as bundle mode does) or inlined; which text
 * is inlined (the production variant when there is one, decorators removed);
 * that the helpers built-in nodes share are emitted once, before the
 * functions; and that source constants the functions refer to come first.
 */

import type { TModuleFormat, TNodeTypeAST } from '../../ast/types';
import { generateImportStatement } from './module-format';
import type { ModuleWriter } from './module-writer';

/**
 * Emits the constants extracted from the source file(s), which inlined local
 * functions may reference. Only when there are local functions to need them.
 */
export function emitSourceConstants(writer: ModuleWriter, constants: string[], localFunctions: TNodeTypeAST[]): void {
  if (constants.length === 0 || localFunctions.length === 0) return;
  writer.push('');
  writer.push('// Constants from source file');
  constants.forEach((constant) => writer.push(constant));
}

/**
 * Emits the local node functions: an import of the `_impl` for each one
 * mapped in `externalNodeTypes`, then the shared helpers and the inlined text
 * of every other one, each mapped to its source location. npm package
 * functions are never inlined.
 */
export function emitLocalNodeFunctions(
  writer: ModuleWriter,
  localFunctions: TNodeTypeAST[],
  externalNodeTypes: Record<string, string>,
  moduleFormat: TModuleFormat,
  production: boolean,
): void {
  const externalFunctions = localFunctions.filter((n) => externalNodeTypes[n.name]);
  const inlineFunctions = localFunctions.filter((n) => !externalNodeTypes[n.name]);

  if (externalFunctions.length > 0) {
    writer.push('');
    externalFunctions.forEach((node) => {
      // The wrapper is only for HTTP entry points; a workflow calls the _impl
      // (positional data args for expression nodes, execute + data args for regular).
      const importName = `${node.functionName.toLowerCase()}_impl as ${node.functionName}`;
      writer.push(generateImportStatement([importName], externalNodeTypes[node.name], moduleFormat));
    });
  }

  if (inlineFunctions.length > 0) {
    writer.push('');
    emitSharedHelpers(writer, inlineFunctions, production);
    inlineFunctions.forEach((node) => {
      if (node.importSource) return;
      const functionText = (production && node.functionTextProduction != null) ? node.functionTextProduction : node.functionText;
      if (!functionText) return;
      if (node.sourceLocation) {
        writer.map(node.sourceLocation.line, node.sourceLocation.column);
      }
      writer.push(removeDecorators(functionText));
      writer.push('');
    });
  }
}

/**
 * Emits each distinct helper text once (built-in nodes share them). A
 * production build uses `helperTextProduction` and skips helpers a node does
 * not define for production (production built-ins need no mock helpers).
 */
function emitSharedHelpers(writer: ModuleWriter, inlineFunctions: TNodeTypeAST[], production: boolean): void {
  const emittedHelpers = new Set<string>();
  inlineFunctions.forEach((node) => {
    if (node.importSource) return;
    const helperText = production ? (node.helperTextProduction ?? null) : (node.helperText ?? null);
    if (helperText && !emittedHelpers.has(helperText)) {
      emittedHelpers.add(helperText);
      writer.push(helperText);
      writer.push('');
    }
  });
}

function removeDecorators(functionText: string): string {
  return functionText.replace(/@\w+\({[\s\S]*?}\)\s*/g, '');
}
