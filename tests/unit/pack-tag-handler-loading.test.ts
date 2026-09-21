/**
 * Tests for a pack pack tag handler loading across CLI commands.
 *
 * The packns pack registers tag handlers for @secret, @runner, @cache, [job:],
 * @trigger (push/pull_request/etc) through tagHandlerRegistry. These handlers
 * populate ctx.deploy['packns'] which the parser maps to ast.options.packns.
 *
 * BUG: Only compile.ts calls loadPackHandlers() before parsing. validate.ts
 * and export.ts skip this step, so a pack annotations are silently ignored
 * in those commands.
 *
 * The tagHandlerRegistry is a global singleton. Handlers registered by one
 * test persist into subsequent tests.
 */

import { describe, it, expect } from 'vitest';
import { AnnotationParser } from '../../src/parser';
import * as fs from 'node:fs';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PACK_WORKFLOW_SOURCE = `
/**
 * @flowWeaver nodeType
 * @expression
 */
function buildStep(): { output: string } {
  return { output: 'built' };
}

/**
 * @flowWeaver nodeType
 * @expression
 */
function deployStep(): { url: string } {
  return { url: 'https://example.com' };
}

/**
 * @flowWeaver workflow
 * @trigger push branches="main"
 * @secret NPM_TOKEN - NPM auth token
 * @secret DEPLOY_KEY - Deployment key
 * @runner ubuntu-latest
 * @cache npm key="package-lock.json"
 * @node build buildStep [job: "build"]
 * @node test buildStep [job: "test"]
 * @node deploy deployStep [job: "deploy"]
 * @path Start -> build -> test -> deploy -> Exit
 * @connect build.output -> Exit.buildOutput
 * @connect test.output -> Exit.testOutput
 * @connect deploy.url -> Exit.deployUrl
 * @param trigger - CI event
 * @returns buildOutput - Build result
 * @returns testOutput - Test result
 * @returns deployUrl - Deployed URL
 */
export function ciPipeline(
  execute: boolean,
  params: { trigger: string }
): { onSuccess: boolean; onFailure: boolean; buildOutput: string; testOutput: string; deployUrl: string } {
  throw new Error('Compile me');
}
`;

const SIMPLE_WORKFLOW_SOURCE = `
/**
 * @flowWeaver nodeType
 * @expression
 */
function greet(name: string): { greeting: string } {
  return { greeting: 'Hello ' + name };
}

/**
 * @flowWeaver workflow
 * @node g greet
 * @path Start -> g -> Exit
 * @connect Start.name -> g.name
 * @connect g.greeting -> Exit.greeting
 * @param name - Name
 * @returns greeting - Greeting
 */
export function hello(
  execute: boolean,
  params: { name: string }
): { onSuccess: boolean; onFailure: boolean; greeting: string } {
  throw new Error('Compile me');
}
`;

// ---------------------------------------------------------------------------
// Core parser features (no pack needed)
// ---------------------------------------------------------------------------

describe('[job:] attribute parsing (core parser)', () => {
  it('should parse [job:] on node instances', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(PACK_WORKFLOW_SOURCE, 'test.ts');
    const wf = result.workflows[0];

    expect(wf).toBeDefined();

    const buildInst = wf.instances.find((i: any) => i.id === 'build');
    const testInst = wf.instances.find((i: any) => i.id === 'test');
    const deployInst = wf.instances.find((i: any) => i.id === 'deploy');

    expect(buildInst?.attributes?.job).toBe('build');
    expect(testInst?.attributes?.job).toBe('test');
    expect(deployInst?.attributes?.job).toBe('deploy');
  });

  it('should not have [job:] on nodes without it', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(SIMPLE_WORKFLOW_SOURCE, 'test.ts');
    const wf = result.workflows[0];
    const inst = wf.instances.find((i: any) => i.id === 'g');

    expect(inst).toBeDefined();
    expect(inst?.attributes?.job).toBeUndefined();
  });

  it('should parse multiple [job:] assignments creating distinct groups', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(PACK_WORKFLOW_SOURCE, 'test.ts');
    const wf = result.workflows[0];

    const jobGroups = new Map<string, string[]>();
    for (const inst of wf.instances) {
      if (inst.attributes?.job) {
        if (!jobGroups.has(inst.attributes?.job)) jobGroups.set(inst.attributes?.job, []);
        jobGroups.get(inst.attributes?.job)!.push(inst.id);
      }
    }

    expect(jobGroups.get('build')).toEqual(['build']);
    expect(jobGroups.get('test')).toEqual(['test']);
    expect(jobGroups.get('deploy')).toEqual(['deploy']);
  });
});

// ---------------------------------------------------------------------------
// @trigger delegation to a pack pack handler
// ---------------------------------------------------------------------------

