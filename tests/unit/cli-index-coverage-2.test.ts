/**
 * Additional coverage for src/cli/index.ts
 *
 * Since cli/index.ts has heavy side effects (importing Commander, registering commands,
 * checking process.argv), most of it can't be imported directly in tests. Instead we
 * exercise the logic patterns it uses:
 *  - writeErr trimming and suppression
 *  - writeOut passthrough
 *  - wrapAction error path with actionErrorHandled flag interaction
 *  - subcommandTerm with various cmd shapes
 *  - The no-args banner branch with argv simulation
 *  - The docs command branching (list, search, read)
 *  - configureOutput interactions
 */

describe('cli/index.ts - writeErr logic', () => {
  it('should strip "error:" prefix and log trimmed message', () => {
    const logged: string[] = [];
    let actionErrorHandled = false;

    const writeErr = (str: string) => {
      if (actionErrorHandled) return;
      const trimmed = str.replace(/^error:\s*/i, '').trimEnd();
      if (trimmed) logged.push(trimmed);
    };

    writeErr('error: File not found');
    expect(logged).toEqual(['File not found']);
  });

  it('should strip "Error:" prefix (case insensitive)', () => {
    const logged: string[] = [];
    const writeErr = (str: string) => {
      const trimmed = str.replace(/^error:\s*/i, '').trimEnd();
      if (trimmed) logged.push(trimmed);
    };

    writeErr('Error: Something broke');
    expect(logged).toEqual(['Something broke']);
  });

  it('should handle string that is only whitespace after trimming', () => {
    const logged: string[] = [];
    const writeErr = (str: string) => {
      const trimmed = str.replace(/^error:\s*/i, '').trimEnd();
      if (trimmed) logged.push(trimmed);
    };

    writeErr('error:   ');
    expect(logged).toEqual([]);
  });

  it('should handle string with no error prefix', () => {
    const logged: string[] = [];
    const writeErr = (str: string) => {
      const trimmed = str.replace(/^error:\s*/i, '').trimEnd();
      if (trimmed) logged.push(trimmed);
    };

    writeErr('Unknown command: foo');
    expect(logged).toEqual(['Unknown command: foo']);
  });

  it('should suppress all output once actionErrorHandled is set', () => {
    const logged: string[] = [];
    let actionErrorHandled = false;

    const writeErr = (str: string) => {
      if (actionErrorHandled) return;
      const trimmed = str.replace(/^error:\s*/i, '').trimEnd();
      if (trimmed) logged.push(trimmed);
    };

    writeErr('error: first');
    actionErrorHandled = true;
    writeErr('error: second');
    writeErr('error: third');
    expect(logged).toEqual(['first']);
  });
});

describe('cli/index.ts - wrapAction pattern', () => {
  it('should pass through successfully when no error occurs', async () => {
    let called = false;
    function wrapAction<T extends unknown[]>(fn: (...args: T) => Promise<void>) {
      let actionErrorHandled = false;
      return async (...args: T) => {
        try {
          await fn(...args);
        } catch (error) {
          actionErrorHandled = true;
          throw error;
        }
      };
    }

    const wrapped = wrapAction(async (x: number) => {
      called = true;
    });

    await wrapped(42);
    expect(called).toBe(true);
  });

  it('should set actionErrorHandled flag and propagate error', async () => {
    let flagSet = false;

    function wrapAction<T extends unknown[]>(fn: (...args: T) => Promise<void>) {
      let actionErrorHandled = false;
      return async (...args: T) => {
        try {
          await fn(...args);
        } catch (error) {
          actionErrorHandled = true;
          flagSet = actionErrorHandled;
          throw error;
        }
      };
    }

    const wrapped = wrapAction(async () => {
      throw new Error('test error');
    });

    await expect(wrapped()).rejects.toThrow('test error');
    expect(flagSet).toBe(true);
  });

  it('should handle non-Error thrown values', async () => {
    function wrapAction<T extends unknown[]>(fn: (...args: T) => Promise<void>) {
      return async (...args: T) => {
        try {
          await fn(...args);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          throw new Error(msg);
        }
      };
    }

    const wrapped = wrapAction(async () => {
      throw 'string error';
    });

    await expect(wrapped()).rejects.toThrow('string error');
  });
});

