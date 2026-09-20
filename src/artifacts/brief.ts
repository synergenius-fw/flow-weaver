/**
 * A workflow as a document for people who will not open the code.
 *
 * The picture comes first: the spine the console draws, large, with every
 * step there to be clicked. A product manager reads what goes in, what
 * comes out and where a person is needed; an architect reads the same and
 * follows the arms. One self-contained file, nothing fetched.
 *
 * Two renderings of the same content:
 * - `interactive` (the default): the page. Click a step and a panel beside
 *   the graph says what it does, what it reads, what it hands on and where
 *   its failure goes; the edges that touch it light up. Light and dark, a
 *   print button.
 * - `print`: the same content for paper, no script. The first page is the
 *   overview -- the graph at the size the console draws it, beside what goes
 *   in, what comes out, who is waited for and what happens on failure; the
 *   pages after it are every step in detail. This is what the PDF is made
 *   from; the interactive page prints its own, simpler, version.
 */
import type { TWorkflowAST, TNodeTypeAST } from '../ast/types.js';
import { buildProcessModel, renderSpineSVG, type ProcessStep } from '../diagram/index.js';
import { stepLabel } from '../diagram/labels.js';

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const CONTROL = new Set(['execute', 'onSuccess', 'onFailure']);

const WHO: Record<string, string> = {
  approval: 'A person decides whether to go on',
  input: 'A person or system provides input',
  agent: 'An AI agent does a task and reports back',
};

export interface BriefOptions {
  theme?: 'light' | 'dark';
  /** Shown under the title; the project's name, say. */
  subtitle?: string;
  /** The page (default), or the same content laid out for paper. */
  mode?: 'interactive' | 'print';
}

interface PortRow { name: string; type: string; description: string; optional: boolean }

/** What the page knows about one step, embedded as JSON for the panel. */
interface StepInfo {
  id: string; label: string; type: string; kind: ProcessStep['kind']; gate: string | null; scope: string | null;
  depth: number; owner: string | null; description: string; pull: boolean; expression: boolean;
  inputs: PortRow[]; outputs: PortRow[];
  reads: ProcessStep['reads']; exprs: ProcessStep['exprs']; produces: ProcessStep['produces'];
  entered: ProcessStep['entered']; successTo: string[]; failureTo: string[];
  gateInputs: string[]; gateOutputs: string[];
}

/** Everything the brief says, gathered once and rendered by either mode. */
function gather(ast: TWorkflowAST) {
  const model = buildProcessModel(ast);
  const typeOf = (id: string): TNodeTypeAST | undefined => {
    const inst = ast.instances.find((i) => i.id === id);
    return inst ? ast.nodeTypes.find((n) => n.name === inst.nodeType) ?? ast.nodeTypes.find((n) => n.functionName === inst.nodeType) : undefined;
  };
  const ports = (map: Record<string, { tsType?: string; dataType?: string; description?: string; optional?: boolean }> | undefined): PortRow[] =>
    Object.entries(map ?? {}).filter(([k, p]) => !CONTROL.has(k) && !(p as { isControlFlow?: boolean }).isControlFlow)
      .map(([name, p]) => ({ name, type: p.tsType ?? String(p.dataType ?? '').toLowerCase(), description: p.description ?? '', optional: !!p.optional }));
  const params = ports(ast.startPorts);
  const returns = ports(ast.exitPorts);

  const steps: StepInfo[] = [];
  const walk = (list: ProcessStep[], depth: number) => {
    for (const s of list) {
      const inst = ast.instances.find((i) => i.id === s.id);
      const nt = typeOf(s.id);
      steps.push({
        id: s.id, label: s.label, type: s.type, kind: s.kind, gate: s.gate, scope: s.scope, depth,
        owner: inst?.parent?.id ?? null,
        description: s.description || nt?.description || '',
        pull: inst?.config?.pullExecution !== undefined,
        expression: !!nt?.expression,
        inputs: ports(nt?.inputs), outputs: ports(nt?.outputs),
        reads: s.reads, exprs: s.exprs, produces: s.produces, entered: s.entered,
        successTo: s.successTo, failureTo: s.failureTo, gateInputs: s.gateInputs, gateOutputs: s.gateOutputs,
      });
      walk(s.children, depth + 1);
    }
  };
  walk(model.steps, 0);
  const labels: Record<string, string> = { Start: 'Start', Exit: 'Exit' };
  for (const inst of ast.instances) labels[inst.id] = stepLabel(inst, typeOf(inst.id));
  return { model, params, returns, steps, labels, gates: steps.filter((s) => s.kind === 'pause'), arms: steps.filter((s) => s.failureTo.length) };
}

