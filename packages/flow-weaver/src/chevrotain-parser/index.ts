/**
 * @module chevrotain-parser
 *
 * Chevrotain-based parsers for JSDoc annotations.
 * Provides structured parsing for @input, @output, @node, @connect, and @position.
 */

// Token exports (for advanced use cases)
export {
  JSDocLexer,
  allTokens,
  InputTag,
  OutputTag,
  NodeTag,
  ConnectTag,
  PositionTag,
  ScopeTag,
  MapTag,
  PathTag,
  TriggerTag,
  CancelOnTag,
  RetriesTag,
  TimeoutTag,
  ThrottleTag,
} from './tokens';

// Port parser
export { parsePortLine, getPortGrammar } from './port-parser';
export type { PortParseResult } from './port-parser';

// Node parser
export { parseNodeLine, getNodeGrammar } from './node-parser';
export type { NodeParseResult } from './node-parser';

// Connect parser
export { parseConnectLine, getConnectGrammar } from './connect-parser';
export type { ConnectParseResult, PortReference } from './connect-parser';

// Position parser
export { parsePositionLine, getPositionGrammar } from './position-parser';
export type { PositionParseResult } from './position-parser';

// Scope parser
export { parseScopeLine, getScopeGrammar } from './scope-parser';
export type { ScopeParseResult } from './scope-parser';

// Map parser
export { parseMapLine, getMapGrammar } from './map-parser';
export type { MapParseResult } from './map-parser';

// Path parser
export { parsePathLine, getPathGrammar } from './path-parser';
export type { PathParseResult, PathStep } from './path-parser';

// Trigger/cancel/retries/timeout/throttle parser
export { parseTriggerLine, parseCancelOnLine, parseRetriesLine, parseTimeoutLine, parseThrottleLine } from './trigger-cancel-parser';
export type { TriggerParseResult, CancelOnParseResult, ThrottleParseResult } from './trigger-cancel-parser';

// Grammar diagram generation
export { generateGrammarDiagrams, getAllGrammars, serializedToEBNF } from './grammar-diagrams';
