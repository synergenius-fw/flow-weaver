/**
 * @module chevrotain-parser/trigger-cancel-parser
 *
 * Shared Chevrotain parser for @trigger, @cancelOn, @retries, @timeout, @throttle annotations.
 */

import { CstParser, type CstNode } from 'chevrotain';
import {
  JSDocLexer,
  TriggerTag,
  CancelOnTag,
  RetriesTag,
  TimeoutTag,
  ThrottleTag,
  EventEq,
  CronEq,
  MatchEq,
  TimeoutEq,
  LimitEq,
  PeriodEq,
  StringLiteral,
  Integer,
  allTokens,
} from './tokens';

// =============================================================================
// Parser Result Types
// =============================================================================

export interface TriggerParseResult {
  event?: string;
  cron?: string;
}

export interface CancelOnParseResult {
  event: string;
  match?: string;
  timeout?: string;
}

export interface RetriesParseResult {
  retries: number;
}

export interface TimeoutParseResult {
  timeout: string;
}

export interface ThrottleParseResult {
  limit: number;
  period?: string;
}

// =============================================================================
// Helpers
// =============================================================================

function stripQuotes(s: string): string {
  if (s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1);
  }
  return s;
}

const CRON_REGEX = /^(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)$/;

// =============================================================================
// Parser Definition
// =============================================================================

class TriggerCancelParser extends CstParser {
  constructor() {
    super(allTokens);
    this.performSelfAnalysis();
  }

  // @trigger event="agent/request" cron="0 9 * * *"
  public triggerLine = this.RULE('triggerLine', () => {
    this.CONSUME(TriggerTag);
    this.MANY(() => {
      this.OR([
        { ALT: () => {
          this.CONSUME(EventEq);
          this.CONSUME(StringLiteral, { LABEL: 'eventValue' });
        }},
        { ALT: () => {
          this.CONSUME(CronEq);
          this.CONSUME2(StringLiteral, { LABEL: 'cronValue' });
        }},
      ]);
    });
  });

  // @cancelOn event="app/user.deleted" match="data.userId" timeout="1h"
  public cancelOnLine = this.RULE('cancelOnLine', () => {
    this.CONSUME(CancelOnTag);
    this.CONSUME(EventEq);
    this.CONSUME(StringLiteral, { LABEL: 'eventValue' });
    this.OPTION(() => {
      this.CONSUME(MatchEq);
      this.CONSUME2(StringLiteral, { LABEL: 'matchValue' });
    });
    this.OPTION2(() => {
      this.CONSUME(TimeoutEq);
      this.CONSUME3(StringLiteral, { LABEL: 'timeoutValue' });
    });
  });

  // @retries 5
  public retriesLine = this.RULE('retriesLine', () => {
    this.CONSUME(RetriesTag);
    this.CONSUME(Integer, { LABEL: 'retriesValue' });
  });

  // @timeout "30m"
  public timeoutLine = this.RULE('timeoutLine', () => {
    this.CONSUME(TimeoutTag);
    this.CONSUME(StringLiteral, { LABEL: 'timeoutValue' });
  });

  // @throttle limit=3 period="1m"
  public throttleLine = this.RULE('throttleLine', () => {
    this.CONSUME(ThrottleTag);
    this.CONSUME(LimitEq);
    this.CONSUME(Integer, { LABEL: 'limitValue' });
    this.OPTION(() => {
      this.CONSUME(PeriodEq);
      this.CONSUME(StringLiteral, { LABEL: 'periodValue' });
    });
  });
}

// =============================================================================
// Parser Instance (singleton)
// =============================================================================

const parserInstance = new TriggerCancelParser();

// =============================================================================
// CST Visitor
// =============================================================================

const BaseVisitor = parserInstance.getBaseCstVisitorConstructor();

interface CstNodeWithImage {
  image: string;
}

interface TriggerLineContext {
  eventValue?: CstNodeWithImage[];
  cronValue?: CstNodeWithImage[];
}

interface CancelOnLineContext {
  eventValue: CstNodeWithImage[];
  matchValue?: CstNodeWithImage[];
  timeoutValue?: CstNodeWithImage[];
}