type Gathered = ReturnType<typeof gather>;

function portTable(rows: PortRow[], empty: string): string {
  return rows.length
    ? `<table><thead><tr><th>Name</th><th>Type</th><th>Description</th></tr></thead><tbody>${rows.map((p) => `<tr><td><code>${esc(p.name)}${p.optional ? '?' : ''}</code></td><td><code>${esc(p.type)}</code></td><td>${esc(p.description)}</td></tr>`).join('')}</tbody></table>`
    : `<p class="muted">${empty}</p>`;
}

function kindTag(s: StepInfo): string {
  if (s.kind === 'pause') return `<span class="tag gate">${esc(s.gate ?? 'gate')} gate</span>`;
  if (s.kind === 'loop') return `<span class="tag loop">repeats${s.scope ? ` over ${esc(s.scope)}` : ''}</span>`;
  if (s.kind === 'effect') return '<span class="tag effect">effect</span>';
  return '';
}

/** The parts every rendering shares -- contract, steps, gates -- each on its own so a page can place them. */
function parts(g: Gathered, interactive: boolean) {
  const stepRows = g.steps.map((s, i) => {
    const then = s.failureTo.length ? `<div class="muted">on failure → ${s.failureTo.map((t) => esc(g.labels[t] ?? t)).join(', ')}</div>` : '';
    const ownerOf = s.owner ? g.steps.find((o) => o.id === s.owner) : undefined;
    const inside = ownerOf ? `<div class="muted">once per ${esc(ownerOf.scope ?? 'item')}, inside ${esc(ownerOf.label)}</div>` : '';
    return `<tr${interactive ? ` class="steprow" data-id="${esc(s.id)}"` : ''}><td class="num">${i + 1}</td><td style="padding-left:${12 + s.depth * 18}px"><b>${esc(s.label)}</b>${kindTag(s) ? ` ${kindTag(s)}` : ''}<div class="muted mono">${esc(s.type)}</div></td><td>${esc(s.description)}${inside}${then}</td></tr>`;
  }).join('');
  const gateRows = g.gates.map((s) => `<tr${interactive ? ` class="steprow" data-id="${esc(s.id)}"` : ''}><td><b>${esc(s.label)}</b></td><td>${esc(WHO[s.gate ?? ''] ?? 'The run pauses')}</td><td>${s.gateInputs.length ? `sees <code>${s.gateInputs.map(esc).join('</code>, <code>')}</code>` : ''}${s.gateOutputs.length ? `<br>answers with <code>${s.gateOutputs.map(esc).join('</code>, <code>')}</code>` : ''}</td></tr>`).join('');
  return {
    inputs: portTable(g.params, 'This workflow takes no parameters.'),
    outputs: portTable(g.returns, 'This workflow returns only whether it succeeded.'),
    steps: `<table><thead><tr><th></th><th>Step</th><th>What happens</th></tr></thead><tbody>${stepRows}</tbody></table>`,
    gates: g.gates.length
      ? `<p class="muted">The run pauses at each of these and continues when answered — from the console, or by an assistant over MCP. A paused run survives restarts.</p><table><thead><tr><th>Step</th><th>Who</th><th>Exchange</th></tr></thead><tbody>${gateRows}</tbody></table>`
      : '',
  };
}

/** The shared parts as one column, for paper. */
function sections(g: Gathered): string {
  const p = parts(g, false);
  return `
  <section><h2>What goes in</h2>${p.inputs}</section>
  <section><h2>What comes out</h2>${p.outputs}</section>
  <section><h2>How it runs</h2>${p.steps}</section>
  ${p.gates ? `<section><h2>Where a person or an agent is needed</h2>${p.gates}</section>` : ''}`;
}

function tokens(dark: boolean): string {
  return `--bg:${dark ? '#0e1014' : '#ffffff'}; --fg:${dark ? '#e7e9ee' : '#1a1d24'}; --muted:${dark ? '#8a90a0' : '#667085'}; --faint:${dark ? '#5c6270' : '#98a2b3'}; --line:${dark ? '#2a303c' : '#e3e6eb'}; --panel:${dark ? '#151923' : '#f6f7f9'}; --panel-2:${dark ? '#1b1f27' : '#eef0f4'}; --accent:${dark ? '#6ea8fe' : '#2f6fed'}; --gate:${dark ? '#c79bff' : '#8f5bd6'}; --loop:${dark ? '#5fd4d9' : '#1d9aa2'}; --effect:${dark ? '#ff9f5a' : '#d97a2b'}; --err:${dark ? '#f0636a' : '#d64550'}; --pull:${dark ? '#f2c94c' : '#b7860b'}; --graph:${dark ? '#0e1014' : '#f6f7f9'};`;
}

