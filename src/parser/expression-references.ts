/**
 * Upstream references inside `[expr: port="..."]` bindings.
 *
 * An expression may name `Start.<param>` or `<instanceId>.<outputPort>`,
 * with any further property access after the port (`Start.expense.id`).
 * Each reference is a data dependency of the bound port on that upstream
 * port. The parser turns it into a connection flagged `derived`, so every
 * consumer of `workflow.connections` (ordering, cycle detection, queries,
 * the editor, the durable graph) sees the edge without knowing about
 * expressions; the generator fetches the referenced values and substitutes
 * them into the expression before evaluating it.
 *
 * What counts as a reference is decided syntactically, with the TypeScript
 * parser rather than a regex, so text inside string literals is never
 * mistaken for one and `${Start.path}` inside a template literal is:
 *
 * - the expression is parsed as TypeScript; only a property access whose
 *   object is a bare identifier is a candidate (`a.b`, not `f().b` or
 *   `x[0].b`), and only dot access is recognised, not `Start["path"]`
 * - the identifier must be `Start` or an instance id of this workflow, and
 *   the property must be a declared data port of it
 * - an identifier that is also a module-level binding of the file (an
 *   import, a const, a class) is ambiguous when its property is a port, and
 *   is left as plain JavaScript otherwise. Node type functions do not count
 *   as shadowing bindings: `@node route route` is the common naming style
 *   and `route.risk` on a function is never what an author means
 *
 * Anything that is not a reference is plain JavaScript, exactly as before.
 */

import * as ts from 'typescript';
import type {
  TConnectionAST,
  TNodeInstanceAST,
  TNodeTypeAST,
  TPortDefinition,
} from '../ast/types';
import { isControlFlowPort } from '../constants';

export interface ExpressionReference {
  /** `Start` or an instance id */
  root: string;
  /** The port read on the root */
  port: string;
  /** Character offsets of the `root.port` text inside the expression */
  start: number;
  end: number;
}

/**
 * Every `identifier.property` access in an expression whose identifier is one
 * of the candidates. Nested access (`Start.expense.id`) yields one reference
 * for `Start.expense`; the trailing `.id` stays in the expression text.
 */
export function findExpressionReferences(expression: string, candidates: ReadonlySet<string>): ExpressionReference[] {
  // Wrap in parentheses so an object literal parses as an expression, not a block
  const wrapped = `(${expression})`;
  const sourceFile = ts.createSourceFile('expr.ts', wrapped, ts.ScriptTarget.Latest, true);
  const refs: ExpressionReference[] = [];

  const visit = (node: ts.Node, locals: ReadonlySet<string>): void => {
    // A function or arrow inside the expression introduces its own names;
    // a parameter named like a candidate shadows it inside that body.
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      const inner = new Set(locals);
      for (const param of node.parameters) {
        if (ts.isIdentifier(param.name)) inner.add(param.name.text);
      }
      ts.forEachChild(node, (child) => visit(child, inner));
      return;
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const root = node.expression.text;
      if (candidates.has(root) && !locals.has(root)) {
        refs.push({
          root,
          port: node.name.text,
          start: node.expression.getStart(sourceFile) - 1,
          end: node.name.getEnd() - 1,
        });
      }
      // The children are the identifier and the name: nothing more to find here
      return;
    }
    ts.forEachChild(node, (child) => visit(child, locals));
  };
  visit(sourceFile, new Set());
  return refs;
}

/**
 * Replace each reference's `root.port` text with the value `replacement`
 * returns for it. Offsets are applied from the end so earlier ones stay valid.
 */
export function rewriteExpressionReferences(
  expression: string,
  refs: readonly ExpressionReference[],
  replacement: (ref: ExpressionReference) => string,
): string {
  let out = expression;
  for (const ref of [...refs].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, ref.start) + replacement(ref) + out.slice(ref.end);
  }
  return out;
}

export interface ExpandExpressionReferencesInput {
  instances: TNodeInstanceAST[];
  connections: TConnectionAST[];
  findNodeType: (name: string) => TNodeTypeAST | undefined;
  startPorts: Record<string, TPortDefinition>;
  /** Top-level bindings of the file that are not node type functions */
  moduleBindings: ReadonlySet<string>;
  errors: string[];
}

/**
 * Resolve every reference in every instance expression and append one
 * derived connection per distinct (source port, target port) pair. Problems
 * are reported as parse errors, phrased like the `@path` errors: the
 * instance and port they concern come first.
 */
