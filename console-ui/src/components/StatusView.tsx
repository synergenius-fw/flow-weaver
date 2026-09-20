import { useEffect, useState } from 'preact/hooks';
import { view, stageCli, openDoc, runs, workflows } from '../state';
import { get } from '../api';
import { ago, ms } from '../format';
import { CliPane } from './Cli';
import { PaneTab } from './PaneTab';

interface Service { kind: string; pid: number; version: string; install: string; cwd: string; project?: string; url?: string; transport?: string; client?: string; startedAt: string; lastActivityAt: string; activity?: string; activityCount: number }
interface Registration { tool: string; file: string; command: string; args: string[]; runs: 'this install' | 'other install' | 'npm latest' | 'unknown'; install?: string }
interface Check { name: string; status: 'pass' | 'warn' | 'fail'; message: string; fix?: string }
interface Report {
  console: { version: string; install: string; project: string; url: string; watching: boolean; runsDir: string };
  services: Service[];
  mcp: { registrations: Registration[]; running: Service[] };
  doctor: { ok: boolean; checks: Check[]; summary: { pass: number; warn: number; fail: number }; server: { version: string; installPath: string } };
  http: Array<{ service: Service; probe: { ok: boolean; status?: number; ms?: number; error?: string } }>;
  registries: Array<{ url: string; scopes: string[]; authenticated: boolean; ok: boolean; status?: number; ms?: number; error?: string; user?: string }>;
  at: string;
}

const host = (u: string) => u.replace(/^https?:\/\//, '').replace(/\/$/, '');
const since = (iso: string) => ago(Date.parse(iso));

function Dot({ ok, warn = false }: { ok: boolean; warn?: boolean }) {
  return <span class={`sdot ${ok ? (warn ? 'warn' : 'ok') : 'bad'}`} />;
}

/**
 * Everything around the project, on one page: the fw processes alive and
 * what they are doing, which editors have the MCP server and from which
 * install, the environment as fw doctor sees it, and the registries. Read
 * once on open, again on request.
 */
export function StatusView() {
  const [r, setR] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => {
    setBusy(true); setError('');
    get<Report>('/api/status').then(setR).catch((e: Error) => setError(e.message)).finally(() => setBusy(false));
  };
  useEffect(() => { if (view.value.kind === 'status') load(); }, [view.value.kind]);
  if (view.value.kind !== 'status') return null;
  const waiting = workflows.value.reduce((n, w) => n + w.waiting, 0);
  void runs.value;
  return (
    <div class="docview statusview">
      <div class="dochead">
        <h1>Status</h1>
        <p class="lede">The services around this project, the editors that reach them, and the environment they run in.</p>
        <div class="docactions">
          <button class="btn sm" disabled={busy} onClick={load}>{busy ? 'Checking…' : 'Check again'}</button>
          <button class="btn sm" onClick={() => stageCli('fw doctor')}>▶ fw doctor</button>
          <button class="btn sm" onClick={() => stageCli('fw mcp-setup')}>▶ fw mcp-setup</button>
          {r && <span class="hint">as of {since(r.at)}</span>}
        </div>
      </div>
      {error && <div class="card"><div class="in" style="color:var(--err)">{error}</div></div>}
      {!r && !error && <div class="hint">Asking around…</div>}
      {r && (
        <>
          <div class="card">
            <h3>This console</h3>
            <div class="in"><div class="kv">
              <span class="k">version</span><span class="val static">{r.console.version}</span>
              <span class="k">install</span><span class="val static mono">{r.console.install}</span>
              <span class="k">project</span><span class="val static mono">{r.console.project}</span>
              <span class="k">listening</span><span class="val static mono">{r.console.url}{r.console.watching ? ' · watching files' : ' · not watching'}</span>
              <span class="k">run store</span><span class="val static mono">{r.console.runsDir}{waiting ? ` · ${waiting} waiting at a gate` : ''}</span>
            </div></div>
          </div>

          <div class="card">
            <h3>Running now<span class="sp" /><span class="hint">{r.services.length}</span></h3>
            <div class="in">
              {r.services.length ? (
                <div class="tablewrap"><table class="statustable">
                  <thead><tr><th>Service</th><th>Where</th><th>Install</th><th>Activity</th></tr></thead>
                  <tbody>{r.services.map((s) => (
                    <tr key={`${s.kind}-${s.pid}`}>
                      <td><b>{s.kind}</b><div class="hint">pid {s.pid} · up {since(s.startedAt).replace(' ago', '')}{s.client ? ` · for ${s.client}` : ''}</div></td>
                      <td class="mono">{s.url ?? s.transport ?? ''}{s.project ? <div class="hint">{s.project}</div> : null}</td>
                      <td><Dot ok warn={s.install !== r.console.install} /> <span class="mono">{s.install === r.console.install ? 'this install' : s.install}</span><div class="hint">v{s.version}</div></td>
                      <td>{s.activity ? <><code>{s.activity}</code> <span class="hint">{since(s.lastActivityAt)} · {s.activityCount} call{s.activityCount === 1 ? '' : 's'}</span></> : <span class="hint">started {since(s.startedAt)}</span>}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              ) : <div class="hint">No fw process has announced itself. An MCP server started by an editor appears here once it is running this version.</div>}
            </div>
          </div>

          <div class="card">
            <h3>MCP<span class="sp" /><button class="linkish" onClick={() => openDoc('mcp-tools')}>about</button></h3>
            <div class="in">
              <h5>Registered with editors</h5>
              {r.mcp.registrations.length ? (
                <div class="tablewrap"><table class="statustable">
                  <thead><tr><th>Editor</th><th>Runs</th><th>Command</th></tr></thead>
                  <tbody>{r.mcp.registrations.map((g) => (
                    <tr key={g.tool + g.file}>
                      <td><b>{g.tool}</b><div class="hint mono">{g.file}</div></td>
                      <td>
                        <Dot ok={g.runs !== 'other install'} warn={g.runs !== 'this install'} />{' '}
                        {g.runs === 'npm latest' ? <span title="npx resolves the newest published version each start; edits in a checkout do not reach it">npm latest</span> : g.runs}
                        {g.install && g.runs === 'other install' && <div class="hint mono">{g.install}</div>}
                      </td>
                      <td class="mono">{g.command} {g.args.join(' ')}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              ) : <div class="hint">No editor has the Flow Weaver MCP server registered for this project. <button class="linkish" onClick={() => stageCli('fw mcp-setup')}>▶ fw mcp-setup</button> registers it.</div>}
              <div class="hint" style="margin-top:8px">A server speaks stdio to the editor that started it, so what is known about a running one is what it reports about itself, above.</div>
            </div>
          </div>

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

          {r.http.length > 0 && (
            <div class="card">
              <h3>HTTP</h3>
              <div class="in">{r.http.map(({ service, probe }) => (
                <div class="check-row" key={service.pid}>
                  <Dot ok={probe.ok} />
                  <div><b>fw serve</b> <span class="mono">{service.url}</span><div class="hint">{probe.ok ? `answers in ${ms(probe.ms)}` : probe.error ?? `status ${probe.status}`}</div></div>
                </div>
              ))}</div>
            </div>
          )}

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

export function StatusSide() {
  return (
    <>
      <div class="panes"><PaneTab icon="terminal" label="CLI" on onClick={() => undefined} /></div>
      <div class="panebody"><CliPane /></div>
    </>
  );
}