const BASE_CSS = `
  * { box-sizing: border-box; } html { color-scheme: light; } html[data-theme=dark] { color-scheme: dark; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.55 -apple-system, BlinkMacSystemFont, Inter, "Segoe UI", Roboto, sans-serif; }
  h1 { font-size: 28px; margin: 0 0 4px; letter-spacing: -.3px; } h2 { font-size: 16px; margin: 0 0 10px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
  section { margin: 30px 0 0; }
  .sub { color: var(--muted); margin: 0 0 6px; font-size: 13px; } .lede { font-size: 15px; margin: 10px 0 0; max-width: 70ch; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; } th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; } th { color: var(--muted); font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: .4px; }
  td.num { color: var(--muted); width: 32px; } code, .mono { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 12.5px; } .muted { color: var(--muted); font-size: 12.5px; }
  .tag { display: inline-block; font-size: 11px; padding: 1px 7px; border-radius: 10px; border: 1px solid currentColor; margin-left: 6px; vertical-align: middle; } .tag.gate { color: var(--gate); } .tag.loop { color: var(--loop); } .tag.effect { color: var(--effect); } .tag.pull { color: var(--pull); }
  .facts { display: flex; gap: 8px; flex-wrap: wrap; margin: 14px 0 0; } .facts span { font-size: 12.5px; color: var(--muted); padding: 4px 10px; border: 1px solid var(--line); border-radius: 14px; } .facts b { color: var(--fg); font-weight: 600; margin-right: 4px; }
  .graph { background: var(--graph); border: 1px solid var(--line); border-radius: 10px; padding: 16px; overflow: auto; } .graph svg { display: block; width: 100%; height: auto; max-width: 820px; margin: 0 auto; }
  footer { margin-top: 40px; color: var(--muted); font-size: 12px; border-top: 1px solid var(--line); padding-top: 12px; }
`;

/**
 * The workflow's description is often the author's note to the next author
 * -- paragraphs about why the wiring is the way it is. The brief opens with
 * its first paragraph, cut at a sentence when that is still long; the
 * reader this page is for wants the gist, not the rationale.
 */
export function lede(description: string | undefined): string {
  const first = (description ?? '').split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
  if (first.length <= 280) return first;
  const cut = first.slice(0, 280);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > 80 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

function head(ast: TWorkflowAST, g: Gathered, subtitle: string | undefined): string {
  const file = ast.sourceFile.split(/[\\/]/).pop() ?? '';
  const intro = lede(ast.description);
  return `
  <p class="sub">${subtitle ? `${esc(subtitle)} · ` : ''}<span class="mono">${esc(file)}</span></p>
  <h1>${esc(ast.functionName)}</h1>
  ${intro ? `<p class="lede">${esc(intro)}</p>` : ''}
  <div class="facts">
    <span><b>${g.steps.length}</b>${g.steps.length === 1 ? 'step' : 'steps'}</span>
    <span><b>${g.gates.length}</b>${g.gates.length === 1 ? 'pause for a person or agent' : 'pauses for a person or agent'}</span>
    <span><b>${g.arms.length}</b>failure ${g.arms.length === 1 ? 'arm' : 'arms'}</span>
    <span><b>${g.params.length}</b>${g.params.length === 1 ? 'input' : 'inputs'}</span>
    <span><b>${g.returns.length}</b>${g.returns.length === 1 ? 'output' : 'outputs'}</span>
  </div>`;
}

function footer(ast: TWorkflowAST, subtitle: string | undefined): string {
  const when = new Date().toISOString().slice(0, 10);
  const file = ast.sourceFile.split(/[\\/]/).pop() ?? '';
  return `<footer>Generated by Flow Weaver on ${when} from <span class="mono">${esc(file)}</span>${subtitle ? ` in ${esc(subtitle)}` : ''}. The workflow file is the source of truth; this brief describes it as of that day.</footer>`;
}

/** The brief as HTML. */
export function renderBrief(ast: TWorkflowAST, options: BriefOptions = {}): string {
  const g = gather(ast);
  return options.mode === 'print' ? renderPrint(ast, g, options) : renderInteractive(ast, g, options);
}

function svgOf(ast: TWorkflowAST, theme: 'light' | 'dark'): string {
  try { return renderSpineSVG(ast, { theme, title: false }); } catch { return ''; }
}

// ---- print -----------------------------------------------------------------

/** The printable area of an A4 page at CSS resolution, inside `PAGE_MARGIN`. */
const PAGE_MARGIN = '12mm 12mm 14mm';
const PAGE = { w: Math.floor((210 - 24) / 25.4 * 96), h: Math.floor((297 - 26) / 25.4 * 96) };
/** The narrowest the overview column beside the graph is allowed to be. */
const ASIDE_MIN = 250;
const GUTTER = 26;
/** Below this the graph's labels stop being readable on paper. */
const MIN_SCALE = 0.62;

/**
 * Where the graph goes and how large. It is drawn at its natural size when
 * that fits beside the overview on the first page, scaled down when it is
 * somewhat too tall, and given a page of its own when scaling it to fit
 * would make it unreadable. Pure, so it is tested with numbers.
 */
export function fitGraph(w: number, h: number, headerPx: number, page = PAGE): { scale: number; ownPage: boolean } {
  const avail = page.h - headerPx - GUTTER;
  const beside = Math.min(1, avail / h, (page.w - ASIDE_MIN - GUTTER) / w);
  if (beside >= MIN_SCALE) return { scale: beside, ownPage: false };
  // A page of its own: as large as one page allows, and never smaller than
  // readable -- a graph that still does not fit runs on to the next page.
  const alone = Math.min(1, (page.h - 24) / h, page.w / w);
  return { scale: Math.max(alone, MIN_SCALE), ownPage: true };
}

/** The header's height on paper, estimated from what is in it. */
function headerHeight(intro: string, hasSubtitle: boolean): number {
  const lines = intro ? Math.ceil(intro.length / 95) : 0;
  return 24 + (hasSubtitle ? 20 : 20) + 40 + lines * 23 + (intro ? 10 : 0) + 42;
}

function sizeOf(svg: string): { w: number; h: number } {
  const m = /<svg [^>]*?width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/.exec(svg);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 400, h: 400 };
}

