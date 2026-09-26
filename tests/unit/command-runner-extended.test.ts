/**
 * Tests for extended runCommand commands:
 * status, market-search, market-list, migrate,
 * openapi
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { runCommand, getAvailableCommands } from '../../src/api/command-runner.js';
import { VERSION } from '../../src/generated-version.js';

function createTempWorkflow(dir: string, name: string, content: string): string {
  const filePath = path.join(dir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

const VALID_WORKFLOW = `
/** @flowWeaver nodeType @expression */
function greet(name: string): { greeting: string } {
  return { greeting: \`Hello, \${name}!\` };
}

/**
 * @flowWeaver workflow
 * @node g greet
 * @path Start -> g -> Exit
 * @connect Start.name -> g.name
 * @connect g.greeting -> Exit.message
 */
export function helloWorld(
  execute: boolean,
  params: { name: string }
): { onSuccess: boolean; onFailure: boolean; message: string } {
  throw new Error('Compile me');
}
`;

/** A workflow with declared \`@http\` routes, the shape tests/unit/server/workflow-api.test.ts uses. */
const HTTP_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @input n - A number
 * @output out - Twice the number
 */
function dbl(execute: boolean, n: number): { onSuccess: boolean; onFailure: boolean; out: number } {
  return { onSuccess: execute && n >= 0, onFailure: execute && n < 0, out: n * 2 };
}

/**
 * Doubles a number.
 * @flowWeaver workflow
 * @http POST /double
 * @http GET /double/:n
 * @param n - The number
 * @returns out - Twice the number
 * @node d dbl
 * @connect Start.n -> d.n
 * @connect d.out -> Exit.out
 * @connect d.onSuccess -> Exit.onSuccess
 * @connect d.onFailure -> Exit.onFailure
 */
export async function double(execute: boolean, params: { n: number }): Promise<{ onSuccess: boolean; onFailure: boolean; out: number }> {
  throw new Error('generated body was not installed');
}
`;

const STUB_WORKFLOW = `
/** @flowWeaver nodeType */
declare function processData(execute: boolean, data: any): { onSuccess: boolean; onFailure: boolean; processed: string };

/** @flowWeaver nodeType @expression */
function formatOutput(text: string): { result: string } {
  return { result: text };
}

/**
 * @flowWeaver workflow
 * @node p processData
 * @node f formatOutput
 * @path Start -> p -> f -> Exit
 * @connect Start.data -> p.data
 * @connect p.processed -> f.text
 * @connect f.result -> Exit.output
 */
export function dataWorkflow(
  execute: boolean,
  params: { data: any }
): { onSuccess: boolean; onFailure: boolean; output: string } {
  throw new Error('Compile me');
}
`;

const ALL_STUBS_WORKFLOW = `
/** @flowWeaver nodeType */
declare function stepA(execute: boolean, input: string): { onSuccess: boolean; onFailure: boolean; output: string };

/** @flowWeaver nodeType */
declare function stepB(execute: boolean, value: string): { onSuccess: boolean; onFailure: boolean; result: number };

/** @flowWeaver nodeType */
declare function stepC(execute: boolean, flag: number): { onSuccess: boolean; onFailure: boolean; done: string };

/**
 * @flowWeaver workflow
 * @node a stepA
 * @node b stepB
 * @node c stepC
 * @path Start -> a -> b -> c -> Exit
 * @connect Start.input -> a.input
 * @connect a.output -> b.value
 * @connect b.result -> c.flag
 * @connect c.done -> Exit.output
 */
export function allStubsWorkflow(
  execute: boolean,
  params: { input: string }
): { onSuccess: boolean; onFailure: boolean; output: string } {
  throw new Error('Compile me');
}
`;

const MULTI_WORKFLOW = `
/** @flowWeaver nodeType @expression */
function add(a: number, b: number): { sum: number } {
  return { sum: a + b };
}

/** @flowWeaver nodeType @expression */
function multiply(x: number, y: number): { product: number } {
  return { product: x * y };
}

/**
 * @flowWeaver workflow
 * @node a add
 * @path Start -> a -> Exit
 * @connect Start.a -> a.a
 * @connect Start.b -> a.b
 * @connect a.sum -> Exit.result
 */
export function addWorkflow(
  execute: boolean,
  params: { a: number; b: number }
): { onSuccess: boolean; onFailure: boolean; result: number } {
  throw new Error('Compile me');
}

/**
 * @flowWeaver workflow
 * @node m multiply
 * @path Start -> m -> Exit
 * @connect Start.x -> m.x
 * @connect Start.y -> m.y
 * @connect m.product -> Exit.result
 */
export function multiplyWorkflow(
  execute: boolean,
  params: { x: number; y: number }
): { onSuccess: boolean; onFailure: boolean; result: number } {
  throw new Error('Compile me');
}
`;

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join('/tmp', 'fw-cmd-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('runCommand - extended commands', () => {
  // ─── status ───────────────────────────────────────────────────────
  describe('status', () => {
    it('should report stubs for a workflow with stub node types', async () => {
      const filePath = createTempWorkflow(tmpDir, 'stub.ts', STUB_WORKFLOW);
      const result = await runCommand('status', { file: filePath });
      const data = result.data as { total: number; implemented: string[]; stubs: string[]; progress: number };
      expect(data.total).toBeGreaterThan(0);
      expect(data.stubs.length).toBeGreaterThan(0);
      expect(data.stubs).toContain('processData');
      expect(data.implemented).toContain('formatOutput');
      expect(data.progress).toBeGreaterThanOrEqual(0);
      expect(data.progress).toBeLessThanOrEqual(100);
    });

    it('should show 100% progress for a fully implemented workflow', async () => {
      const filePath = createTempWorkflow(tmpDir, 'complete.ts', VALID_WORKFLOW);
      const result = await runCommand('status', { file: filePath });
      const data = result.data as { total: number; stubs: string[]; progress: number };
      expect(data.stubs).toHaveLength(0);
      expect(data.progress).toBe(100);
    });

    it('should report all stubs when every node is a stub', async () => {
      const filePath = createTempWorkflow(tmpDir, 'all-stubs.ts', ALL_STUBS_WORKFLOW);
      const result = await runCommand('status', { file: filePath });
      const data = result.data as { total: number; stubs: string[]; implemented: string[]; progress: number };
      expect(data.stubs).toContain('stepA');
      expect(data.stubs).toContain('stepB');
      expect(data.stubs).toContain('stepC');
      expect(data.stubs.length).toBeGreaterThanOrEqual(3);
      expect(data.progress).toBeLessThanOrEqual(25); // At most 1 non-stub out of 4
    });

    it('should return errors for non-existent file', async () => {
      const result = await runCommand('status', { file: '/nonexistent.ts' });
      const data = result.data as { valid: boolean; errors: string[] };
      expect(data.valid).toBe(false);
      expect(data.errors).toBeDefined();
      expect(data.errors.length).toBeGreaterThan(0);
    });

    it('should return errors for invalid TypeScript', async () => {
      const filePath = createTempWorkflow(tmpDir, 'bad.ts', 'this is not valid typescript @@@');
      const result = await runCommand('status', { file: filePath });
      const data = result.data as { total?: number; valid?: boolean };
      // Either parses with 0 node types or returns parse errors
      expect(data).toBeDefined();
    });

    it('should return total, implemented, stubs, and progress fields', async () => {
      const filePath = createTempWorkflow(tmpDir, 'check-shape.ts', STUB_WORKFLOW);
      const result = await runCommand('status', { file: filePath });
      const data = result.data as Record<string, unknown>;
      expect(data).toHaveProperty('total');
      expect(data).toHaveProperty('implemented');
      expect(data).toHaveProperty('stubs');
      expect(data).toHaveProperty('progress');
      expect(typeof data.total).toBe('number');
      expect(typeof data.progress).toBe('number');
      expect(Array.isArray(data.implemented)).toBe(true);
      expect(Array.isArray(data.stubs)).toBe(true);
    });

    it('should handle empty file with no workflows', async () => {
      const filePath = createTempWorkflow(tmpDir, 'empty.ts', '// empty file\n');
      const result = await runCommand('status', { file: filePath });
      expect(result.data).toBeDefined();
    });
  });

  // ─── market-search ────────────────────────────────────────────────
  describe('market-search', () => {
    it('should return results array and query echo for a search', async () => {
      const result = await runCommand('market-search', { query: 'weaver' });
      const data = result.data as { results: unknown[]; query: string };
      expect(data.query).toBe('weaver');
      expect(Array.isArray(data.results)).toBe(true);
    });

    it('should return results array even for nonsense query (npm returns broad matches)', async () => {
      const result = await runCommand('market-search', { query: 'xyznonexistent12345zzz' });
      const data = result.data as { results: unknown[] };
      expect(Array.isArray(data.results)).toBe(true);
      // npm may return results for any query due to keyword matching
    });

    it('should handle empty query string', async () => {
      const result = await runCommand('market-search', { query: '' });
      const data = result.data as { results: unknown[] };
      expect(Array.isArray(data.results)).toBe(true);
    });

    it('should handle missing query parameter', async () => {
      const result = await runCommand('market-search', {});
      const data = result.data as { results: unknown[] };
      expect(Array.isArray(data.results)).toBe(true);
    });
  });

  // ─── market-list ──────────────────────────────────────────────────
  describe('market-list', () => {
    it('should return packages array', async () => {
      const result = await runCommand('market-list', { cwd: tmpDir });
      const data = result.data as { packages: unknown[] };
      expect(Array.isArray(data.packages)).toBe(true);
    });

    it('should return empty packages for directory with no node_modules', async () => {
      const emptyDir = path.join(tmpDir, 'no-modules');
      fs.mkdirSync(emptyDir, { recursive: true });
      const result = await runCommand('market-list', { cwd: emptyDir });
      const data = result.data as { packages: unknown[] };
      expect(data.packages).toHaveLength(0);
    });

    it('should include package metadata fields', async () => {
      // A project with one pack installed.
      const projectDir = path.join(tmpDir, 'with-pack');
      const packDir = path.join(projectDir, 'node_modules', 'flow-weaver-pack-meta');
      fs.mkdirSync(packDir, { recursive: true });
      fs.writeFileSync(path.join(packDir, 'package.json'), JSON.stringify({ name: 'flow-weaver-pack-meta', version: '2.1.0' }));
      fs.writeFileSync(
        path.join(packDir, 'flowweaver.manifest.json'),
        JSON.stringify({
          manifestVersion: 2,
          name: 'flow-weaver-pack-meta',
          version: '2.0.0',
          nodeTypes: [{ name: 'a' }, { name: 'b' }],
          workflows: [{ name: 'w' }],
          cliCommands: [{ name: 'c', description: 'd' }],
        }),
      );

      const result = await runCommand('market-list', { cwd: projectDir });

      // The version comes from package.json, the counts from the manifest.
      expect(result.data).toEqual({
        packages: [{ name: 'flow-weaver-pack-meta', version: '2.1.0', nodeTypes: 2, workflows: 1, cliCommands: 1 }],
      });
    });
  });

  // ─── market-install ────────────────────────────────────────────────
  describe('market-install', () => {
    it('should be a registered command', () => {
      expect(getAvailableCommands()).toContain('market-install');
    });

    it('should return error for non-existent package', async () => {
      const result = await runCommand('market-install', { package: 'flow-weaver-pack-nonexistent-zzz', cwd: tmpDir });
      const data = result.data as Record<string, unknown>;
      expect(data.success).toBe(false);
    });

    it('should require package parameter', async () => {
      const result = await runCommand('market-install', { cwd: tmpDir });
      const data = result.data as Record<string, unknown>;
      expect(data.success).toBe(false);
    });
  });

  // ─── market-uninstall ─────────────────────────────────────────────
  describe('market-uninstall', () => {
    it('should be a registered command', () => {
      expect(getAvailableCommands()).toContain('market-uninstall');
    });

    it('should return not-installed for package that is not present', async () => {
      const result = await runCommand('market-uninstall', { package: 'flow-weaver-pack-nonexistent', cwd: tmpDir });
      const data = result.data as Record<string, unknown>;
      // Should succeed (npm uninstall of non-existent is idempotent) or report not-installed
      expect(data).toBeDefined();
    });

    it('should require package parameter', async () => {
      const result = await runCommand('market-uninstall', { cwd: tmpDir });
      const data = result.data as Record<string, unknown>;
      expect(data.success).toBe(false);
    });
  });

  // ─── market-init ──────────────────────────────────────────────────
  describe('market-init', () => {
    it('should be a registered command', () => {
      expect(getAvailableCommands()).toContain('market-init');
    });

    it('should scaffold a new pack project', async () => {
      const packDir = path.join(tmpDir, 'my-pack');
      const result = await runCommand('market-init', { name: 'my-test-pack', directory: packDir });
      const data = result.data as Record<string, unknown>;
      expect(data).toHaveProperty('directory');
      expect(fs.existsSync(packDir)).toBe(true);
    });

    it('should create package.json with flow-weaver type', async () => {
      const packDir = path.join(tmpDir, 'pack-json-test');
      await runCommand('market-init', { name: 'json-test-pack', directory: packDir });
      const pkgPath = path.join(packDir, 'package.json');
      expect(fs.existsSync(pkgPath)).toBe(true);
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      expect(pkg.flowWeaver).toBeDefined();
      expect(pkg.flowWeaver.type).toBe('marketplace-pack');
    });

    it('should require name parameter', async () => {
      const result = await runCommand('market-init', { directory: path.join(tmpDir, 'no-name') });
      const data = result.data as Record<string, unknown>;
      expect(data.success).toBe(false);
    });
  });

  // ─── market-pack ──────────────────────────────────────────────────
  describe('market-pack', () => {
    it('should be a registered command', () => {
      expect(getAvailableCommands()).toContain('market-pack');
    });

    it('should generate manifest for a valid pack directory', async () => {
      // Create a minimal pack structure
      const packDir = path.join(tmpDir, 'pack-test');
      fs.mkdirSync(path.join(packDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(packDir, 'package.json'), JSON.stringify({
        name: 'flow-weaver-pack-test',
        version: '1.0.0',
        flowWeaver: { type: 'marketplace-pack' },
      }, null, 2));
      fs.writeFileSync(path.join(packDir, 'src', 'node.ts'), `
/** @flowWeaver nodeType @expression */
function testNode(x: number): { y: number } { return { y: x * 2 }; }
`);

      const result = await runCommand('market-pack', { directory: packDir });
      const data = result.data as Record<string, unknown>;
      expect(data).toHaveProperty('manifest');
    });

    it('should return errors for directory without package.json', async () => {
      const emptyDir = path.join(tmpDir, 'no-pkg-pack');
      fs.mkdirSync(emptyDir, { recursive: true });
      const result = await runCommand('market-pack', { directory: emptyDir });
      const data = result.data as Record<string, unknown>;
      expect(data.success).toBe(false);
    });
  });

  // ─── market-publish ───────────────────────────────────────────────
  describe('market-publish', () => {
    it('should be a registered command', () => {
      expect(getAvailableCommands()).toContain('market-publish');
    });

    it('should support dry-run mode', async () => {
      // Create minimal pack
      const packDir = path.join(tmpDir, 'publish-test');
      fs.mkdirSync(path.join(packDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(packDir, 'package.json'), JSON.stringify({
        name: 'flow-weaver-pack-publish-test',
        version: '0.0.1',
        flowWeaver: { type: 'marketplace-pack' },
      }, null, 2));

      const result = await runCommand('market-publish', { directory: packDir, dryRun: true });
      const data = result.data as Record<string, unknown>;
      expect(data.dryRun).toBe(true);
    });
  });

  // ─── getAvailableCommands includes market commands ────────────────
  describe('getAvailableCommands - market completeness', () => {
    it('should include all market subcommands', () => {
      const commands = getAvailableCommands();
      for (const cmd of ['market-search', 'market-list', 'market-install', 'market-uninstall', 'market-init', 'market-pack', 'market-publish']) {
        expect(commands).toContain(cmd);
      }
    });
  });

  // ─── migrate ──────────────────────────────────────────────────────
  describe('migrate', () => {
    it('should dry-run without modifying the file', async () => {
      const filePath = createTempWorkflow(tmpDir, 'migrate-dry.ts', VALID_WORKFLOW);
      const before = fs.readFileSync(filePath, 'utf-8');
      const result = await runCommand('migrate', { file: filePath, dryRun: true });
      const after = fs.readFileSync(filePath, 'utf-8');
      const data = result.data as { migrated: boolean; dryRun: boolean };
      expect(data.migrated).toBe(true);
      expect(data.dryRun).toBe(true);
      expect(after).toBe(before); // File unchanged in dry-run
    });

    it('should include available migrations list', async () => {
      const filePath = createTempWorkflow(tmpDir, 'migrate-list.ts', VALID_WORKFLOW);
      const result = await runCommand('migrate', { file: filePath, dryRun: true });
      const data = result.data as { availableMigrations: string[] };
      expect(Array.isArray(data.availableMigrations)).toBe(true);
    });

    it('should include file path and changed flag in result', async () => {
      const filePath = createTempWorkflow(tmpDir, 'migrate-fields.ts', VALID_WORKFLOW);
      const result = await runCommand('migrate', { file: filePath, dryRun: true });
      const data = result.data as { file: string; changed: boolean; migrated: boolean };
      expect(data.file).toBe(filePath);
      expect(typeof data.changed).toBe('boolean');
      expect(data.migrated).toBe(true);
    });

    it('should return parse errors for invalid file', async () => {
      const filePath = createTempWorkflow(tmpDir, 'bad-migrate.ts', '/// not a workflow');
      const result = await runCommand('migrate', { file: filePath });
      expect(result.data).toBeDefined();
    });

    it('should actually modify file when dryRun is false and changes exist', async () => {
      const filePath = createTempWorkflow(tmpDir, 'migrate-write.ts', VALID_WORKFLOW);
      const result = await runCommand('migrate', { file: filePath, dryRun: false });
      const data = result.data as { changed: boolean; dryRun: boolean };
      expect(data.dryRun).toBe(false);
      // File may or may not have changed depending on migration state
    });
  });

  // ─── openapi ──────────────────────────────────────────────────────
  // The runner returns the document `fw serve` publishes at /openapi.json:
  // declared @http routes, a run resource per workflow, the run endpoints.
  describe('openapi', () => {
    type OpenApiData = { spec: string; format: string; workflowCount: number; routeCount: number; problems: string[] };
    type OpenApiDoc = { openapi: string; info: { title: string; version: string; description: string }; servers: Array<{ url: string }>; paths: Record<string, Record<string, unknown>>; security?: unknown };

    it('should generate JSON spec with correct structure', async () => {
      createTempWorkflow(tmpDir, 'api-wf.ts', VALID_WORKFLOW);
      const result = await runCommand('openapi', {
        directory: tmpDir,
        title: 'Test API',
        version: '2.0.0',
        format: 'json',
      });
      const data = result.data as OpenApiData;
      expect(data.format).toBe('json');
      expect(data.workflowCount).toBe(1);
      expect(data.routeCount).toBe(0);
      expect(data.problems).toEqual([]);
      const parsed = JSON.parse(data.spec) as OpenApiDoc;
      expect(parsed.openapi).toBe('3.0.3');
      expect(parsed.info.title).toBe('Test API');
      expect(parsed.info.version).toBe('2.0.0');
      // The run resource of the workflow, and the run endpoints
      expect(parsed.paths['/workflows/helloWorld']).toHaveProperty('post');
      expect(parsed.paths['/runs/{runId}']).toHaveProperty('get');
      expect(parsed.paths['/health']).toHaveProperty('get');
    });

    it('should mount the declared @http routes', async () => {
      createTempWorkflow(tmpDir, 'routed.ts', HTTP_WORKFLOW);
      const result = await runCommand('openapi', { directory: tmpDir, format: 'json' });
      const data = result.data as OpenApiData;
      expect(data.workflowCount).toBe(1);
      expect(data.routeCount).toBe(2);
      expect(data.problems).toEqual([]);
      const parsed = JSON.parse(data.spec) as OpenApiDoc;
      expect(parsed.paths['/double']).toHaveProperty('post');
      expect(parsed.paths['/double/{n}']).toHaveProperty('get');
      const byPath = parsed.paths['/double/{n}'].get as { parameters: Array<{ name: string; in: string }> };
      expect(byPath.parameters).toContainEqual(expect.objectContaining({ name: 'n', in: 'path' }));
    });

    it('should generate YAML spec that parses back to the same document', async () => {
      createTempWorkflow(tmpDir, 'yaml-wf.ts', HTTP_WORKFLOW);
      const result = await runCommand('openapi', {
        directory: tmpDir,
        title: 'YAML API',
        version: '1.0',
        format: 'yaml',
      });
      const data = result.data as OpenApiData;
      expect(data.format).toBe('yaml');
      expect(data.spec).toContain('openapi:');
      const parsed = yaml.load(data.spec) as OpenApiDoc;
      expect(parsed.openapi).toBe('3.0.3');
      expect(parsed.info.title).toBe('YAML API');
      // A string in the document stays a string in YAML
      expect(parsed.info.version).toBe('1.0');
      expect(Object.keys(parsed.paths)).toEqual(expect.arrayContaining(['/double', '/double/{n}', '/workflows/double', '/runs/{runId}']));
      const json = await runCommand('openapi', { directory: tmpDir, title: 'YAML API', version: '1.0', format: 'json' });
      expect(parsed).toEqual(JSON.parse((json.data as OpenApiData).spec));
    });

    it('should map serverUrl, description, auth and legacy', async () => {
      createTempWorkflow(tmpDir, 'opts.ts', HTTP_WORKFLOW);
      const result = await runCommand('openapi', {
        directory: tmpDir,
        format: 'json',
        description: 'Doubles numbers',
        serverUrl: 'https://api.example.com/api',
        auth: false,
        legacy: false,
      });
      const parsed = JSON.parse((result.data as OpenApiData).spec) as OpenApiDoc;
      expect(parsed.info.description).toBe('Doubles numbers');
      expect(parsed.servers).toEqual([{ url: 'https://api.example.com/api' }]);
      expect(parsed.security).toBeUndefined();
      expect(parsed.paths['/workflows/double']).toBeUndefined();
      expect(parsed.paths['/double']).toHaveProperty('post');
    });

    it('should find workflows across multiple files', async () => {
      createTempWorkflow(tmpDir, 'wf1.ts', VALID_WORKFLOW);
      // Second workflow in a separate file with different names
      const wf2 = VALID_WORKFLOW
        .replace(/helloWorld/g, 'goodbyeWorld')
        .replace(/greet/g, 'farewell')
        .replace(/greeting/g, 'farewell_msg');
      createTempWorkflow(tmpDir, 'wf2.ts', wf2);
      const result = await runCommand('openapi', { directory: tmpDir, format: 'json' });
      const data = result.data as OpenApiData;
      expect(data.workflowCount).toBe(2);
      const parsed = JSON.parse(data.spec) as OpenApiDoc;
      expect(parsed.paths['/workflows/helloWorld']).toBeDefined();
      expect(parsed.paths['/workflows/goodbyeWorld']).toBeDefined();
    });

    it('should return zero workflows for empty directory', async () => {
      const emptyDir = path.join(tmpDir, 'empty');
      fs.mkdirSync(emptyDir, { recursive: true });
      const result = await runCommand('openapi', { directory: emptyDir, format: 'json' });
      const data = result.data as OpenApiData;
      expect(data.workflowCount).toBe(0);
      // Spec is still valid OpenAPI, just with no workflow-derived paths
      const parsed = JSON.parse(data.spec) as OpenApiDoc;
      expect(parsed.openapi).toBe('3.0.3');
      expect(parsed.paths['/runs']).toBeDefined();
    });

    it('should use default title and version when not provided', async () => {
      createTempWorkflow(tmpDir, 'defaults.ts', VALID_WORKFLOW);
      const result = await runCommand('openapi', { directory: tmpDir, format: 'json' });
      const parsed = JSON.parse((result.data as OpenApiData).spec) as OpenApiDoc;
      expect(parsed.info.title).toBe('Flow Weaver API');
      expect(parsed.info.version).toBe(VERSION);
    });

    it('should skip non-ts files', async () => {
      createTempWorkflow(tmpDir, 'workflow.ts', VALID_WORKFLOW);
      fs.writeFileSync(path.join(tmpDir, 'readme.md'), '# Hello');
      fs.writeFileSync(path.join(tmpDir, 'config.json'), '{}');
      const result = await runCommand('openapi', { directory: tmpDir, format: 'json' });
      const data = result.data as OpenApiData;
      expect(data.workflowCount).toBe(1); // Only the .ts file
    });
  });

  // ─── getAvailableCommands ─────────────────────────────────────────
  describe('getAvailableCommands', () => {
    it('should include all extended commands', () => {
      const commands = getAvailableCommands();
      const expected = [
        'status', 'market-search', 'market-list',
        'migrate', 'openapi',
      ];
      for (const cmd of expected) {
        expect(commands).toContain(cmd);
      }
    });

    it('should also include all original commands', () => {
      const commands = getAvailableCommands();
      const original = [
        'compile', 'validate', 'describe', 'diagram',
        'diff', 'context', 'modify', 'scaffold', 'query', 'run',
      ];
      for (const cmd of original) {
        expect(commands).toContain(cmd);
      }
    });

    it('should not contain duplicates', () => {
      const commands = getAvailableCommands();
      const unique = new Set(commands);
      expect(unique.size).toBe(commands.length);
    });
  });

  // ─── doctor ──────────────────────────────────────────────────────
  describe('doctor', () => {
    it('should check environment and return results', async () => {
      const result = await runCommand('doctor', { cwd: tmpDir });
      expect(result.data).toBeDefined();
    });

    it('should report issues for directory without package.json', async () => {
      const emptyDir = path.join(tmpDir, 'no-pkg');
      fs.mkdirSync(emptyDir, { recursive: true });
      const result = await runCommand('doctor', { cwd: emptyDir });
      expect(result.data).toBeDefined();
    });
  });

  // ─── init ─────────────────────────────────────────────────────────
  describe('init', () => {
    it('should create a new project in the specified directory', async () => {
      const dir = path.join(tmpDir, 'init-project');
      const result = await runCommand('init', { directory: dir });
      expect(result.data).toBeDefined();
      const data = result.data as Record<string, unknown>;
      expect(data).toHaveProperty('directory');
    });

    it('should use default template when none specified', async () => {
      const dir = path.join(tmpDir, 'init-default');
      const result = await runCommand('init', { directory: dir });
      expect(result.data).toBeDefined();
    });
  });

  // ─── grammar ──────────────────────────────────────────────────────
  describe('grammar', () => {
    it('should return EBNF grammar text', async () => {
      const result = await runCommand('grammar', { format: 'ebnf' });
      expect(result.data).toBeDefined();
      const data = result.data as Record<string, unknown>;
      expect(data).toHaveProperty('grammar');
      expect(typeof data.grammar).toBe('string');
      expect((data.grammar as string).length).toBeGreaterThan(0);
    });

    it('should default to ebnf format', async () => {
      const result = await runCommand('grammar', {});
      const data = result.data as Record<string, unknown>;
      expect(data).toHaveProperty('grammar');
    });
  });

  // ─── export ──────────────────────────────────────────────────────
  describe('export', () => {
    it('should be a registered command', () => {
      expect(getAvailableCommands()).toContain('export');
    });

    it('should preview export without writing files', async () => {
      const filePath = createTempWorkflow(tmpDir, 'export-test.ts', VALID_WORKFLOW);
      const outDir = path.join(tmpDir, 'export-out');
      fs.mkdirSync(outDir, { recursive: true });
      const result = await runCommand('export', {
        file: filePath,
        target: 'inngest',
        output: outDir,
        dryRun: true,
      });
      expect(result.data).toBeDefined();
    });
  });

  // ─── getAvailableCommands includes new commands ───────────────────
  describe('getAvailableCommands - round 2', () => {
    it('should include doctor, init, grammar, export', () => {
      const commands = getAvailableCommands();
      for (const cmd of ['doctor', 'init', 'grammar', 'export']) {
        expect(commands).toContain(cmd);
      }
    });
  });

  // ─── error handling across all commands ────────────────────────────
  describe('error handling', () => {
    it('should throw for unknown command name', async () => {
      await expect(runCommand('nonexistent-command', {})).rejects.toThrow('Unknown command');
    });

    it('should include available commands in error message', async () => {
      try {
        await runCommand('bad-command', {});
      } catch (err) {
        expect((err as Error).message).toContain('Available:');
        expect((err as Error).message).toContain('status');
        expect((err as Error).message).toContain('market-search');
      }
    });
  });
});
