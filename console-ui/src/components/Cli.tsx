import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { cli, cliCommands, loadCliCommands, runCli, stopCli, project, wf, toast, type CliCommand, type CliRun } from '../state';
import { splitArgs } from '../shell';
import { ms } from '../format';
import { parseUsage, parseFlag, parseLine, composeLine, hasPlaceholder, type Filled, type Flag } from '../cli-model';
import { Tip, Keys } from './Tip';

/**
 * Completion for the command line, from the catalogue: commands while the
 * first word is being typed, a command's subcommands, then its flags.
 */
function suggest(line: string, commands: CliCommand[]): Array<{ text: string; hint: string }> {
  const words = splitArgs(line);
  const trailing = /\s$/.test(line) || !line;
  const typed = trailing ? '' : words[words.length - 1] ?? '';
  const before = (trailing ? words : words.slice(0, -1)).filter((w, i) => !(i === 0 && (w === 'fw' || w === 'flow-weaver')));
  if (!before.length) {
    const firsts = new Map<string, CliCommand>();
    for (const c of commands) if (!firsts.has(c.words[0])) firsts.set(c.words[0], c);
    return [...firsts.values()].filter((c) => c.words[0].startsWith(typed)).map((c) => ({ text: c.words[0], hint: c.words.length > 1 ? `${c.words.slice(1).join(' ')} …` : c.description }));
  }
  const subs = commands.filter((c) => c.words[0] === before[0] && c.words.length > 1 && before.length === 1);
  if (subs.length && !typed.startsWith('-')) return subs.filter((c) => c.words[1].startsWith(typed)).map((c) => ({ text: c.words[1], hint: c.description }));
  const cmd = commands.find((c) => c.words.every((w, i) => before[i] === w) && c.words.length <= before.length)
    ?? commands.find((c) => c.words[0] === before[0]);
  if (!cmd) return [];
  if (typed.startsWith('-') || trailing) {
    return cmd.flags.map(parseFlag).filter((f): f is Flag => !!f)
      .filter((f) => f.long.startsWith(typed) && !before.includes(f.long))
      .map((f) => ({ text: f.long, hint: `${f.description}${f.value ? ` ${f.value}` : ''}` }));
  }
  return [];
}

/** The output of one run: streamed while it runs, kept after, expandable to the window. */
function Output({ run: r, open, onToggle, onRerun, onRemove }: { run: CliRun; open: boolean; onToggle: () => void; onRerun: () => void; onRemove: () => void }) {
  const pre = useRef<HTMLPreElement>(null);
  const [full, setFull] = useState(false);
  useEffect(() => { if (open && r.running && pre.current) pre.current.scrollTop = pre.current.scrollHeight; }, [r.out, r.err, open]);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);
  const text = r.out + (r.err ? r.err : '');
  const copy = () => navigator.clipboard.writeText(text).then(() => toast('output copied'));
  const status = r.running ? 'running' : r.code === 0 ? ms(r.ms) : r.code === null ? (r.error === 'stopped' ? 'stopped' : 'refused') : `exit ${r.code}`;
  const body = (
    <>
      {r.out}
      {r.err && <span class="c-err">{r.err}</span>}
      {r.error && r.error !== 'stopped' && <span class="c-err">{r.error}</span>}
      {!r.out && !r.err && !r.error && !r.running && <span class="hint">(no output)</span>}
    </>
  );
  if (full) {
    return (
      <div class="codefull">
        <div class="fullhead">
          <b class="mono">fw {r.args.join(' ')}</b>
          <span class="hint">{status}</span>
          <span class="sp" />
          <button class="code-toggle" onClick={copy}>copy</button>
          <button class="btn sm" onClick={() => setFull(false)}>Close<Keys combo="esc" /></button>
        </div>
        <pre class="cliout full">{body}</pre>
      </div>
    );
  }
  return (
    <div class={`clirun ${r.running ? 'running' : r.code === 0 ? 'ok' : 'bad'}`}>
      <div class="clihead">
        <button class="clitoggle" onClick={onToggle} title={open ? 'Collapse' : 'Expand'}>
          <span class="dot" />
          <span class="mono cmdline">fw {r.args.join(' ')}</span>
        </button>
        <span class="sp" />
        <span class="hint">{status}</span>
        <span class="cliops">
          {r.running
            ? <Tip label="Stop" side="top"><button onClick={() => stopCli(r.id)}><span class="ms">stop</span></button></Tip>
            : <Tip label="Run again" side="top"><button onClick={onRerun}><span class="ms">replay</span></button></Tip>}
          <Tip label="Copy output" side="top"><button onClick={copy}><span class="ms">content_copy</span></button></Tip>
          <Tip label="Full screen" side="top"><button onClick={() => setFull(true)}><span class="ms">open_in_full</span></button></Tip>
          {!r.running && <Tip label="Remove" side="top"><button onClick={onRemove}><span class="ms">close</span></button></Tip>}
        </span>
      </div>
      {open && <pre ref={pre} class="cliout">{body}</pre>}
    </div>
  );
}

