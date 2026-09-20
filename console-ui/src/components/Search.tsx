import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ui, workflows, wf, isParsed, packs, cliCommands, loadCliCommands, selectWorkflow, openDoc, openPack, stageCli, cli, sel, view, type Step } from '../state';
import { get } from '../api';
import { rank } from '../search';
import { Keys } from './Tip';

type Kind = 'doc' | 'workflow' | 'step' | 'pack' | 'node' | 'command';
interface Hit { kind: Kind; title: string; detail?: string; score: number; run: () => void }
interface DocHit { slug: string; topic: string; heading: string; excerpt: string; relevance: number }

const KIND_LABEL: Record<Kind, string> = { doc: 'Guide', workflow: 'Workflows', step: 'Steps', pack: 'Packs', node: 'Node types', command: 'Commands' };
const KIND_ICON: Record<Kind, string> = { doc: 'article', workflow: 'conversion_path', step: 'adjust', pack: 'inventory_2', node: 'extension', command: 'terminal' };

const flatten = (steps: Step[]): Step[] => steps.flatMap((s) => [s, ...flatten(s.children)]);

/**
 * One search over everything the console can open: the guide's sections
 * by their text, the project's workflows and the open workflow's steps,
 * installed packs and their node types, and the CLI's commands. Opened
 * with ⌘K or the glyph on the bar; Enter opens the first thing that fits.
 */
export function Search() {
  const open = ui.search.value;
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [docs, setDocs] = useState<DocHit[]>([]);
  const [at, setAt] = useState(0);
  useEffect(() => { if (open) { setQ(''); setDocs([]); setAt(0); loadCliCommands(); setTimeout(() => input.current?.focus(), 0); } }, [open]);
  useEffect(() => {
    if (!open || q.trim().length < 2) { setDocs([]); return; }
    const t = setTimeout(() => get<DocHit[]>(`/api/docs/search?q=${encodeURIComponent(q.trim())}&limit=40`).then(setDocs).catch(() => setDocs([])), 200);
    return () => clearTimeout(t);
  }, [q, open]);

  const hits = useMemo<Hit[]>(() => {
    const query = q.trim();
    if (!query) return [];
    const out: Hit[] = [];
    const close = () => { ui.search.value = false; };
    out.push(...rank(query, workflows.value.map((w) => ({ title: w.name, detail: w.rel, w })), 6)
      .map((x) => ({ kind: 'workflow' as Kind, title: x.title, detail: x.detail, score: x.score + 5, run: () => { close(); void selectWorkflow(x.w.file, x.w.name); } })));
    const current = wf.value;
    if (isParsed(current)) {
      out.push(...rank(query, flatten(current.model.steps).map((s) => ({ title: s.label, detail: `${s.id} · ${s.type}`, s })), 6)
        .map((x) => ({ kind: 'step' as Kind, title: x.title, detail: x.detail, score: x.score, run: () => { close(); if (view.value.kind !== 'workflow') view.value = { kind: 'workflow' }; sel.value = x.s.id; ui.side.value = 'step'; } })));
    }
    out.push(...rank(query, packs.value.map((p) => ({ title: p.namespace, detail: p.name, p })), 4)
      .map((x) => ({ kind: 'pack' as Kind, title: x.title, detail: x.detail, score: x.score, run: () => { close(); void openPack(x.p.name); } })));
    out.push(...rank(query, packs.value.flatMap((p) => p.nodeTypes.map((n) => ({ title: n.name, detail: `${p.namespace} · ${n.description}`, p }))), 6)
      .map((x) => ({ kind: 'node' as Kind, title: x.title, detail: x.detail, score: x.score - 5, run: () => { close(); void openPack(x.p.name); } })));
    out.push(...rank(query, cliCommands.value.map((c) => ({ title: `fw ${c.name}`, detail: c.description, c })), 6)
      .map((x) => ({ kind: 'command' as Kind, title: x.title, detail: x.detail, score: x.score - 5, run: () => { close(); stageCli(x.c.usage); cli.build.value = true; } })));
    // The server ranks sections by their text; a heading that matches the
    // query the way a title would is lifted above a passing mention.
    out.push(...docs.slice(0, 10).map((d, i) => {
      const title = d.heading || d.topic;
      const own = rank(query, [{ title, detail: d.topic }], 1)[0]?.score ?? 0;
      return { kind: 'doc' as Kind, title, detail: d.heading ? d.topic : d.excerpt.slice(0, 80), score: Math.max(own, 30) + Math.max(0, 10 - i), run: () => { close(); void openDoc(d.slug, d.heading); } };
    }));
    return out.sort((a, b) => b.score - a.score);
  }, [q, docs, workflows.value, wf.value, packs.value, cliCommands.value]);

  // Grouped for reading, in the order of each group's best hit; the flat order is what the arrows walk.
  const groups = useMemo(() => {
    const byKind = new Map<Kind, Hit[]>();
    for (const h of hits) byKind.set(h.kind, [...(byKind.get(h.kind) ?? []), h]);
    return [...byKind.entries()];
  }, [hits]);
  const flat = groups.flatMap(([, list]) => list);
  useEffect(() => { setAt(0); }, [q, docs.length]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); ui.search.value = false; }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setAt((a) => Math.min(a + 1, flat.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((a) => Math.max(a - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); flat[at]?.run(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, flat, at]);
  useEffect(() => { document.querySelector('.searchrow.on')?.scrollIntoView({ block: 'nearest' }); }, [at]);

  if (!open) return null;
  let index = -1;
  return (
    <>
      <div class="scrim" onClick={() => { ui.search.value = false; }} />
      <div class="dialog search" role="dialog" aria-label="Search">
        <div class="searchhead">
          <span class="ms">search</span>
          <input ref={input} type="text" value={q} placeholder="Search the guide, workflows, steps, packs, commands…" spellcheck={false}
            onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
          <Keys combo="esc" />
        </div>
        <div class="dialogbody searchbody">
          {groups.map(([kind, list]) => (
            <div key={kind} class="searchgroup">
              <h6>{KIND_LABEL[kind]}</h6>
              {list.map((h) => {
                index += 1;
                const i = index;
                return (
                  <button key={`${kind}:${h.title}:${h.detail}`} class={`searchrow ${i === at ? 'on' : ''}`} onMouseEnter={() => setAt(i)} onClick={h.run}>
                    <span class="ms">{KIND_ICON[kind]}</span>
                    <span class="t"><b>{h.title}</b>{h.detail && <small>{h.detail}</small>}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {q.trim() && !flat.length && <div class="empty">nothing matching "{q.trim()}"</div>}
          {!q.trim() && <div class="empty hint">Type to search. <span class="kbd">↑</span><span class="kbd">↓</span> to move, <Keys combo="enter" /> to open.</div>}
        </div>
      </div>
    </>
  );
}
