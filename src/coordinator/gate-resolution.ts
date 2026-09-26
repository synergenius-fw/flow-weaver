import { validateWireValue } from '../runtime/continuation.js';
import type { GateResolution } from '../runtime/durable-execution.js';
import type { LabeledGate } from './gate-labeling.js';

/** What a driver sends back for a paused gate: a result, or a refusal. */
export type ResolveInput = { answer: unknown } | { reject: string };

export class MissingOutputsError extends Error {
  readonly name = 'MissingOutputsError';

  constructor(readonly missing: readonly string[]) {
    super(`answer is missing gate outputs: ${missing.join(', ')}`);
  }
}

export class InvalidAnswerError extends Error {
  readonly name = 'InvalidAnswerError';
}

/**
 * Build the resolution the engine expects from what a driver actually knows.
 *
 * The engine takes the resolution value as the gate node's *entire* output
 * envelope, control ports included (`resolveGate` in `durable-execution.ts`). Sending
 * only the data port is accepted and then quietly wrong: `onSuccess` is never
 * set, the successor never fires, and the run reports `completed` with
 * `onSuccess: false`. A driver should never have to know that, so the
 * control ports are filled in here.
 */
export function buildGateResolution(
  gate: Pick<LabeledGate, 'outputs' | 'hasSuccessPort' | 'hasFailurePort'>,
  gateId: string,
  input: ResolveInput,
): GateResolution {
  const value: Record<string, unknown> = {};

  if ('reject' in input) {
    if (gate.hasSuccessPort) value.onSuccess = false;
    if (gate.hasFailurePort) value.onFailure = true;
    for (const port of gate.outputs) value[port] = null;
  } else {
    if (gate.hasSuccessPort) value.onSuccess = true;
    if (gate.hasFailurePort) value.onFailure = false;
    Object.assign(value, dataPorts(gate.outputs, input.answer));
  }

  // Refuse undefined, functions, dates and the like here, with a message
  // that names the problem, instead of deep inside the continuation decoder.
  try {
    validateWireValue(value);
  } catch (error) {
    throw new InvalidAnswerError(error instanceof Error ? error.message : String(error));
  }
  return { gateId, value: value };
}

function dataPorts(outputs: readonly string[], answer: unknown): Record<string, unknown> {
  if (outputs.length === 0) {
    if (answer !== null && answer !== undefined) {
      throw new InvalidAnswerError('this gate has no data outputs, so answer must be null');
    }
    return {};
  }

  if (outputs.length === 1) {
    return { [outputs[0]]: answer };
  }

  if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) {
    throw new MissingOutputsError(outputs);
  }
  const record = answer as Record<string, unknown>;
  const missing = outputs.filter((port) => !(port in record));
  if (missing.length > 0) throw new MissingOutputsError(missing);

  const picked: Record<string, unknown> = {};
  for (const port of outputs) picked[port] = record[port];
  return picked;
}
