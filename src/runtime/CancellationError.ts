/**
 * Error thrown when workflow execution is cancelled via AbortSignal.
 */
export class CancellationError extends Error {
  constructor(
    message: string = "Workflow execution cancelled",
    public readonly executionIndex: number = 0,
    public readonly nodeId?: string,
    public readonly timestamp: number = Date.now()
  ) {
    super(message);
    this.name = "CancellationError";
  }

  static isCancellationError(error: unknown): error is CancellationError {
    return (
      error instanceof CancellationError ||
      (error instanceof Error && error.name === "CancellationError")
    );
  }
}
