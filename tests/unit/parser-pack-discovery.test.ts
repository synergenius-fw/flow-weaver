import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AnnotationParser } from '../../src/parser';
import { TagHandlerRegistry } from '../../src/parser/tag-registry';
import { ValidationRuleRegistry } from '../../src/validation/rule-registry';
import { validationRuleRegistry } from '../../src/api/validation-registry';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Tests that the parser discovers and registers tag handlers and
 * validation rule sets from installed marketplace packs via their
 * flowweaver.manifest.json.
 */

const FIXTURES_DIR = path.join(os.tmpdir(), 'fw-test-pack-discovery');

function setupFakePack(): void {
  // Create a fake pack in node_modules with a tag handler
  const packDir = path.join(FIXTURES_DIR, 'node_modules', 'flowweaver-pack-test');
  fs.mkdirSync(path.join(packDir, 'dist'), { recursive: true });

  // Write manifest declaring a tag handler and a validation rule set
  const manifest = {
    manifestVersion: 2,
    name: 'flowweaver-pack-test',
    version: '0.1.0',
    nodeTypes: [],
    workflows: [],
    patterns: [],
    tagHandlers: [
      {
        tags: ['customtag'],
        namespace: 'testns',
        scope: 'workflow',
        file: 'dist/handler.js',
        exportName: 'testHandler',
      },
    ],
    validationRuleSets: [
      {
        name: 'Test Rules',
        namespace: 'testns',
        file: 'dist/rules.js',
        detectExport: 'detectTest',
        rulesExport: 'getTestRules',
      },
    ],
  };
  fs.writeFileSync(
    path.join(packDir, 'flowweaver.manifest.json'),
    JSON.stringify(manifest),
  );
  fs.writeFileSync(
    path.join(packDir, 'package.json'),
    JSON.stringify({ name: 'flowweaver-pack-test', version: '0.1.0' }),
  );

  // Write the handler module
  const handlerCode = `
    export function testHandler(tagName, comment, ctx) {
      ctx.deploy.handled = true;
      ctx.deploy.value = comment.trim();
    }
  `;
  fs.writeFileSync(path.join(packDir, 'dist', 'handler.js'), handlerCode);

  // Write the validation rules module
  const rulesCode = `
    export function detectTest(ast) {
      return !!(ast.options && ast.options.deploy && ast.options.deploy.testns);
    }
    export function getTestRules() {
      return [{ name: 'TEST_RULE', validate: () => [] }];
    }
  `;
  fs.writeFileSync(path.join(packDir, 'dist', 'rules.js'), rulesCode);
}

beforeAll(() => {
  fs.rmSync(FIXTURES_DIR, { recursive: true, force: true });
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  setupFakePack();
});

afterAll(() => {
  fs.rmSync(FIXTURES_DIR, { recursive: true, force: true });
});

