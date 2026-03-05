/**
 * Tests for CI/CD validation gating (Change 6)
 *
 * Covers:
 * - isCICDWorkflow() detection with cicd? wrapper
 * - CI/CD rules NOT applied to non-CI/CD workflows
 * - CI/CD rules applied to CI/CD workflows
 * - getDeclaredSecrets() and getReferencedSecrets() with cicd? wrapper
 */

// Load CI/CD extension (registers tag handlers, validation rules)
import '../register';

import { describe, it, expect } from 'vitest';
import { isCICDWorkflow, getJobNames, getDeclaredSecrets, getReferencedSecrets } from '../detection';
import { getCICDValidationRules } from '../rules';
import { validateWorkflow } from '../../../api/validate';
import { parser } from '../../../parser';
import type { TWorkflowAST, TNodeTypeAST, TNodeInstanceAST, TConnectionAST } from '../../../ast/types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeNodeType(overrides: Partial<TNodeTypeAST> = {}): TNodeTypeAST {
  return {
    type: 'NodeType',
    name: overrides.name || 'testNode',
    functionName: overrides.functionName || overrides.name || 'testNode',
    inputs: overrides.inputs || {},
    outputs: overrides.outputs || {},
    hasSuccessPort: overrides.hasSuccessPort ?? false,
    hasFailurePort: overrides.hasFailurePort ?? false,
    executeWhen: overrides.executeWhen || ('CONJUNCTION' as TNodeTypeAST['executeWhen']),
    isAsync: overrides.isAsync ?? false,
  };
}

function makeWorkflow(overrides: Partial<TWorkflowAST> = {}): TWorkflowAST {
  return {
    type: 'Workflow',
    name: overrides.name || 'testWorkflow',
    functionName: overrides.functionName || 'testWorkflow',
    sourceFile: overrides.sourceFile || 'test.ts',
    nodeTypes: overrides.nodeTypes || [makeNodeType()],
    instances: overrides.instances || [
      { type: 'NodeInstance', id: 'node1', nodeType: 'testNode' },
    ],
    connections: overrides.connections || [
      { type: 'Connection', from: { node: 'Start', port: 'x' }, to: { node: 'node1', port: 'input' } },
      { type: 'Connection', from: { node: 'node1', port: 'output' }, to: { node: 'Exit', port: 'result' } },
    ],
    scopes: {},
    startPorts: { x: { dataType: 'NUMBER' } },
    exitPorts: { result: { dataType: 'NUMBER' } },
    imports: [],
    options: overrides.options,
  };
}

// ---------------------------------------------------------------------------
// isCICDWorkflow() detection
// ---------------------------------------------------------------------------

