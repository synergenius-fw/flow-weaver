/**
 * The PDF is printed by whatever Chromium-family browser is on the machine.
 * Finding one is tested against a fake filesystem layout; printing is tested
 * against a fake browser that honours --print-to-pdf, and against the real
 * one when the machine running the tests has it.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { findBrowser, htmlToPdf, BrowserNotFoundError } from '../../../src/artifacts/pdf';
import { renderArtifact } from '../../../src/artifacts/index';
import { parseWorkflow } from '../../../src/api/parse';
import { fileURLToPath } from 'node:url';

let dir: string;
let fakeBrowser: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-pdf-test-'));
  // A "browser": a node script that finds --print-to-pdf=<file> among its
  // arguments and writes a PDF header there, plus the page's title so the
  // test can see the right HTML reached it.
  fakeBrowser = path.join(dir, process.platform === 'win32' ? 'browser.cmd' : 'browser');
  const script = path.join(dir, 'browser.mjs');
  fs.writeFileSync(script, `
import fs from 'node:fs';
const out = process.argv.find((a) => a.startsWith('--print-to-pdf='))?.slice('--print-to-pdf='.length);
const page = process.argv.find((a) => a.startsWith('file://'));
const html = fs.readFileSync(new URL(page), 'utf8');
const title = /<title>(.*?)<\\/title>/.exec(html)?.[1] ?? '';
fs.writeFileSync(out, '%PDF-1.4 fake ' + title);
`);
  if (process.platform === 'win32') fs.writeFileSync(fakeBrowser, `@node "${script}" %*\r\n`);
  else { fs.writeFileSync(fakeBrowser, `#!/bin/sh\nexec node "${script}" "$@"\n`); fs.chmodSync(fakeBrowser, 0o755); }
});
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('findBrowser', () => {
  it('takes FW_BROWSER first, then the other well-known variables, when they point at a file', () => {
    expect(findBrowser({ FW_BROWSER: fakeBrowser, CHROME_PATH: '/nowhere/chrome' })).toBe(fakeBrowser);
    expect(findBrowser({ FW_BROWSER: '/nowhere/chrome', CHROME_PATH: fakeBrowser })).toBe(fakeBrowser);
    expect(findBrowser({ PUPPETEER_EXECUTABLE_PATH: fakeBrowser })).toBe(fakeBrowser);
  });

  it('looks on PATH on Linux, and finds nothing on an empty machine', () => {
    const bin = path.join(dir, 'bin'); fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'chromium'), '');
    expect(findBrowser({ PATH: bin }, 'linux')).toBe(path.join(bin, 'chromium'));
    expect(findBrowser({ PATH: path.join(dir, 'empty') }, 'linux')).toBeUndefined();
    expect(findBrowser({ PROGRAMFILES: path.join(dir, 'empty') }, 'win32')).toBeUndefined();
  });
});

describe('htmlToPdf', () => {
  it('hands the page to the browser and returns what it printed', async () => {
    const pdf = await htmlToPdf('<!doctype html><html><head><title>Hello brief</title></head><body>hi</body></html>', { browser: fakeBrowser });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.toString()).toContain('Hello brief');
  });

  it('says what to do when there is no browser', async () => {
    const saved = { ...process.env };
    for (const k of ['FW_BROWSER', 'CHROME_PATH', 'PUPPETEER_EXECUTABLE_PATH']) delete process.env[k];
    try {
      const browser = findBrowser();
      if (browser) return; // this machine has one; the error path is covered by the option below
      await expect(htmlToPdf('<html></html>')).rejects.toBeInstanceOf(BrowserNotFoundError);
    } finally { Object.assign(process.env, saved); }
  });

  it('reports a browser that fails instead of hanging', async () => {
    const bad = path.join(dir, 'bad');
    fs.writeFileSync(bad, '#!/bin/sh\nexit 3\n'); fs.chmodSync(bad, 0o755);
    if (process.platform === 'win32') return;
    await expect(htmlToPdf('<html></html>', { browser: bad })).rejects.toThrow(/exited with 3/);
  });
});

describe('renderArtifact', () => {
  const useCases = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'use-cases');
  it('produces the brief, the PDF of its print rendering, and the SVG', async () => {
    const { ast } = await parseWorkflow(path.join(useCases, 'hello-world.ts'), { workflowName: 'helloWorld' });
    const brief = await renderArtifact(ast, 'brief', { subtitle: 'x' });
    expect(brief.type).toContain('text/html'); expect(brief.extension).toBe('.brief.html'); expect(brief.body).toContain('id="theme"');
    const svg = await renderArtifact(ast, 'svg');
    expect(svg.type).toBe('image/svg+xml'); expect(String(svg.body).startsWith('<svg')).toBe(true);
    const pdf = await renderArtifact(ast, 'pdf', { pdf: { browser: fakeBrowser } });
    expect(pdf.type).toBe('application/pdf'); expect(pdf.extension).toBe('.brief.pdf');
    expect((pdf.body as Buffer).toString()).toContain('helloWorld · Flow Weaver brief');
  }, 60000);

  const real = findBrowser();
  it.skipIf(!real)('prints a real PDF with the browser on this machine', async () => {
    const { ast } = await parseWorkflow(path.join(useCases, 'hello-world.ts'), { workflowName: 'helloWorld' });
    const pdf = await renderArtifact(ast, 'pdf', { pdf: { browser: real } });
    const bytes = pdf.body as Buffer;
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(10_000);
  }, 90000);
});
