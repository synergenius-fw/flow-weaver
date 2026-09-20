import { useEffect } from 'preact/hooks';
import { ui, toastMsg, wf, isParsed, NARROW, view, doc, debugPaused, debugAction, type UnparsedWorkflow } from '../state';
import { store } from '../api';
import { editorLink } from '../format';
import { Rail } from './Rail';
import { Header } from './Header';
import { Spine } from './Spine';
import { Inspector } from './Inspector';
import { DocView } from './DocView';
import { DocSide } from './DocSide';
import { PackView, PackSide } from './PackView';
import { MarketView, MarketSide } from './MarketView';
import { AuthorView, AuthorSide } from './AuthorView';
import { Search } from './Search';
import { ProjectView, ProjectSide } from './ProjectView';
import { AgentsView, AgentsSide } from './AgentsView';
import { EndpointsView, EndpointsSide } from './EndpointsView';
import { Drawer } from './Drawer';

function Splitter({ side }: { side: 'rail' | 'side' }) {
  const onDown = (e: PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    el.classList.add('on');
    const startX = e.clientX;
    const startW = side === 'rail' ? ui.railW.value : ui.sideW.value;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const w = Math.max(side === 'rail' ? 228 : 320, Math.min(side === 'rail' ? 460 : 720, side === 'rail' ? startW + dx : startW - dx));
      (side === 'rail' ? ui.railW : ui.sideW).value = w;
    };
    const up = () => {
      el.classList.remove('on');
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up);
      store.set(side === 'rail' ? 'railW' : 'sideW', (side === 'rail' ? ui.railW : ui.sideW).value);
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  };
  const reset = () => { (side === 'rail' ? ui.railW : ui.sideW).value = side === 'rail' ? 284 : 420; };
  return <div class={`split ${side}-split`} onPointerDown={onDown} onDblClick={reset} />;
}

const SPINE_MIN = 420;

/**
 * A file mid-edit is the state an author is in most often, so it gets a
 * real screen: the parser's own message, and a way into the file.
 */
function ParseErrors({ wf }: { wf: UnparsedWorkflow }) {
  return (
    <div class="card" style="max-width:760px">
      <h3>Does not parse<span class="sp" /><a class="mono" href={editorLink(wf.file)}>{wf.rel}</a></h3>
      <div class="in">
        {wf.parseErrors.map((e, i) => (
          <div class="issue" key={i}>
            <span class="mark" />
            <div>{e}</div>
          </div>
        ))}
      </div>
      <div class="in hint">The console re-reads the file as you save it.</div>
    </div>
  );
}

export function App() {
  const width = ui.width.value;
  // Stored widths are preferences, not commitments: the spine keeps its
  // minimum first, the inspector stacks under it next, and the rail only
  // becomes an overlay when even a stacked layout no longer fits.
  // Below `narrow` the rail becomes an overlay; between the two the
  // inspector stacks under the spine. In both, the inspector is still on
  // screen — the run form and gate answers live there.
  const mode = width < NARROW ? 'narrow' : width < SPINE_MIN + 200 + 320 ? 'stacked' : '';
  const rail = mode === 'narrow' ? 300 : Math.min(ui.railW.value, Math.max(228, width - SPINE_MIN - (mode === 'stacked' ? 0 : 320)));
  const side = mode ? 0 : Math.min(ui.sideW.value, Math.max(320, width - rail - SPINE_MIN));
  const reading = view.value.kind === 'doc';
  const browsing = view.value.kind === 'pack';
  const shopping = view.value.kind === 'market';
  const authoring = view.value.kind === 'author';
  const overview = view.value.kind === 'project';
  const agenting = view.value.kind === 'agents';
  const serving = view.value.kind === 'endpoints';
  // ⌘K / Ctrl+K opens the search from anywhere; the debugger's keys while a session is paused.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ui.search.value = !ui.search.value; return; }
      if (!debugPaused.value || (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.key === 'F10') { e.preventDefault(); void debugAction('step'); }
      else if (e.key === 'F5') { e.preventDefault(); void debugAction(e.shiftKey ? 'toBreakpoint' : 'continue'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    document.title = reading && doc.value ? `${doc.value.name} (Flow Weaver)` : wf.value ? `${wf.value.name} (Flow Weaver)` : 'Flow Weaver';
  }, [wf.value?.name, reading, doc.value?.name]);
  return (
    <div
      class={`shell ${mode}`}
      style={`grid-template-columns: ${rail}px 0 minmax(0, 1fr) 0 ${side}px; --rail:${rail}px`}
    >
      <aside class={`col rail ${ui.railOpen.value ? 'open' : ''}`}><Rail /></aside>
      <Splitter side="rail" />
      <main class="col main">
        <Header />
        {reading ? <DocView /> : browsing ? <PackView /> : shopping ? <MarketView /> : authoring ? <AuthorView /> : overview ? <ProjectView /> : agenting ? <AgentsView /> : serving ? <EndpointsView /> : (
          <>
            {isParsed(wf.value) && <Spine w={wf.value} />}
            {wf.value?.parseErrors && <ParseErrors wf={wf.value} />}
          </>
        )}
      </main>
      <Splitter side="side" />
      <aside class="col side">{reading ? <DocSide /> : browsing ? <PackSide /> : shopping ? <MarketSide /> : authoring ? <AuthorSide /> : overview ? <ProjectSide /> : agenting ? <AgentsSide /> : serving ? <EndpointsSide /> : <Inspector />}</aside>
      <Drawer />
      <Search />
      <div class={`toast ${toastMsg.value ? 'show' : ''}`}>{toastMsg.value}</div>
      {mode === 'narrow' && ui.railOpen.value && <div class="scrim" onClick={() => { ui.railOpen.value = false; }} />}
    </div>
  );
}
