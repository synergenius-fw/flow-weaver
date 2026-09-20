import { agents, setGateProfile, toast } from '../state';
import { Select, type Opt } from './Select';

/**
 * Which profile answers one gate: a menu on the step, writing the mapping
 * to `.flowweaver/agents.yaml` as `workflow/node: profile`. "Default" is no
 * mapping of its own -- the gate falls back to its agentId and the default
 * profile; "a person" is the same when there is no default.
 */
export function AgentPick({ workflow, node, disabled }: { workflow: string; node: string; disabled?: boolean }) {
  const a = agents.value;
  if (!a) return null;
  const key = `${workflow}/${node}`;
  const value = a.gates[key] ?? '';
  const fallback = a.default ? `the default, ${a.default}` : 'whoever drives the run';
  const options: Opt[] = [
    { value: '', label: fallback, text: fallback },
    ...a.agents.map((p) => ({ value: p.name, label: <>{p.name}<span class="opt-ns"> ({p.provider}{p.ready ? '' : ', not ready'})</span></>, text: p.name })),
  ];
  const chosen = a.agents.find((p) => p.name === (value || a.default));
  return (
    <span class="agentpick">
      <Select
        value={value}
        options={options}
        disabled={disabled}
        onChange={(v) => { setGateProfile(key, v || null).catch((e: Error) => toast(e.message)); }}
      />
      {chosen && <span class={`sdot ${chosen.ready ? 'ok' : 'bad'}`} title={chosen.reason ?? 'ready'} />}
    </span>
  );
}