describe('isCICDWorkflow() with cicd wrapper', () => {
  it('should return false for a plain workflow (no cicd options)', () => {
    const ast = makeWorkflow();
    expect(isCICDWorkflow(ast)).toBe(false);
  });

  it('should return true when cicd.secrets is populated', () => {
    const ast = makeWorkflow({
      options: {
        cicd: {
          secrets: [{ name: 'MY_SECRET', description: 'A secret' }],
        },
      },
    });
    expect(isCICDWorkflow(ast)).toBe(true);
  });

  it('should return true when cicd.runner is set', () => {
    const ast = makeWorkflow({
      options: {
        cicd: {
          runner: 'ubuntu-latest',
        },
      },
    });
    expect(isCICDWorkflow(ast)).toBe(true);
  });

  it('should return true when cicd.caches is populated', () => {
    const ast = makeWorkflow({
      options: {
        cicd: {
          caches: [{ strategy: 'npm', path: '~/.npm', key: 'npm-hash' }],
        },
      },
    });
    expect(isCICDWorkflow(ast)).toBe(true);
  });

  it('should return true when cicd.artifacts is populated', () => {
    const ast = makeWorkflow({
      options: {
        cicd: {
          artifacts: [{ name: 'dist', path: 'dist/' }],
        },
      },
    });
    expect(isCICDWorkflow(ast)).toBe(true);
  });

  it('should return true when cicd.environments is populated', () => {
    const ast = makeWorkflow({
      options: {
        cicd: {
          environments: [{ name: 'production' }],
        },
      },
    });
    expect(isCICDWorkflow(ast)).toBe(true);
  });

  it('should return true when cicd.matrix is set', () => {
    const ast = makeWorkflow({
      options: {
        cicd: {
          matrix: { dimensions: { node: ['18', '20'] } },
        },
      },
    });
    expect(isCICDWorkflow(ast)).toBe(true);
  });

  it('should return true when cicd.services is populated', () => {
    const ast = makeWorkflow({
      options: {
        cicd: {
          services: [{ name: 'postgres', image: 'postgres:15' }],
        },
      },
    });
    expect(isCICDWorkflow(ast)).toBe(true);
  });

  it('should return true when cicd.concurrency is set', () => {
    const ast = makeWorkflow({
      options: {
        cicd: {
          concurrency: { group: 'deploy', cancelInProgress: true },
        },
      },
    });
    expect(isCICDWorkflow(ast)).toBe(true);
  });

  it('should return true when cicd.triggers is populated', () => {
    const ast = makeWorkflow({
      options: {
        cicd: {
          triggers: [{ type: 'push', branches: ['main'] }],
        },
      },
    });
    expect(isCICDWorkflow(ast)).toBe(true);
  });

  it('should return true when any instance has a job attribute', () => {
    const ast = makeWorkflow({
      instances: [
        { type: 'NodeInstance', id: 'node1', nodeType: 'testNode', job: 'build' },
      ],
    });
    expect(isCICDWorkflow(ast)).toBe(true);
  });

  it('should return false when cicd exists but is empty', () => {
    const ast = makeWorkflow({
      options: {
        cicd: {},
      },
    });
    expect(isCICDWorkflow(ast)).toBe(false);
  });

  it('should return false when only deploy exists (no cicd)', () => {
    const ast = makeWorkflow({
      options: {
        deploy: { inngest: { durableSteps: true } },
      },
    });
    expect(isCICDWorkflow(ast)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getDeclaredSecrets() and getReferencedSecrets()
// ---------------------------------------------------------------------------

describe('getDeclaredSecrets()', () => {
  it('should return secret names from cicd.secrets', () => {
    const ast = makeWorkflow({
      options: {
        cicd: {
          secrets: [
            { name: 'NPM_TOKEN', description: 'NPM' },
            { name: 'SSH_KEY', description: 'SSH' },
          ],
        },
      },
    });
    expect(getDeclaredSecrets(ast)).toEqual(['NPM_TOKEN', 'SSH_KEY']);
  });

  it('should return empty array for non-CI/CD workflow', () => {
    const ast = makeWorkflow();
    expect(getDeclaredSecrets(ast)).toEqual([]);
  });
});

describe('getReferencedSecrets()', () => {
  it('should extract secret names from secret: connections', () => {
    const ast = makeWorkflow({
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'x' }, to: { node: 'node1', port: 'input' } },
        { type: 'Connection', from: { node: 'secret:NPM_TOKEN', port: 'value' }, to: { node: 'node1', port: 'token' } },
        { type: 'Connection', from: { node: 'node1', port: 'output' }, to: { node: 'Exit', port: 'result' } },
      ],
    });
    expect(getReferencedSecrets(ast)).toEqual(['NPM_TOKEN']);
  });
});

describe('getJobNames()', () => {
  it('should return unique job names from instances', () => {
    const ast = makeWorkflow({
      instances: [
        { type: 'NodeInstance', id: 'n1', nodeType: 'testNode', job: 'build' },
        { type: 'NodeInstance', id: 'n2', nodeType: 'testNode', job: 'test' },
        { type: 'NodeInstance', id: 'n3', nodeType: 'testNode', job: 'build' },
      ],
    });
    const jobs = getJobNames(ast);
    expect(jobs).toContain('build');
    expect(jobs).toContain('test');
    expect(jobs.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Validation gating: CI/CD rules only applied to CI/CD workflows
// ---------------------------------------------------------------------------

describe('CI/CD validation gating in validateWorkflow()', () => {
  it('should not apply CI/CD rules to non-CI/CD workflows', () => {
    // A simple workflow with no CI/CD annotations
    const ast = makeWorkflow();
    const result = validateWorkflow(ast);

    // Should not have any CI/CD-specific warnings/errors
    const cicdMessages = [
      ...result.errors,
      ...result.warnings,
    ].filter(
      e => e.code && (
        e.code.toLowerCase().includes('cicd') ||
        e.code.toLowerCase().includes('secret') ||
        e.code.toLowerCase().includes('artifact')
      )
    );
    expect(cicdMessages.length).toBe(0);
  });

  it('should apply CI/CD rules to workflows with cicd annotations', () => {
    // A CI/CD workflow with a secret referenced but not declared
    const ast = makeWorkflow({
      options: {
        cicd: {
          secrets: [], // no secrets declared
        },
      },
      instances: [
        { type: 'NodeInstance', id: 'node1', nodeType: 'testNode', job: 'build' },
      ],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'x' }, to: { node: 'node1', port: 'input' } },
        { type: 'Connection', from: { node: 'secret:UNDECLARED_SECRET', port: 'value' }, to: { node: 'node1', port: 'token' } },
        { type: 'Connection', from: { node: 'node1', port: 'output' }, to: { node: 'Exit', port: 'result' } },
      ],
    });

    const result = validateWorkflow(ast);

    // Should have CI/CD-related warnings/errors about undeclared secret
    const allMessages = [...result.errors, ...result.warnings];
    const secretMessages = allMessages.filter(
      e => e.message?.toLowerCase().includes('secret') || (e.code && e.code.toLowerCase().includes('secret'))
    );
    expect(secretMessages.length).toBeGreaterThan(0);
  });

  it('getCICDValidationRules() should return rules', () => {
    const rules = getCICDValidationRules();
    expect(rules.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: secret:NAME parsed from source through full pipeline
// ---------------------------------------------------------------------------

describe('secret:NAME end-to-end parsing', () => {
  const cicdSource = `
/**
 * @flowWeaver nodeType
 * @input execute - Run flag
 * @input token - Auth token
 * @output onSuccess - Done
 * @output onFailure - Failed
 */
declare function deploy(execute: boolean, token: string): { onSuccess: boolean; onFailure: boolean };

/**
 * @flowWeaver workflow
 * @secret DEPLOY_TOKEN - Deployment auth token
 * @node d deploy [job: "deploy"]
 * @connect Start.execute -> d.execute
 * @connect secret:DEPLOY_TOKEN -> d.token
 * @connect d.onSuccess -> Exit.onSuccess
 */
export function cicdPipeline(execute: boolean): { onSuccess: boolean } {
  throw new Error('stub');
}
`;

  it('should parse secret:NAME connections into the AST', () => {
    const result = parser.parseFromString(cicdSource);
    expect(result.errors).toEqual([]);
    const wf = result.workflows[0];
    const secretConn = wf.connections.find(c => c.from.node.startsWith('secret:'));
    expect(secretConn).toBeDefined();
    expect(secretConn!.from.node).toBe('secret:DEPLOY_TOKEN');
    expect(secretConn!.from.port).toBe('value');
    expect(secretConn!.to.node).toBe('d');
    expect(secretConn!.to.port).toBe('token');
  });

  it('should detect declared and referenced secrets correctly', () => {
    const result = parser.parseFromString(cicdSource);
    const wf = result.workflows[0];
    expect(getDeclaredSecrets(wf)).toEqual(['DEPLOY_TOKEN']);
    expect(getReferencedSecrets(wf)).toEqual(['DEPLOY_TOKEN']);
  });

  it('should catch undeclared secrets via CICD_SECRET_NOT_DECLARED', () => {
    const undeclaredSource = `
/**
 * @flowWeaver nodeType
 * @input execute - Run flag
 * @input token - Auth token
 * @output onSuccess - Done
 * @output onFailure - Failed
 */
declare function deploy(execute: boolean, token: string): { onSuccess: boolean; onFailure: boolean };

/**
 * @flowWeaver workflow
 * @node d deploy [job: "deploy"]
 * @connect Start.execute -> d.execute
 * @connect secret:MISSING_SECRET -> d.token
 * @connect d.onSuccess -> Exit.onSuccess
 */
export function cicdPipeline2(execute: boolean): { onSuccess: boolean } {
  throw new Error('stub');
}
`;
    const result = parser.parseFromString(undeclaredSource);
    expect(result.errors).toEqual([]);
    const wf = result.workflows[0];

    // The workflow must be detected as CI/CD (it has a job attribute)
    expect(isCICDWorkflow(wf)).toBe(true);

    const validation = validateWorkflow(wf);
    const secretErrors = validation.errors.filter(e => e.code === 'CICD_SECRET_NOT_DECLARED');
    expect(secretErrors.length).toBe(1);
    expect(secretErrors[0].message).toContain('MISSING_SECRET');
  });

  it('should catch unused secrets via CICD_SECRET_UNUSED', () => {
    const unusedSource = `
/**
 * @flowWeaver nodeType
 * @input execute - Run flag
 * @output onSuccess - Done
 * @output onFailure - Failed
 */
declare function build(execute: boolean): { onSuccess: boolean; onFailure: boolean };

/**
 * @flowWeaver workflow
 * @secret UNUSED_TOKEN - Never wired
 * @node b build [job: "build"]
 * @connect Start.execute -> b.execute
 * @connect b.onSuccess -> Exit.onSuccess
 */
export function cicdPipeline3(execute: boolean): { onSuccess: boolean } {
  throw new Error('stub');
}
`;
    const result = parser.parseFromString(unusedSource);
    expect(result.errors).toEqual([]);
    const wf = result.workflows[0];

    const validation = validateWorkflow(wf);
    const unusedWarnings = validation.warnings.filter(e => e.code === 'CICD_SECRET_UNUSED');
    expect(unusedWarnings.length).toBe(1);
    expect(unusedWarnings[0].message).toContain('UNUSED_TOKEN');
  });
});
