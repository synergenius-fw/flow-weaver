import * as readline from 'node:readline';
import { loadCredentials, saveCredentials, clearCredentials, getPlatformUrl } from '../config/credentials.js';
import { PlatformClient } from '../config/platform-client.js';

export async function loginCommand(options: {
  email?: string;
  apiKey?: string;
  platformUrl?: string;
}): Promise<void> {
  const platformUrl = options.platformUrl ?? getPlatformUrl();

  console.log('');
  console.log('  \x1b[1mFlow Weaver Login\x1b[0m');
  console.log(`  \x1b[2mPlatform: ${platformUrl}\x1b[0m`);
  console.log('');

  // Validate platform reachable
  try {
    const resp = await fetch(`${platformUrl}/ready`);
    if (!resp.ok) throw new Error();
  } catch {
    console.error('  \x1b[31m✗\x1b[0m Cannot connect to platform');
    console.error(`    Check: ${platformUrl}`);
    process.exit(1);
  }

  let token: string;
  let email: string;
  let plan: string;
  let userId: string;

  if (options.apiKey) {
    // API key auth
    token = options.apiKey;
    const client = new PlatformClient({ token, email: '', plan: 'free', platformUrl, expiresAt: Infinity });
    try {
      const user = await client.getUser();
      email = user.email;
      plan = user.plan;
      userId = user.id;
    } catch {
      console.error('  \x1b[31m✗\x1b[0m Invalid API key');
      process.exit(1);
      return;
    }
  } else {
    // Email/password auth
    email = options.email ?? await prompt('  Email: ');
    const password = await prompt('  Password: ', true);

    try {
      const resp = await fetch(`${platformUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Login failed' })) as { error: string };
        console.error(`\n  \x1b[31m✗\x1b[0m ${err.error}`);
        process.exit(1);
        return;
      }

      const data = await resp.json() as { token: string; user: { id: string; email: string; plan: string } };
      token = data.token;
      email = data.user.email;
      plan = data.user.plan;
      userId = data.user.id;
    } catch (err) {
      console.error(`\n  \x1b[31m✗\x1b[0m ${err instanceof Error ? err.message : 'Login failed'}`);
      process.exit(1);
      return;
    }
  }

  const expiresAt = options.apiKey
    ? Date.now() + 365 * 24 * 60 * 60 * 1000  // 1 year for API keys
    : Date.now() + 7 * 24 * 60 * 60 * 1000;    // 7 days for JWT

  saveCredentials({ token, email, plan: plan as 'free' | 'pro' | 'business', platformUrl, expiresAt, userId });

  console.log('');
  console.log(`  \x1b[32m✓\x1b[0m Logged in as \x1b[1m${email}\x1b[0m (${plan} plan)`);
  console.log('');
  console.log('  What\'s unlocked:');
  console.log('    \x1b[36mfw deploy src/workflow.ts\x1b[0m   \x1b[2m# deploy to cloud\x1b[0m');
  console.log('    \x1b[36mfw status\x1b[0m                   \x1b[2m# see deployments + usage\x1b[0m');
  console.log('    \x1b[36mweaver assistant\x1b[0m             \x1b[2m# AI with platform credits\x1b[0m');
  console.log('');
}

export async function logoutCommand(): Promise<void> {
  clearCredentials();
  console.log('  \x1b[32m✓\x1b[0m Logged out');
}

export async function authStatusCommand(): Promise<void> {
  const creds = loadCredentials();
  if (!creds) {
    console.log('');
    console.log('  Not logged in.');
    console.log('  Run: \x1b[36mfw login\x1b[0m');
    console.log('');
    return;
  }

  const expiresIn = Math.floor((creds.expiresAt - Date.now()) / 1000 / 60 / 60);

  console.log('');
  console.log(`  \x1b[32m✓\x1b[0m Logged in as \x1b[1m${creds.email}\x1b[0m`);
  console.log(`  Plan: ${creds.plan}`);
  console.log(`  Platform: ${creds.platformUrl}`);
  console.log(`  Token expires in: ${expiresIn}h`);
  console.log('');
}

function prompt(message: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    if (hidden && process.stdin.isTTY) {
      // Hide password input
      process.stderr.write(message);
      process.stdin.setRawMode(true);
      let input = '';
      const handler = (key: Buffer) => {
        const ch = key.toString();
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.removeListener('data', handler);
          process.stderr.write('\n');
          rl.close();
          resolve(input);
        } else if (ch === '\x03') { // Ctrl+C
          process.exit(1);
        } else if (ch === '\x7f') { // Backspace
          input = input.slice(0, -1);
        } else {
          input += ch;
        }
      };
      process.stdin.on('data', handler);
    } else {
      rl.question(message, (answer) => { rl.close(); resolve(answer); });
    }
  });
}
