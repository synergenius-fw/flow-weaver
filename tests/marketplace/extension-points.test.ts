/**
 * Tests for pack extension point infrastructure.
 *
 * Covers:
 * - TagHandlerRegistry: register, has, handle, scope checking
 * - ValidationRuleRegistry: register, detect, getApplicableRules
 * - Parser integration: unknown tags delegated to registry
 * - Validate API integration: registry rules applied
 * - Manifest v2 type compatibility
 * - Doc topic registration
 * - Init use case registration
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TagHandlerRegistry } from '../../src/parser/tag-registry';
import type { TTagHandlerFn } from '../../src/parser/tag-registry';
import { ValidationRuleRegistry } from '../../src/validation/rule-registry';
import type { TValidationRule, TWorkflowAST } from '../../src/ast/types';
import { AnnotationParser } from '../../src/parser';
import { getKnownWorkflowTags, KNOWN_WORKFLOW_TAGS } from '../../src/constants';
import { registerPackDocTopics, getPackDocTopics, listTopics } from '../../src/docs/index';
import { registerPackUseCase, USE_CASE_CHOICES, USE_CASE_TEMPLATES } from '../../src/cli/commands/init-personas';
import type { TMarketplaceManifest } from '../../src/marketplace/types';

// ---------------------------------------------------------------------------
// TagHandlerRegistry
// ---------------------------------------------------------------------------

describe('TagHandlerRegistry', () => {
  let registry: TagHandlerRegistry;

  beforeEach(() => {
    registry = new TagHandlerRegistry();
  });

  it('registers and checks tag handlers', () => {
    const handler: TTagHandlerFn = () => {};
    registry.register(['myTag', 'anotherTag'], 'my-pack', 'workflow', handler);

    expect(registry.has('myTag')).toBe(true);
    expect(registry.has('anotherTag')).toBe(true);
    expect(registry.has('unknownTag')).toBe(false);
  });

  it('returns registered tag names', () => {
    const handler: TTagHandlerFn = () => {};
    registry.register(['alpha', 'beta'], 'ns', 'both', handler);

    const tags = registry.getRegisteredTags();
    expect(tags).toContain('alpha');
    expect(tags).toContain('beta');
  });

  it('handles a tag and writes to deploy map', () => {
    const handler: TTagHandlerFn = (_tagName, comment, ctx) => {
      ctx.deploy['value'] = comment.trim();
    };
    registry.register(['customTag'], 'myns', 'workflow', handler);

    const deployMap: Record<string, Record<string, unknown>> = {};
    const warnings: string[] = [];

    const handled = registry.handle('customTag', '  hello  ', 'workflow', deployMap, warnings);

    expect(handled).toBe(true);
    expect(deployMap['myns']).toEqual({ value: 'hello' });
    expect(warnings).toHaveLength(0);
  });

  it('returns false for unregistered tags', () => {
    const deployMap: Record<string, Record<string, unknown>> = {};
    const handled = registry.handle('missing', 'text', 'workflow', deployMap, []);
    expect(handled).toBe(false);
  });

  it('warns when tag scope does not match block scope', () => {
    const handler: TTagHandlerFn = () => {};
    registry.register(['nodeOnly'], 'ns', 'nodeType', handler);

    const deployMap: Record<string, Record<string, unknown>> = {};
    const warnings: string[] = [];

    const handled = registry.handle('nodeOnly', 'val', 'workflow', deployMap, warnings);

    expect(handled).toBe(true); // consumed with warning
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('nodeType blocks');
  });

  it('scope "both" matches either block type', () => {
    const handler: TTagHandlerFn = (_tag, comment, ctx) => {
      ctx.deploy['hit'] = true;
    };
    registry.register(['universal'], 'ns', 'both', handler);

    const d1: Record<string, Record<string, unknown>> = {};
    registry.handle('universal', '', 'workflow', d1, []);
    expect(d1['ns']).toEqual({ hit: true });

    const d2: Record<string, Record<string, unknown>> = {};
    registry.handle('universal', '', 'nodeType', d2, []);
    expect(d2['ns']).toEqual({ hit: true });
  });
});

// ---------------------------------------------------------------------------
// ValidationRuleRegistry
// ---------------------------------------------------------------------------

describe('ValidationRuleRegistry', () => {
  let registry: ValidationRuleRegistry;

  beforeEach(() => {
    registry = new ValidationRuleRegistry();
  });

  const makeAST = (hasDeploy: boolean): TWorkflowAST => ({
    type: 'Workflow',
    sourceFile: 'test.ts',
    name: 'test',
    functionName: 'test',
    nodeTypes: [],
    instances: [],
    connections: [],
    startPorts: {},
    exitPorts: {},
    imports: [],
    options: hasDeploy ? { deploy: { myns: { enabled: true } } } : undefined,
  });

  it('returns no rules when nothing is registered', () => {
    const rules = registry.getApplicableRules(makeAST(false));
    expect(rules).toHaveLength(0);
    expect(registry.size).toBe(0);
  });

  it('returns rules when detect predicate matches', () => {
    const mockRule: TValidationRule = {
      name: 'test-rule',
      validate: () => [],
    };

    registry.register({
      name: 'my-rules',
      namespace: 'myns',
      detect: (ast) => !!ast.options?.deploy?.['myns'],
      getRules: () => [mockRule],
    });

    expect(registry.getApplicableRules(makeAST(true))).toEqual([mockRule]);
    expect(registry.getApplicableRules(makeAST(false))).toHaveLength(0);
  });

  it('merges rules from multiple matching rule sets', () => {
    const rule1: TValidationRule = { name: 'r1', validate: () => [] };
    const rule2: TValidationRule = { name: 'r2', validate: () => [] };

    registry.register({
      name: 'set-1',
      namespace: 'a',
      detect: () => true,
      getRules: () => [rule1],
    });
    registry.register({
      name: 'set-2',
      namespace: 'b',
      detect: () => true,
      getRules: () => [rule2],
    });

    const rules = registry.getApplicableRules(makeAST(false));
    expect(rules).toHaveLength(2);
    expect(rules).toContain(rule1);
    expect(rules).toContain(rule2);
  });
});

// ---------------------------------------------------------------------------
// Parser integration: TagHandlerRegistry in workflow parsing
// ---------------------------------------------------------------------------

describe('Parser + TagHandlerRegistry integration', () => {
  it('delegates unknown workflow tags to the registry instead of warning', () => {
    const parser = new AnnotationParser();
    const registry = new TagHandlerRegistry();

    const handler: TTagHandlerFn = (_tag, comment, ctx) => {
      const names = (ctx.deploy['names'] as string[] | undefined) ?? [];
      names.push(comment.trim());
      ctx.deploy['names'] = names;
    };
    registry.register(['customAnnotation'], 'test-pack', 'workflow', handler);
    parser.tagRegistry = registry;

    const code = `
/**
 * @flowWeaver workflow
 * @customAnnotation my-value
 * @node step1 Processor
 * @path Start -> step1 -> Exit
 */
