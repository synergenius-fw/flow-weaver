/**
 * HTML Viewer — wraps an SVG diagram in a self-contained interactive HTML page.
 *
 * The SVG element itself is the canvas: zoom and pan are driven by viewBox
 * manipulation, so nodes can be dragged anywhere without hitting a boundary.
 * No external dependencies — works standalone or inside an iframe.
 */

export interface HtmlViewerOptions {
  title?: string;
  theme?: 'dark' | 'light';
  nodeSources?: Record<string, { description?: string; source?: string; ports?: Record<string, { type: string; tsType?: string }> }>;
}

/**
 * Extract inner SVG content and viewBox from the rendered SVG string.
 * Strips backgrounds, dot grid, and watermark (the viewer provides its own).
 */
function prepareSvgContent(svg: string): { inner: string; viewBox: string } {
  const vbMatch = svg.match(/viewBox="([^"]+)"/);
  const viewBox = vbMatch ? vbMatch[1] : '0 0 800 600';

  // Strip the outer <svg> wrapper — we inline content into the canvas SVG
  let inner = svg.replace(/<svg[^>]*>\n?/, '').replace(/<\/svg>\s*$/, '');

  // Remove dot-grid pattern and its fill rect (viewer uses its own)
  inner = inner.replace(/<pattern\s+id="dot-grid"[^>]*>[\s\S]*?<\/pattern>/g, '');
  inner = inner.replace(/<rect[^>]*fill="url\(#dot-grid\)"[^>]*\/>/g, '');
  // Remove solid background rect (first rect after </defs>)
  inner = inner.replace(/(<\/defs>\n)<rect[^>]*\/>\n/, '$1');
  // Remove watermark (HTML viewer has its own branding badge)
  inner = inner.replace(/<g opacity="0\.5">[\s\S]*?Flow Weaver<\/text>\s*<\/g>/, '');

  return { inner, viewBox };
}

export function wrapSVGInHTML(svgContent: string, options: HtmlViewerOptions = {}): string {
  const title = options.title ?? 'Workflow Diagram';
  const theme = options.theme ?? 'dark';
  const { inner, viewBox } = prepareSvgContent(svgContent);

  const isDark = theme === 'dark';
  const bg = isDark ? '#202139' : '#f6f7ff';
  const dotColor = isDark ? 'rgba(142, 158, 255, 0.5)' : 'rgba(84, 104, 255, 0.45)';
  const surfaceMain = isDark ? '#1a1a2e' : '#ffffff';
  const borderSubtle = isDark ? '#313143' : '#e6e6e6';
  const textHigh = isDark ? '#e8e8ee' : '#1a1a2e';
  const textMed = isDark ? '#babac0' : '#606060';
  const textLow = isDark ? '#767682' : '#999999';
  const surfaceHigh = isDark ? '#313143' : '#f0f0f5';
  const brandAccent = isDark ? '#8e9eff' : '#5468ff';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Flow Weaver</title>
<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

body {
  width: 100vw; height: 100vh; overflow: hidden;
  font-family: Montserrat, 'Segoe UI', Roboto, sans-serif;
  color: ${textHigh};
}

#canvas {
  display: block; width: 100%; height: 100%;
  cursor: grab;
  touch-action: none; user-select: none;
}
#canvas.dragging { cursor: grabbing; }

/* Port labels: hidden by default, shown on node hover */
.nodes > g .port-label,
.nodes > g .port-type-label,
.labels g[data-port-label] {
  opacity: 0; pointer-events: none;
  transition: opacity 0.15s ease-in-out;
}

/* Connection hover & dimming (attribute selector covers both main and scope connections) */
path[data-source] { transition: opacity 0.2s ease, stroke-width 0.15s ease; }
path[data-source]:hover { stroke-width: 4; cursor: pointer; }
body.node-active path[data-source].dimmed,
body.port-active path[data-source].dimmed { opacity: 0.1; }
body.port-hovered path[data-source].dimmed { opacity: 0.25; }

/* Port circles are interactive */
circle[data-port-id] { cursor: pointer; }
circle[data-port-id]:hover { stroke-width: 3; filter: brightness(1.3); }

/* Port-click highlighting */
path[data-source].highlighted { opacity: 1; }
circle[data-port-id].port-selected { filter: drop-shadow(0 0 6px currentColor); stroke-width: 4; }

/* Node selection glow */
@keyframes select-pop {
  0% { opacity: 0; stroke-width: 0; }
  50% { opacity: 0.6; stroke-width: 12; }
  100% { opacity: 0.35; stroke-width: 8; }
}
.node-glow { fill: none; pointer-events: none; animation: select-pop 0.3s ease-out forwards; }

/* Port hover path highlight */
path[data-source].port-hover { opacity: 1; }

/* Node hover glow + draggable cursor */
.nodes g[data-node-id] { cursor: grab; }
.nodes g[data-node-id]:active { cursor: grabbing; }
.nodes g[data-node-id]:hover > rect:first-of-type {
  filter: brightness(1.08) drop-shadow(0 0 6px ${isDark ? 'rgba(142,158,255,0.15)' : 'rgba(84,104,255,0.12)'});
  transition: filter 0.15s ease;
}

/* Zoom controls */
#controls {
  position: fixed; bottom: 16px; right: 16px;
  display: flex; align-items: center; gap: 2px;
  background: ${isDark ? 'rgba(26,26,46,0.85)' : 'rgba(255,255,255,0.85)'};
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  border: 1px solid ${isDark ? 'rgba(142,158,255,0.12)' : 'rgba(84,104,255,0.1)'};
  border-radius: 8px; padding: 4px; z-index: 10;
}
.ctrl-btn {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border: none; border-radius: 6px;
  background: transparent; color: ${textMed};
  font-size: 16px; font-weight: 600; cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.ctrl-btn:hover { background: ${isDark ? 'rgba(142,158,255,0.08)' : 'rgba(84,104,255,0.06)'}; color: ${textHigh}; }
#zoom-label {
  font-size: 11px; font-family: 'SF Mono', 'Fira Code', monospace;
  color: ${textLow}; min-width: 36px; text-align: center;
}

/* Info panel */
@keyframes panelSlideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
#info-panel {
  position: fixed; bottom: 52px; left: 16px;
  max-width: 480px; min-width: 260px;
  background: ${isDark ? 'rgba(26,26,46,0.85)' : 'rgba(255,255,255,0.85)'};
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  border: 1px solid ${isDark ? 'rgba(142,158,255,0.12)' : 'rgba(84,104,255,0.1)'};
  border-radius: 8px; padding: 0;
  font-size: 13px; line-height: 1.5;
  z-index: 10; display: none;
  max-height: calc(100vh - 120px); overflow: hidden;
}
#info-panel.visible { display: block; animation: panelSlideIn 0.2s ease-out; }
#info-panel h3 {
  font-size: 14px; font-weight: 700; margin: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#info-panel .node-desc { color: ${textMed}; font-size: 12px; margin-bottom: 8px; font-style: italic; }
#info-panel .info-section { margin-bottom: 6px; }
#info-panel .info-label { font-size: 11px; font-weight: 600; color: ${textLow}; text-transform: uppercase; letter-spacing: 0.5px; }
#info-panel .info-value { color: ${textMed}; }
#info-panel .port-list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 2px; }
#info-panel .port-list li { padding: 2px 0; display: flex; align-items: center; gap: 6px; }
#info-panel .port-list li::before { content: '\\2022'; color: ${textLow}; flex-shrink: 0; }
#info-panel .port-type { color: ${textLow}; font-size: 11px; font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace; }
#info-panel pre {
  background: ${isDark ? '#161625' : '#f0f1fa'}; border: 1px solid ${borderSubtle};
  border-radius: 6px; padding: 10px; overflow-x: auto;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 12px; line-height: 1.6; white-space: pre;
  max-height: 300px; overflow-y: auto; margin: 6px 0 0;
  color: ${isDark ? '#e6edf3' : '#1a2340'};
}

/* Custom scrollbars */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: ${isDark ? 'rgba(142,158,255,0.25)' : 'rgba(84,104,255,0.2)'}; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: ${isDark ? 'rgba(142,158,255,0.45)' : 'rgba(84,104,255,0.4)'}; }
::-webkit-scrollbar-corner { background: transparent; }
* { scrollbar-width: thin; scrollbar-color: ${isDark ? 'rgba(142,158,255,0.25)' : 'rgba(84,104,255,0.2)'} transparent; }

/* Info panel header */
#info-header {
  display: flex; align-items: center; gap: 6px; padding: 12px 16px;
  border-bottom: 1px solid ${isDark ? 'rgba(142,158,255,0.08)' : 'rgba(84,104,255,0.06)'};
}
#info-header h3 { flex: 1; margin-bottom: 0; }
#info-body { padding: 12px 16px; overflow-y: auto; max-height: calc(100vh - 180px); }
.panel-btn {
  display: flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border: none; border-radius: 4px;
  background: transparent; color: ${textLow};
  cursor: pointer; transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
}
.panel-btn:hover { background: ${surfaceHigh}; color: ${textHigh}; }

