import { useEffect, useState } from 'preact/hooks';
import { view, project, workflows, runs, services, serviceOf, loadServices, startService, stopService, restartService, saveServiceSettings, openDrawer, agents, loadAgents, endpoints, loadEndpoints, openAgents, openEndpoints, openDoc, stageCli, toast, selectWorkflow, openRun, ui, type ServeSettings, type ServiceView } from '../state';
import { get } from '../api';
import { ago, ms } from '../format';
import { Select } from './Select';

interface Registration { tool: string; file: string; command: string; args: string[]; runs: 'this install' | 'other install' | 'npm latest' | 'unknown'; install?: string }
interface Check { name: string; status: 'pass' | 'warn' | 'fail'; message: string; fix?: string }
interface Report {
  console: { version: string; install: string; project: string; url: string; watching: boolean; runsDir: string };
  mcp: { registrations: Registration[]; running: Array<{ pid: number; client?: string; startedAt: string; install: string; version: string }> };
  doctor: { ok: boolean; checks: Check[]; summary: { pass: number; warn: number; fail: number } };
  registries: Array<{ url: string; scopes: string[]; authenticated: boolean; ok: boolean; status?: number; ms?: number; error?: string; user?: string }>;
  at: string;
}
interface RunRow { id: string; file: string; name: string; status: string; startedAt: number; updatedAt: number; gate?: { node: string; kind: string }; due?: { at: number; action: 'wake' | 'timeout' }; error?: string; origin?: string }

/** A waiting row's one-line reason: who or what it waits for, and until when if the clock is involved. */
function waitingFor(r: RunRow): string {
  const node = r.gate?.node ?? 'a gate';
  if (!r.due) return `at ${node}`;
  const at = new Date(r.due.at);
  const when = at.toDateString() === new Date().toDateString() ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : at.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  return r.due.action === 'wake' ? `sleeping at ${node} until ${when}` : `at ${node}, times out ${when}`;
}

