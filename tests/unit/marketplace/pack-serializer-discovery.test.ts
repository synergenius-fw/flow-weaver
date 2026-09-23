/**
 * Discovery wiring for the serialize seam.
 *
 * A pack declares `serializerExport` on its manifest tagHandlers entry. Core's
 * loadPackHandlers must import that export and register it via
 * registerSerializer, so JSDoc regeneration re-emits the pack's tags. Without
 * this wiring the serialize seam is inert for real (manifest-discovered) packs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnnotationParser } from '../../../src/parser';
import { tagHandlerRegistry } from '../../../src/parser/tag-registry';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// A minimal fake pack: parses @env NAME=VALUE into deploy['demo'].vars and
// serializes it back to @env lines.
const PACK_MODULE = `
export function demoTagHandler(tagName, comment, ctx) {
  if (tagName !== 'env') return;
  const [name, value] = comment.split('=');
  ctx.deploy.vars = ctx.deploy.vars || {};
  ctx.deploy.vars[name.trim()] = (value ?? '').trim();
}
export function demoSerializer(data) {
  const out = [];
  for (const [k, v] of Object.entries(data.vars || {})) {
    out.push(' * @env ' + k + '=' + v);
  }
  return out;
}
`;

function makeManifest(withSerializer: boolean) {
  return JSON.stringify({
    manifestVersion: 2,
    name: 'flow-weaver-pack-demo',
    version: '1.0.0',
    nodeTypes: [],
    workflows: [],
    patterns: [],
    tagHandlers: [
      {
        tags: ['env'],
        namespace: 'demo',
        scope: 'workflow',
        file: 'dist/handler.js',
        exportName: 'demoTagHandler',
        ...(withSerializer && { serializerExport: 'demoSerializer' }),
      },
    ],
  });
}

const WORKFLOW = `
/** @flowWeaver nodeType @expression */
function step(): { done: boolean } { return { done: true }; }

/**
 * @flowWeaver workflow
 * @env FOO=bar
 * @node a step
 * @path Start -> a -> Exit
 * @connect a.done -> Exit.done
 * @param x
 * @returns done
 */
export function w(execute: boolean, params: { x: string }): { onSuccess: boolean; onFailure: boolean; done: boolean } {
  throw new Error('compile');
}
`;

let projectDir: string;

function scaffoldPack(withSerializer: boolean): string {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-pack-disc-'));
  const packDir = path.join(projectDir, 'node_modules', 'flow-weaver-pack-demo');
  fs.mkdirSync(path.join(packDir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(packDir, 'dist', 'handler.js'), PACK_MODULE);
  fs.writeFileSync(path.join(packDir, 'flowweaver.manifest.json'), makeManifest(withSerializer));
  return projectDir;
}

describe('pack serializer discovery (serializerExport)', () => {
  beforeEach(() => {
    // Ensure a clean serializer slot for the 'demo' namespace.
    tagHandlerRegistry.registerSerializer('demo', undefined);
  });
  afterEach(() => {
    tagHandlerRegistry.registerSerializer('demo', undefined);
    if (projectDir) fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('registers the pack serializer so its tags round-trip on regeneration', async () => {
    const dir = scaffoldPack(true);
    const parser = new AnnotationParser();
    await parser.loadPackHandlers(dir);

    // The serializer for 'demo' must now be registered and emit @env.
    const lines = tagHandlerRegistry.serialize('demo', { vars: { FOO: 'bar' } });
    expect(lines).toContain(' * @env FOO=bar');

    // And end-to-end: parsing + regenerating preserves @env.
    const parsed = parser.parseFromString(WORKFLOW, path.join(dir, 'w.ts'));
    const wf = parsed.workflows[0] as any;
    expect(wf.options?.deploy?.demo?.vars?.FOO).toBe('bar');
  });

  it('without serializerExport, no serializer is registered', async () => {
    const dir = scaffoldPack(false);
    const parser = new AnnotationParser();
    await parser.loadPackHandlers(dir);

    // Handler still parses, but nothing serializes the namespace.
    expect(tagHandlerRegistry.serialize('demo', { vars: { FOO: 'bar' } })).toEqual([]);
  });
});
