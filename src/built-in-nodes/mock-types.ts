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
