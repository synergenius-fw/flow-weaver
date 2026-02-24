/**
 * @module chevrotain-parser/tokens
 *
 * Token definitions for JSDoc parsing with Chevrotain.
 * These tokens are used by the lexer to tokenize JSDoc content.
 */

import { createToken, Lexer } from 'chevrotain';

// =============================================================================
// Whitespace & Structure
// =============================================================================

export const WhiteSpace = createToken({
  name: 'WhiteSpace',
  pattern: /[ \t]+/,
  group: Lexer.SKIPPED,
});

export const Newline = createToken({
  name: 'Newline',
  pattern: /\r?\n/,
  group: Lexer.SKIPPED,
});

export const Asterisk = createToken({
  name: 'Asterisk',
  pattern: /\*/,
});

// =============================================================================
// JSDoc Tags
// =============================================================================

export const InputTag = createToken({
  name: 'InputTag',
  pattern: /@input\b/,
});

export const OutputTag = createToken({
  name: 'OutputTag',
  pattern: /@output\b/,
});

export const StepTag = createToken({
  name: 'StepTag',
  pattern: /@step\b/,
});

export const NodeTag = createToken({
  name: 'NodeTag',
  pattern: /@node\b/,
});

export const ConnectTag = createToken({
  name: 'ConnectTag',
  pattern: /@connect\b/,
});

export const PositionTag = createToken({
  name: 'PositionTag',
  pattern: /@position\b/,
});

export const ScopeTag = createToken({
  name: 'ScopeTag',
  pattern: /@scope\b/,
});

export const MapTag = createToken({
  name: 'MapTag',
  pattern: /@map\b/,
});

export const PathTag = createToken({
  name: 'PathTag',
  pattern: /@path\b/,
});

export const FanOutTag = createToken({
  name: 'FanOutTag',
  pattern: /@fanOut\b/,
});

export const FanInTag = createToken({
  name: 'FanInTag',
  pattern: /@fanIn\b/,
});

export const CoerceTag = createToken({
  name: 'CoerceTag',
  pattern: /@coerce\b/,
});

export const TriggerTag = createToken({
  name: 'TriggerTag',
  pattern: /@trigger\b/,
});

export const CancelOnTag = createToken({
  name: 'CancelOnTag',
  pattern: /@cancelOn\b/,
});

export const RetriesTag = createToken({
  name: 'RetriesTag',
  pattern: /@retries\b/,
});

export const TimeoutTag = createToken({
  name: 'TimeoutTag',
  pattern: /@timeout\b/,
});

export const ThrottleTag = createToken({
  name: 'ThrottleTag',
  pattern: /@throttle\b/,
});

export const OverKeyword = createToken({
  name: 'OverKeyword',
  pattern: /over\b/,
});

export const AsKeyword = createToken({
  name: 'AsKeyword',
  pattern: /as\b/,
});

export const ParamTag = createToken({
  name: 'ParamTag',
  pattern: /@param\b/,
});

export const ReturnsTag = createToken({
  name: 'ReturnsTag',
  pattern: /@returns?\b/,
});

export const FlowWeaverTag = createToken({
  name: 'FlowWeaverTag',
  pattern: /@flowWeaver\b/,
});

export const LabelAttr = createToken({
  name: 'LabelAttr',
  pattern: /@label\b/,
});

export const NameAttr = createToken({
  name: 'NameAttr',
  pattern: /@name\b/,
});

// =============================================================================
// Keywords & Attributes
// =============================================================================

export const ScopePrefix = createToken({
  name: 'ScopePrefix',
  pattern: /scope:/,
});

export const OrderPrefix = createToken({
  name: 'OrderPrefix',
  pattern: /order:/,
});

export const PlacementPrefix = createToken({
  name: 'PlacementPrefix',
  pattern: /placement:/,
});

export const TypePrefix = createToken({
  name: 'TypePrefix',
  pattern: /type:/,
});

export const LabelPrefix = createToken({
  name: 'LabelPrefix',
  pattern: /label:/,
});

export const PortOrderPrefix = createToken({
  name: 'PortOrderPrefix',
  pattern: /portOrder:/,
});

export const PortLabelPrefix = createToken({
  name: 'PortLabelPrefix',
  pattern: /portLabel:/,
});

export const ExprPrefix = createToken({
  name: 'ExprPrefix',
  pattern: /expr:/,
});

export const MergeStrategyPrefix = createToken({
  name: 'MergeStrategyPrefix',
  pattern: /mergeStrategy:/,
});

export const PullExecutionPrefix = createToken({
  name: 'PullExecutionPrefix',
  pattern: /pullExecution:/,
});

export const MinimizedKeyword = createToken({
  name: 'MinimizedKeyword',
  pattern: /minimized\b/,
});

export const SizePrefix = createToken({
  name: 'SizePrefix',
  pattern: /size:/,
});

export const PositionPrefix = createToken({
  name: 'PositionPrefix',
  pattern: /position:/,
});

export const ColorPrefix = createToken({
  name: 'ColorPrefix',
  pattern: /color:/,
});

export const IconPrefix = createToken({
  name: 'IconPrefix',
  pattern: /icon:/,
});

export const TagsPrefix = createToken({
  name: 'TagsPrefix',
  pattern: /tags:/,
});

