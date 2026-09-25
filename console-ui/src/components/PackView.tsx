import { packs, view, workflows, selectWorkflow, openDoc, stageCli, ui, type Pack, type PackPort } from '../state';
import { Icon } from './Icon';
import { colorVar } from '../format';
import { WorkflowRow } from './DocSide';
import { CliPane } from './Cli';
import { PaneTab } from './PaneTab';

const Ports = ({ list }: { list: PackPort[] }) => (
  <span class="from">{list.length ? list.map((p, i) => <span key={p.name} title={p.description}>{i > 0 ? ', ' : ''}{p.name}{p.optional ? '?' : ''}<i>: {p.type}</i></span>) : '—'}</span>
);

/**
 * One installed pack, in the centre.
 *
 * The manifest laid out for a person: what the pack adds to the project's
 * vocabulary, and what it plugs into. Each command has the same ▶ the
 * guide has, and each doc topic opens like any other.
 */
export function PackView() {
  const v = view.value;
  if (v.kind !== 'pack') return null;
  const p = packs.value.find((x) => x.name === v.name);
  if (!p) return <div class="hint" style="padding:40px 0">{packs.value.length ? `No pack ${v.name} is installed.` : 'Loading…'}</div>;
  const users = workflows.value.filter((w) => w.uses.includes(`pack:${p.name}`));
  return (
    <div class="docview packview">
      <div class="dochead">
        <h1>{p.namespace}</h1>
        <div class="meta">
          <span class="mono">{p.name}@{p.version}</span>
          {p.engineVersion && (
            <span class={`pill ${p.compatible === false ? 'warn' : p.compatible ? 'ok' : ''}`} title={p.compatible === false ? 'This pack expects a newer Flow Weaver. It still loads, with a warning' : ''}>
              engine {p.engineVersion}{p.compatible === false ? ' (newer than this one)' : ''}
            </span>
          )}
          {users.length > 0 && <span class="pill">used by {users.length} workflow{users.length > 1 ? 's' : ''}</span>}
        </div>
        {p.description && <p class="lede">{p.description}</p>}
      </div>
      <PackBody p={p} />
    </div>
  );
}

