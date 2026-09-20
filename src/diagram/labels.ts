/**
 * The name a person reads on a step.
 *
 * One rule, shared by the console, the process model, the brief and the
 * SVG: an explicit instance label, else the node type's own label, else --
 * for a generic built-in such as `waitForAgent`, whose function name says
 * nothing about this step -- the instance id as words, else the type's
 * function name as words.
 */
import type { TNodeInstanceAST, TNodeTypeAST } from '../ast/types';

/** Built-ins whose function name says nothing about the step. */
const GENERIC_TYPES = new Set(['waitForEvent', 'waitForAgent', 'delay', 'invokeWorkflow']);

/** `aggregateBuildSpec` → `Aggregate Build Spec`; `wait_for_link` → `Wait for link`. */
export const humanize = (s: string): string =>
  s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function stepLabel(inst: TNodeInstanceAST, nt: TNodeTypeAST | undefined): string {
  if (inst.config?.label) return inst.config.label;
  if (nt?.label) return nt.label;
  const fn = nt?.functionName ?? inst.nodeType;
  return humanize(GENERIC_TYPES.has(fn) ? inst.id : fn);
}
