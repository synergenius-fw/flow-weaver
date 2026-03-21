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
  console.log('  \x1b[1mFlow Weaver Cloud\x1b[0m \x1b[2m(flowweaver.ai)\x1b[0m');
  console.log('');

  // API key mode (for CI/headless)
  if (options.apiKey) {
    await loginWithApiKey(options.apiKey, platformUrl);
    return;
  }

  // Email mode (explicit --email flag)
  if (options.email) {
    await loginWithEmail(options.email, platformUrl);
    return;
  }

  // Default: browser-first device auth
  await loginWithBrowser(platformUrl);
}

async function loginWithBrowser(platformUrl: string): Promise<void> {
  // Step 1: Request device code
  let deviceCode: string;
  let userCode: string;
  let verificationUrl: string;
  let interval: number;

  try {
    const resp = await fetch(`${platformUrl}/auth/device`, { method: 'POST' });
    if (!resp.ok) {
      // Platform doesn't support device auth — fall back to email
      console.log('  \x1b[33m⚠\x1b[0m Device auth not available. Using email login.');
      console.log('');
      const email = await prompt('  Email: ');
      await loginWithEmail(email, platformUrl);
      return;
    }
    const data = await resp.json() as { deviceCode: string; userCode: string; verificationUrl: string; interval: number };
    deviceCode = data.deviceCode;
    userCode = data.userCode;
    verificationUrl = data.verificationUrl;
    interval = data.interval ?? 5;
  } catch {
    console.error('  \x1b[31m✗\x1b[0m Cannot connect to flowweaver.ai');
    console.error('    Check your internet connection or set FW_PLATFORM_URL');
    process.exit(1);
    return;
  }

  // Step 2: Open browser
  const authUrl = `${verificationUrl}?code=${userCode}`;
  console.log(`  Your code: \x1b[1m${userCode}\x1b[0m`);
  console.log('');

  try {
    const { exec } = await import('child_process');
    const openCmd = process.platform === 'darwin' ? 'open'
      : process.platform === 'win32' ? 'start'
      : 'xdg-open';
    exec(`${openCmd} "${authUrl}"`);
    console.log('  \x1b[2mOpening browser...\x1b[0m');
  } catch {
    console.log(`  Open this URL in your browser:`);
    console.log(`  \x1b[36m${authUrl}\x1b[0m`);
  }
  console.log('');

  // Step 3: Poll for completion
  process.stdout.write('  Waiting for authentication...');

  let cancelled = false;
  const sigHandler = () => { cancelled = true; };
  process.on('SIGINT', sigHandler);

  const maxAttempts = 120; // 10 minutes at 5s intervals
  for (let i = 0; i < maxAttempts && !cancelled; i++) {
    await new Promise(r => setTimeout(r, interval * 1000));

    try {
      const resp = await fetch(`${platformUrl}/auth/device/poll?deviceCode=${deviceCode}`);
      if (!resp.ok) continue;

      const data = await resp.json() as { status: string; token?: string; user?: { id: string; email: string; name: string; plan: string } };

      if (data.status === 'approved' && data.token && data.user) {
        process.stdout.write(' \x1b[32m✓\x1b[0m\n\n');

        saveCredentials({
          token: data.token,
          email: data.user.email,
          plan: data.user.plan as 'free' | 'pro' | 'business',
          platformUrl,
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
          userId: data.user.id,
        });

        console.log(`  Logged in as \x1b[1m${data.user.email}\x1b[0m (${data.user.plan} plan)`);
        const credits = { free: '$0.50', pro: '$3.00', business: '$10.00' }[data.user.plan] ?? '$0';
        console.log(`  AI credits: ${credits}/month included`);
        console.log('');
        console.log('  Try: \x1b[36mweaver assistant\x1b[0m');
        console.log('');

        process.removeListener('SIGINT', sigHandler);
        return;
      }

      if (data.status === 'expired') {
        process.stdout.write(' \x1b[31mtimed out\x1b[0m\n\n');
        console.log('  Code expired. Run \x1b[36mfw login\x1b[0m again.');
        console.log('');
        process.removeListener('SIGINT', sigHandler);
        process.exit(1);
        return;
      }

      if (data.status === 'denied') {
        process.stdout.write(' \x1b[31mdenied\x1b[0m\n\n');
        console.log('  Access denied.');
        console.log('');
        process.removeListener('SIGINT', sigHandler);
        process.exit(1);
        return;
      }

      // Still pending — show a dot for progress
      if (i % 4 === 3) process.stdout.write('.');

    } catch {
      // Network error — keep trying
    }
  }

  process.removeListener('SIGINT', sigHandler);

  if (cancelled) {
    process.stdout.write(' \x1b[33mcancelled\x1b[0m\n\n');
  } else {
    process.stdout.write(' \x1b[31mtimed out\x1b[0m\n\n');
    console.log('  Authentication timed out. Run \x1b[36mfw login\x1b[0m again.');
    console.log('');
  }
}

async function loginWithApiKey(apiKey: string, platformUrl: string): Promise<void> {
  const client = new PlatformClient({ token: apiKey, email: '', plan: 'free', platformUrl, expiresAt: Infinity });
  let email: string;
  let plan: string;
  let userId: string;

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

  const expiresAt = Date.now() + 365 * 24 * 60 * 60 * 1000; // 1 year for API keys
  saveCredentials({ token: apiKey, email, plan: plan as 'free' | 'pro' | 'business', platformUrl, expiresAt, userId });

  console.log(`  \x1b[32m✓\x1b[0m Logged in as \x1b[1m${email}\x1b[0m (${plan} plan)`);
  const credits = { free: '$0.50', pro: '$3.00', business: '$10.00' }[plan] ?? '$0';
  console.log(`  AI credits: ${credits}/month included`);
  console.log('');
}

async function loginWithEmail(email: string, platformUrl: string): Promise<void> {
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

    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days for JWT
    saveCredentials({
      token: data.token,
      email: data.user.email,
      plan: data.user.plan as 'free' | 'pro' | 'business',
      platformUrl,
      expiresAt,
      userId: data.user.id,
    });

    console.log('');
    console.log(`  \x1b[32m✓\x1b[0m Logged in as \x1b[1m${data.user.email}\x1b[0m (${data.user.plan} plan)`);
    const credits = { free: '$0.50', pro: '$3.00', business: '$10.00' }[data.user.plan] ?? '$0';
    console.log(`  AI credits: ${credits}/month included`);
    console.log('');
  } catch (err) {
    console.error(`\n  \x1b[31m✗\x1b[0m ${err instanceof Error ? err.message : 'Login failed'}`);
    process.exit(1);
  }
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
  const credits = { free: '$0.50', pro: '$3.00', business: '$10.00' }[creds.plan] ?? '$0';

  console.log('');
  console.log(`  \x1b[32m✓\x1b[0m Logged in as \x1b[1m${creds.email}\x1b[0m`);
  console.log(`  Plan: ${creds.plan}`);
  console.log(`  AI credits: ${credits}/month included`);
  console.log(`  Platform: ${creds.platformUrl}`);
  console.log(`  Token expires in: ${expiresIn}h`);
  console.log('');
  console.log('  Commands unlocked:');
  console.log('    \x1b[36mfw deploy <file>\x1b[0m         deploy to cloud');
  console.log('    \x1b[36mfw cloud-status\x1b[0m          see deployments + usage');
  console.log('    \x1b[36mweaver assistant\x1b[0m          AI with platform credits');
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