/** What a pack adds and plugs into, from its manifest; shared with the authoring page. */
export function PackBody({ p }: { p: Pack }) {
  return (
      <div class="article">
        <Section title="Node types" count={p.nodeTypes.length} what="node types" empty="This pack adds no node types.">
          <div class="tablewrap"><table>
            <thead><tr><th>Node type</th><th>Inputs</th><th>Outputs</th><th>About</th></tr></thead>
            <tbody>{p.nodeTypes.map((n) => (
              <tr key={n.name}>
                <td><span class="packnode" style={`--tc:${colorVar(n.color) ?? 'var(--dim)'}`}>{n.icon && <Icon name={n.icon} />}<code>{n.name}</code></span></td>
                <td><Ports list={n.inputs} /></td>
                <td><Ports list={n.outputs} /></td>
                <td>{n.description}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <p class="hint">Use one with <code>@fwImport</code>; see <a href="#doc/advanced-annotations" onClick={(e) => { e.preventDefault(); openDoc('advanced-annotations', 'fwImport'); }}>Advanced Annotations</a>.</p>
        </Section>
        <Section title="Workflows" count={p.workflows.length} what="workflows">
          <div class="tablewrap"><table>
            <thead><tr><th>Workflow</th><th>Parameters</th><th>Returns</th><th>Steps</th></tr></thead>
            <tbody>{p.workflows.map((w) => <tr key={w.name}><td><code>{w.name}</code><div class="hint">{w.description}</div></td><td><Ports list={w.params} /></td><td><Ports list={w.returns} /></td><td>{w.nodes}</td></tr>)}</tbody>
          </table></div>
        </Section>
        <Section title="Export targets" count={p.exportTargets.length} what="export targets">
          <ul>{p.exportTargets.map((t) => (
            <li key={t.name}><code>{t.name}</code>{t.description ? `: ${t.description}` : ''} <button class="linkish" onClick={() => stageCli(`fw export <input> --target ${t.name}`)}>▶ export with it</button></li>
          ))}</ul>
        </Section>
        <Section title="Annotations it understands" count={p.tagHandlers.length} what="tag handlers">
          <div class="tablewrap"><table>
            <thead><tr><th>Tags</th><th>Namespace</th><th>Where</th></tr></thead>
            <tbody>{p.tagHandlers.map((t, i) => <tr key={i}><td>{t.tags.map((g) => <code key={g} style="margin-right:6px">@{g}</code>)}</td><td><code>{t.namespace}</code></td><td>{t.scope === 'both' ? 'workflows and node types' : t.scope === 'workflow' ? 'workflows' : 'node types'}</td></tr>)}</tbody>
          </table></div>
          <p class="hint">Whatever these tags say lands under the namespace, and shows on the step or workflow as pack tags.</p>
        </Section>
        <Section title="Validation rules" count={p.validationRuleSets.length} what="rule sets">
          <ul>{p.validationRuleSets.map((r) => <li key={r.name}>{r.name} <span class="hint">applies to <code>{r.namespace}</code></span></li>)}</ul>
        </Section>
        <Section title="Documentation" count={p.docs.length} what="topics">
          <ul>{p.docs.map((d) => <li key={d.slug}><a href={`#doc/${d.slug}`} onClick={(e) => { e.preventDefault(); openDoc(d.slug); }}>{d.name}</a>{d.description ? `: ${d.description}` : ''}</li>)}</ul>
        </Section>
        <Section title="CLI commands" count={p.cliCommands.length} what="commands">
          <div class="block cmd"><pre>
            {p.cliCommands.map((c) => (
              <div class="l run" key={c.name}><button class="play" title="Put on the command line" onClick={() => stageCli(c.usage)}>▶</button><span>{c.usage}<span class="c-c">  # {c.description}</span></span></div>
            ))}
          </pre></div>
        </Section>
        <Section title="MCP tools" count={p.mcpTools.length} what="tools">
          <ul>{p.mcpTools.map((t) => <li key={t.name}><code>{t.name}</code> — {t.description}</li>)}</ul>
        </Section>
      </div>
  );
}

function Section({ title, count, what, empty, children }: { title: string; count: number; what: string; empty?: string; children: preact.ComponentChildren }) {
  if (!count && !empty) return null;
  return (
    <>
      <h2>{title}<span class="hint" style="font-weight:400;margin-left:8px">{count} {count === 1 ? what.replace(/s$/, '') : what}</span></h2>
      {count ? children : <p class="hint">{empty}</p>}
    </>
  );
}

/** The right column while a pack is open: who uses it here, and the command line. */
export function PackSide() {
  const v = view.value;
  const p = v.kind === 'pack' ? packs.value.find((x) => x.name === v.name) : undefined;
  const pane = ui.packSide.value;
  const users = p ? workflows.value.filter((w) => w.uses.includes(`pack:${p.name}`)) : [];
  return (
    <>
      <div class="panes">
        <PaneTab icon="account_tree" label="In this project" on={pane === 'project'} onClick={() => { ui.packSide.value = 'project'; }} />
        <PaneTab icon="terminal" label="CLI" on={pane === 'cli'} onClick={() => { ui.packSide.value = 'cli'; }} />
      </div>
      <div class="panebody">
        {pane === 'project' && (
          <div class="card">
            <h3>Workflows using it<span class="sp" /><span class="hint">{users.length}</span></h3>
            <div class="in">
              {users.length ? users.map((w) => <WorkflowRow key={`${w.file}|${w.name}`} w={w} onOpen={() => selectWorkflow(w.file, w.name)} />) : <div class="hint">No workflow in this project uses a node type from this pack yet.</div>}
            </div>
          </div>
        )}
        {pane === 'cli' && <CliPane />}
      </div>
    </>
  );
}

export type { Pack };
