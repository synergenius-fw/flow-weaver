/**
 * @module chevrotain-parser/port-parser
 *
 * Parser for @input/@output/@step port declarations using Chevrotain.
 */

import { CstParser, type IToken, type CstNode } from 'chevrotain';
import {
  JSDocLexer,
  InputTag,
  OutputTag,
  StepTag,
  Identifier,
  ScopePrefix,
  OrderPrefix,
  PlacementPrefix,
  TypePrefix,
  MergeStrategyPrefix,
  TopKeyword,
  BottomKeyword,
  TrueKeyword,
  FalseKeyword,
  OverKeyword,
  AsKeyword,
  MinimizedKeyword,
  Integer,
  StringLiteral,
  DescriptionText,
  LBracket,
  RBracket,
  LParen,
  RParen,
  Comma,
  Colon,
  Dot,
  Dash,
  Equals,
  GreaterThan,
  LessThan,
  Pipe,
  Ampersand,
  LBrace,
  RBrace,
  Asterisk,
  allTokens,
} from './tokens';

// =============================================================================
// Parser Result Types
// =============================================================================

export interface PortParseResult {
  type: 'input' | 'output' | 'step';
  name: string;
  defaultValue?: string;
  isOptional?: boolean;
  scope?: string;
  order?: number;
  placement?: 'TOP' | 'BOTTOM';
  dataType?: string;
  mergeStrategy?: string;
  description?: string;
}

// =============================================================================
// Parser Definition
// =============================================================================

class PortParser extends CstParser {
  constructor() {
    super(allTokens);
    this.performSelfAnalysis();
  }

