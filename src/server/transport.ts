/**
 * The two small interfaces the handler speaks, and the shim that lets a
 * fetch-style host speak them. Node's request and response satisfy
 * `ServerRequest` and `ServerResponse` structurally; a Web `Request` is
 * turned into one here, and what the handler writes comes back as a Web
 * `Response` whose body streams.
 */
import { getErrorMessage } from '../utils/error-utils.js';

/** What the handler reads from a request. Node's IncomingMessage is one, and so is the fetch shim below. */
export interface ServerRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array | string>;
  on(event: 'close', listener: () => void): unknown;
  /**
   * A body a framework already parsed (`express.json()`, `express.urlencoded()`
   * set this). When present the stream is not read again, which it could not
   * be anyway. A string or Buffer is parsed by the request's content type.
   */
  body?: unknown;
}

/** What the handler writes to a response. Node's ServerResponse is one. */
export interface ServerResponse {
  headersSent: boolean;
  writeHead(status: number, headers?: Record<string, string | number>): unknown;
  setHeader(name: string, value: string): unknown;
  write(chunk: string): unknown;
  end(chunk?: string): unknown;
}

type Handle = (req: ServerRequest, res: ServerResponse, opts?: { basePath?: string }) => Promise<boolean>;

/**
 * Run the handler against a Web Request, answering a Web Response. The
 * response resolves as soon as headers are written, with a stream for the
 * body, so server-sent events flow through hosts that support streaming.
 */
export async function fetchAdapter(handle: Handle, request: Request, opts?: { basePath?: string }): Promise<Response> {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  const closeListeners: Array<() => void> = [];
  request.signal?.addEventListener('abort', () => closeListeners.forEach((f) => f()));
  const req: ServerRequest = {
    method: request.method,
    url: url.pathname + url.search,
    headers,
    async *[Symbol.asyncIterator]() {
      if (!request.body) return;
      const reader = request.body.getReader();
      for (;;) { const { value, done } = await reader.read(); if (done) return; yield value; }
    },
    on: (_e, l) => closeListeners.push(l),
  };
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let status = 200;
  const outHeaders = new Headers();
  let resolveResponse!: (r: Response) => void;
  const response = new Promise<Response>((r) => { resolveResponse = r; });
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; }, cancel() { closeListeners.forEach((f) => f()); } });
  let sent = false, ended = false;
  const send = () => { if (sent) return; sent = true; resolveResponse(new Response(status === 204 || status === 304 ? null : stream, { status, headers: outHeaders })); };
  const res: ServerResponse = {
    get headersSent() { return sent; },
    writeHead(s, h) { status = s; for (const [k, v] of Object.entries(h ?? {})) outHeaders.set(k, String(v)); send(); return this; },
    setHeader(k, v) { outHeaders.set(k, v); return this; },
    write(chunk) { send(); controller?.enqueue(encoder.encode(chunk)); return true; },
    end(chunk) { if (ended) return this; if (chunk) this.write(chunk); send(); ended = true; try { controller?.close(); } catch { /* already closed */ } return this; },
  };
  void handle(req, res, opts).then((handled) => {
    if (!handled && !sent) { status = 404; outHeaders.set('Content-Type', 'application/json'); res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: `no route for ${request.method} ${url.pathname}` } })); }
    else if (!ended) res.end();
  }).catch((err) => { if (!sent) { status = 500; res.end(JSON.stringify({ error: { code: 'INTERNAL', message: getErrorMessage(err) } })); } else res.end(); });
  return response;
}