export function testWorkflow(execute: boolean): { onSuccess: boolean } {
  throw new Error("Compile me");
}

/**
 * @flowWeaver nodeType
 * @input data - Input data
 * @output result - Output result
 */
function Processor(execute: boolean, data: string): { onSuccess: boolean; result: string } {
  return { onSuccess: true, result: data };
}
`;

    const result = parser.parseFromString(code);
    // No "unknown annotation" warnings for @customAnnotation
    const unknownWarnings = result.warnings.filter((w) => w.includes('Unknown annotation @customAnnotation'));
    expect(unknownWarnings).toHaveLength(0);

    // The deploy data should be stored on the workflow options
    const wf = result.workflows[0];
    expect(wf.options?.deploy?.['test-pack']).toBeDefined();
    expect(wf.options?.deploy?.['test-pack']?.['names']).toEqual(['my-value']);
  });

  it('still warns for truly unknown tags when no handler exists', () => {
    const parser = new AnnotationParser();
    // No registry set

    const code = `
/**
 * @flowWeaver workflow
 * @totallyBogusTag some-value
 * @node step1 Processor
 * @path Start -> step1 -> Exit
 */
export function testWorkflow(execute: boolean): { onSuccess: boolean } {
  throw new Error("Compile me");
}

/**
 * @flowWeaver nodeType
 */
