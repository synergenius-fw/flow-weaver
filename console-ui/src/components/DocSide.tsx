import { doc, docHeading, guide, workflows, selectWorkflow, closeDoc, ui, type WorkflowSummary } from '../state';
import { slugify } from '../format';
import { PaneTab } from './PaneTab';

/** The page's headings; the one in view is marked, and each scrolls to itself. */
export function Contents() {
  const d = doc.value;
  if (!d) return null;
  // The page's own title heading is the title above the article, not a section.
  const sections = d.sections.filter((s) => s.heading && s.level <= 3 && !(s.level === 1 && slugify(s.heading) === slugify(d.name)));
  if (!sections.length) return <div class="hint" style="padding:12px">No sections.</div>;
  return (
    <div class="card">
      <h3>Contents</h3>
      <div class="in toc">
        {sections.map((s) => {
          const id = slugify(s.heading);
          return (
            <button key={id} class={`tocrow l${s.level} ${docHeading.value === id ? 'on' : ''}`}
              onClick={() => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>
              {s.heading}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const matches = (w: WorkflowSummary, uses: string[]): string[] =>
  w.uses.filter((u) => uses.some((want) => (want.endsWith(':') ? u.startsWith(want) : u === want)));

/** A workflow named from a side pane; opening it leaves whatever is in the centre. */
export function WorkflowRow({ w, note, onOpen }: { w: WorkflowSummary; note?: string; onOpen?: () => void }) {
  return (
    <button class="projrow" onClick={() => { closeDoc(); if (onOpen) onOpen(); else selectWorkflow(w.file, w.name); }}>
      <span class="t"><b>{w.name}</b><small>{w.rel}</small></span>
      {note && <span class="note">{note}</span>}
    </button>
  );
}
const Row = WorkflowRow;

/**
 * What in the open project this topic is about.
 *
 * A page about gates is more useful beside the three gated workflows in
 * the rail than on its own; a page of error codes, beside the two the
 * validator is raising right now. The facets come from the guide manifest
 * and the workflow listing, so nothing is parsed for this.
 */
export function InProject() {
  const d = doc.value;
  const entry = guide.value.flatMap((g) => g.topics).find((t) => t.slug === d?.slug);
  const rel = entry?.related;
  if (!d || !rel) return <div class="hint" style="padding:12px">This topic is not about anything in particular in the project.</div>;
  const all = workflows.value.filter((w) => w.checked);
  const parts: preact.JSX.Element[] = [];

  if (rel.uses) {
    const hit = all.map((w) => ({ w, on: matches(w, rel.uses!) })).filter((x) => x.on.length);
    parts.push(
      <div class="card" key="uses">
        <h3>In this project<span class="sp" /><span class="hint">{hit.length}</span></h3>
        <div class="in">
          {hit.length
            ? hit.map(({ w, on }) => <Row key={`${w.file}|${w.name}`} w={w} note={on.map((u) => u.replace(/^(gate|builtin):/, '')).join(' · ')} />)
            : <div class="hint">Nothing here uses this yet.</div>}
        </div>
      </div>,
    );
  }
  if (rel.codes) {
    const byCode = new Map<string, WorkflowSummary[]>();
    for (const w of all) for (const c of w.codes) byCode.set(c, [...(byCode.get(c) ?? []), w]);
    const codes = [...byCode].sort((a, b) => b[1].length - a[1].length);
    parts.push(
      <div class="card" key="codes">
        <h3>Raised in this project<span class="sp" /><span class="hint">{codes.length}</span></h3>
        <div class="in">
          {codes.length ? codes.map(([code, ws]) => (
            <div class="codegroup" key={code}>
              <button class="linkish mono" onClick={() => document.getElementById(slugify(code))?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>{code}</button>
              <span class="hint"> · {ws.length}</span>
              <div>{ws.map((w) => <Row key={`${w.file}|${w.name}`} w={w} />)}</div>
            </div>
          )) : <div class="hint">Every workflow is clean.</div>}
        </div>
      </div>,
    );
  }
  return <>{parts}</>;
}

/** The right column while a topic is open. */
export function DocSide() {
  const pane = ui.docSide.value;
  return (
    <>
      <div class="panes">
        <PaneTab icon="toc" label="Contents" on={pane === 'contents'} onClick={() => { ui.docSide.value = 'contents'; }} />
        <PaneTab icon="account_tree" label="In this project" on={pane === 'project'} onClick={() => { ui.docSide.value = 'project'; }} />
        <PaneTab icon="terminal" label="CLI" on={pane === 'cli'} onClick={() => { ui.docSide.value = 'cli'; }} />
      </div>
      <div class="panebody">
        {pane === 'contents' && <Contents />}
        {pane === 'project' && <InProject />}
        {pane === 'cli' && <CliPaneLazy />}
      </div>
    </>
  );
}

import { CliPane } from './Cli';
function CliPaneLazy() { return <CliPane />; }
