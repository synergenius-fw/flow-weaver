/**
 * Type definitions for the mock configuration used during local testing.
 * When present on globalThis.__fw_mocks__, built-in nodes use mock data
 * instead of their default no-op/sleep behavior.
 */

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
 * Read the mock config from globalThis, returning undefined if not set.
 */
export function getMockConfig(): FwMockConfig | undefined {
  return (globalThis as unknown as Record<string, unknown>).__fw_mocks__ as
    | FwMockConfig
    | undefined;
}

/**
 * Look up a mock value from a section, supporting instance-qualified keys.
 *
 * Checks "instanceId:key" first (for per-node targeting), then falls back
 * to plain "key". The instance ID comes from __fw_current_node_id__ which
 * the generated code sets before each node invocation.
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
export function lookupMock<T>(section: Record<string, T> | undefined, key: string): T | undefined {
  if (!section) return undefined;

  const nodeId = (globalThis as unknown as Record<string, unknown>).__fw_current_node_id__ as
    | string
    | undefined;
  if (nodeId) {
    const qualified = section[`${nodeId}:${key}`];
    if (qualified !== undefined) return qualified;
  }

  return section[key];
}
