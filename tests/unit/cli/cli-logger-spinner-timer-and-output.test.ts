/**
 * Tests for src/cli/utils/logger.ts:
 *  - debug() when DEBUG env is unset
 *  - spinner TTY branch: interval-based animation, update(), stop()/fail() with clear
 *  - spinner non-TTY: stop/fail with and without message
 *  - timer: elapsed() returning seconds (1s-60s) and minutes (>60s)
 *  - table: rows with undefined status column
 *  - progress: formatted output
 */

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

  describe('debug()', () => {
    it('should log when DEBUG env var is set', async () => {
      const origDebug = process.env.DEBUG;
      process.env.DEBUG = 'true';
      try {
        const { logger } = await import('../../../src/cli/utils/logger');
        logger.debug('debug message here');
        expect(consoleLogSpy).toHaveBeenCalled();
        const output = consoleLogSpy.mock.calls[0][0] as string;
        expect(output).toContain('debug message here');
      } finally {
        if (origDebug === undefined) delete process.env.DEBUG;
        else process.env.DEBUG = origDebug;
      }
    });

    it('should not log when DEBUG env var is unset', async () => {
      const origDebug = process.env.DEBUG;
      delete process.env.DEBUG;
      try {
        const { logger } = await import('../../../src/cli/utils/logger');
        consoleLogSpy.mockClear();
        // debug checks process.env.DEBUG at call time
        logger.debug('should be silent');
        expect(consoleLogSpy).not.toHaveBeenCalled();
      } finally {
        if (origDebug !== undefined) process.env.DEBUG = origDebug;
      }
    });
  });

  /** What the spinner wrote to stderr, colours stripped. */
  // eslint-disable-next-line no-control-regex
  const stderrText = () => stderrWriteSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('').replace(/\x1b\[[0-9;]*m/g, '');

  describe('spinner() without a TTY', () => {
    // The test runner's stdout is not a TTY, so the logger module as loaded
    // prints static lines.
    it('should handle non-TTY spinner: stop with message', async () => {
      const { logger } = await import('../../../src/cli/utils/logger');
      const spin = logger.spinner('Working...');
      spin.stop('Done');
      expect(stderrText()).toBe('  Working...\n  ✓ Done\n');
    });

    it('should handle non-TTY spinner: stop without message', async () => {
      const { logger } = await import('../../../src/cli/utils/logger');
      const spin = logger.spinner('Working...');
      spin.stop();
      expect(stderrText()).toBe('  Working...\n');
    });

    it('should handle non-TTY spinner: fail with message', async () => {
      const { logger } = await import('../../../src/cli/utils/logger');
      const spin = logger.spinner('Working...');
      spin.fail('Oops');
      expect(stderrText()).toBe('  Working...\n  ✗ Oops\n');
    });

    it('should handle non-TTY spinner: fail without message', async () => {
      const { logger } = await import('../../../src/cli/utils/logger');
      const spin = logger.spinner('Working...');
      spin.fail();
      expect(stderrText()).toBe('  Working...\n');
    });

    it('should handle non-TTY spinner: update is a no-op', async () => {
      const { logger } = await import('../../../src/cli/utils/logger');
      const spin = logger.spinner('Initial');
      spin.update('Updated');
      spin.stop();
      expect(stderrText()).toBe('  Initial\n');
    });
  });

  describe('spinner() on a TTY', () => {
    // isTTY is read when the module loads, so each test loads a fresh copy
    // with stdout claiming to be a terminal.
    let origIsTTY: boolean | undefined;

    beforeEach(() => {
      origIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true, writable: true });
      vi.useFakeTimers();
      vi.resetModules();
    });

    afterEach(() => {
      vi.useRealTimers();
      Object.defineProperty(process.stdout, 'isTTY', { value: origIsTTY, configurable: true, writable: true });
      vi.resetModules();
    });

    it('should handle TTY spinner when isTTY is true', async () => {
      const { logger } = await import('../../../src/cli/utils/logger');

      const spin = logger.spinner('Animating...');
      // Nothing until the first frame.
      expect(stderrText()).toBe('');
      vi.advanceTimersByTime(80);
      expect(stderrText()).toBe('\r\x1b[K  ⠋ Animating...');

      spin.update('Still going');
      vi.advanceTimersByTime(80);
      expect(stderrText().endsWith('\r\x1b[K  ⠙ Still going')).toBe(true);

      spin.stop('Finished');
      expect(stderrText().endsWith('\r\x1b[K  ✓ Finished\n')).toBe(true);

      // Stopped: no more frames.
      const written = stderrWriteSpy.mock.calls.length;
      vi.advanceTimersByTime(500);
      expect(stderrWriteSpy.mock.calls.length).toBe(written);
    });

    it('should handle TTY spinner fail path', async () => {
      const { logger } = await import('../../../src/cli/utils/logger');

      const spin = logger.spinner('Processing');
      vi.advanceTimersByTime(160);
      spin.fail('Error occurred');

      expect(stderrText().endsWith('\r\x1b[K  ✗ Error occurred\n')).toBe(true);
      const written = stderrWriteSpy.mock.calls.length;
      vi.advanceTimersByTime(500);
      expect(stderrWriteSpy.mock.calls.length).toBe(written);
    });
  });

  describe('timer()', () => {
    it('should return elapsed in ms format for < 1 second', async () => {
      const { logger } = await import('../../../src/cli/utils/logger');
      const t = logger.timer();
      const elapsed = t.elapsed();
      expect(elapsed).toMatch(/\d+ms/);
    });

    it('should return elapsed in seconds format for 1s-60s', async () => {
      const { logger } = await import('../../../src/cli/utils/logger');

      let callCount = 0;
      const base = performance.now();
      vi.spyOn(performance, 'now').mockImplementation(() => {
        callCount++;
        return callCount === 1 ? base : base + 5000; // 5 seconds
      });

      const t = logger.timer();
      const elapsed = t.elapsed();
      expect(elapsed).toMatch(/^\d+\.\d+s$/);
    });

    it('should return elapsed in minutes format for >= 60s', async () => {
      const { logger } = await import('../../../src/cli/utils/logger');

      let callCount = 0;
      const base = performance.now();
      vi.spyOn(performance, 'now').mockImplementation(() => {
        callCount++;
        return callCount === 1 ? base : base + 125_000; // 2m 5s
      });

      const t = logger.timer();
      const elapsed = t.elapsed();
      expect(elapsed).toMatch(/^\d+m \d+s$/);
    });

    it('should return ms() as a number', async () => {
      const { logger } = await import('../../../src/cli/utils/logger');
      const t = logger.timer();
      const ms = t.ms();
      expect(typeof ms).toBe('number');
      expect(ms).toBeGreaterThanOrEqual(0);
    });

    it('should return exactly 1m 0s for 60000ms', async () => {
      const { logger } = await import('../../../src/cli/utils/logger');

      let now = 1000;
      vi.spyOn(performance, 'now').mockImplementation(() => now);

      const t = logger.timer();
      now = 1000 + 60_000;
      const elapsed = t.elapsed();
      expect(elapsed).toBe('1m 0s');
    });
  });

  describe('table()', () => {
    it('should print nothing for empty rows', async () => {
      const { logger } = await import('../../../src/cli/utils/logger');
      logger.table([]);
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should print formatted rows with all three columns', async () => {
      const { logger } = await import('../../../src/cli/utils/logger');
      logger.table([
        ['Name', 'Value', 'OK'],
        ['Type', 'Number', 'WARN'],
      ]);
      expect(consoleLogSpy).toHaveBeenCalledTimes(2);
    });

    it('should handle rows with undefined third column', async () => {
      const { logger } = await import('../../../src/cli/utils/logger');
      logger.table([
        ['Key', 'Val', undefined],
        ['Key2', 'Val2'],
      ]);
      expect(consoleLogSpy).toHaveBeenCalledTimes(2);
    });

    it('should handle single row', async () => {
      const { logger } = await import('../../../src/cli/utils/logger');
      logger.table([['Only', 'Row']]);
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('formatting helpers', () => {
    it('dim() returns a string', async () => {
      const { logger } = await import('../../../src/cli/utils/logger');
      expect(typeof logger.dim('test')).toBe('string');
    });

    it('bold() returns a string', async () => {
      const { logger } = await import('../../../src/cli/utils/logger');
      expect(typeof logger.bold('test')).toBe('string');
    });

    it('highlight() returns a string', async () => {
      const { logger } = await import('../../../src/cli/utils/logger');
      expect(typeof logger.highlight('test')).toBe('string');
    });
  });

  describe('output methods', () => {
    it('info() outputs to console.log', async () => {
      const { logger } = await import('../../../src/cli/utils/logger');
      logger.info('test info');
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('success() outputs to console.log', async () => {
      const { logger } = await import('../../../src/cli/utils/logger');
      logger.success('test success');
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('error() outputs to console.error', async () => {
      const { logger } = await import('../../../src/cli/utils/logger');
      logger.error('test error');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('warn() outputs to console.warn', async () => {
      const { logger } = await import('../../../src/cli/utils/logger');
      logger.warn('test warn');
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('log() outputs to console.log', async () => {
      const { logger } = await import('../../../src/cli/utils/logger');
      logger.log('test log');
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('newline() outputs empty line', async () => {
      const { logger } = await import('../../../src/cli/utils/logger');
      logger.newline();
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('section() outputs title with spacing', async () => {
      const { logger } = await import('../../../src/cli/utils/logger');
      logger.section('Test Section');
      // section() calls console.log 3 times: blank, title, blank
      expect(consoleLogSpy).toHaveBeenCalledTimes(3);
    });

    it('progress() outputs formatted progress', async () => {
      const { logger } = await import('../../../src/cli/utils/logger');
      logger.progress(3, 10, 'processing');
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0] as string;
      expect(output).toContain('processing');
    });

    it('banner() outputs version', async () => {
      const { logger } = await import('../../../src/cli/utils/logger');
      logger.banner('2.0.0');
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0] as string;
      expect(output).toContain('2.0.0');
      expect(output).toContain('flow-weaver');
    });
  });
});
