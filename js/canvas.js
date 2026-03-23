// js/canvas.js
import { getCanvasColors } from './favorites.js';
import { safeCssColor } from './utils.js';
import {
  getCanvasId, loadCanvas, pushStroke, setCanvasBg, watchStrokes, unwatchStrokes,
  setCanvasPresence, watchCanvasPresence, unwatchCanvasPresence,
} from './db.js';

const THICKNESS_VALUES = [0.005, 0.012, 0.025]; // thin, medium, thick
const THICKNESS_PX_LABELS = [6, 14, 24]; // visual dot sizes in toolbox

let _ctx = null;
let _canvas = null;
let _canvasId = null;
let _myUserId = null;
let _peerName = '';
let _penColor = '#22c55e';
let _thickness = THICKNESS_VALUES[1]; // default medium
let _isDrawing = false;
let _currentPoints = [];
let _onExit = null;
let _peerId = null;
let _peerColor = '#22c55e';
let _bgColor = '#0f172a';
let _allStrokes = [];
let _stripWasVisible = false;

// ─── Coordinate helpers (exported for testing) ───────────────────────────────

export function normalizePoint(px, py, cw, ch) {
  return [px / cw, py / ch];
}

export function denormalizePoint(nx, ny, cw, ch) {
  return [nx * cw, ny * ch];
}

