/**
 * @module chevrotain-parser/fan-parser
 *
 * Parser for @fanOut and @fanIn sugar annotations using Chevrotain.
 *
 * Syntax:
 *   @fanOut Start.data -> a, b, c
 *   @fanOut Start.data -> a.input1, b.input2
 *   @fanIn a.result, b.result, c.result -> merge.inputs
 *   @fanIn a, b, c -> merge.data
 */

import { CstParser } from 'chevrotain';
import {
  JSDocLexer,
  FanOutTag,
  FanInTag,
  Identifier,
  Arrow,
  Dot,
  Comma,
  allTokens,
} from './tokens';

// =============================================================================
// Parser Result Types
// =============================================================================

export interface PortRef {
  node: string;
  port?: string;
}

export interface FanOutParseResult {
  source: PortRef;
  targets: PortRef[];
}

export interface FanInParseResult {
  sources: PortRef[];
  target: PortRef;
}

// =============================================================================
// Parser Definition
// =============================================================================

class FanParser extends CstParser {
  constructor() {
    super(allTokens);
    this.performSelfAnalysis();
  }

  // @fanOut portRef Arrow portRef (Comma portRef)*
  public fanOutLine = this.RULE('fanOutLine', () => {
    this.CONSUME(FanOutTag);
    this.SUBRULE(this.portRef, { LABEL: 'source' });
    this.CONSUME(Arrow);
    this.SUBRULE2(this.portRef, { LABEL: 'firstTarget' });
    this.MANY(() => {
      this.CONSUME(Comma);
      this.SUBRULE3(this.portRef, { LABEL: 'moreTargets' });
    });
  });

  // @fanIn portRef (Comma portRef)* Arrow portRef
  // Note: Because we can't look ahead past the comma-list to the arrow,
  // we parse as: @fanIn portRefList Arrow portRef
  // The last element after Arrow is the target; everything before is sources.
  public fanInLine = this.RULE('fanInLine', () => {
    this.CONSUME(FanInTag);
    this.SUBRULE(this.portRef, { LABEL: 'firstSource' });
    this.MANY(() => {
      this.CONSUME(Comma);
      this.SUBRULE2(this.portRef, { LABEL: 'moreSources' });
    });
    this.CONSUME(Arrow);
    this.SUBRULE3(this.portRef, { LABEL: 'target' });
  });

  // portRef: Identifier (Dot Identifier)?
  public portRef = this.RULE('portRef', () => {
    this.CONSUME(Identifier, { LABEL: 'nodeName' });
    this.OPTION(() => {
      this.CONSUME(Dot);
      this.CONSUME2(Identifier, { LABEL: 'portName' });
    });
  });
}

// =============================================================================
// Parser Instance (singleton)
// =============================================================================

const parserInstance = new FanParser();

// =============================================================================
// CST Visitor
// =============================================================================

const BaseVisitor = parserInstance.getBaseCstVisitorConstructor();

interface CstNodeWithImage {
  image: string;
}

interface PortRefContext {
  nodeName: CstNodeWithImage[];
  portName?: CstNodeWithImage[];
}

interface FanOutLineContext {
  source: { children: PortRefContext }[];
  firstTarget: { children: PortRefContext }[];
  moreTargets?: { children: PortRefContext }[];
}

interface FanInLineContext {
  firstSource: { children: PortRefContext }[];
  moreSources?: { children: PortRefContext }[];
  target: { children: PortRefContext }[];
}

class FanVisitor extends BaseVisitor {
  constructor() {
    super();
    this.validateVisitor();
  }

  fanOutLine(ctx: FanOutLineContext): FanOutParseResult {
    const source = this.portRef(ctx.source[0].children);
    const targets: PortRef[] = [];

    targets.push(this.portRef(ctx.firstTarget[0].children));
    if (ctx.moreTargets) {
      for (const t of ctx.moreTargets) {
        targets.push(this.portRef(t.children));
      }
    }

    return { source, targets };
  }

  fanInLine(ctx: FanInLineContext): FanInParseResult {
    const sources: PortRef[] = [];
    sources.push(this.portRef(ctx.firstSource[0].children));
    if (ctx.moreSources) {
      for (const s of ctx.moreSources) {
        sources.push(this.portRef(s.children));
      }
    }

    const target = this.portRef(ctx.target[0].children);
    return { sources, target };
  }

  portRef(ctx: PortRefContext): PortRef {
    const node = ctx.nodeName[0].image;
    const port = ctx.portName?.[0]?.image;
    return port ? { node, port } : { node };
  }
}

const visitorInstance = new FanVisitor();

// =============================================================================
// Public API
// =============================================================================

/**
 * Parse a @fanOut line and return structured result.
 * Returns null if the line is not a valid @fanOut declaration.
 */
export function parseFanOutLine(input: string, warnings: string[]): FanOutParseResult | null {
  const lexResult = JSDocLexer.tokenize(input);
  if (lexResult.errors.length > 0 || lexResult.tokens.length === 0) return null;
  if (lexResult.tokens[0].tokenType !== FanOutTag) return null;

  parserInstance.input = lexResult.tokens;
  const cst = parserInstance.fanOutLine();

  if (parserInstance.errors.length > 0) {
    const truncatedInput = input.length > 80 ? input.substring(0, 80) + '...' : input;
    warnings.push(
      `Failed to parse @fanOut line: "${truncatedInput}"\n` +
        `  Error: ${parserInstance.errors[0].message}\n` +
        `  Expected format: @fanOut source.port -> target1, target2, target3`
    );
    return null;
  }

  return visitorInstance.visit(cst);
}

/**
 * Parse a @fanIn line and return structured result.
 * Returns null if the line is not a valid @fanIn declaration.
 */
export function parseFanInLine(input: string, warnings: string[]): FanInParseResult | null {
  const lexResult = JSDocLexer.tokenize(input);
  if (lexResult.errors.length > 0 || lexResult.tokens.length === 0) return null;
  if (lexResult.tokens[0].tokenType !== FanInTag) return null;

  parserInstance.input = lexResult.tokens;
  const cst = parserInstance.fanInLine();

  if (parserInstance.errors.length > 0) {
    const truncatedInput = input.length > 80 ? input.substring(0, 80) + '...' : input;
    warnings.push(
      `Failed to parse @fanIn line: "${truncatedInput}"\n` +
        `  Error: ${parserInstance.errors[0].message}\n` +
        `  Expected format: @fanIn source1.port, source2.port -> target.port`
    );
    return null;
  }

  return visitorInstance.visit(cst);
}

/**
 * Get serialized grammar for documentation/diagram generation.
 */
export function getFanGrammar() {
  return parserInstance.getSerializedGastProductions();
}
