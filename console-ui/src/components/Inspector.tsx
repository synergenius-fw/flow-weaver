import type { ComponentChildren } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { defaultPass } from '../run-events';
import { wf, run, runs, sel, ui, now, startRun, openRun, runDuration, stepDuration, passesOf, passValue, toast, isParsed, runActive, cancelRun, leaveRun, deleteRun, flatSteps, openDoc, openPack, openChanges, debugAction, targets, agents, openAgents, type Issue, type Step, type ParsedWorkflow, type Deploy, type RunSnapshot, type SidePane } from '../state';
import { get } from '../api';
import { ago, ms, short, editorLink, packNs } from '../format';
import { NewRunCard } from './NewRun';
import { ChangesPane } from './Changes';
import { Value } from './Value';
import { Json } from './Json';
import { Expr, PortRef } from './Expr';
import { Code } from './Code';
import { ExportPane } from './Export';
import { ServePane } from './ServePane';
import { PaneTab } from './PaneTab';
import { ReferencePane } from './ReferencePane';
import { Keys } from './Tip';
import { Select } from './Select';
import { AgentPick } from './AgentPick';
import { kindIcon } from './Icon';
import { colorVar } from '../format';

/** The scope owner a step runs inside, or null for a step on the trunk. */
const ownerOf = (list: Step[], id: string, owner: Step | null = null): Step | null => {
  for (const s of list) {
    if (s.id === id) return owner;
    const found = ownerOf(s.children, id, s);
    if (found) return found;
  }
  return null;
};

const findStep = (id: string, list: Step[]): Step | null => {
  for (const s of list) { if (s.id === id) return s; const c = findStep(id, s.children); if (c) return c; }
  return null;
};

function IssueList({ issues, w }: { issues: Issue[]; w: ParsedWorkflow }) {
  // The code's entry in the error reference, opened in the centre.
  const explain = (i: Issue) => openDoc('error-codes', i.code);
  const copy = (i: Issue) => {
    navigator.clipboard.writeText(`${w.rel}${i.line ? `:${i.line}` : ''} ${i.code}${i.node ? ` (${i.node})` : ''}: ${i.message}`).then(() => toast('copied'));
  };
  return (
    <>
      {issues.map((i, k) => (
        <div class="issue" key={k}>
          <span class={`mark ${i.severity === 'warning' ? 'warn' : ''}`} />
          <div>
            <div>{i.message}</div>
            <div class="h"><code>{i.code}</code>{i.hint ? `: ${i.hint}` : ''}</div>
          </div>
          <div class="ops"><button onClick={() => explain(i)}>docs</button><button onClick={() => copy(i)}>copy</button></div>
        </div>
      ))}
    </>
  );
}

/** Which history dot a step status wears. */
const DOT: Record<string, string> = { SUCCEEDED: 'completed', FAILED: 'failed', RUNNING: 'running', WAITING: 'waiting', PAUSED: 'waiting', CANCELLED: 'cancelled' };

/**
 * The run as it happened, step by step: what has run, what is running,
 * how long each took. The bar under a step is its share of the longest.
 */
