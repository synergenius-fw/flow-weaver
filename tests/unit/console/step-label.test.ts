/**
 * What a step is called on screen.
 *
 * A workflow with two `waitForAgent` gates showed "Wait For Agent" twice:
 * the node type names what the engine does, and the instance ids ("plan",
 * "build") were the only thing telling the two apart. For those types the
 * id becomes the label and the type is shown beside it instead.
 */
import { describe, it, expect } from 'vitest';
import { stepLabel } from '../../../src/console/server';
import type { TNodeInstanceAST, TNodeTypeAST } from '../../../src/ast/types';

const inst = (id: string, nodeType: string, label?: string) =>
  ({ type: 'NodeInstance', id, nodeType, ...(label ? { config: { label } } : {}) }) as TNodeInstanceAST;

const type = (functionName: string, label?: string) =>
  ({ functionName, name: functionName, ...(label ? { label } : {}) }) as TNodeTypeAST;

describe('stepLabel', () => {
  it('prefers a label the author put on the instance', () => {
    expect(stepLabel(inst('plan', 'waitForAgent', 'Draft the plan'), type('waitForAgent'))).toBe('Draft the plan');
  });

  it('falls back to the node type"s own @label', () => {
    expect(stepLabel(inst('check', 'checkPlan'), type('checkPlan', 'Check Plan'))).toBe('Check Plan');
  });

  it('names a generic built-in after the instance, so two gates differ', () => {
    const t = type('waitForAgent');
    expect(stepLabel(inst('plan', 'waitForAgent'), t)).toBe('Plan');
    expect(stepLabel(inst('build', 'waitForAgent'), t)).toBe('Build');
  });

  it('writes an unlabelled node type as words', () => {
    expect(stepLabel(inst('spec', 'aggregateBuildSpec'), type('aggregateBuildSpec'))).toBe('Aggregate Build Spec');
  });

  it('falls back to the instance"s type name when the type is unknown', () => {
    expect(stepLabel(inst('x', 'someMissingType'), undefined)).toBe('Some Missing Type');
  });

  it('splits snake_case and kebab ids too', () => {
    expect(stepLabel(inst('wait_for_link', 'waitForEvent'), type('waitForEvent'))).toBe('Wait for link');
  });
});