/**
 * A command as a form: its arguments and flags from the catalogue, the
 * line it makes shown as it is filled. What was already typed seeds it,
 * and what is filled goes back to the line, so neither is lost.
 */
function Builder({ commands, initial, onLine, onRun, onClose }: { commands: CliCommand[]; initial: Filled | null; onLine: (line: string) => void; onRun: (line: string) => void; onClose: () => void }) {
  const [filter, setFilter] = useState('');
  const [filled, setFilled] = useState<Filled | null>(initial);
  useEffect(() => { if (initial) setFilled(initial); }, [initial?.command.name]);
  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const byGroup = new Map<string, CliCommand[]>();
    for (const c of commands) {
      if (needle && !c.name.includes(needle) && !c.description.toLowerCase().includes(needle)) continue;
      byGroup.set(c.group, [...(byGroup.get(c.group) ?? []), c]);
    }
    return [...byGroup];
  }, [commands, filter]);
  const pick = (c: CliCommand) => {
    const args = parseUsage(c.usage);
    const w = wf.value;
    // The open workflow's file fills an input argument, as it does for a ▶ in the guide.
    setFilled({ command: c, args: args.map((a) => (w && /^(input|file|workflow-file|path)$/.test(a.name) ? w.rel : '')), flags: {}, rest: [] });
  };
  const line = filled ? composeLine(filled) : '';
  useEffect(() => { if (filled) onLine(line); }, [line]);

  if (!filled) {
    return (
      <div class="in builder">
        <div class="builderhead">
          <input type="text" class="filter" placeholder="find a command" value={filter} onInput={(e) => setFilter((e.target as HTMLInputElement).value)} autoFocus />
          <button class="btn ghost sm" onClick={onClose}>Close<Keys combo="esc" /></button>
        </div>
        <div class="cmdlist">
          {groups.map(([group, list]) => (
            <div key={group}>
              <h6>{group}</h6>
              {list.map((c) => (
                <button key={c.name} class="cmdrow" onClick={() => pick(c)}>
                  <span class="mono">{c.name}</span><small>{c.description}</small>
                </button>
              ))}
            </div>
          ))}
          {!groups.length && <div class="hint">nothing matching "{filter}"</div>}
        </div>
      </div>
    );
  }

  const args = parseUsage(filled.command.usage);
  const flags = filled.command.flags.map(parseFlag).filter((f): f is Flag => !!f);
  const setArg = (i: number, v: string) => setFilled({ ...filled, args: Object.assign([...filled.args], { [i]: v }) });
  const setFlag = (f: Flag, v: string | true | null) => {
    const next = { ...filled.flags };
    if (v === null) delete next[f.long]; else next[f.long] = v;
    setFilled({ ...filled, flags: next });
  };
  const missing = args.some((a, i) => a.required && !(filled.args[i] ?? '').trim());
  return (
    <div class="in builder">
      <div class="builderhead">
        <button class="linkish" onClick={() => setFilled(null)}>← commands</button>
        <b class="mono">fw {filled.command.name}</b>
        <span class="sp" />
        <button class="btn ghost sm" onClick={onClose}>Close<Keys combo="esc" /></button>
      </div>
      <div class="hint" style="margin:0 0 10px">{filled.command.description}</div>
      {args.length > 0 && (
        <div class="fields">
          {args.map((a, i) => (
            <div class="field" key={a.name}>
              <label><span>{a.name}{a.required && <i>*</i>}{a.variadic && <em> (several, space-separated)</em>}</span></label>
              <input type="text" class="mono" value={filled.args[i] ?? ''} placeholder={a.required ? `<${a.name}>` : `[${a.name}]`} onInput={(e) => setArg(i, (e.target as HTMLInputElement).value)} />
            </div>
          ))}
        </div>
      )}
      {flags.length > 0 && (
        <div class="flags">
          <h6>Options</h6>
          {flags.map((f) => {
            const v = filled.flags[f.long];
            return (
              <div class="flag" key={f.long}>
                {f.value ? (
                  <>
                    <label class="flagname" title={f.description}><code>{f.long}</code><span class="hint">{f.value}</span></label>
                    <input type="text" class="mono" value={typeof v === 'string' ? v : ''} placeholder={f.default && f.default !== '—' ? `default ${f.default}` : ''} onInput={(e) => { const t = (e.target as HTMLInputElement).value; setFlag(f, t === '' ? null : t); }} />
                    <span class="flagdesc">{f.description}</span>
                  </>
                ) : (
                  <label class="check flagcheck">
                    <input type="checkbox" checked={v === true} onChange={(e) => setFlag(f, (e.target as HTMLInputElement).checked ? true : null)} />
                    <code>{f.long}</code><span class="flagdesc">{f.description}</span>
                  </label>
                )}
              </div>
            );
          })}
        </div>
      )}
      {filled.command.examples.length > 0 && (
        <div class="examples">
          <h6>Examples</h6>
          {filled.command.examples.map((ex) => {
            const parsed = parseLine(ex, commands);
            return <button key={ex} class="example mono" title="Use this" onClick={() => { if (parsed) setFilled(parsed); }}>{ex}</button>;
          })}
        </div>
      )}
      <div class="composed">
        <span class="prompt mono">fw</span><code>{line}</code>
      </div>
      <div class="formfoot">
        <button class="btn primary sm" disabled={missing || hasPlaceholder(line)} onClick={() => onRun(line)}>Run</button>
        <button class="btn sm" onClick={onClose}>Edit as text</button>
        {missing && <span class="hint">fill the required arguments</span>}
      </div>
    </div>
  );
}