function Timeline({ w }: { w: ParsedWorkflow }) {
  const r = run.value!;
  void now.value;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const steps = flatSteps(w.model.steps).filter((s) => r.states[s.id]);
  if (!steps.length) return null;
  // A step's time is its passes added up; a pass still running counts to now.
  const passDur = (p: { start?: number; end?: number }) => (p.start != null ? (p.end ?? Date.now()) - p.start : null);
  const dur = (id: string) => { const list = r.passes[id] ?? []; const ds = list.map(passDur).filter((x): x is number => x != null); return ds.length ? ds.reduce((a, b) => a + b, 0) : null; };
  const longest = Math.max(1, ...steps.map((s) => dur(s.id) ?? 0));
  const toggle = (id: string) => { const n = new Set(open); if (n.has(id)) n.delete(id); else n.add(id); setOpen(n); };
  const failedPasses = (id: string) => (r.passes[id] ?? []).filter((p) => p.status === 'FAILED' || p.error).length;
  return (
    <div class="in">
      <h5>Steps<span class="hint" style="margin-left:8px;text-transform:none;letter-spacing:0">{steps.length} of {flatSteps(w.model.steps).length}</span></h5>
      <div class="tl">
        {steps.map((s) => {
          const st = r.states[s.id]; const d = dur(s.id); const many = st.count > 1; const bad = failedPasses(s.id);
          return (
            <>
              <button class={`tlrow ${st.status}`} key={s.id} onClick={() => { sel.value = s.id; ui.side.value = 'step'; }}>
                <span class={`rdot ${DOT[st.status] ?? 'cancelled'}`} />
                <span class="lbl">{s.label}
                  {many && <span class="times" title="Ran once per item, click to see each pass" onClick={(e) => { e.stopPropagation(); toggle(s.id); }}>×{st.count}{bad ? `, ${bad} failed` : ''}<span class="ms">{open.has(s.id) ? 'expand_less' : 'expand_more'}</span></span>}
                  {!many && r.errors[s.id] && <span class="err">: {r.errors[s.id]}</span>}
                </span>
                <span class="dur">{st.status === 'RUNNING' ? (many ? `pass ${st.count} running` : 'running') : st.status === 'WAITING' ? 'waiting' : ms(d)}</span>
                {d != null && <i style={`width:${Math.max(2, (d / longest) * 100)}%`} />}
              </button>
              {many && open.has(s.id) && (r.passes[s.id] ?? []).map((p) => (
                <button class={`tlrow sub ${p.status}`} key={`${s.id}#${p.index}`} onClick={() => { sel.value = s.id; ui.side.value = 'step'; ui.pass.value = { id: s.id, index: p.index }; }}>
                  <span class={`rdot ${DOT[p.status] ?? 'cancelled'}`} />
                  <span class="lbl">pass {p.index + 1}{p.error && <span class="err">: {p.error}</span>}</span>
                  <span class="dur">{p.status === 'RUNNING' ? 'running' : ms(passDur(p))}</span>
                  {passDur(p) != null && <i style={`width:${Math.max(2, ((passDur(p) ?? 0) / longest) * 100)}%`} />}
                </button>
              ))}
            </>
          );
        })}
      </div>
    </div>
  );
}

function RunCard({ w }: { w: ParsedWorkflow }) {
  const r = run.value!;
  void now.value;
  // The node that threw is the first thing to look at, so the run card
  // names it and selects it rather than leaving it to be hunted for.
  const threw = Object.keys(r.errors)[0];
  const done = ['completed', 'failed', 'cancelled'].includes(r.status);
  const d = r.debug;
  const paused = d?.status === 'paused';
  const at = d?.node ? w.nodes[d.node]?.label ?? d.node : '';
  return (
    <div class="card">
      <h3>
        {d ? 'Debug' : 'Run'} <span class="mono">{r.id.slice(0, 8)}</span><span class="sp" />
        <span class="hint">{ago(r.startedAt)}</span>
        {/* Starting another run is what you do from this card, so the way
            back to the form belongs on it rather than across the window. */}
        {runActive.value
          ? <button class="btn danger sm" onClick={() => cancelRun()}>{d ? 'Stop' : 'Cancel'}</button>
          : <>
            <button class="btn sm" title="The same parameters and mocks, once more" onClick={() => { void startRun(r.params, { mocks: r.mocks }); }}>Run again</button>
            <button class="btn ghost sm" onClick={() => leaveRun()}>New run</button>
          </>}
      </h3>
      {d && (paused || d.status === 'running') && (
        <div class="in dbgbar" role="toolbar" aria-label="Debugger">
          <button class="btn sm" disabled={!paused} onClick={() => debugAction('step')} title="Run the next node, then pause">Step<Keys combo="F10" /></button>
          <button class="btn sm" disabled={!paused} onClick={() => debugAction('continue')} title="Run to the end">Continue<Keys combo="F5" /></button>
          <button class="btn sm" disabled={!paused || !d.breakpoints.length} onClick={() => debugAction('toBreakpoint')} title={d.breakpoints.length ? 'Run to the next breakpoint' : 'No breakpoints set'}>To breakpoint<Keys combo="shift+F5" /></button>
        </div>
      )}
      <div class="in"><div class="kv">
        <span class="k">status</span>
        <span class="val static">
          {paused ? <>paused <b>{d!.phase}</b> {at} at {d!.position}/{d!.order.length}</>
            : d?.status === 'running' ? <>stepping, {ms(runDuration(r))}</>
            : d?.status === 'yielded' ? <>stopped at a gate, {ms(runDuration(r))}</>
            : d?.status === 'aborted' ? <>stopped, {ms(runDuration(r))}</>
            : <>{r.status}, {ms(runDuration(r))}</>}
        </span>
        <span class="k">params</span><Value value={r.params} />
        {r.mocks && Object.keys(r.mocks).length > 0 && <><span class="k">mocks</span><Value value={r.mocks} /></>}
        {r.source?.commit && <><span class="k">version</span><span class="val static">{r.source.commit}{r.source.dirty ? ' with uncommitted changes' : ''} <button class="linkish" title="What changed in the file since this run" onClick={() => openChanges(r.source!.commit!)}>changes since</button></span></>}
        {r.error && d?.status !== 'yielded' && <><span class="k">error</span><span class="val static" style="color:var(--err)">{r.error}</span></>}
        {threw && <><span class="k">threw at</span><span><button class="linkish" onClick={() => { sel.value = threw; ui.side.value = 'step'; }}>{w.nodes[threw]?.label ?? threw}</button> <span class="from">{threw}{(() => { const ps = r.passes[threw] ?? []; const bad = ps.find((p) => p.error || p.status === 'FAILED'); return ps.length > 1 && bad ? `, pass ${bad.index + 1} of ${ps.length}` : ''; })()}</span></span></>}
      </div></div>
      {r.traced === false && <div class="in hint">Part of this run was driven over MCP without a step trace, so steps from that part are not shown.</div>}
      {d?.status === 'yielded' && <div class="in hint">{r.error}</div>}
      {paused && d!.phase === 'after' && <div class="in hint">Values {at} produced can be changed in its Step card before the next node reads them.</div>}
      <Timeline w={w} />
      {done && r.status === 'completed' && <div class="in result" role="region" aria-label="Result"><h5>Result</h5><pre class="mono"><Json value={r.result} /></pre></div>}
    </div>
  );
}

