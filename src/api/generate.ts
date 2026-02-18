/* eslint-disable no-console */
import type {
  TGenerateOptions as ASTGenerateOptions,
  TWorkflowAST,
  TNodeTypeAST,
  TModuleFormat,
} from '../ast/types';
import { bodyGenerator } from '../body-generator';
import { extractExitPorts, extractStartPorts, hasBranching } from '../ast/workflow-utils';
import { isExecutePort } from '../constants';
import { mapToTypeScript } from '../type-mappings';
import { SourceMapGenerator } from 'source-map';
import { generateInlineRuntime, generateInlineDebugClient } from './inline-runtime';
import { validateWorkflowAsync } from '../generator/async-detection';
import { extractTypeDeclarationsFromFile } from './extract-types';
import * as path from 'node:path';
import * as fs from 'fs';

export interface GenerateOptions extends Partial<ASTGenerateOptions> {
  /**
   * Whether to generate production-optimized code (no debug events)
   */
  production?: boolean;
  /**
   * Whether to generate source maps
   */
  sourceMap?: boolean;
  /**
   * All workflows in the source file (needed for local workflow dependencies)
   */
  allWorkflows?: TWorkflowAST[];
  /**
   * Module format for generated code ('esm' or 'cjs')
   * @default 'esm'
   */
  moduleFormat?: TModuleFormat;
  /**
   * Path to external runtime module (relative from the generated file).
   * When set, generates import from this path instead of inlining runtime types.
   * Use this for multi-workflow bundles to avoid duplicate type declarations.
   * @example '../runtime/types.js'
   */
  externalRuntimePath?: string;
  /**
   * Constants from source file(s) to include at the top of the generated file.
   * Used in bundle mode when local node functions are inlined and need their
   * referenced constants available.
   */
  constants?: string[];
  /**
   * Map of node type names to their import paths.
   * When set, generates imports instead of inlining the function text.
   * Used in bundle mode where node types are in separate files.
   * @example { 'add': '../node-types/add.js', 'greet': '../node-types/greet.js' }
   */
  externalNodeTypes?: Record<string, string>;
}

// ============================================================================
// Module Format Helpers
// ============================================================================

/**
 * Generate an import statement in the appropriate module format
 */
export function generateImportStatement(
  names: string[],
  source: string,
  moduleFormat: TModuleFormat
): string {
  if (moduleFormat === 'cjs') {
    return `const { ${names.join(', ')} } = require('${source}');`;
  }
  return `import { ${names.join(', ')} } from '${source}';`;
}

/**
 * Generate an export statement for a function in the appropriate module format
 * For ESM: export async function name() { }
 * For CJS: async function name() { } (module.exports added at end)
 */
export function generateFunctionExportKeyword(moduleFormat: TModuleFormat): string {
  return moduleFormat === 'cjs' ? '' : 'export ';
}

/**
 * Generate module.exports statement for CJS format
 */
export function generateModuleExports(functionNames: string[]): string {
  if (functionNames.length === 1) {
    return `module.exports = { ${functionNames[0]} };`;
  }
  return `module.exports = { ${functionNames.join(', ')} };`;
}

export interface GenerateResult {
  code: string;
  sourceMap?: string;
}

/**
 * Generate executable TypeScript code from a workflow AST
 *
 * @param ast - The workflow AST to generate code from
 * @param options - Generation options (production mode, source maps, etc.)
 * @returns Generated code as a string, or GenerateResult with source map
 *
 * @example
 * ```typescript
 * const result = generateCode(ast, {
 *   production: false,
 *   sourceMap: true
 * });
 *
 * fs.writeFileSync('workflow.generated.ts', result.code);
 * if (result.sourceMap) {
 *   fs.writeFileSync('workflow.generated.ts.map', result.sourceMap);
 * }
 * ```
 */
