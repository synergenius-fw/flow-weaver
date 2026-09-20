import { useEffect, useState } from 'preact/hooks';
import { packProject, stageCli, view, ui, type Pack } from '../state';
import { get } from '../api';
import { PackBody } from './PackView';
import { CliPane } from './Cli';
import { PaneTab } from './PaneTab';

interface Check {
  name: string; version: string; parsedFiles: number; parseErrors: string[];
  valid: boolean; issues: Array<{ code: string; severity: 'error' | 'warning'; message: string }>;
  manifest: Pack; hasManifest: boolean; changes: string[];
}

/**
 * The open project as the pack it is.
 *
 * What `fw market pack` would do, shown before it does it: the manifest
 * generated from the sources, the marketplace rules over it, and what
 * writing it would change. Writing and publishing are the commands, one
 * click from the command line.
 */
export function AuthorView() {
  const [check, setCheck] = useState<Check | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => {
    setBusy(true); setError('');
    get<Check>('/api/pack-project/check').then(setCheck).catch((e: Error) => setError(e.message)).finally(() => setBusy(false));
  };
  useEffect(() => { if (view.value.kind === 'author') load(); }, [view.value.kind, packProject.value.name]);
  if (view.value.kind !== 'author') return null;
  const p = packProject.value;
  const errors = check?.issues.filter((i) => i.severity === 'error') ?? [];
  const warnings = check?.issues.filter((i) => i.severity === 'warning') ?? [];
  return (
    <div class="docview packview">
      <div class="dochead">
        <h1>{check?.manifest.namespace ?? p.name}</h1>
        <div class="meta">
          <span class="mono">{p.name}@{check?.version ?? p.version}</span>
          {check && (check.valid
            ? <span class="pill ok">passes the marketplace rules{warnings.length ? `, ${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : ''}</span>
            : <span class="pill err">{errors.length} error{errors.length > 1 ? 's' : ''}</span>)}
          {check && <span class="hint">{check.parsedFiles} file{check.parsedFiles === 1 ? '' : 's'} parsed</span>}
        </div>
        <p class="lede">This project is a pack. What is below is the manifest as <code>fw market pack</code> would write it from the sources, checked against the marketplace rules. Nothing has been written.</p>
        <div class="docactions">
          <button class="btn sm" disabled={busy} onClick={load}>{busy ? 'Checking…' : 'Check again'}</button>
          <button class="btn sm" onClick={() => stageCli('fw market pack')} title="Write flowweaver.manifest.json">▶ fw market pack</button>
          <button class="btn sm" onClick={() => stageCli('fw market publish --dry-run')}>▶ fw market publish --dry-run</button>
        </div>
      </div>
      {error && <div class="card"><div class="in" style="color:var(--err)">{error}</div></div>}
      {check && (
        <>
          {(check.issues.length > 0 || check.parseErrors.length > 0) && (
            <div class="card">
              <h3>Rules<span class="sp" /><span class="hint">{check.issues.length} finding{check.issues.length === 1 ? '' : 's'}</span></h3>
              <div class="in">
                {[...errors, ...warnings].map((i, k) => (
                  <div class="issue" key={k}><span class={`mark ${i.severity === 'warning' ? 'warn' : ''}`} /><div><div>{i.message}</div><div class="h"><code>{i.code}</code></div></div></div>
                ))}
                {check.parseErrors.map((m, k) => <div class="issue" key={`p${k}`}><span class="mark" /><div><div>{m}</div><div class="h"><code>parse</code></div></div></div>)}
              </div>
            </div>
          )}
          <div class="card">
            <h3>{check.hasManifest ? 'Since flowweaver.manifest.json' : 'Manifest'}</h3>
            <div class="in">
              {check.changes.length
                ? <ul class="changes">{check.changes.map((c, k) => <li key={k}>{c}</li>)}</ul>
                : <div class="hint">flowweaver.manifest.json is up to date with the sources.</div>}
            </div>
          </div>
          <PackBody p={check.manifest} />
        </>
      )}
      {!check && !error && <div class="hint">Generating the manifest…</div>}
    </div>
  );
}

/** The right column while the pack is open for authoring: the command line, where pack and publish land. */
export function AuthorSide() {
  void ui;
  return (
    <>
      <div class="panes"><PaneTab icon="terminal" label="CLI" on onClick={() => undefined} /></div>
      <div class="panebody"><CliPane /></div>
    </>
  );
}
