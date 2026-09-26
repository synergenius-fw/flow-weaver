/**
 * What type a port gets from the function signature.
 *
 * The signature is the interface: a node type's input is typed by its
 * parameter, its output by the field of its (Promise-unwrapped) return value,
 * and a scoped port by the callback parameter its scope names (a scoped input
 * by a field of the callback's return, a scoped output by one of the
 * callback's parameters). A `[type:X]` modifier only fills in when the
 * signature gives nothing usable, and disagreeing with a usable signature is a
 * warning. Workflow `@param`/`@returns` read the field out of the params or
 * return type text.
 */
import type { Type, Symbol as TsMorphSymbol } from 'ts-morph';
import type { FunctionLike } from '../function-like';
import type { TDataType } from '../../ast/types';
import { inferDataTypeFromTS, isValidPortType } from '../../types/type-mappings';

/**
 * `Promise<T>` becomes `T`; any other type is returned as is. An async node
 * type or callback returns a Promise, and its data ports are the fields of the
 * resolved value, not of the Promise.
 */
export function unwrapPromise(type: Type): Type {
  if (type.getText().startsWith('Promise<')) {
    const typeArgs = type.getTypeArguments();
    if (typeArgs.length > 0) {
      return typeArgs[0];
    }
  }
  return type;
}

/**
 * Get a callback type's call signatures deterministically.
 *
 * ts-morph 28 / TypeScript 6 lazily initializes the type checker. On a "cold"
 * checker (the first complex inference after a fresh/reset ts-morph Project),
 * `Type.getCallSignatures()` for a function-typed parameter NON-DETERMINISTICALLY
 * returns an empty array even though the type genuinely has a call signature.
 * That made scoped-port inference (which reads the callback's signature to derive
 * port types) flake: the port came out with no `tsType`. A test-only checker
 * warmup masked it unreliably. This is the real fix.
 *
 * Force the checker to materialize the signatures: if the direct call returns
 * none, retry via the APPARENT type (`getApparentType()` drives the checker to
 * resolve the type's structure), then via the type's symbol declaration's type
 * (re-resolving from the declaration forces a full type computation). Returns the
 * first non-empty signature list, or an empty array only when the type truly has
 * no call signature.
 */
function resolveCallSignatures(callbackType: Type): ReturnType<Type['getCallSignatures']> {
  let sigs = callbackType.getCallSignatures();
  if (sigs.length > 0) return sigs;

  // Retry 1: apparent type forces the checker to resolve the type's structure.
  try {
    sigs = callbackType.getApparentType().getCallSignatures();
    if (sigs.length > 0) return sigs;
  } catch {
    // getApparentType can throw on exotic types. Fall through to the next retry.
  }

  // Retry 2: re-resolve the type from its symbol's declaration. Reading the
  // declaration's type recomputes it through the (now-touched) checker, which
  // reliably materializes call signatures the cold first pass missed.
  try {
    const symbol = callbackType.getSymbol() ?? callbackType.getAliasSymbol();
    const decl = symbol?.getDeclarations()?.[0];
    if (decl) {
      sigs = decl.getType().getCallSignatures();
      if (sigs.length > 0) return sigs;
    }
  } catch {
    // Best-effort. Fall through.
  }

  return sigs;
}

/**
 * Extract the type of a field from a callback's return type using ts-morph Type API.
 *
 * For scoped INPUT ports, we need to find the return type of the callback and extract
 * the type of a specific field from that return type object.
 *
 * @param callbackType - The Type of the callback parameter
 * @param fieldName - The name of the field to extract from the return type
 * @returns The TypeScript type string, or undefined if extraction fails
 */
function extractCallbackReturnFieldType(callbackType: Type, fieldName: string): string | undefined {
  // Get call signatures from the callback type (cold-checker-safe).
  const callSignatures = resolveCallSignatures(callbackType);
  if (callSignatures.length === 0) {
    return undefined;
  }

  // Use the first call signature (callbacks typically have one); an async
  // callback returns Promise<{...}>, so read the resolved value's fields.
  const returnType = unwrapPromise(callSignatures[0].getReturnType());

  // Get the property from the return type
  const property = returnType.getProperty(fieldName);
  if (!property) {
    return undefined;
  }

  // Get the type of the property
  const propertyType = getPropertyType(property, returnType);
  if (!propertyType) {
    return undefined;
  }

  // Get the type text - use getText() which handles complex types properly
  // Pass undefined to avoid import path expansion
  return propertyType.getText(undefined, 0);
}

/**
 * Get the type of a property Symbol.
 */
export function getPropertyType(property: TsMorphSymbol, containerType: Type): Type | undefined {
  // Try to get the type via getTypeAtLocation on the value declaration
  const valueDecl = property.getValueDeclaration();
  if (valueDecl) {
    return valueDecl.getType();
  }

  // Fallback: get the declared type from the container
  const declaredType = containerType.getPropertyOrThrow(property.getName());
  if (declaredType) {
    // This returns a Symbol, get its type via declarations
    const decls = declaredType.getDeclarations();
    if (decls.length > 0) {
      return decls[0].getType();
    }
  }

  return undefined;
}

