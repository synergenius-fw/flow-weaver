/**
 * FunctionLike interface
 *
 * Abstracts over FunctionDeclaration and arrow/function-expression variable
 * declarations so the JSDoc parser and annotation parser can handle both
 * syntactic forms uniformly.
 */

import {
  type SourceFile,
  type FunctionDeclaration,
  type ArrowFunction,
  type FunctionExpression,
  type JSDoc,
  type ParameterDeclaration,
  type Type,
  Node,
  SyntaxKind,
  VariableDeclarationKind,
} from 'ts-morph';

/**
 * Minimal interface that both FunctionDeclaration and our arrow-function
 * adapter satisfy.  Every method used by jsdoc-parser and parser is listed here.
 */
export interface FunctionLike {
  getJsDocs(): JSDoc[];
  getName(): string | undefined;
  isAsync(): boolean;
  getParameters(): ParameterDeclaration[];
  getReturnType(): Type;
  getStartLineNumber(includeJsDocComments?: boolean): number;
  getText(includeJsDocComments?: boolean): string;
  getSourceFile(): SourceFile;
  /** For arrow/function-expression declarations, returns 'const', 'let', or 'var'. Undefined for FunctionDeclaration. */
  getDeclarationKind?(): 'const' | 'let' | 'var' | undefined;
  /** Returns the underlying ts-morph Node for type resolution (e.g., Symbol.getTypeAtLocation). */
  getTypeResolutionNode(): Node;
}

function wrapFunctionDeclaration(fn: FunctionDeclaration): FunctionLike {
  return {
    getJsDocs: () => fn.getJsDocs(),
    getName: () => fn.getName(),
    isAsync: () => fn.isAsync(),
    getParameters: () => fn.getParameters(),
    getReturnType: () => fn.getReturnType(),
    getStartLineNumber: (inc?: boolean) => fn.getStartLineNumber(inc),
    getText: (inc?: boolean) => fn.getText(inc),
    getSourceFile: () => fn.getSourceFile(),
    getTypeResolutionNode: () => fn,
  };
}

/**
 * Scan a source file and return every function-like declaration that could
 * carry @flowWeaver annotations:
 *
 *  1. Classic `function foo() {}`         — FunctionDeclaration (existing)
 *  2. `const foo = () => {}`              — ArrowFunction assigned to variable
 *  3. `const foo = function() {}`         — FunctionExpression assigned to variable
 *
 * The returned list preserves source order.
 */
export function extractFunctionLikes(sourceFile: SourceFile): FunctionLike[] {
  const results: FunctionLike[] = [];

  // 1. Regular function declarations — wrapped to satisfy getTypeResolutionNode()
  for (const fn of sourceFile.getFunctions()) {
    results.push(wrapFunctionDeclaration(fn));
  }

  // 2. Variable declarations with arrow/function expression initializers
  for (const varDecl of sourceFile.getVariableDeclarations()) {
    const initializer = varDecl.getInitializer();
    if (!initializer) continue;

    const kind = initializer.getKind();
    if (kind !== SyntaxKind.ArrowFunction && kind !== SyntaxKind.FunctionExpression) continue;

    const fnExpr = initializer as ArrowFunction | FunctionExpression;

    // Walk up: VariableDeclaration -> VariableDeclarationList -> VariableStatement
    const varDeclList = varDecl.getParent();
    if (!Node.isVariableDeclarationList(varDeclList)) continue;
    const varStatement = varDeclList.getParent();
    if (!Node.isVariableStatement(varStatement)) continue;

    // Determine declaration kind (const/let/var)
    const declKindEnum = varDeclList.getDeclarationKind();
    const declKind: 'const' | 'let' | 'var' =
      declKindEnum === VariableDeclarationKind.Let
        ? 'let'
        : declKindEnum === VariableDeclarationKind.Var
          ? 'var'
          : 'const';

    const adapter: FunctionLike = {
      getName: () => varDecl.getName(),

      getJsDocs: () => varStatement.getJsDocs(),

      isAsync: () => fnExpr.isAsync(),

      getParameters: () => fnExpr.getParameters(),

      getReturnType: () => fnExpr.getReturnType(),

      getStartLineNumber: () => varStatement.getStartLineNumber(false),

      getText: () => {
        // Return the variable statement text without JSDoc (consistent with FunctionDeclaration.getText()).
        // The parser code manually prepends JSDoc via getJsDocs().
        return varStatement.getText(false);
      },

      getSourceFile: () => sourceFile,

      getDeclarationKind: () => declKind,

      getTypeResolutionNode: () => varDecl,
    };

    results.push(adapter);
  }

  // Sort by source position to preserve declaration order
  results.sort((a, b) => a.getStartLineNumber(false) - b.getStartLineNumber(false));

  return results;
}
