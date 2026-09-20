/**
 * Field schemas from TypeScript types, so the console can render a form for
 * a workflow's params and a gate's answer instead of a JSON box.
 *
 * A port's `tsType` is a string like `PageRequest`, and only the type checker
 * can say what that is. ts-morph resolves it here, depth-limited, into a small
 * schema the client understands.
 */
import * as fs from 'node:fs';
import { Project, type SourceFile, type Type } from 'ts-morph';

export type FieldSchema =
  | { type: 'string'; optional?: boolean }
  | { type: 'number'; optional?: boolean }
  | { type: 'boolean'; optional?: boolean }
  | { type: 'enum'; values: Array<string | number>; optional?: boolean }
  | { type: 'array'; items: FieldSchema; optional?: boolean; text?: string }
  | { type: 'object'; fields?: Record<string, FieldSchema>; text?: string; optional?: boolean }
  | { type: 'any'; text?: string; optional?: boolean };

const MAX_DEPTH = 4;

let project: Project | undefined;
const loaded = new Map<string, number>();

function source(file: string): SourceFile {
  project ??= new Project({ compilerOptions: { strict: true, skipLibCheck: true }, skipAddingFilesFromTsConfig: true });
  const mtime = fs.statSync(file).mtimeMs;
  const existing = project.getSourceFile(file);
  if (existing && loaded.get(file) === mtime) return existing;
  if (existing) existing.refreshFromFileSystemSync();
  const sf = existing ?? project.addSourceFileAtPath(file);
  loaded.set(file, mtime);
  return sf;
}

function toSchema(t: Type, depth = 0): FieldSchema {
  if (depth > MAX_DEPTH) return { type: 'any', text: t.getText() };
  if (t.isBoolean()) return { type: 'boolean' };
  if (t.isUnion()) {
    const parts = t.getUnionTypes();
    const real = parts.filter((p) => !p.isNull() && !p.isUndefined());
    const optional = real.length !== parts.length;
    if (real.length && real.every((p) => p.isBooleanLiteral())) return { type: 'boolean', optional };
    if (real.length && real.every((p) => p.isStringLiteral() || p.isNumberLiteral()))
      return { type: 'enum', values: real.map((p) => p.getLiteralValue() as string | number), optional };
    if (real.length === 1) return { ...toSchema(real[0], depth), optional };
    return { type: 'any', text: t.getText(), optional };
  }
  if (t.isString()) return { type: 'string' };
  if (t.isNumber()) return { type: 'number' };
  if (t.isStringLiteral() || t.isNumberLiteral()) return { type: 'enum', values: [t.getLiteralValue() as string | number] };
  if (t.isArray()) return { type: 'array', items: toSchema(t.getArrayElementTypeOrThrow(), depth + 1), text: t.getText() };
  if (t.isObject()) {
    const props = t.getProperties();
    // Record<string, X> and friends declare no properties: free-form.
    if (!props.length || t.getStringIndexType()) return { type: 'object', text: t.getText() };
    const fields: Record<string, FieldSchema> = {};
    for (const p of props) {
      const decl = p.getDeclarations()[0];
      const s = decl ? toSchema(p.getTypeAtLocation(decl), depth + 1) : ({ type: 'any' } as FieldSchema);
      fields[p.getName()] = { ...s, optional: s.optional || p.isOptional() };
    }
    return { type: 'object', fields, text: t.getText() };
  }
  return { type: 'any', text: t.getText() };
}

/**
 * The shape of each data output of a gate node.
 *
 * An authored gate declares it in its own return type. A built-in gate
 * (`waitForEvent`, `waitForAgent`) has no source, so the schema is taken
 * from the parameter that consumes the output downstream. Without that, the
 * caller falls back to a free-form value.
 */
export function gateOutputSchemas(
  ast: { instances: Array<{ id: string; nodeType: string }>; nodeTypes: Array<{ name: string; functionName: string; functionText?: string; sourceLocation?: { file?: string } }>; connections: Array<{ from: { node: string; port: string }; to: { node: string; port: string } }> },
  gateId: string,
  fallbackFile: string,
): Record<string, FieldSchema> | null {
  const typeOf = (id: string) => {
    const inst = ast.instances.find((i) => i.id === id);
    return inst ? ast.nodeTypes.find((n) => n.name === inst.nodeType) ?? ast.nodeTypes.find((n) => n.functionName === inst.nodeType) : undefined;
  };
  const nt = typeOf(gateId);
  const nodeFile = nt?.sourceLocation?.file ?? fallbackFile;
  if (nt?.functionText) {
    const own = nodeOutputSchema(nodeFile, nt.functionName);
    if (own && Object.keys(own).length) return own;
  }
  const control = new Set(['execute', 'onSuccess', 'onFailure']);
  const out: Record<string, FieldSchema> = {};
  for (const conn of ast.connections) {
    // `onSuccess`/`onFailure` are filled in by `buildGateResolution`. A
    // control port wired onward must never become an answer field.
    if (conn.from.node !== gateId || control.has(conn.from.port)) continue;
    const targetType = typeOf(conn.to.node);
    if (!targetType?.functionText) continue;
    const schema = nodeInputSchema(targetType.sourceLocation?.file ?? fallbackFile, targetType.functionName, conn.to.port);
    if (schema) out[conn.from.port] = schema;
  }
  return Object.keys(out).length ? out : null;
}

/** The `params` object of a workflow function: one schema per declared Start port. */
export function workflowParamsSchema(file: string, fnName: string): Record<string, FieldSchema> | null {
  try {
    const params = source(file).getFunction(fnName)?.getParameters()[1]?.getType();
    if (!params) return null;
    const s = toSchema(params);
    return s.type === 'object' && s.fields ? s.fields : null;
  } catch {
    return null;
  }
}

/**
 * The schema of one parameter of a node function.
 *
 * A built-in gate (`waitForEvent`, `waitForAgent`) has no source of its own,
 * so its output shape cannot be read from a return type. Whatever consumes
 * that output downstream does declare it (`plan.agentResult` flows into
 * `checkPlan(plan: Plan)`), so the consumer's parameter is the schema.
 */
export function nodeInputSchema(file: string, fnName: string, paramName: string): FieldSchema | null {
  try {
    const fn = source(file).getFunction(fnName);
    if (!fn) return null;
    const params = fn.getParameters();
    // Normal-mode nodes take `execute` first. Either way, match by name.
    const param = params.find((p) => p.getName() === paramName);
    if (!param) return null;
    const s = toSchema(param.getType());
    return { ...s, optional: s.optional || param.hasQuestionToken() };
  } catch {
    return null;
  }
}

/** Data outputs of a node function's return type, control ports dropped. */
export function nodeOutputSchema(file: string, fnName: string): Record<string, FieldSchema> | null {
  try {
    const fn = source(file).getFunction(fnName);
    if (!fn) return null;
    let ret = fn.getReturnType();
    if (ret.getSymbol()?.getName() === 'Promise') ret = ret.getTypeArguments()[0];
    const s = toSchema(ret);
    if (s.type !== 'object' || !s.fields) return null;
    const { onSuccess: _s, onFailure: _f, ...data } = s.fields;
    return data;
  } catch {
    return null;
  }
}
