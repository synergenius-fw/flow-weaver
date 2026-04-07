/**
 * Tests for CI/CD annotation preservation through generateInPlace (compile).
 *
 * The compile path uses replaceWorkflowJSDoc in generate-in-place.ts to
 * regenerate the workflow JSDoc. CI/CD annotations (@secret, @runner, @cache,
 * @trigger push, [job:], [environment:]) must survive this round-trip.
 *
 * Also verifies that Inngest annotations and non-CICD workflows are unaffected.
 */

import { describe, it, expect } from 'vitest';
import { generateInPlace } from '../../src/api/generate-in-place';
import { parser } from '../../src/parser';
import { tagHandlerRegistry } from '../../src/parser/tag-registry';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ---------------------------------------------------------------------------
// Mock CI/CD tag handler (simulates what the real cicd pack does)
// ---------------------------------------------------------------------------

function ensureCicdHandler() {
  if (tagHandlerRegistry.has('secret')) return;
  tagHandlerRegistry.register(
    ['secret', 'runner', 'cache', '_cicdTrigger'],
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
        case 'cache': {
          if (!ctx.deploy.caches) ctx.deploy.caches = [];
          const tokens = comment.split(/\s+/);
          const strategy = tokens[0];
          const keyMatch = comment.match(/key="([^"]+)"/);
          const pathMatch = comment.match(/path="([^"]+)"/);
          ctx.deploy.caches.push({ strategy, key: keyMatch?.[1], path: pathMatch?.[1] });
          break;
        }
        case '_cicdTrigger': {
          if (!ctx.deploy.triggers) ctx.deploy.triggers = [];
          const tokens = comment.split(/\s+/);
          const type = tokens[0];
          const branchMatch = comment.match(/branches="([^"]+)"/);
          const typesMatch = comment.match(/types="([^"]+)"/);
          ctx.deploy.triggers.push({
            type,
            branches: branchMatch?.[1],
            types: typesMatch?.[1],
          });
          break;
        }
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compileSource(source: string): string {
  ensureCicdHandler();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-cicd-gip-'));
  const tmpFile = path.join(tmpDir, 'test.ts');
  fs.writeFileSync(tmpFile, source);

  try {
    const parsed = parser.parse(tmpFile);
    expect(parsed.errors).toHaveLength(0);
    const wf = parsed.workflows[0];
    expect(wf).toBeDefined();

    const result = generateInPlace(source, wf);
    return result.code;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Re-parse compiled output and return the AST */
function reparseCompiled(compiled: string): any {
  ensureCicdHandler();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-cicd-reparse-'));
  const tmpFile = path.join(tmpDir, 'compiled.ts');
  fs.writeFileSync(tmpFile, compiled);

  try {
    const parsed = parser.parse(tmpFile);
    return parsed.workflows[0];
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

function makeWorkflowWithNodes(annotations: string, nodes: string): string {
  return `
/** @flowWeaver nodeType @expression */
function step(): { done: boolean } { return { done: true }; }

/**
 * @flowWeaver workflow
${annotations}
${nodes}
 * @param x
 * @returns done
 */
export function w(execute: boolean, params: { x: string }): { onSuccess: boolean; onFailure: boolean; done: boolean } {
  throw new Error('compile');
}
`;
}

// ---------------------------------------------------------------------------
// CI/CD individual annotation tests
// ---------------------------------------------------------------------------

describe('CI/CD annotation round-trip through generateInPlace', () => {
  it('@secret with description survives compile', () => {
    const compiled = compileSource(makeWorkflow(' * @secret NPM_TOKEN - NPM auth token'));
    expect(compiled).toContain('@secret NPM_TOKEN');
    expect(compiled).toContain('NPM auth token');
  });

  it('@secret without description survives compile', () => {
    const compiled = compileSource(makeWorkflow(' * @secret DEPLOY_KEY'));
    expect(compiled).toContain('@secret DEPLOY_KEY');
  });

  it('multiple @secret lines survive compile', () => {
    const compiled = compileSource(makeWorkflow(
      ' * @secret NPM_TOKEN - NPM auth\n * @secret DEPLOY_KEY - Deploy key\n * @secret AWS_KEY'
    ));
    expect(compiled).toContain('@secret NPM_TOKEN');
    expect(compiled).toContain('@secret DEPLOY_KEY');
    expect(compiled).toContain('@secret AWS_KEY');
  });

  it('@runner survives compile', () => {
    const compiled = compileSource(makeWorkflow(' * @runner ubuntu-latest'));
    expect(compiled).toContain('@runner ubuntu-latest');
  });

  it('@cache with key survives compile', () => {
    const compiled = compileSource(makeWorkflow(' * @cache npm key="package-lock.json"'));
    expect(compiled).toContain('@cache npm');
    expect(compiled).toContain('package-lock.json');
  });

  it('@cache with path survives compile', () => {
    const compiled = compileSource(makeWorkflow(' * @cache pip key="requirements.txt" path=".pip-cache/"'));
    expect(compiled).toContain('@cache pip');
    expect(compiled).toContain('requirements.txt');
    expect(compiled).toContain('.pip-cache/');
  });

  it('@trigger push survives compile', () => {
    const compiled = compileSource(makeWorkflow(' * @trigger push branches="main"'));
    expect(compiled).toContain('@trigger push');
    expect(compiled).toContain('branches="main"');
  });

  it('multiple @trigger lines survive compile', () => {
    const compiled = compileSource(makeWorkflow(
      ' * @trigger push branches="main"\n * @trigger pull_request types="opened,synchronize"'
    ));
    expect(compiled).toContain('@trigger push');
    expect(compiled).toContain('@trigger pull_request');
  });

  it('[job:] survives compile', () => {
    const compiled = compileSource(makeWorkflowWithNodes('', `
 * @node a step [job: "build"]
 * @node b step [job: "test"]
 * @path Start -> a -> b -> Exit
 * @connect b.done -> Exit.done`));
    expect(compiled).toContain('[job: "build"]');
    expect(compiled).toContain('[job: "test"]');
  });

  it('[environment:] survives compile', () => {
    const compiled = compileSource(makeWorkflowWithNodes('', `
 * @node a step [environment: "production"]
 * @path Start -> a -> Exit
 * @connect a.done -> Exit.done`));
    expect(compiled).toContain('[environment: "production"]');
  });

  it('all CI/CD annotations together survive compile', () => {
    const compiled = compileSource(makeWorkflowWithNodes(`
 * @trigger push branches="main"
 * @secret NPM_TOKEN - NPM auth token
 * @secret DEPLOY_KEY
 * @runner ubuntu-latest
 * @cache npm key="package-lock.json"`, `
 * @node a step [job: "build"]
 * @node b step [job: "test"] [environment: "staging"]
 * @path Start -> a -> b -> Exit
 * @connect b.done -> Exit.done`));
    expect(compiled).toContain('@trigger push');
    expect(compiled).toContain('@secret NPM_TOKEN');
    expect(compiled).toContain('@secret DEPLOY_KEY');
    expect(compiled).toContain('@runner ubuntu-latest');
    expect(compiled).toContain('@cache npm');
    expect(compiled).toContain('[job: "build"]');
    expect(compiled).toContain('[job: "test"]');
    expect(compiled).toContain('[environment: "staging"]');
  });
});

// ---------------------------------------------------------------------------
// Full pipeline: parse → compile → re-parse → check options.cicd
// ---------------------------------------------------------------------------

describe('full pipeline: parse → compile → re-parse', () => {
  it('options.cicd is populated after re-parsing compiled output', () => {
    const source = makeWorkflow(
      ' * @secret NPM_TOKEN - Auth\n * @runner ubuntu-latest\n * @cache npm key="package-lock.json"'
    );
    const compiled = compileSource(source);
    const wf = reparseCompiled(compiled);

    expect(wf).toBeDefined();
    expect(wf.options?.cicd).toBeDefined();
    expect(wf.options.cicd.secrets).toHaveLength(1);
    expect(wf.options.cicd.secrets[0].name).toBe('NPM_TOKEN');
    expect(wf.options.cicd.runner).toBe('ubuntu-latest');
    expect(wf.options.cicd.caches).toHaveLength(1);
  });

  it('[job:] is populated on instances after re-parsing compiled output', () => {
    const source = makeWorkflowWithNodes('', `
 * @node a step [job: "build"]
 * @node b step [job: "test"]
 * @path Start -> a -> b -> Exit
 * @connect b.done -> Exit.done`);
    const compiled = compileSource(source);
    const wf = reparseCompiled(compiled);

    const aInst = wf.instances.find((i: any) => i.id === 'a');
    const bInst = wf.instances.find((i: any) => i.id === 'b');
    expect(aInst?.job).toBe('build');
    expect(bInst?.job).toBe('test');
  });
});

// ---------------------------------------------------------------------------
// Non-CICD workflows are unaffected
// ---------------------------------------------------------------------------

describe('non-CICD workflows unaffected by CI/CD round-trip code', () => {
  it('simple workflow compiles without CI/CD annotations appearing', () => {
    const source = makeWorkflow('');
    const compiled = compileSource(source);
    expect(compiled).not.toContain('@secret');
    expect(compiled).not.toContain('@runner');
    expect(compiled).not.toContain('@cache');
    expect(compiled).not.toContain('[job:');
    expect(compiled).toContain('@flowWeaver workflow');
  });

  it('simple workflow round-trip has no cicd options', () => {
    const source = makeWorkflow('');
    const compiled = compileSource(source);
    const wf = reparseCompiled(compiled);
    expect(wf.options?.cicd).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Inngest annotations are unaffected
// ---------------------------------------------------------------------------

describe('Inngest annotations unaffected by CI/CD changes', () => {
  it('@trigger event= survives compile', () => {
    const compiled = compileSource(makeWorkflow(' * @trigger event="user.created"'));
    expect(compiled).toContain('@trigger event="user.created"');
    expect(compiled).not.toContain('@trigger push');
  });

  it('@trigger cron= survives compile', () => {
    const compiled = compileSource(makeWorkflow(' * @trigger cron="0 9 * * *"'));
    expect(compiled).toContain('@trigger cron="0 9 * * *"');
  });

  it('@trigger event= and cron= together survive compile', () => {
    const compiled = compileSource(makeWorkflow(
      ' * @trigger event="agent/request"\n * @trigger cron="0 * * * *"'
    ));
    // Both should be merged into a single @trigger line
    expect(compiled).toContain('event="agent/request"');
    expect(compiled).toContain('cron="0 * * * *"');
  });

  it('@retries survives compile', () => {
    const compiled = compileSource(makeWorkflow(' * @retries 3'));
    expect(compiled).toContain('@retries 3');
  });

  it('@timeout survives compile', () => {
    const compiled = compileSource(makeWorkflow(' * @timeout "30m"'));
    expect(compiled).toContain('@timeout "30m"');
  });

  it('@cancelOn survives compile', () => {
    const compiled = compileSource(makeWorkflow(' * @cancelOn event="app/user.deleted" match="data.userId"'));
    expect(compiled).toContain('@cancelOn event="app/user.deleted"');
    expect(compiled).toContain('match="data.userId"');
  });

  it('@throttle survives compile', () => {
    const compiled = compileSource(makeWorkflow(' * @throttle limit=3 period="1m"'));
    expect(compiled).toContain('@throttle limit=3');
    expect(compiled).toContain('period="1m"');
  });

  it('Inngest + CI/CD annotations coexist without interference', () => {
    // A workflow might have both Inngest deploy config and CI/CD annotations
    // (e.g. Inngest for the serverless deploy + CI/CD for the pipeline that deploys it)
    const compiled = compileSource(makeWorkflow(
      ' * @trigger event="deploy/start"\n * @retries 2\n * @secret DEPLOY_KEY - Key\n * @runner ubuntu-latest'
    ));
    expect(compiled).toContain('@trigger event="deploy/start"');
    expect(compiled).toContain('@retries 2');
    expect(compiled).toContain('@secret DEPLOY_KEY');
    expect(compiled).toContain('@runner ubuntu-latest');
  });
});
