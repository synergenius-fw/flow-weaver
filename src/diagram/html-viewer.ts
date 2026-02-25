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
  const dotColor = isDark ? 'rgba(142, 158, 255, 0.6)' : 'rgba(84, 104, 255, 0.6)';
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
.nodes g[data-node-id]:hover > rect:first-of-type { filter: brightness(1.08); }

/* Zoom controls */
#controls {
  position: fixed; bottom: 16px; right: 16px;
  display: flex; align-items: center; gap: 2px;
  background: ${surfaceMain}; border: 1px solid ${borderSubtle};
  border-radius: 8px; padding: 4px; z-index: 10;
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
}
.ctrl-btn {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border: none; border-radius: 6px;
  background: transparent; color: ${textMed};
  font-size: 16px; font-weight: 600; cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.ctrl-btn:hover { background: ${surfaceHigh}; color: ${textHigh}; }
#zoom-label {
  font-size: 11px; font-family: 'SF Mono', 'Fira Code', monospace;
  color: ${textLow}; min-width: 36px; text-align: center;
}

/* Info panel */
#info-panel {
  position: fixed; bottom: 52px; left: 16px;
  max-width: 320px; min-width: 200px;
  background: ${surfaceMain}; border: 1px solid ${borderSubtle};
  border-radius: 8px; padding: 12px 16px;
  font-size: 13px; line-height: 1.5;
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  z-index: 10; display: none;
}
#info-panel.visible { display: block; }
#info-panel h3 {
  font-size: 14px; font-weight: 700; margin-bottom: 6px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#info-panel .info-section { margin-bottom: 6px; }
#info-panel .info-label { font-size: 11px; font-weight: 600; color: ${textLow}; text-transform: uppercase; letter-spacing: 0.5px; }
#info-panel .info-value { color: ${textMed}; }
#info-panel .port-list { list-style: none; padding: 0; }
#info-panel .port-list li { padding: 1px 0; }
#info-panel .port-list li::before { content: '\\2022'; margin-right: 6px; color: ${textLow}; }

/* Branding badge */
#branding {
  position: fixed; bottom: 16px; left: 16px;
  display: flex; align-items: center; gap: 6px;
  background: ${surfaceMain}; border: 1px solid ${borderSubtle};
  border-radius: 8px; padding: 6px 12px;
  font-size: 12px; font-weight: 600; color: ${textMed};
  text-decoration: none; z-index: 9;
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  transition: color 0.15s, border-color 0.15s;
}
#branding:hover { color: ${textHigh}; border-color: ${textLow}; }

/* Scroll hint */
#scroll-hint {
  position: fixed; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(0,0,0,0.75); color: #fff;
  padding: 6px 14px; border-radius: 8px;
  font-size: 13px; pointer-events: none;
  z-index: 20; opacity: 0; transition: opacity 0.3s;
}
#scroll-hint.visible { opacity: 1; }
#scroll-hint kbd {
  display: inline-block; padding: 1px 5px;
  border: 1px solid rgba(255,255,255,0.3);
  border-radius: 3px; font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 12px; background: rgba(255,255,255,0.1);
}

/* Studio nudge toast */
#studio-hint {
  position: fixed; bottom: 60px; left: 50%;
  transform: translateX(-50%);
  background: ${surfaceMain}; border: 1px solid ${borderSubtle};
  padding: 8px 16px; border-radius: 8px;
  font-size: 13px; color: ${textMed};
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  z-index: 20; opacity: 0; transition: opacity 0.4s;
  pointer-events: none;
}
#studio-hint.visible { opacity: 1; pointer-events: auto; }
#studio-hint a { color: ${brandAccent}; text-decoration: none; font-weight: 600; }
#studio-hint a:hover { text-decoration: underline; }
</style>
</head>
<body>
<svg id="canvas" xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">
  <defs>
    <pattern id="viewer-dots" width="20" height="20" patternUnits="userSpaceOnUse">
      <circle cx="10" cy="10" r="1.5" fill="${dotColor}" opacity="0.6"/>
    </pattern>
  </defs>
  <rect x="-100000" y="-100000" width="200000" height="200000" fill="${bg}"/>
  <rect x="-100000" y="-100000" width="200000" height="200000" fill="url(#viewer-dots)"/>
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
  <h3 id="info-title"></h3>
  <div id="info-body"></div>
</div>
<a id="branding" href="https://flowweaver.ai" target="_blank" rel="noopener">
  <svg width="16" height="16" viewBox="0 0 256 256" fill="none"><path d="M80 128C134 128 122 49 176 49" stroke="${brandAccent}" stroke-width="14" stroke-linecap="round"/><path d="M80 128C134 128 122 207 176 207" stroke="${brandAccent}" stroke-width="14" stroke-linecap="round"/><rect x="28" y="102" width="52" height="52" rx="10" stroke="${brandAccent}" stroke-width="14"/><rect x="176" y="23" width="52" height="52" rx="10" stroke="${brandAccent}" stroke-width="14"/><rect x="176" y="181" width="52" height="52" rx="10" stroke="${brandAccent}" stroke-width="14"/></svg>
  <span>Flow Weaver</span>
