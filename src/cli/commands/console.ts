/**
 * Console command - open the local operator console for a project.
 */

import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { logger } from '../utils/logger.js';
import { announceService } from '../../service-registry.js';

export interface ConsoleOptions {
  port?: number;
  host?: string;
  /** Open the console in the default browser once it is listening. */
  open?: boolean;
  /** Re-list and re-validate when project files change. */
  watch?: boolean;
}

/**
 * Start the console: a local web app that shows every workflow in the
 * project as a process, its validation issues on the steps, the code behind
 * each step, and real runs live, with gates answered from the page.
 *
 * @example
 * ```bash
 * fw console            # current directory
 * fw console ./flows    # another project
 * fw console --open     # and open the browser
 * ```
 */
export async function consoleCommand(dir: string | undefined, options: ConsoleOptions): Promise<void> {
  const projectDir = path.resolve(dir || '.');
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    throw new Error(`Directory not found: ${projectDir}`);
  }

  const { createConsoleServer } = await import('../../console/server.js');
  let announced: ReturnType<typeof announceService> | undefined;
  const server = await createConsoleServer({
    projectDir, port: options.port, host: options.host, watch: options.watch,
    onProject: (dir) => announced?.update({ project: dir }),
  });
  announced = announceService({ kind: 'console', transport: 'http', url: server.url, project: projectDir });

  logger.log(`fw console  ${server.url}`);
  logger.log(`project     ${projectDir}`);
  if (options.open) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
    exec(`${cmd} ${server.url}`);
  }

  await new Promise<void>((resolve) => {
    const stop = () => { void server.close().then(resolve); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}