interface RetriesLineContext {
  retriesValue: CstNodeWithImage[];
}

interface TimeoutLineContext {
  timeoutValue: CstNodeWithImage[];
}

interface ThrottleLineContext {
  limitValue: CstNodeWithImage[];
  periodValue?: CstNodeWithImage[];
}

class TriggerCancelVisitor extends BaseVisitor {
  constructor() {
    super();
    this.validateVisitor();
  }

  triggerLine(ctx: TriggerLineContext): TriggerParseResult {
    const result: TriggerParseResult = {};
    if (ctx.eventValue?.[0]) {
      result.event = stripQuotes(ctx.eventValue[0].image);
    }
    if (ctx.cronValue?.[0]) {
      result.cron = stripQuotes(ctx.cronValue[0].image);
    }
    return result;
  }

  cancelOnLine(ctx: CancelOnLineContext): CancelOnParseResult {
    const result: CancelOnParseResult = {
      event: stripQuotes(ctx.eventValue[0].image),
    };
    if (ctx.matchValue?.[0]) {
      result.match = stripQuotes(ctx.matchValue[0].image);
    }
    if (ctx.timeoutValue?.[0]) {
      result.timeout = stripQuotes(ctx.timeoutValue[0].image);
    }
    return result;
  }

  retriesLine(ctx: RetriesLineContext): RetriesParseResult {
    return { retries: parseInt(ctx.retriesValue[0].image, 10) };
  }

  timeoutLine(ctx: TimeoutLineContext): TimeoutParseResult {
    return { timeout: stripQuotes(ctx.timeoutValue[0].image) };
  }

  throttleLine(ctx: ThrottleLineContext): ThrottleParseResult {
    const result: ThrottleParseResult = {
      limit: parseInt(ctx.limitValue[0].image, 10),
    };
    if (ctx.periodValue?.[0]) {
      result.period = stripQuotes(ctx.periodValue[0].image);
    }
    return result;
  }
}

const visitorInstance = new TriggerCancelVisitor();

// =============================================================================
// Public API
// =============================================================================

/**
 * Parse a @trigger line and return structured result.
 * Returns null if the line is not a trigger declaration.
 */
export function parseTriggerLine(input: string, warnings: string[]): TriggerParseResult | null {
  const lexResult = JSDocLexer.tokenize(input);

  if (lexResult.errors.length > 0) {
    return null;
  }

  if (lexResult.tokens.length === 0) {
    return null;
  }

  const firstToken = lexResult.tokens[0];
  if (firstToken.tokenType !== TriggerTag) {
    return null;
  }

  parserInstance.input = lexResult.tokens;
  const cst = parserInstance.triggerLine();

  if (parserInstance.errors.length > 0) {
    const firstError = parserInstance.errors[0];
    const truncatedInput = input.length > 60 ? input.substring(0, 60) + '...' : input;
    warnings.push(
      `Failed to parse trigger line: "${truncatedInput}"\n` +
        `  Error: ${firstError.message}\n` +
        `  Expected format: @trigger event="name" or @trigger cron="expr"`
    );
    return null;
  }

  const result = visitorInstance.visit(cst) as TriggerParseResult;

  // Validate cron expression
  if (result.cron && !CRON_REGEX.test(result.cron)) {
    warnings.push(`Invalid cron expression: "${result.cron}". Expected 5 fields (minute hour day month weekday).`);
  }

  return result;
}

/**
 * Parse a @cancelOn line and return structured result.
 * Returns null if the line is not a cancelOn declaration.
 */
export function parseCancelOnLine(input: string, warnings: string[]): CancelOnParseResult | null {
  const lexResult = JSDocLexer.tokenize(input);

  if (lexResult.errors.length > 0) {
    return null;
  }

  if (lexResult.tokens.length === 0) {
    return null;
  }

  const firstToken = lexResult.tokens[0];
  if (firstToken.tokenType !== CancelOnTag) {
    return null;
  }

  parserInstance.input = lexResult.tokens;
  const cst = parserInstance.cancelOnLine();

  if (parserInstance.errors.length > 0) {
    const firstError = parserInstance.errors[0];
    const truncatedInput = input.length > 60 ? input.substring(0, 60) + '...' : input;
    warnings.push(
      `Failed to parse cancelOn line: "${truncatedInput}"\n` +
        `  Error: ${firstError.message}\n` +
        `  Expected format: @cancelOn event="name" match="field" timeout="duration"`
    );
    return null;
  }

  return visitorInstance.visit(cst) as CancelOnParseResult;
}

