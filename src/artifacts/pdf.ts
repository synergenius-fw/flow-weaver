/**
 * HTML to PDF through the browser already on the machine.
 *
 * Flow Weaver ships no browser. Every Chromium-family browser prints a page
 * to PDF headlessly, and one is on most machines that build software, so the
 * brief's PDF is that: the print rendering written to a file and printed by
 * Chrome, Chromium, Edge or Brave. `FW_BROWSER` names one explicitly. Without
 * it the usual install locations are tried. When none is found the error
 * says so and what to do: the HTML brief prints to PDF from any browser.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export class BrowserNotFoundError extends Error {
  readonly name = 'BrowserNotFoundError';
  constructor() {
    super('No Chromium-family browser found to print the PDF. Install Chrome, Chromium, Edge or Brave, or point FW_BROWSER at one. You can also open the HTML brief and print it to PDF from any browser.');
  }
}

const MAC_APPS = [
  ['Google Chrome', 'Google Chrome'], ['Chromium', 'Chromium'], ['Microsoft Edge', 'Microsoft Edge'],
  ['Brave Browser', 'Brave Browser'], ['Arc', 'Arc'], ['Vivaldi', 'Vivaldi'],
];
const LINUX_BINS = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable', 'brave-browser', 'vivaldi'];
const WIN_RELATIVE = [
  ['Google', 'Chrome', 'Application', 'chrome.exe'], ['Chromium', 'Application', 'chrome.exe'],
  ['Microsoft', 'Edge', 'Application', 'msedge.exe'], ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'],
];

const exists = (p: string): boolean => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/**
 * The browser to print with: `FW_BROWSER` (or `CHROME_PATH`,
 * `PUPPETEER_EXECUTABLE_PATH`) when set, else the first one found where the
 * platform installs them. `undefined` when there is none.
 */
export function findBrowser(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  for (const key of ['FW_BROWSER', 'CHROME_PATH', 'PUPPETEER_EXECUTABLE_PATH']) {
    const v = env[key];
    if (v && exists(v)) return v;
  }
  if (platform === 'darwin') {
    for (const [app, bin] of MAC_APPS) {
      for (const root of ['/Applications', path.join(os.homedir(), 'Applications')]) {
        const p = path.join(root, `${app}.app`, 'Contents', 'MacOS', bin);
        if (exists(p)) return p;
      }
    }
  } else if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter((r): r is string => !!r);
    for (const rel of WIN_RELATIVE) for (const root of roots) {
      const p = path.join(root, ...rel);
      if (exists(p)) return p;
    }
  } else {
    const dirs = (env.PATH ?? '').split(path.delimiter).filter(Boolean);
    for (const bin of LINUX_BINS) for (const dir of dirs) {
      const p = path.join(dir, bin);
      if (exists(p)) return p;
    }
  }
  return undefined;
}

export interface PdfOptions {
  /** The browser binary; found on the machine when omitted. */
  browser?: string;
  /** How long to give the browser, in milliseconds. Default 60 s. */
  timeoutMs?: number;
}

/** Print an HTML document to PDF. Resolves to the PDF's bytes. */
export async function htmlToPdf(html: string, options: PdfOptions = {}): Promise<Buffer> {
  const browser = options.browser ?? findBrowser();
  if (!browser) throw new BrowserNotFoundError();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-pdf-'));
  const htmlFile = path.join(dir, 'page.html');
  const pdfFile = path.join(dir, 'page.pdf');
  fs.writeFileSync(htmlFile, html, 'utf8');
  try {
    // Chrome writes the PDF and then may not exit for a long while -- on
    // macOS its updater helper keeps the process alive. So the file is what
    // is waited for: once it exists and has stopped growing the browser is
    // told to go, and a non-zero exit only matters if no file ever came.
    await printToFile(browser, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--hide-scrollbars', '--no-pdf-header-footer', '--disable-background-networking', '--disable-component-update',
      `--user-data-dir=${path.join(dir, 'profile')}`, `--print-to-pdf=${pdfFile}`, pathToFileURL(htmlFile).href,
    ], pdfFile, options.timeoutMs ?? 60_000);
    return fs.readFileSync(pdfFile);
  } finally {
    cleanUp(dir);
  }
}

function printToFile(cmd: string, args: string[], pdfFile: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    let lastSize = -1;
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearInterval(poll); clearTimeout(timer);
      try { child.kill(); } catch { /* already gone */ }
      if (err) reject(err);
      else resolve();
    };
    const poll = setInterval(() => {
      let size = -1;
      try { size = fs.statSync(pdfFile).size; } catch { return; }
      // Written and no longer growing since the last look: it is finished.
      if (size > 0 && size === lastSize) done();
      lastSize = size;
    }, 250);
    const timer = setTimeout(() => done(new Error(`${path.basename(cmd)} took longer than ${timeoutMs} ms to print the PDF`)), timeoutMs);
    child.on('error', (e) => done(e));
    child.on('exit', (code) => {
      if (settled) return;
      if (exists(pdfFile)) { done(); return; }
      done(new Error(`${path.basename(cmd)} exited with ${code ?? 'a signal'} without writing a PDF${stderr.trim() ? `: ${stderr.trim().split('\n').slice(-3).join(' ')}` : ''}`));
    });
  });
}

/**
 * The browser's helper processes keep writing to the profile for a moment
 * after the browser itself has exited, so removing the directory can fail
 * once. It is temp space: try now, try once more shortly, never fail the
 * PDF over it.
 */
function cleanUp(dir: string): void {
  const rm = () => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  try { rm(); } catch {
    setTimeout(() => { try { rm(); } catch { /* left in temp */ } }, 3000).unref();
  }
}

