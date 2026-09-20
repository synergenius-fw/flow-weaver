/**
 * fw artifact: the brief, its PDF and the SVG from the command line.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../../src/cli/utils/logger.js', () => ({
  logger: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn(), log: vi.fn(), newline: vi.fn(), section: vi.fn(), debug: vi.fn() },
}));

import { artifactCommand } from '../../src/cli/commands/artifact';
import { logger } from '../../src/cli/utils/logger.js';

const useCases = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'use-cases');
const hello = path.join(useCases, 'hello-world.ts');
let dir: string;
let fakeBrowser: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-artifact-cli-'));
  const script = path.join(dir, 'browser.mjs');
  fs.writeFileSync(script, `
import fs from 'node:fs';
const out = process.argv.find((a) => a.startsWith('--print-to-pdf='))?.slice('--print-to-pdf='.length);
fs.writeFileSync(out, '%PDF-1.4 fake');
`);
  fakeBrowser = path.join(dir, 'browser');
  fs.writeFileSync(fakeBrowser, `#!/bin/sh\nexec node "${script}" "$@"\n`); fs.chmodSync(fakeBrowser, 0o755);
});
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('fw artifact', () => {
  it('writes the brief when asked for a file, with the folder as subtitle', async () => {
    const out = path.join(dir, 'hello.brief.html');
    await artifactCommand(hello, { output: out });
    const html = fs.readFileSync(out, 'utf8');
    expect(html).toContain('<h1>helloWorld</h1>');
    expect(html).toContain('use-cases · ');
    expect(html).toContain('id="theme"');
    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining(out));
  });

  it('prints the SVG to stdout when no file is named', async () => {
    const chunks: string[] = [];
    const write = process.stdout.write;
    process.stdout.write = ((c: string | Uint8Array) => { chunks.push(String(c)); return true; }) as typeof process.stdout.write;
    try { await artifactCommand(hello, { kind: 'svg', theme: 'dark' }); }
    finally { process.stdout.write = write; }
    expect(chunks.join('').startsWith('<svg')).toBe(true);
    expect(chunks.join('')).toContain('fill="#0e1014"');
  });

  it.skipIf(process.platform === 'win32')('writes the PDF beside the workflow when no file is named', async () => {
    const copy = path.join(dir, 'hello-world.ts');
    fs.copyFileSync(hello, copy);
    await artifactCommand(copy, { kind: 'pdf', browser: fakeBrowser });
    const pdf = path.join(dir, 'helloWorld.brief.pdf');
    expect(fs.existsSync(pdf)).toBe(true);
    expect(fs.readFileSync(pdf).subarray(0, 4).toString()).toBe('%PDF');
  }, 60000);

  it('refuses an unknown kind and a missing file with a plain message', async () => {
    await expect(artifactCommand(hello, { kind: 'docx' })).rejects.toThrow(/Unknown artifact "docx"/);
    await expect(artifactCommand(path.join(dir, 'missing.ts'), {})).rejects.toThrow(/File not found/);
  });
});
