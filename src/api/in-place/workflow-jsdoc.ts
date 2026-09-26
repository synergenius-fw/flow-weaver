/**
 * Workflow JSDoc.
 *
 * Decides the `@flowWeaver workflow` comment above the workflow function:
 * workflow options, pack deploy tags, `@fwImport` lines, `@node` instances,
 * macros (authored ones that still hold, plus `@path` chains detected in the
 * connections), the `@connect` lines no macro or expression already implies,
 * `@param`/`@returns` ports, and scopes. Only the comment is replaced; the
 * function is left alone.
 */

import * as ts from 'typescript';
import type { TWorkflowAST, TWorkflowMacro } from '../../ast/types';
import {
  formatJSDocDescription,
  generateJSDocPortTag,
  generateNodeInstanceTag,
  httpRouteText,
  planPortTags,
} from '../../generator/annotation-generator';
import { detectSugarPatterns, filterStaleMacros } from '../../generator/sugar-optimizer';
import { serializePackDeployAnnotations } from '../../parser/serialize-deploy-annotations';
import { fwImportFunctionName } from './fw-imports';
import { isConnectionCoveredByMacro } from './macro-coverage';
import { type SourceEdit, parseSource } from './source-file';

/**
 * Replace the workflow function's JSDoc comment with updated annotations
 */
export function replaceWorkflowJSDoc(
  source: string,
  ast: TWorkflowAST,
  options: { skipParamReturns?: boolean } = {}
): SourceEdit {
  const sourceFile = parseSource(source);

  let functionNode: ts.FunctionDeclaration | undefined;

  // Find the FIRST workflow function with the matching name.
  // ts.forEachChild visits all children — we break on first match to avoid
  // targeting a later duplicate (which corrupts the wrong function's JSDoc).
  ts.forEachChild(sourceFile, (node) => {
    if (functionNode) return; // already found — skip
    if (ts.isFunctionDeclaration(node) && node.name?.text === ast.functionName) {
      functionNode = node;
    }
  });

  if (!functionNode) {
    return { code: source, changed: false };
  }

  // Find the JSDoc comment before the function
  const functionStart = functionNode.getFullStart();
  const leadingComments = ts.getLeadingCommentRanges(source, functionStart);

  if (!leadingComments || leadingComments.length === 0) {
    return { code: source, changed: false };
  }

  // Find the JSDoc comment (starts with /**)
  const jsdocComment = leadingComments.find(
    (c) =>
      c.kind === ts.SyntaxKind.MultiLineCommentTrivia && source.slice(c.pos, c.pos + 3) === '/**'
  );

  if (!jsdocComment) {
    return { code: source, changed: false };
  }

  // Generate new JSDoc
  const newJSDoc = generateWorkflowJSDoc(ast, { skipParamReturns: options.skipParamReturns });

  // Get the original JSDoc
  const originalJSDoc = source.slice(jsdocComment.pos, jsdocComment.end);

  // Check if changed
  if (originalJSDoc.trim() === newJSDoc.trim()) {
    return { code: source, changed: false };
  }

  // Replace the JSDoc
  const before = source.slice(0, jsdocComment.pos);
  const after = source.slice(jsdocComment.end);

  return {
    code: before + newJSDoc + after,
    changed: true,
  };
}

/**
 * Generate JSDoc comment for workflow function
 */
