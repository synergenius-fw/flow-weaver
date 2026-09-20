import { useEffect, useState } from 'preact/hooks';
import { packs, stageCli, ui, view, openPack } from '../state';
import { get } from '../api';
import { packNs } from '../format';
import { CliPane } from './Cli';
import { PaneTab } from './PaneTab';

interface Found { name: string; version: string; description?: string; publisher?: string; official: boolean; keywords?: string[]; registry: string }
interface Searched { url: string; scopes: string[]; authenticated: boolean; ok: boolean; error?: string; count: number }
interface Search { results: Found[]; searched: Searched[] }

/**
 * Finding a pack.
 *
 * The marketplace is npm: a search is an npm search narrowed to packs, and
 * installing one is `fw market install`, which goes to the command line
 * beside this page rather than running on a click -- it is an install into
 * the project, and the person presses Run.
 */
export function MarketView() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Found[] | null>(null);
  const [searched, setSearched] = useState<Searched[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (view.value.kind !== 'market') return;
    setBusy(true); setError('');
    const t = setTimeout(() => {
      get<Search>(`/api/market/search?q=${encodeURIComponent(query.trim())}`)
        .then((r) => { setResults(r.results); setSearched(r.searched); setBusy(false); })
        .catch((e: Error) => { setError(e.message); setResults([]); setBusy(false); });
    }, query ? 300 : 0);
    return () => clearTimeout(t);
  }, [query, view.value.kind]);
  if (view.value.kind !== 'market') return null;
  const installed = new Set(packs.value.map((p) => p.name));
  const host = (u: string) => u.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return (
    <div class="docview">
      <div class="dochead">
        <h1>Find a pack</h1>
        <p class="lede">Packs add node types, export targets, annotations, rules, docs and commands to a project. A pack is an npm package with a <code>flowweaver.manifest.json</code>, named <code>flow-weaver-pack-*</code> by convention.</p>
        <input type="text" class="marketsearch" placeholder="search the marketplace: openai, cicd, slack…" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} autoFocus />
        {/* Which registries were asked, from the project's .npmrc: the
            private one is named here, so its absence is never a mystery. */}
        {searched.length > 0 && (
          <div class="registries">
            {searched.map((s) => (
              <span key={s.url} class={`pill ${s.ok ? '' : 'err'}`} title={s.error ?? (s.scopes.length ? `for ${s.scopes.join(', ')}` : 'the default registry')}>
                {s.authenticated && <span class="ms" style="font-size:12px">lock</span>}
                {host(s.url)}{s.scopes.length ? ` for ${s.scopes.join(' ')}` : ''}{s.ok ? `, ${s.count} pack${s.count === 1 ? '' : 's'}` : ', not answering'}
              </span>
            ))}
          </div>
        )}
      </div>
      {error && <div class="card"><div class="in" style="color:var(--err)">{error}</div><div class="in hint">The search goes to the npm registry; <button class="linkish" onClick={() => stageCli('fw market search --registry <url>')}>a private registry</button> can be given to <code>fw market search</code>.</div></div>}
      {busy && !results && <div class="hint">Searching…</div>}
      {results && (
        <div class="market">
          {results.map((r) => {
            const have = installed.has(r.name);
            return (
              <div class="marketrow" key={r.name}>
                <div class="t">
                  <b>{packNs(r.name)}</b>
                  <span class="mono">{r.name}@{r.version}</span>
                  <span class="hint">{r.registry}</span>
                  {r.official && <span class="pill ok">official</span>}
                  {have && <span class="pill">installed</span>}
                </div>
                {r.description && <div class="hint">{r.description}</div>}
                <div class="ops">
                  {have
                    ? <button class="btn sm" onClick={() => openPack(r.name)}>Open</button>
                    : <button class="btn primary sm" onClick={() => stageCli(`fw market install ${r.name}`)}>Install…</button>}
                </div>
              </div>
            );
          })}
          {!results.length && !error && (
            <div class="hint">
              {query ? `Nothing matching "${query}" on the registries above.` : 'Nothing on the registries above yet.'}
              {' '}A registry not in <code>.npmrc</code> can be searched with <button class="linkish" onClick={() => stageCli(`fw market search ${query.trim()} --registry <url>`.replace(/\s+/g, ' '))}>▶ fw market search --registry</button>.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The right column while the marketplace is open: the command line, where an install lands. */
export function MarketSide() {
  void ui;
  return (
    <>
      <div class="panes"><PaneTab icon="terminal" label="CLI" on onClick={() => undefined} /></div>
      <div class="panebody"><CliPane /></div>
    </>
  );
}
