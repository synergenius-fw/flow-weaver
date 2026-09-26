/**
 * A request the console cannot handle gets an error response, and its failure
 * never escapes the request handler as an unhandled rejection, which would
 * take the whole console process down.
 */
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { createConsoleServer, type ConsoleServer } from '../../../src/console/server.js';
import { createMemoryRunStore } from '../../../src/coordinator/index.js';

let project: string;
let assets: string;
let server: ConsoleServer;

beforeAll(async () => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-console-failures-'));
  assets = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-console-failures-assets-'));
  fs.writeFileSync(path.join(assets, 'index.html'), '<!doctype html>');
  fs.writeFileSync(path.join(assets, 'app.js'), '');
  server = await createConsoleServer({ projectDir: project, port: 0, watch: false, assetsDir: assets, store: createMemoryRunStore() });
}, 60000);

afterAll(async () => {
  await server.close();
  for (const d of [project, assets]) fs.rmSync(d, { recursive: true, force: true });
});

/** Send a raw request line, which fetch would normalise, and return the status line. */
function rawRequest(target: string): Promise<string> {
  const { port } = new URL(server.url);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(Number(port), '127.0.0.1', () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    let buf = '';
    socket.on('data', (chunk) => { buf += chunk.toString(); });
    socket.on('close', () => resolve(buf.split('\r\n')[0]));
    socket.on('error', reject);
    setTimeout(() => { socket.destroy(); resolve(buf.split('\r\n')[0]); }, 3000);
  });
}

describe('console request failures', () => {
  it('answers 400 to a request target that is not a valid URL, without an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      // A protocol-relative target with a port out of range: URL parsing throws.
      const status = await rawRequest('//a:99999/');
      await new Promise((r) => setTimeout(r, 20));
      expect(status).toBe('HTTP/1.1 400 Bad Request');
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('still serves requests afterwards', async () => {
    const res = await fetch(server.url + '/api/project');
    expect(res.status).toBe(200);
  });
});
