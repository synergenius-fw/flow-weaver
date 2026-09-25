/**
 * Canned answers for a run under test, carried by the execution-scoped
 * runtime (`runtime.services.mocks`).
 *
 * Who reads them is the point. A compiled workflow never calls the bodies of
 * `waitForEvent`, `waitForAgent` or `sleep`: the generator emits a durable
 * gate in their place, and the engine (`mockedGateAnswer` in
 * `src/runtime/durable-execution.ts`) answers that gate from here before it
 * yields. The bodies of those three nodes throw if reached. `invokeWorkflow`
 * and `delay` do run as functions and read `invocations` and `fast`
 * themselves.
 *
 * How a gate is answered, in this order:
 *
 * - `gates[nodeId]` answers any gate, built-in or authored, with the gate's
 *   data outputs; control ports are filled in as for a person's answer.
 * - `waitForAgent` also reads `agents` and `waitForEvent` reads `events`,
 *   keyed by the node's first input (the agent id, the event name), by
 *   `nodeId:key`, or by `nodeId:*` (the lookup `lookupMock` describes).
 * - `sleep` wakes at once under `fast`, as `delay` returns at once.
 * - A gate no entry answers yields for a person, whether or not its section
 *   exists: an `agents` section without this agent's key is a wait, not a
 *   failure. Nothing takes the failure path on a missing key.
 */
import type { NodeExecutionRuntime } from '../runtime/durable-execution.js';

export interface FwMockConfig {
  /** Event payloads keyed by event name (or `nodeId:name`, `nodeId:*`). Answers a `waitForEvent` gate. */
  events?: Record<string, object>;
  /** Invocation results keyed by functionId (or `nodeId:functionId`, `nodeId:*`). Read by `invokeWorkflow` itself. */
  invocations?: Record<string, object>;
  /** Agent results keyed by agent id (or `nodeId:agentId`, `nodeId:*`). Answers a `waitForAgent` gate. */
  agents?: Record<string, object>;
  /**
   * An answer for any durable gate, keyed by the node's instance id: the
   * gate's data outputs as an object (`{ decision: { approved: true } }`).
   * The run goes through the gate as if a person had answered that.
   */
  gates?: Record<string, object>;
  /** When true, `delay` waits 1ms instead of its duration and a `sleep` gate wakes at once. */
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
