/**
 * Coverage tests for src/api/inline-runtime.ts
 * Targets uncovered lines 642-684: generateStandaloneRuntimeModule
 */

import { generateStandaloneRuntimeModule } from '../../src/api/inline-runtime';

describe('generateStandaloneRuntimeModule', () => {
  it('should generate ESM runtime in development mode (includes debug client)', () => {
    const output = generateStandaloneRuntimeModule(false, 'esm');
    expect(output).toContain('Shared Runtime Module');
    expect(output).toContain('GeneratedExecutionContext');
    // Dev mode should include the debug client with export keyword
    expect(output).toContain('export function createFlowWeaverDebugClient');
    // ESM mode should NOT have module.exports
    expect(output).not.toContain('module.exports');
  });

  it('should generate ESM runtime in production mode (no debug client)', () => {
    const output = generateStandaloneRuntimeModule(true, 'esm');
    expect(output).toContain('Shared Runtime Module');
    expect(output).toContain('GeneratedExecutionContext');
    // Prod mode should NOT include the debug client
    expect(output).not.toContain('createFlowWeaverDebugClient');
    expect(output).not.toContain('module.exports');
  });

  it('should generate CJS runtime in development mode with module.exports', () => {
    const output = generateStandaloneRuntimeModule(false, 'cjs');
    expect(output).toContain('Shared Runtime Module');
    expect(output).toContain('module.exports');
    expect(output).toContain('GeneratedExecutionContext');
    expect(output).toContain('CancellationError');
    // Dev CJS should export debug client too
    expect(output).toContain('createFlowWeaverDebugClient');
    expect(output).toContain('TDebugger');
  });

  it('should generate CJS runtime in production mode (no debug exports)', () => {
    const output = generateStandaloneRuntimeModule(true, 'cjs');
    expect(output).toContain('module.exports');
    expect(output).toContain('GeneratedExecutionContext');
    expect(output).toContain('CancellationError');
    // Prod CJS should not export debug client
    expect(output).not.toMatch(/module\.exports.*createFlowWeaverDebugClient/);
  });

  it('should default to ESM when no moduleFormat is specified', () => {
    const output = generateStandaloneRuntimeModule(false);
    expect(output).not.toContain('module.exports');
    expect(output).toContain('export function createFlowWeaverDebugClient');
  });
});