</a>
<div id="scroll-hint">Use <kbd id="mod-key">Ctrl</kbd> + scroll to zoom</div>
<div id="studio-hint">Like rearranging? <a href="https://flowweaver.ai" target="_blank" rel="noopener">Flow Weaver Studio</a> saves your layouts.</div>
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
  var scrollHint = document.getElementById('scroll-hint');
  var studioHint = document.getElementById('studio-hint');

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
    didDrag = false;
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

  // ---- Connection path computation (from geometry.ts) ----
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

  // ---- Port position + connection path indexes ----
  var portPositions = {};
  content.querySelectorAll('[data-port-id]').forEach(function(el) {
    var id = el.getAttribute('data-port-id');
    portPositions[id] = { cx: parseFloat(el.getAttribute('cx')), cy: parseFloat(el.getAttribute('cy')) };
  });

  var nodeOffsets = {};
  var connIndex = [];
  content.querySelectorAll('path[data-source]').forEach(function(p) {
    var src = p.getAttribute('data-source'), tgt = p.getAttribute('data-target');
    connIndex.push({ el: p, src: src, tgt: tgt, srcNode: src.split('.')[0], tgtNode: tgt.split('.')[0], scopeOf: p.getAttribute('data-scope') || null });
  });

  // Snapshot of original port positions for reset
  var origPortPositions = {};
  for (var pid in portPositions) {
    origPortPositions[pid] = { cx: portPositions[pid].cx, cy: portPositions[pid].cy };
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
    connIndex.forEach(function(c) {
      var sp = portPositions[c.src], tp = portPositions[c.tgt];
      if (sp && tp) c.el.setAttribute('d', computeConnectionPath(sp.cx, sp.cy, tp.cx, tp.cy));
    });
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

    // Recalculate affected connection paths (skip scope connections when parent is dragged — they move with the group transform)
    connIndex.forEach(function(c) {
      if (c.scopeOf === nodeId) return;
      if (c.srcNode === nodeId || c.tgtNode === nodeId) {
        var sp = portPositions[c.src], tp = portPositions[c.tgt];
        if (sp && tp) {
          if (c.scopeOf) {
            // Scope connection paths live inside the parent group; use parent-local coords
            var pOff = nodeOffsets[c.scopeOf] || { dx: 0, dy: 0 };
            c.el.setAttribute('d', computeConnectionPath(sp.cx - pOff.dx, sp.cy - pOff.dy, tp.cx - pOff.dx, tp.cy - pOff.dy));
          } else {
            c.el.setAttribute('d', computeConnectionPath(sp.cx, sp.cy, tp.cx, tp.cy));
          }
        }
      }
      if (nodeG) {
        var children = nodeG.querySelectorAll(':scope > g[data-node-id]');
        children.forEach(function(childG) {
          var childId = childG.getAttribute('data-node-id');
          if (c.srcNode === childId || c.tgtNode === childId) {
            var sp = portPositions[c.src], tp = portPositions[c.tgt];
            if (sp && tp) {
              if (c.scopeOf) {
                var pOff = nodeOffsets[c.scopeOf] || { dx: 0, dy: 0 };
                c.el.setAttribute('d', computeConnectionPath(sp.cx - pOff.dx, sp.cy - pOff.dy, tp.cx - pOff.dx, tp.cy - pOff.dy));
              } else {
                c.el.setAttribute('d', computeConnectionPath(sp.cx, sp.cy, tp.cx, tp.cy));
              }
            }
          }
        });
      }
    });
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
    if (inputs.length) {
      html += '<div class="info-section"><div class="info-label">Inputs</div><ul class="port-list">';
      inputs.forEach(function(n) { html += '<li>' + escapeH(n) + '</li>'; });
      html += '</ul></div>';
    }
    if (outputs.length) {
      html += '<div class="info-section"><div class="info-label">Outputs</div><ul class="port-list">';
      outputs.forEach(function(n) { html += '<li>' + escapeH(n) + '</li>'; });
      html += '</ul></div>';
    }
    if (connectedNodes.size) {
      html += '<div class="info-section"><div class="info-label">Connected to</div><div class="info-value">';
      html += Array.from(connectedNodes).map(escapeH).join(', ');
      html += '</div></div>';
    }
    infoBody.innerHTML = html;
    infoPanel.classList.add('visible');
  }

  function escapeH(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Delegate click: port click > node click > background
  canvas.addEventListener('click', function(e) {
    if (didDrag || didDragNode) { didDragNode = false; return; }
    var target = e.target;
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
