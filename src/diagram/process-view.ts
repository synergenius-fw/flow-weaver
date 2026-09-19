/**
 * Process view: a workflow rendered as the process it runs, not the graph
 * it is drawn as.
 *
 * The graph diagram answers "what is connected to what". This answers the
 * questions an author or a reviewer actually has: in what order do the
 * steps run, where does the process stop and wait for someone, what happens
 * when a step fails, and which steps run at the same time. Everything is
 * derived from the parsed AST with the same facts the engine uses --
 * topological order, control edges, and the durable classification -- so
 * the page shows what would run, never a hand-placed picture.
 *
 * Vocabulary:
 *   stage   -- the longest control path from Start; steps sharing a stage
 *              have no control dependency between them and are drawn as lanes
 *   pause   -- a durable gate; the process stops here and waits for a resolver
 *   segment -- the run between two pauses, i.e. what one continuation covers
 *   arm     -- a failure edge, drawn as a rail beside the spine
 *   loop    -- a scope owner, with its children shown as an inner process
 *
 * The page is self-contained: no network, no external scripts. Click a step
 * to expand it; Play walks the process and stops at pauses; ticking "fail
 * here" on a step re-simulates the run and shows the arm it takes instead.
 */
import type { TWorkflowAST, TConnectionAST } from '../ast/types';
import { getTopologicalOrder } from '../api/query';

const STEP_PORTS = new Set(['onSuccess', 'onFailure', 'execute']);

export type ProcessKind = 'step' | 'pause' | 'effect' | 'loop';

export interface ProcessStep {
  id: string;
  label: string;
  type: string;
  kind: ProcessKind;
  gate: 'approval' | 'input' | 'agent' | null;
  scope: string | null;
  pure: boolean;
  expression: boolean;
  stage: number;
  segment: number;
  reads: Array<{ port: string; from: string; fromPort: string }>;
  exprs: Array<{ port: string; expr: string }>;
  produces: Array<{ port: string; to: string[] }>;
  children: ProcessStep[];
  entered: Array<{ from: string; arm: 'ok' | 'fail' }>;
  successTo: string[];
  failureTo: string[];
  gateInputs: string[];
  gateOutputs: string[];
  description: string;
}

export interface ProcessModel {
  name: string;
  description: string;
  params: string[];
  returns: string[];
  steps: ProcessStep[];
  startTo: string[];
  exitFrom: Array<{ from: string; arm: 'ok' | 'fail' }>;
  segments: number;
}

const firstParagraph = (text: string | undefined): string =>
  (text ?? '').split('\n\n')[0].replace(/\s+/g, ' ').trim();

