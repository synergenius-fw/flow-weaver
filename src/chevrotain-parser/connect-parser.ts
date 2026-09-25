/**
 * @module chevrotain-parser/connect-parser
 *
 * Parser for @connect declarations using Chevrotain.
 */

import { CstParser, type CstNode } from 'chevrotain';
import { ConnectTag, Identifier, Arrow, Dot, Colon, AsKeyword, allTokens } from './tokens';
import { lexTaggedLine, lineFailure, runRule, type CstNodeWithImage } from './parse-line';
import type { TCoerceTargetType } from '../ast/types';

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
  /** Explicit type coercion (from `as <type>` suffix) */
  coerce?: TCoerceTargetType;
  /** Set when `as <type>` uses an unrecognized type (cleared after warning is emitted) */
  invalidCoerceType?: string;
}

// =============================================================================
// Parser Definition
// =============================================================================

class ConnectParser extends CstParser {
  constructor() {
    super(allTokens);
    this.performSelfAnalysis();
  }

  // Entry rule for connect line: @connect A.port -> B.port [as type]
  public connectLine = this.RULE('connectLine', () => {
    this.CONSUME(ConnectTag);
    this.SUBRULE(this.portRef, { LABEL: 'sourceRef' });
    this.CONSUME(Arrow);
    this.SUBRULE2(this.portRef, { LABEL: 'targetRef' });
    this.OPTION(() => {
      this.CONSUME(AsKeyword);
      this.CONSUME(Identifier, { LABEL: 'coerceType' });
    });
  });

  // node.port, node.port:scope, or pseudo-node (secret:NAME)
  private portRef = this.RULE('portRef', () => {
    this.CONSUME(Identifier, { LABEL: 'nodeId' });
    this.OR([
      {
        ALT: () => {
          this.CONSUME(Dot);
          this.CONSUME2(Identifier, { LABEL: 'portName' });
          this.OPTION(() => {
            this.CONSUME(Colon);
            this.CONSUME3(Identifier, { LABEL: 'scopeName' });
          });
        },
      },
      {
        // pseudo-node: secret:NAME (nodeId="secret", colon, pseudoName="NAME")
        ALT: () => {
          this.CONSUME2(Colon, { LABEL: 'pseudoColon' });
          this.CONSUME4(Identifier, { LABEL: 'pseudoName' });
        },
      },
    ]);
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

interface ConnectLineContext {
  sourceRef: CstNode[];
  targetRef: CstNode[];
  coerceType?: CstNodeWithImage[];
}

interface PortRefContext {
  nodeId: CstNodeWithImage[];
  portName?: CstNodeWithImage[];
  scopeName?: CstNodeWithImage[];
  pseudoColon?: CstNodeWithImage[];
  pseudoName?: CstNodeWithImage[];
}

class ConnectVisitor extends BaseVisitor {
  constructor() {
    super();
    this.validateVisitor();
  }

  connectLine(ctx: ConnectLineContext): ConnectParseResult {
    const source = this.visit(ctx.sourceRef);
    const target = this.visit(ctx.targetRef);
    const result: ConnectParseResult = { source, target };
    if (ctx.coerceType?.[0]) {
      const validTypes = new Set(['string', 'number', 'boolean', 'json', 'object']);
      const raw = ctx.coerceType[0].image;
      if (validTypes.has(raw)) {
        result.coerce = raw as TCoerceTargetType;
      } else {
        result.invalidCoerceType = raw;
      }
    }
    return result;
  }

  portRef(ctx: PortRefContext): PortReference {
    const nodeId = ctx.nodeId[0].image;
    // Pseudo-node branch: secret:NAME -> { nodeId: "secret:NAME", portName: "value" }
    if (ctx.pseudoColon) {
      const pseudoName = ctx.pseudoName![0].image;
      return { nodeId: `${nodeId}:${pseudoName}`, portName: 'value' };
    }
    const portName = ctx.portName![0].image;
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
  const tokens = lexTaggedLine(input, ConnectTag);
  if (!tokens) return null;

  const { cst, error } = runRule(parserInstance, tokens, () => parserInstance.connectLine());
  if (error) {
    warnings.push(lineFailure('connect', input, error.message, '@connect sourceNode.port -> targetNode.port'));
    return null;
  }

  const result: ConnectParseResult = visitorInstance.visit(cst);

  if (result.invalidCoerceType) {
    warnings.push(
      `Invalid coerce type "${result.invalidCoerceType}" in @connect. Valid types: string, number, boolean, json, object`
    );
    delete result.invalidCoerceType;
  }

  return result;
}

/**
 * Get serialized grammar for documentation/diagram generation.
 */
export function getConnectGrammar() {
  return parserInstance.getSerializedGastProductions();
}
