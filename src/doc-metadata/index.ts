export { extractMcpTools, MCP_TOOLS } from './extractors/mcp-tools.js';
export { extractCliCommands, CLI_COMMANDS } from './extractors/cli-commands.js';
export {
  PLUGIN_DEFINITION_FIELDS,
  PLUGIN_CAPABILITIES,
  PLUGIN_COMPONENT_CONFIG_FIELDS,
  PLUGIN_COMPONENT_AREAS,
  PLUGIN_UI_KIT_COMPONENTS,
} from './extractors/plugin-api.js';
export {
  ALL_ANNOTATIONS,
  PORT_MODIFIERS,
  NODE_MODIFIERS,
} from './extractors/annotations.js';
export { VALIDATION_CODES } from './extractors/error-codes.js';
export type { TValidationCodeDoc } from './extractors/error-codes.js';
export { extractGrammarEBNF, extractTerminals } from './extractors/grammar-rules.js';
export type { TGrammarGroupDoc, TTerminalDoc } from './extractors/grammar-rules.js';
export type { TMcpToolDoc, TMcpToolParam, TPluginApiFieldDoc, TCliCommandDoc, TCliOptionDoc } from './types.js';

// Core metadata — data types, strategies, reserved names, templates, package exports
export {
  DATA_TYPES,
  MERGE_STRATEGIES,
  BRANCHING_STRATEGY_VALUES,
  EXECUTION_STRATEGY_VALUES,
  RESERVED_NODE_NAMES,
  RESERVED_PORT_NAMES,
  SCOPED_PORT_NAMES,
  EXECUTION_STRATEGIES,
  BRANCHING_STRATEGIES,
  VALID_NODE_COLORS,
  WORKFLOW_TEMPLATES,
  NODE_TEMPLATES,
  PACKAGE_EXPORTS,
} from './extractors/core-metadata.js';
export type { TemplateSummary } from './extractors/core-metadata.js';
