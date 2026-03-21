import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface StoredCredentials {
  token: string;
  email: string;
  plan: 'free' | 'pro' | 'business';
  platformUrl: string;
  expiresAt: number;
  userId?: string;
}

const FW_CONFIG_DIR = path.join(os.homedir(), '.fw');
const CREDENTIALS_FILE = path.join(FW_CONFIG_DIR, 'credentials.json');

export function loadCredentials(): StoredCredentials | null {
  if (!fs.existsSync(CREDENTIALS_FILE)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf-8'));
    if (isTokenExpired(data)) return null;
    return data;
  } catch { return null; }
}

export function saveCredentials(creds: StoredCredentials): void {
  fs.mkdirSync(FW_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), 'utf-8');
  try { fs.chmodSync(CREDENTIALS_FILE, 0o600); } catch { /* Windows */ }
}

export function clearCredentials(): void {
  try { fs.unlinkSync(CREDENTIALS_FILE); } catch { /* not found */ }
}

export function isTokenExpired(creds: StoredCredentials): boolean {
  return Date.now() > creds.expiresAt;
}

export function getPlatformUrl(): string {
  const creds = loadCredentials();
  return creds?.platformUrl ?? process.env.FW_PLATFORM_URL ?? 'https://app.synergenius.pt';
}

export function isLoggedIn(): boolean {
  return loadCredentials() !== null;
}
