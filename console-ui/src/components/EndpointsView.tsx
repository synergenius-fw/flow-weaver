import { useEffect, useState } from 'preact/hooks';
import { view, endpoints, loadEndpoints, serveInfo, openDoc, openServe, toast, type EndpointWorkflow } from '../state';
import { curlFor, answerLine } from '../http';
import { ago } from '../format';
import { CliPane } from './Cli';
import { PaneTab } from './PaneTab';
import { Highlight } from './Code';

const copy = async (text: string, what = 'copied') => { try { await navigator.clipboard.writeText(text); toast(what); } catch { toast('could not copy'); } };

/** A method as a chip, coloured by what it does. */
export function Method({ m }: { m: string }) {
  return <span class={`mchip ${m}`}>{m}</span>;
}

/** The flags a route carries, as short words. */
export function RouteFlags({ r }: { r: { mode?: string; auth?: string; callback?: boolean; mounted?: boolean } }) {
  return (
    <>
      {r.mode === 'async' && <span class="pill" title="Answers 202 at once; the run is followed by its id">async</span>}
      {r.auth === 'none' && <span class="pill warn" title="Served without the bearer token">open</span>}
      {r.callback && <span class="pill" title="A caller may name a callbackUrl that receives the final response">callback</span>}
      {r.mounted === false && <span class="pill err" title="Not mounted: see the problems above">not mounted</span>}
    </>
  );
}

function ServeLine() {
  const s = serveInfo.value;
  const cmd = s?.command ?? 'fw serve --trace';
  return (
    <div class="card serveline">
      <div class="in">
        {s?.running
          ? <><span class="sdot ok" /> <b>fw serve</b> is up at <code>{s.running.url}</code> · since {ago(Date.parse(s.running.startedAt))}</>
          : <><span class="sdot" /> <b>fw serve</b> is not running for this project. <span class="composed inline"><code>{cmd}</code><button class="linkish" onClick={() => copy(cmd)}>copy</button></span></>}
      </div>
    </div>
  );
}

