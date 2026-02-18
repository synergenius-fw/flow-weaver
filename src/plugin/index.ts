/**
 * @synergenius/flow-weaver/plugin
 *
 * Public API for external plugin development.
 */

export type {
  TPluginComponentArea,
  TPluginComponentConfig,
  TPluginComponentApi,
  TPluginComponentProps,
  TPluginUI,
  TPluginInitializer,
  TPluginInitializerResult,
  TPluginSystemModule,
  TPluginCapabilities,
  TPluginDefinition,
} from './types.js';

export { PluginPanel } from './PluginPanel.js';

/**
 * Convenience wrapper — marks a function as a plugin initializer.
 * At runtime this is a passthrough; it exists for discoverability and typing.
 */
export function createPlugin(fn: () => import('./types.js').TPluginInitializerResult) {
  return fn;
}