export function generateCode(
  ast: TWorkflowAST,
  options?: GenerateOptions & { sourceMap: true }
): GenerateResult;
export function generateCode(ast: TWorkflowAST, options?: GenerateOptions): string;
export function generateCode(
  ast: TWorkflowAST,
  options?: GenerateOptions
): string | GenerateResult {
  const {
    production = false,
    sourceMap = false,
    allWorkflows = [],
    moduleFormat = 'esm',
    externalRuntimePath,
    constants = [],
    externalNodeTypes = {},
  } = options || {};

  // Determine if workflow should be async based on node composition
  const { shouldBeAsync, warning } = validateWorkflowAsync(ast, ast.nodeTypes);
  if (warning && !production) {
    console.warn(warning);
  }

  // Initialize source map generator if requested
  let sourceMapGenerator: SourceMapGenerator | undefined;
  let currentLine = 1;

  if (sourceMap) {
    sourceMapGenerator = new SourceMapGenerator({
      file: `${ast.functionName}.generated.ts`,
    });
  }

  const addLine = () => {
    currentLine++;
  };

  const addMapping = (sourceLine: number, sourceColumn: number = 0) => {
    if (sourceMapGenerator && ast.sourceFile) {
      sourceMapGenerator.addMapping({
        generated: {
          line: currentLine,
          column: 0,
        },
        source: ast.sourceFile,
        original: {
          line: sourceLine,
          column: sourceColumn,
        },
      });
    }
  };

  // Generate function body using existing body generator
  // Bundle mode uses params object pattern for node wrapper calls
  const bundleMode = !!externalRuntimePath;
  const functionBody = bodyGenerator.generateWithExecutionContext(
    ast,
    ast.nodeTypes,
    shouldBeAsync,
    production,
    bundleMode
  );

  // Build the complete module
  const lines: string[] = [];

  lines.push('');
  addLine();
  lines.push('');
  addLine();

  // Include runtime (either inline or external import)
  if (externalRuntimePath) {
    // Import from external runtime module to avoid duplicate declarations in multi-file bundles
    lines.push(`// Runtime imported from shared module`);
    addLine();
    lines.push(
      generateImportStatement(
        ['GeneratedExecutionContext', 'CancellationError'],
        externalRuntimePath,
        moduleFormat
      )
    );
    addLine();
    if (!production) {
      lines.push(
        generateImportStatement(
          ['TDebugger', 'createFlowWeaverDebugClient'],
          externalRuntimePath,
          moduleFormat
        )
      );
      addLine();
    }
    lines.push('');
    addLine();
  } else {
    // Include inline runtime (types + GeneratedExecutionContext)
    const inlineRuntime = generateInlineRuntime(production);
    const runtimeLines = inlineRuntime.split('\n');
    runtimeLines.forEach((line) => {
      lines.push(line);
      addLine();
    });

    lines.push('');
    addLine();

    // Include inline debug client (dev mode only)
    if (!production) {
      const inlineDebugClient = generateInlineDebugClient(moduleFormat);
      const debugClientLines = inlineDebugClient.split('\n');
      debugClientLines.forEach((line) => {
        lines.push(line);
        addLine();
      });
    }
  }

  // Extract and include type declarations from source file (interfaces, type aliases)
  if (ast.sourceFile) {
    const extractedTypes = extractTypeDeclarationsFromFile(ast.sourceFile);
    if (extractedTypes.all.length > 0) {
      lines.push('');
      addLine();
      lines.push('// ============================================================================');
      addLine();
      lines.push('// Type Declarations (preserved from source)');
      addLine();
      lines.push('// ============================================================================');
      addLine();
      lines.push('');
      addLine();

      extractedTypes.all.forEach((typeDecl) => {
        const typeDeclLines = typeDecl.split('\n');
        typeDeclLines.forEach((line) => {
          lines.push(line);
          addLine();
        });
        lines.push('');
        addLine();
      });
    }
  }

  // Handle imported nodes — three categories:
  // 1. npm package nodes (have importSource)
  // 2. relative file imports (sourceLocation file differs from workflow source)
  // 3. local nodes (same source file)
  const npmPackageNodes = ast.nodeTypes.filter((n) => n.importSource);
  const localNodes = ast.nodeTypes.filter(
    (n) => !n.importSource && n.sourceLocation?.file === ast.sourceFile
  );
  const importedNodes = ast.nodeTypes.filter(
    (n) => !n.importSource && n.sourceLocation?.file !== ast.sourceFile
  );

  if (importedNodes.length > 0 || npmPackageNodes.length > 0) {
    // Separate FUNCTION imports (from source) vs IMPORTED_WORKFLOW imports (from generated)
    // Store full node info to access expression property later
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

    lines.push('');
    addLine();

    // Import regular node functions from source files
    // In bundle mode (externalRuntimePath is set), import from node-types directory
    // Otherwise import from .generated files in the same directory
    functionImportsByFile.forEach((nodes, sourceFile) => {
      if (externalRuntimePath) {
        // Bundle mode: import from node-types directory
        // Bundle mode: import _impl (positional data args for expression nodes, execute + data args for regular)
        // The wrapper is only for HTTP entry points, not internal workflow calls
        nodes.forEach((node) => {
          const lowerName = node.functionName.toLowerCase();
          const relativePath = `../node-types/${lowerName}.js`;
          const importName = `${lowerName}_impl as ${node.functionName}`;
          lines.push(generateImportStatement([importName], relativePath, moduleFormat));
          addLine();
        });
      } else {
        const sourceFileName = path.basename(sourceFile, '.ts');
        const generatedFileName = sourceFileName + '.generated';
        const relativePath = `./${generatedFileName}`;
        const names = nodes.map((n) => n.functionName);
        lines.push(generateImportStatement(names, relativePath, moduleFormat));
        addLine();
      }
    });

    // Import workflows from their generated files
    // In bundle mode, import from sibling workflow files
    workflowImportsByFile.forEach((names, sourceFile) => {
      if (externalRuntimePath) {
        // Bundle mode: import each workflow from the workflows directory
        names.forEach((name) => {
          const relativePath = `./${name}.js`;
          lines.push(generateImportStatement([name], relativePath, moduleFormat));
          addLine();
        });
      } else {
        const sourceFileName = path.basename(sourceFile, '.ts');
        // For workflows, always import from generated file
        // Add .generated suffix if not already present
        const generatedFileName = sourceFileName.includes('.generated')
          ? sourceFileName
          : sourceFileName + '.generated';
        const relativePath = `./${generatedFileName}`;
        lines.push(generateImportStatement(names, relativePath, moduleFormat));
        addLine();
      }
    });

    // Import npm package functions directly from their package specifiers
    if (npmPackageNodes.length > 0) {
      const npmImportsByPackage = new Map<string, string[]>();
      npmPackageNodes.forEach((node) => {
        const pkg = node.importSource!;
        if (!npmImportsByPackage.has(pkg)) npmImportsByPackage.set(pkg, []);
        npmImportsByPackage.get(pkg)!.push(node.functionName);
      });
      npmImportsByPackage.forEach((names, pkg) => {
        lines.push(generateImportStatement(names, pkg, moduleFormat));
        addLine();
      });
    }

    lines.push('');
    addLine();
  }

  // Separate local nodes into functions and workflows
  const localFunctions = localNodes.filter((n) => n.variant !== 'IMPORTED_WORKFLOW');
  // Only include workflows that are actually used as node instances in this workflow
  // (not all sibling workflows in the same file)
  const usedNodeTypeNames = new Set(ast.instances.map((i) => i.nodeType));
  const localWorkflowNodes = localNodes.filter(
    (n) => n.variant === 'IMPORTED_WORKFLOW' && usedNodeTypeNames.has(n.name)
  );

  // In bundle mode, local node functions are inlined directly
  // They're not imported from node-types directory because:
  // 1. They may not be in the bundled node types list
  // 2. Scoped nodes need the scope function closure generated inline
  // Constants that were extracted from source files are included before the functions

  // Include constants from source files (needed for inlined local functions)
  if (constants.length > 0 && localFunctions.length > 0) {
    lines.push('');
    addLine();
    lines.push('// Constants from source file');
    addLine();
    constants.forEach((constant) => {
      lines.push(constant);
      const constLines = constant.split('\n');
      constLines.forEach(() => addLine());
    });
  }

  // Include local node functions (regular functions, not workflows)
  // If externalNodeTypes is provided, generate imports instead of inlining
  if (localFunctions.length > 0) {
    // Separate into external (import) and inline
    const externalFunctions = localFunctions.filter((n) => externalNodeTypes[n.name]);
    const inlineFunctions = localFunctions.filter((n) => !externalNodeTypes[n.name]);

    // Generate imports for external node types
    if (externalFunctions.length > 0) {
      lines.push('');
      addLine();
      externalFunctions.forEach((node) => {
        const importPath = externalNodeTypes[node.name];
        const lowerFunctionName = node.functionName.toLowerCase();

        // Bundle mode: import _impl (positional data args for expression nodes, execute + data args for regular)
        // The wrapper is only for HTTP entry points, not internal workflow calls
        const importName = `${lowerFunctionName}_impl as ${node.functionName}`;

        const importStatement = generateImportStatement(
          [importName],
          importPath,
          moduleFormat
        );
        lines.push(importStatement);
        addLine();
      });
    }

    // Inline functions not in externalNodeTypes
    if (inlineFunctions.length > 0) {
      lines.push('');
      addLine();
      inlineFunctions.forEach((node) => {
        if (node.importSource) return; // Never inline npm package functions
        const functionText = node.functionText;
        if (functionText) {
          const functionWithoutDecorators = removeDecorators(functionText);

          // Add source mapping for the node function
          if (node.sourceLocation) {
            addMapping(node.sourceLocation.line, node.sourceLocation.column);
          }

          lines.push(functionWithoutDecorators);
          const functionLines = functionWithoutDecorators.split('\n');
          functionLines.forEach(() => addLine());

          lines.push('');
          addLine();
        }
      });
    }
  }

  // Generate local workflow dependencies (workflows used as nodes in the same file)
  const generatedWorkflows = new Set<string>();
  generatedWorkflows.add(ast.functionName); // Don't regenerate the main workflow

  if (localWorkflowNodes.length > 0 && allWorkflows.length > 0) {
    lines.push('');
    addLine();
    lines.push('// ============================================================================');
    addLine();
    lines.push('// Local Workflow Dependencies');
    addLine();
    lines.push('// ============================================================================');
    addLine();

    for (const node of localWorkflowNodes) {
      if (generatedWorkflows.has(node.functionName)) {
        continue;
      }

      // Find the workflow AST for this node
      const depWorkflow = allWorkflows.find((w) => w.functionName === node.functionName);
      if (!depWorkflow) {
        lines.push(`// WARNING: Could not find workflow AST for ${node.functionName}`);
        addLine();
        continue;
      }

      // Generate the workflow function (without module wrapper)
      const depFunctionCode = generateWorkflowFunction(
        depWorkflow,
        production,
        allWorkflows,
        generatedWorkflows
      );
      const depLines = depFunctionCode.split('\n');
      depLines.forEach((line) => {
        lines.push(line);
        addLine();
      });

      lines.push('');
      addLine();

      generatedWorkflows.add(node.functionName);
    }
  }

  // Generate workflow function signature
  const startPorts = extractStartPorts(ast);
  const exitPorts = extractExitPorts(ast);

  lines.push('');
  addLine();

  // Add source mapping for the workflow export function
  if (sourceMapGenerator && ast.sourceFile) {
    try {
      const sourceContent = fs.readFileSync(ast.sourceFile, 'utf-8');
      const sourceLines = sourceContent.split('\n');
      const exportLineIndex = sourceLines.findIndex(
        (line: string) => line.includes(`export`) && line.includes(`function ${ast.functionName}`)
      );
      if (exportLineIndex >= 0) {
        addMapping(exportLineIndex + 1, 0); // Line numbers are 1-indexed
      }
    } catch {
      // If we can't find the source line, skip the mapping
    }
  }

  // Generate conditional async keyword and export keyword based on module format
  const asyncKeyword = shouldBeAsync ? 'async ' : '';
  const exportKeyword = generateFunctionExportKeyword(moduleFormat);
  lines.push(`${exportKeyword}${asyncKeyword}function ${ast.functionName}(`);
  addLine();

  // STEP Port Architecture: execute is first parameter
  lines.push(`  execute: boolean = true,`);
  addLine();

  // Collect param names and types for destructuring
  const paramEntries: Array<{ name: string; type: string }> = [];
  Object.entries(startPorts).forEach(([portName, portDef]) => {
    if (isExecutePort(portName)) return;
    paramEntries.push({
      name: portName,
      type: mapToTypeScript(portDef.dataType, portDef.tsType),
    });
  });

  // Use Record<string, unknown> for params to support HTTP handler compatibility
  lines.push(`  params: Record<string, unknown> = {},`);
  addLine();

  // In development mode, accept optional debugger parameter for local debugging
  // (environment variable is used as fallback)
  if (!production) {
    lines.push(`  __flowWeaverDebugger__?: TDebugger,`);
    addLine();
  }

  // Accept optional AbortSignal for cancellation support
  lines.push(`  __abortSignal__?: AbortSignal`);
  addLine();
  addLine();

  const workflowHasBranching = hasBranching(ast);
  const returnTypes: string[] = [];
  Object.entries(exitPorts).forEach(([portName, portDef]) => {
    const optional = workflowHasBranching ? '?' : '';
    const tsType = mapToTypeScript(portDef.dataType, portDef.tsType);
    returnTypes.push(`${portName}${optional}: ${tsType}`);
  });

  // Generate conditional return type (Promise vs direct)
  const returnTypeInner = `{ ${returnTypes.join('; ')} }`;
  const returnType = shouldBeAsync ? `Promise<${returnTypeInner}>` : returnTypeInner;
  lines.push(`): ${returnType} {`);
  addLine();

  // NOTE: We intentionally don't destructure params here.
  // The body generator uses ctx.getVariable to access Start ports, and
  // destructuring would shadow local node functions with the same name
  // (e.g., a 'delay' param would shadow a 'delay' node function).

  // Add function body
  const bodyLines = functionBody.split('\n');
  bodyLines.forEach((line) => {
    lines.push(line);
    addLine();
  });

  lines.push('}');
  addLine();

  // For CJS format, add module.exports at the end
  if (moduleFormat === 'cjs') {
    lines.push('');
    addLine();
    lines.push(generateModuleExports([ast.functionName]));
    addLine();
  }

  const code = lines.join('\n');

  // Set source content for the source map
  if (sourceMapGenerator && ast.sourceFile) {
    const sourceContent = fs.readFileSync(ast.sourceFile, 'utf8');
    sourceMapGenerator.setSourceContent(ast.sourceFile, sourceContent);
  }

  // Return result with source map if requested
  if (sourceMap && sourceMapGenerator) {
    return {
      code,
      sourceMap: sourceMapGenerator.toString(),
    };
  }

  return code;
}

