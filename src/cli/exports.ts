/**
 * CLI utilities — public barrel for export target packs.
 *
 * Exposes CLI internals that marketplace packs need: template types,
 * provider code generators, LLM type snippets, compileCustomTarget,
 * and the logger.
 */

// Template system
export type {
  WorkflowTemplate,
  WorkflowTemplateOptions,
  NodeTemplate,
  ConfigSchema,
  ConfigField,
  ConfigFieldType,
} from './templates/index.js';
export {
  registerWorkflowTemplates,
  getAllWorkflowTemplates,
  getWorkflowTemplate,
} from './templates/index.js';

// Template providers
export {
  getProviderCode,
  generateOpenAIProvider,
  generateAnthropicProvider,
  generateOllamaProvider,
  generateMockProvider,
  type ProviderCodeOptions,
} from './templates/providers/index.js';

// Template shared types (LLM stubs)
export {
  LLM_CORE_TYPES,
  LLM_SIMPLE_TYPES,
  LLM_MOCK_PROVIDER,
  LLM_MOCK_PROVIDER_WITH_TOOLS,
} from './templates/shared/llm-types.js';

// AI agent config schema (reused by durable variants)
export { aiConfigSchema } from './templates/workflows/ai-agent.js';

// Init persona registration
export { registerPackUseCase } from './commands/init-personas.js';

// Compile target execution
export { compileCustomTarget } from './commands/compile.js';

// Logger
export { logger } from './utils/logger.js';

// Error utilities
export { getErrorMessage, wrapError } from '../utils/error-utils.js';
