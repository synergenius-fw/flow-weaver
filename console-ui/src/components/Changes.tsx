import { useState, useEffect } from 'preact/hooks';
import { sel, ui, diffView, diffMode, diffRequest, type ParsedWorkflow, type FileHistory, type DiffView, type DiffMode } from '../state';
import { get, q } from '../api';
import { ago } from '../format';
import { Select, type Opt } from './Select';

/**
 * The Changes pane: what differs between two versions of the open
 * workflow, and which two. The picture is the spine, which the pane puts
 * into diff mode. This column names the versions, gives the verdict, and
 * lists the changes so each can be found on the picture.
 *
 * Versions are git refs. The default is the file against its last commit
 * when it has uncommitted changes, else the last commit against the one
 * before it, so the pane opens on something rather than on "identical".
 */

const IMPACT: Record<DiffView['impact'], { word: string; cls: string }> = {
  CRITICAL: { word: 'Critical', cls: 'err' }, BREAKING: { word: 'Breaking', cls: 'err' }, MINOR: { word: 'Minor', cls: 'warn' }, COSMETIC: { word: 'Cosmetic', cls: 'ok' },
};
const MODES: Array<[DiffMode, string]> = [['diff', 'Changes'], ['before', 'Before'], ['after', 'After']];

const refLabel = (ref: string, h: FileHistory | null) => ref === 'worktree' ? 'working tree' : ref === 'HEAD' ? `HEAD${h?.head ? ` (${h.head})` : ''}` : (h?.commits.find((c) => c.sha === ref || c.short === ref)?.short ?? ref);