export function getThicknessValues() {
  return [...THICKNESS_VALUES];
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function renderStroke(stroke, ctx, cw, ch) {
  const pts = stroke.points;
  if (!pts || pts.length === 0) return;
  ctx.strokeStyle = safeCssColor(stroke.color);
  ctx.lineWidth = stroke.thickness * cw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (pts.length === 1) {
    // Single point — draw a dot
    const [x0, y0] = denormalizePoint(pts[0][0], pts[0][1], cw, ch);
    ctx.beginPath();
    ctx.arc(x0, y0, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    return;
  }

  ctx.beginPath();
  const [x0, y0] = denormalizePoint(pts[0][0], pts[0][1], cw, ch);
  ctx.moveTo(x0, y0);
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = denormalizePoint(pts[i][0], pts[i][1], cw, ch);
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function clearAndRedraw(ctx, cw, ch, bgColor, strokes) {
  ctx.fillStyle = safeCssColor(bgColor) || '#0f172a';
  ctx.fillRect(0, 0, cw, ch);
  strokes.forEach(s => renderStroke(s.data || s, ctx, cw, ch));
}

// ─── Floating UI ─────────────────────────────────────────────────────────────

function buildFloatingUI(container, penColors) {
  // Combined header: < Name (dot)
  const header = document.createElement('div');
  header.className = 'canvas-float canvas-header';
  header.id = 'canvas-header';
  const safeName = document.createTextNode(_peerName).textContent;
  header.innerHTML = `<span class="canvas-header-arrow">&lsaquo;</span><span class="canvas-header-name">${safeName}</span><div class="canvas-header-dot" id="canvas-peer-dot" style="background:${safeCssColor(_peerColor)}"></div>`;
  header.addEventListener('click', () => showEndDialog(container));
  container.appendChild(header);

  // Toolbox (bottom-right)
  const toolbox = document.createElement('div');
  toolbox.className = 'canvas-float canvas-toolbox';
  toolbox.id = 'canvas-toolbox';

  // Collapsed state
  const collapsed = document.createElement('div');
  collapsed.className = 'canvas-toolbox-collapsed';
  const penIcon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>`;
  const thkIdx = THICKNESS_VALUES.indexOf(_thickness);
  const thkPx = THICKNESS_PX_LABELS[thkIdx >= 0 ? thkIdx : 1];
  collapsed.innerHTML = `${penIcon}<div class="canvas-color-ring" id="canvas-ring" style="background:${safeCssColor(_penColor)}"><div class="canvas-thickness-indicator" id="canvas-ring-thk" style="width:${thkPx}px;height:${thkPx}px"></div></div>`;
  toolbox.appendChild(collapsed);

  // Expanded state
  const expanded = document.createElement('div');
  expanded.className = 'canvas-toolbox-expanded';

  // Color row
  const colorRow = document.createElement('div');
  colorRow.className = 'canvas-colors';
  penColors.forEach(c => {
    const dot = document.createElement('div');
    dot.className = `canvas-color-dot${c === _penColor ? ' selected' : ''}`;
    dot.style.background = safeCssColor(c);
    dot.dataset.color = c;
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      _penColor = c;
      updateToolboxState(toolbox);
    });
    colorRow.appendChild(dot);
  });
  expanded.appendChild(colorRow);

  // Separator
  const sep = document.createElement('div');
  sep.className = 'canvas-toolbox-sep';
  expanded.appendChild(sep);

  // Thickness row
  const thkRow = document.createElement('div');
  thkRow.className = 'canvas-thicknesses';
  THICKNESS_VALUES.forEach((t, i) => {
    const btn = document.createElement('div');
    btn.className = `canvas-thickness-btn${t === _thickness ? ' selected' : ''}`;
    btn.style.width = THICKNESS_PX_LABELS[i] + 'px';
    btn.style.height = THICKNESS_PX_LABELS[i] + 'px';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      _thickness = t;
      updateToolboxState(toolbox);
    });
    thkRow.appendChild(btn);
  });
  expanded.appendChild(thkRow);
  toolbox.appendChild(expanded);

  // Toggle expand/collapse
  collapsed.addEventListener('click', () => toolbox.classList.add('open'));
  container.appendChild(toolbox);

  // Close on tap outside toolbox
  container.addEventListener('pointerdown', (e) => {
    if (!toolbox.contains(e.target) && toolbox.classList.contains('open')) {
      toolbox.classList.remove('open');
    }
  });
}

function updateToolboxState(toolbox) {
  const ring = toolbox.querySelector('#canvas-ring');
  if (ring) ring.style.background = safeCssColor(_penColor);
  const thk = toolbox.querySelector('#canvas-ring-thk');
  if (thk) {
    const ti = THICKNESS_VALUES.indexOf(_thickness);
    const tp = THICKNESS_PX_LABELS[ti >= 0 ? ti : 1];
    thk.style.width = tp + 'px';
    thk.style.height = tp + 'px';
  }
  toolbox.querySelectorAll('.canvas-color-dot').forEach(el => {
    el.classList.toggle('selected', el.dataset.color === _penColor);
  });
  toolbox.querySelectorAll('.canvas-thickness-btn').forEach((el, i) => {
    el.classList.toggle('selected', THICKNESS_VALUES[i] === _thickness);
  });
}

function updatePeerDot(color) {
  const dot = document.getElementById('canvas-peer-dot');
  if (dot) {
    dot.style.background = safeCssColor(color);
  }
}

export function dimPeerIndicator() {
  const header = document.getElementById('canvas-header');
  if (header) header.classList.add('dimmed');
}

// ─── Dialogs ─────────────────────────────────────────────────────────────────

function showEndDialog(container) {
  const overlay = document.createElement('div');
  overlay.className = 'canvas-dialog-overlay';
  overlay.innerHTML = `
    <div class="canvas-dialog">
      <h3>End session?</h3>
      <div class="canvas-dialog-btns">
        <button class="canvas-dialog-btn" id="canvas-end-cancel">Cancel</button>
        <button class="canvas-dialog-btn danger" id="canvas-end-confirm">End</button>
      </div>
    </div>`;
  container.appendChild(overlay);
  overlay.querySelector('#canvas-end-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#canvas-end-confirm').addEventListener('click', () => {
    overlay.remove();
    handleEnd();
  });
}

export function showPeerLeftDialog(container, peerName, onDone) {
  const overlay = document.createElement('div');
  overlay.className = 'canvas-dialog-overlay';
  const safeName = document.createTextNode(peerName).textContent;
  overlay.innerHTML = `
    <div class="canvas-dialog">
      <h3>${safeName} left</h3>
      <p>Returning to status...</p>
      <div class="canvas-dialog-btns">
        <button class="canvas-dialog-btn primary" id="canvas-left-done">Done</button>
      </div>
    </div>`;
  container.appendChild(overlay);
  overlay.querySelector('#canvas-left-done').addEventListener('click', () => {
    overlay.remove();
    onDone();
  });
}

// ─── Enter / Exit ────────────────────────────────────────────────────────────

export async function enterCanvas(peerId, peerName, myUserId, myStatusColor, peerStatusColor, callerSurface, onExit) {
  _canvasId = getCanvasId(myUserId, peerId);
  _myUserId = myUserId;
  _peerId = peerId;
  _peerName = peerName;
  _peerColor = peerStatusColor || '#22c55e';
  _penColor = myStatusColor || '#22c55e';
  _thickness = THICKNESS_VALUES[1];
  _onExit = onExit;

  const screen = document.getElementById('canvas-screen');
  _canvas = document.getElementById('draw-canvas');
  screen.classList.add('active');

  // Hide main UI
  document.getElementById('app-header').style.display = 'none';
  const strip = document.getElementById('favorites-strip');
  _stripWasVisible = strip && strip.style.display !== 'none';
  if (strip) strip.style.display = 'none';
  document.getElementById('main-list').style.display = 'none';

  // Size canvas to screen
  _canvas.width = screen.clientWidth;
  _canvas.height = screen.clientHeight;
  _ctx = _canvas.getContext('2d');

  // Load existing canvas state
  const { bg, strokes } = await loadCanvas(_canvasId);
  _bgColor = bg || callerSurface || '#0f172a';
  if (!bg) setCanvasBg(_canvasId, _bgColor).catch(() => {});

  _allStrokes = strokes;
  clearAndRedraw(_ctx, _canvas.width, _canvas.height, _bgColor, _allStrokes);

  // Get pen colors from favorites
  const { penColors } = getCanvasColors();
  if (!penColors.includes(_penColor)) penColors.unshift(_penColor);

  // Build floating UI
  buildFloatingUI(screen, penColors);

  // Watch for new strokes from peer
  const lastKey = _allStrokes.length > 0 ? _allStrokes[_allStrokes.length - 1].key : null;
  watchStrokes(_canvasId, lastKey, (entry) => {
    if (entry.data.userId !== _myUserId) {
      renderStroke(entry.data, _ctx, _canvas.width, _canvas.height);
      updatePeerDot(entry.data.color);
    }
    _allStrokes.push(entry);
  });

  // Mark self as present, watch peer presence for leave/rejoin
  setCanvasPresence(_canvasId, _myUserId, true).catch(() => {});
  let _peerSeenOnce = false;
  watchCanvasPresence(_canvasId, (presence) => {
    if (!_peerId) return;
    if (presence[_peerId] === true) {
      _peerSeenOnce = true;
      // Peer (re-)joined — undim header and dismiss any "left" dialog
      const header = document.getElementById('canvas-header');
      if (header) header.classList.remove('dimmed');
      const dialog = document.querySelector('.canvas-dialog-overlay');
      if (dialog) dialog.remove();
    }
    if (_peerSeenOnce && presence[_peerId] === false) {
      dimPeerIndicator();
      // Show "partner left" dialog
      const scr = document.getElementById('canvas-screen');
      if (scr && scr.classList.contains('active') && !scr.querySelector('.canvas-dialog-overlay')) {
        showPeerLeftDialog(scr, _peerName, () => {
          const onExit = _onExit;
          exitCanvas();
          if (onExit) onExit();
        });
      }
    }
  });

  // Prevent pinch-zoom on iOS Safari
  screen.addEventListener('gesturestart', preventZoom);
  screen.addEventListener('touchmove', preventMultiTouch, { passive: false });

  // Drawing event handlers
  _canvas.addEventListener('pointerdown', onPointerDown);
  _canvas.addEventListener('pointermove', onPointerMove);
  _canvas.addEventListener('pointerup', onPointerUp);
  _canvas.addEventListener('pointercancel', onPointerUp);
}

export function exitCanvas() {
  if (_canvasId && _myUserId) {
    setCanvasPresence(_canvasId, _myUserId, false).catch(() => {});
  }
  unwatchStrokes();
  unwatchCanvasPresence();
  const screen = document.getElementById('canvas-screen');
  if (screen) {
    screen.classList.remove('active');
    screen.querySelectorAll('.canvas-float, .canvas-dialog-overlay').forEach(el => el.remove());
    screen.removeEventListener('gesturestart', preventZoom);
    screen.removeEventListener('touchmove', preventMultiTouch);
  }

  if (_canvas) {
    _canvas.removeEventListener('pointerdown', onPointerDown);
    _canvas.removeEventListener('pointermove', onPointerMove);
    _canvas.removeEventListener('pointerup', onPointerUp);
    _canvas.removeEventListener('pointercancel', onPointerUp);
  }

  // Show main UI
  document.getElementById('app-header').style.display = '';
  const strip = document.getElementById('favorites-strip');
  if (strip) strip.style.display = _stripWasVisible ? 'block' : 'none';
  document.getElementById('main-list').style.display = '';

  _ctx = null;
  _canvas = null;
  _canvasId = null;
  _peerId = null;
  _allStrokes = [];
}

function handleEnd() {
  const onExit = _onExit;
  exitCanvas();
  if (onExit) onExit();
}

// ─── Zoom prevention ────────────────────────────────────────────────────────

function preventZoom(e) { e.preventDefault(); }
function preventMultiTouch(e) { if (e.touches.length > 1) e.preventDefault(); }

// ─── Pointer event handlers ──────────────────────────────────────────────────

function onPointerDown(e) {
  // Don't start drawing if a floating UI element was tapped
  const screen = document.getElementById('canvas-screen');
  if (e.target !== _canvas && screen && screen.querySelector('.canvas-float')?.contains(e.target)) return;

  _isDrawing = true;
  const rect = _canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const [nx, ny] = normalizePoint(px, py, _canvas.width, _canvas.height);
  _currentPoints = [[nx, ny]];

  _ctx.strokeStyle = safeCssColor(_penColor);
  _ctx.lineWidth = _thickness * _canvas.width;
  _ctx.lineCap = 'round';
  _ctx.lineJoin = 'round';
  _ctx.beginPath();
  _ctx.moveTo(px, py);
}

function onPointerMove(e) {
  if (!_isDrawing) return;
  const rect = _canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const [nx, ny] = normalizePoint(px, py, _canvas.width, _canvas.height);
  _currentPoints.push([nx, ny]);
  _ctx.lineTo(px, py);
  _ctx.stroke();
  _ctx.beginPath();
  _ctx.moveTo(px, py);
}

function onPointerUp() {
  if (!_isDrawing) return;
  _isDrawing = false;
  if (_currentPoints.length === 0) return;

  const stroke = {
    userId: _myUserId,
    color: safeCssColor(_penColor),
    thickness: _thickness,
    tool: 'pen',
    points: _currentPoints,
    timestamp: Date.now(),
  };

  // Render locally (handles taps that had no pointermove, and ensures final state)
  renderStroke(stroke, _ctx, _canvas.width, _canvas.height);
  pushStroke(_canvasId, stroke).catch(() => {});
  _currentPoints = [];
}
