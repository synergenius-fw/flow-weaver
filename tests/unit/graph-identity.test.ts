/**
 * One graph identity for three consumers: the fingerprint the executor checks
 * a continuation against, the one the artifact compiler writes into its
 * metadata, and the one the generator bakes into a gated body are the same
 * number, and it depends on the graph, not on where the file sits.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getWorkflowTemplate } from '../../src/cli/templates/index.js';
import { parseWorkflow } from '../../src/api/parse.js';
import { compileWorkflow } from '../../src/api/compile.js';
import { graphIdentity } from '../../src/api/graph-identity.js';
import { compileExecutableWorkflowArtifact } from '../../src/compiler/executable-artifact.js';

let dir: string;
const source = (input = 'request') => getWorkflowTemplate('approval')!.generate({ workflowName: 'approveSpend', config: { input } });

async function identityOf(file: string) {
  const parsed = await parseWorkflow(file, { projectDir: path.dirname(file) });
  expect(parsed.errors).toEqual([]);
  return graphIdentity(parsed.ast, parsed.allWorkflows);
}

beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-graph-identity-')); });
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('graphIdentity', () => {
  it('depends on the graph and not on the path', async () => {
    const here = path.join(dir, 'a', 'approve.ts');
    const there = path.join(dir, 'b', 'copy-of-approve.ts');
    for (const file of [here, there]) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source()); }
    const [one, two] = await Promise.all([identityOf(here), identityOf(there)]);
    expect(one.graphFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(two.graphFingerprint).toBe(one.graphFingerprint);
    expect(one.capabilities).toEqual({ gate: true, effect: false });
    expect(one.continuationGraph.nodes.map((node) => node.nodeId)).toEqual(['Start', 'prepare', 'approval', 'apply']);
    expect(one.continuationGraph.nodes.find((node) => node.nodeId === 'approval')?.durableGate).toBe('approval');

    const other = path.join(dir, 'c', 'approve.ts');
    fs.mkdirSync(path.dirname(other), { recursive: true });
    fs.writeFileSync(other, source('order'));
    expect((await identityOf(other)).graphFingerprint).not.toBe(one.graphFingerprint);
  });

  it('is what the generator bakes into a gated body and the artifact compiler writes into its metadata', async () => {
    const file = path.join(dir, 'd', 'approve.ts');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source());
    const { graphFingerprint } = await identityOf(file);

    await compileWorkflow(file, { write: true, inPlace: true });
    expect(fs.readFileSync(file, 'utf8')).toContain(`ctx.bindWorkflow('approveSpend', '${graphFingerprint}');`);

    const artifact = await compileExecutableWorkflowArtifact({ source: source(), workflowName: 'approveSpend' });
    const metadata = JSON.parse(artifact.code.match(/__flowWeaverExecutableArtifact = Object\.freeze\((.*)\);\s*$/s)![1]) as { graphFingerprint: string };
    expect(metadata.graphFingerprint).toBe(graphFingerprint);
  });
});
