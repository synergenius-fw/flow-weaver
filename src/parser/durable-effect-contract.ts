import type { Type } from 'ts-morph';
import type { TDataType, TNodeTypeAST } from '../ast/types';
import type { FunctionLike } from '../function-like';

export interface DurableEffectContractAnalysis {
  readonly valid: boolean;
  readonly diagnostics: string[];
}

export function jsDocTagComment(
  fn: FunctionLike,
  tagName: string,
): string | undefined {
  for (const doc of fn.getJsDocs()) {
    for (const tag of doc.getTags()) {
      if (tag.getTagName() === tagName) {
        return tag.getCommentText?.()?.trim() ?? '';
      }
    }
  }
  return undefined;
}

export function hasJsDocTag(fn: FunctionLike, tagName: string): boolean {
  return jsDocTagComment(fn, tagName) !== undefined;
}

export function durableGateKind(
  fn: FunctionLike,
): 'approval' | 'input' | 'agent' | 'timer' | undefined {
  const kind = jsDocTagComment(fn, 'durableGate')?.split(/\s+/)[0];
  return kind === 'approval' || kind === 'input' || kind === 'agent' || kind === 'timer'
    ? kind
    : undefined;
}

function describeType(type: Type, fn: FunctionLike): string {
  return type.getText(fn.getTypeResolutionNode());
}

function nonUndefinedUnionMembers(type: Type): Type[] {
  const members = type.isUnion() ? type.getUnionTypes() : [type];
  return members.filter((member) => !member.isUndefined());
}

function wireTypeFailure(
  type: Type,
  path = '$',
  seen = new Set<unknown>(),
): string | undefined {
  // Recursive JSON aliases revisit the union itself before reaching an object
  // member. Fence the exact compiler type before decomposing unions/arrays so
  // a valid recursive wire type terminates, while the first visit still checks
  // every reachable member for unsafe values.
  const identity = type.compilerType;
  if (seen.has(identity)) return undefined;
  seen.add(identity);

  const members = nonUndefinedUnionMembers(type);
  if (members.length === 0) return `${path} has no defined member`;
  if (members.length > 1 || type.isUnion()) {
    for (const member of members) {
      const failure = wireTypeFailure(member, path, new Set(seen));
      if (failure !== undefined) return failure;
    }
    return undefined;
  }

  const candidate = members[0];
  if (
    candidate.isAny() ||
    candidate.isUnknown() ||
    candidate.isNever() ||
    candidate.isVoid() ||
    candidate.isBigInt() ||
    candidate.isBigIntLiteral()
  ) {
    return `${path} is ${candidate.getText()}`;
  }
  if (
    candidate.isNull() ||
    candidate.isString() ||
    candidate.isStringLiteral() ||
    candidate.isNumber() ||
    candidate.isNumberLiteral() ||
    candidate.isBoolean() ||
    candidate.isBooleanLiteral() ||
    candidate.isTemplateLiteral()
  ) {
    return undefined;
  }
  if (candidate.isTuple()) {
    for (const [index, element] of candidate.getTupleElements().entries()) {
      const failure = wireTypeFailure(element, `${path}[${index}]`, new Set(seen));
      if (failure !== undefined) return failure;
    }
    return undefined;
  }
  if (candidate.isArray() || candidate.isReadonlyArray()) {
    const element = candidate.getArrayElementType();
    return element === undefined
      ? `${path} has no array element type`
      : wireTypeFailure(element, `${path}[]`, new Set(seen));
  }
  if (!candidate.isObject() || candidate.isClass()) return `${path} is not a plain object`;
  if (
    candidate.getCallSignatures().length > 0 ||
    candidate.getConstructSignatures().length > 0
  ) {
    return `${path} is callable or constructable`;
  }

  const indexTypes = [
    candidate.getStringIndexType(),
    candidate.getNumberIndexType(),
  ].filter((indexType): indexType is Type => indexType !== undefined);
  for (const indexType of indexTypes) {
    const failure = wireTypeFailure(indexType, `${path}[key]`, new Set(seen));
    if (failure !== undefined) return failure;
  }
  for (const property of candidate.getProperties()) {
    const location = property.getValueDeclaration() ?? property.getDeclarations()[0];
    if (location === undefined) return `${path}.${property.getName()} has no declaration`;
    const failure = wireTypeFailure(
      property.getTypeAtLocation(location),
      `${path}.${property.getName()}`,
      new Set(seen),
    );
    if (failure !== undefined) return failure;
  }
  return undefined;
}

function matchesPortType(type: Type, dataType: TDataType): boolean {
  const members = nonUndefinedUnionMembers(type);
  if (members.length === 0) return false;
  return members.every((member) => {
    switch (dataType) {
      case 'STRING':
        return (
          member.isString() || member.isStringLiteral() || member.isTemplateLiteral()
        );
      case 'NUMBER':
        return member.isNumber() || member.isNumberLiteral();
      case 'BOOLEAN':
      case 'STEP':
        return member.isBoolean() || member.isBooleanLiteral();
      case 'ARRAY':
        return member.isArray() || member.isReadonlyArray() || member.isTuple();
      case 'OBJECT':
        return member.isObject() && !member.isArray() && !member.isReadonlyArray();
      case 'FUNCTION':
        return member.getCallSignatures().length > 0;
      case 'ANY':
        return true;
    }
  });
}

