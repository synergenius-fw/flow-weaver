export { extractMcpTools, MCP_TOOLS } from './extractors/mcp-tools.js';
export { extractCliCommands, CLI_COMMANDS } from './extractors/cli-commands.js';
export {
  PLUGIN_DEFINITION_FIELDS,
  PLUGIN_CAPABILITIES,
  PLUGIN_COMPONENT_CONFIG_FIELDS,
  PLUGIN_COMPONENT_AREAS,
  PLUGIN_UI_KIT_COMPONENTS,
} from './extractors/plugin-api.js';
export type { TMcpToolDoc, TMcpToolParam, TPluginApiFieldDoc, TCliCommandDoc, TCliOptionDoc } from './types.js';
