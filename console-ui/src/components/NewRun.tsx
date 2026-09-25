import { useState, useMemo, useEffect } from 'preact/hooks';
import { startRun, breakpoints, toggleBreakpoint, errorCount, toast, flatSteps, agents, loadAgents, profileForStep, openAgents, type ParsedWorkflow, type FieldSchema, type Node, type Step } from '../state';
import { store } from '../api';
import { quoteArg } from '../shell';
import { SchemaForm, validateFields, blank, type Errors } from './SchemaForm';
import { Keys } from './Tip';
import { Select } from './Select';
import { AgentPick } from './AgentPick';

/**
 * The New run card: what the workflow is given, who answers its gates while
 * it runs, and how it runs -- straight through or a step at a time.
 *
 * Everything typed here is remembered per workflow in this browser, and a
 * set of parameters can be kept under a name for next time. The same run
 * can be copied out as the `fw run` command line.
 */

interface Preset { name: string; params: Record<string, unknown> }

/** What the person decided about each stand-in: on or off, and the answer. */
interface Mocking { on: Record<string, boolean>; answers: Record<string, Record<string, unknown>>; fast: boolean }

const paramFields = (w: ParsedWorkflow): Record<string, FieldSchema> => {
  const help = Object.fromEntries(w.params.map((p) => [p.name, p.description]));
  const base = w.paramsSchema ?? Object.fromEntries(w.params.map((p) => [p.name, { type: /^string$/.test(p.tsType) ? 'string' : /^number$/.test(p.tsType) ? 'number' : /^boolean$/.test(p.tsType) ? 'boolean' : 'any', optional: p.optional, text: p.tsType } as FieldSchema]));
  return Object.fromEntries(Object.entries(base).map(([k, f]) => [k, help[k] ? { ...f, help: help[k] } : f]));
};

/** The steps a mock can stand in for: every gate, each call to another workflow, and whether there are delays to skip. */
function mockable(w: ParsedWorkflow) {
  const steps = flatSteps(w.model.steps);
  return {
    gates: steps.filter((s) => s.kind === 'pause'),
    calls: steps.filter((s) => w.nodes[s.id]?.type === 'invokeWorkflow'),
    delays: steps.filter((s) => w.nodes[s.id]?.type === 'delay').length,
  };
}

/** The answer a stand-in gives: one field per data output the step declares. */
function answerFields(node: Node | undefined, step: Step): Record<string, FieldSchema> {
  const outs = step.kind === 'pause' ? step.gateOutputs : ['result'];
  return Object.fromEntries(outs.map((o) => [o, node?.outputSchema?.[o] ?? ({ type: 'any', text: node?.outputs.find((p) => p.name === o)?.tsType } as FieldSchema)]));
}

/** The mock config the server takes, from what is switched on. */
function buildMocks(w: ParsedWorkflow, m: Mocking): Record<string, unknown> {
  const { gates, calls, delays } = mockable(w);
  const out: Record<string, unknown> = {};
  const g: Record<string, unknown> = {};
  for (const s of gates) if (m.on[s.id]) g[s.id] = m.answers[s.id] ?? {};
  if (Object.keys(g).length) out.gates = g;
  const inv: Record<string, unknown> = {};
  for (const s of calls) if (m.on[s.id]) inv[`${s.id}:*`] = m.answers[s.id]?.result ?? {};
  if (Object.keys(inv).length) out.invocations = inv;
  if (delays && m.fast) out.fast = true;
  return out;
}

const WHO: Record<string, string> = { approval: 'a person decides', input: 'a person or system answers', agent: 'an agent answers', timer: 'the clock wakes it' };

