import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as readline from 'node:readline';
import { DeviceConnection } from '../../agent/device-connection.js';
import { discoverDeviceHandlers } from '../../marketplace/registry.js';

function promptYesNo(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(message, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === '' || normalized === 'y' || normalized === 'yes');
    });
  });
}

export async function loadPackDeviceHandlers(
  conn: DeviceConnection,
  projectDir: string,
): Promise<string[]> {
  const loadedPacks: string[] = [];
  try {
    const handlers = await discoverDeviceHandlers(projectDir);
    for (const handler of handlers) {
      try {
        const mod = await import(handler.entrypoint);
        if (typeof mod.register === 'function') {
          await mod.register(conn, { projectDir });
          loadedPacks.push(handler.packageName);
          process.stderr.write(`  \x1b[2m+ ${handler.packageName} handlers\x1b[0m\n`);
        }
      } catch (err) {
        process.stderr.write(`  \x1b[33m⚠\x1b[0m Failed to load handlers from ${handler.packageName}: ${err instanceof Error ? err.message : err}\n`);
      }
    }
  } catch {
    // Discovery failed — non-fatal
  }
  return loadedPacks;
}

export async function handleConnect(projectDir: string): Promise<void> {
  // Load credentials
  const credPath = path.join(os.homedir(), '.fw', 'credentials.json');
  if (!fs.existsSync(credPath)) {
    console.error('\n  Not logged in. Run: fw login\n');
    process.exit(1);
  }
  const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
  if (!creds.token || !creds.platformUrl || creds.expiresAt < Date.now()) {
    console.error('\n  Credentials expired. Run: fw login\n');
    process.exit(1);
  }

  const conn = new DeviceConnection({
    platformUrl: creds.platformUrl,
    token: creds.token,
    projectDir,
    deviceName: path.basename(projectDir),
    logger: (msg) => process.stderr.write(`  \x1b[2m${msg}\x1b[0m\n`),
  });

  // Register basic file handlers (any project can use these)
  conn.addCapability('file_read');
  conn.addCapability('file_list');

  conn.onRequest('file:read', async (_method, params) => {
    const filePath = path.resolve(projectDir, String(params.path ?? ''));
    if (!filePath.startsWith(projectDir)) throw new Error('Path outside project directory');
    if (!fs.existsSync(filePath)) throw new Error('File not found');
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) return { type: 'directory', entries: fs.readdirSync(filePath) };
    if (stat.size > 1_048_576) throw new Error('File too large (>1MB)');
    return { type: 'file', content: fs.readFileSync(filePath, 'utf-8') };
  });

  conn.onRequest('file:list', async (_method, params) => {
    const dirPath = path.resolve(projectDir, String(params.path ?? '.'));
    if (!dirPath.startsWith(projectDir)) throw new Error('Path outside project directory');
    if (!fs.existsSync(dirPath)) throw new Error('Directory not found');
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'dist')
      .map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file', path: path.relative(projectDir, path.join(dirPath, e.name)), hasUnfetchedChildren: e.isDirectory() }));
  });

  // Load pack device handlers (if any installed packs provide them)
  const loadedPacks = await loadPackDeviceHandlers(conn, projectDir);

  // Tell the platform which packs contributed handlers (for auto-install)
  if (loadedPacks.length > 0) {
    conn.setPacks(loadedPacks);
  }

  console.log('');
  console.log('  \x1b[1mflow-weaver connect\x1b[0m');
  console.log(`  \x1b[2mProject: ${path.basename(projectDir)}\x1b[0m`);
  console.log(`  \x1b[2mPlatform: ${creds.platformUrl}\x1b[0m`);
  console.log('');

  // Check if packs need to be installed in the Studio workspace
  if (loadedPacks.length > 0) {
    try {
      const checkRes = await fetch(`${creds.platformUrl}/devices/check-packs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${creds.token}` },
        body: JSON.stringify({ packs: loadedPacks }),
      });
      if (checkRes.ok) {
        const { missing } = await checkRes.json() as { missing: string[] };
        if (missing.length > 0) {
          console.log('  The following packs need to be installed in Studio:');
          for (const p of missing) {
            console.log(`    \x1b[36m${p}\x1b[0m`);
          }
          console.log('');

          const answer = await promptYesNo('  Install now? (Y/n) ');

          if (answer) {
            process.stderr.write('  Installing...');
            const installRes = await fetch(`${creds.platformUrl}/devices/install-packs`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${creds.token}` },
              body: JSON.stringify({ packs: missing }),
            });
            if (installRes.ok) {
              const { results } = await installRes.json() as { results: Array<{ pack: string; ok: boolean; error?: string }> };
              const allOk = results.every(r => r.ok);
              if (allOk) {
                process.stderr.write(' \x1b[32m✓\x1b[0m\n\n');
              } else {
                process.stderr.write(' \x1b[33mpartial\x1b[0m\n');
                for (const r of results) {
                  if (!r.ok) console.log(`    \x1b[31m✗\x1b[0m ${r.pack}: ${r.error}`);
                }
                console.log('');
              }
            } else {
              process.stderr.write(' \x1b[31mfailed\x1b[0m\n\n');
            }
          } else {
            console.log('  \x1b[2mSkipped. Install manually via Studio marketplace.\x1b[0m\n');
          }
        }
      }
    } catch {
      // Check failed — non-fatal, continue connecting
    }
  }

  try {
    await conn.connect();
    console.log('  \x1b[2mPress Ctrl+C to disconnect.\x1b[0m\n');
    await new Promise<void>((resolve) => {
      process.on('SIGINT', () => { console.log('\n  \x1b[2mDisconnecting...\x1b[0m'); conn.disconnect(); resolve(); });
      process.on('SIGTERM', () => { conn.disconnect(); resolve(); });
    });
  } catch (err) {
    console.error(`  \x1b[31m✗\x1b[0m Connection failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