/** The first page's right-hand column: the contract, the pauses and the failure arms, as lists. */
function overview(g: Gathered): string {
  const port = (p: PortRow) => `<li><code>${esc(p.name)}${p.optional ? '?' : ''}</code> <span class="t">${esc(p.type)}</span>${p.description ? `<div class="d">${esc(p.description)}</div>` : ''}</li>`;
  const block = (title: string, body: string) => `<div class="blk"><h2>${title}</h2>${body}</div>`;
  const out: string[] = [
    block('What goes in', g.params.length ? `<ul class="ports">${g.params.map(port).join('')}</ul>` : '<p class="muted">Nothing; it runs as it is.</p>'),
    block('What comes out', g.returns.length ? `<ul class="ports">${g.returns.map(port).join('')}</ul>` : '<p class="muted">Only whether it succeeded.</p>'),
  ];
  if (g.gates.length) out.push(block('Where a person or an agent is needed', `<ul class="plain">${g.gates.map((s) => `<li><b>${esc(s.label)}</b><div class="d">${esc(WHO[s.gate ?? ''] ?? 'The run pauses')}</div></li>`).join('')}</ul>`));
  if (g.arms.length) out.push(block('When a step fails', `<ul class="plain">${g.arms.map((s) => `<li><b>${esc(s.label)}</b> <span class="t">→ ${s.failureTo.map((t) => esc(g.labels[t] ?? t)).join(', ')}</span></li>`).join('')}</ul>`));
  else out.push(block('When a step fails', '<p class="muted">The run stops; no step has a failure arm.</p>'));
  return out.join('');
}

/**
 * Paper: the first page is the overview -- title, description, the graph at
 * the size the console draws it, and beside it what goes in, what comes out,
 * who is waited for and what happens on failure. The pages after it are the
 * detail: every step with what it does, then the exchange at each pause.
 */
