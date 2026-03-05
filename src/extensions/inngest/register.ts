/**
 * Inngest extension self-registration module.
 * Loaded as a side-effect import from src/extensions/index.ts.
 */

import { compileTargetRegistry } from '../../generator/compile-target-registry.js';
import { devModeRegistry } from '../../generator/dev-mode-registry.js';
import { registerWorkflowTemplates } from '../../cli/templates/index.js';
import { generateInngestFunction } from './generator.js';
import { runInngestDevMode } from './dev-mode.js';
import { aiAgentDurableTemplate } from './templates/ai-agent-durable.js';
import { aiPipelineDurableTemplate } from './templates/ai-pipeline-durable.js';

compileTargetRegistry.register({
  name: 'inngest',
  compile(workflow, nodeTypes, options) {
    return generateInngestFunction(workflow, nodeTypes, options);
  },
});

devModeRegistry.register({
  name: 'inngest',
  run: runInngestDevMode,
});

registerWorkflowTemplates([aiAgentDurableTemplate, aiPipelineDurableTemplate]);
