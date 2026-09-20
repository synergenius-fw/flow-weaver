/**
 * The figma-to-page use case, driven down each of its three ending arms.
 *
 * It is the workflow that surfaced the undefined-execution-index bug: its
 * `finish` node converges a refused link, a refused plan and a completed
 * build, so on the two rejection arms it reads ports from gates that never
 * ran. The unit fixture pins the mechanism. This pins the real graph.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { executeWorkflow } from '../../src/mcp/workflow-executor.js';

/**
 * A gate's payload carries its inputs positionally, each tagged so an omitted
 * optional argument stays distinct from an explicit null.
 */
const gateArgs = (payload: unknown): unknown[] =>
  ((payload as { arguments?: Array<{ value?: unknown }> }).arguments ?? []).map(
    (entry) => entry.value,
  );

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'use-cases',
  'figma-to-page',
  'figma-to-page.ts',
);
const bundleDigest = `sha256:${'d'.repeat(64)}`;
const params = { request: { goal: 'Build the pricing page' } };

const start = (runId: string) =>
  executeWorkflow({
    runId,
    bundleDigest,
    filePath: fixture,
    workflowName: 'figmaToPage',
    params,
    production: false,
  });

describe('figma-to-page ending arms', () => {
  it('refuses a link that is not a Figma design link', async () => {
    const yielded = await start('figma-bad-link');
    if (yielded.kind !== 'yielded') throw new Error('expected the input gate to yield');

    const outcome = await executeWorkflow({
      runId: 'figma-bad-link',
      bundleDigest,
      filePath: fixture,
      workflowName: 'figmaToPage',
      params,
      production: false,
      continuation: yielded.continuation,
      resolution: {
        gateId: yielded.gate.id,
        value: {
          onSuccess: true,
          onFailure: false,
          eventData: { link: 'https://docs.google.com/document/d/abc123/edit' },
        },
      },
    });

    if (outcome.kind !== 'completed') throw new Error('expected completion');
    const result = outcome.result as { status?: unknown; outcome?: unknown };
    expect(result.status).toBe('refused');
    expect(String(result.outcome)).toMatch(/not a Figma design link/);
  });

  it('refuses a plan that blows the token budget', async () => {
    const atLink = await start('figma-long-plan');
    if (atLink.kind !== 'yielded') throw new Error('expected the input gate to yield');

    const atPlan = await executeWorkflow({
      runId: 'figma-long-plan',
      bundleDigest,
      filePath: fixture,
      workflowName: 'figmaToPage',
      params,
      production: false,
      continuation: atLink.continuation,
      resolution: {
        gateId: atLink.gate.id,
        value: {
          onSuccess: true,
          onFailure: false,
          eventData: { link: 'https://www.figma.com/design/ab12CD34ef56/Pricing-Page?node-id=41-207' },
        },
      },
    });
    if (atPlan.kind !== 'yielded') throw new Error('expected the agent gate to yield');

    const outcome = await executeWorkflow({
      runId: 'figma-long-plan',
      bundleDigest,
      filePath: fixture,
      workflowName: 'figmaToPage',
      params,
      production: false,
      continuation: atPlan.continuation,
      resolution: {
        gateId: atPlan.gate.id,
        value: {
          onSuccess: true,
          onFailure: false,
          agentResult: {
            summary: 'x'.repeat(201),
            steps: ['a'],
            risks: '',
          },
        },
      },
    });

    if (outcome.kind !== 'completed') throw new Error('expected completion');
    const result = outcome.result as { status?: unknown; outcome?: unknown };
    expect(result.status).toBe('refused');
    expect(String(result.outcome)).toMatch(/plan too long: summary is 201 characters/);
  });

  it('hands the building agent a fully resolved spec on the happy path', async () => {
    const atLink = await start('figma-happy');
    if (atLink.kind !== 'yielded') throw new Error('expected the input gate to yield');

    const atPlan = await executeWorkflow({
      runId: 'figma-happy',
      bundleDigest,
      filePath: fixture,
      workflowName: 'figmaToPage',
      params,
      production: false,
      continuation: atLink.continuation,
      resolution: {
        gateId: atLink.gate.id,
        value: {
          onSuccess: true,
          onFailure: false,
          eventData: { link: 'https://www.figma.com/design/ab12CD34ef56/Pricing-Page?node-id=41-207' },
        },
      },
    });
    if (atPlan.kind !== 'yielded') throw new Error('expected the agent gate to yield');

    // The planning gate sees counts, not the mapping table.
    const digest = gateArgs(atPlan.gate.payload)[1] as Record<string, unknown>;
    expect(digest.componentCount).toBe(15);
    expect(digest.unmatched).toEqual(['Toggle/BillingPeriod']);
    expect(digest).not.toHaveProperty('matched');

    const atApproval = await executeWorkflow({
      runId: 'figma-happy',
      bundleDigest,
      filePath: fixture,
      workflowName: 'figmaToPage',
      params,
      production: false,
      continuation: atPlan.continuation,
      resolution: {
        gateId: atPlan.gate.id,
        value: {
          onSuccess: true,
          onFailure: false,
          agentResult: {
            summary: 'Build it from the resolved spec.',
            steps: ['Apply tokens', 'Render sections'],
            risks: 'Billing toggle is unmatched.',
          },
        },
      },
    });
    if (atApproval.kind !== 'yielded') throw new Error('expected the approval gate to yield');

    // The approval gate carries the plan and nothing else: one argument, and
    // no sign of the mapping that `spec` reads across the gate instead.
    const approvalArgs = gateArgs(atApproval.gate.payload);
    expect(approvalArgs).toHaveLength(1);
    expect(approvalArgs[0]).toHaveProperty('summary');
    expect(JSON.stringify(atApproval.gate.payload)).not.toMatch(/importPath/);

    const atBuild = await executeWorkflow({
      runId: 'figma-happy',
      bundleDigest,
      filePath: fixture,
      workflowName: 'figmaToPage',
      params,
      production: false,
      continuation: atApproval.continuation,
      resolution: {
        gateId: atApproval.gate.id,
        value: {
          onSuccess: true,
          onFailure: false,
          decision: { approved: true, approver: 'ricardo', note: '' },
        },
      },
    });
    if (atBuild.kind !== 'yielded') throw new Error('expected the build gate to yield');

    // Every lookup is already done by the time the building agent is woken.
    const spec = gateArgs(atBuild.gate.payload)[1] as {
      imports?: string[];
      sections?: Array<{ section: string; instances: unknown[] }>;
      omitted?: string[];
    };
    expect(spec.imports).toContain("import { Heading, Text } from '@ui/typography';");
    expect(spec.sections?.map((s) => s.section)).toEqual(['hero', 'tiers', 'faq']);
    expect(spec.omitted).toEqual(['Toggle/BillingPeriod']);

    const outcome = await executeWorkflow({
      runId: 'figma-happy',
      bundleDigest,
      filePath: fixture,
      workflowName: 'figmaToPage',
      params,
      production: false,
      continuation: atBuild.continuation,
      resolution: {
        gateId: atBuild.gate.id,
        value: {
          onSuccess: true,
          onFailure: false,
          agentResult: { files: ['app/pricing/page.tsx'], notes: 'Toggle left as a TODO.' },
        },
      },
    });

    if (outcome.kind !== 'completed') throw new Error('expected completion');
    const result = outcome.result as { status?: unknown; outcome?: unknown };
    expect(result.status).toBe('built');
    expect(String(result.outcome)).toMatch(/approved by ricardo/);
  });
});