function renderPrint(ast: TWorkflowAST, g: Gathered, options: BriefOptions): string {
  const theme = options.theme ?? 'light';
  const dark = theme === 'dark';
  const svg = svgOf(ast, theme);
  const { w, h } = sizeOf(svg);
  const intro = lede(ast.description);
  const fit = fitGraph(w, h, headerHeight(intro, !!options.subtitle));
  const gw = Math.round(w * fit.scale);
  const gh = Math.round(h * fit.scale);
  const p = parts(g, false);
  const css = `:root { ${tokens(dark)} } ${BASE_CSS}
    main { max-width: ${PAGE.w}px; margin: 0 auto; padding: 36px 24px 60px; }
    h2 { font-size: 15px; }
    .one { display: grid; grid-template-columns: ${gw}px minmax(0, 1fr); column-gap: ${GUTTER}px; align-items: start; margin-top: 22px; }
    .one.wide { grid-template-columns: 1fr 1fr; } .one.wide aside { display: contents; }
    .graph { border: 0; padding: 0; background: none; overflow: visible; margin: 0; } .graph svg { display: block; width: ${gw}px; height: ${gh}px; max-width: none; margin: 0; border-radius: 10px; }
    .own { margin-top: 0; text-align: center; } .own svg { margin: 0 auto; }
    .blk { margin: 0 0 18px; } .blk h2 { font-size: 11.5px; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); font-weight: 600; margin: 0 0 6px; padding-bottom: 4px; }
    .blk ul { list-style: none; margin: 0; padding: 0; } .blk li { padding: 5px 0; border-bottom: 1px solid var(--line); font-size: 13px; } .blk li:last-child { border-bottom: 0; }
    .blk .t { color: var(--muted); font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 12px; margin-left: 6px; } .blk .d { color: var(--muted); font-size: 12px; margin-top: 1px; }
    .blk p.muted { margin: 0; }
    .detail { margin-top: 0; } .detail h2 { margin-top: 0; }
    thead { display: table-header-group; } tr { break-inside: avoid; } td { font-size: 13px; }
    @page { size: A4; margin: ${PAGE_MARGIN}; }
    @media print {
      main { max-width: none; padding: 0; }
      .one { break-after: page; } .own { break-before: page; break-after: page; break-inside: auto; }
      section { break-inside: auto; } section.gates { break-inside: avoid; } h2 { break-after: avoid; } .blk { break-inside: avoid; }
      footer { margin-top: 28px; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }`;
  const graph = svg ? `<div class="graph${fit.ownPage ? ' own' : ''}">${svg}</div>` : '';
  return `<!doctype html>
<html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(ast.functionName)} · Flow Weaver brief</title><style>${css}</style></head>
<body><main>
  ${head(ast, g, options.subtitle)}
  <div class="one${fit.ownPage ? ' wide' : ''}">${fit.ownPage ? '' : graph}<aside>${overview(g)}</aside></div>
  ${fit.ownPage ? graph : ''}
  <section class="detail"><h2>How it runs</h2>${p.steps}</section>
  ${p.gates ? `<section class="gates"><h2>Where a person or an agent is needed</h2>${p.gates}</section>` : ''}
  ${footer(ast, options.subtitle)}
</main></body></html>`;
}

// ---- interactive -------------------------------------------------------------

/**
 * The page is one screen: the graph, whole, scaled to fit whatever window it
 * is in and never shrinking for anything else; and a tray beside it with
 * tabs -- the clicked step, what goes in, what comes out, the step list, the
 * gates. Nothing on the screen scrolls except the tray when a tab has more
 * than fits.
 */