const VISIBLE_RUNS = 6;
type RunFilter = 'all' | 'failed' | 'waiting' | 'done';
const FILTERS: Array<[RunFilter, string]> = [['all', 'all'], ['failed', 'failed'], ['waiting', 'waiting'], ['done', 'done']];

/** One line on what became of a run: where it stopped, or that it finished. */
function outcome(r: RunSnapshot, label: (id: string | undefined) => string): string {
  if (r.debug?.status === 'paused') return `paused at ${label(r.debug.node)}`;
  if (r.status === 'running') return r.debug ? 'stepping' : 'running';
  if (r.status === 'waiting') return `waiting at ${label(r.gate?.node)}`;
  if (r.status === 'failed') return r.failedAt ? `failed at ${label(r.failedAt)}` : 'failed';
  return r.status;
}

/** The parameters in a line, so two runs can be told apart. */
function paramsLine(params: Record<string, unknown>): string {
  const ents = Object.entries(params ?? {}).filter(([, v]) => v !== undefined);
  return ents.slice(0, 3).map(([k, v]) => `${k}: ${short(v)}`).join(', ') + (ents.length > 3 ? ', …' : '');
}

/**
 * This workflow's runs, beside the run they would replace.
 *
 * Each row says what became of the run and what it was given, so a failure
 * or a wait can be found without opening every one. Finished runs can be
 * cleared; what is in flight or waiting never is.
 */
