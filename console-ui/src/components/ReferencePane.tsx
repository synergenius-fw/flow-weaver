import { useState } from 'preact/hooks';
import { sel, ui, stageCli, openDoc, type ParsedWorkflow, type Step } from '../state';
import { editorLink, packNs } from '../format';
import { routeText } from '../http';
import { Code } from './Code';
import { Expr, PortRef } from './Expr';

const flatten = (steps: Step[]): Step[] => steps.flatMap((s) => [s, ...flatten(s.children)]);

/** A step's id as a link into the process; Start and Exit link too. */
function Ref({ id, w }: { id: string; w: ParsedWorkflow }) {
  const label = id === 'Start' || id === 'Exit' ? id : w.nodes[id]?.label ?? id;
  return (
    <button class="stepref" title={label !== id ? `${label} · ${id}` : id} onClick={() => { sel.value = id; ui.side.value = 'step'; }}>
      {id}
    </button>
  );
}

/**
 * The workflow's contract and wiring, read from the annotations.
 *
 * What the JSDoc block declares, laid out as what it means: the signature,
 * the options, each `@node` with what marks it, the `@path` chains and the
 * `@connect` lines -- every id a way into the process. The raw block is
 * one click away, not the first thing shown.
 */
export function ReferencePane({ w }: { w: ParsedWorkflow }) {
  const [raw, setRaw] = useState(false);
  const [about, setAbout] = useState(false);
  const r = w.reference;
  const steps = flatten(w.model.steps);
  const opts = Object.entries(r.options).filter(([k, v]) => k !== 'http' && v !== undefined && v !== false && v !== null);
  const optText = (k: string, v: unknown): string => {
    if (v === true) return `@${k}`;
    if (typeof v === 'object' && v) return `@${k} ${Object.entries(v as Record<string, unknown>).map(([a, b]) => `${a}=${JSON.stringify(b)}`).join(' ')}`;
    return `@${k} ${String(v)}`;
  };
  // Each @http line is its own chip, as written.
  const routeChips = (w.http ?? []).map((route) => [`http ${routeText(route)}`, `@http ${routeText(route)}`] as const);
  const sig = (ports: Array<{ name: string; tsType: string; optional: boolean }>) =>
    ports.length ? ports.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.tsType}`).join(', ') : '';
  return (
    <>
      <div class="card">
        <h3>Contract<span class="sp" /><a class="mono" href={editorLink(w.file, w.sourceLine)} title="Open in the editor">{w.rel}:{w.sourceLine}</a></h3>
        <div class="in">
          <div class="sig mono">
            <span class="c-k">function</span> <b>{w.name}</b>(<span class="c-t">execute</span>, params: {'{ '}<span class="params">{sig(w.params) || '—'}</span>{' }'})
            <div class="ret">→ {'{ '}<span class="params">{sig(w.returns) || 'onSuccess, onFailure'}</span>{' }'}</div>
          </div>
          {w.description && (
            <div class={`desc about ${about ? 'open' : ''}`} onClick={() => setAbout(!about)}>{w.description}</div>
          )}
        </div>
        {(opts.length > 0 || routeChips.length > 0) && (
          <div class="in"><h5>Options</h5>
            <div class="chips">{opts.map(([k, v]) => <code key={k} title={k}>{optText(k, v)}</code>)}{routeChips.map(([k, text]) => <code key={k} title="The route this workflow is served on">{text}</code>)}</div>
          </div>
        )}
        <div class="in"><div class="kv">
          <span class="k">compiled</span><span class="val static">{w.compiled ? 'yes · body generated in place' : <>no · <button class="linkish" onClick={() => stageCli(`fw compile ${w.rel}`)}>▶ fw compile</button></>}</span>
          <span class="k">steps</span><span class="val static">{steps.length}{steps.some((s) => s.kind === 'pause') ? ` · ${steps.filter((s) => s.kind === 'pause').length} gate${steps.filter((s) => s.kind === 'pause').length > 1 ? 's' : ''}` : ''}</span>
        </div></div>
      </div>

      <div class="card">
        <h3>Steps<span class="mono">@node</span><span class="sp" /><span class="hint">{steps.length}</span></h3>
        <div class="in">
          <div class="steplist">
            {steps.map((s) => {
              const n = w.nodes[s.id];
              return (
                <div class="steprow" key={s.id} style={s.scope ? 'padding-left:14px' : ''}>
                  <Ref id={s.id} w={w} />
                  <span class="type mono">{n?.type ?? s.type}</span>
                  <span class="marks">
                    {n?.gate && <span class="tag gate">{n.gate} gate</span>}
                    {s.kind === 'loop' && <span class="tag loop">scope</span>}
                    {s.pull && <span class="tag pull">pulled</span>}
                    {n?.pack && <span class="tag pack">{packNs(n.pack)}</span>}
                    {n?.builtin && !n?.pack && <span class="tag">built-in</span>}
                    {(s.exprs.length > 0 || (n?.expr.length ?? 0) > 0) && <span class="tag expr">{s.exprs.length || n!.expr.length} expr</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div class="card">
        <h3>Wiring<span class="mono">@path · @connect</span></h3>
        {r.paths.length > 0 && (
          <div class="in"><h5>Paths</h5>
            {r.paths.map((p, i) => (
              <div class="path" key={i}>
                {p.map((st, j) => (
                  <span key={j} class="pathstep">
                    {j > 0 && <span class="arrow">→</span>}
                    <Ref id={st.node} w={w} />{st.route && <span class={`route ${st.route}`}>:{st.route}</span>}
                  </span>
                ))}
              </div>
            ))}
            <div class="hint" style="margin-top:6px">A path wires control flow along the chain, and each data port to the nearest earlier step with an output of the same name.</div>
          </div>
        )}
        {r.connects.length > 0 && (
          <div class="in"><h5>Explicit connections</h5>
            <div class="ports">
              {r.connects.map((c, i) => (
                <><span class="p" key={`f${i}`}><Ref id={c.from.node} w={w} />.{c.from.port}</span><span class="from" key={`t${i}`}>→ <PortRef node={c.to.node} port={c.to.port} /></span></>
              ))}
            </div>
          </div>
        )}
        {r.exprs.length > 0 && (
          <div class="in"><h5>Expressions</h5>
            <div class="ports">
              {r.exprs.map((e, i) => (
                <><span class="p" key={`e${i}`}><Ref id={e.node} w={w} />.{e.port}</span><span class="from" key={`x${i}`}>= <Expr value={e.expr} /></span></>
              ))}
            </div>
          </div>
        )}
        {!r.paths.length && !r.connects.length && !r.exprs.length && (
          <div class="in hint">{r.options.autoConnect ? '@autoConnect: ports are wired by name in declaration order.' : 'No wiring declared.'}</div>
        )}
        {r.importsFrom.length > 0 && (
          <div class="in"><h5>Imported node types<span class="mono" style="margin-left:6px">@fwImport</span></h5>
            <div class="ports">{r.importsFrom.map((m) => <><span class="p" key={m.type}>{m.type}</span><span class="from" key={`${m.type}f`}>from {m.from}</span></>)}</div>
          </div>
        )}
        <div class="in hint">
          <button class="linkish" onClick={() => openDoc('jsdoc-grammar')}>The grammar</button> · <button class="linkish" onClick={() => openDoc('advanced-annotations')}>paths, expressions, pull execution</button>
        </div>
      </div>

      <div class="card">
        <h3>Annotations<span class="sp" /><button class="linkish" onClick={() => setRaw(!raw)}>{raw ? 'hide' : 'show'}</button></h3>
        {raw && <Code source={w.source} startLine={w.sourceLine} title={`${w.name} annotations`} file={{ path: w.file, label: `${w.rel}:${w.sourceLine}`, line: w.sourceLine }} />}
        {!raw && <div class="in hint">The JSDoc block as written, {w.source.split('\n').length} lines, at <a class="mono" href={editorLink(w.file, w.sourceLine)}>{w.rel}:{w.sourceLine}</a>.</div>}
      </div>
    </>
  );
}
