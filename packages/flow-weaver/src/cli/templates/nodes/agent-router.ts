import type { NodeTemplate } from '../index';
import { toPascalCase } from '../index';

export const agentRouterNodeTemplate: NodeTemplate = {
  id: 'agent-router',
  name: 'Agent Router',
  description: 'Route to different handlers based on a classification result',
  category: 'ai',
  generate: (name: string): string => {
    const funcName = name || 'agentRouter';
    const label = toPascalCase(funcName);
    return `
// ============================================================
// ROUTE DEFINITIONS
// ============================================================
//
// Define your routes here. The router matches the 'category' input
// (from an upstream LLM call) against route names using case-insensitive
// comparison. The last route is used as a default/fallback.
//
// Example wiring in a workflow:
//   llmCall.content → agentRouter.category
//   agentRouter.selectedRoute → (use for downstream branching)

interface Route {
  name: string;
  description: string;
}

const DEFAULT_ROUTES: Route[] = [
  { name: 'billing', description: 'Billing inquiries, invoices, payments' },
  { name: 'technical', description: 'Technical support, bugs, troubleshooting' },
  { name: 'general', description: 'General questions (default fallback)' },
];

/**
 * Route to different handlers based on a classification result.
 * Matches the category string against route names (case-insensitive).
 * Falls back to the last route if no match is found.
 *
 * @flowWeaver nodeType
 * @label ${label}
 * @color blue
 * @icon altRoute
 * @input execute [order:0] - Execute
 * @input category [order:1] - Classification result (from upstream LLM call)
 * @input routes [order:2] - Available routes with name and description (optional)
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure (no routes provided)
 * @output selectedRoute [order:2] - Name of the matched route
 * @output routeDescription [order:3] - Description of the matched route
 * @output isDefault [order:4] - Whether the default/fallback route was used
 */
function ${funcName}(
  execute: boolean,
  category: string,
  routes?: Route[]
): {
  onSuccess: boolean;
  onFailure: boolean;
  selectedRoute: string;
  routeDescription: string;
  isDefault: boolean;
} {
  if (!execute) {
    return {
      onSuccess: false,
      onFailure: false,
      selectedRoute: '',
      routeDescription: '',
      isDefault: false,
    };
  }

  const activeRoutes = routes && routes.length > 0 ? routes : DEFAULT_ROUTES;

  if (activeRoutes.length === 0) {
    return {
      onSuccess: false,
      onFailure: true,
      selectedRoute: '',
      routeDescription: '',
      isDefault: false,
    };
  }

  // Case-insensitive match against route names
  const normalized = (category || '').trim().toLowerCase();
  const matched = activeRoutes.find(
    (r) => r.name.toLowerCase() === normalized
  );

  if (matched) {
    return {
      onSuccess: true,
      onFailure: false,
      selectedRoute: matched.name,
      routeDescription: matched.description,
      isDefault: false,
    };
  }

  // Fallback to last route as default
  const fallback = activeRoutes[activeRoutes.length - 1];
  return {
    onSuccess: true,
    onFailure: false,
    selectedRoute: fallback.name,
    routeDescription: fallback.description,
    isDefault: true,
  };
}
`.trim();
  },
};
