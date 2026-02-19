import { execSync } from 'child_process';
import * as readline from 'readline';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { McpServerOptions, RegistrationDeps } from './types.js';

function defaultRegistrationDeps(): RegistrationDeps {
  return {
    execCommand: async (cmd: string) => {
      try {
        const stdout = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        return { stdout: stdout.trim(), exitCode: 0 };
      } catch {
        return { stdout: '', exitCode: 1 };
      }
    },
    prompt: (question: string) =>
      new Promise<string>((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
        rl.question(question, (answer: string) => {
          rl.close();
          resolve(answer.trim().toLowerCase());
        });
      }),
    log: (msg: string) => process.stderr.write(msg + '\n'),
    resolveCliPath: () => {
      // import.meta.url works in ESM (tsx), __dirname works in CJS (built bundle)
      try {
        return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
      } catch {
        return path.resolve(__dirname, '..');
      }
    },
  };
}

export async function offerClaudeRegistration(
  options: McpServerOptions,
  deps?: RegistrationDeps
): Promise<void> {
  const d = deps ?? defaultRegistrationDeps();

  // 1. Detect Claude Code
  const whichCmd = process.platform === 'win32' ? 'where claude' : 'which claude';
  const whichResult = await d.execCommand(whichCmd);
  if (whichResult.exitCode !== 0) {
    d.log('Claude Code not found in PATH. Skipping auto-registration.');
    return;
  }

  // 2. Check if already registered
  const listResult = await d.execCommand('claude mcp list');
  if (listResult.stdout.includes('flow-weaver')) {
    d.log('Flow Weaver MCP server already registered in Claude Code.');
    return;
  }

  // 3. Prompt user
  const answer = await d.prompt('Claude Code detected. Register Flow Weaver MCP server? (y/N) ');
  if (answer !== 'y' && answer !== 'yes') {
    d.log('Skipped MCP server registration.');
    return;
  }

  // 4. Register
  const cliPath = d.resolveCliPath();
  const cmd = `claude mcp add --scope project flow-weaver -- npx tsx ${cliPath}/index.ts mcp-server --stdio`;
  await d.execCommand(cmd);

  d.log('Registered Flow Weaver MCP server. Restart Claude Code to activate.');
}
