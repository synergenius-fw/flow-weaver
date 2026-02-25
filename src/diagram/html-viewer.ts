/**
 * HTML Viewer — wraps an SVG diagram in a self-contained interactive HTML page.
 *
 * Provides zoom/pan, fit-to-view, hover effects, click-to-inspect, and connection tracing.
 * No external dependencies — works standalone or inside an iframe.
 */

export interface HtmlViewerOptions {
  title?: string;
  theme?: 'dark' | 'light';
}

/** Strip the SVG background rects so the HTML page controls the background. */
function stripSvgBackground(svg: string): string {
  let result = svg.replace(/<pattern\s+id="dot-grid"[^>]*>[\s\S]*?<\/pattern>/g, '');
  result = result.replace(/<rect[^>]*fill="url\(#dot-grid\)"[^>]*\/>/g, '');
  // Remove the solid background rect (first rect after </defs>)
  result = result.replace(/(<\/defs>\n)<rect[^>]*\/>\n/, '$1');
  return result;
}

export function wrapSVGInHTML(svgContent: string, options: HtmlViewerOptions = {}): string {
  const title = options.title ?? 'Workflow Diagram';
  const theme = options.theme ?? 'dark';
  const svg = stripSvgBackground(svgContent);

  const isDark = theme === 'dark';
  const bg = isDark ? '#202139' : '#f6f7ff';
  const dotColor = isDark ? 'rgba(142, 158, 255, 0.6)' : 'rgba(84, 104, 255, 0.6)';
  const surfaceMain = isDark ? '#1a1a2e' : '#ffffff';
  const borderSubtle = isDark ? '#313143' : '#e6e6e6';
  const textHigh = isDark ? '#e8e8ee' : '#1a1a2e';
  const textMed = isDark ? '#babac0' : '#606060';
  const textLow = isDark ? '#767682' : '#999999';
  const surfaceHigh = isDark ? '#313143' : '#f0f0f5';

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
  background: ${bg};
  font-family: Montserrat, 'Segoe UI', Roboto, sans-serif;
  color: ${textHigh};
}

#viewport {
  width: 100%; height: 100%;
  overflow: hidden; cursor: grab;
  touch-action: none; user-select: none;
  background-image: radial-gradient(circle, ${dotColor} 7.5%, transparent 7.5%);
  background-size: 20px 20px;
}
#viewport.dragging { cursor: grabbing; }

#content {
  transform-origin: 0 0;
  will-change: transform;
}
#content svg { display: block; width: auto; height: auto; }

/* Port labels: hidden by default, shown on node hover */
.nodes > g .port-label,
.nodes > g .port-type-label,
.labels g[data-port-label] {
  opacity: 0; pointer-events: none;
  transition: opacity 0.15s ease-in-out;
}
/* Show port labels for hovered node */
.nodes > g:hover ~ .show-port-labels .port-label,
.nodes > g:hover ~ .show-port-labels .port-type-label { opacity: 1; }

/* Connection hover & dimming */
.connections path { transition: opacity 0.2s ease, stroke-width 0.15s ease; }
.connections path:hover { stroke-width: 4; cursor: pointer; }
body.node-active .connections path.dimmed { opacity: 0.15; }

/* Node hover glow */
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
  position: fixed; bottom: 16px; left: 16px;
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
</style>
</head>
<body>
<div id="viewport">
  <div id="content">${svg}</div>
</div>
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
</div>
<div id="info-panel">
  <h3 id="info-title"></h3>
  <div id="info-body"></div>