  // Entry rule for port line
  public portLine = this.RULE('portLine', () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.inputPort) },
      { ALT: () => this.SUBRULE(this.outputPort) },
      { ALT: () => this.SUBRULE(this.stepPort) },
    ]);
  });

  // @input port: @input name, @input [name], @input [name=default]
  private inputPort = this.RULE('inputPort', () => {
    this.CONSUME(InputTag);
    this.OR([
      {
        ALT: () => {
          // Bracketed format: [name] or [name=default]
          this.CONSUME(LBracket, { LABEL: 'optionalBracket' });
          this.CONSUME(Identifier, { LABEL: 'portName' });
          this.OPTION(() => {
            this.CONSUME(Equals);
            // Default value can be an identifier, integer, or string literal
            this.OR1([
              { ALT: () => this.CONSUME2(Identifier, { LABEL: 'defaultValue' }) },
              { ALT: () => this.CONSUME(Integer, { LABEL: 'defaultValueInt' }) },
              { ALT: () => this.CONSUME(StringLiteral, { LABEL: 'defaultValueStr' }) },
            ]);
          });
          this.CONSUME(RBracket);
        },
      },
      {
        ALT: () => {
          // Plain format: name
          this.CONSUME3(Identifier, { LABEL: 'portName' });
        },
      },
    ]);
    this.OPTION2(() => {
      this.SUBRULE(this.scopeClause);
    });
    this.MANY2(() => {
      this.SUBRULE(this.metadataBracket);
    });
    this.OPTION4(() => {
      this.SUBRULE(this.descriptionClause);
    });
  });

  // @output port
  private outputPort = this.RULE('outputPort', () => {
    this.CONSUME(OutputTag);
    this.CONSUME(Identifier, { LABEL: 'portName' });
    this.OPTION(() => {
      this.SUBRULE(this.scopeClause);
    });
    this.MANY(() => {
      this.SUBRULE(this.metadataBracket);
    });
    this.OPTION3(() => {
      this.SUBRULE(this.descriptionClause);
    });
  });

  // @step port
  private stepPort = this.RULE('stepPort', () => {
    this.CONSUME(StepTag);
    this.CONSUME(Identifier, { LABEL: 'portName' });
    this.OPTION(() => {
      this.SUBRULE(this.descriptionClause);
    });
  });

  // scope:identifier
  private scopeClause = this.RULE('scopeClause', () => {
    this.CONSUME(ScopePrefix);
    this.CONSUME(Identifier, { LABEL: 'scopeName' });
  });

  // [order:N, placement:TOP/BOTTOM, type:X, mergeStrategy:X]
  private metadataBracket = this.RULE('metadataBracket', () => {
    this.CONSUME(LBracket);
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => {
        this.OR([
          { ALT: () => this.SUBRULE(this.orderAttr) },
          { ALT: () => this.SUBRULE(this.placementAttr) },
          { ALT: () => this.SUBRULE(this.typeAttr) },
          { ALT: () => this.SUBRULE(this.mergeStrategyAttr) },
        ]);
      },
    });
    this.CONSUME(RBracket);
  });

  // order:N
  private orderAttr = this.RULE('orderAttr', () => {
    this.CONSUME(OrderPrefix);
    this.CONSUME(Integer, { LABEL: 'orderValue' });
  });

  // placement:TOP/BOTTOM
  private placementAttr = this.RULE('placementAttr', () => {
    this.CONSUME(PlacementPrefix);
    this.OR([
      { ALT: () => this.CONSUME(TopKeyword, { LABEL: 'placementValue' }) },
      { ALT: () => this.CONSUME(BottomKeyword, { LABEL: 'placementValue' }) },
    ]);
  });

  // type:STRING/NUMBER/BOOLEAN/ARRAY/OBJECT/FUNCTION/ANY/STEP
  // Uses Identifier to avoid matching type keywords in descriptions
  private typeAttr = this.RULE('typeAttr', () => {
    this.CONSUME(TypePrefix);
    this.CONSUME(Identifier, { LABEL: 'typeValue' });
  });

  // mergeStrategy:FIRST/LAST/COLLECT/MERGE/CONCAT
  private mergeStrategyAttr = this.RULE('mergeStrategyAttr', () => {
    this.CONSUME(MergeStrategyPrefix);
    this.CONSUME(Identifier, { LABEL: 'mergeStrategyValue' });
  });

  // - description text
  // Note: We just consume the dash here. The actual description text is extracted
  // from the raw input in parsePortLine() to handle special characters like &, :, etc.
  private descriptionClause = this.RULE('descriptionClause', () => {
    this.CONSUME(Dash);
    // Consume any remaining tokens - they're part of the description
    // but the actual description is extracted from raw input.
    // Keywords (over, true, false, TOP, BOTTOM, minimized) and prefix tokens
    // (scope:, order:, etc.) must be included here since they can appear in
    // free-text descriptions (e.g., "Array to iterate over").
    this.MANY(() => {
      this.OR([
        { ALT: () => this.CONSUME(Identifier) },
        { ALT: () => this.CONSUME(Integer) },
        { ALT: () => this.CONSUME(LParen) },
        { ALT: () => this.CONSUME(RParen) },
        { ALT: () => this.CONSUME(Colon) },
        { ALT: () => this.CONSUME(StringLiteral) },
        { ALT: () => this.CONSUME(DescriptionText) },
        { ALT: () => this.CONSUME(Comma) },
        { ALT: () => this.CONSUME(Dot) },
        { ALT: () => this.CONSUME2(Dash) },
        { ALT: () => this.CONSUME(Equals) },
        { ALT: () => this.CONSUME(GreaterThan) },
        { ALT: () => this.CONSUME(LessThan) },
        { ALT: () => this.CONSUME(Pipe) },
        { ALT: () => this.CONSUME(Ampersand) },
        { ALT: () => this.CONSUME(LBrace) },
        { ALT: () => this.CONSUME(RBrace) },
        { ALT: () => this.CONSUME(LBracket) },
        { ALT: () => this.CONSUME(RBracket) },
        { ALT: () => this.CONSUME(Asterisk) },
        // Keywords that can appear in description text
        { ALT: () => this.CONSUME(OverKeyword) },
        { ALT: () => this.CONSUME(AsKeyword) },
        { ALT: () => this.CONSUME(TopKeyword) },
        { ALT: () => this.CONSUME(BottomKeyword) },
        { ALT: () => this.CONSUME(TrueKeyword) },
        { ALT: () => this.CONSUME(FalseKeyword) },
        { ALT: () => this.CONSUME(MinimizedKeyword) },
        // Prefix tokens (scope:, order:, etc.)
        { ALT: () => this.CONSUME(ScopePrefix) },
        { ALT: () => this.CONSUME(OrderPrefix) },
        { ALT: () => this.CONSUME(PlacementPrefix) },
        { ALT: () => this.CONSUME(TypePrefix) },
        { ALT: () => this.CONSUME(MergeStrategyPrefix) },
      ]);
    });
  });
}