/* Info panel fullscreen transitions */
#info-panel.fullscreen {
  left: 16px; bottom: 16px; top: 16px; right: 16px;
  max-width: none; min-width: 0; width: auto; max-height: none;
  border-radius: 12px;
}
#info-panel.fullscreen pre { max-height: none; }
.hl-kw { color: ${isDark ? '#8e9eff' : '#4040bf'}; }
.hl-str { color: ${isDark ? '#ff7b72' : '#c4432b'}; }
.hl-num { color: ${isDark ? '#f0a050' : '#b35e14'}; }
.hl-cm { color: #6a737d; font-style: italic; }
.hl-fn { color: ${isDark ? '#d2a8ff' : '#7c3aed'}; }
.hl-ty { color: ${isDark ? '#d2a8ff' : '#7c3aed'}; }
.hl-pn { color: ${isDark ? '#b8bdd0' : '#4a5578'}; }
.hl-ann { color: ${isDark ? '#8e9eff' : '#4040bf'}; font-weight: 600; font-style: normal; }
.hl-arr { color: ${isDark ? '#79c0ff' : '#0969da'}; font-weight: 600; font-style: normal; }
.hl-id { color: ${isDark ? '#e6edf3' : '#1a2340'}; font-style: normal; }
.hl-sc { color: ${isDark ? '#d2a8ff' : '#7c3aed'}; font-style: italic; }

/* Branding badge */
#branding {
  position: fixed; bottom: 16px; left: 16px;
  display: flex; align-items: center; gap: 6px;
  background: ${isDark ? 'rgba(26,26,46,0.85)' : 'rgba(255,255,255,0.85)'};
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  border: 1px solid ${isDark ? 'rgba(142,158,255,0.12)' : 'rgba(84,104,255,0.1)'};
  border-radius: 8px; padding: 6px 12px;
  font-size: 12px; font-weight: 600; color: ${textMed};
  text-decoration: none; z-index: 9;
  transition: color 0.15s, border-color 0.15s;
}
#branding:hover { color: ${textHigh}; border-color: ${textLow}; }

/* Scroll hint */
@keyframes hintFade { 0% { opacity: 1; } 80% { opacity: 1; } 100% { opacity: 0; } }
#scroll-hint {
  position: fixed; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  background: ${isDark ? 'rgba(26,26,46,0.92)' : 'rgba(255,255,255,0.92)'};
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  border: 1px solid ${isDark ? 'rgba(142,158,255,0.12)' : 'rgba(84,104,255,0.1)'};
  color: ${textHigh};
  padding: 6px 14px; border-radius: 8px;
  font-size: 13px; pointer-events: none;
  z-index: 20; opacity: 0; transition: opacity 0.3s;
}
#scroll-hint.visible { opacity: 1; }
#scroll-hint kbd {
  display: inline-block; padding: 1px 5px;
  border: 1px solid ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'};
  border-radius: 3px; font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 12px; background: ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'};
}

/* Studio nudge toast */
#studio-hint {
  position: fixed; bottom: 60px; left: 50%;
  transform: translateX(-50%);
  background: ${isDark ? 'rgba(26,26,46,0.85)' : 'rgba(255,255,255,0.85)'};
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  border: 1px solid ${isDark ? 'rgba(142,158,255,0.12)' : 'rgba(84,104,255,0.1)'};
  padding: 8px 16px; border-radius: 8px;
  font-size: 13px; color: ${textMed};
  z-index: 20; opacity: 0; transition: opacity 0.4s;
  pointer-events: none;
}
#studio-hint.visible { opacity: 1; pointer-events: auto; }
#studio-hint a { color: ${brandAccent}; text-decoration: none; font-weight: 600; }
#studio-hint a:hover { text-decoration: underline; }

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  .node-glow { animation: none; opacity: 0.35; stroke-width: 8; }
  #info-panel { animation: none; }
  * { transition-duration: 0s !important; }
}

/* Responsive: mobile */
@media (max-width: 768px) {
  #controls { bottom: 12px; right: 12px; padding: 3px; }
  .ctrl-btn { width: 24px; height: 24px; font-size: 14px; }
  #zoom-label { font-size: 10px; min-width: 30px; }
  #branding { bottom: 12px; left: 12px; padding: 4px 8px; font-size: 11px; }
  #studio-hint { max-width: 90vw; text-align: center; white-space: normal; }
  #info-panel {
    left: 0 !important; right: 0 !important; bottom: 0 !important;
    max-width: none; min-width: 0; width: 100%;
    border-radius: 12px 12px 0 0;
    max-height: 60vh;
  }
  #info-panel::before {
    content: ''; display: block; width: 32px; height: 4px;
    background: ${isDark ? 'rgba(142,158,255,0.3)' : 'rgba(84,104,255,0.2)'};
    border-radius: 2px; margin: 8px auto 4px;
  }
  #info-body { max-height: calc(60vh - 80px); }
}
</style>
</head>
<body>
<svg id="canvas" xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">
  <defs>
    <pattern id="viewer-dots" width="20" height="20" patternUnits="userSpaceOnUse">
      <circle cx="10" cy="10" r="1.5" fill="${dotColor}" opacity="0.6"/>
    </pattern>
  </defs>
  <rect x="-100000" y="-100000" width="200000" height="200000" fill="${bg}" pointer-events="none"/>
  <rect x="-100000" y="-100000" width="200000" height="200000" fill="url(#viewer-dots)" pointer-events="none"/>
  <g id="diagram">${inner}</g>
</svg>
<div id="controls">
  <button class="ctrl-btn" id="btn-in" title="Zoom in" aria-label="Zoom in">+</button>
  <span id="zoom-label">100%</span>
  <button class="ctrl-btn" id="btn-out" title="Zoom out" aria-label="Zoom out">&minus;</button>
  <button class="ctrl-btn" id="btn-fit" title="Fit to view" aria-label="Fit to view">
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
      <rect x="1" y="1" width="12" height="12" rx="2"/>
      <path d="M1 5h12M1 9h12M5 1v12M9 1v12" opacity="0.4"/>
    </svg>
  </button>
  <button class="ctrl-btn" id="btn-reset" title="Reset layout" aria-label="Reset layout">
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M1.5 2v3.5h3.5"/>
      <path d="M2.1 8.5a5 5 0 1 0 .9-4L1.5 5.5"/>
    </svg>
  </button>
</div>
<div id="info-panel">
  <div id="info-header">
    <h3 id="info-title"></h3>
    <button class="panel-btn" id="btn-expand" title="Expand panel" aria-label="Expand panel">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9"/>
      </svg>
    </button>
    <button class="panel-btn" id="btn-close-panel" title="Close panel" aria-label="Close panel">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <path d="M2 2l10 10M12 2L2 12"/>
      </svg>
    </button>
  </div>
  <div id="info-body"></div>
</div>
<a id="branding" href="https://flowweaver.ai" target="_blank" rel="noopener">
  <svg width="16" height="16" viewBox="0 0 256 256" fill="none"><path d="M80 128C134 128 122 49 176 49" stroke="${brandAccent}" stroke-width="14" stroke-linecap="round"/><path d="M80 128C134 128 122 207 176 207" stroke="${brandAccent}" stroke-width="14" stroke-linecap="round"/><rect x="28" y="102" width="52" height="52" rx="10" stroke="${brandAccent}" stroke-width="14"/><rect x="176" y="23" width="52" height="52" rx="10" stroke="${brandAccent}" stroke-width="14"/><rect x="176" y="181" width="52" height="52" rx="10" stroke="${brandAccent}" stroke-width="14"/></svg>
  <span>Flow Weaver</span>