const host = (u: string) => u.replace(/^https?:\/\//, '').replace(/\/$/, '');
const since = (iso: string) => ago(Date.parse(iso));
const copy = async (text: string, what = 'copied') => { try { await navigator.clipboard.writeText(text); toast(what); } catch { toast('could not copy'); } };

function Dot({ ok, warn = false }: { ok: boolean; warn?: boolean }) {
  return <span class={`sdot ${ok ? (warn ? 'warn' : 'ok') : 'bad'}`} />;
}

const STATE_WORD: Record<ServiceView['state'], string> = { stopped: 'not running', starting: 'starting…', running: 'up', exited: 'stopped' };

/** The settings a server is started with, as a short form. Saved on its own; a running server takes them on restart. */
function ServerSettings({ s, running, onDone }: { s: ServeSettings; running: boolean; onDone: () => void }) {
  const [f, setF] = useState<ServeSettings>({ ...s });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<ServeSettings>) => setF((cur) => ({ ...cur, ...patch }));
  const save = async () => {
    setBusy(true); setError('');
    try { await saveServiceSettings('serve', f); toast(running ? 'saved · restart to apply' : 'saved'); onDone(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const check = (k: 'agents' | 'trace' | 'dev' | 'swagger' | 'autoStart', label: string, why: string) => (
    <label class="check" title={why}><input type="checkbox" checked={f[k]} onChange={(e) => set({ [k]: (e.target as HTMLInputElement).checked } as Partial<ServeSettings>)} />{label}</label>
  );
  return (
    <div class="svcsettings">
      <div class="row3">
        <div class="field"><label>port</label><input type="number" min={0} max={65535} value={f.port} onInput={(e) => set({ port: Number((e.target as HTMLInputElement).value) })} /></div>
        <div class="field"><label>host <i>{f.host === '127.0.0.1' || f.host === 'localhost' ? 'this machine only' : 'reachable from elsewhere'}</i></label><input type="text" class="mono" value={f.host} onInput={(e) => set({ host: (e.target as HTMLInputElement).value.trim() })} /></div>
        <div class="field"><label>auth</label><Select value={f.auth} options={[{ value: 'token', label: 'bearer token, generated at start' }, { value: 'open', label: 'open (loopback only)' }]} onChange={(v) => set({ auth: v as 'token' | 'open' })} /></div>
      </div>
      <div class="opts">
        {check('agents', 'agent profiles answer agent gates', 'Off: agent gates wait for a person')}
        {check('trace', 'keep a step trace per run', 'What the run pages show step by step; costs a debug build')}
        {check('swagger', 'Swagger UI at /docs', 'The page and /openapi.json readable without the token')}
        {check('dev', 'dev: stacks in errors, mocks accepted, callbacks to localhost', 'Never in production')}
        {check('autoStart', 'start with the console', 'Bring the server up whenever the console opens this project')}
      </div>
      <div class="formfoot">
        <button class="btn primary sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        <button class="btn ghost sm" onClick={onDone}>Cancel</button>
        {error && <span class="err">{error}</span>}
      </div>
    </div>
  );
}

/** The project's server: whether it runs, where, and the controls. */
export function ServerCard() {
  const s = serviceOf('serve');
  const settings = services.value?.settings.serve;
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState(false);
  const act = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    try { await fn(); } catch (e) { toast((e as Error).message); } finally { setBusy(''); }
  };
  const routes = endpoints.value?.workflows.reduce((n, w) => n + w.routes.length, 0);
  if (!s || !settings) return <div class="card svc"><h3>Server</h3><div class="in hint">Reading…</div></div>;
  const up = s.state === 'running';
  return (
    <div class={`card svc state-${s.state}`}>
      <h3>
        <span class={`sdot ${up ? 'ok' : s.state === 'starting' ? 'warn' : s.error ? 'bad' : ''}`} />
        Server
        <span class="hint">{STATE_WORD[s.state]}{up && s.startedAt ? ` · since ${since(s.startedAt)}` : ''}{up && !s.owned ? ' · started from a terminal' : ''}</span>
        <span class="sp" />
        {s.state !== 'running' && s.state !== 'starting' && <button class="btn primary sm" disabled={!!busy} onClick={() => act('start', () => startService('serve'))}>{busy === 'start' ? 'Starting…' : 'Start'}</button>}
        {(up || s.state === 'starting') && <button class="btn sm" disabled={!!busy} onClick={() => act('stop', () => stopService('serve', s.owned ? undefined : s.pid))}>{busy === 'stop' ? 'Stopping…' : 'Stop'}</button>}
        {up && s.owned && <button class="btn ghost sm" disabled={!!busy} onClick={() => act('restart', () => restartService('serve'))} title="Stop and start again, with the saved settings">Restart</button>}
        {s.owned && <button class="btn ghost sm" onClick={() => openDrawer('serve')} title="What the server prints">Logs{s.lines ? <span class="hint"> {s.lines}</span> : null}</button>}
        <button class={`btn ghost sm ${editing ? 'on' : ''}`} onClick={() => setEditing(!editing)} title="Port, host, token, options"><span class="ms" style="font-size:15px">tune</span></button>
      </h3>
      {s.error && s.state === 'exited' && <div class="in err">{s.error} <button class="linkish" onClick={() => openDrawer('serve')}>logs</button></div>}
      {up && (
        <div class="in svcline">
          <a class="mono" href={s.url} target="_blank" rel="noreferrer">{s.url}</a>
          <button class="linkish" onClick={() => copy(s.url ?? '')}>copy</button>
          {s.token && <span class="hint">· token <code title={s.token}>{s.token.slice(0, 6)}…</code> <button class="linkish" onClick={() => copy(s.token!, 'token copied')}>copy</button></span>}
          {!s.token && s.owned && <span class="hint">· open, no token</span>}
          {s.activity && <span class="hint">· {s.activity.count} request{s.activity.count === 1 ? '' : 's'}{s.activity.last ? `, last ${s.activity.last} ${since(s.activity.at)}` : ''}</span>}
        </div>
      )}
      {!up && s.state !== 'starting' && (
        <div class="in hint">
          Serves this project's workflows over HTTP on <code>{settings.host}:{settings.port}</code>{settings.auth === 'token' ? ', guarded by a token generated at start' : ', open'}.
          {routes !== undefined ? <> {routes ? <>{routes} declared route{routes === 1 ? '' : 's'}</> : 'No route declared yet'}, plus a run resource for every workflow. <button class="linkish" onClick={openEndpoints}>Endpoints</button>.</> : null}
          {' '}Or from a terminal: <code>fw serve --trace</code>.
        </div>
      )}
      {s.others.length > 0 && (
        <div class="in">
          <h5>Also running for this project</h5>
          {s.others.map((o) => (
            <div class="svcother" key={o.pid}>
              <span class="mono">{o.url ?? `pid ${o.pid}`}</span><span class="hint"> · pid {o.pid} · v{o.version} · since {since(o.startedAt)}</span>
              <span class="sp" /><button class="btn ghost sm" onClick={() => act(`stop-${o.pid}`, () => stopService('serve', o.pid))}>Stop</button>
            </div>
          ))}
        </div>
      )}
      {editing && <div class="in"><ServerSettings s={settings} running={up && s.owned} onDone={() => setEditing(false)} /></div>}
    </div>
  );
}

/** Recompile on save: a switch, and its output in the drawer. */
function WatchCard() {
  const s = serviceOf('watch');
  const auto = services.value?.settings.watch.autoStart ?? false;
  const [busy, setBusy] = useState(false);
  if (!s) return null;
  const on = s.state === 'running' || s.state === 'starting';
  const flip = async () => {
    setBusy(true);
    try { if (on) await stopService('watch'); else await startService('watch'); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div class="card svc small">
      <h3><span class={`sdot ${on ? 'ok' : s.error ? 'bad' : ''}`} />Recompile on save<span class="hint">{on ? 'watching' : s.error ? 'stopped' : 'off'}</span><span class="sp" />
        <button class={`btn sm ${on ? '' : 'primary'}`} disabled={busy} onClick={flip}>{on ? 'Stop' : 'Start'}</button>
        {s.owned && <button class="btn ghost sm" onClick={() => openDrawer('watch')}>Logs</button>}
      </h3>
      <div class="in hint">
        <code>fw watch</code> recompiles a workflow file in place each time it is saved, so the compiled body never lags the annotations.
        {' '}<label class="check inline"><input type="checkbox" checked={auto} onChange={(e) => saveServiceSettings('watch', { autoStart: (e.target as HTMLInputElement).checked }).catch((err: Error) => toast(err.message))} />start with the console</label>
      </div>
      {s.error && <div class="in err">{s.error}</div>}
    </div>
  );
}

/**
 * The project's front door: its server with the controls on it, then a
 * card per concern with the number that matters and the way in, then the
 * environment as fw doctor sees it, the editors that reach the MCP server,
 * and the registries.
 */
export function ProjectView() {
  const [r, setR] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => {
    setBusy(true); setError('');
    Promise.all([
      get<Report>('/api/status').then(setR),
      loadServices(), loadAgents().catch(() => undefined), loadEndpoints().catch(() => undefined),
    ]).catch((e: Error) => setError(e.message)).finally(() => setBusy(false));
  };
  useEffect(() => { if (view.value.kind === 'project') load(); }, [view.value.kind]);
  if (view.value.kind !== 'project') return null;
  const waiting = workflows.value.reduce((n, w) => n + w.waiting, 0);
  const errors = workflows.value.reduce((n, w) => n + w.errors, 0);
  const a = agents.value;
  const ready = a?.agents.filter((p) => p.ready).length ?? 0;
  const e = endpoints.value;
  const routes = e?.workflows.reduce((n, w) => n + w.routes.length, 0) ?? 0;
  void runs.value;
  return (
    <div class="docview projectview">
      <div class="dochead">
        <h1>{project.value.name || 'Project'}</h1>
        <p class="lede">{workflows.value.length} workflow{workflows.value.length === 1 ? '' : 's'}{errors ? <>, <span class="bad">{errors} with errors</span></> : ''}{waiting ? <>, <b>{waiting} waiting at a gate</b></> : ''}. Its server, endpoints, agents and environment, and the controls for them.</p>
        <div class="docactions">
          <button class="btn sm" disabled={busy} onClick={load}>{busy ? 'Checking…' : 'Check again'}</button>
          <button class="btn sm" onClick={() => stageCli('fw doctor')}>▶ fw doctor</button>
          <button class="btn sm" onClick={() => openDoc('console', 'the-project-page')}>About this page</button>
          {r && <span class="hint">as of {since(r.at)}</span>}
        </div>
      </div>
      {error && <div class="card"><div class="in" style="color:var(--err)">{error}</div></div>}

      <ServerCard />

      <div class="cards2">
        <button class="card summary" onClick={openEndpoints}>
          <h3><span class="ms">api</span>Endpoints<span class="sp" /><span class="ms go">chevron_right</span></h3>
          <div class="in">
            <div class="big">{e ? routes : '…'}</div>
            <div class="hint">{e ? (routes ? `declared route${routes === 1 ? '' : 's'} across ${e.workflows.length} workflow${e.workflows.length === 1 ? '' : 's'}${e.problems.length ? `, ${e.problems.length} not mounted` : ''}` : `no route yet; ${e.candidates.length} workflow${e.candidates.length === 1 ? '' : 's'} to expose`) : 'reading'}</div>
          </div>
        </button>
        <button class="card summary" onClick={openAgents}>
          <h3><span class="ms">smart_toy</span>Agents<span class="sp" /><span class="ms go">chevron_right</span></h3>
          <div class="in">
            <div class="big">{a ? `${ready}/${a.agents.length}` : '…'}</div>
            <div class="hint">{a ? (a.agents.length ? `profile${a.agents.length === 1 ? '' : 's'} ready${a.default ? `, default ${a.default}` : ', no default'}` : 'no profile; agent gates wait for a person') : 'reading'}</div>
          </div>
        </button>
        <WatchCard />
        <div class="card summary static">
          <h3><span class="ms">extension</span>Editors<span class="sp" /><button class="linkish" onClick={() => stageCli('fw mcp-setup')}>▶ fw mcp-setup</button></h3>
          <div class="in">
            {r ? (r.mcp.registrations.length ? r.mcp.registrations.map((g) => (
              <div class="regrow" key={g.tool + g.file}><Dot ok={g.runs !== 'other install'} warn={g.runs !== 'this install'} /><b>{g.tool}</b><span class="hint">{g.runs === 'npm latest' ? 'npm latest' : g.runs}</span></div>
            )) : <div class="hint">No editor has the MCP server registered for this project.</div>) : <div class="hint">reading</div>}
            {r && r.mcp.running.length > 0 && <div class="hint" style="margin-top:6px">{r.mcp.running.length} MCP server{r.mcp.running.length === 1 ? '' : 's'} running now{r.mcp.running[0].client ? ` for ${r.mcp.running[0].client}` : ''}.</div>}
          </div>
        </div>
      </div>

      {r && (
        <>
          <div class="card">
            <h3>Environment<span class="sp" /><span class={`pill ${r.doctor.summary.fail ? 'err' : r.doctor.summary.warn ? 'warn' : 'ok'}`}>{r.doctor.summary.fail ? `${r.doctor.summary.fail} failing` : r.doctor.summary.warn ? `${r.doctor.summary.warn} warning${r.doctor.summary.warn > 1 ? 's' : ''}` : 'all checks pass'}</span></h3>
            <div class="in">
              {r.doctor.checks.map((c) => (
                <div class="check-row" key={c.name}>
                  <Dot ok={c.status !== 'fail'} warn={c.status === 'warn'} />
                  <div><b>{c.name}</b><div class="hint">{c.message}</div>{c.fix && <div class="fix">{c.fix}</div>}</div>
                </div>
              ))}
            </div>
          </div>
          <div class="card">
            <h3>This console</h3>
            <div class="in"><div class="kv">
              <span class="k">version</span><span class="val static">{r.console.version}</span>
              <span class="k">install</span><span class="val static mono">{r.console.install}</span>
              <span class="k">project</span><span class="val static mono">{r.console.project}</span>
              <span class="k">listening</span><span class="val static mono">{r.console.url}{r.console.watching ? ' · watching files' : ' · not watching'}</span>
              <span class="k">run store</span><span class="val static mono">{r.console.runsDir}</span>
            </div></div>
          </div>
          <div class="card">
            <h3>Registries</h3>
            <div class="in">{r.registries.map((g) => (
              <div class="check-row" key={g.url}>
                <Dot ok={g.ok} />
                <div>
                  <b>{host(g.url)}</b>{g.scopes.length ? <span class="hint"> · {g.scopes.join(' ')}</span> : <span class="hint"> · default</span>}
                  <div class="hint">{g.ok ? (g.user ? `signed in as ${g.user}` : g.authenticated ? 'answers · token not accepted' : 'answers · no token') : (g.error ?? `status ${g.status}`)}{g.ms != null ? ` · ${ms(g.ms)}` : ''}</div>
                </div>
              </div>
            ))}</div>
          </div>
        </>
      )}
    </div>
  );
}

/** What needs a person: runs waiting at a gate anywhere in the project, and the latest failures. */
export function ProjectSide() {
  const [rows, setRows] = useState<RunRow[] | null>(null);
  const load = () => { get<RunRow[]>('/api/runs').then(setRows).catch(() => setRows([])); };
  useEffect(() => { load(); }, [runs.value, workflows.value]);
  const waiting = (rows ?? []).filter((r) => r.status === 'waiting');
  const failed = (rows ?? []).filter((r) => r.status === 'failed').slice(0, 5);
  const open = async (r: RunRow) => { await selectWorkflow(r.file, r.name); ui.side.value = 'run'; openRun(r.id); };
  const Row = ({ r, what }: { r: RunRow; what: string }) => (
    <button class="runrow" onClick={() => open(r)}>
      <span class={`rdot ${r.status}`} />
      <span class="what">{r.name} · {what}{r.origin && r.origin !== 'console' && <small class="origin">{r.origin}</small>}</span>
      <span class="right">{ago(r.updatedAt)}</span>
    </button>
  );
  return (
    <>
      <div class="panes"><span class="panetitle">Needs you</span></div>
      <div class="panebody">
        <div class="card">
          <h3>Waiting at a gate<span class="hint">{waiting.length}</span></h3>
          <div class="in runlist">
            {rows === null && <div class="hint" style="padding:4px 9px">reading</div>}
            {waiting.map((r) => <Row key={r.id} r={r} what={waitingFor(r)} />)}
            {rows && !waiting.length && <div class="hint" style="padding:4px 9px">nothing is waiting for a person</div>}
          </div>
        </div>
        {failed.length > 0 && (
          <div class="card">
            <h3>Failed lately<span class="hint">{failed.length}</span></h3>
            <div class="in runlist">{failed.map((r) => <Row key={r.id} r={r} what={r.error ? r.error.slice(0, 60) : 'failed'} />)}</div>
          </div>
        )}
        <div class="card">
          <h3>Where things live</h3>
          <div class="in hint">Runs made here, over the server and by an assistant are the same runs. A gate reached anywhere is answered here. <button class="linkish" onClick={() => openDoc('console')}>The console</button> · <button class="linkish" onClick={() => openDoc('deployment', 'http-serve-mode')}>The server</button></div>
        </div>
      </div>
    </>
  );
}