/**
 * Parse a @retries line and return structured result.
 * Returns null if the line is not a retries declaration.
 */
export function parseRetriesLine(input: string, warnings: string[]): RetriesParseResult | null {
  const lexResult = JSDocLexer.tokenize(input);

  if (lexResult.errors.length > 0) {
    return null;
  }

  if (lexResult.tokens.length === 0) {
    return null;
  }

  const firstToken = lexResult.tokens[0];
  if (firstToken.tokenType !== RetriesTag) {
    return null;
  }

  parserInstance.input = lexResult.tokens;
  const cst = parserInstance.retriesLine();

  if (parserInstance.errors.length > 0) {
    const firstError = parserInstance.errors[0];
    const truncatedInput = input.length > 60 ? input.substring(0, 60) + '...' : input;
    warnings.push(
      `Failed to parse retries line: "${truncatedInput}"\n` +
        `  Error: ${firstError.message}\n` +
        `  Expected format: @retries <integer>`
    );
    return null;
  }

  const result = visitorInstance.visit(cst) as RetriesParseResult;

  // Validate non-negative
  if (result.retries < 0) {
    warnings.push(`Invalid @retries value: ${result.retries}. Expected non-negative integer.`);
  }

  return result;
}

/**
 * Parse a @timeout line and return structured result.
 * Returns null if the line is not a timeout declaration.
 */
export function parseTimeoutLine(input: string, warnings: string[]): TimeoutParseResult | null {
  const lexResult = JSDocLexer.tokenize(input);

  if (lexResult.errors.length > 0) {
    return null;
  }

  if (lexResult.tokens.length === 0) {
    return null;
  }

  const firstToken = lexResult.tokens[0];
  if (firstToken.tokenType !== TimeoutTag) {
    return null;
  }

  parserInstance.input = lexResult.tokens;
  const cst = parserInstance.timeoutLine();

  if (parserInstance.errors.length > 0) {
    const firstError = parserInstance.errors[0];
    const truncatedInput = input.length > 60 ? input.substring(0, 60) + '...' : input;
    warnings.push(
      `Failed to parse timeout line: "${truncatedInput}"\n` +
        `  Error: ${firstError.message}\n` +
        `  Expected format: @timeout "duration"`
    );
    return null;
  }

  return visitorInstance.visit(cst) as TimeoutParseResult;
}

/**
 * Parse a @throttle line and return structured result.
 * Returns null if the line is not a throttle declaration.
 */
/**
 * Get serialized grammar productions for documentation/diagrams.
 */
export function getTriggerCancelGrammar() {
  return parserInstance.getSerializedGastProductions();
}

export function parseThrottleLine(input: string, warnings: string[]): ThrottleParseResult | null {
  const lexResult = JSDocLexer.tokenize(input);

  if (lexResult.errors.length > 0) {
    return null;
  }

  if (lexResult.tokens.length === 0) {
    return null;
  }

  const firstToken = lexResult.tokens[0];
  if (firstToken.tokenType !== ThrottleTag) {
    return null;
  }

  parserInstance.input = lexResult.tokens;
  const cst = parserInstance.throttleLine();

  if (parserInstance.errors.length > 0) {
    const firstError = parserInstance.errors[0];
    const truncatedInput = input.length > 60 ? input.substring(0, 60) + '...' : input;
    warnings.push(
      `Failed to parse throttle line: "${truncatedInput}"\n` +
        `  Error: ${firstError.message}\n` +
        `  Expected format: @throttle limit=<number> period="duration"`
    );
    return null;
  }

  return visitorInstance.visit(cst) as ThrottleParseResult;
}