export function NewRunCard({ w }: { w: ParsedWorkflow }) {
  const fields = useMemo(() => paramFields(w), [w]);
  const key = `${w.file}:${w.name}`;
  const [value, setValue] = useState<Record<string, unknown>>(() => store.get(`params:${key}`, blank({ type: 'object', fields }) as Record<string, unknown>) ?? {});
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState('');
  const [mode, setMode] = useState<'run' | 'debug'>(() => (store.get(`debug:${key}`, false) ? 'debug' : 'run'));
  const [runTo, setRunTo] = useState<'first' | 'breakpoint'>(() => store.get(`runTo:${key}`, 'first'));
  const [mocking, setMocking] = useState<Mocking>(() => store.get(`mocks:${key}`, { on: {}, answers: {}, fast: true }));
  const [mockErrors, setMockErrors] = useState<Record<string, Errors>>({});
  const [presets, setPresets] = useState<Preset[]>(() => store.get(`presets:${key}`, []));
  const [preset, setPreset] = useState('');
  const [naming, setNaming] = useState<string | null>(null);
  const [mocksOpen, setMocksOpen] = useState(true);
  // Whether the agent gates of this run go to a profile or wait for a person.
  const [autoAgents, setAutoAgents] = useState<boolean>(() => store.get(`agents:${key}`, true));

  useEffect(() => {
    setValue(store.get(`params:${key}`, blank({ type: 'object', fields }) as Record<string, unknown>) ?? {}); setErrors({});
    setMode(store.get(`debug:${key}`, false) ? 'debug' : 'run'); setRunTo(store.get(`runTo:${key}`, 'first'));
    setMocking(store.get(`mocks:${key}`, { on: {}, answers: {}, fast: true })); setMockErrors({});
    setPresets(store.get(`presets:${key}`, [])); setPreset(''); setNaming(null);
    setAutoAgents(store.get(`agents:${key}`, true));
  }, [key]);
  useEffect(() => { if (!agents.value) void loadAgents().catch(() => undefined); }, []);

  const { gates, calls, delays } = useMemo(() => mockable(w), [w]);
  const standIns = [...gates, ...calls];
  const onCount = standIns.filter((s) => mocking.on[s.id]).length;
  const bps = [...breakpoints.value];
  const unmockedGate = gates.some((s) => !mocking.on[s.id]);

  const keep = (m: Mocking) => { setMocking(m); store.set(`mocks:${key}`, m); };
  const pickMode = (m: 'run' | 'debug') => { setMode(m); store.set(`debug:${key}`, m === 'debug'); };
  const pickRunTo = (r: 'first' | 'breakpoint') => { setRunTo(r); store.set(`runTo:${key}`, r); };

  const check = (): boolean => {
    const errs = validateFields(fields, value); setErrors(errs);
    const me: Record<string, Errors> = {};
    for (const s of standIns) if (mocking.on[s.id]) {
      const e = validateFields(answerFields(w.nodes[s.id], s), mocking.answers[s.id] ?? {});
      if (Object.keys(e).length) me[s.id] = e;
    }
    setMockErrors(me);
    return !Object.keys(errs).length && !Object.keys(me).length;
  };
  const go = async () => {
    if (!check()) return;
    setFailure('');
    try { await startRun(value, { debug: mode === 'debug', runTo, mocks: buildMocks(w, mocking), agents: autoAgents ? 'auto' : 'manual' }); } catch (e) { setFailure((e as Error).message); }
  };
  const pickAgents = (on: boolean) => { setAutoAgents(on); store.set(`agents:${key}`, on); };
  // The agent gates that are not mocked: the ones a profile would be asked about.
  const agentGates = gates.filter((s) => s.gate === 'agent' && !mocking.on[s.id]);
  const profiles = agents.value;

  /** The same run as a command line, for a script or a message to a colleague. */
  const asCli = (): string => {
    const parts = ['fw', 'run', quoteArg(w.rel), '--workflow', w.name];
    if (Object.values(value).some((v) => v !== undefined)) parts.push('--params', quoteArg(JSON.stringify(value)));
    const m = buildMocks(w, mocking);
    if (Object.keys(m).length) parts.push('--mocks', quoteArg(JSON.stringify(m)));
    if (mode === 'debug') { parts.push('--debug'); if (bps.length) parts.push('--breakpoint', ...bps.map(quoteArg)); }
    return parts.join(' ');
  };
  const copy = async () => { try { await navigator.clipboard.writeText(asCli()); toast('copied as fw run'); } catch { toast(asCli()); } };

  const savePreset = (name: string) => {
    const n = name.trim(); if (!n) return;
    const next = [...presets.filter((p) => p.name !== n), { name: n, params: value }];
    setPresets(next); store.set(`presets:${key}`, next); setPreset(n); setNaming(null);
  };
  const loadPreset = (name: string) => {
    setPreset(name);
    const p = presets.find((x) => x.name === name);
    if (p) { setValue(p.params); setErrors({}); }
  };
  const dropPreset = () => {
    const next = presets.filter((p) => p.name !== preset);
    setPresets(next); store.set(`presets:${key}`, next); setPreset('');
  };

  return (
    <div class="card newrun" onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void go(); } }}>
      <h3>New run<span class="sp" />
        {naming === null
          ? <div class="presets">
            {presets.length > 0 && <Select value={preset} placeholder="presets…" onChange={loadPreset} options={presets.map((p) => ({ value: p.name, label: p.name }))} />}
            {preset && <button class="btn ghost sm" title="Forget this preset" onClick={dropPreset}>delete</button>}
            <button class="btn ghost sm" title="Keep these parameters under a name" onClick={() => setNaming(preset)}>save</button>
          </div>
          : <div class="presets">
            <input type="text" value={naming} placeholder="preset name" autoFocus onInput={(e) => setNaming((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); savePreset(naming); } if (e.key === 'Escape') setNaming(null); }} />
            <button class="btn sm" onClick={() => savePreset(naming)}>keep</button>
            <button class="btn ghost sm" onClick={() => setNaming(null)}>cancel</button>
          </div>}
      </h3>

      <div class="in">
        {Object.keys(fields).length
          ? <SchemaForm title="Parameters" fields={fields} value={value} errors={errors} onChange={setValue} />
          : <><h5>Parameters</h5><div class="hint">This workflow takes none.</div></>}
      </div>

      {standIns.length + (delays ? 1 : 0) > 0 && (
        <div class="in">
          <h5 class="fold" onClick={() => setMocksOpen(!mocksOpen)}>
            <span>Mocks</span><span class="hint">{onCount ? `${onCount} of ${standIns.length} answered here` : 'answer gates and calls without waiting'}</span><span class="sp" /><span class="ms">{mocksOpen ? 'expand_less' : 'expand_more'}</span>
          </h5>
          {mocksOpen && (
            <>
              {standIns.map((s) => {
                const node = w.nodes[s.id];
                const on = !!mocking.on[s.id];
                const af = answerFields(node, s);
                return (
                  <div class={`mock ${on ? 'on' : ''}`} key={s.id}>
                    <label class="check">
                      <input type="checkbox" checked={on} onChange={(e) => keep({ ...mocking, on: { ...mocking.on, [s.id]: (e.target as HTMLInputElement).checked } })} />
                      <b>{s.label}</b>
                      <span class="hint">{s.kind === 'pause' ? `${s.gate} gate: ${WHO[s.gate ?? ''] ?? 'the run pauses'}` : 'calls another workflow'}</span>
                    </label>
                    {on && (
                      <div class="body">
                        {Object.keys(af).length
                          ? <SchemaForm plain fields={af} value={mocking.answers[s.id] ?? {}} errors={mockErrors[s.id] ?? {}} onChange={(v) => keep({ ...mocking, answers: { ...mocking.answers, [s.id]: v } })} />
                          : <div class="hint">Nothing to return: the gate is passed.</div>}
                      </div>
                    )}
                  </div>
                );
              })}
              {delays > 0 && (
                <label class="check">
                  <input type="checkbox" checked={mocking.fast} onChange={(e) => keep({ ...mocking, fast: (e.target as HTMLInputElement).checked })} />
                  <span>Skip delays</span><span class="hint">{delays} delay step{delays > 1 ? 's' : ''} return at once</span>
                </label>
              )}
            </>
          )}
        </div>
      )}

      {agentGates.length > 0 && (
        <div class="in">
          <h5>Agents<span class="hint" style="margin-left:8px;text-transform:none;letter-spacing:0">{profiles?.exists ? `${profiles.agents.filter((p) => p.ready).length} of ${profiles.agents.length} profile${profiles.agents.length === 1 ? '' : 's'} ready` : 'no profiles in this project'}</span></h5>
          <label class="check">
            <input type="checkbox" checked={autoAgents} onChange={(e) => pickAgents((e.target as HTMLInputElement).checked)} />
            <span>Let a profile answer the agent gates</span>
          </label>
          <div class="agentgates">
            {agentGates.map((s) => (
              <div class="agentgate" key={s.id}>
                <span class="ms">smart_toy</span>
                <span>{s.label}</span>
                <span class="to">answered by</span>
                {profiles?.agents.length
                  ? <AgentPick workflow={w.name} node={s.id} disabled={!autoAgents} />
                  : <span class="hint" style="text-transform:none;letter-spacing:0">whoever answers it, here or over MCP. <button class="linkish" onClick={openAgents}>Add a profile</button></span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div class="in">
        <h5>How</h5>
        <div class="seg"><button class={mode === 'run' ? 'on' : ''} onClick={() => pickMode('run')}>Run</button><button class={mode === 'debug' ? 'on' : ''} onClick={() => pickMode('debug')}>Step through</button></div>
        {mode === 'debug' && (
          <div class="dbgopts">
            <label class="radio"><input type="radio" name="runto" checked={runTo === 'first'} onChange={() => pickRunTo('first')} /><span>Pause before the first step</span></label>
            <label class={`radio ${bps.length ? '' : 'off'}`}><input type="radio" name="runto" disabled={!bps.length} checked={runTo === 'breakpoint' && bps.length > 0} onChange={() => pickRunTo('breakpoint')} /><span>Run to the first breakpoint</span></label>
            <div class="bps">
              {bps.map((id) => <span class="chip" key={id}>{w.nodes[id]?.label ?? id}<button type="button" title="Remove breakpoint" onClick={() => toggleBreakpoint(id)}>×</button></span>)}
              {!bps.length && <span class="hint">No breakpoints. Click a step's tile to set one.</span>}
            </div>
            {unmockedGate && <div class="hint">Stops at the first gate that is not answered here: the debugger cannot hold one.</div>}
          </div>
        )}
      </div>

      <div class="in formfoot">
        <button class="btn primary sm" disabled={errorCount.value > 0} title={errorCount.value > 0 ? 'Fix the errors first' : undefined} onClick={go}>{mode === 'debug' ? 'Debug' : 'Run'}</button>
        <span class="shortcut-hint"><Keys combo="mod+enter" /></span>
        <button class="btn ghost sm" title="Copy this run as an fw run command" onClick={copy}>copy as CLI</button>
        <span class="err">{failure}</span>
      </div>
    </div>
  );
}