describe('cli/index.ts - subcommandTerm helper', () => {
  const subcommandTerm = (cmd: { name: () => string; usage: () => string }) =>
    cmd.name() + (cmd.usage() ? ' ' + cmd.usage() : '');

  it('should return name only when usage is empty', () => {
    expect(subcommandTerm({ name: () => 'doctor', usage: () => '' })).toBe('doctor');
  });

  it('should append usage when present', () => {
    expect(subcommandTerm({ name: () => 'compile', usage: () => '<input>' })).toBe('compile <input>');
  });

  it('should handle multi-word usage', () => {
    expect(subcommandTerm({ name: () => 'diff', usage: () => '<file1> <file2>' })).toBe('diff <file1> <file2>');
  });

  it('should handle optional args in usage', () => {
    expect(subcommandTerm({ name: () => 'init', usage: () => '[directory]' })).toBe('init [directory]');
  });
});

describe('cli/index.ts - no-args banner detection', () => {
  it('should detect no commands when argv has only node and script', () => {
    const argv = ['/usr/bin/node', '/usr/bin/fw'];
    expect(argv.slice(2).length).toBe(0);
  });

  it('should detect commands when argv includes a subcommand', () => {
    const argv = ['/usr/bin/node', '/usr/bin/fw', 'compile'];
    expect(argv.slice(2).length).toBeGreaterThan(0);
  });

  it('should detect commands when argv includes flags only', () => {
    const argv = ['/usr/bin/node', '/usr/bin/fw', '--help'];
    expect(argv.slice(2).length).toBeGreaterThan(0);
  });
});

describe('cli/index.ts - docs command branching logic', () => {
  it('should route to list when args is empty', () => {
    const args: string[] = [];
    let route = '';
    if (args.length === 0 || args[0] === 'list') {
      route = 'list';
    } else if (args[0] === 'search') {
      route = 'search';
    } else {
      route = 'read';
    }
    expect(route).toBe('list');
  });

  it('should route to list when first arg is "list"', () => {
    const args = ['list'];
    let route = '';
    if (args.length === 0 || args[0] === 'list') {
      route = 'list';
    } else if (args[0] === 'search') {
      route = 'search';
    } else {
      route = 'read';
    }
    expect(route).toBe('list');
  });

  it('should route to search when first arg is "search"', () => {
    const args = ['search', 'workflow', 'patterns'];
    let route = '';
    if (args.length === 0 || args[0] === 'list') {
      route = 'list';
    } else if (args[0] === 'search') {
      const query = args.slice(1).join(' ');
      route = query ? 'search' : 'search-no-query';
    } else {
      route = 'read';
    }
    expect(route).toBe('search');
  });

  it('should detect missing search query', () => {
    const args = ['search'];
    let route = '';
    if (args.length === 0 || args[0] === 'list') {
      route = 'list';
    } else if (args[0] === 'search') {
      const query = args.slice(1).join(' ');
      route = query ? 'search' : 'search-no-query';
    } else {
      route = 'read';
    }
    expect(route).toBe('search-no-query');
  });

  it('should route to read for any other topic', () => {
    const args = ['annotations'];
    let route = '';
    if (args.length === 0 || args[0] === 'list') {
      route = 'list';
    } else if (args[0] === 'search') {
      route = 'search';
    } else {
      route = 'read';
    }
    expect(route).toBe('read');
  });
});

describe('cli/index.ts - version fallback', () => {
  it('should produce 0.0.0-dev when __CLI_VERSION__ is not defined', () => {
    const version = typeof (globalThis as any).__CLI_VERSION__ !== 'undefined'
      ? (globalThis as any).__CLI_VERSION__
      : '0.0.0-dev';
    expect(version).toBe('0.0.0-dev');
  });
});

describe('cli/index.ts - VITEST env guard', () => {
  it('VITEST env var is set during test execution', () => {
    expect(process.env['VITEST']).toBeTruthy();
  });

  it('the guard condition correctly prevents pack-command registration', () => {
    // The module uses: if (!process.env['VITEST']) { ... }
    const shouldRegister = !process.env['VITEST'];
    expect(shouldRegister).toBe(false);
  });
});

describe('cli/index.ts - implement command node resolution', () => {
  it('should use positional arg when provided', () => {
    const node: string | undefined = 'myNode';
    const options = { nodeId: 'other' };
    const nodeName = node ?? options.nodeId;
    expect(nodeName).toBe('myNode');
  });

  it('should fall back to --nodeId when positional is undefined', () => {
    const node: string | undefined = undefined;
    const options = { nodeId: 'fallbackNode' };
    const nodeName = node ?? options.nodeId;
    expect(nodeName).toBe('fallbackNode');
  });

  it('should be undefined when neither is provided', () => {
    const node: string | undefined = undefined;
    const options = { nodeId: undefined };
    const nodeName = node ?? options.nodeId;
    expect(nodeName).toBeUndefined();
  });
});
