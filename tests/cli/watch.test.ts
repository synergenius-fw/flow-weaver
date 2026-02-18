/**
 * Tests for CLI watch command
 * Note: Watch command runs indefinitely, so these tests use timeouts and child processes
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';

const TEMP_DIR = path.join(os.tmpdir(), `flow-weaver-watch-${process.pid}`);
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CLI_ENTRY = path.join(PROJECT_ROOT, 'src/cli/index.ts');

// Setup and cleanup
beforeAll(() => {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
});

afterEach(() => {
  if (fs.existsSync(TEMP_DIR)) {
    const files = fs.readdirSync(TEMP_DIR);
    for (const file of files) {
      const filePath = path.join(TEMP_DIR, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        fs.rmSync(filePath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(filePath);
      }
    }
  }
});

afterAll(() => {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
});

describe('WatchOptions type', () => {
  it('WatchOptions accepts onRecompile callback', async () => {
    // Import the type and verify the interface accepts onRecompile
    const mod = await import('../../src/cli/commands/watch');

    // WatchOptions should be an interface extending CompileOptions with onRecompile
    // We test this by verifying the module exports are correct and the type compiles
    expect(mod.watchCommand).toBeInstanceOf(Function);

    // Create a valid WatchOptions-shaped object
    const options: import('../../src/cli/commands/watch').WatchOptions = {
      onRecompile: (_filePath: string, _success: boolean, _errors?: string[]) => {
        // callback should be accepted
      },
    };
    expect(options.onRecompile).toBeInstanceOf(Function);
  });
});

describe('CLI watch command', () => {
  let watchProcess: ChildProcess | null = null;

  afterEach(() => {
    // Clean up any running watch process
    if (watchProcess && !watchProcess.killed) {
      watchProcess.kill('SIGTERM');
      watchProcess = null;
    }
  });

  it('should start watch mode and perform initial compilation', async () => {
    const testFile = path.join(TEMP_DIR, 'watch-test.ts');
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
export function watchTestWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
    fs.writeFileSync(testFile, content);

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (watchProcess && !watchProcess.killed) {
          watchProcess.kill('SIGTERM');
        }
        reject(new Error('Test timed out waiting for watch mode output'));
      }, 30000);

      watchProcess = spawn('npx', ['tsx', CLI_ENTRY, 'watch', testFile], {
        cwd: PROJECT_ROOT,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let output = '';

      watchProcess.stdout?.on('data', (data) => {
        output += data.toString();
        // Check for successful initial compilation
        if (output.includes('Watching for file changes')) {
          clearTimeout(timeout);
          if (watchProcess && !watchProcess.killed) {
            watchProcess.kill('SIGTERM');
          }
          resolve();
        }
      });

      watchProcess.stderr?.on('data', (data) => {
        output += data.toString();
      });

      watchProcess.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }, 35000);

  it('should terminate when killed', async () => {
    const testFile = path.join(TEMP_DIR, 'sigint-test.ts');
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
export function sigintWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
    fs.writeFileSync(testFile, content);

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (watchProcess && !watchProcess.killed) {
          watchProcess.kill('SIGKILL');
        }
        reject(new Error('Test timed out'));
      }, 30000);

      watchProcess = spawn('npx', ['tsx', CLI_ENTRY, 'watch', testFile], {
        cwd: PROJECT_ROOT,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let output = '';
      let watchStarted = false;

      watchProcess.stdout?.on('data', (data) => {
        output += data.toString();
        if (output.includes('Watching for file changes') && !watchStarted) {
          watchStarted = true;
          // Kill process after watch mode starts
          setTimeout(() => {
            if (watchProcess && !watchProcess.killed) {
              watchProcess.kill('SIGTERM');
            }
          }, 500);
        }
      });

      watchProcess.on('exit', () => {
        clearTimeout(timeout);
        // Process terminates - that's what we care about
        resolve();
      });

      watchProcess.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }, 35000);

  it('should fail for non-existent file', async () => {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (watchProcess && !watchProcess.killed) {
          watchProcess.kill('SIGTERM');
        }
        reject(new Error('Test timed out'));
      }, 25000);

      watchProcess = spawn('npx', ['tsx', CLI_ENTRY, 'watch', '/nonexistent/file.ts'], {
        cwd: PROJECT_ROOT,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      watchProcess.on('exit', (code) => {
        clearTimeout(timeout);
        expect(code).toBe(1);
        resolve();
      });

      watchProcess.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }, 30000);
});