/** Build the process model for one workflow. */
export function buildProcessModel(ast: TWorkflowAST): ProcessModel {
  const nodeTypes = new Map<string, TWorkflowAST['nodeTypes'][number]>();
  for (const nt of ast.nodeTypes) {
    nodeTypes.set(nt.name, nt);
    nodeTypes.set(nt.functionName, nt);
  }
  const byId = new Map(ast.instances.map((i) => [i.id, i]));
  const isControl = (c: TConnectionAST) => STEP_PORTS.has(c.from.port) || c.to.port === 'execute';
  const control = ast.connections.filter(isControl);
  const data = ast.connections.filter((c) => !isControl(c));

  // Stage: longest control path from Start. A step with no control edge in
  // (pull/lazy or data-only) sits after whatever it reads.
  const order = getTopologicalOrder(ast);
  const stage = new Map<string, number>();
  for (const id of order) {
    const ins = control.filter((c) => c.to.node === id);
    let s = 0;
    for (const c of ins) s = Math.max(s, c.from.node === 'Start' ? 1 : (stage.get(c.from.node) ?? 0) + 1);
    if (ins.length === 0) {
      const dataIns = data.filter((c) => c.to.node === id && c.from.node !== 'Start');
      s = Math.max(1, ...dataIns.map((c) => (stage.get(c.from.node) ?? 0) + 1));
    }
    stage.set(id, s);
  }

  // Segment: increments after every pause, in execution order.
  let segment = 0;
  const segmentOf = new Map<string, number>();
  for (const id of order) {
    segmentOf.set(id, segment);
    if (nodeTypes.get(byId.get(id)?.nodeType ?? '')?.durableGate) segment++;
  }

  const describe = (inst: TWorkflowAST['instances'][number]): ProcessStep => {
    const nt = nodeTypes.get(inst.nodeType);
    const outputs = Object.keys(nt?.outputs ?? {}).filter((p) => !STEP_PORTS.has(p));
    const kind: ProcessKind = nt?.durableGate
      ? 'pause'
      : nt?.durableEffect
        ? 'effect'
        : nt?.scope || (nt?.scopes?.length ?? 0) > 0
          ? 'loop'
          : 'step';
    return {
      id: inst.id,
      label: inst.config?.label ?? nt?.label ?? inst.id,
      type: nt?.functionName ?? inst.nodeType,
      kind,
      gate: nt?.durableGate ?? null,
      scope: nt?.scope ?? nt?.scopes?.[0] ?? null,
      pure: Boolean(nt?.expression || nt?.durablePure),
      expression: Boolean(nt?.expression),
      stage: stage.get(inst.id) ?? 0,
      segment: segmentOf.get(inst.id) ?? 0,
      reads: data
        .filter((c) => c.to.node === inst.id)
        .map((c) => ({ port: c.to.port, from: c.from.node, fromPort: c.from.port })),
      exprs: (inst.config?.portConfigs ?? [])
        .filter((p) => p.expression)
        .map((p) => ({ port: p.portName, expr: String(p.expression) })),
      produces: outputs.map((port) => ({
        port,
        to: [...new Set(data.filter((c) => c.from.node === inst.id && c.from.port === port).map((c) => c.to.node))],
      })),
      children: ast.instances.filter((i) => i.parent?.id === inst.id).map(describe),
      entered: control
        .filter((c) => c.to.node === inst.id)
        .map((c) => ({ from: c.from.node, arm: c.from.port === 'onFailure' ? 'fail' : 'ok' })),
      successTo: control.filter((c) => c.from.node === inst.id && c.from.port === 'onSuccess').map((c) => c.to.node),
      failureTo: control.filter((c) => c.from.node === inst.id && c.from.port === 'onFailure').map((c) => c.to.node),
      gateInputs: Object.keys(nt?.inputs ?? {}).filter((p) => p !== 'execute'),
      gateOutputs: outputs,
      description: firstParagraph(nt?.description),
    };
  };

  const steps = order
    .map((id) => byId.get(id))
    .filter((inst): inst is TWorkflowAST['instances'][number] => Boolean(inst && !inst.parent))
    .map(describe);

  return {
    name: ast.functionName,
    description: firstParagraph(ast.description),
    params: Object.keys(ast.startPorts ?? {}).filter((p) => !STEP_PORTS.has(p)),
    returns: Object.keys(ast.exitPorts ?? {}).filter((p) => !STEP_PORTS.has(p)),
    steps,
    startTo: control.filter((c) => c.from.node === 'Start').map((c) => c.to.node),
    exitFrom: control
      .filter((c) => c.to.node === 'Exit')
      .map((c) => ({ from: c.from.node, arm: c.from.port === 'onFailure' ? 'fail' : 'ok' })),
    segments: segment + 1,
  };
}

export interface ProcessViewOptions {
  title?: string;
  theme?: 'dark' | 'light';
}

/** Render one or more workflows as a self-contained interactive process page. */
export function renderProcessPage(models: ProcessModel[], options: ProcessViewOptions = {}): string {
  const title = options.title ?? (models.length === 1 ? models[0].name : 'Workflow as a process');
  const light = options.theme === 'light';
  return PAGE_TEMPLATE.replace('__TITLE__', escapeHtml(title))
    .replace('__THEME__', light ? LIGHT_VARS : DARK_VARS)
    .replace('__MODELS__', JSON.stringify(models).replace(/</g, '\\u003c'));
}

