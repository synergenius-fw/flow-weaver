/**
 * Dev command - watch, compile, and run workflow on changes
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { glob } from 'glob';
import { spawn, type ChildProcess } from 'child_process';
import { compileCommand, compileInngestTarget, type CompileOptions } from './compile.js';
import { executeWorkflowFromFile } from '../../mcp/workflow-executor.js';
import { logger } from '../utils/logger.js';
import { getErrorMessage } from '../../utils/error-utils.js';
import { getFriendlyError } from '../../friendly-errors.js';

function timestamp(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `[${h}:${m}:${s}]`;
}

export interface DevOptions {
  /** Input parameters as JSON string */
  params?: string;
  /** Path to JSON file containing input parameters */
  paramsFile?: string;
  /** Specific workflow name to run (if file contains multiple workflows) */
  workflow?: string;
  /** Run in production mode (no trace events) */
  production?: boolean;
  /** Module format for generated code */
  format?: 'esm' | 'cjs' | 'auto';
  /** Omit redundant @param/@returns annotations */
  clean?: boolean;
  /** Run once then exit (for testing) */
  once?: boolean;
  /** Output result as JSON (for scripting) */
  json?: boolean;
  /** Compilation target (default: typescript in-place) */
  target?: string;
  /** Framework for serve handler (inngest target only) */
  framework?: 'next' | 'express' | 'hono' | 'fastify' | 'remix';
  /** Port for the dev server (inngest target only) */
  port?: number;
}

/**
 * Parse params from --params or --params-file.
 */
function parseParams(options: DevOptions): Record<string, unknown> {
  if (options.params) {
    try {
      return JSON.parse(options.params);
    } catch {
      throw new Error(`Invalid JSON in --params: ${options.params}`);
    }
  }
  if (options.paramsFile) {
    const paramsFilePath = path.resolve(options.paramsFile);
    if (!fs.existsSync(paramsFilePath)) {
      throw new Error(`Params file not found: ${paramsFilePath}`);
    }
    try {
      const content = fs.readFileSync(paramsFilePath, 'utf8');
      return JSON.parse(content);
    } catch {
      throw new Error(`Failed to parse params file: ${options.paramsFile}`);
    }
  }
  return {};
}

/**
 * Run a single compile + execute cycle.
 * Returns true if both compile and run succeeded.
 */
