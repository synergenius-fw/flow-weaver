import ts from 'typescript';
import type { ParseResult } from '../api/parse.js';
import type { TNodeTypeAST } from '../ast/types.js';
import { validateDurableClosure } from '../api/durable-validation.js';

type ReturnBinding = Readonly<{
  kind: 'object' | 'call';
  callee?: string;
  operationKeyIndex?: number;
  resultIndex?: number;
  resultKeys: readonly string[];
}>;

type EffectProof = Readonly<{
  functionName: string;
  inputs: readonly string[];
  outputs: readonly string[];
  binding: ReturnBinding;
}>;

const authenticProofs = new WeakSet<DurableSourceProof>();

/** Compiler-owned evidence that durable effects passed typed validation before erasure. */
export class DurableSourceProof {
  readonly effects: readonly EffectProof[];

  private constructor(effects: readonly EffectProof[]) {
    this.effects = Object.freeze(effects.map((effect) => Object.freeze(effect)));
    authenticProofs.add(this);
    Object.freeze(this);
  }

  static create(parsed: ParseResult, source: string): DurableSourceProof {
    validateDurableClosure(parsed.ast, parsed.allWorkflows);
    const effects = durableEffects(parsed).map((effect) => ({
      functionName: effect.functionName,
      inputs: Object.freeze(Object.keys(effect.inputs).sort()),
      outputs: Object.freeze(Object.keys(effect.outputs).sort()),
      binding: effectReturnBinding(source, effect.functionName, Object.keys(effect.outputs)),
    }));
    return new DurableSourceProof(effects);
  }
}

export function applyDurableSourceProof(
  proof: DurableSourceProof,
  parsed: ParseResult,
  flattenedSource: string,
): void {
  if (!authenticProofs.has(proof)) throw new Error('durable source proof was not issued by this compiler');
  const actual = durableEffects(parsed);
  const actualNames = actual.map((effect) => effect.functionName).sort();
  const expectedNames = proof.effects.map((effect) => effect.functionName).sort();
  if (actualNames.join(',') !== expectedNames.join(',')) {
    throw new Error(`flattened durable effect set differs from typed source: expected ${expectedNames.join(', ')}, got ${actualNames.join(', ')}`);
  }
  for (const expected of proof.effects) {
    const effect = actual.find((candidate) => candidate.functionName === expected.functionName);
    if (!effect) throw new Error(`flattened source lost durable effect ${expected.functionName}`);
    const inputs = Object.keys(effect.inputs).sort();
    const outputs = Object.keys(effect.outputs).sort();
    if (inputs.join(',') !== expected.inputs.join(',') || outputs.join(',') !== expected.outputs.join(',')) {
      throw new Error(`flattened durable effect ${expected.functionName} ports differ from typed source`);
    }
    const binding = effectReturnBinding(flattenedSource, effect.functionName, outputs);
    if (JSON.stringify(binding) !== JSON.stringify(expected.binding)) {
      throw new Error(`flattened durable effect ${expected.functionName} return binding differs from typed source`);
    }
    effect.durableEffectContract = { valid: true, diagnostics: [] };
  }
}

function durableEffects(parsed: ParseResult): TNodeTypeAST[] {
  const byName = new Map<string, TNodeTypeAST>();
  for (const workflow of parsed.allWorkflows) {
    for (const nodeType of workflow.nodeTypes) {
      if (nodeType.durableEffect === true) byName.set(nodeType.functionName, nodeType);
    }
  }
  for (const nodeType of parsed.ast.nodeTypes) {
    if (nodeType.durableEffect === true) byName.set(nodeType.functionName, nodeType);
  }
  return [...byName.values()].sort((left, right) => left.functionName.localeCompare(right.functionName));
}