/** Render a single workflow AST as a process page. */
export function renderProcessHTML(ast: TWorkflowAST, options: ProcessViewOptions = {}): string {
  return renderProcessPage([buildProcessModel(ast)], options);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

const DARK_VARS = `--bg:#0b0e14;--panel:#141a23;--panel2:#1b2230;--line:#2a3342;--fg:#e6edf3;--muted:#8b98a9;--accent:#58a6ff;--pause:#f0883e;--fail:#f85149;--ok:#3fb950;--loop:#bc8cff;--effect:#d29922;--wire:#3b4757;--dim:.28`;
const LIGHT_VARS = `--bg:#ffffff;--panel:#f6f8fa;--panel2:#eaeef2;--line:#d0d7de;--fg:#1f2328;--muted:#656d76;--accent:#0969da;--pause:#bc4c00;--fail:#cf222e;--ok:#1a7f37;--loop:#8250df;--effect:#9a6700;--wire:#8c959f;--dim:.35`;

// The page: markup, styles and the small runtime that expands steps, plays
// the process and simulates failures. Kept as one template so the output is
// a single file with no dependencies.
const PAGE_TEMPLATE = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__</title>
<style>
:root{__THEME__}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.top{position:sticky;top:0;z-index:5;background:linear-gradient(var(--bg) 85%,transparent);padding:14px 22px 10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.top h1{font-size:15px;margin:0 8px 0 0;font-weight:600}
.seg{display:flex;border:1px solid var(--line);border-radius:999px;overflow:hidden}.seg button{background:transparent;color:var(--muted);border:0;padding:6px 12px;cursor:pointer;font:inherit}.seg button.on{background:var(--panel2);color:var(--fg)}.seg:empty{display:none}
.ctl{margin-left:auto;display:flex;gap:6px;align-items:center;flex-wrap:wrap}.ctl button,.ctl label{background:var(--panel);border:1px solid var(--line);color:var(--fg);border-radius:8px;padding:6px 11px;cursor:pointer;font:inherit}.ctl button.primary{border-color:var(--accent);color:var(--accent)}.ctl label{color:var(--muted);display:flex;gap:6px;align-items:center}
.status{color:var(--muted);font-size:12px;min-width:200px}
main{padding:6px 22px 60px;max-width:1100px;margin:0 auto}
.meta{color:var(--muted);font-size:12.5px;margin:4px 0 22px}.meta b{color:var(--fg)}
.wrap{position:relative}
svg.wires{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}
.wires path{fill:none;stroke:var(--line);stroke-width:2}.wires path.ok{stroke:var(--wire)}.wires path.fail{stroke:var(--fail);stroke-dasharray:5 5;opacity:.55}.wires path.lit{stroke:var(--accent);stroke-width:2.5;opacity:1}.wires path.lit.fail{stroke:var(--fail)}
.wires path.data{stroke:var(--accent);opacity:.18;stroke-width:1.2;display:none}.wrap.showdata .wires path.data{display:block}
.endcap{display:flex;justify-content:center;margin:0 0 16px}.endcap span{background:var(--panel2);border:1px solid var(--line);border-radius:999px;padding:4px 14px;color:var(--muted);font-size:12px}
.stage{display:flex;justify-content:center;gap:18px;margin:26px 0;position:relative;z-index:1}
.node{position:relative;background:var(--panel);border:1px solid var(--line);border-radius:12px;width:280px;max-width:100%;transition:transform .25s,opacity .3s,border-color .25s,box-shadow .25s;cursor:pointer}
.node:hover{border-color:var(--wire)}.node.open{width:340px}
.node .row{display:flex;align-items:center;gap:10px;padding:10px 12px}
.node .n{width:22px;height:22px;border-radius:50%;background:var(--panel2);color:var(--muted);font-size:11px;display:grid;place-items:center;flex:none;border:1px solid var(--line)}
.node .t{font-weight:600;font-size:14px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.node .k{font-size:10.5px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:1px 7px;flex:none}
.node.pause{border-color:var(--pause)}.node.pause .k{color:var(--pause);border-color:var(--pause)}.node.pause .n{border-color:var(--pause);color:var(--pause)}
.node.loop{border-color:var(--loop)}.node.loop .k{color:var(--loop);border-color:var(--loop)}
.node.effect{border-color:var(--effect)}.node.effect .k{color:var(--effect)}
.node.done{border-color:var(--ok)}.node.done .n{background:var(--ok);color:#fff;border-color:var(--ok)}
.node.active{border-color:var(--accent);box-shadow:0 0 0 3px rgba(88,166,255,.18);transform:translateY(-1px)}
.node.waiting{border-color:var(--pause);box-shadow:0 0 0 0 rgba(240,136,62,.5);animation:pulse 1.4s ease-out infinite}@keyframes pulse{to{box-shadow:0 0 0 12px rgba(240,136,62,0)}}
.node.failed{border-color:var(--fail)}.node.failed .n{background:var(--fail);color:#fff;border-color:var(--fail)}
.node.skipped{opacity:var(--dim)}
.node .det{display:grid;grid-template-rows:0fr;transition:grid-template-rows .28s ease}.node.open .det{grid-template-rows:1fr}.node .det>div{overflow:hidden}
.det .in{padding:0 12px 12px;font-size:12.5px;color:var(--muted);display:grid;gap:8px}.det p{margin:0;color:var(--fg)}.det .kv .h{font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px}
.chip{display:inline-block;background:var(--panel2);border-radius:6px;padding:1px 7px;margin:2px 4px 2px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;color:var(--fg)}.chip s{text-decoration:none;color:var(--muted)}
.det .act{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.det .act label{display:flex;gap:6px;align-items:center;cursor:pointer;color:var(--fg)}.det .act .fto{color:var(--fail)}
.det .resolve{background:var(--pause);color:#fff;border:0;border-radius:8px;padding:6px 12px;font:inherit;font-weight:600;cursor:pointer}
.inner{margin:0 12px 12px;border-left:2px solid var(--loop);padding:4px 0 4px 10px;display:grid;gap:6px}.inner .mini{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:6px 10px;font-size:12.5px;display:flex;gap:8px;align-items:center;transition:border-color .2s}.inner .mini.active{border-color:var(--loop)}.inner .mini .n{width:18px;height:18px;font-size:10px}
.segband{display:flex;justify-content:center;margin:-8px 0 -8px;position:relative;z-index:1}.segband span{font-size:11px;color:var(--pause);background:var(--bg);padding:0 8px;border:1px dashed var(--pause);border-radius:999px}
.help{color:var(--muted);font-size:12px;margin:26px 0 0;max-width:80ch}
@media (max-width:640px){.node{width:100%}.node.open{width:100%}.stage{flex-direction:column;align-items:stretch}}
</style></head><body>
<div class="top"><h1>Workflow as a process</h1><div class="seg" id="nav"></div>
<div class="ctl"><button class="primary" id="play">▶ Play</button><button id="step">Step</button><button id="reset">Reset</button><label><input type="checkbox" id="data"> data flow</label><span class="status" id="status"></span></div></div>
<main><div id="meta" class="meta"></div><div class="wrap" id="wrap"></div>
<p class="help">Click a step to expand it. In an expanded step, tick <b>fail here</b> to see which arm the process takes instead — the failure rail lights up and everything that would not run goes dark. Play walks the process in topological order; at a pause it waits for you to resolve the gate, as <code>fw_run</code>/<code>fw_resume</code> would.</p></main>
<script>
const MODELS = __MODELS__;
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const chip = (a, b) => '<span class="chip">' + esc(a) + (b ? ' <s>' + esc(b) + '</s>' : '') + '</span>';
let M, sim, failAt = new Set(), open = new Set(), timer = null, cursor = 0, playing = false, waitingFor = null;
function nodeHtml(s, i){
  const kind = s.kind === 'pause' ? 'pause · ' + s.gate : s.kind === 'loop' ? 'loop' : s.kind === 'effect' ? 'effect' : (s.pure ? 'pure' : 'step');
  const reads = s.reads.map(r => chip(r.port, '← ' + r.from + '.' + r.fromPort)).concat(s.exprs.map(r => chip(r.port, '= ' + r.expr))).join('');
  const prod = s.produces.map(p => chip(p.port, p.to.length ? '→ ' + p.to.join(', ') : '(unread)')).join('');
  const pauseTxt = s.kind === 'pause' ? '<p><b style="color:var(--pause)">The process stops here.</b> A ' + esc(s.gate) + ' resolver sees <em>' + s.gateInputs.map(esc).join(', ') + '</em> and answers with <em>' + (s.gateOutputs.map(esc).join(', ')||'nothing') + '</em>. What follows is segment ' + (s.segment+1) + ' of ' + M.segments + '.</p>' : '';
  const fails = s.failureTo.length ? '<div class="act"><label><input type="checkbox" data-fail="' + esc(s.id) + '"' + (failAt.has(s.id)?' checked':'') + '> fail here</label><span class="fto">✗ → ' + s.failureTo.map(esc).join(', ') + '</span></div>' : (s.kind==='pause' ? '<div class="act"><label><input type="checkbox" data-fail="' + esc(s.id) + '"' + (failAt.has(s.id)?' checked':'') + '> reject at this gate</label><span class="fto">✗ → (unwired: run ends)</span></div>' : '');
  const resolve = s.kind === 'pause' ? '<div class="act"><button class="resolve" data-resolve="' + esc(s.id) + '">Resolve gate ▶</button></div>' : '';
  const inner = s.children.length ? '<div class="inner">' + s.children.map((c,j)=>'<div class="mini" data-id="' + esc(c.id) + '"><span class="n">' + (j+1) + '</span><span>' + esc(c.label) + '</span><span style="color:var(--muted);font-size:11px;margin-left:auto">' + esc(c.kind==='pause'?'pause':c.pure?'pure':'step') + '</span></div>').join('') + '</div>' : '';
  return '<div class="node ' + s.kind + (open.has(s.id)?' open':'') + '" data-id="' + esc(s.id) + '">' +
    '<div class="row"><span class="n">' + (i+1) + '</span><span class="t" title="' + esc(s.id + ' · ' + s.type) + '">' + esc(s.label) + '</span><span class="k">' + esc(kind) + '</span></div>' +
    '<div class="det"><div><div class="in">' + (s.description ? '<p>' + esc(s.description) + '</p>' : '') + pauseTxt +
    (reads ? '<div class="kv"><div class="h">reads</div>' + reads + '</div>' : '') + (prod ? '<div class="kv"><div class="h">produces</div>' + prod + '</div>' : '') +
    '<div class="kv"><div class="h">node</div>' + chip(s.id) + chip(s.type) + '</div>' + fails + resolve + '</div>' + inner + '</div></div></div>';
}
function render(){
  const wrap = document.getElementById('wrap');
  const byStage = new Map(); M.steps.forEach(s => { (byStage.get(s.stage) ?? byStage.set(s.stage, []).get(s.stage)).push(s); });
  const stages = [...byStage.keys()].sort((a,b)=>a-b);
  let h = '<svg class="wires" id="wires"></svg><div class="endcap"><span>Start · ' + (M.params.map(esc).join(', ')||'—') + '</span></div>';
  let idx = 0;
  for (const st of stages) {
    const lanes = byStage.get(st);
    h += '<div class="stage">' + lanes.map(s => nodeHtml(s, idx++)).join('') + '</div>';
    const gate = lanes.find(s => s.kind === 'pause');
    if (gate) h += '<div class="segband"><span>pause · segment ' + (gate.segment+1) + ' begins after</span></div>';
  }
  h += '<div class="endcap"><span>Exit · ' + (M.returns.map(esc).join(', ')||'—') + '</span></div>';
  wrap.innerHTML = h;
  document.getElementById('meta').innerHTML = '<b>' + esc(M.name) + '</b>' + (M.description ? ' — ' + esc(M.description) : '') + ' <span style="opacity:.7">· ' + M.steps.length + ' steps · ' + stages.length + ' stages' + (M.segments>1 ? ' · ' + (M.segments-1) + ' pause' + (M.segments>2?'s':'') : '') + '</span>';
  wrap.querySelectorAll('.node').forEach(n => n.addEventListener('click', e => {
    if (e.target.closest('input,button,label')) return;
    const id = n.dataset.id; open.has(id) ? open.delete(id) : open.add(id); n.classList.toggle('open');
    setTimeout(drawWires, 300);
  }));
  wrap.querySelectorAll('input[data-fail]').forEach(cb => cb.addEventListener('change', () => { cb.checked ? failAt.add(cb.dataset.fail) : failAt.delete(cb.dataset.fail); simulate(); paint(); }));
  wrap.querySelectorAll('button[data-resolve]').forEach(b => b.addEventListener('click', () => { if (waitingFor === b.dataset.resolve) { waitingFor = null; advance(); if (playing) schedule(); } }));
  simulate(); paint(); requestAnimationFrame(drawWires);
}
function rect(id){ const el = document.querySelector('.node[data-id="' + CSS.escape(id) + '"]'); if(!el) return null; const w = document.getElementById('wrap').getBoundingClientRect(), r = el.getBoundingClientRect(); return { x:r.left-w.left, y:r.top-w.top, w:r.width, h:r.height }; }
function capRect(which){ const caps = document.querySelectorAll('#wrap .endcap span'); const el = which==='Start'?caps[0]:caps[caps.length-1]; const w = document.getElementById('wrap').getBoundingClientRect(), r = el.getBoundingClientRect(); return { x:r.left-w.left, y:r.top-w.top, w:r.width, h:r.height }; }
function drawWires(){
  const svg = document.getElementById('wires'); if(!svg) return; const wrap = document.getElementById('wrap'); svg.setAttribute('viewBox', '0 0 ' + wrap.clientWidth + ' ' + wrap.scrollHeight); svg.style.height = wrap.scrollHeight + 'px';
  const paths = [];
  const link = (a, b, cls, id) => { if(!a||!b) return; const x1=a.x+a.w/2, y1=a.y+a.h, x2=b.x+b.w/2, y2=b.y; const my=(y1+y2)/2; paths.push('<path data-e="' + id + '" class="' + cls + '" d="M' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + my + ', ' + x2 + ' ' + my + ', ' + x2 + ' ' + y2 + '"/>'); };
  const rail = (a, b, cls, id) => { if(!a||!b) return; const x1=a.x+a.w, y1=a.y+a.h*0.5, x2=b.x+b.w, y2=b.y+b.h*0.5, xo=Math.max(x1,x2)+34; paths.push('<path data-e="' + id + '" class="' + cls + '" d="M' + x1 + ' ' + y1 + ' C ' + xo + ' ' + y1 + ', ' + xo + ' ' + y2 + ', ' + x2 + ' ' + y2 + '"/>'); };
  const S = capRect('Start'), E = capRect('Exit');
  for (const t of M.startTo) link(S, rect(t), 'ok', 'Start>' + t);
  for (const s of M.steps) {
    for (const t of s.successTo) t === 'Exit' ? link(rect(s.id), E, 'ok', s.id + '>Exit') : link(rect(s.id), rect(t), 'ok', s.id + '>' + t);
    for (const t of s.failureTo) t === 'Exit' ? rail(rect(s.id), E, 'fail', s.id + '!Exit') : rail(rect(s.id), rect(t), 'fail', s.id + '!' + t);
    for (const r of s.reads) if (r.from !== 'Start' && !s.entered.some(e => e.from === r.from)) { const a = rect(r.from), b = rect(s.id); if (a && b) paths.push('<path class="data" d="M' + (a.x+8) + ' ' + (a.y+a.h) + ' C ' + (a.x-40) + ' ' + ((a.y+a.h+b.y)/2) + ', ' + (b.x-40) + ' ' + ((a.y+a.h+b.y)/2) + ', ' + (b.x+8) + ' ' + b.y + '"/>'); }
  }
  svg.innerHTML = paths.join(''); paintWires();
}
// Simulation: any arriving control edge triggers a step; a step's outcome is ok unless the reader chose "fail here".
function simulate(){
  const ran = new Map(); const edgesLit = new Set(); const stepsById = new Map(M.steps.map(s => [s.id, s]));
  const fire = (id, from, arm) => { edgesLit.add(from + (arm==='fail'?'!':'>') + id); if (id === 'Exit' || ran.has(id)) return; const s = stepsById.get(id); if(!s) return; const out = failAt.has(id) ? 'fail' : 'ok'; ran.set(id, out); (out==='ok' ? s.successTo : s.failureTo).forEach(t => fire(t, id, out)); };
  M.startTo.forEach(t => fire(t, 'Start', 'ok'));
  sim = { ran, edgesLit, order: M.steps.filter(s => ran.has(s.id)).map(s => s.id) };
}
function paint(){
  document.querySelectorAll('#wrap .node').forEach(n => { const id = n.dataset.id; const k = sim.order.indexOf(id); n.classList.toggle('skipped', !sim.ran.has(id)); n.classList.toggle('done', k > -1 && k < cursor && sim.ran.get(id)==='ok'); n.classList.toggle('failed', k > -1 && k < cursor && sim.ran.get(id)==='fail'); n.classList.toggle('active', k === cursor - 1 && waitingFor !== id && playing); n.classList.toggle('waiting', waitingFor === id); n.querySelectorAll('.mini').forEach(m => m.classList.remove('active')); });
  paintWires();
  const st = document.getElementById('status');
  if (waitingFor) st.textContent = 'paused at ' + waitingFor + ' — resolve to continue'; else if (cursor >= sim.order.length && cursor > 0) st.textContent = 'run complete: ' + sim.order.length + ' steps' + (failAt.size ? ', failures at ' + [...failAt].join(', ') : ''); else st.textContent = cursor ? 'step ' + cursor + ' of ' + sim.order.length : (failAt.size ? 'simulating failure at ' + [...failAt].join(', ') : '');
}
function paintWires(){
  const done = new Set(sim.order.slice(0, cursor));
  document.querySelectorAll('#wires path[data-e]').forEach(p => { const e = p.dataset.e; const m = e.match(/^(.*?)([>!])(.*)$/); const from = m[1]; const active = sim.edgesLit.has(e); p.classList.toggle('lit', active && (from === 'Start' ? cursor > 0 : done.has(from))); p.style.opacity = active ? '' : '.18'; });
}
function advance(){
  if (cursor >= sim.order.length) { playing = false; document.getElementById('play').textContent = '▶ Play'; paint(); return false; }
  const id = sim.order[cursor]; const s = M.steps.find(x => x.id === id); cursor++;
  const el = document.querySelector('.node[data-id="' + CSS.escape(id) + '"]');
  if (s.kind === 'pause' && sim.ran.get(id) === 'ok') { waitingFor = id; open.add(id); el.classList.add('open'); paint(); setTimeout(drawWires, 300); el.scrollIntoView({block:'center',behavior:'smooth'}); return false; }
  if (s.children.length) { const minis = el.querySelectorAll('.mini'); minis.forEach((m,i) => setTimeout(() => { minis.forEach(x=>x.classList.remove('active')); m.classList.add('active'); }, i*220)); }
  paint(); el?.scrollIntoView({block:'center',behavior:'smooth'}); return true;
}
function schedule(){ clearTimeout(timer); if (!playing || waitingFor) return; timer = setTimeout(() => { const more = advance(); if (more && playing) schedule(); }, 700); }
document.getElementById('play').onclick = () => { if (playing) { playing = false; clearTimeout(timer); document.getElementById('play').textContent = '▶ Play'; paint(); return; } if (cursor >= sim.order.length) reset(false); playing = true; document.getElementById('play').textContent = '❚❚ Pause'; if (!waitingFor) { advance(); schedule(); } };
document.getElementById('step').onclick = () => { if (waitingFor) return; playing = false; document.getElementById('play').textContent = '▶ Play'; advance(); };
function reset(all){ clearTimeout(timer); playing = false; cursor = 0; waitingFor = null; if (all) { failAt.clear(); open.clear(); } document.getElementById('play').textContent = '▶ Play'; render(); }
document.getElementById('reset').onclick = () => reset(true);
document.getElementById('data').onchange = e => document.getElementById('wrap').classList.toggle('showdata', e.target.checked);
const nav = document.getElementById('nav');
if (MODELS.length > 1) MODELS.forEach((m, i) => { const b = document.createElement('button'); b.textContent = m.name; b.onclick = () => { [...nav.children].forEach((x,j)=>x.classList.toggle('on', i===j)); M = m; failAt.clear(); open.clear(); reset(false); }; nav.appendChild(b); });
new ResizeObserver(() => drawWires()).observe(document.getElementById('wrap'));
if (MODELS.length > 1) nav.children[0].click(); else { M = MODELS[0]; reset(false); }
</script></body></html>`;
