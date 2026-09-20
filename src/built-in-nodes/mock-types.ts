/**
 * Type definitions for the mock configuration used during local testing.
 * Built-in nodes receive this data through one execution-scoped runtime.
 */
import type { NodeExecutionRuntime } from '../runtime/durable-execution.js';

export interface FwMockConfig {
  /** Mock event data keyed by event name. Used by waitForEvent to answer the gate without pausing. */
  events?: Record<string, object>;
  /** Mock invocation results keyed by functionId. Used by invokeWorkflow. */
  invocations?: Record<string, object>;
  /** Mock agent results keyed by agentId. Used by waitForAgent to answer the gate without pausing. */
  agents?: Record<string, object>;
  /**
   * An answer for any durable gate, keyed by the node's instance id: the
   * gate's data outputs as an object (`{ decision: { approved: true } }`).
   * The run goes through the gate as if a person had answered that.
   */
  gates?: Record<string, object>;
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
 * Checks "instanceId:key" first (for per-node targeting), then
 * "instanceId:*" (whatever key this node asks for), then falls back to
 * plain "key".
 *
 * @example
 * ```json
 * {
 *   "invocations": {
 *     "retryCall:api/process": { "status": "ok" },
 *     "api/process": { "status": "default" }
 *   },
 *   "events": {
 *     "link:*": { "url": "https://figma.com/file/abc" }
 *   }
 * }
 * ```
 * When the node "retryCall" invokes "api/process", it gets `{ status: "ok" }`.
 * Any other node invoking "api/process" gets `{ status: "default" }`. The
 * node "link" gets its event whatever name it waits for -- the name is
 * often computed at run time, and the console mocks by node, not by name.
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
    const any = section[`${nodeId}:*`];
    if (any !== undefined) return any;
  }

  return section[key];
}