function generateWorkflowJSDoc(ast: TWorkflowAST, options: { skipParamReturns?: boolean } = {}): string {
  const lines: string[] = [];

  // Build macro coverage sets for filtering (@map and @coerce)
  const macroInstanceIds = new Set<string>();
  const macroChildIds = new Set<string>();
  const macroScopeNames = new Set<string>();
  const allCoerceInstanceIds = new Set<string>();
  if (ast.macros && ast.macros.length > 0) {
    for (const macro of ast.macros) {
      if (macro.type === 'map') {
        macroInstanceIds.add(macro.instanceId);
        macroChildIds.add(macro.childId);
        macroScopeNames.add(`${macro.instanceId}.iterate`);
      } else if (macro.type === 'coerce') {
        allCoerceInstanceIds.add(macro.instanceId);
      }
    }
  }

  lines.push('/**');

  // Add description
  if (ast.description) {
    lines.push(...formatJSDocDescription(ast.description));
    lines.push(` *`);
  }

  // @flowWeaver marker
  lines.push(' * @flowWeaver workflow');

  // Add workflow options
  if (ast.options?.strictTypes) {
    lines.push(' * @strictTypes');
  }
  if (ast.options?.autoConnect) {
    lines.push(' * @autoConnect');
  }
  // @trigger round-trip
  if (ast.options?.trigger) {
    const t = ast.options.trigger;
    const parts: string[] = [];
    if (t.event) parts.push(`event="${t.event}"`);
    if (t.cron) parts.push(`cron="${t.cron}"`);
    if (parts.length > 0) lines.push(` * @trigger ${parts.join(' ')}`);
  }
  // @http round-trip
  for (const r of ast.options?.http ?? []) lines.push(` * @http ${httpRouteText(r)}`);
  // @cancelOn round-trip
  if (ast.options?.cancelOn) {
    const c = ast.options.cancelOn;
    let line = ` * @cancelOn event="${c.event}"`;
    if (c.match) line += ` match="${c.match}"`;
    if (c.timeout) line += ` timeout="${c.timeout}"`;
    lines.push(line);
  }
  // @retries round-trip
  if (ast.options?.retries !== undefined) {
    lines.push(` * @retries ${ast.options.retries}`);
  }
  // @timeout round-trip
  if (ast.options?.timeout) {
    lines.push(` * @timeout "${ast.options.timeout}"`);
  }
  // @throttle round-trip
  if (ast.options?.throttle) {
    const t = ast.options.throttle;
    let line = ` * @throttle limit=${t.limit}`;
    if (t.period) line += ` period="${t.period}"`;
    lines.push(line);
  }
  // Pack-namespace annotations round-trip. Emission is symmetric
  // with parsing: each pack registers a serializer for its deploy namespace,
  // so whatever tags it learns to parse it also re-emits — no core changes.
  lines.push(...serializePackDeployAnnotations(ast.options?.deploy));
  // Add name if different from function name
  if (ast.name && ast.name !== ast.functionName) {
    lines.push(` * @name ${ast.name}`);
  }

  // Add npm package imports (external node types with importSource)
  // Format: @fwImport nodeName functionName from "packageName"
  // This persists npm node types so they survive file re-parsing
  const npmNodeTypes = ast.nodeTypes.filter((nt) => nt.importSource);
  const seenImportNames = new Set<string>();
  for (const npmType of npmNodeTypes) {
    if (seenImportNames.has(npmType.name)) continue;
    seenImportNames.add(npmType.name);
    lines.push(` * @fwImport ${npmType.name} ${fwImportFunctionName(npmType)} from "${npmType.importSource}"`);
  }

  // Add node instances — skip synthetic MAP_ITERATOR/COERCION instances, strip parent from macro children.
  for (const instance of ast.instances) {
    if (macroInstanceIds.has(instance.id)) continue;
    if (allCoerceInstanceIds.has(instance.id)) continue;

    const inst = instance;

    if (macroChildIds.has(inst.id) && inst.parent) {
      // Write child @node without parent scope — @map handles it
      const stripped = { ...inst, parent: undefined };
      lines.push(generateNodeInstanceTag(stripped));
    } else {
      lines.push(generateNodeInstanceTag(inst));
    }
  }

  // Connections derived from [expr:] references are implied by the expression
  // on the @node line: never written as @connect, no part in @path detection.
  const authoredConnections = ast.connections.filter((conn) => !conn.derived);

  // Filter stale macros (e.g. paths whose connections were deleted)
  const existingMacros = filterStaleMacros(
    ast.macros || [],
    authoredConnections,
    ast.instances,
    ast.nodeTypes,
    ast.startPorts,
    ast.exitPorts,
  );

  // Compute dropped coerce instance IDs — their synthetic instances and connections must be excluded
  const survivingCoerceIds = new Set<string>();
  for (const macro of existingMacros) {
    if (macro.type === 'coerce') survivingCoerceIds.add(macro.instanceId);
  }
  const droppedCoerceIds = new Set<string>();
  for (const id of allCoerceInstanceIds) {
    if (!survivingCoerceIds.has(id)) droppedCoerceIds.add(id);
  }

  // Auto-detect @path sugar patterns from connections
  const detected = detectSugarPatterns(
    authoredConnections,
    ast.instances,
    existingMacros,
    ast.nodeTypes,
    ast.startPorts,
    ast.exitPorts,
  );

  // Merge detected macros with existing ones
  const allMacros: TWorkflowMacro[] = [
    ...existingMacros,
    ...detected.paths,
  ];

  // Add @map and @path macros
  if (allMacros.length > 0) {
    for (const macro of allMacros) {
      if (macro.type === 'map') {
        let mapLine = ` * @map ${macro.instanceId} ${macro.childId}`;
        if (macro.inputPort || macro.outputPort) {
          mapLine += `(${macro.inputPort} -> ${macro.outputPort})`;
        }
        mapLine += ` over ${macro.sourcePort}`;
        lines.push(mapLine);
      } else if (macro.type === 'path') {
        const stepsStr = macro.steps.map(s => s.route ? `${s.node}:${s.route}` : s.node).join(' -> ');
        lines.push(` * @path ${stepsStr}`);
      } else if (macro.type === 'fanOut') {
        const src = `${macro.source.node}.${macro.source.port}`;
        const tgts = macro.targets.map(t => t.port ? `${t.node}.${t.port}` : t.node).join(', ');
        lines.push(` * @fanOut ${src} -> ${tgts}`);
      } else if (macro.type === 'fanIn') {
        const srcs = macro.sources.map(s => s.port ? `${s.node}.${s.port}` : s.node).join(', ');
        const tgt = `${macro.target.node}.${macro.target.port}`;
        lines.push(` * @fanIn ${srcs} -> ${tgt}`);
      }
    }
  }

  // Add connections (with scope suffix when present)
  // Skip connections covered by macros, autoConnect-generated connections, and dropped coerce connections
  if (!ast.options?.autoConnect) {
    for (const conn of authoredConnections) {
      if (allMacros.length > 0 && isConnectionCoveredByMacro(conn, allMacros)) continue;
      if (droppedCoerceIds.has(conn.from.node) || droppedCoerceIds.has(conn.to.node)) continue;
      const fromScope = conn.from.scope ? `:${conn.from.scope}` : '';
      const toScope = conn.to.scope ? `:${conn.to.scope}` : '';
      lines.push(
        ` * @connect ${conn.from.node}.${conn.from.port}${fromScope} -> ${conn.to.node}.${conn.to.port}${toScope}`
      );
    }
  }

  // Add @param annotations for start ports (workflow inputs)
  if (!options.skipParamReturns && ast.startPorts && Object.keys(ast.startPorts).length > 0) {
    for (const { name, port, writeOrder } of planPortTags(Object.entries(ast.startPorts))) {
      const paramTag = generateJSDocPortTag(name, port, 'input', undefined, { writeOrder });
      // Replace @input with @param for workflow-level JSDoc
      lines.push(` * ${paramTag.replace('@input', '@param')}`);
    }
  }

  // Add @returns annotations for exit ports (workflow outputs)
  if (!options.skipParamReturns && ast.exitPorts && Object.keys(ast.exitPorts).length > 0) {
    for (const { name, port, writeOrder } of planPortTags(Object.entries(ast.exitPorts))) {
      const returnTag = generateJSDocPortTag(name, port, 'output', undefined, { writeOrder });
      // Replace @output with @returns for workflow-level JSDoc
      lines.push(` * ${returnTag.replace('@output', '@returns')}`);
    }
  }

  // Add scopes — skip scopes covered by @map macros
  if (ast.scopes) {
    for (const [scopeName, children] of Object.entries(ast.scopes)) {
      if (macroScopeNames.has(scopeName)) continue;
      lines.push(` * @scope ${scopeName} [${children.join(', ')}]`);
    }
  }

  lines.push(' */');

  return lines.join('\n');
}