describe('@trigger a pack delegation', () => {
  it('@trigger push should delegate to packns handler, not be consumed as Inngest event', async () => {
    // Register a mock packns trigger handler
    const captured: Array<{ tagName: string; comment: string }> = [];
    const { tagHandlerRegistry } = await import('../../src/parser/tag-registry');

    tagHandlerRegistry.register(
      ['_trigger'],
      'packns',
      'workflow',
      (tagName: string, comment: string, ctx: any) => {
        captured.push({ tagName, comment });
        if (!ctx.deploy.triggers) ctx.deploy.triggers = [];
        ctx.deploy.triggers.push({ type: comment.split(/\s/)[0] });
      },
    );

    const source = `
/** @flowWeaver nodeType @expression */
function step(): { done: boolean } { return { done: true }; }

/**
 * @flowWeaver workflow
 * @trigger push branches="main"
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

    const parser = new AnnotationParser();
    const result = parser.parseFromString(source, 'test.ts');
    const wf = result.workflows[0];

    // Debug: check what we got
    const hasInngestTrigger = wf.options?.trigger?.event === 'push';
    const handlerCalled = captured.length > 0;

    // @trigger push should NOT be treated as Inngest event trigger
    expect(hasInngestTrigger).toBe(false);

    // The packns handler should have been called
    expect(handlerCalled).toBe(true);
    expect(captured[0].comment).toContain('push');

    // The handler writes to ctx.deploy['packns']. Core no longer owns a typed
    // `packns` field (it lives in flow-weaver-pack-packns via module augmentation),
    // so read the namespace-agnostic deploy map here.
    const packns = wf.options?.deploy?.packns as { triggers?: Array<{ type?: string }> } | undefined;
    expect(packns?.triggers).toBeDefined();
    expect(packns?.triggers?.[0]?.type).toBe('push');
  });
});

// ---------------------------------------------------------------------------
// Regular workflows should be unaffected by a pack pack presence
// ---------------------------------------------------------------------------

describe('non-pack workflows are unaffected by pack handlers', () => {
  it('simple workflow parses correctly regardless of registry state', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(SIMPLE_WORKFLOW_SOURCE, 'test.ts');
    const wf = result.workflows[0];

    expect(wf).toBeDefined();
    expect(wf.name).toBe('hello');
    expect(wf.instances).toHaveLength(1);
    expect(wf.instances[0].id).toBe('g');
    expect(wf.instances[0].nodeType).toBe('greet');
  });

  it('simple workflow has no packns options', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(SIMPLE_WORKFLOW_SOURCE, 'test.ts');
    const wf = result.workflows[0];

    expect(wf.options?.deploy?.packns).toBeUndefined();
  });

  it('simple workflow validates without errors', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(SIMPLE_WORKFLOW_SOURCE, 'test.ts');

    expect(result.errors).toHaveLength(0);
    expect(result.workflows).toHaveLength(1);
  });

  it('@deploy annotation works without pack handlers', () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @expression
 */
function doWork(): { result: string } {
  return { result: 'done' };
}

/**
 * @flowWeaver workflow
 * @deploy inngest
 * @node work doWork
 * @path Start -> work -> Exit
 * @connect work.result -> Exit.result
 * @param input - Input
 * @returns result - Result
 */
export function myWorkflow(
  execute: boolean,
  params: { input: string }
): { onSuccess: boolean; onFailure: boolean; result: string } {
  throw new Error('Compile me');
}
`;
    const parser = new AnnotationParser();
    const result = parser.parseFromString(source, 'test.ts');
    const wf = result.workflows[0];

    expect(wf.options?.deploy?.inngest).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// loadPackHandlers must be called in every CLI command that parses workflows
// ---------------------------------------------------------------------------

describe('loadPackHandlers in CLI commands', () => {
  it('compile.ts calls loadPackHandlers before parsing', () => {
    const source = fs.readFileSync(
      new URL('../../src/cli/commands/compile.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('loadPackHandlers');
  });

  // Commands that use parseWorkflow() pass projectDir derived from the input file path.
  // Commands that use the parser singleton directly call loadPackHandlers explicitly.
  // The export module has its own loadPackHandlers call inside exportWorkflow().
  // Using path.dirname(filePath) ensures packs are discovered relative to the workflow file,
  // not the directory the CLI was invoked from.

  it('validate.ts uses file-relative projectDir', () => {
    const source = fs.readFileSync(
      new URL('../../src/cli/commands/validate.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('projectDir: path.dirname');
  });

  it('export module calls loadPackHandlers with file-relative path', () => {
    const source = fs.readFileSync(
      new URL('../../src/export/index.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('loadPackHandlers');
    expect(source).toContain('path.dirname');
  });

  it('run.ts uses file-relative projectDir', () => {
    const source = fs.readFileSync(
      new URL('../../src/cli/commands/run.ts', import.meta.url),
      'utf8',
    );
    const matches = source.match(/projectDir: path\.dirname/g);
    expect(matches?.length).toBeGreaterThanOrEqual(2);
  });

  it('describe.ts uses file-relative projectDir', () => {
    const source = fs.readFileSync(
      new URL('../../src/cli/commands/describe.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('projectDir: path.dirname');
  });

  it('diagram.ts calls loadPackHandlers with file-relative path', () => {
    const source = fs.readFileSync(
      new URL('../../src/cli/commands/diagram.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('loadPackHandlers');
    expect(source).toContain('path.dirname');
  });

  it('diff.ts uses file-relative projectDir', () => {
    const source = fs.readFileSync(
      new URL('../../src/cli/commands/diff.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('projectDir: path.dirname');
  });
});
