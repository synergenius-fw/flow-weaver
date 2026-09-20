import { useMemo, useRef, useState, useLayoutEffect } from 'preact/hooks';
import { run, sel, ui, stepState, stepDuration, passCount, breakpoints, toggleBreakpoint, diffView, diffMode, type Step, type Node, type ParsedWorkflow } from '../state';
import { buildGraph, edgePath, type GRow, type GEdge } from '../graph';
import { ms, colorVar } from '../format';
import { Icon, kindIcon } from './Icon';
import { Value } from './Value';
import { GateCard } from './GateCard';
import { AgentPanel } from './AgentPanel';

/** Tile size, so a tile centres on its lane. */
const TILE = 22;

function Tile({ node, step, state, term, bp = false }: { node?: Node; step?: Step | null; state: string; term?: 'Start' | 'Exit'; bp?: boolean }) {
  if (term) {
    const r = run.value;
    const cls = term === 'Start' ? (r ? 'done' : '') : r?.status === 'completed' ? 'done' : r?.status === 'failed' ? 'failed' : '';
    return <div class={`tile term ${cls}`} />;
  }
  const kind = step?.kind === 'loop' ? 'loop' : node?.effect ? 'effect' : node?.gate ?? (step?.pull ? 'pull' : null);
  const icon = node?.icon ?? kindIcon(kind);
  const fallback = kind === 'loop' ? 'var(--loop)' : node?.gate ? 'var(--gate)' : node?.effect ? 'var(--orange, var(--c-orange))' : step?.pull ? 'var(--pull)' : 'var(--dim)';
  const tc = colorVar(node?.color) ?? fallback;
  // An expression node computes a value and cannot route a failure, so its
  // tile is drawn softer than a normal-mode step that can branch.
  const shape = node?.gate ? 'k-gate' : kind === 'loop' ? 'k-loop' : node?.expression ? 'expr' : '';
  return <div class={`tile ${icon ? '' : 'dot'} ${shape} ${state} ${bp ? 'bp' : ''}`} style={`--tc:${tc}`}>{icon && <Icon name={icon} />}</div>;
}

function TermRow({ id, row, gutter, laneX, w }: { id: 'Start' | 'Exit'; row: GRow<Step>; gutter: number; laneX: (l: number) => number; w: ParsedWorkflow }) {
  const r = run.value;
  const vals = id === 'Start'
    ? w.params.map((p) => [p.name, r?.values[`Start.${p.name}`]] as const)
    : w.returns.map((p) => [p.name, r?.result?.[p.name]] as const);
  const shown = vals.filter(([, v]) => v !== undefined);
  const failed = id === 'Exit' && r?.status === 'failed';
  const pick = () => {
    // The ends carry information too: what the workflow takes and what it
    // returns. They select like a step and open in the same pane.
    const same = sel.value === id;
    sel.value = same ? null : id;
    ui.side.value = same ? 'run' : 'step';
  };
  return (
    <div class={`row term ${sel.value === id ? 'sel' : ''}`} data-row={id} style={`padding-left:${gutter}px`}>
      <div class="tile-slot" style={`left:${laneX(row.lane) - TILE / 2}px`}><Tile term={id} state="" /></div>
      <div class="body">
        <div class="line1" onClick={pick}><span class="lbl">{id}</span><span class="sp" />
          {failed && <span class="st err">{r?.error || 'failed'}</span>}
          {id === 'Exit' && r?.status === 'completed' && r.result?.onFailure && <span class="st err">onFailure</span>}
        </div>
        {shown.length > 0 && <div class="kv" style="margin:0 0 6px">{shown.map(([k, v]) => <><span class="k">{k}</span><Value value={v} /></>)}</div>}
      </div>
    </div>
  );
}

type Mark = 'add' | 'del' | 'mod' | undefined;