function Processor(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`;

    const result = parser.parseFromString(code);
    const unknownWarnings = result.warnings.filter((w) => w.includes('Unknown annotation @totallyBogusTag'));
    // Warning appears twice: once from signature extraction pass, once from full extraction
    expect(unknownWarnings.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// getKnownWorkflowTags
// ---------------------------------------------------------------------------

describe('getKnownWorkflowTags', () => {
  it('returns core tags when no extras provided', () => {
    const tags = getKnownWorkflowTags();
    expect(tags).toBe(KNOWN_WORKFLOW_TAGS);
  });

  it('merges extra tags into the set', () => {
    const tags = getKnownWorkflowTags(['myCustomTag', 'anotherTag']);
    expect(tags.has('myCustomTag')).toBe(true);
    expect(tags.has('anotherTag')).toBe(true);
    // Core tags still present
    expect(tags.has('node')).toBe(true);
    expect(tags.has('connect')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AST type: deploy field on TNodeInstanceAST
// ---------------------------------------------------------------------------

describe('TNodeInstanceAST deploy field', () => {
  it('parser preserves job/environment on instances (backwards compat)', () => {
    const parser = new AnnotationParser();
    const code = `
/**
 * @flowWeaver nodeType
 */
function Build(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}

/**
 * @flowWeaver workflow
 * @node build1 Build [job: "build"]
 * @path Start -> build1 -> Exit
 */
export function pipeline(execute: boolean): { onSuccess: boolean } {
  throw new Error("Compile me");
}
`;

    const result = parser.parseFromString(code);
    const wf = result.workflows[0];
    const instance = wf.instances.find((i) => i.id === 'build1');
    expect(instance).toBeDefined();
    expect(instance!.job).toBe('build');
  });
});

// ---------------------------------------------------------------------------
// Manifest v2 type compatibility
// ---------------------------------------------------------------------------

describe('Manifest v2 types', () => {
  it('accepts manifestVersion 2 with extension fields', () => {
    const manifest: TMarketplaceManifest = {
      manifestVersion: 2,
      name: 'flowweaver-pack-test',
      version: '1.0.0',
      nodeTypes: [],
      workflows: [],
      patterns: [],
      tagHandlers: [
        {
          tags: ['myTag'],
          namespace: 'test',
          scope: 'workflow',
          file: 'dist/tag-handler.js',
        },
      ],
      validationRuleSets: [
        {
          name: 'Test Rules',
          namespace: 'test',
          file: 'dist/rules.js',
        },
      ],
      docs: [
        {
          slug: 'test-guide',
          name: 'Test Guide',
          file: 'docs/guide.md',
          presets: ['ops'],
        },
      ],
      initContributions: {
        useCase: {
          id: 'testing',
          name: 'Testing',
          description: 'Test workflows',
        },
        templates: ['test-template'],
      },
    };

    // Type check passes (no runtime assertion needed, but verify structure)
    expect(manifest.manifestVersion).toBe(2);
    expect(manifest.tagHandlers).toHaveLength(1);
    expect(manifest.validationRuleSets).toHaveLength(1);
    expect(manifest.docs).toHaveLength(1);
    expect(manifest.initContributions?.useCase?.id).toBe('testing');
  });

  it('accepts manifestVersion 1 without extension fields', () => {
    const manifest: TMarketplaceManifest = {
      manifestVersion: 1,
      name: 'flowweaver-pack-legacy',
      version: '1.0.0',
      nodeTypes: [],
      workflows: [],
      patterns: [],
    };

    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.tagHandlers).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Doc topic registration
// ---------------------------------------------------------------------------

describe('Doc topic registration', () => {
  it('registers pack doc topics and exposes them via getPackDocTopics', () => {
    const before = getPackDocTopics().length;

    registerPackDocTopics([
      {
        slug: 'test-ext-topic-' + Date.now(),
        name: 'Test Extension Topic',
        description: 'A test topic from a pack',
        keywords: ['test'],
        presets: ['ops'],
        absoluteFile: '/nonexistent/path/topic.md',
      },
    ]);

    expect(getPackDocTopics().length).toBeGreaterThan(before);
  });

  it('deduplicates topics by slug', () => {
    const slug = 'dedup-test-' + Date.now();
    registerPackDocTopics([
      { slug, name: 'First', absoluteFile: '/a.md' },
    ]);
    const count = getPackDocTopics().filter((t) => t.slug === slug).length;

    registerPackDocTopics([
      { slug, name: 'Second', absoluteFile: '/b.md' },
    ]);
    const countAfter = getPackDocTopics().filter((t) => t.slug === slug).length;

    expect(countAfter).toBe(count); // no duplicate
  });
});

// ---------------------------------------------------------------------------
// Init use case registration
// ---------------------------------------------------------------------------

describe('Init use case registration', () => {
  it('registers a pack use case and template mapping', () => {
    const ucId = 'test-uc-' + Date.now();

    registerPackUseCase(
      { id: ucId, name: 'Test Use Case', description: 'A test use case' },
      ['test-template-1', 'test-template-2'],
    );

    // Check it was added to USE_CASE_CHOICES
    const choice = USE_CASE_CHOICES.find((c) => c.value === ucId);
    expect(choice).toBeDefined();
    expect(choice!.name).toBe('Test Use Case');

    // Check template mapping was created
    expect(USE_CASE_TEMPLATES[ucId]).toBeDefined();
    expect(USE_CASE_TEMPLATES[ucId].default).toBe('test-template-1');
    expect(USE_CASE_TEMPLATES[ucId].all).toEqual(['test-template-1', 'test-template-2']);
  });

  it('inserts before the minimal entry', () => {
    const ucId = 'test-uc-order-' + Date.now();
    registerPackUseCase(
      { id: ucId, name: 'Order Test', description: 'Test' },
      ['t1'],
    );

    const minimalIdx = USE_CASE_CHOICES.findIndex((c) => c.value === 'minimal');
    const ucIdx = USE_CASE_CHOICES.findIndex((c) => c.value === ucId);

    expect(ucIdx).toBeLessThan(minimalIdx);
  });

  it('does not duplicate an already registered use case', () => {
    const ucId = 'test-uc-dedup-' + Date.now();
    registerPackUseCase({ id: ucId, name: 'First', description: 'Test' }, ['t1']);
    const count1 = USE_CASE_CHOICES.filter((c) => c.value === ucId).length;

    registerPackUseCase({ id: ucId, name: 'Second', description: 'Test' }, ['t2']);
    const count2 = USE_CASE_CHOICES.filter((c) => c.value === ucId).length;

    expect(count2).toBe(count1);
  });
});
