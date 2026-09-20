import { wf, run, runActive, errorCount, ui, cancelRun, runDuration, now, isParsed, isNarrow, view, doc, guide, packs, closeDoc, openDoc } from '../state';
import { ms } from '../format';
import { useEffect, useRef, useState } from 'preact/hooks';
import { q } from '../api';
import { Tip } from './Tip';

/**
 * The workflow as something to hand over: a brief for people who will not
 * open the code, and the diagram. Each is one self-contained file, built by
 * the server from the current parse.
 */
function ShareMenu({ file, name }: { file: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', away); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('keydown', key); };
  }, [open]);
  const href = (kind: string) => `/api/artifact?${q({ file, name, kind, theme: dark ? 'dark' : 'light' })}`;
  const items: Array<{ kind: string; icon: string; label: string; what: string }> = [
    { kind: 'brief', icon: 'description', label: 'Brief', what: 'The workflow as a page for a PM or an architect: the graph to click through, what goes in and out, where people are needed.' },
    { kind: 'pdf', icon: 'picture_as_pdf', label: 'Brief (PDF)', what: 'A one-page overview — the graph beside what goes in, what comes out, the pauses and the failure arms — then every step in detail. Printed by the browser on this machine.' },
    { kind: 'svg', icon: 'image', label: 'Diagram (SVG)', what: 'The spine as drawn here, as a vector image for a slide or a document.' },
  ];
  return (
    <div class="share" ref={ref}>
      <Tip label="Download as a document or a diagram" side="bottom"><button class={`btn sm ${open ? 'on' : ''}`} onClick={() => setOpen(!open)}><span class="ms" style="font-size:15px">ios_share</span> Share</button></Tip>
      {open && (
        <div class="sharemenu">
          {items.map((it) => (
            <a key={it.kind} class="shareitem" href={href(it.kind)} download onClick={() => setOpen(false)}>
              <span class="ms">{it.icon}</span>
              <span class="t"><b>{it.label}</b><small>{it.what}</small></span>
              <span class="ms dl">download</span>
            </a>
          ))}
          <label class="check sharetheme"><input type="checkbox" checked={dark} onChange={(e) => setDark((e.target as HTMLInputElement).checked)} /><span>Dark theme</span></label>
        </div>
      )}
    </div>
  );
}

export function Header() {
  const w = wf.value;
  /* Only where the rail is an overlay: elsewhere it is always on screen,
     so a button to reveal it is a control that does nothing. */
  const menu = isNarrow.value && (
    <button class="btn ghost sm menu-btn" onClick={() => { ui.railOpen.value = !ui.railOpen.value; }} title="Workflows" aria-label="Workflows">☰</button>
  );

  // A topic open in the centre: a slim bar saying where you are and the
  // way back to the workflow, which is still loaded behind it.
  if (view.value.kind === 'doc') {
    const slug = view.value.slug;
    const group = guide.value.find((g) => g.topics.some((t) => t.slug === slug));
    return (
      <div class="head docbar">
        <div class="grow"><div class="meta">{menu}<span>Guide</span>{group && <><span class="sep">›</span><span>{group.title}</span></>}{doc.value && <><span class="sep">›</span><span class="here">{doc.value.name}</span></>}</div></div>
        <div class="actions">
          {w && <button class="btn sm" onClick={closeDoc}>← {w.name}</button>}
        </div>
      </div>
    );
  }

  if (view.value.kind === 'status') {
    return (
      <div class="head docbar">
        <div class="grow"><div class="meta">{menu}<span class="here">Status</span></div></div>
        <div class="actions">{w && <button class="btn sm" onClick={closeDoc}>← {w.name}</button>}</div>
      </div>
    );
  }

  if (view.value.kind === 'author') {
    return (
      <div class="head docbar">
        <div class="grow"><div class="meta">{menu}<span>Packs</span><span class="sep">›</span><span class="here">This pack</span></div></div>
        <div class="actions">{w && <button class="btn sm" onClick={closeDoc}>← {w.name}</button>}</div>
      </div>
    );
  }

  if (view.value.kind === 'market') {
    return (
      <div class="head docbar">
        <div class="grow"><div class="meta">{menu}<span>Packs</span><span class="sep">›</span><span class="here">Marketplace</span></div></div>
        <div class="actions">{w && <button class="btn sm" onClick={closeDoc}>← {w.name}</button>}</div>
      </div>
    );
  }

  if (view.value.kind === 'pack') {
    const name = view.value.name;
    const p = packs.value.find((x) => x.name === name);
    return (
      <div class="head docbar">
        <div class="grow"><div class="meta">{menu}<span>Packs</span><span class="sep">›</span><span class="here">{p?.namespace ?? name}</span></div></div>
        <div class="actions">
          {w && <button class="btn sm" onClick={closeDoc}>← {w.name}</button>}
        </div>
      </div>
    );
  }

  if (!w) return <div class="hint" style="padding:40px 0">Pick a workflow.</div>;

  const title = (
    <h1>
      {menu}
      <span>{w.name}</span>
    </h1>
  );

  // A file that did not parse has no model to show and nothing to run, so
  // the header carries only what is true: where it is, and that it is broken.
  if (!isParsed(w)) {
    return (
      <div class="head">
        <div class="grow">
          {title}
          <div class="meta">
            <span class="mono">{w.rel}</span>
            <span class="pill err">does not parse</span>
          </div>
        </div>
      </div>
    );
  }

  const r = run.value;
  const errs = errorCount.value, warns = w.issues.length - errs;
  const gates = w.model.steps.filter((s) => s.kind === 'pause').length;
  void now.value; // re-render the clock while a run is active
  const status = !r ? null
    : r.debug?.status === 'paused' ? <span class="pill debug">paused {r.debug.phase} {w.nodes[r.debug.node ?? '']?.label ?? r.debug.node}</span>
    : r.debug?.status === 'running' ? <span class="pill debug">stepping · {ms(runDuration(r))}</span>
    : r.status === 'running' ? <span class="pill run">running · {ms(runDuration(r))}</span>
    : r.status === 'waiting' ? <span class="pill gate">waiting at {r.gate?.node}</span>
    : r.status === 'completed' ? <span class="pill ok">completed · {ms(runDuration(r))}</span>
    : r.status === 'failed' ? <span class="pill err">failed</span> : <span class="pill">cancelled</span>;

  return (
    <div class="head">
      <div class="grow">
        {title}
        <div class="meta">
          <span class="mono">{w.rel}</span>
          <span>{w.model.steps.length} step{w.model.steps.length === 1 ? '' : 's'}{gates ? ` · ${gates} gate${gates > 1 ? 's' : ''}` : ''}</span>
          {errs > 0 && <span class="pill err">{errs} error{errs > 1 ? 's' : ''}</span>}
          {warns > 0 && <span class="pill warn">{warns} warning{warns > 1 ? 's' : ''}</span>}
          {!errs && !warns && <span class="pill ok">valid</span>}
          {!w.compiled && <button class="pill linkpill" title="What compiling does" onClick={() => openDoc('compilation')}>not compiled</button>}
          {status}
        </div>
      </div>
      <div class="actions">
        <ShareMenu file={w.file} name={w.name} />
        {runActive.value && <button class="btn danger" onClick={() => cancelRun()}>{r?.debug ? 'Stop' : 'Cancel'}</button>}
      </div>
    </div>
  );
}