function StepRow({ row, gutter, laneX, w, nodes, mark, slot }: { row: GRow<Step>; gutter: number; laneX: (l: number) => number; w: ParsedWorkflow; nodes: Record<string, Node>; mark?: Mark; slot?: boolean }) {
  const r = run.value, s = row.step!, node = nodes[s.id];
  // In Before or After, a step the other version does not have leaves its
  // row as an empty dashed slot, so nothing below it moves when switching.
  if (slot) return <div class="row slot" data-row={s.id} style={`padding-left:${gutter}px`}><div class="body"><div class="line1" /></div></div>;
  const st = stepState(s.id);
  // Wired by `@connect` alone: no control flow reaches it, so it runs when
  // something reads it. `[pullExecution:]` says the same thing explicitly.
  const onDemand = !s.pull && !s.entered.length && !s.successTo.length && !s.failureTo.length
    && (s.reads.length > 0 || s.produces.length > 0);
  const issues = w.issues.filter((i) => i.node === s.id);
  const worst = issues.some((i) => i.severity === 'error') ? '' : 'warn';
  const dur = stepDuration(s.id);
  // A step in a scope body ran once per item: say how many times, and add the passes up.
  const n = passCount(s.id);
  const times = n > 1 ? `${n}× ` : '';
  const bp = breakpoints.value.has(s.id);
  let status = null;
  if (st === 'PAUSED') status = <span class="st debug">paused {r?.debug?.phase}{r?.debug?.phase === 'after' && dur != null ? `, ${ms(dur)}` : ''}</span>;
  else if (st === 'RUNNING') status = <span class="st run">{n > 1 ? `pass ${n}, ` : ''}running</span>;
  else if (st === 'WAITING') status = <span class="st gate">waiting at {s.gate ?? 'gate'}</span>;
  else if (st === 'FAILED') status = <span class="st err">{times}{r?.errors[s.id] ? 'threw' : 'failed'}{dur != null ? `, ${ms(dur)}` : ''}</span>;
  else if (st === 'SUCCEEDED') status = <span class="st">{times}{ms(dur)}</span>;
  else if (st === 'CANCELLED') status = <span class="st">cancelled</span>;
  else if (!r && s.kind === 'pause') status = <span class="st gate" style="opacity:.7">{s.gate ?? 'gate'}</span>;
  return (
    <div class={`row ${st} ${sel.value === s.id ? 'sel' : ''} ${row.owner ? 'inscope' : ''} ${mark ? `diff-${mark}` : ''}`} data-row={s.id} style={`padding-left:${gutter}px`}>
      {/* The tile is where a breakpoint goes, as in any editor's gutter. */}
      <div class="tile-slot bpslot" style={`left:${laneX(row.lane) - TILE / 2}px`} title={bp ? 'Remove breakpoint' : 'Add breakpoint'} onClick={() => toggleBreakpoint(s.id)}>
        <Tile node={node} step={s} state={st} bp={bp} />
      </div>
      <div class="body">
        <div class="line1" onClick={() => {
          // Clicking a step is a request to look at it, so the inspector
          // follows; clicking it again lets go and returns to the run.
          const same = sel.value === s.id;
          sel.value = same ? null : s.id;
          ui.side.value = same ? 'run' : 'step';
        }}>
          <span class="lbl">{s.label}</span>
          <span class="id">{node?.builtin || s.label.toLowerCase() === s.id.toLowerCase() ? s.type : s.id}</span>
          {s.pull ? <span class="tag pull">pulled</span> : onDemand && <span class="tag pull">on demand</span>}
          {s.kind === 'loop' && <span class="tag loop">{s.scope ? `each ${s.scope}` : 'each'}</span>}
          {issues.length > 0 && <span class={`mark ${worst}`} title={issues.map((i) => i.message).join('\n')} />}
          <span class="sp" />{status}
        </div>
        {/* An agent profile at work on this gate streams in above the form;
            once it has answered, or could not, one line stays. */}
        {r?.agent?.node === s.id && (st === 'WAITING' || st === 'SUCCEEDED' || st === 'RUNNING') && <AgentPanel note={r.agent} log={r.agentLog} compact={st !== 'WAITING'} />}
        {st === 'WAITING' && r?.gate && !(r.agent?.node === s.id && r.agent.status === 'answering') && <GateCard gate={r.gate} due={r.due} />}
      </div>
    </div>
  );
}

function edgeClass(e: GEdge): string {
  const r = run.value;
  if (!r) return e.kind;
  const from = r.states[e.from]?.status, to = r.states[e.to]?.status;
  const ended = ['completed', 'failed', 'cancelled'].includes(r.status);
  const ranFrom = from === 'SUCCEEDED' || from === 'FAILED' || e.from === 'Start';
  const ranTo = !!to && to !== 'CANCELLED' || (e.to === 'Exit' && r.status === 'completed');
  const failTaken = r.values[`${e.from}.onFailure`] === true;
  const taken = ranFrom && ranTo && (e.kind === 'fail' ? failTaken : e.kind === 'ok' || e.kind === 'return' ? !failTaken || from === 'SUCCEEDED' && !failTaken : true);
  if (taken) return `${e.kind} lit`;
  return ended ? `${e.kind} dim` : e.kind;
}