function removeDecorators(functionText: string): string {
  return functionText.replace(/@\w+\({[\s\S]*?}\)\s*/g, '');
}

/**
 * Generate just the workflow function (no module wrapper)
 * Used for local workflow dependencies
 */
function generateWorkflowFunction(
  workflow: TWorkflowAST,
  production: boolean,
  allWorkflows: TWorkflowAST[],
  generatedWorkflows: Set<string>
): string {
  const lines: string[] = [];

  // Mark this workflow as generated FIRST to prevent infinite recursion
  // (a workflow may reference itself in nodeTypes)
  generatedWorkflows.add(workflow.functionName);

  // Find local workflow dependencies (other workflows in same file actually used as nodes)
  const usedNodeTypeNames = new Set(workflow.instances.map((i) => i.nodeType));
  const localWorkflowDeps = workflow.nodeTypes.filter(
    (n) =>
      n.variant === 'IMPORTED_WORKFLOW' &&
      n.sourceLocation?.file === workflow.sourceFile &&
      usedNodeTypeNames.has(n.name) &&
      !generatedWorkflows.has(n.functionName)
  );

  for (const dep of localWorkflowDeps) {
    const depWorkflow = allWorkflows.find((w) => w.functionName === dep.functionName);
    if (depWorkflow) {
      const depCode = generateWorkflowFunction(
        depWorkflow,
        production,
        allWorkflows,
        generatedWorkflows
      );
      lines.push(depCode);
      lines.push('');
    }
  }

  // Determine if workflow should be async
  const { shouldBeAsync } = validateWorkflowAsync(workflow, workflow.nodeTypes);

  // Generate function body (local dependencies always use non-bundle mode)
  const functionBody = bodyGenerator.generateWithExecutionContext(
    workflow,
    workflow.nodeTypes,
    shouldBeAsync,
    production,
    false // bundleMode - local deps use positional args
  );

  // Generate function signature
  const startPorts = extractStartPorts(workflow);
  const exitPorts = extractExitPorts(workflow);

  const asyncKeyword = shouldBeAsync ? 'async ' : '';
  lines.push(`${asyncKeyword}function ${workflow.functionName}(`);

  // STEP Port Architecture: execute is first parameter
  lines.push(`  execute: boolean = true,`);

  // Collect param names and types for destructuring
  const paramEntries: Array<{ name: string; type: string }> = [];
  Object.entries(startPorts).forEach(([portName, portDef]) => {
    if (isExecutePort(portName)) return;
    paramEntries.push({
      name: portName,
      type: mapToTypeScript(portDef.dataType, portDef.tsType),
    });
  });

  // Use Record<string, unknown> for params to support HTTP handler compatibility
  lines.push(`  params: Record<string, unknown> = {},`);

  // In development mode, accept optional debugger parameter
  if (!production) {
    lines.push(`  __flowWeaverDebugger__?: TDebugger,`);
  }

  // Accept optional AbortSignal for cancellation support
  lines.push(`  __abortSignal__?: AbortSignal`);

  const workflowHasBranching = hasBranching(workflow);
  const returnTypes: string[] = [];
  Object.entries(exitPorts).forEach(([portName, portDef]) => {
    const optional = workflowHasBranching ? '?' : '';
    const tsType = mapToTypeScript(portDef.dataType, portDef.tsType);
    returnTypes.push(`${portName}${optional}: ${tsType}`);
  });

  const returnTypeInner = `{ ${returnTypes.join('; ')} }`;
  const returnType = shouldBeAsync ? `Promise<${returnTypeInner}>` : returnTypeInner;
  lines.push(`): ${returnType} {`);

  // NOTE: We intentionally don't destructure params here.
  // The body generator uses ctx.getVariable to access Start ports, and
  // destructuring would shadow local node functions with the same name.

  // Add function body
  lines.push(functionBody);

  lines.push('}');

  return lines.join('\n');
}
