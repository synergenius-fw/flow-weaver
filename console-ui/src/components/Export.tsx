import { useEffect, useState } from 'preact/hooks';
import { targets, exportRun, openPack, stageCli, toast, type ParsedWorkflow, type ExportOutcome } from '../state';
import { store } from '../api';
import { packNs, quoteArgForCli } from '../format';
import { Value } from './Value';
import { Highlight } from './Code';
import { Select } from './Select';

/**
 * Exporting the open workflow through one of the project's targets.
 *
 * A target is a pack's: what it generates, and the `@deploy` keys it reads,
 * are the pack's to say. What the console adds is the loop -- preview the
 * files, read them, write them, follow the target's own instructions.
 */
export function ExportPane({ w }: { w: ParsedWorkflow }) {
  const list = targets.value;
  const key = `export:${w.file}:${w.name}`;
  const [target, setTarget] = useState<string>(() => store.get(key, list[0]?.name ?? ''));
  const [outDir, setOutDir] = useState<string>('');
  const [result, setResult] = useState<ExportOutcome | null>(null);
  const [busy, setBusy] = useState<'preview' | 'write' | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { if (!list.some((t) => t.name === target)) setTarget(list[0]?.name ?? ''); }, [list.length]);
  useEffect(() => { setResult(null); setError(''); }, [w.file, w.name, target]);
  const t = list.find((x) => x.name === target);
  const defaultOut = `${w.rel.replace(/[^/]*$/, '')}dist/${target}`;
  const go = async (preview: boolean) => {
    setBusy(preview ? 'preview' : 'write'); setError('');
    try {
      const r = await exportRun({ target, outputDir: outDir || undefined, preview });
      setResult(r);
      setOpen(r.files[0]?.path ?? null);
      if (!preview) toast(`${r.files.length} file${r.files.length === 1 ? '' : 's'} written`);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  };
  const cli = `fw export ${quoteArgForCli(w.rel)} --target ${target} --output ${quoteArgForCli(outDir || defaultOut)}${w.name ? ` --workflow ${w.name}` : ''}`;
  if (!list.length) return <div class="hint" style="padding:12px">No export target is installed. Targets come from packs.</div>;
  const current = w.deploy?.[target] ?? {};
  return (
    <>
      <div class="card">
        <h3>Export<span class="sp" /><button class="linkish" title="The same as a command" onClick={() => stageCli(cli)}>▶ as a command</button></h3>
        <div class="in">
          <div class="field"><label><span>target</span></label>
            <Select
              value={target}
              options={list.map((x) => ({ value: x.name, text: `${x.name}${x.pack ? ` ${packNs(x.pack)}` : ''}`, label: <>{x.name}{x.pack ? <span class="opt-ns"> · {packNs(x.pack)}</span> : null}</> }))}
              onChange={(v) => { setTarget(v); store.set(key, v); }}
            />
          </div>
          {t && <div class="hint" style="margin:-4px 0 10px">{t.description}{t.pack && <> · from <button class="linkish" onClick={() => openPack(t.pack!)}>{packNs(t.pack)}</button></>}</div>}
          <div class="field"><label><span>output</span></label>
            <input type="text" class="mono" value={outDir} placeholder={defaultOut} onInput={(e) => setOutDir((e.target as HTMLInputElement).value)} />
          </div>
          <div class="formfoot">
            <button class="btn sm" disabled={!!busy} onClick={() => go(true)}>{busy === 'preview' ? 'Generating…' : 'Preview'}</button>
            <button class="btn primary sm" disabled={!!busy} onClick={() => go(false)}>{busy === 'write' ? 'Writing…' : 'Write files'}</button>
            <span class="err">{error}</span>
          </div>
        </div>
        {t?.deploySchema && Object.keys(t.deploySchema).length > 0 && (
          <div class="in">
            <h5>Reads from the workflow's @deploy {target}</h5>
            <div class="ports">
              {Object.entries(t.deploySchema).map(([k, f]) => (
                <><span class="p" title={f.description}>{k}</span><span>
                  {k in current ? <Value value={current[k]} /> : <span class="from" style="opacity:.7">{f.default !== undefined ? `default ${JSON.stringify(f.default)}` : 'unset'}</span>}
                  <span class="from"> · {f.type}</span>
                </span></>
              ))}
            </div>
          </div>
        )}
      </div>
      {result && (
        <>
          <div class="card">
            <h3>{result.written ? 'Written' : 'Preview'}<span class="mono">{result.files.length} file{result.files.length === 1 ? '' : 's'}</span><span class="sp" /><span class="hint mono" title={result.outputDir}>{result.outputDir.split(/[\\/]/).slice(-2).join('/')}</span></h3>
            {result.warnings.length > 0 && <div class="in">{result.warnings.map((m, i) => <div class="issue" key={i}><span class="mark warn" /><div>{m}</div></div>)}</div>}
            <div class="in exportfiles">
              {result.files.map((f) => (
                <div key={f.path}>
                  <button class={`filerow ${open === f.path ? 'on' : ''}`} onClick={() => setOpen(open === f.path ? null : f.path)}>
                    <span class="ms">description</span><span class="mono">{f.path}</span><span class="sp" /><span class="hint">{f.content.split('\n').length} lines</span>
                  </button>
                  {open === f.path && <div class="codewrap"><div class="code"><Highlight source={f.content} /></div></div>}
                </div>
              ))}
            </div>
          </div>
          {result.instructions && (
            <div class="card">
              <h3>{result.instructions.title}</h3>
              {result.instructions.prerequisites.length > 0 && <div class="in"><h5>Requires</h5><div>{result.instructions.prerequisites.join(', ')}</div></div>}
              <div class="in"><h5>Steps</h5><ol class="steps">{result.instructions.steps.map((s, i) => <li key={i}>{s}</li>)}</ol></div>
              {result.instructions.localTestSteps?.length ? <div class="in"><h5>Test locally</h5><ol class="steps">{result.instructions.localTestSteps.map((s, i) => <li key={i}>{s}</li>)}</ol></div> : null}
              {result.instructions.links?.length ? <div class="in"><h5>Links</h5>{result.instructions.links.map((l) => <div key={l.url}><a href={l.url} target="_blank" rel="noreferrer">{l.label}</a></div>)}</div> : null}
            </div>
          )}
        </>
      )}
    </>
  );
}
