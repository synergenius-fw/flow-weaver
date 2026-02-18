/**
 * Tests for compile command
 * Uses direct function calls for speed, with CLI smoke tests for wiring
 */

import { parser } from '../../src/parser';
import { generateCode } from '../../src/api/generate';
import { generateInPlace } from '../../src/api/generate-in-place';

describe('code generation (pure functions)', () => {
  describe('generateCode', () => {
    it('should generate valid code for simple workflow', () => {
      const content = `
/**
 * @flowWeaver nodeType
 */
function proc(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}

/**
 * @flowWeaver workflow
 * @node p proc
 * @connect p.onSuccess -> Exit.onSuccess
 */
export function simpleWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
      const result = parser.parseFromString(content, 'simple.ts');
      expect(result.errors).toHaveLength(0);

      const generated = generateCode(result.workflows[0], { production: false });
      expect(generated).toContain('GeneratedExecutionContext');
      expect(generated).toContain('simpleWorkflow');
    });

    it('should generate production code without debug types', () => {
      const content = `
/**
 * @flowWeaver nodeType
 */
function proc(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}

/**
 * @flowWeaver workflow
 * @node p proc
 * @connect p.onSuccess -> Exit.onSuccess
 */
export function prodWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
      const result = parser.parseFromString(content, 'prod.ts');
      const generated = generateCode(result.workflows[0], { production: true });

      expect(generated).not.toContain('TDebugger');
    });

    it('should handle multiple nodes', () => {
      const content = `
/**
 * @flowWeaver nodeType
 */
function nodeA(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}

/**
 * @flowWeaver nodeType
 */
function nodeB(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}

/**
 * @flowWeaver workflow
 * @node a nodeA
 * @node b nodeB
 * @connect a.onSuccess -> b.execute
 * @connect b.onSuccess -> Exit.onSuccess
 */
export function multiNodeWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
      const result = parser.parseFromString(content, 'multi.ts');
      const generated = generateCode(result.workflows[0], { production: false });

      expect(generated).toContain('nodeA');
      expect(generated).toContain('nodeB');
    });
  });

  describe('compileCommand dry-run', () => {
    it('--dry-run prevents file modification', async () => {
      const { compileCommand } = await import('../../src/cli/commands/compile');
      const fs = await import('fs');
      const os = await import('os');
      const path = await import('path');

      // Create temp file with workflow content
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-dryrun-'));
      const tmpFile = path.join(tmpDir, 'dry-run-test.ts');
      const content = `
/**
 * @flowWeaver nodeType
 */
function proc(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}

/**
 * @flowWeaver workflow
 * @node p proc
 * @connect p.onSuccess -> Exit.onSuccess
 */
export function dryRunWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
      fs.writeFileSync(tmpFile, content);
      const originalContent = fs.readFileSync(tmpFile, 'utf8');

      try {
        await compileCommand(tmpFile, { dryRun: true });
        const afterContent = fs.readFileSync(tmpFile, 'utf8');
        // File should be unchanged
        expect(afterContent).toBe(originalContent);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('compileWorkflow validation gate (#42)', () => {
    it('should reject compilation when workflow has validation errors (#42)', async () => {
      const fs = await import('fs');
      const os = await import('os');
      const path = await import('path');
      const { compileWorkflow } = await import('../../src/api/compile');

      // Create a workflow that references a non-existent node type
      const content = `
/**
 * @flowWeaver nodeType
 */
function realNode(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}

/**
 * @flowWeaver workflow
 * @node r realNode
 * @node g ghostNode
 * @connect r.onSuccess -> g.execute
 * @connect g.onSuccess -> Exit.onSuccess
 */
export function invalidWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-validate-'));
      const tmpFile = path.join(tmpDir, 'invalid-workflow.ts');
      fs.writeFileSync(tmpFile, content);

      try {
        await expect(compileWorkflow(tmpFile, { write: false })).rejects.toThrow(
          /[Vv]alidation error/
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should allow compilation when workflow is valid (#42)', async () => {
      const fs = await import('fs');
      const os = await import('os');
      const path = await import('path');
      const { compileWorkflow } = await import('../../src/api/compile');

      const content = `
/**
 * @flowWeaver nodeType
 */
function goodNode(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}

/**
 * @flowWeaver workflow
 * @node g goodNode
 * @connect g.onSuccess -> Exit.onSuccess
 */
export function validWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-validate-'));
      const tmpFile = path.join(tmpDir, 'valid-workflow.ts');
      fs.writeFileSync(tmpFile, content);

      try {
        // Should not throw — valid workflow passes validation gate
        const result = await compileWorkflow(tmpFile, { write: false });
        expect(result.code).toBeDefined();
        expect(result.code).toContain('GeneratedExecutionContext');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('compileCommand --verbose', () => {
    it('should show "Skipped" via logger.info when verbose is true on non-workflow file', async () => {
      const { compileCommand } = await import('../../src/cli/commands/compile');
      const fs = await import('fs');
      const os = await import('os');
      const path = await import('path');

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-verbose-'));
      const tmpFile = path.join(tmpDir, 'no-workflow.ts');
      fs.writeFileSync(tmpFile, 'export const foo = 42;\n');

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => {
        output.push(args.map(String).join(' '));
      };

      try {
        await compileCommand(tmpFile, { verbose: true });
        const joined = output.join('\n');
        expect(joined).toContain('Skipped');
      } finally {
        console.log = origLog;
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should skip files without @flowWeaver before parsing (no import error)', async () => {
      const { compileCommand } = await import('../../src/cli/commands/compile');
      const fs = await import('fs');
      const os = await import('os');
      const path = await import('path');

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-skip-'));
      const tmpFile = path.join(tmpDir, 'main.ts');
      // File imports a nonexistent module — would cause parse error if not skipped
      fs.writeFileSync(
        tmpFile,
        'import { foo } from "./nonexistent-module.js";\nexport const bar = foo;\n'
      );

      const errorOutput: string[] = [];
      const origError = console.error;
      const origLog = console.log;
      console.error = (...args: unknown[]) => {
        errorOutput.push(args.map(String).join(' '));
      };
      console.log = () => {}; // suppress normal output

      try {
        await compileCommand(tmpFile, { verbose: true });
        const joined = errorOutput.join('\n');
        // Should NOT contain import error or any error
        expect(joined).not.toContain('Import error');
        expect(joined).not.toContain('Failed to compile');
      } finally {
        console.error = origError;
        console.log = origLog;
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('--clean flag (skipParamReturns)', () => {
    const workflowWithPorts = `
/**
 * @flowWeaver nodeType @expression
 */
function greet(name: string): { greeting: string } {
  return { greeting: \`Hello, \${name}!\` };
}

/**
 * @flowWeaver workflow
 * @node g greet
 * @connect Start.name -> g.name
 * @connect g.greeting -> Exit.message
 */
export function cleanTestWorkflow(
  execute: boolean,
  params: { name: string }
): { onSuccess: boolean; onFailure: boolean; message: string } {
  throw new Error("Compile with: flow-weaver compile <file>");
}
`;

    it('compile --clean should omit @param/@returns from output', () => {
      const result = parser.parseFromString(workflowWithPorts, 'clean-test.ts');
      expect(result.errors).toHaveLength(0);

      const generated = generateInPlace(workflowWithPorts, result.workflows[0], {
        skipParamReturns: true,
      });

      expect(generated.hasChanges).toBe(true);
      // Should have the workflow annotation
      expect(generated.code).toContain('@flowWeaver workflow');
      // Should NOT have @param or @returns lines
      expect(generated.code).not.toMatch(/^\s*\*\s*@param\b/m);
      expect(generated.code).not.toMatch(/^\s*\*\s*@returns\b/m);
    });

    it('compile without --clean should emit @param/@returns as before', () => {
      const result = parser.parseFromString(workflowWithPorts, 'noclean-test.ts');
      expect(result.errors).toHaveLength(0);

      const generated = generateInPlace(workflowWithPorts, result.workflows[0], {});

      expect(generated.hasChanges).toBe(true);
      expect(generated.code).toContain('@flowWeaver workflow');
      // Should have @param and @returns lines
      expect(generated.code).toMatch(/^\s*\*\s*@param\b/m);
      expect(generated.code).toMatch(/^\s*\*\s*@returns\b/m);
    });

    it('--clean should preserve all other annotations (@node, @connect, @position)', () => {
      const result = parser.parseFromString(workflowWithPorts, 'clean-preserve.ts');
      expect(result.errors).toHaveLength(0);

      const generated = generateInPlace(workflowWithPorts, result.workflows[0], {
        skipParamReturns: true,
      });

      expect(generated.code).toContain('@node');
      expect(generated.code).toContain('@connect');
    });

    it('compileCommand should pass clean option to generateInPlace', async () => {
      const { compileCommand } = await import('../../src/cli/commands/compile');
      const fs = await import('fs');
      const os = await import('os');
      const path = await import('path');

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-clean-'));
      const tmpFile = path.join(tmpDir, 'clean-cmd-test.ts');
      fs.writeFileSync(tmpFile, workflowWithPorts);

      const origLog = console.log;
      console.log = () => {};

      try {
        await compileCommand(tmpFile, { clean: true });
        const compiled = fs.readFileSync(tmpFile, 'utf8');
        expect(compiled).toContain('@flowWeaver workflow');
        expect(compiled).not.toMatch(/^\s*\*\s*@param\b/m);
        expect(compiled).not.toMatch(/^\s*\*\s*@returns\b/m);
      } finally {
        console.log = origLog;
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('generateInPlace', () => {
    it('should stabilize after multiple compilations', () => {
      // Note: First compile adds __abortSignal__ param, which changes the AST
      // on second parse. After 2-3 compiles, it should stabilize.
      const content = `
/**
 * @flowWeaver nodeType
 */
function proc(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}

/**
 * @flowWeaver workflow
 * @node p proc
 * @connect p.onSuccess -> Exit.onSuccess
 */
export function stableWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
      const result = parser.parseFromString(content, 'stable.ts');

      // First compilation
      const first = generateInPlace(content, result.workflows[0], { production: false });
      expect(first.hasChanges).toBe(true);

      // Second compilation
      const result2 = parser.parseFromString(first.code, 'stable2.ts');
      const second = generateInPlace(first.code, result2.workflows[0], { production: false });

      // Third compilation - should stabilize
      const result3 = parser.parseFromString(second.code, 'stable3.ts');
      const third = generateInPlace(second.code, result3.workflows[0], { production: false });

      // After stabilization, code should be identical
      expect(second.code).toBe(third.code);
      expect(third.hasChanges).toBe(false);
    });

    it('should generate code in place within source', () => {
      const content = `
/**
 * @flowWeaver nodeType
 */
function proc(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}

/**
 * @flowWeaver workflow
 * @node p proc
 * @connect p.onSuccess -> Exit.onSuccess
 */
export function inPlaceWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
      const result = parser.parseFromString(content, 'inplace.ts');
      const generated = generateInPlace(content, result.workflows[0], { production: false });

      expect(generated.hasChanges).toBe(true);
      expect(generated.code).toContain('GeneratedExecutionContext');
      expect(generated.code).toContain('@flow-weaver-runtime-start');
    });
  });
});
