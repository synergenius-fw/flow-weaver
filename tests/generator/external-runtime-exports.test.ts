/**
 * Tests that the external runtime module exports all types
 * referenced by generated workflow code.
 *
 * Bug: TDebugController was declared in inline runtime but missing
 * from the external runtime exports. Generated code using external
 * runtime mode referenced TDebugController without importing it.
 */

import { describe, it, expect } from 'vitest';

describe('external runtime exports', () => {
  it('exports GeneratedExecutionContext', async () => {
    const runtime = await import('../../src/runtime/index');
    expect(runtime.GeneratedExecutionContext).toBeDefined();
  });

  it('exports CancellationError', async () => {
    const runtime = await import('../../src/runtime/index');
    expect(runtime.CancellationError).toBeDefined();
  });

  it('exports TDebugController type (used by generated code)', async () => {
    // TDebugController is a type, so we can't check it at runtime.
    // Instead, verify the module re-exports it by checking the source.
    const fs = await import('fs');
    const path = await import('path');
    const runtimeIndex = fs.readFileSync(
      path.resolve(__dirname, '../../src/runtime/index.ts'), 'utf-8'
    );
    expect(runtimeIndex).toContain('TDebugController');
  });
});

describe('inline runtime generation', () => {
  it('inline runtime includes TDebugController type', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/api/inline-runtime.ts'), 'utf-8'
    );
    // The inline runtime should emit TDebugController
    expect(source).toContain('TDebugController');
  });

  it('generate-in-place has no externalRuntimePath parameter', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/api/generate-in-place.ts'), 'utf-8'
    );
    // External runtime path support was removed — always inlines
    expect(source).not.toContain('externalRuntimePath');
  });
});
