/**
 * @module chevrotain-parser/connect-parser
 *
 * Parser for @connect declarations using Chevrotain.
 */

import { CstParser, type CstNode } from 'chevrotain';
import { JSDocLexer, ConnectTag, Identifier, Arrow, Dot, Colon, allTokens } from './tokens';

// =============================================================================
// Parser Result Types
// =============================================================================

export interface PortReference {
  nodeId: string;
  portName: string;
  scope?: string;
}

export interface ConnectParseResult {
  source: PortReference;
  target: PortReference;
}

// =============================================================================
// Parser Definition
// =============================================================================

class ConnectParser extends CstParser {
  constructor() {
    super(allTokens);
    this.performSelfAnalysis();
  }

  // Entry rule for connect line
  public connectLine = this.RULE('connectLine', () => {
    this.CONSUME(ConnectTag);
    this.SUBRULE(this.portRef, { LABEL: 'sourceRef' });
    this.CONSUME(Arrow);
    this.SUBRULE2(this.portRef, { LABEL: 'targetRef' });
  });

  // node.port or node.port:scope
  private portRef = this.RULE('portRef', () => {
    this.CONSUME(Identifier, { LABEL: 'nodeId' });
    this.CONSUME(Dot);
    this.CONSUME2(Identifier, { LABEL: 'portName' });
    this.OPTION(() => {
      this.CONSUME(Colon);
      this.CONSUME3(Identifier, { LABEL: 'scopeName' });
    });
  });
}

// =============================================================================
// Parser Instance (singleton)
// =============================================================================

const parserInstance = new ConnectParser();

// =============================================================================
// CST Visitor
// =============================================================================

const BaseVisitor = parserInstance.getBaseCstVisitorConstructor();

// CST Context types for the visitor
interface CstNodeWithImage {
  image: string;
}

interface ConnectLineContext {
  sourceRef: CstNode[];
  targetRef: CstNode[];
}

interface PortRefContext {
  nodeId: CstNodeWithImage[];
  portName: CstNodeWithImage[];
  scopeName?: CstNodeWithImage[];
}

class ConnectVisitor extends BaseVisitor {
  constructor() {
    super();
    this.validateVisitor();
  }

  connectLine(ctx: ConnectLineContext): ConnectParseResult {
    const source = this.visit(ctx.sourceRef);
    const target = this.visit(ctx.targetRef);
    return { source, target };
  }

  portRef(ctx: PortRefContext): PortReference {
    const nodeId = ctx.nodeId[0].image;
    const portName = ctx.portName[0].image;
    const scope = ctx.scopeName?.[0]?.image;
    return { nodeId, portName, scope };
  }
}

const visitorInstance = new ConnectVisitor();

// =============================================================================
// Public API
// =============================================================================

/**
 * Parse a @connect line and return structured result.
 * Returns null if the line is not a connect declaration.
 */
export function parseConnectLine(input: string, warnings: string[]): ConnectParseResult | null {
  const lexResult = JSDocLexer.tokenize(input);

  if (lexResult.errors.length > 0) {
    return null;
  }

  // Check if starts with @connect
  if (lexResult.tokens.length === 0) {
    return null;
  }

  const firstToken = lexResult.tokens[0];
  if (firstToken.tokenType !== ConnectTag) {
    return null;
  }

  parserInstance.input = lexResult.tokens;
  const cst = parserInstance.connectLine();

  if (parserInstance.errors.length > 0) {
    const firstError = parserInstance.errors[0];
    const truncatedInput = input.length > 60 ? input.substring(0, 60) + '...' : input;
    warnings.push(
      `Failed to parse connect line: "${truncatedInput}"\n` +
        `  Error: ${firstError.message}\n` +
        `  Expected format: @connect sourceNode.port -> targetNode.port`
    );
    return null;
  }

  return visitorInstance.visit(cst);
}

/**
 * Get serialized grammar for documentation/diagram generation.
 */
export function getConnectGrammar() {
  return parserInstance.getSerializedGastProductions();
}