// =============================================================================
// Parser Instance (singleton)
// =============================================================================

const parserInstance = new PortParser();

// =============================================================================
// CST Visitor
// =============================================================================

const BaseVisitor = parserInstance.getBaseCstVisitorConstructor();

// CST Context types for the visitor
interface CstNodeWithImage {
  image: string;
}

interface PortLineContext {
  inputPort?: CstNode[];
  outputPort?: CstNode[];
  stepPort?: CstNode[];
}

interface InputPortContext {
  portName: CstNodeWithImage[];
  optionalBracket?: CstNode[];
  defaultValue?: CstNodeWithImage[];
  defaultValueInt?: CstNodeWithImage[];
  defaultValueStr?: CstNodeWithImage[];
  scopeClause?: CstNode[];
  metadataBracket?: CstNode[];
  descriptionClause?: CstNode[];
}

interface OutputPortContext {
  portName: CstNodeWithImage[];
  scopeClause?: CstNode[];
  metadataBracket?: CstNode[];
  descriptionClause?: CstNode[];
}

interface StepPortContext {
  portName: CstNodeWithImage[];
  descriptionClause?: CstNode[];
}

interface ScopeClauseContext {
  scopeName: CstNodeWithImage[];
}

interface MetadataBracketContext {
  orderAttr?: CstNode[];
  placementAttr?: CstNode[];
  typeAttr?: CstNode[];
  mergeStrategyAttr?: CstNode[];
}

interface OrderAttrContext {
  orderValue: CstNodeWithImage[];
}

interface PlacementAttrContext {
  placementValue: CstNodeWithImage[];
}

interface TypeAttrContext {
  typeValue: CstNodeWithImage[];
}

interface MergeStrategyAttrContext {
  mergeStrategyValue: CstNodeWithImage[];
}

interface DescriptionClauseContext {
  Identifier?: IToken[];
}

class PortVisitor extends BaseVisitor {
  constructor() {
    super();
    this.validateVisitor();
  }

  portLine(ctx: PortLineContext): PortParseResult | null {
    if (ctx.inputPort) {
      return this.visit(ctx.inputPort);
    }
    if (ctx.outputPort) {
      return this.visit(ctx.outputPort);
    }
    if (ctx.stepPort) {
      return this.visit(ctx.stepPort);
    }
    return null;
  }