export function ChangesPane({ w }: { w: ParsedWorkflow }) {
  const key = `${w.file}:${w.name}`;
  const [history, setHistory] = useState<FileHistory | null>(null);
  const [from, setFrom] = useState('HEAD');
  const [to, setTo] = useState('worktree');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const view = diffView.value;

  // The history first: it decides the default comparison.
  useEffect(() => {
    let live = true;
    setHistory(null); setError(''); diffView.value = null;
    get<FileHistory>(`/api/git/history?${q({ file: w.file })}`).then((h) => {
      if (!live) return;
      setHistory(h);
      const asked = diffRequest.value; diffRequest.value = null;
      if (asked) { setFrom(asked.from); setTo(asked.to); return; }
      if (!h.repo) return;
      if (h.dirty || h.commits.length < 2) { setFrom('HEAD'); setTo('worktree'); }
      else { setFrom(h.commits[1].sha); setTo(h.commits[0].sha); }
    }).catch((e) => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [key]);

  // Then the diff, whenever the two ends move.
  useEffect(() => {
    if (!history?.repo) return;
    let live = true;
    setBusy(true); setError('');
    get<DiffView>(`/api/diff?${q({ file: w.file, name: w.name, from, to })}`)
      .then((d) => { if (live) { diffView.value = d; diffMode.value = 'diff'; } })
      .catch((e) => { if (live) { diffView.value = null; setError((e as Error).message); } })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [key, history?.repo, from, to]);

  // Leaving the pane takes the spine out of diff mode; coming back restores it.
  useEffect(() => () => { diffView.value = null; }, []);

  // d / b / a switch the picture while the pane is open and nothing is being typed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'd') diffMode.value = 'diff'; else if (e.key === 'b') diffMode.value = 'before'; else if (e.key === 'a') diffMode.value = 'after';
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pick = (id: string) => { sel.value = id; };
  const options = (current: string, worktree: boolean): Opt[] => {
    const opts: Opt[] = [];
    if (worktree) opts.push({ value: 'worktree', label: <>working tree{history?.dirty ? <span class="opt-ns"> (uncommitted changes)</span> : null}</>, text: 'working tree' });
    opts.push({ value: 'HEAD', label: <>HEAD{history?.head ? <span class="opt-ns"> ({history.head})</span> : null}</>, text: 'HEAD' });
    for (const c of history?.commits ?? []) opts.push({ value: c.sha, label: <><span class="opt-sha">{c.short}</span> <span class="opt-ns">{c.subject.slice(0, 48)}</span></>, text: `${c.short} ${c.subject}` });
    if (![...(history?.commits ?? []).map((c) => c.sha), 'HEAD', 'worktree'].includes(current)) opts.push({ value: current, label: current });
    return opts;
  };

  if (history && !history.repo) {
    return <div class="card"><h3>Changes</h3><div class="in hint">This file is not under git, so there is no earlier version to compare it with.</div></div>;
  }

  return (
    <>
      <div class="card changes">
        <h3>Changes<span class="sp" />
          <div class="seg sm">{MODES.map(([m, t]) => <button key={m} class={diffMode.value === m ? 'on' : ''} disabled={!view?.model} title={`key ${m[0]}`} onClick={() => { diffMode.value = m; }}>{t}</button>)}</div>
        </h3>
        <div class="in refs">
          <label><span>from</span><Select value={from} options={options(from, false)} onChange={setFrom} /></label>
          <span class="arrow">→</span>
          <label><span>to</span><Select value={to} options={options(to, true)} onChange={setTo} /></label>
        </div>
        {error && <div class="in"><div class="verdict err">{error}</div></div>}
        {!error && view && (
          <div class="in">
            {view.identical
              ? <div class="verdict ok">No semantic change between {refLabel(from, history)} and {refLabel(to, history)}.</div>
              : <div class={`verdict ${IMPACT[view.impact].cls}`}><b>{IMPACT[view.impact].word}.</b> {view.reasons[0] ?? ''}{view.reasons.length > 1 && <ul>{view.reasons.slice(1).map((r) => <li key={r}>{r}</li>)}</ul>}</div>}
            {!view.model && !view.identical && <div class="hint" style="margin-top:6px">The two versions cannot be laid out as one picture. The list below still says what changed.</div>}
          </div>
        )}
        {busy && !view && <div class="in hint">comparing…</div>}
        {view && !view.identical && (
          <>
            {view.steps.length > 0 && <div class="in"><h5>Steps</h5><ul class="chg">{view.steps.map((s) => <li key={s.id} class={s.change}><i /><button class="linkish" onClick={() => pick(s.id)}>{s.label}</button><small>{s.change === 'changed' ? s.detail : s.change}{s.change !== 'changed' && s.detail ? `, ${s.detail}` : ''}</small></li>)}</ul></div>}
            {view.wiring.length > 0 && <div class="in"><h5>Wiring</h5><ul class="chg">{view.wiring.map((x, i) => <li key={i} class={x.change}><i /><span>{x.label}</span>{x.kind === 'data' && <small>data</small>}</li>)}</ul></div>}
            {view.contract.length > 0 && <div class="in"><h5>Contract</h5><ul class="chg">{view.contract.map((p, i) => <li key={i} class={p.change}><i /><span>{p.side === 'in' ? 'in' : 'out'} <code>{p.name}</code></span><small>{p.change === 'changed' ? p.detail : `${p.change}${p.detail ? `, ${p.detail}` : ''}`}</small></li>)}</ul></div>}
          </>
        )}
      </div>
      {history && history.commits.length > 0 && (
        <div class="card">
          <h3>History<span class="hint">{history.commits.length}</span><span class="sp" /><span class="hint">click a commit to compare from it</span></h3>
          <div class="in commits">
            {history.dirty && <div class={`commit ${to === 'worktree' ? 'to' : ''}`}><span class="rdot waiting" /><span class="msg">uncommitted changes</span><span class="who">now</span></div>}
            {history.commits.map((c) => {
              const isFrom = from === c.sha || (from === 'HEAD' && c.sha === history.commits[0].sha && history.commits.length && c.short === history.head);
              const isTo = to === c.sha;
              return (
                <button key={c.sha} class={`commit ${isFrom ? 'from' : ''} ${isTo ? 'to' : ''}`} onClick={() => setFrom(c.sha)} title={`${c.sha}\n${c.author}`}>
                  <span class="sha">{c.short}</span><span class="msg">{c.subject}</span><span class="who">{ago(c.at)}</span>
                  <span class="toBtn" title="Compare up to this commit" onClick={(e) => { e.stopPropagation(); setTo(c.sha); }}>to</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
