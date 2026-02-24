/**
 * @module chevrotain-parser/coerce-parser
 *
 * Parser for @coerce sugar annotation using Chevrotain.
 *
 * Syntax:
 *   @coerce instanceId sourceNode.port -> targetNode.port as targetType
 *
 * Where targetType is one of: string, number, boolean, json, object
 */

import { CstParser } from 'chevrotain';
import {
  JSDocLexer,
  CoerceTag,
  Identifier,
  Arrow,
  Dot,
  AsKeyword,
  allTokens,
} from './tokens';
import type { TCoerceTargetType } from '../ast/types';

// =============================================================================
// Parser Result Types
// =============================================================================

export interface CoerceParseResult {
  instanceId: string;
  source: { node: string; port: string };
  target: { node: string; port: string };
  targetType: TCoerceTargetType;
}

const VALID_COERCE_TYPES = new Set<string>(['string', 'number', 'boolean', 'json', 'object']);

// =============================================================================
// Parser Definition
// =============================================================================

class CoerceParser extends CstParser {
  constructor() {
    super(allTokens);
    this.performSelfAnalysis();
  }

  // @coerce Identifier portRef Arrow portRef AsKeyword Identifier
  public coerceLine = this.RULE('coerceLine', () => {
    this.CONSUME(CoerceTag);
    this.CONSUME(Identifier, { LABEL: 'instanceId' });
    this.SUBRULE(this.portRef, { LABEL: 'source' });
    this.CONSUME(Arrow);
    this.SUBRULE2(this.portRef, { LABEL: 'target' });
    this.CONSUME(AsKeyword);
    this.CONSUME2(Identifier, { LABEL: 'typeName' });
  });

  // portRef: Identifier Dot Identifier
  public portRef = this.RULE('portRef', () => {
    this.CONSUME(Identifier, { LABEL: 'nodeName' });
    this.CONSUME(Dot);
    this.CONSUME2(Identifier, { LABEL: 'portName' });
  });
}

// =============================================================================
// Parser Instance (singleton)
// =============================================================================

const parserInstance = new CoerceParser();

// =============================================================================
// CST Visitor
// =============================================================================

const BaseVisitor = parserInstance.getBaseCstVisitorConstructor();

interface CstNodeWithImage {
  image: string;
}

interface PortRefContext {
  nodeName: CstNodeWithImage[];
  portName: CstNodeWithImage[];
}

interface CoerceLineContext {
  instanceId: CstNodeWithImage[];
  source: { children: PortRefContext }[];
  target: { children: PortRefContext }[];
  typeName: CstNodeWithImage[];
}

class CoerceVisitor extends BaseVisitor {
  constructor() {
    super();
    this.validateVisitor();
  }

  coerceLine(ctx: CoerceLineContext): CoerceParseResult {
    const instanceId = ctx.instanceId[0].image;
    const source = this.portRef(ctx.source[0].children);
    const target = this.portRef(ctx.target[0].children);
    const targetType = ctx.typeName[0].image as TCoerceTargetType;

    return { instanceId, source, target, targetType };
  }

  portRef(ctx: PortRefContext): { node: string; port: string } {
    return {
      node: ctx.nodeName[0].image,
      port: ctx.portName[0].image,
    };
  }
}

const visitorInstance = new CoerceVisitor();

// =============================================================================
// Public API
// =============================================================================

/**
 * Parse a @coerce line and return structured result.
 * Returns null if the line is not a valid @coerce declaration.
 */
export function parseCoerceLine(input: string, warnings: string[]): CoerceParseResult | null {
  const lexResult = JSDocLexer.tokenize(input);
  if (lexResult.errors.length > 0 || lexResult.tokens.length === 0) return null;
  if (lexResult.tokens[0].tokenType !== CoerceTag) return null;

  parserInstance.input = lexResult.tokens;
  const cst = parserInstance.coerceLine();

  if (parserInstance.errors.length > 0) {
    const truncatedInput = input.length > 80 ? input.substring(0, 80) + '...' : input;
    warnings.push(
      `Failed to parse @coerce line: "${truncatedInput}"\n` +
        `  Error: ${parserInstance.errors[0].message}\n` +
        `  Expected format: @coerce instanceId source.port -> target.port as type`
    );
    return null;
  }

  const result = visitorInstance.visit(cst) as CoerceParseResult;

  // Validate the target type
  if (!VALID_COERCE_TYPES.has(result.targetType)) {
    warnings.push(
      `@coerce: invalid target type "${result.targetType}". Valid types: ${[...VALID_COERCE_TYPES].join(', ')}`
    );
    return null;
  }

  return result;
}

/**
 * Get serialized grammar for documentation/diagram generation.
 */
export function getCoerceGrammar() {
  return parserInstance.getSerializedGastProductions();
}