  inputPort(ctx: InputPortContext): PortParseResult {
    const name = ctx.portName[0].image;
    const isOptional = !!ctx.optionalBracket;

    // Handle default value from identifier, integer, or string literal
    let defaultValue: string | undefined;
    if (ctx.defaultValue?.[0]) {
      defaultValue = ctx.defaultValue[0].image;
    } else if (ctx.defaultValueInt?.[0]) {
      defaultValue = ctx.defaultValueInt[0].image;
    } else if (ctx.defaultValueStr?.[0]) {
      // Remove quotes from string literal
      const raw = ctx.defaultValueStr[0].image;
      defaultValue = raw.slice(1, -1);
    }

    let scope: string | undefined;
    let order: number | undefined;
    let placement: 'TOP' | 'BOTTOM' | undefined;
    let dataType: string | undefined;
    let mergeStrategy: string | undefined;
    let description: string | undefined;

    if (ctx.scopeClause) {
      scope = this.visit(ctx.scopeClause);
    }

    if (ctx.metadataBracket) {
      // Handle multiple metadata brackets (e.g., [order:1] [placement:TOP])
      for (const bracket of ctx.metadataBracket) {
        const metadata = this.visit(bracket);
        if (metadata.order !== undefined) order = metadata.order;
        if (metadata.placement !== undefined) placement = metadata.placement;
        if (metadata.dataType !== undefined) dataType = metadata.dataType;
        if (metadata.mergeStrategy !== undefined) mergeStrategy = metadata.mergeStrategy;
      }
    }

    if (ctx.descriptionClause) {
      description = this.visit(ctx.descriptionClause);
    }

    return {
      type: 'input',
      name,
      ...(isOptional && { isOptional }),
      ...(defaultValue && { defaultValue }),
      ...(scope && { scope }),
      ...(order !== undefined && { order }),
      ...(placement && { placement }),
      ...(dataType && { dataType }),
      ...(mergeStrategy && { mergeStrategy }),
      ...(description && { description }),
    };
  }

  outputPort(ctx: OutputPortContext): PortParseResult {
    const name = ctx.portName[0].image;
    let scope: string | undefined;
    let order: number | undefined;
    let placement: 'TOP' | 'BOTTOM' | undefined;
    let dataType: string | undefined;
    let description: string | undefined;

    if (ctx.scopeClause) {
      scope = this.visit(ctx.scopeClause);
    }

    if (ctx.metadataBracket) {
      // Handle multiple metadata brackets (e.g., [order:1] [placement:TOP])
      for (const bracket of ctx.metadataBracket) {
        const metadata = this.visit(bracket);
        if (metadata.order !== undefined) order = metadata.order;
        if (metadata.placement !== undefined) placement = metadata.placement;
        if (metadata.dataType !== undefined) dataType = metadata.dataType;
      }
    }

    if (ctx.descriptionClause) {
      description = this.visit(ctx.descriptionClause);
    }

    return {
      type: 'output',
      name,
      ...(scope && { scope }),
      ...(order !== undefined && { order }),
      ...(placement && { placement }),
      ...(dataType && { dataType }),
      ...(description && { description }),
    };
  }

  stepPort(ctx: StepPortContext): PortParseResult {
    const name = ctx.portName[0].image;
    let description: string | undefined;

    if (ctx.descriptionClause) {
      description = this.visit(ctx.descriptionClause);
    }

    return {
      type: 'step',
      name,
      ...(description && { description }),
    };
  }

  scopeClause(ctx: ScopeClauseContext): string {
    return ctx.scopeName[0].image;
  }

  metadataBracket(ctx: MetadataBracketContext): {
    order?: number;
    placement?: 'TOP' | 'BOTTOM';
    dataType?: string;
    mergeStrategy?: string;
  } {
    let order: number | undefined;
    let placement: 'TOP' | 'BOTTOM' | undefined;
    let dataType: string | undefined;
    let mergeStrategy: string | undefined;

    if (ctx.orderAttr) {
      for (const attr of ctx.orderAttr) {
        order = this.visit(attr);
      }
    }

    if (ctx.placementAttr) {
      for (const attr of ctx.placementAttr) {
        placement = this.visit(attr);
      }
    }

    if (ctx.typeAttr) {
      for (const attr of ctx.typeAttr) {
        dataType = this.visit(attr);
      }
    }

    if (ctx.mergeStrategyAttr) {
      for (const attr of ctx.mergeStrategyAttr) {
        mergeStrategy = this.visit(attr);
      }
    }

    return { order, placement, dataType, mergeStrategy };
  }

  orderAttr(ctx: OrderAttrContext): number {
    return parseInt(ctx.orderValue[0].image, 10);
  }

