/**
 * The refusals the coordinator throws.
 *
 * Each one decides what a driver is told when a run cannot be started or
 * moved: the file did not parse or names several workflows, there is no
 * such run, the run is not waiting at a gate, or the workflow changed since
 * the run paused. A driver tells them apart by `name`, as `tick` does.
 */
import type { RunView } from './run-store.js';

export class ParseError extends Error {
  readonly name = 'ParseError';
}
export class AmbiguousWorkflowError extends Error {
  readonly name = 'AmbiguousWorkflowError';
  constructor(readonly names: readonly string[]) {
    super(`file declares several workflows. Pass workflowName, one of: ${names.join(', ')}`);
  }
}
export class RunNotFoundError extends Error {
  readonly name = 'RunNotFoundError';
  constructor(runId: string) {
    super(`no run with id ${runId}`);
  }
}
export class RunNotWaitingError extends Error {
  readonly name = 'RunNotWaitingError';
  constructor(readonly status: RunView['status']) {
    super(`run is ${status}, not waiting at a gate`);
  }
}
export class BundleChangedError extends Error {
  readonly name = 'BundleChangedError';
  constructor() {
    super('workflow or its compiled output changed since the run paused. Start a new run');
  }
}