</a>
<div id="scroll-hint">Use <kbd id="mod-key">Ctrl</kbd> + scroll to zoom</div>
<div id="studio-hint">Like rearranging? <a href="https://flowweaver.ai" target="_blank" rel="noopener">Flow Weaver Studio</a> saves your layouts.</div>
<script>var nodeSources = ${JSON.stringify(options.nodeSources ?? {})};</script>
<script>
(function() {
  'use strict';

  var MIN_ZOOM = 0.25, MAX_ZOOM = 3;
  var canvas = document.getElementById('canvas');
  var content = document.getElementById('diagram');
  var zoomLabel = document.getElementById('zoom-label');
  var infoPanel = document.getElementById('info-panel');
  var infoTitle = document.getElementById('info-title');
  var infoBody = document.getElementById('info-body');
  var btnExpand = document.getElementById('btn-expand');
  var btnClosePanel = document.getElementById('btn-close-panel');
  var scrollHint = document.getElementById('scroll-hint');
  var studioHint = document.getElementById('studio-hint');
  var expandIcon = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9"/></svg>';
  var collapseIcon = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M5 1v4H1M13 5H9V1M9 13V9h4M1 9h4v4"/></svg>';

  // Parse the original viewBox (diagram bounding box)
  var vbParts = '${viewBox}'.split(/\\s+/).map(Number);
  var origX = vbParts[0], origY = vbParts[1], origW = vbParts[2], origH = vbParts[3];
  var vbX = origX, vbY = origY, vbW = origW, vbH = origH;
  var baseW = origW; // reference width for 100% zoom

  var pointerDown = false, didDrag = false, dragLast = { x: 0, y: 0 };
  var selectedNodeId = null;
  var selectedPortId = null;
  var hintTimer = null;

  // Detect Mac for modifier key
  var isMac = /Mac/.test(navigator.userAgent);
  document.getElementById('mod-key').textContent = isMac ? '\\u2318' : 'Ctrl';

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  function applyViewBox() {
    canvas.setAttribute('viewBox', vbX + ' ' + vbY + ' ' + vbW + ' ' + vbH);
    zoomLabel.textContent = Math.round(baseW / vbW * 100) + '%';
  }

  function fitToView() {
    var pad = 60;
    var cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!cw || !ch) return;
    var dw = origW + pad * 2, dh = origH + pad * 2;
    var vpRatio = cw / ch;
    var dRatio = dw / dh;
    if (vpRatio > dRatio) {
      vbH = dh; vbW = dh * vpRatio;
    } else {
      vbW = dw; vbH = dw / vpRatio;
    }
    vbX = origX - pad - (vbW - dw) / 2;
    vbY = origY - pad - (vbH - dh) / 2;
    baseW = vbW;
    applyViewBox();
  }

  // Convert pixel delta to SVG coordinate delta
  function pxToSvg() { return vbW / canvas.clientWidth; }

  // ---- Zoom (Ctrl/Cmd + scroll) ----
  canvas.addEventListener('wheel', function(e) {
    if (!e.ctrlKey && !e.metaKey) {
      scrollHint.classList.add('visible');
      clearTimeout(hintTimer);
      hintTimer = setTimeout(function() { scrollHint.classList.remove('visible'); }, 1500);
      return;
    }
    e.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var mx = (e.clientX - rect.left) / rect.width;
    var my = (e.clientY - rect.top) / rect.height;
    var pivotX = vbX + mx * vbW;
    var pivotY = vbY + my * vbH;
    var delta = clamp(e.deltaY, -10, 10);
    var factor = 1 + delta * 0.005;
    var newW = clamp(vbW * factor, baseW / MAX_ZOOM, baseW / MIN_ZOOM);
    var ratio = vbH / vbW;
    var newH = newW * ratio;
    vbX = pivotX - mx * newW;
    vbY = pivotY - my * newH;
    vbW = newW; vbH = newH;
    applyViewBox();
  }, { passive: false });

  // ---- Pan (drag) + Node drag ----
  var draggedNodeId = null, dragNodeStart = null, didDragNode = false;
  var clickTarget = null; // stash the real target before setPointerCapture steals it
  var dragCount = 0, nudgeIndex = 0, nudgeTimer = null;
  var nudgeMessages = [
    'Like rearranging? <a href="https://flowweaver.ai" target="_blank" rel="noopener">Flow Weaver Studio</a> saves your layouts.',
    'Changes here are temporary. <a href="https://flowweaver.ai" target="_blank" rel="noopener">Try the Studio</a> to keep them.',
    'Want to collaborate? <a href="https://flowweaver.ai" target="_blank" rel="noopener">Flow Weaver Studio</a> has real-time sharing.',
    'Build and deploy from the cloud with <a href="https://flowweaver.ai" target="_blank" rel="noopener">Flow Weaver Studio</a>.',
    'This viewer is read-only. <a href="https://flowweaver.ai" target="_blank" rel="noopener">Build workflows</a> in the Studio.',
    'Version history, diff viewer, rollbacks. All in <a href="https://flowweaver.ai" target="_blank" rel="noopener">the Studio</a>.',
    'Debug workflows step by step in <a href="https://flowweaver.ai" target="_blank" rel="noopener">Flow Weaver Studio</a>.',
    'Ship faster. <a href="https://flowweaver.ai" target="_blank" rel="noopener">Flow Weaver Studio</a> runs your workflows in the cloud.'
  ];

  canvas.addEventListener('pointerdown', function(e) {
    if (e.button !== 0) return;
    clickTarget = e.target; // stash before setPointerCapture redirects events
    didDrag = false;
    // Check if clicking on a node body (walk up to detect data-node-id)
    var t = e.target;
    while (t && t !== canvas) {
      if (t.hasAttribute && t.hasAttribute('data-node-id')) {
        // Don't start node drag if clicking on a port circle
        if (e.target.hasAttribute && e.target.hasAttribute('data-port-id')) break;
        draggedNodeId = t.getAttribute('data-node-id');
        dragNodeStart = { x: e.clientX, y: e.clientY };
        didDragNode = false;
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      t = t.parentElement;
    }
    // Canvas pan
    pointerDown = true;
    dragLast = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', function(e) {
    var ratio = pxToSvg();

    // Node drag
    if (draggedNodeId) {
      var dx = (e.clientX - dragNodeStart.x) * ratio;
      var dy = (e.clientY - dragNodeStart.y) * ratio;
      if (!didDragNode && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        didDragNode = true;
        canvas.classList.add('dragging');
      }
      if (didDragNode) {
        moveNode(draggedNodeId, dx, dy);
      }
      dragNodeStart = { x: e.clientX, y: e.clientY };
      return;
    }

    // Canvas pan — shift the viewBox origin
    if (!pointerDown) return;
    var dxPx = e.clientX - dragLast.x, dyPx = e.clientY - dragLast.y;
    if (!didDrag && (Math.abs(dxPx) > 3 || Math.abs(dyPx) > 3)) {
      didDrag = true;
      canvas.classList.add('dragging');
    }
    if (didDrag) {
      vbX -= dxPx * ratio;
      vbY -= dyPx * ratio;
      applyViewBox();
    }
    dragLast = { x: e.clientX, y: e.clientY };
  });

  function endDrag() {
    if (didDragNode) {
      dragCount++;
      var threshold = nudgeIndex === 0 ? 3 : 5;
      if (dragCount >= threshold) {
        dragCount = 0;
        studioHint.innerHTML = nudgeMessages[nudgeIndex % nudgeMessages.length];
        nudgeIndex++;
        studioHint.classList.add('visible');
        clearTimeout(nudgeTimer);
        nudgeTimer = setTimeout(function() { studioHint.classList.remove('visible'); }, 5000);
      }
    }
    pointerDown = false;
    draggedNodeId = null;
    canvas.classList.remove('dragging');
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---- Zoom buttons ----
  function zoomBy(dir) {
    var cx = vbX + vbW / 2, cy = vbY + vbH / 2;
    var factor = dir > 0 ? 0.85 : 1.18;
    var newW = clamp(vbW * factor, baseW / MAX_ZOOM, baseW / MIN_ZOOM);
    var ratio = vbH / vbW;
    var newH = newW * ratio;
    vbX = cx - newW / 2;
    vbY = cy - newH / 2;
    vbW = newW; vbH = newH;
    applyViewBox();
  }
  document.getElementById('btn-in').addEventListener('click', function() { zoomBy(1); });
  document.getElementById('btn-out').addEventListener('click', function() { zoomBy(-1); });
  document.getElementById('btn-fit').addEventListener('click', fitToView);

  // ---- Keyboard shortcuts ----
  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === '+' || e.key === '=') zoomBy(1);
    else if (e.key === '-') zoomBy(-1);
    else if (e.key === '0') fitToView();
    else if (e.key === 'Escape') { deselectPort(); deselectNode(); }
  });

  // ---- Port label visibility ----
  var labelMap = {};
  content.querySelectorAll('.labels g[data-port-label]').forEach(function(lbl) {
    labelMap[lbl.getAttribute('data-port-label')] = lbl;
  });

  // Build adjacency: portId -> array of connected portIds
  var portConnections = {};
  content.querySelectorAll('path[data-source]').forEach(function(p) {
    var src = p.getAttribute('data-source');
    var tgt = p.getAttribute('data-target');
    if (!src || !tgt) return;
    if (!portConnections[src]) portConnections[src] = [];
    if (!portConnections[tgt]) portConnections[tgt] = [];
    portConnections[src].push(tgt);
    portConnections[tgt].push(src);
  });

  // ---- Connection path computation (bezier from geometry.ts + orthogonal router) ----
  var TRACK_SPACING = 15, EDGE_OFFSET = 5, MAX_CANDIDATES = 5;
  var MIN_SEG_LEN = 3, JOG_THRESHOLD = 10, ORTHO_THRESHOLD = 300;

  function quadCurveControl(ax, ay, bx, by, ux, uy) {
    var dn = Math.abs(ay - by);
    return [bx + (ux * dn) / Math.abs(uy), ay];
  }

  function computeConnectionPath(sx, sy, tx, ty) {
    var e = 0.0001;
    var ax = sx + e, ay = sy + e, hx = tx - e, hy = ty - e;
    var ramp = Math.min(20, (hx - ax) / 10);
    var bx = ax + ramp, by = ay + e, gx = hx - ramp, gy = hy - e;
    var curveSizeX = Math.min(60, Math.abs(ax - hx) / 4);
    var curveSizeY = Math.min(60, Math.abs(ay - hy) / 4);
    var curveMag = Math.sqrt(curveSizeX * curveSizeX + curveSizeY * curveSizeY);
    var bgX = gx - bx, bgY = gy - by;
    var bgLen = Math.sqrt(bgX * bgX + bgY * bgY);
    var bgUx = bgX / bgLen, bgUy = bgY / bgLen;
    var dx = bx + bgUx * curveMag, dy = by + (bgUy * curveMag) / 2;
    var ex = gx - bgUx * curveMag, ey = gy - (bgUy * curveMag) / 2;
    var deX = ex - dx, deY = ey - dy;
    var deLen = Math.sqrt(deX * deX + deY * deY);
    var deUx = deX / deLen, deUy = deY / deLen;
    var c = quadCurveControl(bx, by, dx, dy, -deUx, -deUy);
    var f = quadCurveControl(gx, gy, ex, ey, deUx, deUy);
    return 'M ' + c[0] + ',' + c[1] + ' M ' + ax + ',' + ay +
      ' L ' + bx + ',' + by + ' Q ' + c[0] + ',' + c[1] + ' ' + dx + ',' + dy +
      ' L ' + ex + ',' + ey + ' Q ' + f[0] + ',' + f[1] + ' ' + gx + ',' + gy +
      ' L ' + hx + ',' + hy;
  }

  // ---- Orthogonal router (ported from orthogonal-router.ts) ----
  function createAllocator() {
    var claims = [], vclaims = [];
    function isOcc(xn, xx, y) {
      for (var i = 0; i < claims.length; i++) {
        var c = claims[i];
        if (c.xn < xx && c.xx > xn && Math.abs(c.y - y) < TRACK_SPACING) return true;
      }
      return false;
    }
    function isOccV(yn, yx, x) {
      for (var i = 0; i < vclaims.length; i++) {
        var c = vclaims[i];
        if (c.yn < yx && c.yx > yn && Math.abs(c.x - x) < TRACK_SPACING) return true;
      }
      return false;
    }
    function blockedByNode(xn, xx, y, boxes) {
      for (var i = 0; i < boxes.length; i++) {
        var b = boxes[i]; if (xn < b.r && xx > b.l && y >= b.t && y <= b.b) return true;
      }
      return false;
    }
    function blockedByNodeV(yn, yx, x, boxes) {
      for (var i = 0; i < boxes.length; i++) {
        var b = boxes[i]; if (x >= b.l && x <= b.r && yn < b.b && yx > b.t) return true;
      }
      return false;
    }
    function countHCross(xn, xx, y) {
      var n = 0;
      for (var i = 0; i < vclaims.length; i++) {
        var c = vclaims[i]; if (c.x > xn && c.x < xx && y >= c.yn && y <= c.yx) n++;
      }
      return n;
    }
    function countVCross(yn, yx, x) {
      var n = 0;
      for (var i = 0; i < claims.length; i++) {
        var c = claims[i]; if (c.y > yn && c.y < yx && x >= c.xn && x <= c.xx) n++;
      }
      return n;
    }
    return {
      findFreeY: function(xn, xx, cy, nb) {
        var free = function(y) { return !isOcc(xn, xx, y) && (!nb || !blockedByNode(xn, xx, y, nb)); };
        if (free(cy)) return cy;
        var cands = [];
        for (var off = TRACK_SPACING; off < 800 && cands.length < MAX_CANDIDATES * 2; off += TRACK_SPACING) {
          if (free(cy - off)) cands.push({ y: cy - off, d: off });
          if (free(cy + off)) cands.push({ y: cy + off, d: off });
        }
        if (!cands.length) return cy;
        var best = cands[0].y, bc = countHCross(xn, xx, cands[0].y), bd = cands[0].d;
        for (var i = 1; i < cands.length; i++) {
          var cr = countHCross(xn, xx, cands[i].y);
          if (cr < bc || (cr === bc && cands[i].d < bd)) { best = cands[i].y; bc = cr; bd = cands[i].d; }
        }
        return best;
      },
      findFreeX: function(yn, yx, cx, nb) {
        var free = function(x) { return !isOccV(yn, yx, x) && (!nb || !blockedByNodeV(yn, yx, x, nb)); };
        if (free(cx)) return cx;
        var cands = [];
        for (var off = TRACK_SPACING; off < 800 && cands.length < MAX_CANDIDATES * 2; off += TRACK_SPACING) {
          if (free(cx - off)) cands.push({ x: cx - off, d: off });
          if (free(cx + off)) cands.push({ x: cx + off, d: off });
        }
        if (!cands.length) return cx;
        var best = cands[0].x, bc = countVCross(yn, yx, cands[0].x), bd = cands[0].d;
        for (var i = 1; i < cands.length; i++) {
          var cr = countVCross(yn, yx, cands[i].x);
          if (cr < bc || (cr === bc && cands[i].d < bd)) { best = cands[i].x; bc = cr; bd = cands[i].d; }
        }
        return best;
      },
      claim: function(xn, xx, y) { claims.push({ xn: xn, xx: xx, y: y }); },
      claimV: function(yn, yx, x) { vclaims.push({ yn: yn, yx: yx, x: x }); }
    };
  }

  function inflateBox(b, pad) { return { l: b.x - pad, r: b.x + b.w + pad, t: b.y - pad, b: b.y + b.h + pad }; }
  function segOvlp(xn, xx, y, bx) { return xn < bx.r && xx > bx.l && y >= bx.t && y <= bx.b; }
  function vSegClear(x, yn, yx, boxes) {
    for (var i = 0; i < boxes.length; i++) { var b = boxes[i]; if (x >= b.l && x <= b.r && yn < b.b && yx > b.t) return false; }
    return true;
  }

  function findClearY(xn, xx, cy, boxes) {
    var blocked = function(y) { for (var i = 0; i < boxes.length; i++) if (segOvlp(xn, xx, y, boxes[i])) return true; return false; };
    if (!blocked(cy)) return cy;
    var edges = [];
    for (var i = 0; i < boxes.length; i++) { var b = boxes[i]; if (xn < b.r && xx > b.l) { edges.push(b.t); edges.push(b.b); } }
    if (!edges.length) return cy;
    edges.sort(function(a, b) { return a - b; });
    var best = cy, bd = Infinity;
    for (var i = 0; i < edges.length; i++) {
      var vals = [edges[i] - EDGE_OFFSET, edges[i] + EDGE_OFFSET];
      for (var j = 0; j < 2; j++) { if (!blocked(vals[j])) { var d = Math.abs(vals[j] - cy); if (d < bd) { bd = d; best = vals[j]; } } }
    }
    if (bd === Infinity) {
      var mn = Math.min.apply(null, edges) - EDGE_OFFSET * 2, mx = Math.max.apply(null, edges) + EDGE_OFFSET * 2;
      best = Math.abs(mn - cy) <= Math.abs(mx - cy) ? mn : mx;
      if (blocked(best)) { for (var off = TRACK_SPACING; off < 800; off += TRACK_SPACING) { if (!blocked(best - off)) { best -= off; break; } if (!blocked(best + off)) { best += off; break; } } }
    }
    return best;
  }

  function findClearX(yn, yx, cx, boxes) {
    var blocked = function(x) { for (var i = 0; i < boxes.length; i++) { var b = boxes[i]; if (x >= b.l && x <= b.r && yn < b.b && yx > b.t) return true; } return false; };
    if (!blocked(cx)) return cx;
    var edges = [];
    for (var i = 0; i < boxes.length; i++) { var b = boxes[i]; if (yn < b.b && yx > b.t) { edges.push(b.l); edges.push(b.r); } }
    if (!edges.length) return cx;
    edges.sort(function(a, b) { return a - b; });
    var best = cx, bd = Infinity;
    for (var i = 0; i < edges.length; i++) {
      var vals = [edges[i] - EDGE_OFFSET, edges[i] + EDGE_OFFSET];
      for (var j = 0; j < 2; j++) { if (!blocked(vals[j])) { var d = Math.abs(vals[j] - cx); if (d < bd) { bd = d; best = vals[j]; } } }
    }
    if (bd === Infinity) {
      var mn = Math.min.apply(null, edges) - EDGE_OFFSET * 2, mx = Math.max.apply(null, edges) + EDGE_OFFSET * 2;
      best = Math.abs(mn - cx) <= Math.abs(mx - cx) ? mn : mx;
      if (blocked(best)) { for (var off = TRACK_SPACING; off < 800; off += TRACK_SPACING) { if (!blocked(best - off)) { best -= off; break; } if (!blocked(best + off)) { best += off; break; } } }
    }
    return best;
  }

  function simplifyWaypoints(pts) {
    if (pts.length <= 2) return pts;
    var jogFound = true;
    while (jogFound) {
      jogFound = false;
      for (var i = 0; i < pts.length - 3; i++) {
        var a = pts[i], b = pts[i+1], c = pts[i+2], d = pts[i+3];
        var jogH = Math.abs(b[1] - c[1]);
        if (Math.abs(a[1] - b[1]) < 0.5 && Math.abs(b[0] - c[0]) < 0.5 && Math.abs(c[1] - d[1]) < 0.5 && jogH > 0.5 && jogH < JOG_THRESHOLD) {
          var mid = (b[1] + c[1]) / 2, snap = Math.abs(a[1] - mid) <= Math.abs(d[1] - mid) ? a[1] : d[1];
          pts = pts.slice(); pts[i+1] = [b[0], snap]; pts[i+2] = [c[0], snap]; jogFound = true; break;
        }
        var jogW = Math.abs(b[0] - c[0]);
        if (Math.abs(a[0] - b[0]) < 0.5 && Math.abs(b[1] - c[1]) < 0.5 && Math.abs(c[0] - d[0]) < 0.5 && jogW > 0.5 && jogW < JOG_THRESHOLD) {
          var mid = (b[0] + c[0]) / 2, snap = Math.abs(a[0] - mid) <= Math.abs(d[0] - mid) ? a[0] : d[0];
          pts = pts.slice(); pts[i+1] = [snap, b[1]]; pts[i+2] = [snap, c[1]]; jogFound = true; break;
        }
      }
    }
    var res = [pts[0]];
    for (var i = 1; i < pts.length - 1; i++) {
      var prev = res[res.length - 1], cur = pts[i], next = pts[i+1];
      if (Math.abs(prev[0] - cur[0]) + Math.abs(prev[1] - cur[1]) < MIN_SEG_LEN) continue;
      var sameX = Math.abs(prev[0] - cur[0]) < 0.01 && Math.abs(cur[0] - next[0]) < 0.01;
      var sameY = Math.abs(prev[1] - cur[1]) < 0.01 && Math.abs(cur[1] - next[1]) < 0.01;
      if (!sameX && !sameY) res.push(cur);
    }
    res.push(pts[pts.length - 1]);
    return res;
  }

  function waypointsToPath(wp, cr) {
    if (wp.length < 2) return '';
    if (wp.length === 2) return 'M ' + wp[0][0] + ',' + wp[0][1] + ' L ' + wp[1][0] + ',' + wp[1][1];
    var radii = [];
    for (var i = 0; i < wp.length; i++) radii[i] = 0;
    for (var i = 1; i < wp.length - 1; i++) {
      var p = wp[i-1], c = wp[i], n = wp[i+1];
      var lp = Math.sqrt((p[0]-c[0])*(p[0]-c[0]) + (p[1]-c[1])*(p[1]-c[1]));
      var ln = Math.sqrt((n[0]-c[0])*(n[0]-c[0]) + (n[1]-c[1])*(n[1]-c[1]));
      radii[i] = (lp < 0.01 || ln < 0.01) ? 0 : Math.min(cr, lp / 2, ln / 2);
    }
    for (var i = 1; i < wp.length - 2; i++) {
      var c = wp[i], n = wp[i+1];
      var sl = Math.sqrt((n[0]-c[0])*(n[0]-c[0]) + (n[1]-c[1])*(n[1]-c[1]));
      var tot = radii[i] + radii[i+1];
      if (tot > sl && tot > 0) { var sc = sl / tot; radii[i] *= sc; radii[i+1] *= sc; }
    }
    var path = 'M ' + wp[0][0] + ',' + wp[0][1];
    for (var i = 1; i < wp.length - 1; i++) {
      var p = wp[i-1], c = wp[i], n = wp[i+1], r = radii[i];
      if (r < 2) { path += ' L ' + c[0] + ',' + c[1]; continue; }
      var dpx = p[0]-c[0], dpy = p[1]-c[1], dnx = n[0]-c[0], dny = n[1]-c[1];
      var lp = Math.sqrt(dpx*dpx + dpy*dpy), ln = Math.sqrt(dnx*dnx + dny*dny);
      var upx = dpx/lp, upy = dpy/lp, unx = dnx/ln, uny = dny/ln;
      var asx = c[0] + upx*r, asy = c[1] + upy*r, aex = c[0] + unx*r, aey = c[1] + uny*r;
      var cross = dpx*dny - dpy*dnx, sweep = cross > 0 ? 0 : 1;
      path += ' L ' + asx + ',' + asy + ' A ' + r + ' ' + r + ' 0 0 ' + sweep + ' ' + aex + ',' + aey;
    }
    path += ' L ' + wp[wp.length-1][0] + ',' + wp[wp.length-1][1];
    return path;
  }

  function computeWaypoints(from, to, nboxes, srcId, tgtId, pad, exitStub, entryStub, alloc) {
    var isSelf = srcId === tgtId;
    var iboxes = [];
    for (var i = 0; i < nboxes.length; i++) {
      var b = nboxes[i];
      if (isSelf || (b.id !== srcId && b.id !== tgtId)) iboxes.push(inflateBox(b, pad));
    }
    var se = [from[0] + exitStub, from[1]], sn = [to[0] - entryStub, to[1]];
    var xn = Math.min(se[0], sn[0]), xx = Math.max(se[0], sn[0]);

    if (!isSelf && to[0] > from[0]) {
      var cy = (from[1] + to[1]) / 2;
      var intBoxes = [];
      for (var i = 0; i < iboxes.length; i++) { var b = iboxes[i]; if (b.l < xx && b.r > xn) intBoxes.push(b); }
      if (intBoxes.length >= 2) {
        var ct = Infinity, cb = -Infinity;
        for (var i = 0; i < intBoxes.length; i++) { ct = Math.min(ct, intBoxes[i].t); cb = Math.max(cb, intBoxes[i].b); }
        if (cy > ct && cy < cb) { cy = (cy - ct <= cb - cy) ? ct - pad : cb + pad; }
      }
      var clearY = findClearY(xn, xx, cy, iboxes);
      if (Math.abs(from[1] - to[1]) < JOG_THRESHOLD && Math.abs(clearY - from[1]) < JOG_THRESHOLD) return null;

      var midX = (se[0] + sn[0]) / 2, ymn = Math.min(from[1], to[1]), ymx = Math.max(from[1], to[1]);
      var cmx = findClearX(ymn, ymx, midX, iboxes);
      var fmx = alloc.findFreeX(ymn, ymx, cmx, iboxes);
      if (ymx - ymn >= JOG_THRESHOLD && fmx > se[0] && fmx < sn[0] &&
          vSegClear(fmx, ymn, ymx, iboxes) &&
          alloc.findFreeY(from[0], fmx, from[1], iboxes) === from[1] &&
          alloc.findFreeY(fmx, to[0], to[1], iboxes) === to[1]) {
        alloc.claim(from[0], fmx, from[1]); alloc.claim(fmx, to[0], to[1]); alloc.claimV(ymn, ymx, fmx);
        return simplifyWaypoints([from, [fmx, from[1]], [fmx, to[1]], to]);
      }

      clearY = alloc.findFreeY(xn, xx, clearY, iboxes);
      if (Math.abs(clearY - from[1]) < JOG_THRESHOLD && !iboxes.some(function(b) { return segOvlp(xn, xx, from[1], b); })) clearY = from[1];
      else if (Math.abs(clearY - to[1]) < JOG_THRESHOLD && !iboxes.some(function(b) { return segOvlp(xn, xx, to[1], b); })) clearY = to[1];
      alloc.claim(xn, xx, clearY);

      var eymn = Math.min(from[1], clearY), eymx = Math.max(from[1], clearY);
      var exX = findClearX(eymn, eymx, se[0], iboxes); exX = alloc.findFreeX(eymn, eymx, exX, iboxes);
      if (exX < from[0]) { exX = se[0]; if (!vSegClear(exX, eymn, eymx, iboxes)) { exX = findClearX(eymn, eymx, se[0] + TRACK_SPACING, iboxes); exX = alloc.findFreeX(eymn, eymx, exX, iboxes); } }
      alloc.claimV(eymn, eymx, exX);

      var nymn = Math.min(to[1], clearY), nymx = Math.max(to[1], clearY);
      var nxX = findClearX(nymn, nymx, sn[0], iboxes); nxX = alloc.findFreeX(nymn, nymx, nxX, iboxes);
      if (nxX > to[0]) { nxX = sn[0]; if (!vSegClear(nxX, nymn, nymx, iboxes)) { nxX = findClearX(nymn, nymx, sn[0] - TRACK_SPACING, iboxes); nxX = alloc.findFreeX(nymn, nymx, nxX, iboxes); } }
      alloc.claimV(nymn, nymx, nxX);

      return simplifyWaypoints([from, [exX, from[1]], [exX, clearY], [nxX, clearY], [nxX, to[1]], to]);
    } else {
      var srcBox = null, tgtBox = null;
      for (var i = 0; i < nboxes.length; i++) { if (nboxes[i].id === srcId) srcBox = nboxes[i]; if (nboxes[i].id === tgtId) tgtBox = nboxes[i]; }
      var corBoxes = []; for (var i = 0; i < iboxes.length; i++) { var b = iboxes[i]; if (b.l < xx && b.r > xn) corBoxes.push(b); }
      var bots = corBoxes.map(function(b) { return b.b; }), tops = corBoxes.map(function(b) { return b.t; });
      if (srcBox) { bots.push(srcBox.y + srcBox.h + pad); tops.push(srcBox.y - pad); }
      if (tgtBox) { bots.push(tgtBox.y + tgtBox.h + pad); tops.push(tgtBox.y - pad); }
      var maxBot = Math.max.apply(null, bots.concat([from[1] + 50, to[1] + 50]));
      var minTop = Math.min.apply(null, tops.concat([from[1] - 50, to[1] - 50]));
      var avgY = (from[1] + to[1]) / 2;
      var escBelow = maxBot + pad, escAbove = minTop - pad;
      var escY = Math.abs(escAbove - avgY) <= Math.abs(escBelow - avgY) ? escAbove : escBelow;
      escY = findClearY(xn, xx, escY, iboxes); escY = alloc.findFreeY(xn, xx, escY, iboxes); alloc.claim(xn, xx, escY);

      var bymn = Math.min(from[1], escY), bymx = Math.max(from[1], escY);
      var bexX = findClearX(bymn, bymx, se[0], iboxes); bexX = alloc.findFreeX(bymn, bymx, bexX, iboxes); alloc.claimV(bymn, bymx, bexX);

      var bnmn = Math.min(to[1], escY), bnmx = Math.max(to[1], escY);
      var bnxX = findClearX(bnmn, bnmx, sn[0], iboxes); bnxX = alloc.findFreeX(bnmn, bnmx, bnxX, iboxes); alloc.claimV(bnmn, bnmx, bnxX);

      return simplifyWaypoints([from, [bexX, from[1]], [bexX, escY], [bnxX, escY], [bnxX, to[1]], to]);
    }
  }

  function calcOrthogonalPath(from, to, nboxes, srcId, tgtId, fromIdx, toIdx, alloc) {
    var pad = 15, stubLen = 20, stubSpc = 12, maxStub = 80, cr = 10;
    var exitStub = Math.min(stubLen + fromIdx * stubSpc, maxStub);
    var entryStub = Math.min(stubLen + toIdx * stubSpc, maxStub);
    try {
      var wp = computeWaypoints(from, to, nboxes, srcId, tgtId, pad, exitStub, entryStub, alloc);
      if (!wp) return null;
      var p = waypointsToPath(wp, cr);
      return (p && p.length >= 5) ? p : null;
    } catch (e) { return null; }
  }

  // ---- Port position + node box + connection path indexes ----
  var portPositions = {};
  content.querySelectorAll('[data-port-id]').forEach(function(el) {
    var id = el.getAttribute('data-port-id');
    portPositions[id] = { cx: parseFloat(el.getAttribute('cx')), cy: parseFloat(el.getAttribute('cy')) };
  });

  // Extract node bounding boxes from SVG rect elements
  var nodeBoxMap = {};
  content.querySelectorAll('.nodes [data-node-id]').forEach(function(g) {
    var nid = g.getAttribute('data-node-id');
    var rect = g.querySelector(':scope > rect');
    if (!rect) return;
    nodeBoxMap[nid] = {
      id: nid,
      x: parseFloat(rect.getAttribute('x')),
      y: parseFloat(rect.getAttribute('y')),
      w: parseFloat(rect.getAttribute('width')),
      h: parseFloat(rect.getAttribute('height'))
    };
  });

  // Build port-to-node mapping and compute port indices within each node
  var portNodeMap = {};
  var portIndexMap = {};
  content.querySelectorAll('[data-port-id]').forEach(function(el) {
    var id = el.getAttribute('data-port-id');
    var dir = el.getAttribute('data-direction');
    var parts = id.split('.');
    var nodeId = parts[0];
    portNodeMap[id] = nodeId;
    if (!portIndexMap[nodeId]) portIndexMap[nodeId] = { input: [], output: [] };
    portIndexMap[nodeId][dir].push(id);
  });

  var nodeOffsets = {};
  var connIndex = [];
  content.querySelectorAll('path[data-source]').forEach(function(p) {
    var src = p.getAttribute('data-source'), tgt = p.getAttribute('data-target');
    var srcNode = src.split('.')[0], tgtNode = tgt.split('.')[0];
    var srcIdx = portIndexMap[srcNode] ? portIndexMap[srcNode].output.indexOf(src) : 0;
    var tgtIdx = portIndexMap[tgtNode] ? portIndexMap[tgtNode].input.indexOf(tgt) : 0;
    connIndex.push({ el: p, src: src, tgt: tgt, srcNode: srcNode, tgtNode: tgtNode,
      scopeOf: p.getAttribute('data-scope') || null, srcIdx: Math.max(0, srcIdx), tgtIdx: Math.max(0, tgtIdx) });
  });

  // Snapshot of original port positions for reset
  var origPortPositions = {};
  for (var pid in portPositions) {
    origPortPositions[pid] = { cx: portPositions[pid].cx, cy: portPositions[pid].cy };
  }
  var origNodeBoxMap = {};
  for (var nid in nodeBoxMap) {
    var b = nodeBoxMap[nid];
    origNodeBoxMap[nid] = { id: b.id, x: b.x, y: b.y, w: b.w, h: b.h };
  }

  // ---- Recalculate all connection paths using orthogonal + bezier routing ----
  function recalcAllPaths() {
    var boxes = [];
    for (var nid in nodeBoxMap) boxes.push(nodeBoxMap[nid]);
    var sorted = connIndex.slice().sort(function(a, b) {
      var spa = portPositions[a.src] && portPositions[a.tgt] ? Math.abs(portPositions[a.tgt].cx - portPositions[a.src].cx) : 0;
      var spb = portPositions[b.src] && portPositions[b.tgt] ? Math.abs(portPositions[b.tgt].cx - portPositions[b.src].cx) : 0;
      if (Math.abs(spa - spb) > 1) return spa - spb;
      var sxa = portPositions[a.src] ? portPositions[a.src].cx : 0, sxb = portPositions[b.src] ? portPositions[b.src].cx : 0;
      if (Math.abs(sxa - sxb) > 1) return sxa - sxb;
      var sya = portPositions[a.src] ? portPositions[a.src].cy : 0, syb = portPositions[b.src] ? portPositions[b.src].cy : 0;
      return sya - syb;
    });
    var alloc = createAllocator();
    for (var i = 0; i < sorted.length; i++) {
      var c = sorted[i];
      var sp = portPositions[c.src], tp = portPositions[c.tgt];
      if (!sp || !tp) continue;
      var sx = sp.cx, sy = sp.cy, tx = tp.cx, ty = tp.cy;
      // For scope connections, use parent-local coords
      if (c.scopeOf) {
        var pOff = nodeOffsets[c.scopeOf] || { dx: 0, dy: 0 };
        sx -= pOff.dx; sy -= pOff.dy; tx -= pOff.dx; ty -= pOff.dy;
      }
      var ddx = tx - sx, ddy = ty - sy, dist = Math.sqrt(ddx * ddx + ddy * ddy);
      var path;
      if (dist > ORTHO_THRESHOLD) {
        path = calcOrthogonalPath([sx, sy], [tx, ty], boxes, c.srcNode, c.tgtNode, c.srcIdx, c.tgtIdx, alloc);
        if (!path) path = computeConnectionPath(sx, sy, tx, ty);
      } else {
        path = computeConnectionPath(sx, sy, tx, ty);
      }
      c.el.setAttribute('d', path);
    }
  }

  function resetLayout() {
    for (var nid in nodeOffsets) {
      var esc = CSS.escape(nid);
      var nodeG = content.querySelector('.nodes [data-node-id="' + esc + '"]');
      if (nodeG) nodeG.removeAttribute('transform');
      var labelG = content.querySelector('[data-label-for="' + esc + '"]');
      if (labelG) labelG.removeAttribute('transform');
      allLabelIds.forEach(function(id) {
        if (id.indexOf(nid + '.') === 0) {
          var el = labelMap[id];
          if (el) el.removeAttribute('transform');
        }
      });
    }
    nodeOffsets = {};
    for (var pid in origPortPositions) {
      portPositions[pid] = { cx: origPortPositions[pid].cx, cy: origPortPositions[pid].cy };
    }
    for (var nid in origNodeBoxMap) {
      var b = origNodeBoxMap[nid];
      nodeBoxMap[nid] = { id: b.id, x: b.x, y: b.y, w: b.w, h: b.h };
    }
    recalcAllPaths();
    fitToView();
  }
  document.getElementById('btn-reset').addEventListener('click', resetLayout);

  // ---- Node drag: moveNode ----
  function moveNode(nodeId, dx, dy) {
    if (!nodeOffsets[nodeId]) nodeOffsets[nodeId] = { dx: 0, dy: 0 };
    var off = nodeOffsets[nodeId];
    off.dx += dx; off.dy += dy;
    var tr = 'translate(' + off.dx + ',' + off.dy + ')';

    // Move node group (if nested inside a scoped parent, subtract parent offset)
    var nodeG = content.querySelector('.nodes [data-node-id="' + CSS.escape(nodeId) + '"]');
    if (nodeG) {
      var parentNodeG = nodeG.parentElement ? nodeG.parentElement.closest('[data-node-id]') : null;
      if (parentNodeG) {
        var parentId = parentNodeG.getAttribute('data-node-id');
        var parentOff = nodeOffsets[parentId] || { dx: 0, dy: 0 };
        nodeG.setAttribute('transform', 'translate(' + (off.dx - parentOff.dx) + ',' + (off.dy - parentOff.dy) + ')');
      } else {
        nodeG.setAttribute('transform', tr);
      }
    }

    // Move label
    var labelG = content.querySelector('[data-label-for="' + CSS.escape(nodeId) + '"]');
    if (labelG) labelG.setAttribute('transform', tr);

    // Move port labels
    allLabelIds.forEach(function(id) {
      if (id.indexOf(nodeId + '.') === 0) {
        var el = labelMap[id];
        if (el) el.setAttribute('transform', tr);
      }
    });

    // Update port positions
    for (var pid in portPositions) {
      if (pid.indexOf(nodeId + '.') === 0) {
        portPositions[pid].cx += dx;
        portPositions[pid].cy += dy;
      }
    }

    // Move child nodes inside scoped parents
    if (nodeG) {
      var children = nodeG.querySelectorAll(':scope > g[data-node-id]');
      children.forEach(function(childG) {
        var childId = childG.getAttribute('data-node-id');
        if (!nodeOffsets[childId]) nodeOffsets[childId] = { dx: 0, dy: 0 };
        nodeOffsets[childId].dx += dx;
        nodeOffsets[childId].dy += dy;
        for (var pid in portPositions) {
          if (pid.indexOf(childId + '.') === 0) {
            portPositions[pid].cx += dx;
            portPositions[pid].cy += dy;
          }
        }
        var childLabel = content.querySelector('[data-label-for="' + CSS.escape(childId) + '"]');
        if (childLabel) childLabel.setAttribute('transform', 'translate(' + nodeOffsets[childId].dx + ',' + nodeOffsets[childId].dy + ')');
        allLabelIds.forEach(function(id) {
          if (id.indexOf(childId + '.') === 0) {
            var el = labelMap[id];
            if (el) el.setAttribute('transform', 'translate(' + nodeOffsets[childId].dx + ',' + nodeOffsets[childId].dy + ')');
          }
        });
      });
    }

    // Update node box positions for orthogonal routing
    if (nodeBoxMap[nodeId]) {
      var nb = origNodeBoxMap[nodeId];
      if (nb) nodeBoxMap[nodeId] = { id: nb.id, x: nb.x + off.dx, y: nb.y + off.dy, w: nb.w, h: nb.h };
    }
    if (nodeG) {
      var children = nodeG.querySelectorAll(':scope > g[data-node-id]');
      children.forEach(function(childG) {
        var childId = childG.getAttribute('data-node-id');
        var cnb = origNodeBoxMap[childId];
        if (cnb && nodeOffsets[childId]) {
          nodeBoxMap[childId] = { id: cnb.id, x: cnb.x + nodeOffsets[childId].dx, y: cnb.y + nodeOffsets[childId].dy, w: cnb.w, h: cnb.h };
        }
      });
    }

    // Recalculate all connection paths with orthogonal routing
    recalcAllPaths();
  }

  var allLabelIds = Object.keys(labelMap);
  var hoveredPort = null;

  function showLabel(id) { var l = labelMap[id]; if (l) { l.style.opacity = '1'; l.style.pointerEvents = 'auto'; } }
  function hideLabel(id) { var l = labelMap[id]; if (l) { l.style.opacity = '0'; l.style.pointerEvents = 'none'; } }

  function showLabelsFor(nodeId) {
    allLabelIds.forEach(function(id) {
      if (id.indexOf(nodeId + '.') === 0) showLabel(id);
    });
  }
  function hideLabelsFor(nodeId) {
    allLabelIds.forEach(function(id) {
      if (id.indexOf(nodeId + '.') === 0) hideLabel(id);
    });
  }

  // Node hover: show all port labels for the hovered node
  var nodeEls = content.querySelectorAll('.nodes g[data-node-id]');
  nodeEls.forEach(function(nodeG) {
    var nodeId = nodeG.getAttribute('data-node-id');
    var parentNodeG = nodeG.parentElement ? nodeG.parentElement.closest('g[data-node-id]') : null;
    var parentId = parentNodeG ? parentNodeG.getAttribute('data-node-id') : null;
    nodeG.addEventListener('mouseenter', function() {
      if (hoveredPort) return;
      if (parentId) hideLabelsFor(parentId);
      showLabelsFor(nodeId);
    });
    nodeG.addEventListener('mouseleave', function() {
      if (hoveredPort) return;
      hideLabelsFor(nodeId);
      if (parentId) showLabelsFor(parentId);
    });
  });

  // Port hover: show this port's label + all connected port labels
  content.querySelectorAll('[data-port-id]').forEach(function(portEl) {
    var portId = portEl.getAttribute('data-port-id');
    var nodeId = portId.split('.')[0];
    var peers = (portConnections[portId] || []).concat(portId);

    portEl.addEventListener('mouseenter', function() {
      hoveredPort = portId;
      hideLabelsFor(nodeId);
      peers.forEach(showLabel);
      document.body.classList.add('port-hovered');
      content.querySelectorAll('path[data-source]').forEach(function(p) {
        if (p.getAttribute('data-source') === portId || p.getAttribute('data-target') === portId) {
          p.classList.remove('dimmed');
        } else {
          p.classList.add('dimmed');
        }
      });
    });
    portEl.addEventListener('mouseleave', function() {
      hoveredPort = null;
      peers.forEach(hideLabel);
      showLabelsFor(nodeId);
      document.body.classList.remove('port-hovered');
      content.querySelectorAll('path[data-source].dimmed').forEach(function(p) {
        p.classList.remove('dimmed');
      });
    });
  });

  // ---- Node glow helpers ----
  function removeNodeGlow() {
    var glow = content.querySelector('.node-glow');
    if (glow) glow.remove();
  }

  function addNodeGlow(nodeG) {
    removeNodeGlow();
    var rect = nodeG.querySelector('rect');
    if (!rect) return;
    var ns = 'http://www.w3.org/2000/svg';
    var glow = document.createElementNS(ns, 'rect');
    glow.setAttribute('x', rect.getAttribute('x'));
    glow.setAttribute('y', rect.getAttribute('y'));
    glow.setAttribute('width', rect.getAttribute('width'));
    glow.setAttribute('height', rect.getAttribute('height'));
    glow.setAttribute('rx', rect.getAttribute('rx') || '0');
    glow.setAttribute('stroke', rect.getAttribute('stroke') || '#5468ff');
    glow.setAttribute('class', 'node-glow');
    nodeG.insertBefore(glow, rect);
  }

  // ---- Port selection ----
  function deselectPort() {
    if (!selectedPortId) return;
    selectedPortId = null;
    document.body.classList.remove('port-active');
    content.querySelectorAll('circle.port-selected').forEach(function(c) {
      c.classList.remove('port-selected');
    });
    content.querySelectorAll('path[data-source].dimmed, path[data-source].highlighted').forEach(function(p) {
      p.classList.remove('dimmed');
      p.classList.remove('highlighted');
    });
  }

  function selectPort(portId) {
    if (selectedPortId === portId) { deselectPort(); return; }
    if (selectedNodeId) deselectNode();
    deselectPort();
    selectedPortId = portId;
    document.body.classList.add('port-active');

    var portEl = content.querySelector('[data-port-id="' + CSS.escape(portId) + '"]');
    if (portEl) portEl.classList.add('port-selected');

    content.querySelectorAll('path[data-source]').forEach(function(p) {
      if (p.getAttribute('data-source') === portId || p.getAttribute('data-target') === portId) {
        p.classList.add('highlighted');
      } else {
        p.classList.add('dimmed');
      }
    });

    var peers = (portConnections[portId] || []).concat(portId);
    peers.forEach(showLabel);
  }

  // ---- Click to inspect node ----
  function deselectNode() {
    selectedNodeId = null;
    document.body.classList.remove('node-active');
    infoPanel.classList.remove('visible');
    infoPanel.classList.remove('fullscreen');
    btnExpand.innerHTML = expandIcon;
    removeNodeGlow();
    content.querySelectorAll('path[data-source].dimmed').forEach(function(p) {
      p.classList.remove('dimmed');
    });
  }

  function selectNode(nodeId) {
    if (selectedNodeId === nodeId) { deselectNode(); return; }
    selectedNodeId = nodeId;
    document.body.classList.add('node-active');

    var nodeG = content.querySelector('[data-node-id="' + CSS.escape(nodeId) + '"]');
    addNodeGlow(nodeG);

    var labelG = content.querySelector('[data-label-for="' + CSS.escape(nodeId) + '"]');
    var labelText = labelG ? (labelG.querySelector('.node-label') || {}).textContent || nodeId : nodeId;

    // Ports
    var ports = content.querySelectorAll('[data-port-id^="' + CSS.escape(nodeId) + '."]');
    var inputs = [], outputs = [];
    ports.forEach(function(p) {
      var id = p.getAttribute('data-port-id');
      var dir = p.getAttribute('data-direction');
      var name = id.split('.').slice(1).join('.').replace(/:(?:input|output)$/, '');
      if (dir === 'input') inputs.push(name);
      else outputs.push(name);
    });

    // Connected paths
    var allPaths = content.querySelectorAll('path[data-source]');
    var connectedNodes = new Set();
    allPaths.forEach(function(p) {
      var src = p.getAttribute('data-source') || '';
      var tgt = p.getAttribute('data-target') || '';
      var srcNode = src.split('.')[0];
      var tgtNode = tgt.split('.')[0];
      if (srcNode === nodeId || tgtNode === nodeId) {
        if (srcNode !== nodeId) connectedNodes.add(srcNode);
        if (tgtNode !== nodeId) connectedNodes.add(tgtNode);
        p.classList.remove('dimmed');
      } else {
        p.classList.add('dimmed');
      }
    });

    // Build info panel
    infoTitle.textContent = labelText;
    var html = '';
    var src = nodeSources[nodeId];
    if (src && src.description) {
      html += '<div class="node-desc">' + escapeH(src.description) + '</div>';
    }
    var portInfo = (src && src.ports) ? src.ports : {};
    function portLabel(name) {
      var p = portInfo[name];
      var label = escapeH(name);
      if (p) {
        var typeStr = p.tsType || p.type;
        if (typeStr) label += ' <span class="port-type">' + escapeH(typeStr) + '</span>';
      }
      return label;
    }
    if (inputs.length) {
      html += '<div class="info-section"><div class="info-label">Inputs</div><ul class="port-list">';
      inputs.forEach(function(n) { html += '<li>' + portLabel(n) + '</li>'; });
      html += '</ul></div>';
    }
    if (outputs.length) {
      html += '<div class="info-section"><div class="info-label">Outputs</div><ul class="port-list">';
      outputs.forEach(function(n) { html += '<li>' + portLabel(n) + '</li>'; });
      html += '</ul></div>';
    }
    if (connectedNodes.size) {
      html += '<div class="info-section"><div class="info-label">Connected to</div><div class="info-value">';
      html += Array.from(connectedNodes).map(escapeH).join(', ');
      html += '</div></div>';
    }
    if (src && src.source) {
      html += '<div class="info-section"><div class="info-label">Source</div>';
      html += '<pre><code>' + highlightTS(src.source) + '</code></pre></div>';
    }
    infoBody.innerHTML = html;
    infoPanel.classList.add('visible');
  }

  function escapeH(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  var fwAnnotations = 'flowWeaver,input,output,step,node,connect,param,returns,fwImport,label,scope,position,color,icon,tag,map,path,name,description,expression,executeWhen,pullExecution,strictTypes,autoConnect,port,trigger,cancelOn,retries,timeout,throttle';

  function highlightJSDoc(block) {
    var annSet = fwAnnotations.split(',');
    var out = '';
    var re = /(@[a-zA-Z]+)|(-&gt;)|(\\.[a-zA-Z_][a-zA-Z0-9_]*)|("[^"]*")|('\\''[^'\\'']*'\\'')|(-?[0-9]+(?:\\.[0-9]+)?)|([a-zA-Z_][a-zA-Z0-9_]*)|([^@a-zA-Z0-9"'\\-.]+)/g;
    var m;
    while ((m = re.exec(block)) !== null) {
      if (m[1]) {
        var tag = m[1].slice(1);
        if (annSet.indexOf(tag) >= 0) {
          out += '<span class="hl-ann">' + m[0] + '</span>';
        } else {
          out += '<span class="hl-ann">' + m[0] + '</span>';
        }
      } else if (m[2]) {
        out += '<span class="hl-arr">' + m[2] + '</span>';
      } else if (m[3]) {
        // .portName scope reference
        out += '<span class="hl-sc">' + m[3] + '</span>';
      } else if (m[4] || m[5]) {
        out += '<span class="hl-str">' + (m[4] || m[5]) + '</span>';
      } else if (m[6]) {
        out += '<span class="hl-num">' + m[6] + '</span>';
      } else if (m[7]) {
        var tys = 'string,number,boolean,any,void,never,unknown,STEP,STRING,NUMBER,BOOLEAN,ARRAY,OBJECT,FUNCTION,ANY';
        if (tys.split(',').indexOf(m[7]) >= 0) {
          out += '<span class="hl-ty">' + m[7] + '</span>';
        } else {
          out += '<span class="hl-id">' + m[7] + '</span>';
        }
      } else {
        out += m[0];
      }
    }
    return out;
  }

  function highlightTS(code) {
    var tokens = [];
    var i = 0;
    while (i < code.length) {
      // Line comments
      if (code[i] === '/' && code[i+1] === '/') {
        var end = code.indexOf('\\n', i);
        if (end === -1) end = code.length;
        tokens.push({ t: 'cm', v: code.slice(i, end) });
        i = end;
        continue;
      }
      // Block comments (detect JSDoc for annotation highlighting)
      if (code[i] === '/' && code[i+1] === '*') {
        var end = code.indexOf('*/', i + 2);
        if (end === -1) end = code.length; else end += 2;
        var block = code.slice(i, end);
        var hasFW = /@(flowWeaver|input|output|step|node|connect|param|returns)/.test(block);
        if (hasFW) {
          tokens.push({ t: 'jsdoc', v: block });
        } else {
          tokens.push({ t: 'cm', v: block });
        }
        i = end;
        continue;
      }
      // Strings
      if (code[i] === "'" || code[i] === '"' || code[i] === '\`') {
        var q = code[i], j = i + 1;
        while (j < code.length && code[j] !== q) { if (code[j] === '\\\\') j++; j++; }
        tokens.push({ t: 'str', v: code.slice(i, j + 1) });
        i = j + 1;
        continue;
      }
      // Numbers
      if (/[0-9]/.test(code[i]) && (i === 0 || /[^a-zA-Z_$]/.test(code[i-1]))) {
        var j = i;
        while (j < code.length && /[0-9a-fA-FxX._]/.test(code[j])) j++;
        tokens.push({ t: 'num', v: code.slice(i, j) });
        i = j;
        continue;
      }
      // Words
      if (/[a-zA-Z_$]/.test(code[i])) {
        var j = i;
        while (j < code.length && /[a-zA-Z0-9_$]/.test(code[j])) j++;
        var w = code.slice(i, j);
        var kws = 'async,await,break,case,catch,class,const,continue,default,delete,do,else,export,extends,finally,for,from,function,if,import,in,instanceof,let,new,of,return,switch,throw,try,typeof,var,void,while,yield';
        var tys = 'string,number,boolean,any,void,never,unknown,null,undefined,true,false,Promise,Record,Map,Set,Array,Partial,Required,Omit,Pick';
        if (kws.split(',').indexOf(w) >= 0) {
          tokens.push({ t: 'kw', v: w });
        } else if (tys.split(',').indexOf(w) >= 0) {
          tokens.push({ t: 'ty', v: w });
        } else if (j < code.length && code[j] === '(') {
          tokens.push({ t: 'fn', v: w });
        } else {
          tokens.push({ t: '', v: w });
        }
        i = j;
        continue;
      }
      // Punctuation
      if (/[{}()\\[\\];:.,<>=!&|?+\\-*/%^~@]/.test(code[i])) {
        tokens.push({ t: 'pn', v: code[i] });
        i++;
        continue;
      }
      // Whitespace and other
      tokens.push({ t: '', v: code[i] });
      i++;
    }
    return tokens.map(function(tk) {
      if (tk.t === 'jsdoc') {
        return '<span class="hl-cm">' + highlightJSDoc(escapeH(tk.v)) + '</span>';
      }
      var v = escapeH(tk.v);
      return tk.t ? '<span class="hl-' + tk.t + '">' + v + '</span>' : v;
    }).join('');
  }

  // Delegate click: port click > node click > background
  // Use clickTarget (stashed from pointerdown) because setPointerCapture redirects click to canvas
  canvas.addEventListener('click', function(e) {
    if (didDrag || didDragNode) { didDragNode = false; return; }
    var target = clickTarget || e.target;
    clickTarget = null;
    while (target && target !== canvas) {
      if (target.hasAttribute && target.hasAttribute('data-port-id')) {
        e.stopPropagation();
        selectPort(target.getAttribute('data-port-id'));
        return;
      }
      if (target.hasAttribute && target.hasAttribute('data-node-id')) {
        e.stopPropagation();
        deselectPort();
        selectNode(target.getAttribute('data-node-id'));
        return;
      }
      target = target.parentElement;
    }
    deselectPort();
    deselectNode();
  });

  // ---- Panel expand/collapse ----
  btnExpand.addEventListener('click', function(e) {
    e.stopPropagation();
    infoPanel.classList.toggle('fullscreen');
    btnExpand.innerHTML = infoPanel.classList.contains('fullscreen') ? collapseIcon : expandIcon;
    btnExpand.title = infoPanel.classList.contains('fullscreen') ? 'Collapse panel' : 'Expand panel';
  });
  btnClosePanel.addEventListener('click', function(e) {
    e.stopPropagation();
    deselectPort();
    deselectNode();
    infoPanel.classList.remove('fullscreen');
    btnExpand.innerHTML = expandIcon;
  });

  // ---- Init ----
  requestAnimationFrame(fitToView);
  window.addEventListener('resize', fitToView);
})();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
