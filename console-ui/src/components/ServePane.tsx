import { useEffect, useMemo, useState } from 'preact/hooks';
import { serveInfo, loadServe, toast, agents, loadAgents, flatSteps, openAgents, openDoc, openEndpoints, openOverview, openDrawer, startService, stopService, setHttpRoutes, type ParsedWorkflow, type HttpRoute, type HttpMethod } from '../state';
import { store } from '../api';
import { ago } from '../format';
import { curlFor, defaultPath, pathParams, answerLine } from '../http';
import { Method, RouteFlags } from './EndpointsView';
import { Select } from './Select';

const METHODS: HttpMethod[] = ['POST', 'GET', 'PUT', 'PATCH', 'DELETE'];
const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast('copied'); } catch { toast('could not copy'); } };

/**
 * The routes, as a small editor: a method, a path, and three switches per
 * line. Saving rewrites the workflow's `@http` lines and nothing else.
 */
function RouteEditor({ w, onDone }: { w: ParsedWorkflow; onDone: () => void }) {
  const [rows, setRows] = useState<HttpRoute[]>(w.http.length ? w.http.map((r) => ({ ...r })) : [{ method: 'POST', path: defaultPath(w.name) }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const paramNames = new Set(w.params.map((p) => p.name));
  const problems = rows.map((r) => {
    if (!r.path.startsWith('/') || /\s/.test(r.path)) return 'a path starts with / and has no spaces';
    const unknown = pathParams(r).filter((p) => !paramNames.has(p));
    if (unknown.length) return `:${unknown[0]} is not a parameter of this workflow${paramNames.size ? ` (${[...paramNames].join(', ')})` : ''}`;
    if (rows.some((o) => o !== r && o.method === r.method && o.path === r.path)) return 'listed twice';
    return '';
  });
  const set = (i: number, patch: Partial<HttpRoute>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = async () => {
    setBusy(true); setError('');
    try { await setHttpRoutes(w.file, w.name, rows); toast(rows.length ? 'routes written' : 'routes removed'); onDone(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div class="routeeditor">
      {rows.map((r, i) => (
        <div class={`erow ${problems[i] ? 'bad' : ''}`} key={i}>
          <div class="line">
            <Select class="method" value={r.method} options={METHODS.map((m) => ({ value: m, label: m }))} onChange={(m) => set(i, { method: m as HttpMethod })} />
            <input type="text" class="mono" value={r.path} placeholder="/path/:param" spellcheck={false} onInput={(e) => set(i, { path: (e.target as HTMLInputElement).value })} />
            <button class="btn ghost sm" title="Remove this route" onClick={() => setRows(rows.filter((_, j) => j !== i))}><span class="ms" style="font-size:15px">close</span></button>
          </div>
          <div class="opts">
            <label class="check"><input type="checkbox" checked={r.mode === 'async'} onChange={(e) => set(i, { mode: (e.target as HTMLInputElement).checked ? 'async' : undefined })} />answer at once, follow the run</label>
            <label class="check"><input type="checkbox" checked={r.auth === 'none'} onChange={(e) => set(i, { auth: (e.target as HTMLInputElement).checked ? 'none' : undefined })} />no token needed</label>
            <label class="check"><input type="checkbox" checked={!!r.callback} onChange={(e) => set(i, { callback: (e.target as HTMLInputElement).checked || undefined })} />accept a callback URL</label>
          </div>
          {problems[i] && <div class="ferr">{problems[i]}</div>}
        </div>
      ))}
      <div class="formfoot">
        <button class="btn primary sm" disabled={busy || problems.some(Boolean)} onClick={save}>{busy ? 'Writing…' : rows.length ? (w.http.length ? 'Save routes' : 'Expose') : 'Remove all routes'}</button>
        <button class="btn ghost sm" onClick={() => setRows([...rows, { method: 'GET', path: `${defaultPath(w.name)}${w.params[0] ? `/:${w.params[0].name}` : ''}` }])}>+ route</button>
        <button class="btn ghost sm" onClick={onDone}>Cancel</button>
        {error && <span class="err">{error}</span>}
      </div>
      <div class="hint" style="margin-top:6px">A <code>:name</code> in the path binds that parameter{w.params.length ? ` (${w.params.map((p) => p.name).join(', ')})` : ''}. GET and DELETE take the rest from the query, the others from the body. Written as <code>@http</code> lines on the workflow.</div>
    </div>
  );
}

/**
 * The open workflow as an HTTP endpoint.
 *
 * Its declared routes with the request for each, the parameters coming from
 * the run form; one action to expose a workflow that has none; whether
 * `fw serve` is up for the project; and the run resource every workflow
 * has regardless. Runs made over the API are the console's runs.
 */
export function ServePane({ w }: { w: ParsedWorkflow }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [showResource, setShowResource] = useState(false);
  const load = () => { setBusy(true); setError(''); loadServe().catch((e: Error) => setError(e.message)).finally(() => setBusy(false)); };
  useEffect(() => { load(); setEditing(false); if (!agents.value) void loadAgents().catch(() => undefined); }, [w.file, w.name]);
  const s = serveInfo.value;
  const url = s?.running?.url ?? 'http://127.0.0.1:3000';
  const params = store.get<Record<string, unknown>>(`params:${w.file}:${w.name}`, {}) ?? {};
  const gates = useMemo(() => flatSteps(w.model.steps).filter((st) => st.kind === 'pause'), [w]);
  const agentGates = gates.filter((g) => g.gate === 'agent');
  const profiles = agents.value;
  const ready = profiles?.agents.filter((p) => p.ready).length ?? 0;
  const routes = w.http;
  const token = s?.running?.token ?? null;
  // The request as typed: with the running server's own token when this
  // console started it, else the variable a terminal would have.
  const withToken = (text: string) => (token ? text.replace('$FW_SERVE_TOKEN', token) : text);
  const legacy = curlFor(url, w.name, null, w.params, params);
  const [acting, setActing] = useState(false);
  const act = async (fn: () => Promise<void>) => { setActing(true); try { await fn(); } catch (e) { toast((e as Error).message); } finally { setActing(false); } };
  return (
    <>
      <div class="card serve">
        <h3>Serve<span class="sp" />
          {s?.running
            ? <span class="hint"><span class="sdot ok" /> up since {ago(Date.parse(s.running.startedAt))}</span>
            : s?.state === 'starting' ? <span class="hint"><span class="sdot warn" /> starting…</span>
            : <span class="hint"><span class="sdot" /> not running</span>}
          {s?.running
            ? <button class="btn ghost sm" disabled={acting} onClick={() => act(() => stopService('serve', s.running!.owned ? undefined : s.running!.pid))}>Stop</button>
            : s?.state !== 'starting' && <button class="btn primary sm" disabled={acting} onClick={() => act(() => startService('serve'))}>{acting ? 'Starting…' : 'Start'}</button>}
          {(s?.running?.owned || s?.state === 'starting') && <button class="btn ghost sm" onClick={() => openDrawer('serve')} title="What the server prints">Logs</button>}
          <button class="btn ghost sm" disabled={busy} onClick={load} title="Look again"><span class="ms" style="font-size:15px">refresh</span></button>
        </h3>
        {error && <div class="in err">{error}</div>}
        {!s?.running && s?.state !== 'starting' && (
          <div class="in hint">
            Start serves every workflow in the project on loopback with a generated token. Port, host and options are on the <button class="linkish" onClick={openOverview}>Project page</button>. From a terminal: <code>{s?.command ?? 'fw serve --trace'}</code>.
          </div>
        )}

        <div class="in">
          <h5>Routes<span class="sp" />{routes.length > 0 && !editing && <button class="btn ghost sm" onClick={() => setEditing(true)}>Edit</button>}</h5>
          {editing && <RouteEditor w={w} onDone={() => setEditing(false)} />}
          {!editing && routes.length === 0 && (
            <div class="expose">
              <div class="hint">Not an endpoint yet. It still answers as a run resource (below). Exposing it gives it a path of its own, its parameters bound from the URL or the body, and its return ports as the answer.</div>
              <div class="formfoot"><button class="btn primary sm" onClick={() => setEditing(true)}>Expose as endpoint</button><span class="hint mono">@http POST {defaultPath(w.name)}</span></div>
            </div>
          )}
          {!editing && routes.map((r) => (
            <div class="declared" key={`${r.method} ${r.path}`}>
              <div class="endpoint mono"><Method m={r.method} /> <span class="path">{url}{r.path}</span><span class="sp" /><RouteFlags r={r} /></div>
              <div class="hint" style="margin:4px 0 6px">
                Answers {answerLine(r, gates.length)}.
                {agentGates.length ? <> The {agentGates.length === 1 ? 'agent gate is' : `${agentGates.length} agent gates are`} answered by {ready ? <>a profile (<button class="linkish" onClick={openAgents}>{ready} ready</button>)</> : <><button class="linkish" onClick={openAgents}>no profile is ready</button>, so they wait for a person or an assistant</>}.</> : null}
              </div>
              <pre class="curl mono">{curlFor(url, w.name, r, w.params, params)}</pre>
              <div class="formfoot"><button class="btn sm" onClick={() => copy(withToken(curlFor(url, w.name, r, w.params, params)))}>{token && r.auth !== 'none' ? 'copy request with token' : 'copy request'}</button><span class="hint">parameters come from the run form</span></div>
            </div>
          ))}
        </div>

        <div class="in">
          <h5>
            <button class="linkish" onClick={() => setShowResource(!showResource)}>{showResource ? '▾' : '▸'} The run resource</button>
            <span class="hint" style="margin-left:6px">always there</span>
          </h5>
          {showResource && (
            <>
              <div class="endpoint mono"><Method m="POST" /> <span class="path">{url}/workflows/{w.name}</span></div>
              <div class="hint" style="margin:4px 0 6px">The parameters as the body, the run as the answer: <code>200</code> with <code>result</code>, or <code>202</code> with a <code>runId</code> and the gate.</div>
              <pre class="curl mono">{legacy}</pre>
              <div class="formfoot"><button class="btn sm" onClick={() => copy(withToken(legacy))}>{token ? 'copy request with token' : 'copy request'}</button></div>
            </>
          )}
        </div>

        <div class="in">
          <h5>Then</h5>
          <dl class="regkv routes">
            <dt class="mono">GET /runs/:id</dt><dd>the run: status, gate, agent, result</dd>
            <dt class="mono">POST /runs/:id/resolve</dt><dd><code>{'{ "answer": … }'}</code> or <code>{'{ "reject": "why" }'}</code></dd>
            <dt class="mono">GET /runs/:id/events</dt><dd>server-sent events: the run, each step, what the agent says</dd>
            <dt class="mono">POST /runs/:id/cancel</dt><dd>stop it</dd>
            <dt class="mono">GET /openapi.json</dt><dd>all of it, as OpenAPI</dd>
          </dl>
          <div class="hint" style="margin-top:8px">Runs made here and over the API are the same runs: a gate reached by a caller can be answered on this page. <button class="linkish" onClick={openEndpoints}>All endpoints</button>, or <button class="linkish" onClick={() => openDoc('deployment', 'workflows-as-endpoints')}>how routes answer</button></div>
        </div>
      </div>
    </>
  );
}