export function Spine({ w }: { w: ParsedWorkflow }) {
  // With the Changes pane open and a comparison loaded, the picture is the
  // union of both versions with the changes marked; Before and After show
  // one version on the same rows.
  const d = ui.side.value === 'changes' ? diffView.value : null;
  const model = d?.model ?? w.model;
  const nodes = d?.model ? { ...w.nodes, ...d.nodes } : w.nodes;
  const mode = d?.model ? diffMode.value : 'diff';
  const marks = useMemo(() => {
    const m = new Map<string, Mark>();
    if (!d?.model) return { rows: m, edges: new Map<string, 'add' | 'del'>() };
    for (const id of d.marks.added) m.set(id, 'add');
    for (const id of d.marks.removed) m.set(id, 'del');
    for (const id of d.marks.changed) m.set(id, 'mod');
    const e = new Map<string, 'add' | 'del'>();
    for (const [a, b] of d.marks.edgesAdded) e.set(`${a}>${b}`, 'add');
    for (const [a, b] of d.marks.edgesRemoved) e.set(`${a}>${b}`, 'del');
    return { rows: m, edges: e };
  }, [d]);
  const hiddenRow = (id: string) => (mode === 'before' && marks.rows.get(id) === 'add') || (mode === 'after' && marks.rows.get(id) === 'del');
  const hiddenEdge = (k: string) => (mode === 'before' && marks.edges.get(k) === 'add') || (mode === 'after' && marks.edges.get(k) === 'del');
  const graph = useMemo(() => buildGraph(model), [model]);
  const laneX = (lane: number) => graph.laneX[lane] ?? 0;
  const gutter = graph.gutter;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ y: Record<string, number>; top: Record<string, number>; bottom: Record<string, number>; h: number }>({ y: {}, top: {}, bottom: {}, h: 0 });

  // Row heights change with gate cards and values; measure after every render and on resize.
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const measure = () => {
      const y: Record<string, number> = {}, top: Record<string, number> = {}, bottom: Record<string, number> = {};
      el.querySelectorAll<HTMLElement>('[data-row]').forEach((row) => {
        const id = row.dataset.row!;
        y[id] = row.offsetTop + 20; top[id] = row.offsetTop; bottom[id] = row.offsetTop + row.offsetHeight;
      });
      const same = (a: Record<string, number>, b: Record<string, number>) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]);
      setPos((p) => (p.h === el.offsetHeight && same(p.y, y) && same(p.bottom, bottom) ? p : { y, top, bottom, h: el.offsetHeight }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.querySelectorAll('[data-row]').forEach((n) => ro.observe(n));
    return () => ro.disconnect();
  });

  const y = (id: string) => pos.y[id] ?? 0;
  return (
    <div class="spine" ref={ref}>
      {/* A band behind each scope body, named at its corner: these rows run
          once per item, the owner above them once. Before the lanes and the
          rows, so it is under both. */}
      {graph.scopes.map((sc) => {
        const first = graph.rows[sc.first].id, last = graph.rows[sc.last].id;
        if (pos.top[first] === undefined || pos.bottom[last] === undefined) return null;
        const top = pos.top[first] + 3;
        return (
          <div key={sc.owner} class="scope" style={`--d: ${sc.depth}; top: ${top}px; height: ${pos.bottom[last] - 3 - top}px; left: ${laneX(sc.lane) - TILE / 2 - 8}px`} aria-hidden="true">
            <span class="lbl">{sc.owner}{sc.scope ? ` ${sc.scope}` : ''}</span>
          </div>
        );
      })}
      <svg class="lanes" width={gutter} height={pos.h} aria-hidden="true">
        {graph.edges.map((e) => {
          const k = `${e.from}>${e.to}`;
          if (!(y(e.from) && y(e.to)) || hiddenEdge(k) || hiddenRow(e.from) || hiddenRow(e.to)) return null;
          const dm = mode === 'diff' ? marks.edges.get(k) : undefined;
          return <path key={k} class={`${edgeClass(e)} ${dm ? `diff-${dm}` : ''}`} d={edgePath(e, y, laneX)} />;
        })}
      </svg>
      {graph.rows.map((row) => row.id === 'Start' || row.id === 'Exit'
        ? <TermRow key={row.id} id={row.id as 'Start' | 'Exit'} row={row} gutter={gutter} laneX={laneX} w={w} />
        : <StepRow key={row.id} row={row} gutter={gutter} laneX={laneX} w={w} nodes={nodes} mark={mode === 'diff' ? marks.rows.get(row.id) : undefined} slot={hiddenRow(row.id)} />)}
    </div>
  );
}