function WorkflowCard({ w, base }: { w: EndpointWorkflow; base: string }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div class="card epcard">
      <h3>
        <button class="linkish name" onClick={() => openServe(w.file, w.name)} title={w.rel}>{w.name}</button>
        <span class="hint">{w.rel}</span>
        <span class="sp" />
        {w.gates > 0 && <span class="pill gate" title="Pauses at a gate; a caller gets 202 and a run to follow">{w.gates} gate{w.gates === 1 ? '' : 's'}</span>}
        <button class="btn ghost sm" onClick={() => openServe(w.file, w.name)} title="Change the routes on the workflow's Serve pane">Edit</button>
      </h3>
      {w.description && <div class="in hint desc">{w.description}</div>}
      <div class="routes">
        {w.routes.map((r, i) => (
          <div class={`route ${open === i ? 'open' : ''}`} key={`${r.method} ${r.path}`}>
            <button class="routehead" onClick={() => setOpen(open === i ? null : i)}>
              <Method m={r.method} />
              <span class="mono path">{r.path}</span>
              <span class="flags"><RouteFlags r={r} /></span>
              <span class="hint ans">{answerLine(r, w.gates)}</span>
            </button>
            {open === i && (
              <div class="routebody">
                <pre class="curl mono">{curlFor(base, w.name, r, w.params, {})}</pre>
                <div class="formfoot">
                  <button class="btn sm" onClick={() => copy(curlFor(base, w.name, r, w.params, {}))}>copy request</button>
                  <span class="hint">{w.params.length ? `parameters: ${w.params.map((p) => `${p.name}: ${p.tsType}`).join(', ')}` : 'no parameters'}{w.returns.length ? ` · answers with ${w.returns.map((p) => p.name).join(', ')}` : ''}</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The project's workflows as HTTP endpoints: every `@http` line, what it
 * answers with, and the request to copy. A workflow without one is still a
 * run resource; exposing it is one action on its Serve pane.
 */
export function EndpointsView() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => { setBusy(true); setError(''); loadEndpoints().catch((e: Error) => setError(e.message)).finally(() => setBusy(false)); };
  useEffect(() => { if (view.value.kind === 'endpoints') load(); }, [view.value.kind]);
  if (view.value.kind !== 'endpoints') return null;
  const e = endpoints.value;
  const base = serveInfo.value?.running?.url ?? 'http://127.0.0.1:3000';
  const routeCount = e?.workflows.reduce((n, w) => n + w.routes.length, 0) ?? 0;
  return (
    <div class="docview endpointsview">
      <div class="dochead">
        <h1>Endpoints</h1>
        <p class="lede">Workflows served over HTTP. Each <code>@http</code> line on a workflow is a route on <code>fw serve</code>, and on any server this project's API is mounted in.</p>
        <div class="docactions">
          <button class="btn sm" onClick={() => openDoc('deployment', 'workflows-as-endpoints')}>How it works</button>
          <button class="btn sm" onClick={() => copy(`${base}/openapi.json`, 'OpenAPI URL copied')}>OpenAPI</button>
          <button class="btn sm" disabled={busy} onClick={load}>{busy ? 'Reading…' : 'Read again'}</button>
        </div>
      </div>
      {error && <div class="card"><div class="in" style="color:var(--err)">{error}</div></div>}
      {!e && !error && <div class="hint">Reading…</div>}
      {e && (
        <>
          <ServeLine />
          {e.problems.length > 0 && (
            <div class="card">
              <h3>Not mounted</h3>
              <div class="in">{e.problems.map((p) => <div class="problem" key={p}>{p}</div>)}</div>
            </div>
          )}
          {routeCount === 0 && (
            <div class="card welcome">
              <h3>No workflow is an endpoint yet</h3>
              <div class="in">
                <p>Every workflow already answers as a <i>run resource</i> at <code>POST /workflows/&lt;name&gt;</code>: the body is the parameters, the answer is the run. An endpoint gives a workflow a path of its own — <code>POST /reviews</code>, <code>GET /orders/:id</code> — binds its parameters from the URL or the body, and answers with its return ports, the way a hand-written handler would.</p>
                <p>Open a workflow, and on its <b>Serve</b> pane press <b>Expose as endpoint</b>. It writes one line, <code>@http POST /&lt;name&gt;</code>, that you can edit like any other annotation.</p>
                {e.candidates.length > 0 && (
                  <div class="cands">
                    {e.candidates.slice(0, 12).map((c) => (
                      <button class="cand" key={`${c.file}|${c.name}`} onClick={() => openServe(c.file, c.name)} title={c.rel}>
                        <span class="ms">{c.gates ? 'pause_circle' : 'conversion_path'}</span><b>{c.name}</b><small>{c.rel}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          {e.workflows.map((w) => <WorkflowCard key={`${w.file}|${w.name}`} w={w} base={base} />)}
          {routeCount > 0 && e.candidates.length > 0 && (
            <div class="card">
              <h3>Not exposed<span class="hint">{e.candidates.length}</span></h3>
              <div class="in hint">Still reachable as run resources. Open one and press <b>Expose as endpoint</b> on its Serve pane: {e.candidates.slice(0, 8).map((c, i) => <span key={`${c.file}|${c.name}`}>{i ? ', ' : ''}<button class="linkish" onClick={() => openServe(c.file, c.name)} title={c.rel}>{c.name}</button></span>)}{e.candidates.length > 8 ? ', …' : ''}.</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const EXPRESS = `import express from 'express';
import { createWorkflowApi } from '@synergenius/flow-weaver/server';

const app = express();
const api = createWorkflowApi({ dir: './workflows', token: process.env.FW_SERVE_TOKEN });
// declared routes, /runs and /openapi.json, all under /api
app.use('/api', api.express());
app.listen(8080);`;

const FASTIFY = `fastify.all('/api/*', async (request, reply) => {
  reply.hijack();
  const handled = await api.handle(request.raw, reply.raw, { basePath: '/api', body: request.body });
  if (!handled) { reply.raw.writeHead(404); reply.raw.end(); }
});`;

const FETCH = `import { createWorkflowApi } from '@synergenius/flow-weaver/server';

const api = createWorkflowApi({ dir: './workflows' });
// Bun, Hono, Deno, Next.js route handlers
export default { fetch: (req: Request) => api.fetch(req) };`;

export function EndpointsSide() {
  const [pane, setPane] = useState<'about' | 'mount' | 'cli'>('about');
  return (
    <>
      <div class="panes">
        <PaneTab icon="info" label="About" on={pane === 'about'} onClick={() => setPane('about')} />
        <PaneTab icon="extension" label="Mount" on={pane === 'mount'} onClick={() => setPane('mount')} />
        <PaneTab icon="terminal" label="CLI" on={pane === 'cli'} onClick={() => setPane('cli')} />
      </div>
      <div class="panebody">
        {pane === 'about' && (
          <div class="card">
            <h3>What a route answers</h3>
            <div class="in">
              <dl class="regkv routes">
                <dt>ran to the end</dt><dd><code>200</code> and the return ports as the body</dd>
                <dt>failure path</dt><dd><code>422</code> and the same body</dd>
                <dt>paused at a gate</dt><dd><code>202</code>, the run, and a <code>Location</code> to poll; the gate is answered here, over the API, or by an agent profile</dd>
                <dt>still running</dt><dd><code>202</code> after 60 s (or <code>Prefer: wait=</code>); <code>Location</code> is <code>/runs/:id/result</code>, which answers in this same shape</dd>
                <dt>mode=async</dt><dd><code>202</code> before the first step runs</dd>
                <dt>failed</dt><dd><code>500</code> with the error and the run id</dd>
              </dl>
            </div>
            <h3>Parameters</h3>
            <div class="in hint">A <code>:name</code> in the path binds that parameter. A <code>GET</code> or <code>DELETE</code> takes the rest from the query string; anything else from the JSON body. A missing or mistyped one is <code>400</code> with the field named.</div>
            <h3>Retries and callbacks</h3>
            <div class="in hint">An <code>Idempotency-Key</code> header makes the same request the same run, however many times it is sent. On a route marked <code>callback</code>, a <code>callbackUrl</code> in the body receives the final response by POST, signed with the server's token.</div>
            <h3>Always there</h3>
            <div class="in hint"><code>POST /workflows/&lt;name&gt;</code> for every workflow, <code>GET /runs/:id</code>, <code>/resolve</code>, <code>/cancel</code>, <code>/events</code>, and <code>/openapi.json</code> describing all of it.</div>
          </div>
        )}
        {pane === 'mount' && (
          <div class="card">
            <h3>In your own server</h3>
            <div class="in hint">The same handler <code>fw serve</code> runs, as a function your server calls. Runs land in the same store, so a gate reached in production is still answered here.</div>
            <div class="in">
              <h5>Express</h5>
              <div class="snippet"><Highlight source={EXPRESS} /><button class="btn sm" onClick={() => copy(EXPRESS)}>copy</button></div>
            </div>
            <div class="in">
              <h5>Fastify</h5>
              <div class="snippet"><Highlight source={FASTIFY} /><button class="btn sm" onClick={() => copy(FASTIFY)}>copy</button></div>
            </div>
            <div class="in">
              <h5>fetch hosts</h5>
              <div class="snippet"><Highlight source={FETCH} /><button class="btn sm" onClick={() => copy(FETCH)}>copy</button></div>
            </div>
            <div class="in hint">Node's own <code>http.createServer(api.node())</code> is what <code>fw serve</code> does. A body your framework already parsed is used as is. <button class="linkish" onClick={() => openDoc('deployment', 'embedding-the-api')}>Options and details</button></div>
            <h3>Before you ship</h3>
            <div class="in">
              <dl class="regkv routes">
                <dt>one instance</dt><dd>the run store is a directory with no locking: one API process per store, on a persistent disk, not serverless</dd>
                <dt>your auth</dt><dd>mount behind your own middleware and leave <code>token</code> unset, or set both</dd>
                <dt>long runs</dt><dd>a request answers <code>202</code> with the result URL after <code>maxWaitMs</code> (60 s); set it under your proxy's timeout</dd>
                <dt>load</dt><dd><code>maxInFlight</code> (32) caps running segments; past it callers get <code>503</code> and <code>Retry-After</code></dd>
                <dt>callbacks</dt><dd>public hosts only by default; name yours with <code>callbacks.hosts</code>; verify the HMAC with your token</dd>
                <dt>shutdown</dt><dd><code>api.close()</code> on SIGTERM; paused runs are safe, a segment in flight is recorded as failed</dd>
              </dl>
              <div class="hint" style="margin-top:8px"><button class="linkish" onClick={() => openDoc('deployment', 'integrating-for-real')}>Integrating for real</button></div>
            </div>
          </div>
        )}
        {pane === 'cli' && <CliPane />}
      </div>
    </>
  );
}
