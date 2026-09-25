/**
 * @module chevrotain-parser/parse-line
 *
 * The steps every single-line annotation parser shares: lex the line, check
 * that it starts with the parser's tag, run the entry rule, and word the
 * warning when the rule fails.
 */

import type { CstNode, CstParser, IRecognitionException, IToken, TokenType } from 'chevrotain';
import { JSDocLexer } from './tokens';

/** A CST token as the visitors read it: only its source text matters. */
export interface CstNodeWithImage {
  image: string;
}

export interface LexTaggedLineOptions {
  /**
   * Parse the tokens even when the lexer reported errors. Port lines use this
   * because their free-text description can hold characters the lexer rejects.
   */
  ignoreLexErrors?: boolean;
  /** Called with the first lexer error message before the line is rejected. */
  onLexError?: (message: string) => void;
}

/**
 * Lex `input` and return its tokens when the first one is one of `tags`.
 * Returns null for a line that does not lex cleanly, is empty, or belongs to
 * another tag.
 */
export function lexTaggedLine(
  input: string,
  tags: TokenType | readonly TokenType[],
  options: LexTaggedLineOptions = {}
): IToken[] | null {
  const lexResult = JSDocLexer.tokenize(input);
  if (lexResult.errors.length > 0 && !options.ignoreLexErrors) {
    options.onLexError?.(lexResult.errors[0].message);
    return null;
  }
  if (lexResult.tokens.length === 0) return null;
  const firstType = lexResult.tokens[0].tokenType;
  const accepted = Array.isArray(tags) ? tags.includes(firstType) : tags === firstType;
  return accepted ? lexResult.tokens : null;
}

/** What running an entry rule produced: the tree, and the first error if the rule failed. */
export interface RuleResult {
  cst: CstNode;
  error: IRecognitionException | undefined;
}

/** Feed `tokens` to the parser singleton and run one of its entry rules. */
export function runRule(parser: CstParser, tokens: IToken[], rule: () => CstNode): RuleResult {
  parser.input = tokens;
  const cst = rule();
  return { cst, error: parser.errors[0] };
}

/** Shorten a line for a warning, keeping `maxLength` characters. */
export function truncateLine(input: string, maxLength = 60): string {
  return input.length > maxLength ? input.substring(0, maxLength) + '...' : input;
}

export interface LineFailureOptions {
  /** How many characters of the line to quote. */
  maxLength?: number;
  /** The verb in the first line; `tokenize` for lexer failures. */
  verb?: 'parse' | 'tokenize';
  /** Text placed right after the quoted line, such as the rule that failed. */
  context?: string;
}

/**
 * The warning for a line that did not parse:
 * `Failed to parse <kind> line: "<line>"`, then the error, then the expected format.
 */
export function lineFailure(
  kind: string,
  input: string,
  error: string,
  expected: string,
  options: LineFailureOptions = {}
): string {
  const { maxLength = 60, verb = 'parse', context = '' } = options;
  return (
    `Failed to ${verb} ${kind} line: "${truncateLine(input, maxLength)}"${context}\n` +
    `  Error: ${error}\n` +
    `  Expected format: ${expected}`
  );
}

/**
 * Remove the quotes around a string literal token and undo its escapes: `\"`
 * becomes `"` and `*\/` becomes `*` followed by `/`, the escape that keeps a
 * value from closing the JSDoc comment it sits in.
 */
export function unquoteStringLiteral(raw: string): string {
  return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\*\\\//g, '*/');
}