async function compileAndRun(
  filePath: string,
  params: Record<string, unknown>,
  options: DevOptions
): Promise<boolean> {
  // Step 1: Compile
  const compileOpts: CompileOptions = {
    format: options.format,
    clean: options.clean,
  };

  try {
    await compileCommand(filePath, compileOpts);
    if (!options.json) {
      logger.success('Compiled successfully');
    }
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    const errorObj = error as { code?: string; errors?: Array<{ code: string; message: string; node?: string }> };

    if (errorObj.errors && Array.isArray(errorObj.errors)) {
      logger.error('Compile failed:');
      for (const err of errorObj.errors) {
        const friendly = getFriendlyError(err);
        if (friendly) {
          logger.error(`  ${friendly.title}: ${friendly.explanation}`);
          logger.info(`    How to fix: ${friendly.fix}`);
        } else {
          logger.error(`  - ${err.message}`);
        }
      }
    } else {
      logger.error(`Compile failed: ${errorMsg}`);
    }
    return false;
  }

  // Step 2: Run
  try {
    const result = await executeWorkflowFromFile(filePath, params, {
      workflowName: options.workflow,
      production: options.production ?? false,
      includeTrace: !options.production,
    });

    if (options.json) {
      process.stdout.write(
        JSON.stringify(
          {
            success: true,
            workflow: result.functionName,
            executionTime: result.executionTime,
            result: result.result,
          },
          null,
          2
        ) + '\n'
      );
    } else {
      logger.success(`Workflow "${result.functionName}" completed in ${result.executionTime}ms`);
      logger.newline();
      logger.section('Result');
      logger.log(JSON.stringify(result.result, null, 2));
    }
    return true;
  } catch (error) {
    const errorMsg = getErrorMessage(error);

    if (options.json) {
      process.stdout.write(
        JSON.stringify({ success: false, error: errorMsg }, null, 2) + '\n'
      );
    } else {
      logger.error(`Run failed: ${errorMsg}`);
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Inngest Dev Mode
// ---------------------------------------------------------------------------

/**
 * Check that required packages are installed.
 */
function checkDependency(pkg: string, cwd: string): boolean {
  try {
    require.resolve(pkg, { paths: [cwd] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate the dev server entry file for Inngest.
 */
function generateDevServerEntry(
  inngestOutputPath: string,
  framework: string,
  port: number
): string {
  const relImport = `./${path.basename(inngestOutputPath).replace(/\.ts$/, '.js')}`;

  if (framework === 'express') {
    return `import express from 'express';
import { handler } from '${relImport}';

const app = express();
app.use(express.json());
app.use('/api/inngest', handler);
app.listen(${port}, () => {
  console.log('Inngest dev server running on http://localhost:${port}');
  console.log('Inngest endpoint: http://localhost:${port}/api/inngest');
  console.log('');
  console.log('Connect Inngest Dev Server:');
  console.log('  npx inngest-cli@latest dev -u http://localhost:${port}/api/inngest');
});
`;
  }

  if (framework === 'hono') {
    return `import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { handler } from '${relImport}';

const app = new Hono();
app.route('/api/inngest', handler);

serve({ fetch: app.fetch, port: ${port} }, () => {
  console.log('Inngest dev server running on http://localhost:${port}');
  console.log('Inngest endpoint: http://localhost:${port}/api/inngest');
  console.log('');
  console.log('Connect Inngest Dev Server:');
  console.log('  npx inngest-cli@latest dev -u http://localhost:${port}/api/inngest');
});
`;
  }

  // Default: express (most common for dev)
  return generateDevServerEntry(inngestOutputPath, 'express', port);
}

/**
 * Compile workflow to Inngest and start a local dev server.
 */
async function runInngestDevMode(
  filePath: string,
  options: DevOptions
): Promise<void> {
  const framework = options.framework ?? 'express';
  const port = options.port ?? 3000;
  const cwd = path.dirname(filePath);

  // Check dependencies
  const missingDeps: string[] = [];
  if (!checkDependency('inngest', cwd)) missingDeps.push('inngest');
  if (framework === 'express' && !checkDependency('express', cwd)) missingDeps.push('express');
  if (framework === 'hono') {
    if (!checkDependency('hono', cwd)) missingDeps.push('hono');
    if (!checkDependency('@hono/node-server', cwd)) missingDeps.push('@hono/node-server');
  }

  if (missingDeps.length > 0) {
    throw new Error(`Missing dependencies: ${missingDeps.join(', ')}. Install them with: npm install ${missingDeps.join(' ')}`);
  }

  // Set up temp directory for generated files
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-inngest-dev-'));
  const inngestOutputPath = path.join(tmpDir, path.basename(filePath).replace(/\.ts$/, '.inngest.ts'));

  let serverProcess: ChildProcess | null = null;

  const compileInngest = async (): Promise<boolean> => {
    try {
      await compileInngestTarget(filePath, {
        production: false,
        workflowName: options.workflow,
        serve: true,
        framework: framework as 'next' | 'express' | 'hono' | 'fastify' | 'remix',
        typedEvents: true,
      });

      // compileInngestTarget writes to filePath.replace(.ts, .inngest.ts)
      // Copy it to our temp dir, then remove the source-adjacent file
      const sourceOutput = filePath.replace(/\.ts$/, '.inngest.ts');
      if (fs.existsSync(sourceOutput)) {
        fs.copyFileSync(sourceOutput, inngestOutputPath);
        try { fs.unlinkSync(sourceOutput); } catch { /* ignore */ }
      }
      return true;
    } catch (error) {
      logger.error(`Inngest compilation failed: ${getErrorMessage(error)}`);
      return false;
    }
  };

  const startServer = (): void => {
    // Generate dev server entry
    const entryPath = path.join(tmpDir, 'dev-server.ts');
    const entryCode = generateDevServerEntry(inngestOutputPath, framework, port);
    fs.writeFileSync(entryPath, entryCode, 'utf8');

    // Spawn tsx to run the server
    serverProcess = spawn('npx', ['tsx', entryPath], {
      cwd: path.dirname(filePath),
      stdio: 'inherit',
      shell: true,
    });

    serverProcess.on('error', (err) => {
      logger.error(`Server process error: ${err.message}`);
    });

    serverProcess.on('exit', (code) => {
      if (code !== null && code !== 0) {
        logger.error(`Server exited with code ${code}`);
      }
      serverProcess = null;
    });
  };

  const stopServer = (): void => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
      serverProcess = null;
    }
  };

  const restartServer = async (): Promise<void> => {
    stopServer();
    const ok = await compileInngest();
    if (ok) {
      startServer();
    }
  };

  // Header
  logger.section('Inngest Dev Mode');
  logger.info(`File: ${path.basename(filePath)}`);
  logger.info(`Framework: ${framework}`);
  logger.info(`Port: ${port}`);
  logger.newline();

  // Initial compile + start
  const ok = await compileInngest();
  if (!ok) {
    if (options.once) return;
    logger.info('Fix the errors above, then save the file to retry.');
  } else {
    if (options.once) return;
    startServer();
  }

  // Watch for changes
  logger.newline();
  logger.success('Watching for file changes... (Ctrl+C to stop)');

  const files = await glob(path.resolve(filePath), { absolute: true });
  const chokidar = await import('chokidar');
  const watcher = chokidar.watch(files, {
    persistent: true,
    ignoreInitial: true,
  });

  watcher.on('change', async (file) => {
    logger.newline();
    logger.info(`${timestamp()} File changed: ${path.basename(file)}`);
    logger.info('Recompiling and restarting server...');
    logger.newline();
    await restartServer();
  });

  // Cleanup
  const sourceOutput = filePath.replace(/\.ts$/, '.inngest.ts');
  const cleanup = () => {
    logger.newline();
    logger.info('Stopping Inngest dev mode...');
    stopServer();
    watcher.close();
    // Clean up temp files and source-adjacent .inngest.ts
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.unlinkSync(sourceOutput); } catch { /* ignore */ }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Keep process alive
  await new Promise(() => {});
}

// ---------------------------------------------------------------------------
// Main Command
// ---------------------------------------------------------------------------

/**
 * Dev command: watch + compile + run in a single loop.
 */
export async function devCommand(input: string, options: DevOptions = {}): Promise<void> {
  const filePath = path.resolve(input);

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  // Route to Inngest dev mode if target is inngest
  if (options.target === 'inngest') {
    return runInngestDevMode(filePath, options);
  }

  const params = parseParams(options);

  if (!options.json) {
    logger.section('Dev Mode');
    logger.info(`File: ${path.basename(filePath)}`);
    if (Object.keys(params).length > 0) {
      logger.info(`Params: ${JSON.stringify(params)}`);
    }
    logger.newline();
  }

  // Initial compile + run
  await compileAndRun(filePath, params, options);

  // If --once, exit after first cycle
  if (options.once) {
    return;
  }

  if (!options.json) {
    logger.newline();
    logger.success('Watching for file changes... (Ctrl+C to stop)');
  }

  // Find files to watch
  const files = await glob(input, { absolute: true });

  // Use chokidar for reliable cross-platform file watching
  const chokidar = await import('chokidar');
  const watcher = chokidar.watch(files, {
    persistent: true,
    ignoreInitial: true,
  });

  watcher.on('change', async (file) => {
    if (!options.json) {
      logger.newline();
      logger.info(`${timestamp()} File changed: ${path.basename(file)}`);
      logger.newline();
    }

    await compileAndRun(filePath, params, options);
  });

  // Handle process termination
  const cleanup = () => {
    if (!options.json) {
      logger.newline();
      logger.info('Stopping dev mode...');
    }
    watcher.close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Keep process alive
  await new Promise(() => {
    // Never resolves - keeps process running
  });
}
