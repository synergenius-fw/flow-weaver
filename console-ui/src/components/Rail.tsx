import { useState, useEffect } from 'preact/hooks';
import { workflows, wf, project, selectWorkflow, openProject, ui, loading, opening, guide, view, openDoc, packs, openPack, openMarket, packProject, openAuthor, openOverview, openAgents, openEndpoints, serviceOf, type WorkflowSummary } from '../state';
import { get, store } from '../api';
import { buildTree, pathTo, type TreeNode } from '../tree';
import { Tip, Keys } from './Tip';

/**
 * Choosing another project.
 *
 * A modal rather than rows crammed into the rail: picking a directory means
 * reading a path, walking up and down it, and seeing whether the place you
 * have landed actually holds workflows before committing to it.
 */
function ProjectPicker() {
  const [at, setAt] = useState(project.value.dir);
  const [entries, setEntries] = useState<Array<{ name: string; dir: string }>>([]);
  const [crumbs, setCrumbs] = useState<Array<{ name: string; dir: string }>>([]);
  const [root, setRoot] = useState('/');
  const [parent, setParent] = useState('');
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    get(`/api/browse?dir=${encodeURIComponent(at)}`)
      .then((r) => {
        if (!live) return;
        setEntries(r.entries); setParent(r.parent); setCrumbs(r.crumbs ?? []); setFailure('');
        // The first crumb's path minus its name is the filesystem root,
        // whatever that means on this platform.
        setRoot(r.crumbs?.length ? r.crumbs[0].dir.slice(0, r.crumbs[0].dir.length - r.crumbs[0].name.length) : r.dir);
      })
      .catch((e) => { if (live) { setFailure(e.message); setEntries([]); } });
    return () => { live = false; };
  }, [at]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') ui.picker.value = false; };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const open = async () => {
    setBusy(true);
    try { await openProject(at); } catch (e) { setFailure((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <>
      <div class="scrim" onClick={() => { ui.picker.value = false; }} />
      <div class="dialog" role="dialog" aria-label="Open project">
        <div class="dialoghead">
          <b>Open project</b>
          <span class="sp" />
          <button class="btn ghost sm" onClick={() => { ui.picker.value = false; }}>Close<Keys combo="esc" /></button>
        </div>

        <div class="crumbs">
          <button class="crumb" onClick={() => setAt(root)} title={root}><span class="ms">home</span></button>
          {crumbs.map((c) => (
            <button class="crumb" key={c.dir} onClick={() => setAt(c.dir)}>{c.name}</button>
          ))}
        </div>

        <div class="dialogbody">
          {failure && <div class="empty" style="color:var(--err)">{failure}</div>}
          {parent && parent !== at && (
            <button class="pickrow" onClick={() => setAt(parent)}>
              <span class="ms">drive_folder_upload</span><span class="t">..</span>
            </button>
          )}
          {entries.map((e) => (
            <button class="pickrow" key={e.dir} onClick={() => setAt(e.dir)} onDblClick={() => openProject(e.dir)}>
              <span class="ms">folder</span><span class="t">{e.name}</span>
            </button>
          ))}
          {!entries.length && !failure && <div class="empty">no subdirectories</div>}
        </div>

        <div class="dialogfoot">
          <span class="mono" title={at}>{at}</span>
          <button class="btn primary sm" disabled={busy} onClick={open}>Open this folder</button>
        </div>
      </div>
    </>
  );
}

function Counts({ errors, warnings, waiting, checked = true, busy = false }: { errors: number; warnings: number; waiting: number; checked?: boolean; busy?: boolean }) {
  return (
    <>
      {waiting > 0 && <span class="count">{waiting}</span>}
      {/* Until it has been parsed there is no verdict to report, and a
          green dot would be a claim rather than a placeholder. */}
      {checked && !loading.value && !busy ? <span class={`dot ${errors ? 'err' : warnings ? 'warn' : ''}`} /> : <span class="spinner" title={busy ? 'opening' : 'checking'} />}
    </>
  );
}

/**
 * One level of indent is exactly a folder's caret and the gap after it,
 * so a child's icon sits under its parent's icon rather than 8px short.
 */
const INDENT = 21;

function Node({ node, depth }: { node: TreeNode; depth: number }) {
  const pad = { 'padding-left': `${9 + depth * INDENT}px` };

  if (node.kind === 'workflow') {
    const w = node.workflow;
    const current = wf.value;
    const on = current && current.file === w.file && current.name === w.name;
    return (
      <button class={`item ${on ? 'on' : ''}`} style={pad} onClick={() => selectWorkflow(w.file, w.name)}>
        {/* A gated workflow is one a person has to come back to, which is
            worth knowing before opening it. */}
        <span class={`ticon ${w.gates ? 'gated' : ''}`} title={w.gates ? `${w.gates} gate${w.gates > 1 ? 's' : ''}` : undefined}>
          <span class="ms">{w.gates ? 'pause_circle' : 'conversion_path'}</span>
        </span>
        <span class="t"><b>{node.label}</b></span>
        <Counts errors={w.errors} warnings={w.warnings} waiting={w.waiting} checked={w.checked} busy={opening.value === node.key} />
      </button>
    );
  }

  const shut = ui.collapsed.value.has(node.key);
  const toggle = () => {
    const next = new Set(ui.collapsed.value);
    if (shut) next.delete(node.key); else next.add(node.key);
    ui.collapsed.value = next;
    store.set('collapsed', [...next]);
  };
  return (
    <>
      <button class="folder" style={pad} onClick={toggle}>
        <span class={`caret ${shut ? '' : 'open'}`}>▸</span>
        <span class="ticon ms">{node.kind === 'file' ? 'description' : shut ? 'folder' : 'folder_open'}</span>
        <span class="t">{node.kind === 'file' ? node.label.replace(/\.ts$/, '') : node.label}</span>
        {shut && <Counts errors={node.errors} warnings={node.warnings} waiting={node.waiting} checked={node.checked} />}
      </button>
      {!shut && node.children.map((child) => <Node key={child.key} node={child} depth={depth + 1} />)}
    </>
  );
}

/**
 * The guide, on its own tab of the rail.
 *
 * Topics are things you open in the centre, like workflows, so they live
 * in the same navigator rather than behind a mode switch -- but on a tab,
 * not below the tree, so neither list is reached by scrolling past the
 * other. Groups fold like folders; the one holding the open topic unfolds
 * by itself.
 */
interface SectionHit { slug: string; heading: string; excerpt: string }

function Guide({ filter }: { filter: string }) {
  const current = view.value.kind === 'doc' ? view.value.slug : null;
  const shut = ui.guideShut.value;
  // From two characters the filter searches the pages' text, not only their
  // names: the sections that match are listed under their topic.
  const [hits, setHits] = useState<Map<string, SectionHit[]>>(new Map());
  const searching = filter.trim().length >= 2;
  useEffect(() => {
    if (!searching) { setHits(new Map()); return; }
    const t = setTimeout(() => {
      get<Array<{ slug: string; heading: string; excerpt: string }>>(`/api/docs/search?q=${encodeURIComponent(filter.trim())}&limit=60`)
        .then((rows) => {
          const m = new Map<string, SectionHit[]>();
          for (const r of rows) if (r.heading) m.set(r.slug, [...(m.get(r.slug) ?? []), r].slice(0, 5));
          setHits(m);
        })
        .catch(() => setHits(new Map()));
    }, 250);
    return () => clearTimeout(t);
  }, [filter]);
  const toggle = (title: string) => {
    const next = new Set(shut);
    if (next.has(title)) next.delete(title); else next.add(title);
    ui.guideShut.value = next;
    store.set('guideShut', [...next]);
  };
  useEffect(() => {
    if (!current) return;
    const holder = guide.value.find((g) => g.topics.some((t) => t.slug === current));
    if (holder && shut.has(holder.title)) { const next = new Set(shut); next.delete(holder.title); ui.guideShut.value = next; }
    // The open topic is shown where the rest of the console is looking.
    setTimeout(() => document.querySelector('.railtree .item.on')?.scrollIntoView({ block: 'nearest' }), 0);
  }, [current]);
  const needle = filter.trim().toLowerCase();
  return (
    <>
      {guide.value.map((g) => {
        const topics = needle ? g.topics.filter((t) => t.name.toLowerCase().includes(needle) || t.slug.includes(needle) || hits.has(t.slug)) : g.topics;
        if (!topics.length) return null;
        const folded = !needle && shut.has(g.title);
        return (
          <div key={g.title}>
            <button class="folder" style={{ 'padding-left': '9px' }} onClick={() => toggle(g.title)}>
              <span class={`caret ${folded ? '' : 'open'}`}>▸</span>
              <span class="ticon ms">{folded ? 'menu_book' : 'auto_stories'}</span>
              <span class="t">{g.title}</span>
              {folded && <span class="hint">{g.topics.length}</span>}
            </button>
            {!folded && topics.map((t) => (
              <div key={t.slug}>
                <button class={`item ${current === t.slug ? 'on' : ''}`} style={{ 'padding-left': `${9 + INDENT}px` }} title={t.description} onClick={() => openDoc(t.slug)}>
                  <span class="ticon"><span class="ms">article</span></span>
                  {/* Every topic is Flow Weaver's; the prefix only costs width here. */}
                  <span class="t"><b>{t.name.replace(/^Flow Weaver /, '')}</b></span>
                </button>
                {searching && (hits.get(t.slug) ?? []).map((h) => (
                  <button key={h.heading} class="item section" style={{ 'padding-left': `${9 + INDENT * 2}px` }} title={h.excerpt} onClick={() => openDoc(t.slug, h.heading)}>
                    <span class="t"><b>{h.heading}</b><small>{h.excerpt.split('\n')[0]}</small></span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

/**
 * The packs installed in the project, on the third tab.
 *
 * A pack is the other thing a project is made of besides its own files;
 * with none installed the tab says how to find one, since `fw market` is
 * not something a person discovers by looking at an empty list.
 */
function Packs({ filter }: { filter: string }) {
  const current = view.value.kind === 'pack' ? view.value.name : null;
  const needle = filter.trim().toLowerCase();
  const list = packs.value.filter((p) => !needle || p.namespace.includes(needle) || p.name.toLowerCase().includes(needle));
  const market = view.value.kind === 'market';
  const authoring = view.value.kind === 'author';
  const own = packProject.value;
  const find = (
    <>
      {/* The project itself, when it is a pack: what fw market pack would make of it. */}
      {own.isPack && (
        <button class={`item ${authoring ? 'on' : ''}`} onClick={openAuthor} title={own.name}>
          <span class="ticon"><span class="ms">construction</span></span>
          <span class="t"><b>This pack</b><small>{own.name}{own.version ? `@${own.version}` : ''}</small></span>
        </button>
      )}
      <button class={`item ${market ? 'on' : ''}`} onClick={openMarket}>
        <span class="ticon"><span class="ms">search</span></span>
        <span class="t"><b>Find a pack</b><small>the marketplace</small></span>
      </button>
    </>
  );
  if (!packs.value.length) {
    return (
      <>
        {find}
        <div class="empty">No packs installed in {project.value.name || 'this project'}.</div>
      </>
    );
  }
  return (
    <>
      {find}
      {list.map((p) => (
        <button key={p.name} class={`item ${current === p.name ? 'on' : ''}`} title={p.name} onClick={() => openPack(p.name)}>
          <span class={`ticon ${p.compatible === false ? 'warnicon' : ''}`}><span class="ms">{p.compatible === false ? 'warning' : 'inventory_2'}</span></span>
          <span class="t"><b>{p.namespace}</b><small>{p.version}{p.nodeTypes.length ? `, ${p.nodeTypes.length} node type${p.nodeTypes.length > 1 ? 's' : ''}` : ''}{p.exportTargets.length ? `, ${p.exportTargets.length} target${p.exportTargets.length > 1 ? 's' : ''}` : ''}</small></span>
        </button>
      ))}
      {!list.length && <div class="empty">nothing matching "{filter}"</div>}
    </>
  );
}

/** A search result shows its path, since the tree is not there to give it. */
function FlatMatch({ w }: { w: WorkflowSummary }) {
  const current = wf.value;
  const on = current && current.file === w.file && current.name === w.name;
  return (
    <button class={`item ${on ? 'on' : ''}`} onClick={() => selectWorkflow(w.file, w.name)}>
      <span class={`ticon ${w.gates ? 'gated' : ''}`}><span class="ms">{w.gates ? 'pause_circle' : 'conversion_path'}</span></span>
      <span class="t"><b>{w.name}</b><small>{w.rel}</small></span>
      <Counts errors={w.errors} warnings={w.warnings} waiting={w.waiting} checked={w.checked} busy={opening.value === `${w.file}|${w.name}`} />
    </button>
  );
}

/**
 * The project's workflows.
 *
 * A tree rather than a list: the folders an author organised by carry
 * meaning, and two workflows may share a name -- `reviewFile` exists twice
 * in the use cases -- so the path is sometimes the only thing telling them
 * apart. A filter flattens back to matches only, since a tree is the wrong
 * shape for a search result.
 */
export function Rail() {
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();
  const matches = needle
    ? workflows.value.filter((w) => w.name.toLowerCase().includes(needle) || w.rel.toLowerCase().includes(needle))
    : workflows.value;
  const tree = needle ? null : buildTree(matches);
  const tab = ui.railTab.value;
  // A gate waiting somewhere in the project is worth seeing from the other tab.
  const waiting = workflows.value.reduce((n, w) => n + w.waiting, 0);

  // Opening a workflow reveals it: a collapsed folder would otherwise hide
  // the selection the rest of the console is showing.
  const current = wf.value;
  useEffect(() => {
    if (!current || !ui.collapsed.value.size) return;
    const onPath = pathTo(current.rel);
    if (!onPath.some((k) => ui.collapsed.value.has(k))) return;
    const next = new Set(ui.collapsed.value);
    for (const k of onPath) next.delete(k);
    ui.collapsed.value = next;
  }, [current?.file, current?.name]);

  const views: Array<{ id: typeof tab; label: string; icon: string; badge?: number; badgeKind?: string }> = [
    { id: 'workflows', label: 'Workflows', icon: 'conversion_path', badge: waiting, badgeKind: 'waiting' },
    { id: 'guide', label: 'Guide', icon: 'menu_book' },
    { id: 'packs', label: 'Packs', icon: 'inventory_2', badge: packs.value.length, badgeKind: 'dim' },
  ];
  return (
    <>
      {/* The views as an icon bar, the way editors do it: one glyph per
          list, with the list beside it. A gate waiting somewhere in the
          project shows on the Workflows glyph from any view. */}
      <nav class="bar" aria-label="Views">
        <Tip label="Search" shortcut="mod+K">
          <button aria-label="Search" onClick={() => { ui.search.value = true; }}>
            <span class="ms">search</span>
          </button>
        </Tip>
        <span class="barsep" />
        {views.map((v) => (
          <Tip key={v.id} label={v.badge && v.badgeKind === 'waiting' ? `${v.label}, ${v.badge} waiting at a gate` : v.label}>
            <button class={tab === v.id ? 'on' : ''} aria-label={v.label} onClick={() => { ui.railTab.value = v.id; }}>
              <span class="ms">{v.icon}</span>
              {!!v.badge && <span class={`badge ${v.badgeKind ?? ''}`}>{v.badge}</span>}
            </button>
          </Tip>
        ))}
        <span class="sp" />
        {/* The project as a whole: its server, endpoints, agents, environment.
            The server's state shows on the glyph from anywhere. */}
        <Tip label={`Project, server ${serviceOf('serve')?.state === 'running' ? 'up' : serviceOf('serve')?.state === 'starting' ? 'starting' : 'down'}`}>
          <button class={view.value.kind === 'project' ? 'on' : ''} aria-label="Project" onClick={openOverview}>
            <span class="ms">space_dashboard</span>
            {serviceOf('serve')?.state === 'running' && <span class="livedot" />}
          </button>
        </Tip>
        <Tip label="Endpoints: workflows over HTTP">
          <button class={view.value.kind === 'endpoints' ? 'on' : ''} aria-label="Endpoints" onClick={openEndpoints}>
            <span class="ms">api</span>
          </button>
        </Tip>
        <Tip label="Agents: what answers an agent gate">
          <button class={view.value.kind === 'agents' ? 'on' : ''} aria-label="Agents" onClick={openAgents}>
            <span class="ms">smart_toy</span>
          </button>
        </Tip>
        <Tip label="Open another project">
          <button aria-label="Open another project" onClick={() => { ui.picker.value = !ui.picker.value; }}>
            <span class="ms">folder_open</span>
          </button>
        </Tip>
      </nav>
      <div class="railbody">
      <div class="brand">
        <b>Flow Weaver</b>
        <button class="projectbtn" onClick={() => { ui.picker.value = !ui.picker.value; }} title={project.value.dir}>
          {project.value.name}<span class="caret">▾</span>
        </button>
      </div>
      {ui.picker.value && <ProjectPicker />}

      <div class="railhead">
        <h4>{views.find((v) => v.id === tab)?.label}</h4>
        <input type="text" class="filter" placeholder="filter" value={filter}
          onInput={(e) => setFilter((e.target as HTMLInputElement).value)} />
      </div>

      {/* The list takes whatever height is left and scrolls inside it, so
          the footer stays at the bottom without being positioned there. */}
      <div class="railtree">
        {tab === 'guide' ? <Guide filter={filter} /> : tab === 'packs' ? <Packs filter={filter} /> : (
          <>
            {tree
              ? tree.map((node) => <Node key={node.key} node={node} depth={0} />)
              : matches.map((w) => <FlatMatch key={`${w.file}|${w.name}`} w={w} />)}
            {!matches.length && (
              <div class="empty">{needle ? `nothing matching "${filter}"` : `no workflows in ${project.value.dir || 'this directory'}`}</div>
            )}
          </>
        )}
      </div>

      <footer class="railfoot">
        Built by
        <img src="/synergenius.svg" alt="" width="14" height="14" />
        Synergenius
      </footer>
      </div>
    </>
  );
}
