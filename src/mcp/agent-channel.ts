/**
 * AgentChannel provides Promise-based pause/resume for workflow execution.
 *
 * When a workflow hits a waitForAgent node, the node calls `request()` which
 * suspends execution on an unresolved Promise. The executor detects the pause
 * via `onPause()`, and later calls `resume()` to resolve the Promise and
 * continue execution from exactly where it paused.
 */
export class AgentChannel {
  private _resolve: ((result: object) => void) | null = null;
  private _reject: ((error: Error) => void) | null = null;
  private _pauseResolve: ((request: object) => void) | null = null;
  private _pausePromise: Promise<object>;

  constructor() {
    this._pausePromise = this._createPausePromise();
  }

  /**
   * Called by the waitForAgent node to suspend execution.
   * Returns a Promise that resolves when `resume()` is called.
   */
  async request(agentRequest: object): Promise<object> {
    // Signal the executor that we're pausing
    this._pauseResolve?.(agentRequest);
    // Suspend on a new Promise until resume() or fail() is called
    return new Promise<object>((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
  }

  /**
   * Awaited by the executor to detect when the workflow pauses.
   * Resolves with the agent request data from `request()`.
   */
  onPause(): Promise<object> {
    return this._pausePromise;
  }

  /**
   * Called by fw_resume_workflow to continue execution with the agent's result.
   */
  resume(result: object): void {
    this._resolve?.(result);
    this._resolve = null;
    this._reject = null;
    this._pausePromise = this._createPausePromise();
  }

  /**
   * Called to fail a pending wait with an error.
   */
  fail(reason: string): void {
    this._reject?.(new Error(reason));
    this._resolve = null;
    this._reject = null;
    this._pausePromise = this._createPausePromise();
  }

  private _createPausePromise(): Promise<object> {
    return new Promise<object>((resolve) => {
      this._pauseResolve = resolve;
    });
  }
}