/**
 * An fw command line inside the console.
 *
 * Typed, completed and run in the project -- as an argument list, there is
 * no shell in between -- or built from the catalogue as a form. Every ▶ in
 * the guide and on a pack lands here; a line with a placeholder left in it
 * opens the form on that command with what is known filled in.
 */
export function CliPane() {
  const input = useRef<HTMLInputElement>(null);
  const [pick, setPick] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [histAt, setHistAt] = useState(-1);
  const [seed, setSeed] = useState<Filled | null>(null);
  useEffect(() => { loadCliCommands(); }, []);
  const commands = cliCommands.value;
  const line = cli.line.value;
  const build = cli.build.value;

  // A staged command wants the cursor; one with a placeholder wants the form.
  useEffect(() => {
    if (!cli.focus.value) return;
    cli.focus.value = false;
    const el = input.current;
    if (hasPlaceholder(line) && commands.length) {
      const parsed = parseLine(line, commands);
      if (parsed) { setSeed(parsed); cli.build.value = true; return; }
    }
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [cli.focus.value, commands.length]);
  useEffect(() => { const latest = cli.runs.value[0]; if (latest) setOpen(latest.id); }, [cli.runs.value.length]);
  useEffect(() => {
    if (!build) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cli.build.value = false; };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [build]);

  const sugg = build ? [] : suggest(line, commands).slice(0, 8);
  const accept = (s: { text: string }) => {
    const trailing = /\s$/.test(line) || !line;
    cli.line.value = `${trailing ? line : line.replace(/\S+$/, '')}${s.text} `;
    setPick(0);
    input.current?.focus();
  };
  const go = (text = line) => {
    const argv = splitArgs(text);
    if (!argv.length) return;
    if (hasPlaceholder(text)) {
      const parsed = parseLine(text, commands);
      if (parsed) { setSeed(parsed); cli.build.value = true; }
      return;
    }
    runCli(argv);
    cli.history.value = [text, ...cli.history.value.filter((h) => h !== text)].slice(0, 50);
    cli.line.value = '';
    cli.build.value = false;
    setPick(0); setHistAt(-1);
  };
  const onKey = (e: KeyboardEvent) => {
    const hist = cli.history.value;
    if (e.key === 'Enter') { e.preventDefault(); if (sugg.length && e.shiftKey) accept(sugg[pick]); else go(); }
    else if (e.key === 'Tab' && sugg.length) { e.preventDefault(); accept(sugg[pick]); }
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (sugg.length) setPick((pick + 1) % sugg.length);
      else if (histAt >= 0) { const at = histAt - 1; setHistAt(at); cli.line.value = at < 0 ? '' : hist[at]; }
    }
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (sugg.length) setPick((pick + sugg.length - 1) % sugg.length);
      else if (hist.length) { const at = Math.min(histAt + 1, hist.length - 1); setHistAt(at); cli.line.value = hist[at]; }
    }
    else if (e.key === 'Escape') { setPick(0); (e.target as HTMLInputElement).blur(); }
  };
  const running = cli.runs.value.find((r) => r.running);
  const openBuilder = () => {
    const parsed = line.trim() ? parseLine(line, commands) : null;
    setSeed(parsed);
    cli.build.value = true;
  };
  return (
    <div class="clipane">
      <div class="card">
        <h3>
          fw<span class="mono">{project.value.name}</span><span class="sp" />
          <button class={`btn ghost sm ${build ? 'on' : ''}`} title="Build a command from the catalogue" onClick={() => (build ? (cli.build.value = false) : openBuilder())}>
            <span class="ms" style="font-size:14px">tune</span> Commands
          </button>
        </h3>
        <div class="in cliinput">
          <span class="prompt mono">fw</span>
          <input ref={input} type="text" class="mono" value={line} placeholder="validate <input>" spellcheck={false}
            onInput={(e) => { cli.line.value = (e.target as HTMLInputElement).value; setPick(0); setHistAt(-1); }} onKeyDown={onKey} />
          {running
            ? <button class="btn danger sm" onClick={() => stopCli(running.id)}>Stop</button>
            : <button class="btn primary sm" disabled={!line.trim()} onClick={() => go()}>{hasPlaceholder(line) ? 'Fill in…' : 'Run'}</button>}
        </div>
        {sugg.length > 0 && line && !build && (
          <div class="in sugg">
            {sugg.map((s, i) => (
              <button key={s.text} class={i === pick ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); accept(s); }}>
                <span class="mono">{s.text}</span><small>{s.hint}</small>
              </button>
            ))}
          </div>
        )}
        {build && (
          <Builder
            commands={commands}
            initial={seed}
            onLine={(l) => { cli.line.value = l; }}
            onRun={(l) => go(l)}
            onClose={() => { cli.build.value = false; input.current?.focus(); }}
          />
        )}
      </div>
      {cli.runs.value.length > 0 && (
        <div class="clihist">
          <span class="hint">{cli.runs.value.length} run{cli.runs.value.length === 1 ? '' : 's'} this session</span>
          <span class="sp" />
          <button class="linkish" onClick={() => { cli.runs.value = cli.runs.value.filter((r) => r.running); }}>clear</button>
        </div>
      )}
      {cli.runs.value.map((r) => (
        <Output key={r.id} run={r} open={open === r.id}
          onToggle={() => setOpen(open === r.id ? null : r.id)}
          onRerun={() => go(r.args.join(' '))}
          onRemove={() => { cli.runs.value = cli.runs.value.filter((x) => x.id !== r.id); }} />
      ))}
      {!cli.runs.value.length && <div class="hint" style="padding:4px 12px">Nothing run yet. Type a command, or open Commands to build one. Any ▶ in the guide lands here.</div>}
    </div>
  );
}