/**
 * Extract the type of a parameter from a callback's parameter list using ts-morph Type API.
 *
 * For scoped OUTPUT ports, we need to find the parameters of the callback and extract
 * the type of a specific parameter by name.
 *
 * @param callbackType - The Type of the callback parameter
 * @param paramName - The name of the parameter to extract
 * @returns The TypeScript type string, or undefined if extraction fails
 */
function extractCallbackParamType(callbackType: Type, paramName: string): string | undefined {
  // Get call signatures from the callback type (cold-checker-safe).
  const callSignatures = resolveCallSignatures(callbackType);
  if (callSignatures.length === 0) {
    return undefined;
  }

  // Use the first call signature
  const parameters = callSignatures[0].getParameters();

  // Find the parameter by name
  for (const param of parameters) {
    if (param.getName() === paramName) {
      const valueDecl = param.getValueDeclaration();
      if (valueDecl) {
        const paramType = valueDecl.getType();
        return paramType.getText(undefined, 0);
      }
    }
  }

  return undefined;
}

/**
 * Type a scoped port from the callback parameter its scope names. A scoped
 * INPUT port is a field of the callback's return value; a scoped OUTPUT port
 * is one of the callback's parameters. The ts-morph Type API reads both, so
 * generics and nested objects work. A missing callback or field is a warning
 * and the port is ANY.
 */
export function typeScopedPort(
  direction: 'INPUT' | 'OUTPUT',
  name: string,
  scope: string,
  func: FunctionLike,
  warnings: string[],
): { type: TDataType; tsType?: string } {
  const nodeTypeName = func.getName() || 'unknown';
  const scopeParam = func.getParameters().find((p) => p.getName() === scope);
  if (!scopeParam) {
    const callbackShape =
      direction === 'INPUT' ? `(...) => { ${name}: YourType }` : `(${name}: YourType, ...) => { ... }`;
    warnings.push(
      `Scoped ${direction} port '${name}' references scope '${scope}', but no callback parameter named '${scope}' was found ` +
        `in node type '${nodeTypeName}'. Add a callback parameter: ${scope}: ${callbackShape}`
    );
    return { type: 'ANY' };
  }

  const extract = direction === 'INPUT' ? extractCallbackReturnFieldType : extractCallbackParamType;
  const tsType = extract(scopeParam.getType(), name);
  if (tsType) return { type: inferDataTypeFromTS(tsType), tsType };

  const expectation =
    direction === 'INPUT' ? `should have a return type that includes '${name}'` : `should have a parameter named '${name}'`;
  warnings.push(
    `Cannot infer type for scoped ${direction} port '${name}' in scope '${scope}' of node type '${nodeTypeName}'. ` +
      `The callback parameter '${scope}' ${expectation}. ` +
      `Consider adding an explicit type annotation to the callback signature.`
  );
  return { type: 'ANY' };
}

/**
 * Reconcile a `[type:X]` modifier with the type inferred from the signature.
 *
 * The signature is the interface, so when it gives a usable type that type
 * stands and a disagreeing modifier is a warning. When the signature gives
 * nothing usable (no matching parameter or return field, or `any`), the
 * modifier is the only type information there is and it is honoured.
 * A modifier that is not a port type is a warning and ignored.
 */
export function applyDeclaredType(
  direction: 'input' | 'output',
  name: string,
  declared: string | undefined,
  inferred: TDataType,
  tsType: string | undefined,
  func: FunctionLike,
  warnings: string[],
): TDataType {
  if (!declared) return inferred;
  const nodeTypeName = func.getName() || 'unknown';
  if (!isValidPortType(declared)) {
    warnings.push(
      `@${direction} ${name} in node type '${nodeTypeName}' declares [type:${declared}], which is not a port type. ` +
        `Use one of STRING, NUMBER, BOOLEAN, ARRAY, OBJECT, FUNCTION, ANY or STEP.`
    );
    return inferred;
  }
  if (inferred === 'ANY') return declared;
  if (declared !== inferred && declared !== 'ANY') {
    warnings.push(
      `@${direction} ${name} in node type '${nodeTypeName}' declares [type:${declared}] but the signature ` +
        `gives ${inferred}${tsType ? ` (${tsType})` : ''}. The signature type is used; change one to match.`
    );
  }
  return inferred;
}

/**
 * The `name: type` field of an object type's text, with the type as group 1.
 * Anchored at a field boundary so `id` does not match inside `valid: boolean`.
 */
export function objectFieldPattern(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[{;,\\s])${escaped}\\??\\s*:\\s*([^;},]+)`);
}
