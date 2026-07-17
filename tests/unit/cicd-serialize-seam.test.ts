/**
 * Phase 0: symmetric serialize seam for pack-contributed tags.
 *
 * The parser delegates tag PARSING to pack tag handlers via TagHandlerRegistry,
 * but core historically hardcoded the reverse direction (annotation emission)
 * for a fixed set of CI/CD tags (@trigger/@secret/@runner/@cache). Tags the
 * pack learned to parse later (@matrix, @artifact, @service, @concurrency, ...)
 * were silently DROPPED on regeneration.
 *
 * These tests pin the seam: a registered serializer for a namespace is invoked
 * during JSDoc regeneration, and its output round-trips. The "bug" tests below
 * demonstrate the data loss that the seam fixes.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { generateInPlace } from '../../src/api/generate-in-place';
import { parser } from '../../src/parser';
import { tagHandlerRegistry } from '../../src/parser/tag-registry';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ---------------------------------------------------------------------------
// A fuller mock CI/CD handler that also parses @matrix and @artifact — the
// tags core's hardcoded serializer never emitted.
// ---------------------------------------------------------------------------

function registerFullCicdHandler() {
  // Re-register cleanly for each test (register() overwrites by tag name).
  tagHandlerRegistry.register(
    ['secret', 'runner', 'matrix', 'artifact'],
    'cicd',
    'workflow',
    (tagName: string, comment: string, ctx: any) => {
      switch (tagName) {
        case 'secret': {
          if (!ctx.deploy.secrets) ctx.deploy.secrets = [];
          const parts = comment.split(/\s*-\s*/);
          ctx.deploy.secrets.push({ name: parts[0].trim(), description: parts[1]?.trim() });
          break;
        }
        case 'runner':
          ctx.deploy.runner = comment.trim();
          break;
        case 'matrix': {
          // @matrix node=["18","20","22"]
          const m = comment.match(/(\w+)=\[([^\]]+)\]/);
          if (m) {
            const values = m[2].split(',').map((v) => v.trim().replace(/^["']|["']$/g, ''));
            ctx.deploy.matrix = { dimensions: { [m[1]]: values } };
          }
          break;
        }
        case 'artifact': {
          // @artifact dist path="dist/"
          if (!ctx.deploy.artifacts) ctx.deploy.artifacts = [];
          const tokens = comment.split(/\s+/);
          const name = tokens[0];
          const pathMatch = comment.match(/path="([^"]+)"/);
          ctx.deploy.artifacts.push({ name, path: pathMatch?.[1] ?? '' });
          break;
        }
      }
    },
  );
}

/** The serializer the cicd pack will provide: deploy['cicd'] -> annotation lines. */
function cicdSerializer(data: Record<string, unknown>): string[] {
  const lines: string[] = [];
  if (Array.isArray(data.secrets)) {
    for (const s of data.secrets as Array<Record<string, unknown>>) {
      let line = ` * @secret ${s.name}`;
      if (s.description) line += ` - ${s.description}`;
      lines.push(line);
    }
  }
  if (data.runner) lines.push(` * @runner ${data.runner}`);
  if (data.matrix && typeof data.matrix === 'object') {
    const dims = (data.matrix as any).dimensions ?? {};
    for (const [dim, values] of Object.entries(dims)) {
      const arr = (values as string[]).map((v) => `"${v}"`).join(',');
      lines.push(` * @matrix ${dim}=[${arr}]`);
    }
  }
  if (Array.isArray(data.artifacts)) {
    for (const a of data.artifacts as Array<Record<string, unknown>>) {
      lines.push(` * @artifact ${a.name} path="${a.path}"`);
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compileSource(source: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-cicd-seam-'));
  const tmpFile = path.join(tmpDir, 'test.ts');
  fs.writeFileSync(tmpFile, source);
  try {
    const parsed = parser.parse(tmpFile);
    expect(parsed.errors).toHaveLength(0);
    const wf = parsed.workflows[0];
    expect(wf).toBeDefined();
    return generateInPlace(source, wf).code;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function makeWorkflow(annotations: string): string {
  return `
/** @flowWeaver nodeType @expression */
function step(): { done: boolean } { return { done: true }; }

/**
 * @flowWeaver workflow
${annotations}
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
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pack-contributed tag serialize seam', () => {
  beforeEach(() => {
    registerFullCicdHandler();
    // Reset serializer between tests so each declares its own expectation.
    tagHandlerRegistry.registerSerializer('cicd', undefined);
  });

  it('without a serializer, pack tags are not emitted (the historical data loss)', () => {
    // This pins the failure mode the seam addresses: parsing populates the
    // namespace, but with no serializer registered core emits nothing for it.
    const compiled = compileSource(makeWorkflow(' * @secret NPM_TOKEN\n * @matrix node=["18","20","22"]'));
    expect(compiled).not.toContain('@secret NPM_TOKEN');
    expect(compiled).not.toContain('@matrix node=');
  });

  it('a registered serializer emits ALL its tags — including @matrix/@artifact core never hardcoded', () => {
    tagHandlerRegistry.registerSerializer('cicd', cicdSerializer);
    const compiled = compileSource(makeWorkflow(
      ' * @secret NPM_TOKEN - Auth\n * @runner ubuntu-latest\n * @matrix node=["18","20"]\n * @artifact dist path="dist/"'
    ));
    expect(compiled).toContain('@secret NPM_TOKEN');
    expect(compiled).toContain('@runner ubuntu-latest');
    expect(compiled).toContain('@matrix node=');
    expect(compiled).toContain('@artifact dist');
  });

  it('serialized tags round-trip: re-parsing recovers the same data', () => {
    tagHandlerRegistry.registerSerializer('cicd', cicdSerializer);
    const compiled = compileSource(makeWorkflow(' * @matrix node=["18","20","22"]'));

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-cicd-seam-rp-'));
    const tmpFile = path.join(tmpDir, 'compiled.ts');
    fs.writeFileSync(tmpFile, compiled);
    try {
      const wf = parser.parse(tmpFile).workflows[0] as any;
      expect(wf.options?.cicd?.matrix?.dimensions?.node).toEqual(['18', '20', '22']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('no serializer + no data: non-CICD workflow is unaffected', () => {
    const compiled = compileSource(makeWorkflow(''));
    expect(compiled).toContain('@flowWeaver workflow');
    expect(compiled).not.toContain('@matrix');
    expect(compiled).not.toContain('@artifact');
  });
});
