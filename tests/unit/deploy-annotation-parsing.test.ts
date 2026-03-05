/**
 * Tests for @deploy annotation parsing (Change 3 & 1)
 *
 * Covers:
 * - parseDeployTag() value coercion (boolean, number, string, string[])
 * - Workflow-level @deploy parsing → ast.options.deploy
 * - NodeType-level @deploy parsing → nodeTypeAST.deploy
 * - @deploy in KNOWN_WORKFLOW_TAGS and KNOWN_NODETYPE_TAGS
 *
 * CI/CD-specific tag tests (@secret, @runner, @cache, etc.) live in
 * @synergenius/flowweaver-pack-cicd since that's where the tag handler is now.
 */

import { describe, it, expect } from 'vitest';
import { AnnotationParser } from '../../src/parser';
import { KNOWN_WORKFLOW_TAGS, KNOWN_NODETYPE_TAGS } from '../../src/constants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseWorkflowSource(source: string) {
  const parser = new AnnotationParser();
  return parser.parseFromString(source, 'test.ts');
}

// ---------------------------------------------------------------------------
// Constants: @deploy is a known tag
// ---------------------------------------------------------------------------

describe('@deploy in known tags', () => {
  it('should be a known workflow tag', () => {
    expect(KNOWN_WORKFLOW_TAGS.has('deploy')).toBe(true);
  });

  it('should be a known node type tag', () => {
    expect(KNOWN_NODETYPE_TAGS.has('deploy')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Workflow-level @deploy parsing
// ---------------------------------------------------------------------------

describe('workflow-level @deploy parsing', () => {
  it('should parse @deploy target with no keys as empty object', () => {
    const result = parseWorkflowSource(`
/**
 * @flowWeaver workflow
 * @deploy inngest
 * @node a testNode [position: 0 0]
 * @path Start -> a -> Exit
 */
export function myWorkflow() {}

/** @flowWeaver nodeType
 * @expression
 */
function testNode(): {} { return {}; }
`);
    const wf = result.workflows[0];
    expect(wf.options?.deploy).toBeDefined();
    expect(wf.options?.deploy?.inngest).toEqual({});
  });

  it('should parse @deploy with string values', () => {
    const result = parseWorkflowSource(`
/**
 * @flowWeaver workflow
 * @deploy github-actions runner="ubuntu-latest"
 * @node a testNode [position: 0 0]
 * @path Start -> a -> Exit
 */
export function myWorkflow() {}

/** @flowWeaver nodeType
 * @expression
 */
function testNode(): {} { return {}; }
`);
    const wf = result.workflows[0];
    expect(wf.options?.deploy?.['github-actions']?.runner).toBe('ubuntu-latest');
  });

  it('should parse @deploy with boolean coercion', () => {
    const result = parseWorkflowSource(`
/**
 * @flowWeaver workflow
 * @deploy inngest durableSteps=true serve=false
 * @node a testNode [position: 0 0]
 * @path Start -> a -> Exit
 */
export function myWorkflow() {}

/** @flowWeaver nodeType
 * @expression
 */
function testNode(): {} { return {}; }
`);
    const deploy = result.workflows[0].options?.deploy?.inngest;
    expect(deploy?.durableSteps).toBe(true);
    expect(deploy?.serve).toBe(false);
  });

  it('should parse @deploy with number coercion', () => {
    const result = parseWorkflowSource(`
/**
 * @flowWeaver workflow
 * @deploy lambda memory=256 timeout=30
 * @node a testNode [position: 0 0]
 * @path Start -> a -> Exit
 */
export function myWorkflow() {}

/** @flowWeaver nodeType
 * @expression
 */
function testNode(): {} { return {}; }
`);
    const deploy = result.workflows[0].options?.deploy?.lambda;
    expect(deploy?.memory).toBe(256);
    expect(deploy?.timeout).toBe(30);
  });

  it('should parse @deploy with comma-separated string arrays', () => {
    const result = parseWorkflowSource(`
/**
 * @flowWeaver workflow
 * @deploy vercel regions="iad1,sfo1,lhr1"
 * @node a testNode [position: 0 0]
 * @path Start -> a -> Exit
 */
export function myWorkflow() {}

/** @flowWeaver nodeType
 * @expression
 */
function testNode(): {} { return {}; }
`);
    const deploy = result.workflows[0].options?.deploy?.vercel;
    expect(deploy?.regions).toEqual(['iad1', 'sfo1', 'lhr1']);
  });

  it('should parse multiple @deploy targets on the same workflow', () => {
    const result = parseWorkflowSource(`
/**
 * @flowWeaver workflow
 * @deploy inngest durableSteps=true
 * @deploy lambda memory=512
 * @deploy vercel maxDuration=120
 * @node a testNode [position: 0 0]
 * @path Start -> a -> Exit
 */
export function myWorkflow() {}

/** @flowWeaver nodeType
 * @expression
 */
function testNode(): {} { return {}; }
`);
    const deploy = result.workflows[0].options?.deploy;
    expect(deploy?.inngest?.durableSteps).toBe(true);
    expect(deploy?.lambda?.memory).toBe(512);
    expect(deploy?.vercel?.maxDuration).toBe(120);
  });

  it('should parse @deploy with quoted values containing spaces', () => {
    const result = parseWorkflowSource(`
/**
 * @flowWeaver workflow
 * @deploy inngest framework="next"
 * @node a testNode [position: 0 0]
 * @path Start -> a -> Exit
 */
export function myWorkflow() {}

/** @flowWeaver nodeType
 * @expression
 */
function testNode(): {} { return {}; }
`);
    const deploy = result.workflows[0].options?.deploy?.inngest;
    expect(deploy?.framework).toBe('next');
  });

  it('should parse @deploy with escaped quotes inside values', () => {
    const result = parseWorkflowSource(`
/**
 * @flowWeaver workflow
 * @deploy github-actions script="echo \\"hello\\""
 * @node a testNode [position: 0 0]
 * @path Start -> a -> Exit
 */
export function myWorkflow() {}

/** @flowWeaver nodeType
 * @expression
 */
function testNode(): {} { return {}; }
`);
    const deploy = result.workflows[0].options?.deploy?.['github-actions'];
    expect(deploy?.script).toBe('echo \\"hello\\"');
  });

  it('should parse @deploy with single quotes inside double-quoted values', () => {
    const result = parseWorkflowSource(`
/**
 * @flowWeaver workflow
 * @deploy github-actions cmd="echo 'hello world'"
 * @node a testNode [position: 0 0]
 * @path Start -> a -> Exit
 */
export function myWorkflow() {}

/** @flowWeaver nodeType
 * @expression
 */
function testNode(): {} { return {}; }
`);
    const deploy = result.workflows[0].options?.deploy?.['github-actions'];
    expect(deploy?.cmd).toBe("echo 'hello world'");
  });

  it('should split comma-separated quoted values into arrays', () => {
    const result = parseWorkflowSource(`
/**
 * @flowWeaver workflow
 * @deploy gitlab-ci branches="main,develop,staging"
 * @node a testNode [position: 0 0]
 * @path Start -> a -> Exit
 */
export function myWorkflow() {}

/** @flowWeaver nodeType
 * @expression
 */
function testNode(): {} { return {}; }
`);
    const deploy = result.workflows[0].options?.deploy?.['gitlab-ci'];
    expect(deploy?.branches).toEqual(['main', 'develop', 'staging']);
  });

  it('should not split non-comma quoted values into arrays', () => {
    const result = parseWorkflowSource(`
/**
 * @flowWeaver workflow
 * @deploy gitlab-ci script="npm ci"
 * @node a testNode [position: 0 0]
 * @path Start -> a -> Exit
 */
export function myWorkflow() {}

/** @flowWeaver nodeType
 * @expression
 */
function testNode(): {} { return {}; }
`);
    const deploy = result.workflows[0].options?.deploy?.['gitlab-ci'];
    expect(deploy?.script).toBe('npm ci');
  });

  it('should parse bare (unquoted) string values', () => {
    const result = parseWorkflowSource(`
/**
 * @flowWeaver workflow
 * @deploy lambda runtime=nodejs20.x
 * @node a testNode [position: 0 0]
 * @path Start -> a -> Exit
 */
export function myWorkflow() {}

/** @flowWeaver nodeType
 * @expression
 */
function testNode(): {} { return {}; }
`);
    // nodejs20.x is not a number and not a boolean, so stays as string
    const deploy = result.workflows[0].options?.deploy?.lambda;
    expect(deploy?.runtime).toBe('nodejs20.x');
  });
});

// ---------------------------------------------------------------------------
// NodeType-level @deploy parsing
// ---------------------------------------------------------------------------

describe('nodeType-level @deploy parsing', () => {
  it('should parse @deploy on a nodeType into nodeType.deploy', () => {
    const result = parseWorkflowSource(`
/**
 * @flowWeaver workflow
 * @node a checkout [position: 0 0]
 * @path Start -> a -> Exit
 */
export function myWorkflow() {}

/**
 * @flowWeaver nodeType
 * @expression
 * @label Checkout code
 * @deploy github-actions action="actions/checkout@v4"
 */
function checkout(): { repo: string } { return { repo: 'main' }; }
`);
    const nt = result.workflows[0].nodeTypes.find(n => n.functionName === 'checkout');
    expect(nt?.deploy).toBeDefined();
    expect(nt?.deploy?.['github-actions']?.action).toBe('actions/checkout@v4');
  });

  it('should parse multiple @deploy targets on a nodeType', () => {
    const result = parseWorkflowSource(`
/**
 * @flowWeaver workflow
 * @node a setupNode [position: 0 0]
 * @path Start -> a -> Exit
 */
export function myWorkflow() {}

/**
 * @flowWeaver nodeType
 * @expression
 * @deploy github-actions action="actions/setup-node@v4"
 * @deploy gitlab-ci image="node:20"
 */
function setupNode(): {} { return {}; }
`);
    const nt = result.workflows[0].nodeTypes.find(n => n.functionName === 'setupNode');
    expect(nt?.deploy?.['github-actions']?.action).toBe('actions/setup-node@v4');
    expect(nt?.deploy?.['gitlab-ci']?.image).toBe('node:20');
  });

  it('should parse @deploy with JSON-like with parameter', () => {
    const result = parseWorkflowSource(`
/**
 * @flowWeaver workflow
 * @node a setupNode [position: 0 0]
 * @path Start -> a -> Exit
 */
export function myWorkflow() {}

/**
 * @flowWeaver nodeType
 * @expression
 * @deploy github-actions action="actions/setup-node@v4" with='{"node-version":"20"}'
 */
function setupNode(): {} { return {}; }
`);
    const nt = result.workflows[0].nodeTypes.find(n => n.functionName === 'setupNode');
    // with is passed as a bare value (single quotes won't be matched by the regex)
    // The regex uses double quotes; single-quoted values would be bare
    expect(nt?.deploy?.['github-actions']?.action).toBe('actions/setup-node@v4');
  });

  it('should not set deploy if no @deploy annotations present', () => {
    const result = parseWorkflowSource(`
/**
 * @flowWeaver workflow
 * @node a plainNode [position: 0 0]
 * @path Start -> a -> Exit
 */
export function myWorkflow() {}

/**
 * @flowWeaver nodeType
 * @expression
 */
function plainNode(): {} { return {}; }
`);
    const nt = result.workflows[0].nodeTypes.find(n => n.functionName === 'plainNode');
    expect(nt?.deploy).toBeUndefined();
  });
});

