/**
 * @module chevrotain-parser/trigger-cancel-parser
 *
 * Shared Chevrotain parser for @trigger, @cancelOn, @retries, @timeout, @throttle annotations.
 *
 * The `key=value` options on @trigger, @cancelOn and @throttle are parsed as a
 * generic list of `Identifier "=" (STRING | INTEGER)` assignments; the visitor
 * checks the key names. Lexing `event=` or `timeout=` as their own tokens would
 * shadow a port that happens to carry that name on @input and @node lines.
 */

import { CstParser, type CstNode } from 'chevrotain';
import {
  TriggerTag,
  CancelOnTag,
  RetriesTag,
  TimeoutTag,
  ThrottleTag,
  Identifier,
  Equals,
  StringLiteral,
  Integer,
  allTokens,
} from './tokens';
import {
  lexTaggedLine,
  lineFailure,
  runRule,
  unquoteStringLiteral,
  type CstNodeWithImage,
} from './parse-line';

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

/**
 * A standard five-field cron expression. Each field is `*`, a value, a range
 * `a-b`, or a comma list of those, and each item may carry a `/step`. Values
 * are numbers or the three-letter month and weekday names (`JAN`, `MON-FRI`).
 */
const CRON_ITEM = '(?:\\*|[0-9A-Za-z]+(?:-[0-9A-Za-z]+)?)(?:/\\d+)?';
const CRON_FIELD = `${CRON_ITEM}(?:,${CRON_ITEM})*`;
const CRON_REGEX = new RegExp(`^${CRON_FIELD}(?:\\s+${CRON_FIELD}){4}$`);

/** True when `expression` has five cron fields of the accepted shape. */
export function isValidCronExpression(expression: string): boolean {
  return CRON_REGEX.test(expression.trim());
}