export function expandExpressionReferences(input: ExpandExpressionReferencesInput): void {
  const { instances, connections, findNodeType, startPorts, moduleBindings, errors } = input;
  const instanceById = new Map(instances.map((inst) => [inst.id, inst]));
  const candidates = new Set<string>(['Start', ...instanceById.keys()]);

  const outputsOf = (instanceId: string): Record<string, TPortDefinition> => {
    if (instanceId === 'Start') return startPorts;
    const inst = instanceById.get(instanceId);
    const nodeType = inst ? findNodeType(inst.nodeType) : undefined;
    return nodeType?.outputs ?? {};
  };

  const existing = new Set(
    connections.map((c) => `${c.from.node}.${c.from.port}${c.from.scope ?? ''}->${c.to.node}.${c.to.port}${c.to.scope ?? ''}`),
  );

  for (const instance of instances) {
    const portConfigs = instance.config?.portConfigs ?? [];
    for (const portConfig of portConfigs) {
      if (portConfig.expression === undefined) continue;
      if (portConfig.direction === 'OUTPUT') continue;
      const expression = String(portConfig.expression);
      const where = `[expr] ${instance.id}.${portConfig.portName}`;

      for (const ref of findExpressionReferences(expression, candidates)) {
        const outputs = outputsOf(ref.root);
        const isPort = ref.port in outputs && !isControlFlowPort(ref.port);
        const shadows = ref.root !== 'Start' && moduleBindings.has(ref.root);

        if (shadows) {
          if (isPort) {
            errors.push(
              `${where}: "${ref.root}.${ref.port}" is ambiguous. "${ref.root}" is both a node in this workflow and a top-level binding of this file. Rename one of them, or read the binding through a helper.`,
            );
          }
          // A shadowing binding whose property is not a port: plain JavaScript
          continue;
        }

        if (ref.root === instance.id) {
          errors.push(`${where}: an expression cannot reference its own node ("${ref.root}.${ref.port}").`);
          continue;
        }
        if (isControlFlowPort(ref.port)) {
          errors.push(
            `${where}: "${ref.root}.${ref.port}" is a control port. Expressions can only reference data ports.`,
          );
          continue;
        }
        if (!isPort) {
          const available = Object.keys(outputs).filter((p) => !isControlFlowPort(p));
          const what = ref.root === 'Start' ? 'a workflow param' : `an output of "${ref.root}"`;
          errors.push(
            `${where}: "${ref.root}.${ref.port}" is not ${what}. Available: ${available.length ? available.join(', ') : 'none'}.`,
          );
          continue;
        }
        const source = instanceById.get(ref.root);
        if (instance.parent || source?.parent) {
          errors.push(
            `${where}: "${ref.root}.${ref.port}" crosses a scope boundary. Expression references are only supported between top-level nodes; use @connect with a scope qualifier instead.`,
          );
          continue;
        }

        const key = `${ref.root}.${ref.port}->${instance.id}.${portConfig.portName}`;
        if (existing.has(key)) continue;
        existing.add(key);
        connections.push({
          type: 'Connection',
          from: { node: ref.root, port: ref.port },
          to: { node: instance.id, port: portConfig.portName },
          derived: { kind: 'expression', expression },
        });
      }
    }
  }
}

/**
 * Names declared at the top level of a source file that could be read by a
 * bare identifier inside an expression: imports, variables, functions,
 * classes and enums. Node type functions are excluded on purpose; see the
 * module comment.
 */
export function collectModuleBindings(
  sourceFile: {
    getImportDeclarations(): Array<{
      getDefaultImport(): { getText(): string } | undefined;
      getNamespaceImport(): { getText(): string } | undefined;
      getNamedImports(): Array<{ getAliasNode(): { getText(): string } | undefined; getName(): string }>;
    }>;
    getVariableDeclarations(): Array<{ getName(): string }>;
    getFunctions(): Array<{ getName(): string | undefined }>;
    getClasses(): Array<{ getName(): string | undefined }>;
    getEnums(): Array<{ getName(): string }>;
  },
  nodeTypeFunctionNames: ReadonlySet<string>,
): Set<string> {
  const names = new Set<string>();
  for (const decl of sourceFile.getImportDeclarations()) {
    const def = decl.getDefaultImport();
    if (def) names.add(def.getText());
    const ns = decl.getNamespaceImport();
    if (ns) names.add(ns.getText());
    for (const named of decl.getNamedImports()) {
      names.add(named.getAliasNode()?.getText() ?? named.getName());
    }
  }
  for (const v of sourceFile.getVariableDeclarations()) names.add(v.getName());
  for (const f of sourceFile.getFunctions()) {
    const name = f.getName();
    if (name) names.add(name);
  }
  for (const c of sourceFile.getClasses()) {
    const name = c.getName();
    if (name) names.add(name);
  }
  for (const e of sourceFile.getEnums()) names.add(e.getName());
  for (const fn of nodeTypeFunctionNames) names.delete(fn);
  return names;
}
