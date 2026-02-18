/**
 * @module chevrotain-parser/position-parser
 *
 * Parser for @position declarations using Chevrotain.
 */

import { CstParser } from 'chevrotain';
import { JSDocLexer, PositionTag, Identifier, Integer, allTokens } from './tokens';

// =============================================================================
// Parser Result Types
// =============================================================================

export interface PositionParseResult {
  nodeId: string;
  x: number;
  y: number;
}

// =============================================================================
// Parser Definition
// =============================================================================

class PositionParser extends CstParser {
  constructor() {
    super(allTokens);
    this.performSelfAnalysis();
  }

  // Entry rule for position line
  public positionLine = this.RULE('positionLine', () => {
    this.CONSUME(PositionTag);
    this.CONSUME(Identifier, { LABEL: 'nodeId' });
    this.CONSUME(Integer, { LABEL: 'xCoord' });
    this.CONSUME2(Integer, { LABEL: 'yCoord' });
  });
}

// =============================================================================
// Parser Instance (singleton)
// =============================================================================

const parserInstance = new PositionParser();

// =============================================================================
// CST Visitor
// =============================================================================

const BaseVisitor = parserInstance.getBaseCstVisitorConstructor();

interface CstNodeWithImage {
  image: string;
}

interface PositionLineContext {
  nodeId: CstNodeWithImage[];
  xCoord: CstNodeWithImage[];
  yCoord: CstNodeWithImage[];
}

class PositionVisitor extends BaseVisitor {
  constructor() {
    super();
    this.validateVisitor();
  }

  positionLine(ctx: PositionLineContext): PositionParseResult {
    const nodeId = ctx.nodeId[0].image;
    const x = parseInt(ctx.xCoord[0].image, 10);
    const y = parseInt(ctx.yCoord[0].image, 10);
    return { nodeId, x, y };
  }
}

const visitorInstance = new PositionVisitor();

// =============================================================================
// Public API
// =============================================================================

/**
 * Parse a @position line and return structured result.
 * Returns null if the line is not a position declaration.
 */
export function parsePositionLine(input: string, warnings: string[]): PositionParseResult | null {
  const lexResult = JSDocLexer.tokenize(input);

  if (lexResult.errors.length > 0) {
    return null;
  }

  // Check if starts with @position
  if (lexResult.tokens.length === 0) {
    return null;
  }

  const firstToken = lexResult.tokens[0];
  if (firstToken.tokenType !== PositionTag) {
    return null;
  }

  parserInstance.input = lexResult.tokens;
  const cst = parserInstance.positionLine();

  if (parserInstance.errors.length > 0) {
    const firstError = parserInstance.errors[0];
    const truncatedInput = input.length > 60 ? input.substring(0, 60) + '...' : input;
    warnings.push(
      `Failed to parse position line: "${truncatedInput}"\n` +
        `  Error: ${firstError.message}\n` +
        `  Expected format: @position nodeId x y`
    );
    return null;
  }

  return visitorInstance.visit(cst);
}

/**
 * Get serialized grammar for documentation/diagram generation.
 */
export function getPositionGrammar() {
  return parserInstance.getSerializedGastProductions();
}
