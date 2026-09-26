/**
 * What the API's route handlers share: the settings they read, the registry
 * and the run store, the run driver, and the declared routes mounted now.
 */
import type { LocalCoordinator } from '../coordinator/index.js';
import type { CallbackPolicy } from './callback-url.js';
import type { CompiledRoute } from './route-plan.js';
import type { RunDriver } from './run-driver.js';
import type { WorkflowRegistry } from './workflow-registry.js';

export interface ApiContext {
  registry: WorkflowRegistry;
  coordinator: LocalCoordinator;
  runs: RunDriver;
  /** Bearer token; unset means open. */
  token?: string;
  /** Error stacks in responses; `mocks` accepted in a start body. */
  dev?: boolean;
  /** Swagger UI at /docs, and /docs and /openapi.json readable without the token. */
  docs?: boolean;
  /** Every workflow also at `POST /workflows/<name>`. */
  legacy: boolean;
  /** Agent gates answered from the profiles. */
  agents: boolean;
  maxBody: number;
  maxWait: number;
  callbackPolicy?: CallbackPolicy;
  /** The declared routes mounted now, and what was refused. Changes when the registry re-discovers. */
  mounted(): { compiled: CompiledRoute[]; problems: string[] };
  /** The OpenAPI document, with links under `base`. */
  openapi(serverUrl: string | undefined, base: string): object;
}
