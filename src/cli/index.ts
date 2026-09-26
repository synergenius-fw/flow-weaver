/**
 * Flow Weaver Annotations CLI
 * Command-line interface for compiling and validating workflow files
 *
 * The commands themselves are built in program.ts. This entry point only
 * runs a real invocation: the no-args welcome, pack-contributed commands,
 * and parsing `process.argv`.
 *
 * Note: Shebang is added by build script (scripts/build-cli.ts) to the bundle's entry.
 * Do not add #!/usr/bin/env node here - it will cause duplicate shebangs.
 */

// Must be imported first: sets up env vars before picocolors reads them
import './env-setup.js';

import { buildProgram, cliVersion } from './program.js';
import { packCommandsNeeded } from './pack-commands-needed.js';
import { logger } from './utils/logger.js';
import { getErrorMessage } from '../utils/error-utils.js';

const program = buildProgram();

// Show concise welcome when no command specified (before parse to avoid Commander error handling)
if (!process.argv.slice(2).length) {
  logger.banner(cliVersion);
  console.log();
  console.log('  Usage: fw <command> [options]');
  console.log();
  console.log('  Get started:');
  console.log('    init [dir]        Create a new project');
  console.log('    compile <input>   Compile workflow files');
  console.log('    validate <input>  Validate without compiling');
  console.log('    run <input>       Execute a workflow');
  console.log('    doctor            Check project environment');
  console.log();
  console.log('  Run ' + logger.highlight('fw --help') + ' for all commands.');
  console.log();
  process.exit(0);
}

// Register pack-contributed CLI commands when the invocation can reach one,
// then parse.
(async () => {
  // --color and --no-color are read by picocolors straight from argv, and
  // may come after the command. Program options are positional (so a
  // command's own option of the same name reaches it), so they are taken
  // out here rather than refused as unknown options of the command.
  const argv = process.argv.filter((arg) => arg !== '--color' && arg !== '--no-color');

  if (packCommandsNeeded(program, argv.slice(2))) {
    const { registerPackCommands } = await import('./pack-commands.js');
    await registerPackCommands(program);
  }

  program.parse(argv);
})().catch((error) => {
  logger.error(getErrorMessage(error));
  process.exit(1);
});