describe('parser pack discovery', () => {
  it('discovers and registers tag handlers from installed packs', async () => {
    const parser = new AnnotationParser();
    // Use a fresh registry so we don't conflict with global state
    parser.tagRegistry = new TagHandlerRegistry();

    await parser.loadPackHandlers(FIXTURES_DIR);

    expect(parser.tagRegistry.has('customtag')).toBe(true);
  });

  it('caches discovery so repeated calls skip re-scan', async () => {
    const parser = new AnnotationParser();
    parser.tagRegistry = new TagHandlerRegistry();

    await parser.loadPackHandlers(FIXTURES_DIR);
    expect(parser.tagRegistry.has('customtag')).toBe(true);

    // Remove the pack directory to prove we're using cache
    const packDir = path.join(FIXTURES_DIR, 'node_modules', 'flowweaver-pack-test');
    const manifestPath = path.join(packDir, 'flowweaver.manifest.json');
    const original = fs.readFileSync(manifestPath, 'utf-8');
    fs.unlinkSync(manifestPath);

    // Second call should not fail because it's cached
    await parser.loadPackHandlers(FIXTURES_DIR);

    // Restore for other tests
    fs.writeFileSync(manifestPath, original);
  });

  it('skips tags already registered (e.g. from side-effect imports)', async () => {
    const parser = new AnnotationParser();
    parser.tagRegistry = new TagHandlerRegistry();

    // Pre-register the tag
    const existingHandler = () => {};
    parser.tagRegistry.register(['customtag'], 'existing', 'workflow', existingHandler);

    await parser.loadPackHandlers(FIXTURES_DIR);

    // The handler should still be the original one, not overwritten
    const deployMap: Record<string, Record<string, unknown>> = {};
    parser.tagRegistry.handle('customtag', 'test', 'workflow', deployMap, []);
    // The existing handler is a no-op, so 'testns' namespace shouldn't exist
    expect(deployMap['testns']).toBeUndefined();
  });

  it('handles the tag via the discovered handler', async () => {
    const parser = new AnnotationParser();
    parser.tagRegistry = new TagHandlerRegistry();

    await parser.loadPackHandlers(FIXTURES_DIR);

    const deployMap: Record<string, Record<string, unknown>> = {};
    const warnings: string[] = [];
    const handled = parser.tagRegistry.handle('customtag', 'hello world', 'workflow', deployMap, warnings);

    expect(handled).toBe(true);
    expect(deployMap['testns']).toBeDefined();
    expect(deployMap['testns'].handled).toBe(true);
    expect(deployMap['testns'].value).toBe('hello world');
  });

  it('silently skips packs with missing handler files', async () => {
    const brokenDir = path.join(os.tmpdir(), 'fw-test-pack-broken');
    fs.mkdirSync(path.join(brokenDir, 'node_modules', 'flowweaver-pack-broken'), { recursive: true });

    const manifest = {
      manifestVersion: 2,
      name: 'flowweaver-pack-broken',
      version: '0.1.0',
      nodeTypes: [],
      workflows: [],
      patterns: [],
      tagHandlers: [
        {
          tags: ['brokentag'],
          namespace: 'broken',
          scope: 'workflow',
          file: 'dist/nonexistent.js',
          exportName: 'handler',
        },
      ],
    };
    fs.writeFileSync(
      path.join(brokenDir, 'node_modules', 'flowweaver-pack-broken', 'flowweaver.manifest.json'),
      JSON.stringify(manifest),
    );
    fs.writeFileSync(
      path.join(brokenDir, 'node_modules', 'flowweaver-pack-broken', 'package.json'),
      JSON.stringify({ name: 'flowweaver-pack-broken', version: '0.1.0' }),
    );

    const parser = new AnnotationParser();
    parser.tagRegistry = new TagHandlerRegistry();

    // Should not throw
    await parser.loadPackHandlers(brokenDir);
    expect(parser.tagRegistry.has('brokentag')).toBe(false);

    fs.rmSync(brokenDir, { recursive: true, force: true });
  });

  it('handles project with no node_modules gracefully', async () => {
    const emptyDir = path.join(os.tmpdir(), 'fw-test-pack-empty');
    fs.mkdirSync(emptyDir, { recursive: true });

    const parser = new AnnotationParser();
    parser.tagRegistry = new TagHandlerRegistry();

    // Should not throw
    await parser.loadPackHandlers(emptyDir);
    expect(parser.tagRegistry.getRegisteredTags()).toHaveLength(0);

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('discovers and registers validation rule sets from installed packs', async () => {
    const sizeBefore = validationRuleRegistry.size;

    const parser = new AnnotationParser();
    parser.tagRegistry = new TagHandlerRegistry();

    // Use a unique dir so the per-projectDir cache doesn't interfere
    const freshDir = path.join(os.tmpdir(), 'fw-test-pack-rules-' + Date.now());
    fs.mkdirSync(freshDir, { recursive: true });

    // Copy the fake pack into this fresh dir
    const srcPack = path.join(FIXTURES_DIR, 'node_modules', 'flowweaver-pack-test');
    const dstPack = path.join(freshDir, 'node_modules', 'flowweaver-pack-test');
    fs.cpSync(srcPack, dstPack, { recursive: true });

    await parser.loadPackHandlers(freshDir);

    expect(validationRuleRegistry.size).toBeGreaterThan(sizeBefore);

    // The registered rule set should produce rules for a matching AST
    const matchingAST = {
      type: 'Workflow' as const,
      sourceFile: 'test.ts',
      name: 'test',
      functionName: 'test',
      nodeTypes: [],
      instances: [],
      connections: [],
      startPorts: {},
      exitPorts: {},
      imports: [],
      options: { deploy: { testns: { enabled: true } } },
    };
    const rules = validationRuleRegistry.getApplicableRules(matchingAST);
    const testRule = rules.find((r) => r.name === 'TEST_RULE');
    expect(testRule).toBeDefined();

    fs.rmSync(freshDir, { recursive: true, force: true });
  });

  it('skips validation rule sets with missing detect or getRules exports', async () => {
    const badDir = path.join(os.tmpdir(), 'fw-test-pack-bad-rules-' + Date.now());
    const packDir = path.join(badDir, 'node_modules', 'flowweaver-pack-badrules');
    fs.mkdirSync(path.join(packDir, 'dist'), { recursive: true });

    const manifest = {
      manifestVersion: 2,
      name: 'flowweaver-pack-badrules',
      version: '0.1.0',
      nodeTypes: [],
      workflows: [],
      patterns: [],
      validationRuleSets: [
        {
          name: 'Bad Rules',
          namespace: 'bad',
          file: 'dist/rules.js',
          detectExport: 'missingFn',
          rulesExport: 'alsoMissing',
        },
      ],
    };
    fs.writeFileSync(path.join(packDir, 'flowweaver.manifest.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(packDir, 'package.json'), JSON.stringify({ name: 'flowweaver-pack-badrules', version: '0.1.0' }));
    // Module exists but doesn't export the expected functions
    fs.writeFileSync(path.join(packDir, 'dist', 'rules.js'), 'export const unrelated = 42;');

    const sizeBefore = validationRuleRegistry.size;
    const parser = new AnnotationParser();
    parser.tagRegistry = new TagHandlerRegistry();

    // Should not throw
    await parser.loadPackHandlers(badDir);
    // No new rules should be registered
    expect(validationRuleRegistry.size).toBe(sizeBefore);

    fs.rmSync(badDir, { recursive: true, force: true });
  });
});
