import type { AppConfig, TaskResult } from './types.js';

/**
 * Expression node that returns an external type.
 * Bug 3: generated code will have `as AppConfig` — bare name not in scope.
 *
 * @flowWeaver nodeType
 * @expression
 * @label Parse Config
 * @input raw - Raw JSON string
 * @output config - Parsed config
 */
export function parseConfig(raw: string): AppConfig {
  return JSON.parse(raw);
}

/**
 * Non-expression node that takes an external type as input.
 * Bug 4: getVariable cast uses bare type or Record<string, unknown> — mismatch.
 *
 * Note: this node explicitly returns onSuccess/onFailure in its TS type,
 * so Bug 5 does NOT manifest here.
 *
 * @flowWeaver nodeType
 * @label Run Task
 * @input config - App configuration
 * @output result - Task result
 */
export function runTask(
  execute: boolean,
  config: AppConfig,
): { onSuccess: boolean; onFailure: boolean; result: TaskResult } {
  if (!execute) return { onSuccess: false, onFailure: false, result: { output: '', duration: 0 } };
  return { onSuccess: true, onFailure: false, result: { output: `ran ${config.name}`, duration: 42 } };
}

/**
 * Non-expression node whose TS return type does NOT include onSuccess/onFailure.
 * Bug 5: compiler reads result.onSuccess but TS doesn't know it exists.
 *
 * At runtime, flow-weaver's STEP Port Architecture means onSuccess/onFailure
 * ARE present on the result object. But TS only sees { summary: string }.
 *
 * @flowWeaver nodeType
 * @label Report
 * @input result - Task result to report
 * @output summary - Summary text
 */
export function reportTask(
  execute: boolean,
  result: TaskResult,
): { onSuccess: boolean; onFailure: boolean; summary: string } {
  if (!execute) return { onSuccess: false, onFailure: false, summary: '' };
  return { onSuccess: true, onFailure: false, summary: `Done: ${result.output} in ${result.duration}ms` };
}