</div>
<div id="scroll-hint">Use <kbd id="mod-key">Ctrl</kbd> + scroll to zoom</div>
<script>
(function() {
  'use strict';

  var MIN_ZOOM = 0.25, MAX_ZOOM = 3, GRID_SIZE = 20;
  var viewport = document.getElementById('viewport');
  var content = document.getElementById('content');
  var zoomLabel = document.getElementById('zoom-label');
  var infoPanel = document.getElementById('info-panel');
  var infoTitle = document.getElementById('info-title');
  var infoBody = document.getElementById('info-body');
  var scrollHint = document.getElementById('scroll-hint');

  var scale = 1, tx = 0, ty = 0;
  var dragging = false, dragLast = { x: 0, y: 0 };
  var selectedNodeId = null;
  var hintTimer = null;

  // Detect Mac for modifier key
  var isMac = /Mac/.test(navigator.userAgent);
  document.getElementById('mod-key').textContent = isMac ? '\\u2318' : 'Ctrl';

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  function applyTransform() {
    content.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
    viewport.style.backgroundSize = (GRID_SIZE * scale) + 'px ' + (GRID_SIZE * scale) + 'px';
    viewport.style.backgroundPosition = tx + 'px ' + ty + 'px';
    zoomLabel.textContent = Math.round(scale * 100) + '%';
  }

  function fitToView() {
    var svgEl = content.querySelector('svg');
    if (!svgEl) { scale = 1; tx = 0; ty = 0; applyTransform(); return; }
    var ww = viewport.clientWidth, wh = viewport.clientHeight;
    var sw = svgEl.width.baseVal.value || svgEl.getBoundingClientRect().width;
    var sh = svgEl.height.baseVal.value || svgEl.getBoundingClientRect().height;
    var padding = 60;
    var fitScale = Math.min((ww - padding) / sw, (wh - padding) / sh, 1);
    scale = fitScale;
    tx = (ww - sw * fitScale) / 2;
    ty = (wh - sh * fitScale) / 2;
    applyTransform();
  }

  // ---- Zoom (Ctrl/Cmd + scroll) ----
  viewport.addEventListener('wheel', function(e) {
    if (!e.ctrlKey && !e.metaKey) {
      scrollHint.classList.add('visible');
      clearTimeout(hintTimer);
      hintTimer = setTimeout(function() { scrollHint.classList.remove('visible'); }, 1500);
      return;
    }
    e.preventDefault();
    var rect = viewport.getBoundingClientRect();
    var cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    var oldScale = scale;
    var delta = clamp(e.deltaY, -10, 10);
    var newScale = clamp(oldScale - delta * 0.005, MIN_ZOOM, MAX_ZOOM);
    var contentX = (cx - tx) / oldScale, contentY = (cy - ty) / oldScale;
    tx = cx - contentX * newScale;
    ty = cy - contentY * newScale;
    scale = newScale;
    applyTransform();
  }, { passive: false });

  // ---- Pan (drag) ----
  viewport.addEventListener('pointerdown', function(e) {
    if (e.button !== 0) return;
    dragging = true;
    dragLast = { x: e.clientX, y: e.clientY };
    viewport.setPointerCapture(e.pointerId);
    viewport.classList.add('dragging');
  });
  viewport.addEventListener('pointermove', function(e) {
    if (!dragging) return;
    tx += e.clientX - dragLast.x;
    ty += e.clientY - dragLast.y;
    dragLast = { x: e.clientX, y: e.clientY };
    applyTransform();
  });
  function endDrag() { dragging = false; viewport.classList.remove('dragging'); }
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);

  // ---- Zoom buttons ----
  function zoomBy(dir) {
    var rect = viewport.getBoundingClientRect();
    var cx = rect.width / 2, cy = rect.height / 2;
    var oldScale = scale;
    var newScale = clamp(oldScale + dir * 0.15 * oldScale, MIN_ZOOM, MAX_ZOOM);
    var contentX = (cx - tx) / oldScale, contentY = (cy - ty) / oldScale;
    tx = cx - contentX * newScale;
    ty = cy - contentY * newScale;
    scale = newScale;
    applyTransform();
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
    else if (e.key === 'Escape') deselectNode();
  });

  // ---- Port label visibility ----
  var labelMap = {};
  content.querySelectorAll('.labels g[data-port-label]').forEach(function(lbl) {
    labelMap[lbl.getAttribute('data-port-label')] = lbl;
  });

  // Build adjacency: portId → array of connected portIds
  var portConnections = {};
  content.querySelectorAll('.connections path').forEach(function(p) {
    var src = p.getAttribute('data-source');
    var tgt = p.getAttribute('data-target');
    if (!src || !tgt) return;
    if (!portConnections[src]) portConnections[src] = [];
    if (!portConnections[tgt]) portConnections[tgt] = [];
    portConnections[src].push(tgt);
    portConnections[tgt].push(src);
  });

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
      if (hoveredPort) return; // port hover takes priority
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
      // Hide all labels for this node first, then show only the relevant ones
      hideLabelsFor(nodeId);
      peers.forEach(showLabel);
    });
    portEl.addEventListener('mouseleave', function() {
      hoveredPort = null;
      peers.forEach(hideLabel);
      // Restore all labels for the node since we're still inside it
      showLabelsFor(nodeId);
    });
  });

  // ---- Click to inspect node ----
  function deselectNode() {
    selectedNodeId = null;
    document.body.classList.remove('node-active');
    infoPanel.classList.remove('visible');
    content.querySelectorAll('.connections path.dimmed').forEach(function(p) {
      p.classList.remove('dimmed');
    });
  }

  function selectNode(nodeId) {
    if (selectedNodeId === nodeId) { deselectNode(); return; }
    selectedNodeId = nodeId;
    document.body.classList.add('node-active');

    // Gather info
    var nodeG = content.querySelector('[data-node-id="' + CSS.escape(nodeId) + '"]');
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
    var allPaths = content.querySelectorAll('.connections path');
    var connectedPaths = [];
    var connectedNodes = new Set();
    allPaths.forEach(function(p) {
      var src = p.getAttribute('data-source') || '';
      var tgt = p.getAttribute('data-target') || '';
      var srcNode = src.split('.')[0];
      var tgtNode = tgt.split('.')[0];
      if (srcNode === nodeId || tgtNode === nodeId) {
        connectedPaths.push(p);
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

  // Delegate click on node groups
  viewport.addEventListener('click', function(e) {
    if (dragging) return;
    var target = e.target;
    // Walk up to find a [data-node-id] ancestor within #content
    while (target && target !== viewport) {
      if (target.hasAttribute && target.hasAttribute('data-node-id')) {
        e.stopPropagation();
        selectNode(target.getAttribute('data-node-id'));
        return;
      }
      target = target.parentElement;
    }
    // Clicked on background
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
