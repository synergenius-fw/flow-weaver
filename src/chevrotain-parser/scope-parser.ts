/**
 * @module chevrotain-parser/scope-parser
 *
 * Parser for @scope declarations using Chevrotain.
 */

import { CstParser, type CstNode } from 'chevrotain';
import {
  JSDocLexer,
  ScopeTag,
  Identifier,
  Dot,
  LBracket,
  RBracket,
  Comma,
  allTokens,
} from './tokens';

// =============================================================================
// Parser Result Types
// =============================================================================

export interface ScopeParseResult {
  scopeName: string;
  children: string[];
}

// =============================================================================
// Parser Definition
// =============================================================================

class ScopeParser extends CstParser {
  constructor() {
    super(allTokens);
    this.performSelfAnalysis();
  }

  // Entry rule for scope line: @scope scopeName [child1, child2]
  // or @scope container.scopeName [child1, child2]
  public scopeLine = this.RULE('scopeLine', () => {
    this.CONSUME(ScopeTag);
    this.SUBRULE(this.scopeRef);
    this.CONSUME(LBracket);
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => {
        this.CONSUME(Identifier, { LABEL: 'childId' });
      },
    });
    this.CONSUME(RBracket);
  });

  // scopeName or container.scopeName
  private scopeRef = this.RULE('scopeRef', () => {
    this.CONSUME(Identifier, { LABEL: 'firstPart' });
    this.OPTION(() => {
      this.CONSUME(Dot);
      this.CONSUME2(Identifier, { LABEL: 'secondPart' });
    });
  });
}

// =============================================================================
// Parser Instance (singleton)
// =============================================================================

const parserInstance = new ScopeParser();

// =============================================================================
// CST Visitor
// =============================================================================

const BaseVisitor = parserInstance.getBaseCstVisitorConstructor();

interface CstNodeWithImage {
  image: string;
}

interface ScopeLineContext {
  scopeRef: CstNode[];
  childId: CstNodeWithImage[];
}

interface ScopeRefContext {
  firstPart: CstNodeWithImage[];
  secondPart?: CstNodeWithImage[];
}

class ScopeVisitor extends BaseVisitor {
  constructor() {
    super();
    this.validateVisitor();
  }

  scopeLine(ctx: ScopeLineContext): ScopeParseResult {
    const scopeName = this.visit(ctx.scopeRef);
    const children = ctx.childId.map((token: CstNodeWithImage) => token.image);
    return { scopeName, children };
  }

  scopeRef(ctx: ScopeRefContext): string {
    const firstPart = ctx.firstPart[0].image;
    if (ctx.secondPart) {
      const secondPart = ctx.secondPart[0].image;
      return `${firstPart}.${secondPart}`;
    }
    return firstPart;
  }
}

const visitorInstance = new ScopeVisitor();

// =============================================================================
// Public API
// =============================================================================

/**
 * Parse a @scope line and return structured result.
 * Returns null if the line is not a scope declaration.
 */
export function parseScopeLine(input: string, warnings: string[]): ScopeParseResult | null {
  const lexResult = JSDocLexer.tokenize(input);

  if (lexResult.errors.length > 0) {
    return null;
  }

  if (lexResult.tokens.length === 0) {
    return null;
  }

  const firstToken = lexResult.tokens[0];
  if (firstToken.tokenType !== ScopeTag) {
    return null;
  }

  parserInstance.input = lexResult.tokens;
  const cst = parserInstance.scopeLine();

  if (parserInstance.errors.length > 0) {
    const firstError = parserInstance.errors[0];
    const truncatedInput = input.length > 60 ? input.substring(0, 60) + '...' : input;
    warnings.push(
      `Failed to parse scope line: "${truncatedInput}"\n` +
        `  Error: ${firstError.message}\n` +
        `  Expected format: @scope scopeName [child1, child2]`
    );
    return null;
  }

  return visitorInstance.visit(cst);
}

/**
 * Get serialized grammar for documentation/diagram generation.
 */
export function getScopeGrammar() {
  return parserInstance.getSerializedGastProductions();
}
