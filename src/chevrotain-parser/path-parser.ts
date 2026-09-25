/**
 * @module chevrotain-parser/path-parser
 *
 * Parser for @path sugar annotations using Chevrotain.
 *
 * Syntax:
 *   @path Start -> validator:ok -> classifier -> urgencyRouter:fail -> escalate -> Exit
 *   @path Start -> A -> C -> Exit, Start -> B -> C
 *
 * Steps separated by ->, each is NodeName optionally followed by :ok or :fail.
 * Multiple paths can be comma-separated within a single @path tag.
 */

import { CstParser } from 'chevrotain';
import {
  PathTag,
  Identifier,
  Arrow,
  Colon,
  Comma,
  allTokens,
} from './tokens';
import { lexTaggedLine, lineFailure, runRule, type CstNodeWithImage } from './parse-line';

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

  // Entry rule: @path pathSequence (Comma pathSequence)*
  public pathLine = this.RULE('pathLine', () => {
    this.CONSUME(PathTag);
    this.SUBRULE(this.pathSequence, { LABEL: 'firstSequence' });
    this.MANY(() => {
      this.CONSUME(Comma);
      this.SUBRULE2(this.pathSequence, { LABEL: 'nextSequence' });
    });
  });

  // pathSequence: pathStep (Arrow pathStep)+
  public pathSequence = this.RULE('pathSequence', () => {
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

interface PathStepContext {
  nodeName: CstNodeWithImage[];
  routeSuffix?: CstNodeWithImage[];
}

interface PathSequenceContext {
  firstStep: { children: PathStepContext }[];
  nextStep: { children: PathStepContext }[];
}

interface PathLineContext {
  firstSequence: { children: PathSequenceContext }[];
  nextSequence?: { children: PathSequenceContext }[];
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

  pathLine(ctx: PathLineContext): PathParseResult[] {
    const results: PathParseResult[] = [];

    results.push(this.pathSequence(ctx.firstSequence[0].children));

    if (ctx.nextSequence) {
      for (const seqCst of ctx.nextSequence) {
        results.push(this.pathSequence(seqCst.children));
      }
    }

    return results;
  }

  pathSequence(ctx: PathSequenceContext): PathParseResult {
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
          `@path: invalid route suffix ":${suffix}" on node "${node}". Expected ":ok" or ":fail", ignoring suffix.`
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
 * Parse a @path line and return structured results.
 * Supports comma-separated parallel paths in a single @path tag:
 *   @path Start -> A -> C -> Exit, Start -> B -> C
 * Returns null if the line is not a valid @path declaration.
 */
export function parsePathLine(input: string, warnings: string[]): PathParseResult[] | null {
  const tokens = lexTaggedLine(input, PathTag);
  if (!tokens) return null;

  const { cst, error } = runRule(parserInstance, tokens, () => parserInstance.pathLine());
  if (error) {
    warnings.push(lineFailure('@path', input, error.message, '@path Start -> nodeA -> nodeB:ok -> Exit'));
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
