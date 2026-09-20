/**
 * The workflow as the console draws it, as one SVG.
 *
 * A spine: steps in run order down the page, one tile each, with the
 * control flow as lanes beside them in the manner of a git graph. Failure
 * arms branch out and merge back, a loop body is indented under its owner,
 * a step read on demand hangs off a dashed line. It is the same lane
 * layout and the same tiles the console shows live, drawn once and made
 * still: what goes on a slide or in a document is what the operator sees.
 *
 * Self-contained: the fonts are the reader's system fonts, the icons are
 * paths, the colours are literal. Nothing is fetched.
 */
import type { TWorkflowAST, TNodeTypeAST } from '../ast/types';
import { buildProcessModel, type ProcessStep } from './process-view';
import { buildLanes, edgePath, type EdgeKind, type LaneGraph } from './lanes';
import { NODE_ICON_PATHS } from './theme';

export interface SpineOptions {
  theme?: 'dark' | 'light';
  /** The workflow's name and a line of facts above the spine. On by default, off when the page around it already says so. */
  title?: boolean;
  /** Shown under the title in place of the file name. */
  subtitle?: string;
}

// ---- The console's tokens, as literals ------------------------------------

interface Palette {
  bg: string; panel: string; line2: string; fg: string; dim: string;
  ok: string; err: string; gate: string; loop: string; pull: string; effect: string;
  colors: Record<string, string>;
}

const DARK: Palette = {
  bg: '#0e1014', panel: '#14171d', line2: '#313847', fg: '#e7e9ee', dim: '#8a90a0',
  ok: '#3ecf8e', err: '#f0636a', gate: '#c79bff', loop: '#5fd4d9', pull: '#f2c94c', effect: '#ff9f5a',
  colors: { blue: '#6ea8fe', purple: '#b48cff', cyan: '#4fd1e0', orange: '#ff9f5a', pink: '#ff7ab6', green: '#3ecf8e', red: '#f0636a', yellow: '#f2c94c', teal: '#2fc7b0' },
};

const LIGHT: Palette = {
  bg: '#f6f7f9', panel: '#ffffff', line2: '#cfd4dc', fg: '#1a1d24', dim: '#667085',
  ok: '#3ecf8e', err: '#f0636a', gate: '#c79bff', loop: '#5fd4d9', pull: '#f2c94c', effect: '#ea7a1d',
  colors: { blue: '#2f6fed', purple: '#7c4dff', cyan: '#0891b2', orange: '#ea7a1d', pink: '#db2777', green: '#15a06a', red: '#dc2626', yellow: '#b7860b', teal: '#0d9488' },
};

/** `color-mix(in srgb, a p%, b)` for two hex colours. */
export function mix(a: string, b: string, p: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) => Math.round(ch(a, i) * p + ch(b, i) * (1 - p)));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** The console's glyph for a step that has no icon of its own. */
const KIND_ICON: Record<string, string> = {
  // The console shows `how_to_reg` and `keyboard` here; the path set has
  // neither, so the nearest glyphs it does have stand in.
  approval: 'person',
  input: 'edit',
  agent: 'smartToy',
  loop: 'repeat',
  effect: 'bolt',
  pull: 'download',
};

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** Width of text, near enough: the average glyph of a UI sans at this size. */
const width = (text: string, size: number, mono = false): number => text.length * size * (mono ? 0.6 : 0.55);

const snakeToCamel = (s: string): string => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** Facts about a step that the process model does not carry: the instance's look and classification. */
interface Look { color: string | null; icon: string | null; gate: string | null; effect: boolean; expression: boolean; pull: boolean; builtin: boolean }

const TILE = 22;
const ROW = 40;
const PAD = 16;

