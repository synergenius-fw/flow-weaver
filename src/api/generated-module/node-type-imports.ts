/**
 * Where each node type of a workflow comes from in the generated module.
 *
 * Decides the three categories: npm package nodes (they have an
 * importSource) are imported from their package; node types defined in
 * another file are imported from that file's generated module (from
 * `node-types/` and sibling workflow files in bundle mode); node types of the
 * workflow's own file, and the built-in nodes it uses, are local and emitted
 * into the module itself.
 */

import * as path from 'node:path';
import type { TModuleFormat, TNodeTypeAST, TWorkflowAST } from '../../ast/types';
import { generateImportStatement } from './module-format';
import type { ModuleWriter } from './module-writer';

export interface NodeTypeOrigins {
  /** Node types imported from an npm package. */
  npmPackageNodes: TNodeTypeAST[];
  /**
   * Node types whose source is not the workflow's file. Built-in nodes (no
   * source location) are counted here too; they are not imported, but their
   * presence still opens the import block.
   */
  importedNodes: TNodeTypeAST[];
  /** Local node functions: the file's own node types and the built-ins the workflow uses. */
  localFunctions: TNodeTypeAST[];
  /** Workflows of the same file that this workflow uses as nodes. */
  localWorkflowNodes: TNodeTypeAST[];
}

/** Sorts a workflow's node types by where the generated module gets them from. */
export function classifyNodeTypes(ast: TWorkflowAST): NodeTypeOrigins {
  const npmPackageNodes = ast.nodeTypes.filter((n) => n.importSource);
  // Only include built-in nodes (no sourceLocation) that are actually used by this workflow
  const referencedNodeTypes = new Set(ast.instances.map((i) => i.nodeType));
  const localNodes = ast.nodeTypes.filter(
    (n) => !n.importSource && (n.sourceLocation?.file === ast.sourceFile || (!n.sourceLocation && n.functionText && n.helperText != null && referencedNodeTypes.has(n.name)))
  );
  const importedNodes = ast.nodeTypes.filter(
    (n) => !n.importSource && n.sourceLocation?.file !== ast.sourceFile
  );
  // Only the workflows actually used as node instances here, not every sibling workflow in the file
  return {
    npmPackageNodes,
    importedNodes,
    localFunctions: localNodes.filter((n) => n.variant !== 'IMPORTED_WORKFLOW'),
    localWorkflowNodes: localNodes.filter(
      (n) => n.variant === 'IMPORTED_WORKFLOW' && referencedNodeTypes.has(n.name)
    ),
  };
}

/**
 * Emits the import block for node types from other files and npm packages,
 * framed by blank lines, when there are any.
 *
 * A node function is imported from the `.generated` module next to its
 * source file; in bundle mode each one is imported as its `_impl` from
 * `../node-types/` (the wrapper is only for HTTP entry points). A workflow is
 * imported from its generated file; in bundle mode from its sibling file.
 */
export function emitNodeTypeImports(
  writer: ModuleWriter,
  origins: NodeTypeOrigins,
  bundleMode: boolean,
  moduleFormat: TModuleFormat,
): void {
  const { importedNodes, npmPackageNodes } = origins;
  if (importedNodes.length === 0 && npmPackageNodes.length === 0) return;

  const functionImportsByFile = new Map<string, TNodeTypeAST[]>();
  const workflowImportsByFile = new Map<string, string[]>();
  importedNodes.forEach((node) => {
    const sourceFile = node.sourceLocation?.file;
    if (!sourceFile) return;
    if (node.variant === 'IMPORTED_WORKFLOW') {
      if (!workflowImportsByFile.has(sourceFile)) {
        workflowImportsByFile.set(sourceFile, []);
      }
      workflowImportsByFile.get(sourceFile)?.push(node.functionName);
    } else {
      if (!functionImportsByFile.has(sourceFile)) {
        functionImportsByFile.set(sourceFile, []);
      }
      functionImportsByFile.get(sourceFile)?.push(node);
    }
  });

  writer.push('');

  functionImportsByFile.forEach((nodes, sourceFile) => {
    if (bundleMode) {
      nodes.forEach((node) => {
        const lowerName = node.functionName.toLowerCase();
        const importName = `${lowerName}_impl as ${node.functionName}`;
        writer.push(generateImportStatement([importName], `../node-types/${lowerName}.js`, moduleFormat));
      });
    } else {
      const generatedFileName = path.basename(sourceFile, '.ts') + '.generated';
      const names = nodes.map((n) => n.functionName);
      writer.push(generateImportStatement(names, `./${generatedFileName}`, moduleFormat));
    }
  });

  workflowImportsByFile.forEach((names, sourceFile) => {
    if (bundleMode) {
      names.forEach((name) => {
        writer.push(generateImportStatement([name], `./${name}.js`, moduleFormat));
      });
    } else {
      const sourceFileName = path.basename(sourceFile, '.ts');
      // Add .generated suffix if not already present
      const generatedFileName = sourceFileName.includes('.generated')
        ? sourceFileName
        : sourceFileName + '.generated';
      writer.push(generateImportStatement(names, `./${generatedFileName}`, moduleFormat));
    }
  });

  const npmImportsByPackage = new Map<string, string[]>();
  npmPackageNodes.forEach((node) => {
    const pkg = node.importSource!;
    if (!npmImportsByPackage.has(pkg)) npmImportsByPackage.set(pkg, []);
    npmImportsByPackage.get(pkg)!.push(node.functionName);
  });
  npmImportsByPackage.forEach((names, pkg) => {
    writer.push(generateImportStatement(names, pkg, moduleFormat));
  });

  writer.push('');
}