function renderInteractive(ast: TWorkflowAST, g: Gathered, options: BriefOptions): string {
  const theme = options.theme ?? 'light';
  const light = svgOf(ast, 'light');
  const dark = svgOf(ast, 'dark');
  const p = parts(g, true);
  const intro = lede(ast.description);
  const file = ast.sourceFile.split(/[\\/]/).pop() ?? '';
  const when = new Date().toISOString().slice(0, 10);
  const css = `
    :root { ${tokens(false)} } html[data-theme=dark] { ${tokens(true)} }
    ${BASE_CSS}
    html, body { height: 100%; overflow: hidden; }
    .page { height: 100%; display: grid; grid-template-rows: auto minmax(0, 1fr); }
    /* The title, the facts and the tools share one line; the description runs the full width under them, so the header is never taller than its text. */
    .top { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; grid-template-areas: "who facts tools" "lede lede lede"; align-items: center; column-gap: 14px; row-gap: 4px; padding: 14px 22px 12px; border-bottom: 1px solid var(--line); }
    .top .who { grid-area: who; min-width: 0; } .top h1 { font-size: 21px; margin: 0; } .top .sub { margin: 0 0 2px; font-size: 12px; } .top .lede { grid-area: lede; margin: 0; font-size: 13px; color: var(--muted); max-width: 110ch; }
    .top .facts { grid-area: facts; margin: 0; } .facts span { white-space: nowrap; }
    .tools { grid-area: tools; display: flex; gap: 6px; flex: none; } .tools button { font: inherit; font-size: 12.5px; color: var(--fg); background: var(--panel); border: 1px solid var(--line); border-radius: 7px; padding: 6px 11px; cursor: pointer; } .tools button:hover { background: var(--panel-2); }
    .stage { --tray: clamp(380px, 38vw, 620px); display: grid; grid-template-columns: minmax(0, 1fr) 6px var(--tray); min-height: 0; background: var(--graph); }
    .split { cursor: col-resize; position: relative; z-index: 2; margin: 0 -3px; } .split::after { content: ""; position: absolute; inset: 0 2px; border-radius: 2px; background: var(--accent); opacity: 0; transition: opacity .15s; } .split:hover::after, .split.on::after { opacity: .6; }
    body.resizing { cursor: col-resize; user-select: none; }
    .graph { border: 0; border-radius: 0; padding: 18px 22px; overflow: hidden; display: flex; align-items: center; justify-content: center; min-height: 0; background: var(--graph); }
    .graph svg { width: auto; height: auto; max-width: 100%; max-height: 100%; margin: 0; }
    .graph svg .row .hit { cursor: pointer; } .graph svg .row:hover .hit { fill: color-mix(in srgb, var(--accent) 8%, transparent); } .graph svg .row.sel .hit { fill: color-mix(in srgb, var(--accent) 14%, transparent); }
    .graph svg .edge { transition: opacity .15s, stroke-width .15s; } .graph svg.focus .edge { opacity: .22; } .graph svg.focus .edge.lit { opacity: 1; stroke-width: 3; }
    .graph svg.light { display: block; } .graph svg.dark { display: none; } html[data-theme=dark] .graph svg.light { display: none; } html[data-theme=dark] .graph svg.dark { display: block; }
    .tray { border-left: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; background: var(--panel); }
    .tabs { display: flex; flex-wrap: wrap; gap: 2px; padding: 8px 12px 0; border-bottom: 1px solid var(--line); flex: none; } .tabs button { font: inherit; font-size: 12px; color: var(--muted); background: none; border: 0; border-bottom: 2px solid transparent; padding: 7px 9px; margin-bottom: -1px; cursor: pointer; border-radius: 6px 6px 0 0; white-space: nowrap; } .tabs button:hover { color: var(--fg); } .tabs button.on { color: var(--fg); border-bottom-color: var(--accent); }
    .sheet { display: none; flex: 1; min-height: 0; overflow: auto; padding: 16px 18px 22px; font-size: 13.5px; } .sheet.on { display: block; }
    .sheet table { font-size: 12.5px; } .sheet th, .sheet td { padding: 6px 6px; } .sheet td.num { width: 24px; } .sheet .foot { margin-top: 18px; font-size: 11.5px; color: var(--faint); }
    .panel h3 { margin: 0 0 2px; font-size: 17px; } .panel .kind { color: var(--muted); font-size: 12px; margin-bottom: 10px; } .panel h4 { margin: 14px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; color: var(--muted); font-weight: 500; }
    .panel p { margin: 6px 0; } .panel ul { margin: 0; padding-left: 16px; } .panel li { margin: 2px 0; } .panel .hint { color: var(--muted); }
    .panel .legend { display: grid; gap: 6px; margin-top: 12px; font-size: 12.5px; color: var(--muted); } .panel .legend i { display: inline-block; width: 18px; height: 2px; vertical-align: middle; margin-right: 8px; border-radius: 1px; } .panel .legend i.fail { background: var(--err); } .panel .legend i.loop { background: var(--loop); } .panel .legend i.pull { background: repeating-linear-gradient(90deg, var(--pull) 0 3px, transparent 3px 7px); } .panel .legend i.gate { width: 10px; height: 10px; border: 1.5px solid var(--gate); border-radius: 2px; background: color-mix(in srgb, var(--gate) 14%, transparent); }
    .panel a.go { color: var(--accent); cursor: pointer; text-decoration: none; } .panel a.go:hover { text-decoration: underline; }
    tr.steprow { cursor: pointer; } tr.steprow:hover td { background: color-mix(in srgb, var(--accent) 6%, transparent); } tr.steprow.sel td { background: color-mix(in srgb, var(--accent) 12%, transparent); }
    @media (max-width: 720px) { html, body { overflow: auto; } .page { height: auto; grid-template-rows: auto auto; } .stage { grid-template-columns: 1fr !important; } .split { display: none; } .graph { padding: 14px; } .tray { border-left: 0; border-top: 1px solid var(--line); } .sheet { max-height: 60vh; } .top { grid-template-columns: 1fr auto; grid-template-areas: "who tools" "facts facts" "lede lede"; } }
    @page { size: A4; margin: 14mm; }
    @media print { html, body { height: auto; overflow: visible; } .page { display: block; } .tools, .tabs, .split, #sheet-step { display: none; } .stage { display: block; } .graph { padding: 0; background: none; break-inside: avoid; } .graph svg { max-height: none; width: 100%; } .tray { border: 0; background: none; display: block; } .sheet { display: block; overflow: visible; padding: 0; } .sheet::before { content: attr(data-title); display: block; font-size: 16px; font-weight: 600; margin: 26px 0 8px; padding-bottom: 6px; border-bottom: 1px solid var(--line); } section { break-inside: avoid; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`;
  const model = { steps: g.steps, labels: g.labels, params: g.params, returns: g.returns, who: WHO };
  const tabs = [
    ['step', 'Step', ''],
    ['inputs', `In · ${g.params.length}`, p.inputs],
    ['outputs', `Out · ${g.returns.length}`, p.outputs],
    ['steps', `Steps · ${g.steps.length}`, p.steps],
    ...(p.gates ? [['gates', `People & agents · ${g.gates.length}`, p.gates]] : []),
  ] as Array<[string, string, string]>;
  const titles: Record<string, string> = { step: '', inputs: 'What goes in', outputs: 'What comes out', steps: 'How it runs', gates: 'Where a person or an agent is needed' };
  return `<!doctype html>
<html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(ast.functionName)} · Flow Weaver brief</title><style>${css}</style></head>
<body><div class="page">
  <header class="top">
    <div class="who">
      <p class="sub">${options.subtitle ? `${esc(options.subtitle)} · ` : ''}<span class="mono">${esc(file)}</span></p>
      <h1>${esc(ast.functionName)}</h1>
    </div>
    <div class="facts">
      <span><b>${g.steps.length}</b>${g.steps.length === 1 ? 'step' : 'steps'}</span>
      <span><b>${g.gates.length}</b>${g.gates.length === 1 ? 'pause' : 'pauses'}</span>
      <span><b>${g.arms.length}</b>failure ${g.arms.length === 1 ? 'arm' : 'arms'}</span>
    </div>
    <div class="tools"><button type="button" id="theme" title="Light or dark">◐ Theme</button><button type="button" id="print" title="Print, or save as PDF from the print dialog">⎙ Print / PDF</button></div>
    ${intro ? `<p class="lede">${esc(intro)}</p>` : ''}
  </header>
  <div class="stage">
    <div class="graph" id="graph">${light.replace('<svg ', '<svg class="light" ')}${dark.replace('<svg ', '<svg class="dark" ')}</div>
    <div class="split" id="split" title="Drag to resize; double-click to reset"></div>
    <aside class="tray">
      <div class="tabs">${tabs.map(([id, label]) => `<button type="button" data-tab="${id}"${id === 'step' ? ' class="on"' : ''}>${esc(label)}</button>`).join('')}</div>
      ${tabs.map(([id, , html]) => id === 'step'
        ? '<div class="sheet panel on" id="sheet-step"><div id="panel"></div></div>'
        : `<div class="sheet" id="sheet-${id}" data-title="${esc(titles[id])}">${html}<div class="foot">Flow Weaver · ${when}</div></div>`).join('')}
    </aside>
  </div>
</div>
<script>
const M = ${JSON.stringify(model).replace(/</g, '\\u003c')};
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const name = (id) => esc(M.labels[id] ?? id);
const link = (id) => '<a class="go" data-go="' + esc(id) + '">' + name(id) + '</a>';
const KIND = { pause: 'waits for a person or an agent', loop: 'repeats over each item', effect: 'an effect that runs once, even if the run is resumed', step: 'a step' };
let selected = null, tab = 'step';
function intro() {
  return '<h3>The shape</h3><p class="kind">' + M.steps.length + ' steps in run order</p><p class="hint">Click a step to read what it does, what it reads and where its data goes. The other tabs hold the contract, the full list and the gates.</p>'
    + '<div class="legend"><div><i class="fail"></i>on failure</div><div><i class="loop"></i>repeats</div><div><i class="pull"></i>read on demand</div><div><i class="gate"></i>waits for a person or an agent</div></div>';
}
function details(id) {
  if (id === 'Start') return '<h3>Start</h3><p class="kind">what the workflow is given</p>' + portList(M.params, 'It takes no parameters.');
  if (id === 'Exit') return '<h3>Exit</h3><p class="kind">what the workflow returns</p>' + portList(M.returns, 'It returns only whether it succeeded.');
  const s = M.steps.find((x) => x.id === id); if (!s) return intro();
  let h = '<h3>' + esc(s.label) + '</h3><p class="kind">' + esc(s.type) + ' · ' + (s.kind === 'pause' ? esc(s.gate) + ' gate — ' + esc(M.who[s.gate] ?? 'the run pauses') : KIND[s.kind]) + (s.pull ? ' · runs when something reads it' : '') + '</p>';
  if (s.owner) { const o = M.steps.find((x) => x.id === s.owner); if (o) h += '<p class="kind">runs once per ' + esc(o.scope ?? 'item') + ', inside ' + link(o.id) + '</p>'; }
  if (s.description) h += '<p>' + esc(s.description) + '</p>';
  const from = s.entered.map((e) => link(e.from) + (e.arm === 'fail' ? ' <span class="hint">(when it fails)</span>' : ''));
  if (from.length) h += '<h4>Runs after</h4><p>' + from.join(', ') + '</p>';
  const reads = s.reads.map((r) => '<li><code>' + esc(r.port) + '</code> ← ' + link(r.from) + '<span class="hint">.' + esc(r.fromPort) + '</span></li>').concat(s.exprs.map((e) => '<li><code>' + esc(e.port) + '</code> = <span class="mono">' + esc(e.expr) + '</span></li>'));
  if (reads.length) h += '<h4>Reads</h4><ul>' + reads.join('') + '</ul>';
  const gives = s.produces.filter((p) => p.to.length).map((p) => '<li><code>' + esc(p.port) + '</code> → ' + p.to.map(link).join(', ') + '</li>');
  if (gives.length) h += '<h4>Hands on</h4><ul>' + gives.join('') + '</ul>';
  if (s.kind === 'pause') h += '<h4>The exchange</h4><p>' + (s.gateInputs.length ? 'Sees <code>' + s.gateInputs.map(esc).join('</code>, <code>') + '</code>. ' : '') + (s.gateOutputs.length ? 'Answers with <code>' + s.gateOutputs.map(esc).join('</code>, <code>') + '</code>.' : 'Answers yes or no.') + '</p>';
  if (s.successTo.length || s.failureTo.length) h += '<h4>Then</h4><p>' + (s.successTo.length ? 'on success → ' + s.successTo.map(link).join(', ') : '') + (s.successTo.length && s.failureTo.length ? '<br>' : '') + (s.failureTo.length ? 'on failure → ' + s.failureTo.map(link).join(', ') : '') + '</p>';
  return h;
}
function portList(rows, empty) { return rows.length ? '<ul>' + rows.map((p) => '<li><code>' + esc(p.name) + (p.optional ? '?' : '') + '</code> <span class="hint">' + esc(p.type) + '</span>' + (p.description ? ' — ' + esc(p.description) : '') + '</li>').join('') + '</ul>' : '<p class="hint">' + empty + '</p>'; }
function select(id) {
  selected = selected === id ? null : id;
  $$('.row').forEach((r) => r.classList.toggle('sel', r.dataset.id === selected));
  $$('tr.steprow').forEach((r) => r.classList.toggle('sel', r.dataset.id === selected));
  $$('.graph svg').forEach((svg) => { svg.classList.toggle('focus', !!selected); $$('.edge', svg).forEach((e) => e.classList.toggle('lit', !!selected && (e.dataset.from === selected || e.dataset.to === selected))); });
  $('#panel').innerHTML = selected ? details(selected) : intro();
  if (selected) show('step');
}
function show(id) {
  tab = id;
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $$('.sheet').forEach((s) => s.classList.toggle('on', s.id === 'sheet-' + tab));
}
$('#panel').innerHTML = intro();
$$('.row').forEach((r) => r.addEventListener('click', () => select(r.dataset.id)));
$$('tr.steprow').forEach((r) => r.addEventListener('click', () => select(r.dataset.id)));
$$('.tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
$('#panel').addEventListener('click', (e) => { const a = e.target.closest('a.go'); if (a) { selected = null; select(a.dataset.go); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && selected) select(selected); });
$('#theme').addEventListener('click', () => { const h = document.documentElement; h.dataset.theme = h.dataset.theme === 'dark' ? 'light' : 'dark'; });
// The tray can be dragged wider or narrower; the width is remembered in this browser.
(() => {
  const stage = $('.stage'), split = $('#split'), KEY = 'fw-brief-tray';
  const apply = (w) => { stage.style.setProperty('--tray', w + 'px'); };
  try { const saved = Number(localStorage.getItem(KEY)); if (saved >= 320) apply(saved); } catch {}
  split.addEventListener('pointerdown', (e) => {
    e.preventDefault(); split.setPointerCapture(e.pointerId); split.classList.add('on'); document.body.classList.add('resizing');
    const move = (ev) => { const w = Math.min(Math.max(320, stage.getBoundingClientRect().right - ev.clientX), innerWidth * 0.6); apply(Math.round(w)); };
    const up = () => { split.classList.remove('on'); document.body.classList.remove('resizing'); split.removeEventListener('pointermove', move); split.removeEventListener('pointerup', up); try { localStorage.setItem(KEY, String(parseInt(stage.style.getPropertyValue('--tray')) || '')); } catch {} };
    split.addEventListener('pointermove', move); split.addEventListener('pointerup', up);
  });
  split.addEventListener('dblclick', () => { stage.style.removeProperty('--tray'); try { localStorage.removeItem(KEY); } catch {} });
})();
$('#print').addEventListener('click', () => window.print());
</script></body></html>`;
}
