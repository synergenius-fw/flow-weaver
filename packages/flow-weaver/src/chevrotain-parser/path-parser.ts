/**
 * @module chevrotain-parser/path-parser
 *
 * Parser for @path sugar annotations using Chevrotain.
 *
 * Syntax:
 *   @path Start -> validator:ok -> classifier -> urgencyRouter:fail -> escalate -> Exit
 *
 * Steps separated by ->, each is NodeName optionally followed by :ok or :fail
 */

import { CstParser } from 'chevrotain';
import {
  JSDocLexer,
  PathTag,
  Identifier,
  Arrow,
  Colon,
  allTokens,
} from './tokens';

// =============================================================================
// Parser Result Types
// =============================================================================

export interface PathStep {
  node: string;
  route?: 'ok' | 'fail';
}

export interface PathParseResult {
  /** Ordered steps through the graph */
  steps: PathStep[];
}

// =============================================================================
// Parser Definition
// =============================================================================

class PathParser extends CstParser {
  constructor() {
    super(allTokens);
    this.performSelfAnalysis();
  }

  // Entry rule: @path pathStep (Arrow pathStep)+
  public pathLine = this.RULE('pathLine', () => {
    this.CONSUME(PathTag);
    this.SUBRULE(this.pathStep, { LABEL: 'firstStep' });
    this.AT_LEAST_ONE(() => {
      this.CONSUME(Arrow);
      this.SUBRULE2(this.pathStep, { LABEL: 'nextStep' });
    });
  });

  // pathStep: Identifier (Colon Identifier)?
  public pathStep = this.RULE('pathStep', () => {
    this.CONSUME(Identifier, { LABEL: 'nodeName' });
    this.OPTION(() => {
      this.CONSUME(Colon);
      this.CONSUME2(Identifier, { LABEL: 'routeSuffix' });
    });
  });
}

// =============================================================================
// Parser Instance (singleton)
// =============================================================================

const parserInstance = new PathParser();

// =============================================================================
// CST Visitor
// =============================================================================

const BaseVisitor = parserInstance.getBaseCstVisitorConstructor();

interface CstNodeWithImage {
  image: string;
}

interface PathStepContext {
  nodeName: CstNodeWithImage[];
  routeSuffix?: CstNodeWithImage[];
}

interface PathLineContext {
  firstStep: { children: PathStepContext }[];
  nextStep: { children: PathStepContext }[];
}

class PathVisitor extends BaseVisitor {
  private warnings: string[] = [];

  constructor() {
    super();
    this.validateVisitor();
  }

  setWarnings(warnings: string[]) {
    this.warnings = warnings;
  }

  pathLine(ctx: PathLineContext): PathParseResult {
    const steps: PathStep[] = [];

    steps.push(this.pathStep(ctx.firstStep[0].children));

    for (const stepCst of ctx.nextStep) {
      steps.push(this.pathStep(stepCst.children));
    }

    return { steps };
  }

  pathStep(ctx: PathStepContext): PathStep {
    const node = ctx.nodeName[0].image;
    let route: 'ok' | 'fail' | undefined;

    if (ctx.routeSuffix && ctx.routeSuffix.length > 0) {
      const suffix = ctx.routeSuffix[0].image;
      if (suffix === 'ok' || suffix === 'fail') {
        route = suffix;
      } else {
        this.warnings.push(
          `@path: invalid route suffix ":${suffix}" on node "${node}" — expected ":ok" or ":fail", ignoring suffix.`
        );
      }
    }

    return route ? { node, route } : { node };
  }
}

const visitorInstance = new PathVisitor();

// =============================================================================
// Public API
// =============================================================================

/**
 * Parse a @path line and return structured result.
 * Returns null if the line is not a valid @path declaration.
 */
export function parsePathLine(input: string, warnings: string[]): PathParseResult | null {
  const lexResult = JSDocLexer.tokenize(input);

  if (lexResult.errors.length > 0) {
    return null;
  }

  if (lexResult.tokens.length === 0) {
    return null;
  }

  const firstToken = lexResult.tokens[0];
  if (firstToken.tokenType !== PathTag) {
    return null;
  }

  parserInstance.input = lexResult.tokens;
  const cst = parserInstance.pathLine();

  if (parserInstance.errors.length > 0) {
    const firstError = parserInstance.errors[0];
    const truncatedInput = input.length > 60 ? input.substring(0, 60) + '...' : input;
    warnings.push(
      `Failed to parse @path line: "${truncatedInput}"\n` +
        `  Error: ${firstError.message}\n` +
        `  Expected format: @path Start -> nodeA -> nodeB:ok -> Exit`
    );
    return null;
  }

  visitorInstance.setWarnings(warnings);
  return visitorInstance.visit(cst);
}

/**
 * Get serialized grammar for documentation/diagram generation.
 */
export function getPathGrammar() {
  return parserInstance.getSerializedGastProductions();
}
