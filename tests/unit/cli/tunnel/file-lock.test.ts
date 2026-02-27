import { describe, it, expect } from 'vitest';
import { withFileLock } from '../../../../src/cli/tunnel/file-lock.js';

describe('withFileLock', () => {
  it('runs a single operation and returns its result', async () => {
    const result = await withFileLock('/tmp/test-a.ts', async () => 42);
    expect(result).toBe(42);
  });

  it('serializes concurrent operations on the same file', async () => {
    const order: number[] = [];

    const op1 = withFileLock('/tmp/test-serial.ts', async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push(1);
      return 'first';
    });

    const op2 = withFileLock('/tmp/test-serial.ts', async () => {
      order.push(2);
      return 'second';
    });

    const [r1, r2] = await Promise.all([op1, op2]);
    expect(r1).toBe('first');
    expect(r2).toBe('second');
    expect(order).toEqual([1, 2]); // op2 waited for op1
  });

  it('runs operations on different files in parallel', async () => {
    const order: string[] = [];

    const op1 = withFileLock('/tmp/test-file-a.ts', async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push('a');
    });

    const op2 = withFileLock('/tmp/test-file-b.ts', async () => {
      order.push('b');
    });

    await Promise.all([op1, op2]);
    // b should complete before a since they're independent and b has no delay
    expect(order).toEqual(['b', 'a']);
  });

  it('propagates errors from the operation', async () => {
    await expect(
      withFileLock('/tmp/test-error.ts', async () => {
        throw new Error('operation failed');
      }),
    ).rejects.toThrow('operation failed');
  });

  it('does not deadlock after an error', async () => {
    // First operation fails
    await withFileLock('/tmp/test-deadlock.ts', async () => {
      throw new Error('fail');
    }).catch(() => {});

    // Second operation on same file should still work
    const result = await withFileLock('/tmp/test-deadlock.ts', async () => 'ok');
    expect(result).toBe('ok');
  });
});
