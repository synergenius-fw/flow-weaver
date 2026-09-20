import { useEffect, useState } from 'preact/hooks';
import { view, agents, loadAgents, openDoc, toast, workflows, saveProfile, deleteProfile, setDefaultProfile, setGateProfile, tryAgentProfile, envIsSet, type AgentProfileView, type ProfileFields, type TryOutcome } from '../state';
import { editorLink } from '../format';
import { CliPane } from './Cli';
import { PaneTab } from './PaneTab';
import { Select } from './Select';

type Provider = AgentProfileView['provider'];

const PROVIDERS: Array<{ id: Provider; title: string; blurb: string; needs: string; icon: string; keyEnv?: string; model: string }> = [
  { id: 'anthropic', title: 'Anthropic API', blurb: 'Claude, over the API.', needs: 'ANTHROPIC_API_KEY in the environment', icon: 'auto_awesome', keyEnv: 'ANTHROPIC_API_KEY', model: 'claude-sonnet-5' },
  { id: 'openai', title: 'OpenAI-compatible', blurb: 'OpenAI, Groq, GitHub Models, or a local Ollama, vLLM, LM Studio.', needs: 'a key variable, or just a base URL for a local server', icon: 'hub', keyEnv: 'OPENAI_API_KEY', model: 'gpt-4o' },
  { id: 'claude-cli', title: 'Claude Code', blurb: 'The claude command on this machine, with its own login.', needs: 'claude on PATH; nothing else', icon: 'terminal', model: '' },
];
const providerOf = (id: Provider) => PROVIDERS.find((p) => p.id === id)!;

/**
 * The project's agent profiles: what answers a `waitForAgent` gate when
 * nobody is watching. Adding one is picking a provider and filling a short
 * form; the file it writes is a detail behind the page. A key is never
 * typed here -- only the name of the variable that holds it, checked live.
 */
