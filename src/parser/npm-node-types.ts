/**
 * Filling in the ports of npm node types after a parse.
 *
 * Decides how a node type that came from an npm package (one with an
 * `importSource`) gets its full port list and async-ness back from the
 * package's exports, since the `@fwImport` annotation persisted in the source
 * only records its name, function and package. A node type the package does
 * not export is left as it is.
 */
import type { TPortDefinition, TWorkflowAST } from '../ast/types';
import { getPackageExports } from '../npm-packages';

/**
 * Resolve npm node types by re-reading their .d.ts files.
 * This fills in the full port information that isn't stored in @fwImport annotations.
 *
 * When workflows are parsed, npm node types from @fwImport annotations only contain
 * minimal stub information (name, functionName, importSource). This function re-resolves
 * the full port definitions from the actual .d.ts files of the npm packages.
 *
 * @param ast - The workflow AST with potentially stub npm node types
 * @param workdir - Directory to search for node_modules (typically the workflow file's directory)
 * @returns Updated AST with fully resolved npm node types
 */
export function resolveNpmNodeTypes(ast: TWorkflowAST, workdir: string): TWorkflowAST {
  if (!ast.nodeTypes || ast.nodeTypes.length === 0) {
    return ast;
  }

  const resolvedNodeTypes = ast.nodeTypes.map((nodeType) => {
    // Only resolve npm node types (those with importSource)
    if (!nodeType.importSource) {
      return nodeType;
    }

    // Get the full node type from the .d.ts file
    const packageExports = getPackageExports(nodeType.importSource, workdir);
    const matchingExport = packageExports.find(
      (exp) => exp.name === nodeType.name || exp.function === nodeType.functionName
    );

    if (!matchingExport) {
      // Can't resolve - keep stub (will show only result port)
      return nodeType;
    }

    // Convert TNpmNodeType ports to TNodeTypeAST inputs/outputs
    const inputs: Record<string, TPortDefinition> = {};
    const outputs: Record<string, TPortDefinition> = {};

    for (const port of matchingExport.ports) {
      if (port.direction === 'INPUT') {
        inputs[port.name] = {
          dataType: port.type,
          label: port.defaultLabel,
        };
      } else if (port.direction === 'OUTPUT') {
        outputs[port.name] = {
          dataType: port.type,
          label: port.defaultLabel,
        };
      }
    }

    return {
      ...nodeType,
      inputs,
      outputs,
      isAsync: matchingExport.synchronicity === 'ASYNC',
    };
  });

  return {
    ...ast,
    nodeTypes: resolvedNodeTypes,
  };
}
