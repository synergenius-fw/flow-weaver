/**
 * Type definitions for the mock configuration used during local testing.
 * Built-in nodes receive this data through one execution-scoped runtime.
 */
import type { NodeExecutionRuntime } from '../runtime/durable-execution.js';

export interface FwMockConfig {
  /** Mock event data keyed by event name. Used by waitForEvent. */
  events?: Record<string, object>;
  /** Mock invocation results keyed by functionId. Used by invokeWorkflow. */
  invocations?: Record<string, object>;
  /** Mock agent results keyed by agentId. Used by waitForAgent. */
  agents?: Record<string, object>;
  /** When true, delay nodes skip the real sleep (1ms instead of full duration). */
  fast?: boolean;
}

/**
 * Read mock configuration from the execution-scoped runtime.
 */
export function getMockConfig(runtime?: NodeExecutionRuntime): FwMockConfig | undefined {
  return runtime?.runtime.services.mocks;
}

/**
 * Look up a mock value from a section, supporting instance-qualified keys.
 *
 * Checks "instanceId:key" first (for per-node targeting), then falls back
 * to plain "key".
 *
 * @example
 * ```json
 * {
 *   "invocations": {
 *     "retryCall:api/process": { "status": "ok" },
 *     "api/process": { "status": "default" }
 *   }
 * }
 * ```
 * When the node "retryCall" invokes "api/process", it gets `{ status: "ok" }`.
 * Any other node invoking "api/process" gets `{ status: "default" }`.
 */
export function lookupMock<T>(
  section: Record<string, T> | undefined,
  key: string,
  runtime?: NodeExecutionRuntime,
): T | undefined {
  if (!section) return undefined;

  const nodeId = runtime?.nodeId;
  if (nodeId) {
    const qualified = section[`${nodeId}:${key}`];
    if (qualified !== undefined) return qualified;
  }

  return section[key];
}