export function renderSpineSVG(ast: TWorkflowAST, options: SpineOptions = {}): string {
  const p = options.theme === 'dark' ? DARK : LIGHT;
  const model = buildProcessModel(ast);
  const types = new Map<string, TNodeTypeAST>();
  for (const nt of ast.nodeTypes) { types.set(nt.name, nt); types.set(nt.functionName, nt); }
  const looks = new Map<string, Look>();
  for (const inst of ast.instances) {
    const nt = types.get(inst.nodeType);
    looks.set(inst.id, {
      color: inst.config?.color ?? nt?.visuals?.color ?? null,
      icon: inst.config?.icon ?? nt?.visuals?.icon ?? null,
      gate: nt?.durableGate ?? null,
      effect: !!nt?.durableEffect,
      expression: !!nt?.expression,
      pull: inst.config?.pullExecution !== undefined,
      builtin: !nt?.functionText,
    });
  }
  type S = ProcessStep & { pull: boolean };
  const withPull = (steps: ProcessStep[]): S[] => steps.map((s) => ({ ...s, pull: !!looks.get(s.id)?.pull, children: withPull(s.children) }));
  const graph: LaneGraph<S> = buildLanes({ steps: withPull(model.steps), startTo: model.startTo, exitFrom: model.exitFrom });

  // ---- rows: what each says, and how wide that is
  const params = Object.keys(ast.startPorts ?? {}).filter((k) => !['execute', 'onSuccess', 'onFailure'].includes(k));
  const returns = Object.keys(ast.exitPorts ?? {}).filter((k) => !['execute', 'onSuccess', 'onFailure'].includes(k));
  interface Line { label: string; labelDim?: boolean; id?: string; tags: Array<{ text: string; color: string }>; right?: { text: string; color: string } }
  const lines: Line[] = graph.rows.map((row) => {
    if (row.id === 'Start') return { label: 'Start', labelDim: true, id: params.join(', '), tags: [] };
    if (row.id === 'Exit') return { label: 'Exit', labelDim: true, id: returns.join(', '), tags: [] };
    const s = row.step!;
    const look = looks.get(s.id);
    const tags: Line['tags'] = [];
    const onDemand = !s.pull && !s.entered.length && !s.successTo.length && !s.failureTo.length && (s.reads.length > 0 || s.produces.length > 0);
    if (s.pull) tags.push({ text: 'pulled', color: p.pull });
    else if (onDemand) tags.push({ text: 'on demand', color: p.pull });
    if (s.kind === 'loop') tags.push({ text: s.scope ? `each ${s.scope}` : 'each', color: p.loop });
    const id = look?.builtin || s.label.toLowerCase() === s.id.toLowerCase() ? s.type : s.id;
    const right = s.kind === 'pause' ? { text: s.gate ?? 'gate', color: p.gate } : undefined;
    return { label: s.label, id, tags, right };
  });
  const lineWidth = (l: Line) => width(l.label, 13) + (l.id ? 8 + width(l.id, 11.5, true) : 0) + l.tags.reduce((w, t) => w + 8 + width(t.text, 11) + 14, 0) + (l.right ? 24 + width(l.right.text, 11.5) : 0);
  const textLeft = PAD + graph.gutter;
  const W = Math.max(360, Math.ceil(textLeft + Math.max(...lines.map(lineWidth)) + PAD));

  // ---- vertical layout: title, rows, legend
  const title = options.title !== false;
  const gates = graph.rows.filter((r) => r.step?.kind === 'pause').length;
  const top = title ? 56 : 12;
  const rowTop = (i: number) => top + i * ROW;
  const y = (id: string) => rowTop(graph.index[id]) + 20;
  const x = (lane: number) => PAD + (graph.laneX[lane] ?? 0);
  const kinds = new Set<EdgeKind>(graph.edges.map((e) => e.kind));
  const legend: Array<{ kind: EdgeKind | 'pause'; text: string }> = [];
  if (kinds.has('fail')) legend.push({ kind: 'fail', text: 'on failure' });
  if (kinds.has('loop') || kinds.has('return')) legend.push({ kind: 'loop', text: 'repeats' });
  if (kinds.has('pull')) legend.push({ kind: 'pull', text: 'read on demand' });
  if (gates) legend.push({ kind: 'pause', text: 'waits for a person or an agent' });
  const H = rowTop(graph.rows.length) + (legend.length ? 30 : 6);

  const stroke: Record<EdgeKind, string> = {
    ok: p.line2,
    fail: mix(p.err, p.line2, 0.45),
    loop: mix(p.loop, p.line2, 0.55),
    return: mix(p.loop, p.line2, 0.55),
    pull: mix(p.pull, p.line2, 0.55),
  };

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t" font-family='${SANS}'>`);
  out.push(`<title id="t">${esc(ast.functionName)}: ${graph.rows.length - 2} steps${gates ? `, ${gates} pause${gates === 1 ? '' : 's'}` : ''}</title>`);
  out.push(`<rect width="${W}" height="${H}" fill="${p.bg}"/>`);

  if (title) {
    const facts = [options.subtitle ?? ast.sourceFile.split(/[\\/]/).pop() ?? '', `${graph.rows.length - 2} step${graph.rows.length - 2 === 1 ? '' : 's'}`, gates ? `${gates} pause${gates === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ');
    out.push(`<text x="${PAD}" y="24" font-size="15" font-weight="600" fill="${p.fg}">${esc(ast.functionName)}</text>`);
    out.push(`<text x="${PAD}" y="42" font-size="11.5" fill="${p.dim}">${esc(facts)}</text>`);
  }

  // A band behind each scope body, named at its corner: the rows inside it
  // run once per item, the owner above it runs once. Nested bodies sit in
  // deeper bands. Drawn first, so everything else is on top of it.
  for (const sc of graph.scopes) {
    const bx = x(sc.lane) - TILE / 2 - 8;
    const by = rowTop(sc.first) + 3;
    const bh = rowTop(sc.last) + ROW - 3 - by;
    out.push(`<g class="scope" data-owner="${esc(sc.owner)}"><rect x="${bx}" y="${by}" width="${W - PAD - bx}" height="${bh}" rx="8" fill="${p.loop}" fill-opacity="${(0.07 + sc.depth * 0.03).toFixed(2)}" stroke="${p.loop}" stroke-opacity=".28"/>`);
    // The name sits in the band's top edge, like a fieldset legend, clear of whatever the first row says at its right.
    const name = `${sc.owner}${sc.scope ? ` ${sc.scope}` : ''}`;
    const nw = width(name, 10.5) + 10;
    out.push(`<rect x="${W - PAD - 10 - nw}" y="${by - 7}" width="${nw}" height="14" rx="4" fill="${p.bg}"/>`);
    out.push(`<text x="${W - PAD - 15}" y="${by + 3.5}" font-size="10.5" text-anchor="end" fill="${p.loop}">${esc(name)}</text></g>`);
  }

  // Lanes next, so the tiles sit on the lines. Every edge and row carries
  // its ids as data attributes: the brief lights them up on click, and a
  // stylesheet in the host page can address `.edge` and `.row`.
  out.push('<g class="edges" fill="none" stroke-width="2" stroke-linecap="round">');
  for (const e of graph.edges) {
    out.push(`<path d="${edgePath(e, y, x)}" stroke="${stroke[e.kind]}"${e.kind === 'pull' ? ' stroke-dasharray="3 4"' : ''} class="edge ${e.kind}" data-from="${esc(e.from)}" data-to="${esc(e.to)}"/>`);
  }
  out.push('</g>');

  graph.rows.forEach((row, i) => {
    const l = lines[i];
    const cx = x(row.lane), cy = rowTop(i) + 20;
    out.push(`<g class="row${row.step ? '' : ' term'}" data-id="${esc(row.id)}"><rect class="hit" x="0" y="${rowTop(i)}" width="${W}" height="${ROW}" fill="transparent"/>`);
    if (row.id === 'Start' || row.id === 'Exit') {
      out.push(`<circle cx="${cx}" cy="${cy}" r="6" fill="${p.line2}"/>`);
    } else {
      const s = row.step!;
      const look = looks.get(s.id);
      const kind = s.kind === 'loop' ? 'loop' : look?.effect ? 'effect' : look?.gate ?? (s.pull ? 'pull' : null);
      const iconName = look?.icon ?? (kind ? KIND_ICON[kind] : null);
      const path = iconName ? NODE_ICON_PATHS[iconName] ?? NODE_ICON_PATHS[snakeToCamel(iconName)] : undefined;
      const fallback = kind === 'loop' ? p.loop : look?.gate ? p.gate : look?.effect ? p.effect : s.pull ? p.pull : p.dim;
      const tc = (look?.color && p.colors[look.color]) || fallback;
      // An expression node computes a value and cannot route a failure, so its
      // tile is drawn softer than a normal-mode step that can branch.
      const rx = look?.gate ? 2 : kind === 'loop' ? 3 : 6;
      const rot = kind === 'loop' ? ` transform="rotate(45 ${cx} ${cy})"` : '';
      const dash = look?.expression ? ' stroke-dasharray="3 2"' : '';
      out.push(`<rect x="${cx - TILE / 2}" y="${cy - TILE / 2}" width="${TILE}" height="${TILE}" rx="${rx}" fill="${mix(tc, p.panel, 0.14)}" stroke="${mix(tc, p.line2, 0.45)}" stroke-width="1.5"${dash}${rot}/>`);
      if (path) out.push(`<path d="${path}" fill="${tc}" transform="translate(${cx - 7} ${cy + 7}) scale(${14 / 960})"/>`);
      else out.push(`<circle cx="${cx}" cy="${cy}" r="3" fill="${mix(tc, p.dim, 0.7)}"/>`);
    }
    // The line of text beside the tile: label, id or type, tags, and for a gate its kind at the right.
    let tx = textLeft;
    const ty = cy + 4.5;
    out.push(`<text x="${tx}" y="${ty}" font-size="13" font-weight="${l.labelDim ? 400 : 500}" fill="${l.labelDim ? p.dim : p.fg}">${esc(l.label)}</text>`);
    tx += width(l.label, 13);
    if (l.id) {
      tx += 8;
      out.push(`<text x="${tx}" y="${ty}" font-size="11.5" font-family='${MONO}' fill="${p.dim}">${esc(l.id)}</text>`);
      tx += width(l.id, 11.5, true);
    }
    for (const t of l.tags) {
      tx += 8;
      const w = width(t.text, 11) + 14;
      out.push(`<rect x="${tx}" y="${cy - 9}" width="${w}" height="18" rx="9" fill="none" stroke="${mix(t.color, p.line2, 0.5)}"/>`);
      out.push(`<text x="${tx + w / 2}" y="${cy + 3.5}" font-size="11" text-anchor="middle" fill="${t.color}">${esc(t.text)}</text>`);
      tx += w;
    }
    if (l.right) out.push(`<text x="${W - PAD}" y="${ty}" font-size="11.5" text-anchor="end" fill="${l.right.color}">${esc(l.right.text)}</text>`);
    out.push('</g>');
  });

  if (legend.length) {
    let lx = PAD;
    const ly = H - 12;
    for (const item of legend) {
      if (item.kind === 'pause') {
        out.push(`<rect x="${lx}" y="${ly - 6}" width="12" height="12" rx="2" fill="${mix(p.gate, p.panel, 0.14)}" stroke="${mix(p.gate, p.line2, 0.45)}" stroke-width="1.5"/>`);
      } else {
        out.push(`<line x1="${lx}" y1="${ly}" x2="${lx + 18}" y2="${ly}" stroke="${stroke[item.kind]}" stroke-width="2" stroke-linecap="round"${item.kind === 'pull' ? ' stroke-dasharray="3 4"' : ''}/>`);
      }
      lx += 24;
      out.push(`<text x="${lx}" y="${ly + 3.5}" font-size="11" fill="${p.dim}">${esc(item.text)}</text>`);
      lx += width(item.text, 11) + 18;
    }
  }

  out.push('</svg>');
  return out.join('\n');
}