function validateEnvelopeMember(
  envelope: Type,
  outputs: TNodeTypeAST['outputs'],
  fn: FunctionLike,
): string[] {
  const diagnostics: string[] = [];
  if (!envelope.isObject() || envelope.isArray() || envelope.isReadonlyArray()) {
    return [
      `return type must be exactly { receipt, result }, got ${describeType(envelope, fn)}`,
    ];
  }
  if (envelope.getStringIndexType() || envelope.getNumberIndexType()) {
    diagnostics.push('return envelope must not declare an index signature');
  }

  const envelopeProperties = envelope.getProperties();
  const envelopeNames = envelopeProperties.map((property) => property.getName()).sort();
  if (envelopeNames.join(',') !== 'receipt,result') {
    diagnostics.push(
      `return envelope must have exactly the required receipt and result fields. Found ${envelopeNames.join(', ') || 'none'}`,
    );
  }
  const receiptProperty = envelope.getProperty('receipt');
  const resultProperty = envelope.getProperty('result');
  if (receiptProperty?.isOptional()) diagnostics.push('receipt must be required');
  if (resultProperty?.isOptional()) diagnostics.push('result must be required');

  const location = fn.getTypeResolutionNode();
  if (receiptProperty) {
    const receiptType = receiptProperty.getTypeAtLocation(location);
    const failure = wireTypeFailure(receiptType);
    if (failure !== undefined) {
      diagnostics.push(
        `receipt must be a durable wire value, got ${describeType(receiptType, fn)} (${failure})`,
      );
    }
  }
  if (!resultProperty) {
    const expectedNames = Object.entries(outputs)
      .filter(([, output]) => output.scope === undefined)
      .map(([name]) => name)
      .sort();
    const plainResultNames = envelopeProperties
      .map((property) => property.getName())
      .sort();
    const missing = expectedNames.filter((name) => !plainResultNames.includes(name));
    const extra = plainResultNames.filter((name) => !expectedNames.includes(name));
    diagnostics.push(
      [
        'result fields must exactly match the node outputs',
        missing.length > 0 ? `missing ${missing.join(', ')}` : undefined,
        extra.length > 0 ? `unexpected ${extra.join(', ')}` : undefined,
      ].filter(Boolean).join('; '),
    );
    return diagnostics;
  }

  const resultType = resultProperty.getTypeAtLocation(location);
  if (!resultType.isObject() || resultType.isArray() || resultType.isReadonlyArray()) {
    diagnostics.push(
      `result must be an object matching the node outputs, got ${describeType(resultType, fn)}`,
    );
    return diagnostics;
  }
  const resultFailure = wireTypeFailure(resultType);
  if (resultFailure !== undefined) {
    diagnostics.push(
      `result must be a durable wire value, got ${describeType(resultType, fn)} (${resultFailure})`,
    );
  }

  const expectedNames = Object.entries(outputs)
    .filter(([, output]) => output.scope === undefined)
    .map(([name]) => name)
    .sort();
  const actualNames = resultType
    .getProperties()
    .map((property) => property.getName())
    .sort();
  if (actualNames.join(',') !== expectedNames.join(',')) {
    const missing = expectedNames.filter((name) => !actualNames.includes(name));
    const extra = actualNames.filter((name) => !expectedNames.includes(name));
    diagnostics.push(
      [
        'result fields must exactly match the node outputs',
        missing.length > 0 ? `missing ${missing.join(', ')}` : undefined,
        extra.length > 0 ? `unexpected ${extra.join(', ')}` : undefined,
      ].filter(Boolean).join('; '),
    );
  }
  for (const [name, output] of Object.entries(outputs)) {
    if (output.scope !== undefined) continue;
    const property = resultType.getProperty(name);
    if (!property) continue;
    if (property.isOptional()) {
      diagnostics.push(`result.${name} must be required`);
      continue;
    }
    const propertyType = property.getTypeAtLocation(location);
    if (!matchesPortType(propertyType, output.dataType)) {
      diagnostics.push(
        `result.${name} is ${describeType(propertyType, fn)}, incompatible with ${output.dataType}`,
      );
    }
  }
  return diagnostics;
}

export function analyzeDurableEffectContract(
  fn: FunctionLike,
  inputs: TNodeTypeAST['inputs'],
  outputs: TNodeTypeAST['outputs'],
): DurableEffectContractAnalysis {
  const diagnostics: string[] = [];
  const parameters = fn.getParameters();
  const operationKey = parameters.at(-1);
  if (!operationKey) {
    diagnostics.push('callable must accept a required final operationKey: string parameter');
  } else {
    if (
      operationKey.isOptional() ||
      operationKey.hasInitializer() ||
      operationKey.isRestParameter()
    ) {
      diagnostics.push('final operationKey parameter must be required and non-rest');
    }
    const operationKeyType = operationKey.getType();
    if (!operationKeyType.isString() || operationKeyType.isStringLiteral()) {
      diagnostics.push(
        `final operationKey parameter must be string, got ${describeType(operationKeyType, fn)}`,
      );
    }
    if (Object.hasOwn(inputs, operationKey.getName())) {
      diagnostics.push(
        'callable must accept an injected final operationKey: string after every declared node input',
      );
    }
  }

  const declaredReturn = fn.getReturnType();
  const resolvedReturn = declaredReturn.getAwaitedType() ?? declaredReturn;
  const returnMembers = resolvedReturn.isUnion()
    ? resolvedReturn.getUnionTypes()
    : [resolvedReturn];
  for (const returnMember of returnMembers) {
    diagnostics.push(...validateEnvelopeMember(returnMember, outputs, fn));
  }
  return { valid: diagnostics.length === 0, diagnostics };
}
