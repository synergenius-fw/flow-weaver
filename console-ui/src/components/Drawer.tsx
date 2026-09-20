import { useEffect, useRef, useState } from 'preact/hooks';
import { ui, openDrawer, closeDrawer, serviceOf, startService, stopService, toast, type DrawerTab, type ServiceKind } from '../state';
import { stream, store } from '../api';
import { CliPane } from './Cli';

interface Line { t: number; stream: 'out' | 'err'; text: string }

/** What a service printed, live, with the newest at the bottom unless you scrolled up to read. */
function Logs({ kind }: { kind: ServiceKind }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [synced, setSynced] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const s = serviceOf(kind);
  const alive = s?.state === 'running' || s?.state === 'starting';
  // The stream replays what is kept, then follows. A restart of the service
  // starts a new child, so the stream is opened again when the pid changes.
  useEffect(() => {
    setLines([]); setSynced(false);
    return stream(`/api/services/${kind}/logs`, (m) => {
      if (m.synced) { setSynced(true); return; }
      setLines((cur) => (cur.length > 2000 ? [...cur.slice(-1500), m as Line] : [...cur, m as Line]));
    });
  }, [kind, s?.pid]);
  useEffect(() => {
    if (pinned.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines.length]);
  const onScroll = () => {
    const el = box.current; if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };
  const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <div class="logs">
      <div class="logbar">
        <span class={`sdot ${alive ? 'ok' : s?.error ? 'bad' : ''}`} />
        <span class="hint">{kind === 'serve' ? 'fw serve' : 'fw watch'}: {!s || s.state === 'stopped' ? 'not running' : s.state === 'exited' ? `stopped${s.exitCode ? ` (exit ${s.exitCode})` : ''}` : s.state}{s?.url ? <> at <a class="mono" href={s.url} target="_blank" rel="noreferrer">{s.url}</a></> : null}</span>
        <span class="sp" />
        {!alive && <button class="btn primary sm" onClick={() => startService(kind).catch((e: Error) => toast(e.message))}>Start</button>}
        {alive && <button class="btn sm" onClick={() => stopService(kind).catch((e: Error) => toast(e.message))}>Stop</button>}
        <button class="btn ghost sm" onClick={() => setLines([])} title="Clear what is shown. The server keeps its own">Clear</button>
      </div>
      <div class="logbody mono" ref={box} onScroll={onScroll}>
        {lines.map((l, i) => <div class={`ln ${l.stream}`} key={i}><span class="t">{time(l.t)}</span>{l.text}</div>)}
        {synced && !lines.length && <div class="hint">{alive ? 'nothing printed yet' : 'nothing kept, start it to see its output here'}</div>}
      </div>
    </div>
  );
}

/**
 * The bottom drawer: the output of the project's services and the command
 * line, reachable from any page. Collapsed unless something is opened; the
 * height is dragged and remembered.
 */
export function Drawer() {
  const tab = ui.drawer.value;
  const [drag, setDrag] = useState(false);
  if (!tab) return null;
  const onDown = (e: PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    setDrag(true);
    const startY = e.clientY, startH = ui.drawerH.value;
    const move = (ev: PointerEvent) => { ui.drawerH.value = Math.max(120, Math.min(window.innerHeight * 0.7, startH + (startY - ev.clientY))); };
    const up = () => { setDrag(false); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); store.set('drawerH', ui.drawerH.value); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  };
  const tabs: Array<{ id: DrawerTab; label: string; icon: string }> = [
    { id: 'serve', label: 'Server', icon: 'dns' },
    { id: 'watch', label: 'Watch', icon: 'sync' },
    { id: 'cli', label: 'CLI', icon: 'terminal' },
  ];
  const serve = serviceOf('serve');
  return (
    <div class={`drawer ${drag ? 'dragging' : ''}`} style={`height:${ui.drawerH.value}px`}>
      <div class="drawergrip" onPointerDown={onDown} title="Drag to resize" />
      <div class="panes drawertabs">
        {tabs.map((t) => (
          <button key={t.id} class={tab === t.id ? 'on' : ''} onClick={() => openDrawer(t.id)}>
            <span class="ms" style="font-size:15px">{t.icon}</span>{t.label}
            {t.id === 'serve' && serve?.state === 'running' && <span class="sdot ok" style="margin-left:2px" />}
          </button>
        ))}
        <span class="sp" />
        <button class="btn ghost sm" onClick={closeDrawer} title="Close (the services keep running)"><span class="ms" style="font-size:16px">expand_more</span></button>
      </div>
      <div class="drawerbody">
        {tab === 'cli' ? <CliPane /> : <Logs kind={tab} />}
      </div>
    </div>
  );
}
