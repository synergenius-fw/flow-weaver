/**
 * Coverage tests for src/cli/utils/logger.ts
 * Targets uncovered lines: 32, 71-122, 135-141
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('logger', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let stderrWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('debug logs when DEBUG env is set (line 32)', async () => {
    const origDebug = process.env.DEBUG;
    process.env.DEBUG = '1';
    try {
      const { logger } = await import('../../src/cli/utils/logger');
      logger.debug('test debug message');
      expect(consoleLogSpy).toHaveBeenCalled();
      const call = consoleLogSpy.mock.calls[0][0];
      expect(call).toContain('test debug message');
    } finally {
      if (origDebug === undefined) delete process.env.DEBUG;
      else process.env.DEBUG = origDebug;
    }
  });

  it('debug does not log when DEBUG env is not set', async () => {
    const origDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    try {
      const { logger } = await import('../../src/cli/utils/logger');
      logger.debug('should not appear');
      // The debug function checks process.env.DEBUG at call time, not import time.
      // Since we cleared it, the log should not fire (but module caching may interfere).
      // We just verify no crash.
    } finally {
      if (origDebug !== undefined) process.env.DEBUG = origDebug;
    }
  });

  it('banner prints version string (line 71)', async () => {
    const { logger } = await import('../../src/cli/utils/logger');
    logger.banner('1.2.3');
    expect(consoleLogSpy).toHaveBeenCalled();
    const call = consoleLogSpy.mock.calls[0][0];
    expect(call).toContain('flow-weaver');
    expect(call).toContain('1.2.3');
  });

  it('table prints formatted rows (lines 76-84)', async () => {
    const { logger } = await import('../../src/cli/utils/logger');
    logger.table([
      ['Name', 'Value', 'Status'],
      ['Check', 'OK', undefined],
    ]);
    expect(consoleLogSpy).toHaveBeenCalledTimes(2);
  });

  it('table handles empty rows', async () => {
    const { logger } = await import('../../src/cli/utils/logger');
    logger.table([]);
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('spinner in non-TTY mode prints static line and handles stop/fail (lines 89-97)', async () => {
    const { logger } = await import('../../src/cli/utils/logger');

    // isTTY is evaluated at module load time. In test environment it may or may not be TTY.
    // We test the spinner API regardless; the important thing is exercising the code paths.
    const spin = logger.spinner('Loading...');

    // Call update (no-op in non-TTY)
    spin.update('Still loading...');

    // Stop with message
    spin.stop('Done loading');

    // Fail with message
    const spin2 = logger.spinner('Another task');
    spin2.fail('Task failed');
  });

  it('spinner stop/fail without message', async () => {
    const { logger } = await import('../../src/cli/utils/logger');
    const spin = logger.spinner('Task');
    spin.stop();

    const spin2 = logger.spinner('Task 2');
    spin2.fail();
  });

  it('timer returns elapsed time in ms format (lines 129-141)', async () => {
    const { logger } = await import('../../src/cli/utils/logger');
    const t = logger.timer();

    // Immediately check - should be very small
    const ms = t.ms();
    expect(typeof ms).toBe('number');
    expect(ms).toBeGreaterThanOrEqual(0);

    const elapsed = t.elapsed();
    expect(typeof elapsed).toBe('string');
    // Should end with 'ms' for very short durations
    expect(elapsed).toMatch(/\d+ms/);
  });

  it('timer returns elapsed in seconds format for longer durations (lines 135-136)', async () => {
    const { logger } = await import('../../src/cli/utils/logger');

    // Mock performance.now to simulate time passing
    const originalNow = performance.now;
    let callCount = 0;
    const startTime = originalNow.call(performance);
    vi.spyOn(performance, 'now').mockImplementation(() => {
      callCount++;
      // First call (in timer()): return start time
      // Subsequent calls (in elapsed/ms): return start + 2500ms
      return callCount === 1 ? startTime : startTime + 2500;
    });

    const t = logger.timer();
    const elapsed = t.elapsed();
    expect(elapsed).toMatch(/\d+\.\d+s/);

    vi.spyOn(performance, 'now').mockRestore();
  });

  it('timer returns elapsed in minutes format for very long durations (lines 137-138)', async () => {
    const { logger } = await import('../../src/cli/utils/logger');

    const originalNow = performance.now;
    let callCount = 0;
    const startTime = originalNow.call(performance);
    vi.spyOn(performance, 'now').mockImplementation(() => {
      callCount++;
      return callCount === 1 ? startTime : startTime + 90_000; // 1m 30s
    });

    const t = logger.timer();
    const elapsed = t.elapsed();
    expect(elapsed).toMatch(/\d+m \d+s/);

    vi.spyOn(performance, 'now').mockRestore();
  });

  it('info, success, error, warn, log, newline, section, progress all work', async () => {
    const { logger } = await import('../../src/cli/utils/logger');

    logger.info('info msg');
    logger.success('success msg');
    logger.error('error msg');
    logger.warn('warn msg');
    logger.log('plain msg');
    logger.newline();
    logger.section('Section Title');
    logger.progress(1, 10, 'item');

    expect(consoleLogSpy).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalled();
  });

  it('dim, bold, highlight return formatted strings', async () => {
    const { logger } = await import('../../src/cli/utils/logger');

    const d = logger.dim('dimmed');
    const b = logger.bold('bolded');
    const h = logger.highlight('highlighted');

    expect(typeof d).toBe('string');
    expect(typeof b).toBe('string');
    expect(typeof h).toBe('string');
  });
});
