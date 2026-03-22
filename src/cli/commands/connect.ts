import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { DeviceConnection } from '../../agent/device-connection.js';

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
      .map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file', path: path.relative(projectDir, path.join(dirPath, e.name)) }));
  });

  console.log('');
  console.log('  \x1b[1mflow-weaver connect\x1b[0m');
  console.log(`  \x1b[2mProject: ${path.basename(projectDir)}\x1b[0m`);
  console.log(`  \x1b[2mPlatform: ${creds.platformUrl}\x1b[0m`);
  console.log('');

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