function RunHistory({ w }: { w: ParsedWorkflow }) {
  const [all, setAll] = useState(false);
  const [filter, setFilter] = useState<RunFilter>('all');
  const [clearing, setClearing] = useState(false);
  void now.value;
  if (!runs.value.length) return null;
  const label = (id: string | undefined) => (id ? w.nodes[id]?.label ?? id : '');
  const matches = (r: RunSnapshot) => filter === 'all' ? true
    : filter === 'failed' ? r.status === 'failed'
    : filter === 'waiting' ? r.status === 'waiting' || r.debug?.status === 'paused'
    : r.status === 'completed' || r.status === 'cancelled';
  const shown = runs.value.filter(matches);
  const list = all ? shown : shown.slice(0, VISIBLE_RUNS);
  const finished = runs.value.filter((r) => ['completed', 'failed', 'cancelled'].includes(r.status) && !r.debug);
  const clear = async () => {
    setClearing(false);
    for (const r of finished) { try { await deleteRun(r.id); } catch (e) { toast((e as Error).message); break; } }
  };
  return (
    <div class="card">
      <h3>Runs<span class="hint">{runs.value.length}</span><span class="sp" />
        <div class="seg sm">{FILTERS.map(([f, t]) => <button key={f} class={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{t}</button>)}</div>
      </h3>
      <div class="in runlist">
        {list.map((r) => (
          <button key={r.id} class={`runrow ${run.value?.id === r.id ? 'on' : ''}`}
            onClick={() => { sel.value = null; ui.side.value = 'run'; openRun(r.id); }}>
            <span class={`rdot ${r.debug?.status === 'paused' ? 'waiting' : r.status}`} />
            <span class="what">{outcome(r, label)}{r.origin && r.origin !== 'console' && <small class="origin" title={`started over ${r.origin === 'http' ? 'HTTP' : r.origin === 'mcp' ? 'MCP, by an assistant' : r.origin}`}>{r.origin}</small>}</span>
            <span class="right" title={r.source?.commit ? `on ${r.source.commit}${r.source.dirty ? ', with uncommitted changes' : ''}` : undefined}>{r.source?.commit ? `${r.source.commit}${r.source.dirty ? '*' : ''}, ` : ''}{ago(r.startedAt)}{r.status === 'running' || r.status === 'waiting' ? '' : `, ${ms(runDuration(r))}`}</span>
            <span class="sub">{paramsLine(r.params) || 'no parameters'}</span>
            {!runActive.value && <span class="again" title="Run again with these parameters" onClick={(e) => { e.stopPropagation(); void startRun(r.params, { mocks: r.mocks }); }}><span class="ms">replay</span></span>}
          </button>
        ))}
        {!list.length && <div class="hint" style="padding:4px 9px">none {filter === 'all' ? '' : filter}</div>}
        {shown.length > VISIBLE_RUNS && (
          <button class="more" onClick={() => setAll(!all)}>
            {all ? 'show fewer' : `${shown.length - VISIBLE_RUNS} more`}
          </button>
        )}
        {finished.length > 0 && (clearing
          ? <div class="clearrow"><span class="hint">Forget {finished.length} finished run{finished.length > 1 ? 's' : ''}?</span><button class="btn danger sm" onClick={clear}>Forget</button><button class="btn ghost sm" onClick={() => setClearing(false)}>Keep</button></div>
          : <button class="more" onClick={() => setClearing(true)}>clear finished</button>)}
      </div>
    </div>
  );
}

function StepCard({ id, w }: { id: string; w: ParsedWorkflow }) {
  const r = run.value, n = w.nodes[id], step = findStep(id, w.model.steps);
  const [descOpen, setDescOpen] = useState(false);
  // Which pass is shown when the step ran more than once: the one picked
  // here, else the one the timeline sent us to, else the failed or last one.
  const [picked, setPicked] = useState<number | undefined>(undefined);
  useEffect(() => { setPicked(undefined); }, [id]);
  const passes = passesOf(id);
  const sent = ui.pass.value?.id === id ? ui.pass.value.index : undefined;
  const pass = picked ?? sent ?? defaultPass(passes);
  const current = pass !== undefined ? passes.find((p) => p.index === pass) : undefined;
  if (!n) return null;
  const issues = w.issues.filter((i) => i.node === id);
  const readsOf = (p: string) => step?.reads.find((x) => x.port === p);
  const exprOf = (p: string) => step?.exprs.find((x) => x.port === p) ?? n.expr.find((x) => x.port === p);
  const labelOf = (t: string) => (t === 'Exit' ? 'Exit' : w.nodes[t]?.label ?? t);
  // What kind of node this is, and what that means for the run. A bare word
  // ("pure", "expression") names a trait without saying what follows from
  // it, which is exactly what an author needs here.
  // Each trait names the topic that explains it, so the tag is the way in.
  const traits: Array<{ cls: string; label: string; why: ComponentChildren; doc: [string, string?] }> = [];
  if (n.gate) traits.push({
    cls: 'gate',
    label: `${n.gate} gate`,
    why: 'The run pauses here and resumes when answered.',
    doc: ['durable-gates', 'Gate kinds'],
  });
  if (step?.kind === 'loop') traits.push({
    cls: 'loop',
    label: step.scope ? `scope ${step.scope}` : 'scope owner',
    why: 'Owns the steps in the band below it and runs them once per item.',
    doc: ['export-interface'],
  });
  const owner = ownerOf(w.model.steps, id);
  if (owner) traits.push({
    cls: 'loop',
    label: owner.scope ? `inside ${owner.scope}` : 'inside a scope',
    why: <>Runs once per item, driven by <a class="go" onClick={() => { sel.value = owner.id; ui.side.value = 'step'; }}>{owner.label}</a>.</>,
    doc: ['export-interface'],
  });
  if (n.pull) traits.push({
    cls: 'pull',
    label: 'pulled',
    why: 'Runs on demand when a consumer reads it, not in process order.',
    doc: ['advanced-annotations', 'pull'],
  });
  if (n.expression) traits.push({
    cls: 'expr',
    label: 'expression',
    why: 'Computes a value and has no onFailure: a throw aborts the run.',
    doc: ['orientation', 'The model'],
  });
  else if (n.durablePure) traits.push({
    cls: 'expr',
    label: 'pure',
    why: 'Takes no effect on the world, so it may re-run when the workflow resumes.',
    doc: ['durable-gates', 'Classifying every node'],
  });
  if (n.effect) traits.push({
    cls: 'effect',
    label: 'effect',
    why: 'Recovered from its recorded result on resume rather than re-run.',
    doc: ['durable-gates', 'The effect contract'],
  });
  if (n.builtin) traits.push({
    cls: '',
    label: 'built-in',
    why: 'Provided by the runtime. It has no source in this project.',
    doc: ['built-in-nodes'],
  });
  const rel = n.file.startsWith(w.file.slice(0, w.file.length - w.rel.length)) ? n.file.slice(w.file.length - w.rel.length) : n.file;
  return (
    <>
      <div class="card">
        <h3>{n.label}<span class="mono">{n.type}</span>{n.pack && <><span class="sp" /><button class="tag pack" title={n.pack} onClick={() => openPack(n.pack!)}>{packNs(n.pack)}</button></>}</h3>
        {traits.length > 0 && (
          <div class="in traits">
            {traits.map((t) => (
              <div class="trait" key={t.label}>
                <button class={`tag ${t.cls} tagbtn`} title="Read about this" onClick={() => openDoc(t.doc[0], t.doc[1])}>{t.label}</button>
                <span class="why">{t.why}</span>
              </div>
            ))}
          </div>
        )}
        {n.description && <div class={`in hint desc ${descOpen ? 'open' : ''}`} onClick={() => setDescOpen(!descOpen)}>{n.description}</div>}
        {n.gate === 'agent' && (
          <div class="in agentrow">
            <span class="hint">answered by</span>
            {agents.value?.agents.length ? <AgentPick workflow={w.name} node={id} /> : <button class="linkish" onClick={openAgents}>a person (add a profile)</button>}
          </div>
        )}
        {issues.length > 0 && <div class="in"><IssueList issues={issues} w={w} /></div>}
        {passes.length > 1 && (
          <div class="in passes">
            <span class="hint">ran {passes.length} times, pass</span>
            {passes.length <= 12
              ? <div class="seg sm">{passes.map((p) => <button key={p.index} class={`${pass === p.index ? 'on' : ''} ${p.error || p.status === 'FAILED' ? 'bad' : ''}`} title={p.error ?? p.status.toLowerCase()} onClick={() => setPicked(p.index)}>{p.index + 1}</button>)}</div>
              : <Select value={String(pass)} onChange={(v) => setPicked(Number(v))} options={passes.map((p) => ({ value: String(p.index), label: <>{p.index + 1}{p.error || p.status === 'FAILED' ? <span class="opt-ns">, failed</span> : null}</>, text: `${p.index + 1}` }))} />}
            {current?.start != null && current.end != null && <span class="hint">{ms(current.end - current.start)}</span>}
          </div>
        )}
        {(current ? current.error : r?.errors[id]) && <div class="in"><h5>Error{passes.length > 1 ? <span class="hint" style="margin-left:8px;text-transform:none;letter-spacing:0">pass {pass! + 1}</span> : null}</h5><div class="val static" style="color:var(--err)">{current ? current.error : r?.errors[id]}</div></div>}
        <PackTags deploy={n.deploy} />
        <div class="in"><h5>Inputs</h5>
          {n.inputs.length ? <div class="ports">{n.inputs.map((p) => {
            const rd = readsOf(p.name), ex = exprOf(p.name);
            // Inside a body, the upstream step's pass with the same index is the one this pass read.
            const v = rd ? passValue(rd.from, rd.fromPort, pass) : undefined;
            return <><span class="p">{p.name}{p.optional && <i>?</i>}</span><span>{v !== undefined && <><Value value={v} />{' '}</>}{ex ? <span class="from">= <Expr value={ex.expr} /></span> : rd ? <span class="from">← <PortRef node={rd.from} port={rd.fromPort} /></span> : <span class="from" style="opacity:.6">{p.optional ? 'optional' : '—'}</span>}</span></>;
          })}</div> : <div class="hint">none</div>}
        </div>
        <div class="in"><h5>Outputs{r?.debug?.status === 'paused' && <span class="hint" style="margin-left:8px;text-transform:none;letter-spacing:0">editable while paused</span>}</h5>
          {n.outputs.length ? <div class="ports">{n.outputs.map((p) => {
            const v = passValue(id, p.name, pass);
            const to = step?.produces.find((x) => x.port === p.name)?.to ?? [];
            const editable = r?.debug?.status === 'paused' && v !== undefined;
            return <><span class="p">{p.name}</span><span>
              {editable ? <EditableValue value={v} onSet={(nv) => debugAction('set', { node: id, port: p.name, value: nv })} /> : v !== undefined && <><Value value={v} />{' '}</>}
              {to.length > 0 && <span class="from">→ {to.map((t, i) => <><span class="e-node">{t}</span>{i < to.length - 1 ? ', ' : ''}</>)}</span>}
            </span></>;
          })}</div> : <div class="hint">none</div>}
        </div>
        {step && (step.successTo.length > 0 || step.failureTo.length > 0) && (
          <div class="in"><h5>Then</h5><div class="ports">
            {step.successTo.length > 0 && <><span class="p" style="color:var(--ok)">ok</span><span class="from">→ {step.successTo.map(labelOf).join(', ')}</span></>}
            {step.failureTo.length > 0 && <><span class="p" style="color:var(--err)">failure</span><span class="from">→ {step.failureTo.map(labelOf).join(', ')}</span></>}
          </div></div>
        )}
        {r && stepDuration(id) != null && <div class="in"><div class="kv"><span class="k">took</span><span class="val static">{ms(stepDuration(id))}{passes.length > 1 ? ` over ${passes.length} passes` : ''}</span></div></div>}
      </div>
      <div class="card">
        <h3>Code<span class="sp" />{n.source && <a class="mono" href={editorLink(n.file, n.line ?? 1)}>{rel}:{n.line ?? ''}</a>}</h3>
        {n.source
          ? <Code
              source={n.source}
              startLine={n.line ?? 1}
              highlight={issues.map((i) => i.line).filter((l): l is number => !!l)}
              title={n.label}
              file={{ path: n.file, label: `${rel}:${n.line ?? ''}`, line: n.line ?? 1 }}
            />
          : (
            <div class="in hint">
              Built-in node ({n.type})
              {n.expr.length > 0 && (
                <div class="ports" style="margin-top:8px">
                  {n.expr.map((e) => (
                    <><span class="p">{e.port}</span><span class="from">= <Expr value={e.expr} /></span></>
                  ))}
                </div>
              )}
            </div>
          )}
      </div>
    </>
  );
}

/**
 * The two ends of the process.
 *
 * `Start` is the workflow's parameters and where each one goes; `Exit` is
 * its return values and where each one comes from. Neither is a node, so
 * neither has code of its own -- the workflow's annotations are the code.
 */
function TerminalCard({ id, w }: { id: 'Start' | 'Exit'; w: ParsedWorkflow }) {
  const r = run.value;
  const [descOpen, setDescOpen] = useState(false);
  const labelOf = (t: string) => w.nodes[t]?.label ?? t;
  const failed = r?.status === 'failed';
  const onFailure = r?.status === 'completed' && r.result?.onFailure === true;
  return (
    <>
      <div class="card">
        <h3>{id}<span class="mono">{w.name}</span></h3>
        {id === 'Start' && w.description && <div class={`in hint desc ${descOpen ? 'open' : ''}`} onClick={() => setDescOpen(!descOpen)}>{w.description}</div>}
        {id === 'Exit' && r?.error && failed && <div class="in"><h5>Error</h5><div class="val static" style="color:var(--err)">{r.error}</div></div>}
        {id === 'Start' ? (
          <div class="in"><h5>Parameters</h5>
            {w.params.length ? <div class="ports">{w.params.map((p) => {
              const v = r ? r.values[`Start.${p.name}`] ?? r.params[p.name] : undefined;
              const to = w.wiring.start[p.name] ?? [];
              return <>
                <span class="p" title={p.description}>{p.name}{p.optional && <i>?</i>}</span>
                <span>
                  {v !== undefined && <><Value value={v} />{' '}</>}
                  <span class="from">{p.tsType}</span>
                  {to.length > 0 && <span class="from"> → {to.map((t, i) => <><PortRef node={t.node} port={t.port} />{i < to.length - 1 ? ', ' : ''}</>)}</span>}
                  {!to.length && <span class="from" style="opacity:.6"> unread</span>}
                </span>
              </>;
            })}</div> : <div class="hint">no parameters</div>}
          </div>
        ) : (
          <div class="in"><h5>Returns{onFailure && <span class="tag" style="margin-left:8px;color:var(--err)">onFailure</span>}</h5>
            {w.returns.length ? <div class="ports">{w.returns.map((p) => {
              const v = r?.result?.[p.name];
              const from = w.wiring.exit[p.name];
              return <>
                <span class="p" title={p.description}>{p.name}{p.optional && <i>?</i>}</span>
                <span>
                  {v !== undefined && <><Value value={v} />{' '}</>}
                  <span class="from">{p.tsType}</span>
                  {from ? <span class="from"> ← <PortRef node={from.node} port={from.port} /></span> : <span class="from" style="opacity:.6"> nothing feeds it</span>}
                </span>
              </>;
            })}</div> : <div class="hint">no return values</div>}
          </div>
        )}
        {id === 'Start' && w.model.startTo.length > 0 && (
          <div class="in"><h5>Then</h5><div class="ports">
            <span class="p" style="color:var(--ok)">ok</span><span class="from">→ {w.model.startTo.map(labelOf).join(', ')}</span>
          </div></div>
        )}
        {id === 'Exit' && w.model.exitFrom.length > 0 && (
          <div class="in"><h5>Reached from</h5><div class="ports">
            {w.model.exitFrom.map((e) => <>
              <span class="p" style={`color:var(--${e.arm === 'fail' ? 'err' : 'ok'})`}>{e.arm === 'fail' ? 'failure' : 'ok'}</span>
              <span class="from">← {labelOf(e.from)}</span>
            </>)}
          </div></div>
        )}
        {id === 'Start' && <PackTags deploy={w.deploy} />}
        {(w.params.some((p) => p.description) || w.returns.some((p) => p.description)) && (
          <div class="in"><div class="ports">
            {(id === 'Start' ? w.params : w.returns).filter((p) => p.description).map((p) => <><span class="p">{p.name}</span><span class="hint">{p.description}</span></>)}
          </div></div>
        )}
      </div>
    </>
  );
}


/**
 * What a pack's annotations said, by namespace. A tag handler parses
 * `@runner`, `@secret` and the rest into `deploy.<namespace>`, and until
 * now that was the last anyone saw of it.
 */
function PackTags({ deploy }: { deploy: Deploy | null }) {
  if (!deploy) return null;
  return (
    <>
      {Object.entries(deploy).map(([ns, values]) => (
        <div class="in" key={ns}>
          <h5>{ns} tags</h5>
          <div class="kv">
            {Object.entries(values).map(([k, v]) => <><span class="k">{k}</span><Value value={v} /></>)}
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * A value that can be replaced while a session is paused: the debugger's
 * `setVariable`, which takes effect before the next node reads it.
 */
function EditableValue({ value, onSet }: { value: unknown; onSet: (v: unknown) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const open = () => { setText(JSON.stringify(value)); setErr(''); setEditing(true); };
  const commit = async () => {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { setErr('not valid JSON'); return; }
    try { await onSet(parsed); setEditing(false); toast('value set'); } catch (e) { setErr((e as Error).message); }
  };
  if (!editing) return <><Value value={value} /> <button class="linkish" title="Change this value" onClick={open}>edit</button>{' '}</>;
  return (
    <span class="editval">
      <input type="text" class="mono" value={text} placeholder='a JSON value: "text", 42, true, { … }' onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void commit(); if (e.key === 'Escape') setEditing(false); }} autoFocus />
      <button class="btn primary sm" onClick={commit}>Set</button>
      <button class="btn sm" onClick={() => setEditing(false)}>Cancel</button>
      {err && <span class="err">{err}</span>}
    </span>
  );
}


/** The way into the guide from beside a workflow: the one search, and the front page. */
function DocsSearch() {
  return (
    <div class="card">
      <h3>Guide<span class="sp" /><button class="linkish" onClick={() => openDoc('orientation')}>open</button></h3>
      <div class="in">
        <button class="searchbtn" onClick={() => { ui.search.value = true; }}>
          <span class="ms">search</span><span>Search the guide, workflows, packs, commands…</span><span class="sp" /><Keys combo="mod+K" />
        </button>
      </div>
    </div>
  );
}

/**
 * Everything wrong with this workflow, grouped by where it lives.
 *
 * Issues attached to a step were only visible by selecting that step, so a
 * workflow with five warnings spread across it had no screen that said so.
 * Clicking one goes to the step it belongs to.
 */
function IssuesPane({ w }: { w: ParsedWorkflow }) {
  const workflowLevel = w.issues.filter((i) => !i.node);
  const byNode = new Map<string, Issue[]>();
  for (const i of w.issues) {
    if (!i.node) continue;
    const list = byNode.get(i.node) ?? [];
    list.push(i);
    byNode.set(i.node, list);
  }
  return (
    <>
      {workflowLevel.length > 0 && (
        <div class="card">
          <h3>Workflow</h3>
          <div class="in"><IssueList issues={workflowLevel} w={w} /></div>
        </div>
      )}
      {[...byNode].map(([node, issues]) => (
        <div class="card" key={node}>
          <h3>
            <button class="linkish" onClick={() => { sel.value = node; ui.side.value = 'step'; }}>
              {w.nodes[node]?.label ?? node}
            </button>
            <span class="mono">{node}</span>
          </h3>
          <div class="in"><IssueList issues={issues} w={w} /></div>
        </div>
      ))}
    </>
  );
}

/**
 * Four panes rather than one long stack.
 *
 * With a run going, a selected step and the annotations open, the stack was
 * six cards and 2000px in a 350px column: the run status and the step you
 * clicked pushed each other off screen. These three are alternatives -- what
 * is happening now, what this step is, and reference you consult
 * deliberately -- so only one is on screen at a time, and what belongs
 * together (a step and its code) stays together.
 */
export function Inspector() {
  const w = wf.value;
  if (!isParsed(w)) return null;
  // Every issue, not only the workflow-level ones: a tab called Issues that
  // omitted the ones attached to steps would be lying about the count.
  const allIssues = w.issues;
  const errs = allIssues.filter((i) => i.severity === 'error').length;
  const pane = ui.side.value;
  const selected = sel.value;
  const runLabel = run.value
    ? run.value.debug?.status === 'paused' ? 'Paused'
      : run.value.status === 'waiting' ? 'Gate' : run.value.status === 'running' ? 'Running' : 'Run'
    : 'Run';
  // The Step tab wears the selected node type's own icon, as its tile does.
  const selNode = selected ? w.nodes[selected] : undefined;
  const selStep = selected ? findStep(selected, w.model.steps) : null;
  const stepIcon = !selected ? 'adjust'
    : selected === 'Start' ? 'play_arrow' : selected === 'Exit' ? 'flag'
    : selNode?.icon ?? kindIcon(selStep?.kind === 'loop' ? 'loop' : selNode?.effect ? 'effect' : selNode?.gate ?? (selStep?.pull ? 'pull' : null)) ?? 'adjust';
  const stepColor = selNode ? (colorVar(selNode.color) ?? (selNode.gate ? 'var(--gate)' : selStep?.kind === 'loop' ? 'var(--loop)' : null)) : null;
  const folded: SidePane[] = ['reference', 'changes', 'export'];
  const [showMore, setShowMore] = useState(false);
  const moreOpen = showMore || folded.includes(pane);
  useEffect(() => { if (!folded.includes(pane)) setShowMore(false); }, [pane]);
  return (
    <>
      <div class="panes">
        <PaneTab icon={run.value ? (run.value.debug?.status === 'paused' ? 'pause_circle' : run.value.status === 'waiting' ? 'how_to_reg' : run.value.status === 'running' ? 'play_circle' : 'check_circle') : 'play_circle'} label={runLabel} on={pane === 'run'} onClick={() => { ui.side.value = 'run'; }} />
        <PaneTab
          icon={stepIcon}
          iconColor={stepColor}
          label={selected ? (selected === 'Start' || selected === 'Exit' ? selected : w.nodes[selected]?.label ?? selected) : 'Step'}
          on={pane === 'step'} disabled={!selected} onClick={() => { ui.side.value = 'step'; }} />
        {allIssues.length > 0 && (
          <PaneTab icon={errs > 0 ? 'error' : 'warning'} label="Issues" on={pane === 'issues'} onClick={() => { ui.side.value = 'issues'; }}>
            <span class={`issuecount ${errs > 0 ? 'err' : 'warn'}`}>{allIssues.length}</span>
          </PaneTab>
        )}
        <PaneTab icon="dns" label="Serve" on={pane === 'serve'} onClick={() => { ui.side.value = 'serve'; }} />
        {/* The panes read now and then fold behind one button until one is
            wanted; the one in use stays out. Export only when a pack provides
            a target: a tab with nothing behind it would be a promise. */}
        {moreOpen ? (
          <>
            <PaneTab icon="data_object" label="Reference" on={pane === 'reference'} onClick={() => { ui.side.value = 'reference'; }} />
            <PaneTab icon="difference" label="Changes" on={pane === 'changes'} onClick={() => { ui.side.value = 'changes'; }} />
            {targets.value.length > 0 && <PaneTab icon="output" label="Export" on={pane === 'export'} onClick={() => { ui.side.value = 'export'; }} />}
          </>
        ) : (
          <PaneTab icon="more_horiz" label="More" on={false} onClick={() => setShowMore(true)} />
        )}
      </div>
      <div class="panebody">
        {pane === 'run' && (
          <>
            {run.value ? <RunCard w={w} /> : <NewRunCard w={w} />}
            <RunHistory w={w} />
          </>
        )}
        {pane === 'issues' && <IssuesPane w={w} />}
        {pane === 'step' && (selected
          ? selected === 'Start' || selected === 'Exit' ? <TerminalCard id={selected} w={w} /> : <StepCard id={selected} w={w} />
          : <div class="hint" style="padding:12px">Pick a step in the process.</div>)}
        {pane === 'changes' && <ChangesPane w={w} />}
        {pane === 'reference' && (
          <>
            <ReferencePane w={w} />
            <DocsSearch />
          </>
        )}
        {pane === 'export' && <ExportPane w={w} />}
        {pane === 'serve' && <ServePane w={w} />}
      </div>
    </>
  );
}