  placementAttr(ctx: PlacementAttrContext): 'TOP' | 'BOTTOM' {
    return ctx.placementValue[0].image as 'TOP' | 'BOTTOM';
  }

  typeAttr(ctx: TypeAttrContext): string {
    return ctx.typeValue[0].image;
  }

  mergeStrategyAttr(ctx: MergeStrategyAttrContext): string {
    return ctx.mergeStrategyValue[0].image;
  }

  descriptionClause(ctx: DescriptionClauseContext): string {
    if (ctx.Identifier) {
      return ctx.Identifier.map((token: IToken) => token.image).join(' ');
    }
    return '';
  }
}

const visitorInstance = new PortVisitor();

// =============================================================================
// Public API
// =============================================================================

/**
 * Parse a port line (@input/@output/@step) and return structured result.
 * Returns null if the line is not a port declaration.
 */
export function parsePortLine(input: string, warnings: string[]): PortParseResult | null {
  const lexResult = JSDocLexer.tokenize(input);

  // Ignore lexer errors for now - we may have special chars in description
  // Just ensure we have at least one token

  // Check if starts with @input, @output, or @step
  if (lexResult.tokens.length === 0) {
    return null;
  }

  const firstToken = lexResult.tokens[0];
  if (
    firstToken.tokenType !== InputTag &&
    firstToken.tokenType !== OutputTag &&
    firstToken.tokenType !== StepTag
  ) {
    return null;
  }

  parserInstance.input = lexResult.tokens;
  const cst = parserInstance.portLine();

  if (parserInstance.errors.length > 0) {
    const firstError = parserInstance.errors[0];
    const truncatedInput = input.length > 60 ? input.substring(0, 60) + '...' : input;
    const expectedTokens = firstError.context?.ruleStack?.length
      ? ` in rule "${firstError.context.ruleStack[firstError.context.ruleStack.length - 1]}"`
      : '';
    warnings.push(
      `Failed to parse port line: "${truncatedInput}"${expectedTokens}\n` +
        `  Error: ${firstError.message}\n` +
        `  Expected format: @input <name> [scope:scopeName] [order:N] - description\n` +
        `                   @output <name> - description\n` +
        `                   @step <name> - description`
    );
    return null;
  }

  const result = visitorInstance.visit(cst);

  // Extract description from raw input (more robust than token-based)
  // Description starts after " - " (dash with spaces)
  const dashMatch = input.match(/\s-\s+(.+)$/);
  if (dashMatch && dashMatch[1]) {
    result.description = dashMatch[1].trim();
  } else if (result.description === '') {
    // Parser found dash but no text - remove empty description
    delete result.description;
  }

  return result;
}

/**
 * Parse all port lines from a JSDoc block.
 * Extracts lines starting with @input, @output, or @step.
 */
export function parsePortsFromJSDoc(
  jsdocBlock: string,
  warnings: string[] = []
): PortParseResult[] {
  const results: PortParseResult[] = [];

  // Split by lines and process each
  const lines = jsdocBlock.split('\n');

  for (const line of lines) {
    // Remove JSDoc line prefix: " * "
    const cleanLine = line.replace(/^\s*\*\s*/, '').trim();

    // Skip if not a port tag
    if (
      !cleanLine.startsWith('@input') &&
      !cleanLine.startsWith('@output') &&
      !cleanLine.startsWith('@step')
    ) {
      continue;
    }

    const result = parsePortLine(cleanLine, warnings);
    if (result) {
      results.push(result);
    }
  }

  return results;
}

/**
 * Check if a line is a valid port line.
 */
export function isValidPortLine(line: string): boolean {
  const cleanLine = line.replace(/^\s*\*\s*/, '').trim();
  const warnings: string[] = [];
  return parsePortLine(cleanLine, warnings) != null;
}

/**
 * Get serialized grammar for documentation/diagram generation.
 */
export function getPortGrammar() {
  return parserInstance.getSerializedGastProductions();
}
