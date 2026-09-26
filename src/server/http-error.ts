/**
 * The failures the API answers with. An `HttpError` carries its own status,
 * code and headers; `errorToHttp` decides the status and code for everything
 * else a handler can throw -- a coordinator refusal, a parse error, a crash.
 */
import {
  ParseError,
  AmbiguousWorkflowError,
  RunNotFoundError,
  RunNotWaitingError,
  BundleChangedError,
  MissingOutputsError,
  InvalidAnswerError,
  RunBusyError,
  MissingParamsError,
} from '../coordinator/index.js';
import { getErrorMessage } from '../utils/error-utils.js';

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown, readonly headers?: Record<string, string>) {
    super(message);
    this.name = 'HttpError';
  }
}

/** The status and code a coordinator refusal maps to. */
export function errorToHttp(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof ParseError) return new HttpError(400, 'PARSE_ERROR', err.message);
  if (err instanceof AmbiguousWorkflowError) return new HttpError(400, 'AMBIGUOUS_WORKFLOW', err.message);
  if (err instanceof RunNotFoundError) return new HttpError(404, 'RUN_NOT_FOUND', err.message);
  if (err instanceof RunNotWaitingError) return new HttpError(409, 'RUN_NOT_WAITING', err.message);
  if (err instanceof BundleChangedError) return new HttpError(409, 'BUNDLE_CHANGED', err.message);
  if (err instanceof MissingOutputsError) return new HttpError(400, 'MISSING_OUTPUTS', err.message);
  if (err instanceof InvalidAnswerError) return new HttpError(400, 'INVALID_INPUT', err.message);
  if (err instanceof RunBusyError) return new HttpError(409, 'RUN_IN_FLIGHT', err.message, undefined, { 'Retry-After': '2' });
  if (err instanceof MissingParamsError) return new HttpError(400, 'VALIDATION_ERROR', err.message, err.missing.map((k) => ({ path: k, message: 'required' })));
  const name = (err as { name?: string })?.name;
  if (name === 'ContinuationRefusalError') return new HttpError(409, 'CONTINUATION_REFUSED', getErrorMessage(err));
  return new HttpError(500, 'EXECUTION_ERROR', getErrorMessage(err));
}
