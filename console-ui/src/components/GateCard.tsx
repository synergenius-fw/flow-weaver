import { useState, useMemo } from 'preact/hooks';
import { wf, resolveGate, type Gate, type FieldSchema } from '../state';
import { store } from '../api';
import { Value } from './Value';
import { SchemaForm, validateFields, blank, type Errors } from './SchemaForm';

const WHO: Record<Gate['kind'], string> = { approval: 'Decide', input: 'Provide input', agent: 'Answer as the agent' };

/** The form under a waiting gate: what the gate handed over, and the answer it needs. */
export function GateCard({ gate }: { gate: Gate }) {
  const w = wf.value!;
  const key = `answer:${w.file}:${gate.node}`;
  // One field per declared data output, in declared order; the schema only
  // supplies the shape. Control ports are the engine's to fill in.
  const fields = useMemo<Record<string, FieldSchema>>(
    () => Object.fromEntries(gate.outputs.map((o) => [o, gate.outputSchema?.[o] ?? ({ type: 'any', text: gate.outputTypes[o] } as FieldSchema)])),
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
  const inputs = Object.entries(gate.inputs);
  return (
    <div class="gatecard">
      <div class="gh"><b>{WHO[gate.kind] ?? 'Answer'}</b><span>{gate.node} · {gate.kind}</span></div>
      {inputs.length > 0 && (
        <section><div class="kv">
          {inputs.map(([k, v]) => <><span class="k">{k}</span><Value value={v} open={typeof v === 'object' && v !== null && JSON.stringify(v).length < 1500} /></>)}
        </div></section>
      )}
      <section>
        {gate.outputs.length
          ? <SchemaForm fields={fields} value={value} errors={errors} onChange={setValue} />
          : <div class="hint" style="margin-bottom:8px">nothing to return</div>}
        {rejecting && <div class="field"><label><span>reason</span></label><input type="text" value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} placeholder="why it is rejected — the workflow reads it on its failure port" /></div>}
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