function effectReturnBinding(
  source: string,
  functionName: string,
  outputNames: readonly string[],
): ReturnBinding {
  const file = ts.createSourceFile('durable-source.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const fn = file.statements.find((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === functionName);
  if (!fn?.body) throw new Error(`durable effect ${functionName} has no concrete function body`);
  const operationKey = fn.parameters.at(-1)?.name;
  if (!operationKey || !ts.isIdentifier(operationKey)) {
    throw new Error(`durable effect ${functionName} has no identifier operation key parameter`);
  }
  const returns: ts.ReturnStatement[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== fn && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node)) returns.push(node);
    ts.forEachChild(node, visit);
  };
  visit(fn.body);
  if (returns.length === 0) throw new Error(`durable effect ${functionName} has no return path`);
  const bindings = returns.map((statement) => bindingForExpression(
    statement.expression,
    operationKey.text,
    outputNames,
    functionName,
  ));
  const first = bindings[0];
  if (bindings.some((binding) => JSON.stringify(binding) !== JSON.stringify(first))) {
    throw new Error(`durable effect ${functionName} has inconsistent return bindings`);
  }
  return first;
}

function bindingForExpression(
  expression: ts.Expression | undefined,
  operationKey: string,
  outputNames: readonly string[],
  functionName: string,
): ReturnBinding {
  if (expression && ts.isObjectLiteralExpression(expression)) {
    const envelope = objectProperties(expression, `${functionName} return envelope`);
    if ([...envelope.keys()].sort().join(',') !== 'receipt,result') {
      throw new Error(`durable effect ${functionName} must return exactly receipt and result`);
    }
    const receipt = envelope.get('receipt');
    const result = envelope.get('result');
    if (!receipt || !ts.isObjectLiteralExpression(receipt) || !result || !ts.isObjectLiteralExpression(result)) {
      throw new Error(`durable effect ${functionName} direct return must contain receipt/result object literals`);
    }
    const receiptProperties = objectProperties(receipt, `${functionName} receipt`);
    const key = receiptProperties.get('operationKey');
    if (!key || !ts.isIdentifier(key) || key.text !== operationKey) {
      throw new Error(`durable effect ${functionName} receipt is not bound to operationKey`);
    }
    const resultKeys = [...objectProperties(result, `${functionName} result`).keys()].sort();
    assertResultKeys(functionName, resultKeys, outputNames);
    return Object.freeze({ kind: 'object', resultKeys: Object.freeze(resultKeys) });
  }
  if (expression && ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)) {
    const operationKeyIndex = expression.arguments.findIndex(
      (argument) => ts.isIdentifier(argument) && argument.text === operationKey,
    );
    const resultIndex = expression.arguments.findIndex((argument) => {
      if (!ts.isObjectLiteralExpression(argument)) return false;
      const keys = [...objectProperties(argument, `${functionName} result argument`).keys()].sort();
      return keys.join(',') === [...outputNames].sort().join(',');
    });
    if (operationKeyIndex < 0 || resultIndex < 0) {
      throw new Error(`durable effect ${functionName} helper call is not bound to operationKey and exact result fields`);
    }
    const result = expression.arguments[resultIndex] as ts.ObjectLiteralExpression;
    const resultKeys = [...objectProperties(result, `${functionName} result argument`).keys()].sort();
    return Object.freeze({
      kind: 'call',
      callee: expression.expression.text,
      operationKeyIndex,
      resultIndex,
      resultKeys: Object.freeze(resultKeys),
    });
  }
  throw new Error(`durable effect ${functionName} return path is not a canonical envelope`);
}

function objectProperties(
  object: ts.ObjectLiteralExpression,
  label: string,
): Map<string, ts.Expression> {
  const properties = new Map<string, ts.Expression>();
  for (const property of object.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      properties.set(property.name.text, property.name);
      continue;
    }
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) {
      throw new Error(`${label} must use explicit identifier properties without spreads`);
    }
    properties.set(property.name.text, property.initializer);
  }
  return properties;
}

function assertResultKeys(
  functionName: string,
  actual: readonly string[],
  expected: readonly string[],
): void {
  if ([...actual].sort().join(',') !== [...expected].sort().join(',')) {
    throw new Error(`durable effect ${functionName} result fields differ from declared outputs`);
  }
}
