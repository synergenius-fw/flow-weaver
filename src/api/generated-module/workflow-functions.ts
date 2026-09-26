/**
 * The workflow functions in a generated module: the exported workflow itself
 * and the same-file workflows it uses as nodes.
 *
 * Decides the generated signature (the v2 ABI: `execute`, `params`, the
 * required `__runtime__`, and a return type whose exit ports are optional
 * when the workflow branches), when a function is async (whenever a node is
 * async, and always outside production so the debugger can pause), and that
 * each local workflow dependency is emitted once, dependencies first, with
 * its own graph identity when the closure is durable.
 *
 * Params are deliberately not destructured: the body reads Start ports with
 * ctx.getVariable, and a destructured param would shadow a node function of
 * the same name (a 'delay' param would shadow a 'delay' node).
 */

import * as fs from 'fs';
import type { TModuleFormat, TNodeTypeAST, TWorkflowAST } from '../../ast/types';
import { bodyGenerator } from '../../generator/body-generator';
import { validateWorkflowAsync } from '../../generator/async-detection';
import { extractExitPorts, hasBranching } from '../../ast/workflow-utils';
import { mapToTypeScript } from '../../types/type-mappings';
import { graphIdentity } from '../graph-identity';
import { generateFunctionExportKeyword } from './module-format';
import type { ModuleWriter } from './module-writer';

/**
 * The signature lines of a workflow function, from `<keywords>function
 * name(` to `): ReturnType {`.
 *
 * @param keywords - `export `, `async ` or both, as the caller decides.
 */
function workflowSignature(workflow: TWorkflowAST, keywords: string, shouldBeAsync: boolean): string[] {
  const exitPorts = extractExitPorts(workflow);
  const workflowHasBranching = hasBranching(workflow);
  const returnTypes: string[] = [];
  Object.entries(exitPorts).forEach(([portName, portDef]) => {
    const optional = workflowHasBranching ? '?' : '';
    const tsType = mapToTypeScript(portDef.dataType, portDef.tsType);
    returnTypes.push(`${portName}${optional}: ${tsType}`);
  });
  const returnTypeInner = `{ ${returnTypes.join('; ')} }`;
  const returnType = shouldBeAsync ? `Promise<${returnTypeInner}>` : returnTypeInner;
  return [
    `${keywords}function ${workflow.functionName}(`,
    // STEP Port Architecture: execute is first parameter
    `  execute: boolean = true,`,
    // Record<string, unknown> keeps the function compatible with HTTP handlers
    `  params: Record<string, unknown> = {},`,
    // One execution-scoped runtime carries cancellation, tracing, services and
    // continuation state. It is deliberately required in the v2 generated ABI.
    `  __runtime__: WorkflowRuntime`,
    `): ${returnType} {`,
  ];
}

/** `async ` when the function must be async: an async node, or any development build. */
function asyncKeyword(shouldBeAsync: boolean, production: boolean): string {
  return (shouldBeAsync || !production) ? 'async ' : '';
}

/**
 * Emits the exported workflow function around its generated body, mapping
 * its first line to the source line that declares the exported function.
 */
export function emitWorkflowFunction(
  writer: ModuleWriter,
  ast: TWorkflowAST,
  functionBody: string,
  shouldBeAsync: boolean,
  production: boolean,
  moduleFormat: TModuleFormat,
): void {
  writer.push('');
  if (writer.mapsSource && ast.sourceFile) {
    try {
      const sourceLines = fs.readFileSync(ast.sourceFile, 'utf-8').split(/\r?\n/);
      const exportLineIndex = sourceLines.findIndex(
        (line: string) => line.includes(`export`) && line.includes(`function ${ast.functionName}`)
      );
      if (exportLineIndex >= 0) {
        writer.map(exportLineIndex + 1, 0); // Line numbers are 1-indexed
      }
    } catch {
      // If we can't find the source line, skip the mapping
    }
  }
  const keywords = generateFunctionExportKeyword(moduleFormat) + asyncKeyword(shouldBeAsync, production);
  workflowSignature(ast, keywords, shouldBeAsync).forEach((line) => writer.push(line));
  writer.push(functionBody);
  writer.push('}');
}

/**
 * Emits the same-file workflows this workflow uses as nodes, under a banner,
 * when there are any and the file's workflows were passed in. A dependency
 * missing from `allWorkflows` gets a warning comment instead.
 */
export function emitLocalWorkflowDependencies(
  writer: ModuleWriter,
  ast: TWorkflowAST,
  localWorkflowNodes: TNodeTypeAST[],
  allWorkflows: TWorkflowAST[],
  production: boolean,
  durableSequential: boolean,
): void {
  if (localWorkflowNodes.length === 0 || allWorkflows.length === 0) return;
  // The main workflow is never regenerated as its own dependency
  const generatedWorkflows = new Set<string>([ast.functionName]);

  writer.push('');
  writer.push('// ============================================================================');
  writer.push('// Local Workflow Dependencies');
  writer.push('// ============================================================================');

  for (const node of localWorkflowNodes) {
    if (generatedWorkflows.has(node.functionName)) {
      continue;
    }
    const depWorkflow = allWorkflows.find((w) => w.functionName === node.functionName);
    if (!depWorkflow) {
      writer.push(`// WARNING: Could not find workflow AST for ${node.functionName}`);
      continue;
    }
    writer.push(generateWorkflowFunction(depWorkflow, production, allWorkflows, generatedWorkflows, durableSequential));
    writer.push('');
    generatedWorkflows.add(node.functionName);
  }
}

/**
 * Generate just the workflow function (no module wrapper), preceded by its
 * own local workflow dependencies that have not been generated yet.
 */
function generateWorkflowFunction(
  workflow: TWorkflowAST,
  production: boolean,
  allWorkflows: TWorkflowAST[],
  generatedWorkflows: Set<string>,
  durableSequential: boolean,
): string {
  const lines: string[] = [];

  // Mark this workflow as generated FIRST to prevent infinite recursion
  // (a workflow may reference itself in nodeTypes)
  generatedWorkflows.add(workflow.functionName);

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
      lines.push(generateWorkflowFunction(depWorkflow, production, allWorkflows, generatedWorkflows, durableSequential));
      lines.push('');
    }
  }

  const { shouldBeAsync } = validateWorkflowAsync(workflow, workflow.nodeTypes);

  // Local dependencies always use non-bundle mode (positional args).
  // A nested workflow's bind is ignored by the engine below the root frame,
  // but it is the root when called directly, so it carries its own identity.
  const functionBody = bodyGenerator.generateWithExecutionContext(
    workflow,
    workflow.nodeTypes,
    shouldBeAsync,
    production,
    false,
    durableSequential,
    durableSequential ? { graphFingerprint: graphIdentity(workflow, allWorkflows).graphFingerprint } : undefined,
  );

  lines.push(...workflowSignature(workflow, asyncKeyword(shouldBeAsync, production), shouldBeAsync));
  lines.push(functionBody);
  lines.push('}');

  return lines.join('\n');
}