export function AgentsView() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);   // profile name, or '' for a new one
  const [starting, setStarting] = useState<Provider | null>(null);
  const [showFile, setShowFile] = useState(false);
  const load = () => { setBusy(true); setError(''); loadAgents().catch((e: Error) => setError(e.message)).finally(() => setBusy(false)); };
  useEffect(() => { if (view.value.kind === 'agents') { load(); setEditing(null); setStarting(null); } }, [view.value.kind]);
  if (view.value.kind !== 'agents') return null;
  const a = agents.value;
  const gated = workflows.value.filter((w) => w.gates > 0).length;
  const none = !!a && a.agents.length === 0;
  const rel = a ? a.file.replace(/^.*[\\/](\.flowweaver[\\/]agents\.yaml)$/, '$1') : '.flowweaver/agents.yaml';

  return (
    <div class="docview agentsview">
      <div class="dochead">
        <h1>Agents</h1>
        <p class="lede">A model that answers an agent gate while nobody is watching, named in the project and called from inside the run.</p>
        <div class="docactions">
          {a && !none && <button class="btn primary sm" onClick={() => { setStarting(null); setEditing(''); }}>Add a profile</button>}
          <button class="btn sm" onClick={() => openDoc('durable-gates', 'agent-profiles')}>How it works</button>
          <button class="btn sm" disabled={busy} onClick={load}>{busy ? 'Reading…' : 'Read again'}</button>
        </div>
      </div>
      {error && <div class="card"><div class="in" style="color:var(--err)">{error}</div></div>}
      {!a && !error && <div class="hint">Reading…</div>}

      {a && none && editing === null && (
        <div class="card welcome">
          <h3>Let a model answer your agent gates</h3>
          <div class="in">
            <p>{gated ? `${gated} workflow${gated === 1 ? '' : 's'} in this project pause${gated === 1 ? 's' : ''} at a gate.` : 'No workflow here has a gate yet.'} An agent gate waits for a person until a profile is here to answer it. Pick where the model comes from:</p>
            <div class="provcards">
              {PROVIDERS.map((p) => (
                <button class="provcard" key={p.id} onClick={() => { setStarting(p.id); setEditing(''); }}>
                  <span class="ms">{p.icon}</span>
                  <b>{p.title}</b>
                  <span>{p.blurb}</span>
                  <small>Needs {p.needs}.</small>
                </button>
              ))}
            </div>
            <div class="hint" style="margin-top:12px">Nothing is stored but a name for the key. <button class="linkish" onClick={() => setShowFile(!showFile)}>{showFile ? 'Hide the file' : 'Prefer to write the file yourself?'}</button></div>
            {showFile && <div class="starter"><pre class="mono">{a.starter}</pre><button class="btn sm" onClick={() => navigator.clipboard.writeText(a.starter).then(() => toast('copied'))}>copy</button></div>}
            {showFile && <div class="hint">It goes at <code>{rel}</code> in the project.</div>}
          </div>
        </div>
      )}

      {a && editing === '' && (
        <ProfileForm
          key="new"
          existing={null}
          start={starting}
          suggestions={a.suggestedModels}
          onDone={() => { setEditing(null); setStarting(null); }}
        />
      )}

      {a && a.errors.length > 0 && (
        <div class="card">
          <h3>Problems in {rel}</h3>
          <div class="in">{a.errors.map((e, i) => <div class="issue" key={i}><span class="mark" /><div>{e}</div></div>)}</div>
        </div>
      )}

      {a && !none && (
        <div class="card">
          <h3>Profiles<span class="hint" style="margin-left:8px">{a.agents.length}</span></h3>
          <div class="in reglist">
            {a.agents.map((p) => editing === p.name
              ? <ProfileForm key={p.name} existing={p} start={null} suggestions={a.suggestedModels} onDone={() => setEditing(null)} />
              : <ProfileRow key={p.name} p={p} isDefault={a.default === p.name} onEdit={() => { setStarting(null); setEditing(p.name); }} />)}
          </div>
        </div>
      )}

      {a && !none && (
        <div class="card">
          <h3>Which gate goes to which</h3>
          <div class="in">
            <p class="hint">A paused gate is matched by <code>workflow/node</code> first, then by its <code>agentId</code>, then the default{a.default ? <> (<b>{a.default}</b>)</> : ' — and there is none, so an unmatched gate waits for a person'}. The <b>answered by</b> menu on a gate's step writes a row here.</p>
            <GateMap gates={a.gates} profiles={a.agents} />
          </div>
        </div>
      )}

      {a && !none && (
        <div class="card">
          <h3>The file</h3>
          <div class="in hint">
            All of this is <code>{rel}</code>, versioned with the workflows. Edit it here or by hand; the console rewrites it whole, so a comment you add by hand does not survive a change made here. <a href={editorLink(a.file)}>Open it</a>.
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileRow({ p, isDefault, onEdit }: { p: AgentProfileView; isDefault: boolean; onEdit: () => void }) {
  const [trying, setTrying] = useState(false);
  const [tried, setTried] = useState<TryOutcome | null>(null);
  const prov = providerOf(p.provider);
  const tryIt = async () => {
    setTrying(true); setTried(null);
    try { setTried(await tryAgentProfile(p.name)); } catch (e) { setTried({ ok: false, ms: 0, error: (e as Error).message }); } finally { setTrying(false); }
  };
  return (
    <div class={`reg profile ${p.ready ? '' : 'notready'}`}>
      <div class="reghead">
        <span class="ms" style="color:var(--gate)">smart_toy</span>
        <b>{p.name}</b>
        {isDefault && <span class="pill">default</span>}
        <span class="regruns"><span class={`sdot ${p.ready ? 'ok' : 'bad'}`} /> {p.ready ? 'ready' : 'not ready'}</span>
      </div>
      <dl class="regkv">
        <dt>model</dt><dd>{p.model || <span class="opt-ns">the command's default</span>}<span class="opt-ns"> · {prov.title}</span></dd>
        {p.provider !== 'claude-cli' && <><dt>key</dt><dd class="mono">{p.keyEnv}<span class={`opt-ns ${p.ready ? '' : 'err'}`}> · {p.reason ?? 'set in the environment'}</span></dd></>}
        {p.provider === 'claude-cli' && <><dt>command</dt><dd class="mono">{p.bin ?? 'claude'}<span class={`opt-ns ${p.ready ? '' : 'err'}`}> · {p.ready ? 'on PATH' : p.reason}</span></dd></>}
        {p.baseUrl && <><dt>base URL</dt><dd class="mono break">{p.baseUrl}</dd></>}
        {p.system && <><dt>told</dt><dd class="sys">{p.system}</dd></>}
        {p.description && <><dt>about</dt><dd>{p.description}</dd></>}
      </dl>
      <div class="regactions">
        <button class="btn sm" onClick={onEdit}>Edit</button>
        <button class="btn sm" disabled={trying || !p.ready} title={p.ready ? 'One short reply, to see that it works' : p.reason ?? ''} onClick={tryIt}>{trying ? 'Trying…' : 'Try it'}</button>
        {!isDefault && <button class="btn ghost sm" onClick={() => setDefaultProfile(p.name).catch((e: Error) => toast(e.message))}>Make default</button>}
        {tried && (tried.ok
          ? <span class="tried ok"><span class="ms">check_circle</span> replied in {tried.ms} ms{tried.usage ? ` · ${tried.usage.promptTokens + tried.usage.completionTokens} tokens` : ''}{tried.text ? <span class="hint"> · “{tried.text.slice(0, 60)}”</span> : null}</span>
          : <span class="tried bad"><span class="ms">error</span> {tried.error}</span>)}
      </div>
    </div>
  );
}

/** One profile as a form. New or existing; nothing is written until Save. */
function ProfileForm({ existing, start, suggestions, onDone }: { existing: AgentProfileView | null; start: Provider | null; suggestions: Record<string, string[]>; onDone: () => void }) {
  const initialProvider: Provider = existing?.provider ?? start ?? 'anthropic';
  const [name, setName] = useState(existing?.name ?? (initialProvider === 'claude-cli' ? 'claude' : 'assistant'));
  const [provider, setProvider] = useState<Provider>(initialProvider);
  const [model, setModel] = useState(existing?.model ?? providerOf(initialProvider).model);
  const [keyEnv, setKeyEnv] = useState(existing?.keyEnv ?? providerOf(initialProvider).keyEnv ?? '');
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? '');
  const [bin, setBin] = useState(existing?.bin ?? '');
  const [system, setSystem] = useState(existing?.system ?? '');
  const [turns, setTurns] = useState(existing?.maxIterations ?? 8);
  const [description, setDescription] = useState(existing?.description ?? '');
  const [keySet, setKeySet] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState('');
  const [confirm, setConfirm] = useState(false);

  // The key's variable is checked as it is typed -- set or not, never its value.
  useEffect(() => {
    if (provider === 'claude-cli' || !keyEnv) { setKeySet(null); return; }
    let live = true;
    const t = setTimeout(() => { envIsSet(keyEnv).then((s) => { if (live) setKeySet(s); }).catch(() => { if (live) setKeySet(null); }); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [keyEnv, provider]);

  const pick = (p: Provider) => {
    setProvider(p);
    const d = providerOf(p);
    if (!existing) { setModel(d.model); setKeyEnv(d.keyEnv ?? ''); if (name === 'assistant' || name === 'claude') setName(p === 'claude-cli' ? 'claude' : 'assistant'); }
  };
  const local = provider === 'openai' && baseUrl && !keySet;
  const save = async () => {
    setSaving(true); setFailure('');
    const fields: ProfileFields = { provider, model: model || undefined, apiKeyEnv: provider === 'claude-cli' ? undefined : keyEnv || undefined, baseUrl: provider === 'openai' ? baseUrl || undefined : undefined, bin: provider === 'claude-cli' ? bin || undefined : undefined, system: system || undefined, maxIterations: turns, description: description || undefined };
    try { await saveProfile(name.trim(), fields); toast(existing ? 'profile saved' : `${name.trim()} added`); onDone(); }
    catch (e) { setFailure((e as Error).message); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    setSaving(true);
    try { await deleteProfile(existing!.name); toast('profile removed'); onDone(); } catch (e) { setFailure((e as Error).message); } finally { setSaving(false); }
  };
  const models = suggestions[provider] ?? [];

  return (
    <div class="card pform">
      <h3>{existing ? <>Edit <b>{existing.name}</b></> : 'New profile'}<span class="sp" /><button class="btn ghost sm" onClick={onDone}>Cancel</button></h3>
      <div class="in">
        <div class="field"><label><span>where the model comes from</span></label>
          <div class="seg">{PROVIDERS.map((p) => <button key={p.id} class={provider === p.id ? 'on' : ''} onClick={() => pick(p.id)}>{p.title}</button>)}</div>
          <div class="hint" style="margin-top:6px">{providerOf(provider).blurb} Needs {providerOf(provider).needs}.</div>
        </div>
        <div class="row2">
          <div class="field"><label><span>name</span><i>how gates refer to it</i></label>
            <input type="text" value={name} disabled={!!existing} placeholder="reviewer" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </div>
          <div class="field"><label><span>model</span>{provider === 'claude-cli' && <i>optional</i>}</label>
            <input type="text" value={model} placeholder={provider === 'claude-cli' ? "the command's default" : 'model id'} onInput={(e) => setModel((e.target as HTMLInputElement).value)} />
            {models.filter(Boolean).length > 0 && <div class="chips">{models.filter(Boolean).map((m) => <button key={m} class={`chip ${model === m ? 'on' : ''}`} onClick={() => setModel(m)}>{m}</button>)}</div>}
          </div>
        </div>
        {provider !== 'claude-cli' && (
          <div class="field"><label><span>key</span><i>the environment variable that holds it</i></label>
            <div class="withstat">
              <input type="text" class="mono" value={keyEnv} placeholder="MY_API_KEY" onInput={(e) => setKeyEnv((e.target as HTMLInputElement).value.toUpperCase())} />
              <span class={`stat ${keySet === true ? 'ok' : keySet === false ? (local ? 'warn' : 'bad') : ''}`}>{keySet === true ? 'set' : keySet === false ? (local ? 'not set · fine for a local server' : 'not set here') : ''}</span>
            </div>
            <div class="fhelp">Only the name is saved. The value is read from the shell that started the console or <code>fw serve</code>{keySet === false && !local ? <> — export it there and this turns green</> : ''}.</div>
          </div>
        )}
        {provider === 'openai' && (
          <div class="field"><label><span>base URL</span><i>optional</i></label>
            <input type="text" class="mono" value={baseUrl} placeholder="https://api.openai.com — or http://localhost:11434/v1 for Ollama" onInput={(e) => setBaseUrl((e.target as HTMLInputElement).value)} />
          </div>
        )}
        {provider === 'claude-cli' && (
          <div class="field"><label><span>command</span><i>optional</i></label>
            <input type="text" class="mono" value={bin} placeholder="claude — or a path to it" onInput={(e) => setBin((e.target as HTMLInputElement).value)} />
          </div>
        )}
        <div class="field"><label><span>what it is told</span><i>optional · goes before the gate's own instructions</i></label>
          <textarea rows={3} value={system} placeholder="You review files for risk. Be terse." onInput={(e) => setSystem((e.target as HTMLTextAreaElement).value)} />
        </div>
        <div class="row2">
          <div class="field"><label><span>turns</span><i>model calls before giving up</i></label>
            <input type="number" min={1} max={50} value={turns} onInput={(e) => setTurns(Number((e.target as HTMLInputElement).value) || 8)} />
          </div>
          <div class="field"><label><span>about</span><i>optional</i></label>
            <input type="text" value={description} placeholder="a note for the team" onInput={(e) => setDescription((e.target as HTMLInputElement).value)} />
          </div>
        </div>
        <div class="formfoot">
          <button class="btn primary sm" disabled={saving || !name.trim()} onClick={save}>{saving ? 'Saving…' : existing ? 'Save' : 'Add profile'}</button>
          {existing && !confirm && <button class="btn ghost sm" onClick={() => setConfirm(true)}>Remove</button>}
          {existing && confirm && <><span class="hint">remove {existing.name}?</span><button class="btn danger sm" disabled={saving} onClick={remove}>Yes, remove</button><button class="btn ghost sm" onClick={() => setConfirm(false)}>No</button></>}
          <span class="err">{failure}</span>
        </div>
      </div>
    </div>
  );
}

function GateMap({ gates, profiles }: { gates: Record<string, string>; profiles: AgentProfileView[] }) {
  const [key, setKey] = useState('');
  const [profile, setProfile] = useState(profiles[0]?.name ?? '');
  const opts = profiles.map((p) => ({ value: p.name, label: p.name }));
  const add = async () => {
    if (!key.trim() || !profile) return;
    try { await setGateProfile(key.trim(), profile); setKey(''); } catch (e) { toast((e as Error).message); }
  };
  return (
    <>
      {Object.keys(gates).length > 0 && (
        <div class="gatemap">
          {Object.entries(gates).map(([k, v]) => (
            <div class="gaterow" key={k}>
              <code>{k}</code>
              <span class="arrow">→</span>
              <Select value={v} options={opts} onChange={(nv) => setGateProfile(k, nv).catch((e: Error) => toast(e.message))} />
              <button class="btn ghost sm" title="Back to the default" onClick={() => setGateProfile(k, null).catch((e: Error) => toast(e.message))}>×</button>
            </div>
          ))}
        </div>
      )}
      <div class="gaterow add">
        <input type="text" class="mono" value={key} placeholder="agentId, or workflow/node" onInput={(e) => setKey((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') void add(); }} />
        <span class="arrow">→</span>
        <Select value={profile} options={opts} onChange={setProfile} />
        <button class="btn sm" disabled={!key.trim() || !profile} onClick={add}>Add</button>
      </div>
    </>
  );
}

/** The right column beside the Agents page: what to know, and the CLI. */
export function AgentsSide() {
  const [pane, setPane] = useState<'about' | 'cli'>('about');
  return (
    <>
      <div class="panes">
        <PaneTab icon="info" label="About" on={pane === 'about'} onClick={() => setPane('about')} />
        <PaneTab icon="terminal" label="CLI" on={pane === 'cli'} onClick={() => setPane('cli')} />
      </div>
      <div class="panebody">
        {pane === 'about' && (
          <div class="card">
            <h3>What the model gets</h3>
            <div class="in hint">The gate's inputs — <code>agentId</code>, <code>context</code>, <code>prompt</code> — and one tool to return the answer, shaped from the gate's output type. No files, no shell, no network of its own: what it needs goes in <code>context</code>. Its words stream onto the step while it works.</div>
            <h3>Keys</h3>
            <div class="in hint">A profile names the variable a key lives in and nothing more. The console reads it from the shell it was started in and says only whether it is set. Start the console or <code>fw serve</code> from a shell that has it.</div>
            <h3>Local models</h3>
            <div class="in hint">Ollama, vLLM or LM Studio on this machine is <b>OpenAI-compatible</b> with a base URL such as <code>http://localhost:11434/v1</code>. No key needed.</div>
            <h3>GitHub Models</h3>
            <div class="in hint">Also OpenAI-compatible: base URL <code>https://models.github.ai/inference</code>, key variable <code>GITHUB_TOKEN</code>.</div>
            <h3>Where it applies</h3>
            <div class="in hint">Runs started here and over <code>fw serve</code>, unless a run is started with agents off. A run an assistant drives over MCP is the assistant's to answer.</div>
          </div>
        )}
        {pane === 'cli' && <CliPane />}
      </div>
    </>
  );
}
