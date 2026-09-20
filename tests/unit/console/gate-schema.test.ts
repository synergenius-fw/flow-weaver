/**
 * A gate's answer form is only as good as the shape behind it.
 *
 * An authored gate declares its outputs in its own return type. A built-in
 * gate (`waitForEvent`, `waitForAgent`) has no source of its own, so the
 * shape is read from the parameter that consumes the output downstream --
 * otherwise the gates people answer most often get an opaque JSON box.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { nodeOutputSchema, nodeInputSchema } from '../../../src/console/schema';

const useCases = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'use-cases');
const figma = path.join(useCases, 'figma-to-page', 'figma-to-page.ts');
const invoices = path.join(useCases, 'batch-invoices', 'batch-invoices.ts');

describe('gate answer schemas', () => {
  it('reads an authored gate from its own return type, without the control ports', () => {
    const out = nodeOutputSchema(figma, 'approvePlan');
    expect(out).not.toBeNull();
    expect(Object.keys(out!)).toEqual(['decision']);
    expect(out!.decision).toMatchObject({
      type: 'object',
      fields: {
        approved: { type: 'boolean' },
        approver: { type: 'string' },
        note: { type: 'string' },
      },
    });
  });

  it('reads a built-in gate from the parameter that consumes it', () => {
    // `link.eventData` feeds `parseFigmaLink(execute, eventData, goal)`.
    const schema = nodeInputSchema(figma, 'parseFigmaLink', 'eventData');
    expect(schema).not.toBeNull();
    expect(schema!.type).toBe('object');
  });

  it('resolves a named type through to its fields', () => {
    const schema = nodeInputSchema(invoices, 'rateInvoice', 'invoice');
    expect(schema).toMatchObject({
      type: 'object',
      fields: {
        id: { type: 'string' },
        customer: { type: 'string' },
        amountCents: { type: 'number' },
        currency: { type: 'string' },
      },
    });
  });

  it('marks an optional parameter optional, so the form does not demand it', () => {
    // `report([summary], [rejection])` is reachable down either arm.
    const schema = nodeInputSchema(invoices, 'report', 'summary');
    expect(schema).not.toBeNull();
    expect(schema!.type).toBe('object');
  });

  it('leaves a free-form record free-form rather than inventing fields', () => {
    // `Record<string, number>` has no declared properties: a JSON field is
    // the honest rendering, not an empty form.
    const schema = nodeInputSchema(invoices, 'rateInvoice', 'rates');
    expect(schema).toMatchObject({ type: 'object' });
    expect((schema as { fields?: unknown }).fields).toBeUndefined();
  });

  it('returns null for something that is not there, instead of throwing', () => {
    expect(nodeOutputSchema(figma, 'noSuchFunction')).toBeNull();
    expect(nodeInputSchema(figma, 'approvePlan', 'noSuchParam')).toBeNull();
    expect(nodeOutputSchema('/nope/missing.ts', 'x')).toBeNull();
  });
});
