/**
 * @module chevrotain-parser/map-parser
 *
 * Parser for @map sugar annotations using Chevrotain.
 *
 * Syntax:
 *   @map <instanceId> <childNode> over <sourceNode>.<sourcePort>
 *   @map <instanceId> <childNode>(inputPort -> outputPort) over <sourceNode>.<sourcePort>
 */

import { CstParser, type CstNode } from 'chevrotain';
import {
  MapTag,
  OverKeyword,
  Identifier,
  Dot,
  LParen,
  RParen,
  Arrow,
  allTokens,
} from './tokens';
import { lexTaggedLine, lineFailure, runRule, type CstNodeWithImage } from './parse-line';

// =============================================================================
// Parser Result Types
// =============================================================================

export interface MapParseResult {
  /** Instance ID for the synthetic iterator node (e.g., "loop") */
  instanceId: string;
  /** Child node ID to apply to each item (e.g., "proc") */
  childId: string;
  /** Source node for the array (e.g., "scan") */
  sourceNode: string;
  /** Source port for the array (e.g., "files") */
  sourcePort: string;
  /** Explicit input port on child (auto-inferred if omitted) */
  inputPort?: string;
  /** Explicit output port on child (auto-inferred if omitted) */
  outputPort?: string;
}

// =============================================================================
// Parser Definition
// =============================================================================

class MapParser extends CstParser {
  constructor() {
    super(allTokens);
    this.performSelfAnalysis();
  }

  // Entry rule: @map instanceId childNode[(inputPort -> outputPort)] over source.port
  public mapLine = this.RULE('mapLine', () => {
    this.CONSUME(MapTag);
    this.CONSUME(Identifier, { LABEL: 'instanceId' });
    this.CONSUME2(Identifier, { LABEL: 'childId' });
    this.OPTION(() => {
      this.SUBRULE(this.portMapping);
    });
    this.CONSUME(OverKeyword);
    this.SUBRULE(this.portRef);
  });

  // (inputPort -> outputPort)
  private portMapping = this.RULE('portMapping', () => {
    this.CONSUME(LParen);
    this.CONSUME(Identifier, { LABEL: 'inputPort' });
    this.CONSUME(Arrow);
    this.CONSUME2(Identifier, { LABEL: 'outputPort' });
    this.CONSUME(RParen);
  });

  // node.port
  private portRef = this.RULE('portRef', () => {
    this.CONSUME(Identifier, { LABEL: 'sourceNode' });
    this.CONSUME(Dot);
    this.CONSUME2(Identifier, { LABEL: 'sourcePort' });
  });
}

// =============================================================================
// Parser Instance (singleton)
// =============================================================================

const parserInstance = new MapParser();

// =============================================================================
// CST Visitor
// =============================================================================

const BaseVisitor = parserInstance.getBaseCstVisitorConstructor();

interface MapLineContext {
  instanceId: CstNodeWithImage[];
  childId: CstNodeWithImage[];
  portMapping?: CstNode[];
  portRef: CstNode[];
}

interface PortMappingContext {
  inputPort: CstNodeWithImage[];
  outputPort: CstNodeWithImage[];
}

interface PortRefContext {
  sourceNode: CstNodeWithImage[];
  sourcePort: CstNodeWithImage[];
}

class MapVisitor extends BaseVisitor {
  constructor() {
    super();
    this.validateVisitor();
  }

  mapLine(ctx: MapLineContext): MapParseResult {
    const instanceId = ctx.instanceId[0].image;
    const childId = ctx.childId[0].image;
    const portRef = this.visit(ctx.portRef[0]) as { sourceNode: string; sourcePort: string };

    let inputPort: string | undefined;
    let outputPort: string | undefined;
    if (ctx.portMapping) {
      const mapping = this.visit(ctx.portMapping[0]) as {
        inputPort: string;
        outputPort: string;
      };
      inputPort = mapping.inputPort;
      outputPort = mapping.outputPort;
    }

    return {
      instanceId,
      childId,
      sourceNode: portRef.sourceNode,
      sourcePort: portRef.sourcePort,
      ...(inputPort && { inputPort }),
      ...(outputPort && { outputPort }),
    };
  }

  portMapping(ctx: PortMappingContext): { inputPort: string; outputPort: string } {
    return {
      inputPort: ctx.inputPort[0].image,
      outputPort: ctx.outputPort[0].image,
    };
  }

  portRef(ctx: PortRefContext): { sourceNode: string; sourcePort: string } {
    return {
      sourceNode: ctx.sourceNode[0].image,
      sourcePort: ctx.sourcePort[0].image,
    };
  }
}

const visitorInstance = new MapVisitor();

// =============================================================================
// Public API
// =============================================================================

/**
 * Parse a @map line and return structured result.
 * Returns null if the line is not a valid @map declaration.
 */
export function parseMapLine(input: string, warnings: string[]): MapParseResult | null {
  const tokens = lexTaggedLine(input, MapTag);
  if (!tokens) return null;

  const { cst, error } = runRule(parserInstance, tokens, () => parserInstance.mapLine());
  if (error) {
    warnings.push(lineFailure('@map', input, error.message, '@map instanceId childNode over source.port'));
    return null;
  }

  return visitorInstance.visit(cst);
}

/**
 * Get serialized grammar for documentation/diagram generation.
 */
export function getMapGrammar() {
  return parserInstance.getSerializedGastProductions();
}