export const EventEq = createToken({
  name: 'EventEq',
  pattern: /event=/,
});

export const CronEq = createToken({
  name: 'CronEq',
  pattern: /cron=/,
});

export const MatchEq = createToken({
  name: 'MatchEq',
  pattern: /match=/,
});

export const TimeoutEq = createToken({
  name: 'TimeoutEq',
  pattern: /timeout=/,
});

export const LimitEq = createToken({
  name: 'LimitEq',
  pattern: /limit=/,
});

export const PeriodEq = createToken({
  name: 'PeriodEq',
  pattern: /period=/,
});

export const TopKeyword = createToken({
  name: 'TopKeyword',
  pattern: /TOP\b/,
});

export const BottomKeyword = createToken({
  name: 'BottomKeyword',
  pattern: /BOTTOM\b/,
});

export const TrueKeyword = createToken({
  name: 'TrueKeyword',
  pattern: /true\b/,
});

export const FalseKeyword = createToken({
  name: 'FalseKeyword',
  pattern: /false\b/,
});

// =============================================================================
// Operators & Punctuation
// =============================================================================

export const Arrow = createToken({
  name: 'Arrow',
  pattern: /->/,
});

export const Dash = createToken({
  name: 'Dash',
  pattern: /-/,
});

export const Dot = createToken({
  name: 'Dot',
  pattern: /\./,
});

export const Colon = createToken({
  name: 'Colon',
  pattern: /:/,
});

export const Comma = createToken({
  name: 'Comma',
  pattern: /,/,
});

export const Equals = createToken({
  name: 'Equals',
  pattern: /=/,
});

export const LBracket = createToken({
  name: 'LBracket',
  pattern: /\[/,
});

export const RBracket = createToken({
  name: 'RBracket',
  pattern: /\]/,
});

export const LParen = createToken({
  name: 'LParen',
  pattern: /\(/,
});

export const RParen = createToken({
  name: 'RParen',
  pattern: /\)/,
});

export const GreaterThan = createToken({
  name: 'GreaterThan',
  pattern: />/,
});

export const LessThan = createToken({
  name: 'LessThan',
  pattern: /</,
});

export const Pipe = createToken({
  name: 'Pipe',
  pattern: /\|/,
});

export const Ampersand = createToken({
  name: 'Ampersand',
  pattern: /&/,
});

export const LBrace = createToken({
  name: 'LBrace',
  pattern: /\{/,
});

export const RBrace = createToken({
  name: 'RBrace',
  pattern: /\}/,
});

// =============================================================================
// Literals
// =============================================================================

export const Integer = createToken({
  name: 'Integer',
  pattern: /-?\d+/,
});

export const StringLiteral = createToken({
  name: 'StringLiteral',
  pattern: /"(?:[^"\\]|\\.)*"/,
});

export const Identifier = createToken({
  name: 'Identifier',
  // Support / and - for npm package names like npm/react-window/areEqual
  pattern: /[a-zA-Z_$][a-zA-Z0-9_$\/-]*/,
});

// Description text (everything after a dash until end of line)
export const DescriptionText = createToken({
  name: 'DescriptionText',
  pattern: /[^\r\n]+/,
});

// =============================================================================
// Token Order (IMPORTANT: more specific tokens must come before general ones)
// =============================================================================

export const allTokens = [
  // Whitespace (skipped)
  WhiteSpace,
  Newline,

  // Multi-char operators (before single-char)
  Arrow,

  // Tags (before Identifier)
  InputTag,
  OutputTag,
  StepTag,
  NodeTag,
  ConnectTag,
  PositionTag,
  ScopeTag,
  MapTag,
  PathTag,
  FanOutTag,
  FanInTag,
  CoerceTag,
  TriggerTag,
  CancelOnTag,
  RetriesTag,
  TimeoutTag,
  ThrottleTag,
  ParamTag,
  ReturnsTag,
  FlowWeaverTag,
  LabelAttr,
  NameAttr,

  // Attribute prefixes (before Identifier)
  ScopePrefix,
  OrderPrefix,
  PlacementPrefix,
  TypePrefix,
  LabelPrefix,
  PortOrderPrefix,
  PortLabelPrefix,
  ExprPrefix,
  MergeStrategyPrefix,
  PullExecutionPrefix,
  SizePrefix,
  PositionPrefix,
  ColorPrefix,
  IconPrefix,
  TagsPrefix,
  EventEq,
  CronEq,
  MatchEq,
  TimeoutEq,
  LimitEq,
  PeriodEq,

  // Keywords (before Identifier)
  OverKeyword,
  AsKeyword,
  MinimizedKeyword,
  TopKeyword,
  BottomKeyword,
  TrueKeyword,
  FalseKeyword,

  // Literals (Integer before Dash to handle negative numbers)
  Integer,
  StringLiteral,

  // Punctuation
  Asterisk,
  Dash,
  Dot,
  Colon,
  Comma,
  Equals,
  LBracket,
  RBracket,
  LParen,
  RParen,
  GreaterThan,
  LessThan,
  Pipe,
  Ampersand,
  LBrace,
  RBrace,

  // General (must be last)
  Identifier,
  DescriptionText,
];

// =============================================================================
// Lexer Instance
// =============================================================================

export const JSDocLexer = new Lexer(allTokens);