/** One `key=value` option as the grammar sees it. */
interface Assignment {
  key: string;
  /** Unquoted string value, when the value was a string literal. */
  str?: string;
  /** Integer value, when the value was an integer literal. */
  int?: number;
}

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
      this.SUBRULE(this.assignment);
    });
  });

  // @cancelOn event="app/user.deleted" match="data.userId" timeout="1h"
  public cancelOnLine = this.RULE('cancelOnLine', () => {
    this.CONSUME(CancelOnTag);
    this.AT_LEAST_ONE(() => {
      this.SUBRULE(this.assignment);
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
    this.AT_LEAST_ONE(() => {
      this.SUBRULE(this.assignment);
    });
  });

  // key="value" or key=123
  private assignment = this.RULE('assignment', () => {
    this.CONSUME(Identifier, { LABEL: 'key' });
    this.CONSUME(Equals);
    this.OR([
      { ALT: () => this.CONSUME(StringLiteral, { LABEL: 'strValue' }) },
      { ALT: () => this.CONSUME(Integer, { LABEL: 'intValue' }) },
    ]);
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

interface AssignmentListContext {
  assignment?: CstNode[];
}

interface AssignmentContext {
  key: CstNodeWithImage[];
  strValue?: CstNodeWithImage[];
  intValue?: CstNodeWithImage[];
}

interface RetriesLineContext {
  retriesValue: CstNodeWithImage[];
}

interface TimeoutLineContext {
  timeoutValue: CstNodeWithImage[];
}

/**
 * What the visitor hands back for the option-list lines. `unknownKeys` and
 * `badValues` let the public functions decide between "not ours" (return null
 * so a pack can claim the line) and a warning.
 */
interface OptionsResult {
  values: Map<string, Assignment>;
  unknownKeys: string[];
  /** Keys whose value had the wrong literal kind (string where an integer is needed, or the reverse). */
  badValues: string[];
}

const TRIGGER_KEYS: Record<string, 'str' | 'int'> = { event: 'str', cron: 'str' };
const CANCEL_ON_KEYS: Record<string, 'str' | 'int'> = { event: 'str', match: 'str', timeout: 'str' };
const THROTTLE_KEYS: Record<string, 'str' | 'int'> = { limit: 'int', period: 'str' };

class TriggerCancelVisitor extends BaseVisitor {
  constructor() {
    super();
    this.validateVisitor();
  }

  private collect(ctx: AssignmentListContext, allowed: Record<string, 'str' | 'int'>): OptionsResult {
    const result: OptionsResult = { values: new Map(), unknownKeys: [], badValues: [] };
    for (const node of ctx.assignment ?? []) {
      const a = this.visit(node) as Assignment;
      const kind = allowed[a.key];
      if (kind === undefined) {
        result.unknownKeys.push(a.key);
        continue;
      }
      if ((kind === 'str' && a.str === undefined) || (kind === 'int' && a.int === undefined)) {
        result.badValues.push(a.key);
        continue;
      }
      result.values.set(a.key, a);
    }
    return result;
  }

  triggerLine(ctx: AssignmentListContext): OptionsResult {
    return this.collect(ctx, TRIGGER_KEYS);
  }

  cancelOnLine(ctx: AssignmentListContext): OptionsResult {
    return this.collect(ctx, CANCEL_ON_KEYS);
  }

  throttleLine(ctx: AssignmentListContext): OptionsResult {
    return this.collect(ctx, THROTTLE_KEYS);
  }

  assignment(ctx: AssignmentContext): Assignment {
    const key = ctx.key[0].image;
    if (ctx.strValue?.[0]) {
      return { key, str: unquoteStringLiteral(ctx.strValue[0].image) };
    }
    return { key, int: parseInt(ctx.intValue![0].image, 10) };
  }

  retriesLine(ctx: RetriesLineContext): RetriesParseResult {
    return { retries: parseInt(ctx.retriesValue[0].image, 10) };
  }

  timeoutLine(ctx: TimeoutLineContext): TimeoutParseResult {
    return { timeout: unquoteStringLiteral(ctx.timeoutValue[0].image) };
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
  const tokens = lexTaggedLine(input, TriggerTag);
  if (!tokens) return null;

  const { cst, error } = runRule(parserInstance, tokens, () => parserInstance.triggerLine());
  if (error) {
    // Don't warn here. Return null so domain-specific handlers
    // get a chance to parse the trigger. The caller can warn if nothing handles it.
    return null;
  }

  const options = visitorInstance.visit(cst) as OptionsResult;

  // A line with no event=/cron=, or with keys core does not know, is a pack's
  // trigger form (for example a pack that registers its own event sources).
  // Return null so the caller can delegate it.
  if (options.values.size === 0 || options.unknownKeys.length > 0 || options.badValues.length > 0) {
    return null;
  }

  const result: TriggerParseResult = {};
  const event = options.values.get('event');
  if (event) result.event = event.str;
  const cron = options.values.get('cron');
  if (cron) result.cron = cron.str;

  // Validate cron expression
  if (result.cron && !isValidCronExpression(result.cron)) {
    warnings.push(`Invalid cron expression: "${result.cron}". Expected 5 fields (minute hour day month weekday).`);
  }

  return result;
}

/**
 * Parse a @cancelOn line and return structured result.
 * Returns null if the line is not a cancelOn declaration.
 */
export function parseCancelOnLine(input: string, warnings: string[]): CancelOnParseResult | null {
  const tokens = lexTaggedLine(input, CancelOnTag);
  if (!tokens) return null;

  const { cst, error } = runRule(parserInstance, tokens, () => parserInstance.cancelOnLine());
  const expected = '@cancelOn event="name" match="field" timeout="duration"';
  if (error) {
    warnings.push(lineFailure('cancelOn', input, error.message, expected));
    return null;
  }

  const options = visitorInstance.visit(cst) as OptionsResult;
  const problem = options.unknownKeys.length > 0
    ? `unknown option "${options.unknownKeys[0]}"`
    : options.badValues.length > 0
      ? `"${options.badValues[0]}" takes a quoted string`
      : !options.values.has('event')
        ? 'event="name" is required'
        : null;
  if (problem) {
    warnings.push(lineFailure('cancelOn', input, problem, expected));
    return null;
  }

  const result: CancelOnParseResult = { event: options.values.get('event')!.str! };
  const match = options.values.get('match');
  if (match) result.match = match.str;
  const timeout = options.values.get('timeout');
  if (timeout) result.timeout = timeout.str;
  return result;
}

/**
 * Parse a @retries line and return structured result.
 * Returns null if the line is not a retries declaration.
 */
export function parseRetriesLine(input: string, warnings: string[]): RetriesParseResult | null {
  const tokens = lexTaggedLine(input, RetriesTag);
  if (!tokens) return null;

  const { cst, error } = runRule(parserInstance, tokens, () => parserInstance.retriesLine());
  if (error) {
    warnings.push(lineFailure('retries', input, error.message, '@retries <integer>'));
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
  const tokens = lexTaggedLine(input, TimeoutTag);
  if (!tokens) return null;

  const { cst, error } = runRule(parserInstance, tokens, () => parserInstance.timeoutLine());
  if (error) {
    warnings.push(lineFailure('timeout', input, error.message, '@timeout "duration"'));
    return null;
  }

  return visitorInstance.visit(cst) as TimeoutParseResult;
}

/**
 * Parse a @throttle line and return structured result.
 * Returns null if the line is not a throttle declaration.
 */
export function parseThrottleLine(input: string, warnings: string[]): ThrottleParseResult | null {
  const tokens = lexTaggedLine(input, ThrottleTag);
  if (!tokens) return null;

  const { cst, error } = runRule(parserInstance, tokens, () => parserInstance.throttleLine());
  const expected = '@throttle limit=<number> period="duration"';
  if (error) {
    warnings.push(lineFailure('throttle', input, error.message, expected));
    return null;
  }

  const options = visitorInstance.visit(cst) as OptionsResult;
  const problem = options.unknownKeys.length > 0
    ? `unknown option "${options.unknownKeys[0]}"`
    : options.badValues.length > 0
      ? (options.badValues[0] === 'limit' ? 'limit takes an integer' : `"${options.badValues[0]}" takes a quoted string`)
      : !options.values.has('limit')
        ? 'limit=<number> is required'
        : null;
  if (problem) {
    warnings.push(lineFailure('throttle', input, problem, expected));
    return null;
  }

  const result: ThrottleParseResult = { limit: options.values.get('limit')!.int! };
  const period = options.values.get('period');
  if (period) result.period = period.str;
  return result;
}

/**
 * Get serialized grammar productions for documentation/diagrams.
 */
export function getTriggerCancelGrammar() {
  return parserInstance.getSerializedGastProductions();
}
