import { useState, useMemo } from 'preact/hooks';
import { wf, resolveGate, type Gate, type Due, type FieldSchema } from '../state';
import { store } from '../api';
import { Value } from './Value';
import { SchemaForm, validateFields, blank, type Errors } from './SchemaForm';

const WHO: Record<Gate['kind'], string> = { approval: 'Decide', input: 'Provide input', agent: 'Answer as the agent', timer: 'Sleeping' };

const when = (ms: number) => {
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

/** One line on what the clock will do to a waiting run, and when. */
function DueLine({ due, kind }: { due: Due; kind: Gate['kind'] }) {
  const past = due.at <= Date.now();
  const verb = kind === 'timer' ? (past ? 'wakes the next time it is checked' : `wakes at ${when(due.at)}`) : (past ? 'timed out, takes its failure path the next time it is checked' : `times out at ${when(due.at)}, then takes its failure path`);
  return <div class="hint" style="margin-bottom:8px">{verb}. Checked every few seconds while this console or the server is up.</div>;
}

/** What the gate hands over, each value under the name the author gave the port. */
function Handed({ gate }: { gate: Gate }) {
  const inputs = Object.entries(gate.inputs);
  if (!inputs.length) return null;
  return (
    <section><div class="kv">
      {inputs.map(([k, v]) => (
        <>
          <span class="k">{k}</span>
          <Value value={v} open={typeof v === 'object' && v !== null && JSON.stringify(v).length < 1500} />
          {gate.inputLabels?.[k] && gate.inputLabels[k] !== k && <span class="khelp">{gate.inputLabels[k]}</span>}
        </>
      ))}
    </div></section>
  );
}

/** The form under a waiting gate: what the gate handed over, and the answer it needs. */
export function GateCard({ gate, due }: { gate: Gate; due?: Due }) {
  const w = wf.value!;
  const key = `answer:${w.file}:${gate.node}`;
  // One field per declared data output, in declared order: the schema gives
  // the shape, the @output label the words under the field. Control ports
  // are the engine's to fill in.
  const fields = useMemo<Record<string, FieldSchema>>(
    () => Object.fromEntries(gate.outputs.map((o) => {
      const schema = gate.outputSchema?.[o] ?? ({ type: 'any', text: gate.outputTypes[o] } as FieldSchema);
      const label = gate.outputLabels?.[o];
      return [o, label && !schema.help ? { ...schema, help: label } : schema];
    })),
    [gate.id],
  );
  const [value, setValue] = useState<Record<string, unknown>>(() => store.get(key, blank({ type: 'object', fields }) as Record<string, unknown>) ?? {});
  const [errors, setErrors] = useState<Errors>({});
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (payload: { answer: unknown } | { reject: string }) => {
    setBusy(true); setFailure('');
    try { await resolveGate(payload); } catch (e) { setFailure((e as Error).message); } finally { setBusy(false); }
  };
  const answer = () => {
    const errs = validateFields(fields, value);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    store.set(key, value);
    void submit({ answer: gate.outputs.length === 1 ? value[gate.outputs[0]] : gate.outputs.length ? value : null });
  };
  const asked = gate.description?.trim();
  if (gate.kind === 'timer') {
    // Nothing to answer: the clock does. A person can cut the sleep short.
    return (
      <div class="gatecard">
        <div class="gh"><b>{WHO.timer}</b><span>{gate.node} ({gate.kind})</span></div>
        <Handed gate={gate} />
        <section>
          {due && <DueLine due={due} kind="timer" />}
          <div class="formfoot">
            <button class="btn primary sm" disabled={busy} onClick={() => void submit({ answer: gate.outputs.length ? new Date().toISOString() : null })}>Wake now</button>
            <span class="err">{failure}</span>
          </div>
        </section>
      </div>
    );
  }
  return (
    <div class="gatecard">
      <div class="gh"><b>{WHO[gate.kind] ?? 'Answer'}</b><span>{gate.node} ({gate.kind})</span></div>
      {asked && <section><div class="asked">{asked}</div></section>}
      <Handed gate={gate} />
      <section>
        {due && <DueLine due={due} kind={gate.kind} />}
        {gate.outputs.length
          ? <SchemaForm fields={fields} value={value} errors={errors} onChange={setValue} />
          : <div class="hint" style="margin-bottom:8px">nothing to return</div>}
        {rejecting && <div class="field"><label><span>reason</span></label><input type="text" value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} placeholder="why it is rejected (the workflow reads it on its failure port)" /></div>}
        <div class="formfoot">
          {rejecting
            ? <><button class="btn primary sm" disabled={busy} onClick={() => submit({ reject: reason || 'rejected' })}>Reject</button><button class="btn sm" onClick={() => setRejecting(false)}>Back</button></>
            : <><button class="btn primary sm" disabled={busy} onClick={answer}>Continue</button>{gate.hasFailurePort && <button class="btn sm" onClick={() => setRejecting(true)}>Reject</button>}</>}
          <span class="err">{failure}</span>
        </div>
      </section>
    </div>
  );
}
