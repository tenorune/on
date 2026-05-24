// js/canvas.js
import { getCanvasColors } from './favorites.js';
import { safeCssColor } from './utils.js';
import {
  getCanvasId, loadCanvas, pushStroke, removeStroke, setCanvasBg, watchStrokes, unwatchStrokes,
  setCanvasPresence, watchCanvasPresence, unwatchCanvasPresence,
  watchCanvasBg, unwatchCanvasBg,
  setDrawingState, watchDrawing, unwatchDrawing,
  setClearRequest, removeClearRequest, clearAllStrokes, watchClearRequest, unwatchClearRequest,
} from './db.js';

const THICKNESS_VALUES = [0.002, 0.005, 0.01, 0.018, 0.03, 0.05];
const THICKNESS_PX_LABELS = [3, 6, 10, 16, 22, 30]; // visual dot sizes in toolbox

let _ctx = null;
let _canvas = null;
let _canvasId = null;
let _myUserId = null;
let _peerName = '';
let _penColor = '#22c55e';
let _thickness = THICKNESS_VALUES[2]; // default medium
let _isDrawing = false;
let _currentPoints = [];
let _onExit = null;
let _peerId = null;
let _peerColor = '#22c55e';
let _bgColor = '#0f172a';
let _allStrokes = [];
let _undoStack = []; // my stroke keys, max 8
const MAX_UNDO = 8;
let _lastDrawingSend = 0;
let _absentTimerRefRef = null;
const DRAWING_THROTTLE = 80; // ms between live drawing updates
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

function buildFloatingUI(container, penColors, bgColors) {
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

  // Row 1: Thickness slider
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
  // Swipe/drag across thickness dots acts as a slider
  let _thkDragging = false;
  thkRow.addEventListener('pointerdown', (e) => {
    _thkDragging = true;
    selectThicknessAtX(e, thkRow, toolbox);
    e.stopPropagation();
  });
  thkRow.addEventListener('pointermove', (e) => {
    if (!_thkDragging) return;
    selectThicknessAtX(e, thkRow, toolbox);
  });
  thkRow.addEventListener('pointerup', () => { _thkDragging = false; });
  thkRow.addEventListener('pointercancel', () => { _thkDragging = false; });
  expanded.appendChild(thkRow);

  const sep1 = document.createElement('div');
  sep1.className = 'canvas-toolbox-sep';
  expanded.appendChild(sep1);

  // Helper: build a row of pen color dots
  function makePenRow(colors) {
    const row = document.createElement('div');
    row.className = 'canvas-colors';
    colors.forEach(c => {
      const dot = document.createElement('div');
      dot.className = `canvas-color-dot${c === _penColor ? ' selected' : ''}`;
      dot.style.background = safeCssColor(c);
      dot.dataset.color = c;
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        _penColor = c;
        updateToolboxState(toolbox);
        broadcastPenColor();
      });
      row.appendChild(dot);
    });
    return row;
  }

  // Helper: build a row of bg color squares
  function makeBgRow(colors) {
    const row = document.createElement('div');
    row.className = 'canvas-colors canvas-bg-colors';
    colors.forEach(c => {
      const dot = document.createElement('div');
      dot.className = `canvas-color-dot canvas-bg-dot${c === _bgColor ? ' selected' : ''}`;
      dot.style.background = safeCssColor(c);
      dot.style.border = '2px solid rgba(255,255,255,0.18)';
      dot.dataset.color = c;
      if (c === _bgColor) dot.style.borderColor = '#fff';
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        _bgColor = c;
        clearAndRedraw(_ctx, _canvas.width, _canvas.height, _bgColor, _allStrokes);
        setCanvasBg(_canvasId, c).catch(() => {});
        updateToolboxState(toolbox);
      });
      row.appendChild(dot);
    });
    return row;
  }

  // Rows 2+: pen colors (rows of 4), then bg colors (rows of 4)
  const penRow1 = penColors.slice(0, 4);
  const penRow2 = penColors.slice(4);
  const bgRow1 = bgColors.slice(0, 4);
  const bgRow2 = bgColors.slice(4);

  expanded.appendChild(makePenRow(penRow1));
  if (penRow2.length > 0) expanded.appendChild(makePenRow(penRow2));
  expanded.appendChild(makeBgRow(bgRow1));
  if (bgRow2.length > 0) expanded.appendChild(makeBgRow(bgRow2));

  // Clear button
  const clearSep = document.createElement('div');
  clearSep.className = 'canvas-toolbox-sep';
  expanded.appendChild(clearSep);
  const clearBtn = document.createElement('div');
  clearBtn.className = 'canvas-clear-btn';
  clearBtn.textContent = 'Clear';
  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toolbox.classList.remove('open');
    requestClearCanvas();
  });
  expanded.appendChild(clearBtn);

  toolbox.appendChild(expanded);

  // Toggle expand/collapse
  collapsed.addEventListener('click', () => {
    animateToolbox(toolbox, true);
    checkUndoOverlap(toolbox);
  });
  container.appendChild(toolbox);

  // Close on tap outside toolbox — suppress the draw that would otherwise start
  container.addEventListener('pointerdown', (e) => {
    if (!toolbox.contains(e.target) && toolbox.classList.contains('open')) {
      animateToolbox(toolbox, false);
      const undo = document.getElementById('canvas-undo');
      if (undo) undo.style.display = '';
      e.stopPropagation();
      _isDrawing = false;
    }
  }, true);

  // Undo button (bottom-left)
  const undoBtn = document.createElement('div');
  undoBtn.className = 'canvas-float canvas-undo-btn';
  undoBtn.id = 'canvas-undo';
  undoBtn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="2"><path d="M3 10h10a5 5 0 0 1 0 10H9"/><polyline points="7 14 3 10 7 6"/></svg>`;
  undoBtn.addEventListener('click', handleUndo);
  container.appendChild(undoBtn);
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
  toolbox.querySelectorAll('.canvas-color-dot:not(.canvas-bg-dot)').forEach(el => {
    el.classList.toggle('selected', el.dataset.color === _penColor);
  });
  toolbox.querySelectorAll('.canvas-bg-dot').forEach(el => {
    el.style.borderColor = el.dataset.color === _bgColor ? '#fff' : 'rgba(255,255,255,0.18)';
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
  _thickness = THICKNESS_VALUES[2];
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

  // Get pen and bg colors from favorites
  const { penColors, bgColors } = getCanvasColors();
  if (!penColors.includes(_penColor)) penColors.unshift(_penColor);
  if (!bgColors.includes(_bgColor)) bgColors.unshift(_bgColor);

  // Build floating UI
  buildFloatingUI(screen, penColors, bgColors);

  // Watch for new strokes from peer
  const lastKey = _allStrokes.length > 0 ? _allStrokes[_allStrokes.length - 1].key : null;
  watchStrokes(_canvasId, lastKey, (entry) => {
    if (entry.data.userId !== _myUserId) {
      renderStroke(entry.data, _ctx, _canvas.width, _canvas.height);
      updatePeerDot(entry.data.color);
    }
    _allStrokes.push(entry);
  }, (removedKey) => {
    // Peer undid a stroke — remove from local list and redraw
    _allStrokes = _allStrokes.filter(s => s.key !== removedKey);
    clearAndRedraw(_ctx, _canvas.width, _canvas.height, _bgColor, _allStrokes);
  });

  // Watch clear requests from peer
  watchClearRequest(_canvasId, (requesterId) => {
    if (requesterId && requesterId !== _myUserId) {
      showClearApprovalDialog(requesterId);
    } else if (requesterId === null) {
      // Clear request was cancelled or completed — dismiss any waiting dialog
      const dialog = document.querySelector('.canvas-dialog-overlay');
      if (dialog) dialog.remove();
      // If strokes were cleared, the onChildRemoved handlers will redraw
    }
  });

  // Watch peer's live drawing (mid-stroke preview + pen color selection)
  watchDrawing(_canvasId, peerId, (drawingData) => {
    if (!drawingData) return;
    if (drawingData.color) updatePeerDot(drawingData.color);
    if (drawingData.points) {
      // Mid-stroke preview — redraw everything then overlay
      clearAndRedraw(_ctx, _canvas.width, _canvas.height, _bgColor, _allStrokes);
      renderStroke(drawingData, _ctx, _canvas.width, _canvas.height);
      // Preserve my own in-progress stroke so it doesn't flash off while the
      // peer is drawing — _currentPoints isn't in _allStrokes until pointerup.
      if (_isDrawing && _currentPoints.length > 0) {
        renderStroke({
          color: _penColor,
          thickness: _thickness,
          points: _currentPoints,
        }, _ctx, _canvas.width, _canvas.height);
      }
    }
  });

  // Watch bg changes from peer
  watchCanvasBg(_canvasId, (newBg) => {
    if (newBg && newBg !== _bgColor) {
      _bgColor = newBg;
      clearAndRedraw(_ctx, _canvas.width, _canvas.height, _bgColor, _allStrokes);
      // Update bg dot selection if toolbox is open
      const toolbox = document.getElementById('canvas-toolbox');
      if (toolbox) updateToolboxState(toolbox);
    }
  });

  // Broadcast initial pen color so peer sees it immediately
  broadcastPenColor();

  // Mark self as present, watch peer presence for leave/rejoin
  setCanvasPresence(_canvasId, _myUserId, true).catch(() => {});
  let _peerSeenOnce = false;
  _absentTimerRef = null;
  watchCanvasPresence(_canvasId, (presence) => {
    if (!_peerId) return;
    if (presence[_peerId] === true) {
      _peerSeenOnce = true;
      if (_absentTimerRef) { clearTimeout(_absentTimerRef); _absentTimerRef = null; }
      // Peer (re-)joined — undim header and dismiss any dialog
      const header = document.getElementById('canvas-header');
      if (header) header.classList.remove('dimmed');
      const dialog = document.querySelector('.canvas-dialog-overlay');
      if (dialog) dialog.remove();
    }
    if (_peerSeenOnce && presence[_peerId] === false) {
      dimPeerIndicator();
      // If peer doesn't return within 5s, show "partner left" dialog
      if (_absentTimerRef) clearTimeout(_absentTimerRef);
      _absentTimerRef = setTimeout(() => {
        _absentTimerRef = null;
        const scr = document.getElementById('canvas-screen');
        if (scr && scr.classList.contains('active') && !scr.querySelector('.canvas-dialog-overlay')) {
          showPeerLeftDialog(scr, _peerName, () => {
            const onExit = _onExit;
            exitCanvas();
            if (onExit) onExit();
          });
        }
      }, 5000);
    }
  });

  // Update presence on tab/window visibility change
  document.addEventListener('visibilitychange', _onVisibilityChange);
  window.addEventListener('blur', _onWindowBlur);
  window.addEventListener('focus', _onWindowFocus);

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
  unwatchDrawing();
  unwatchCanvasBg();
  unwatchClearRequest();
  unwatchCanvasPresence();
  document.removeEventListener('visibilitychange', _onVisibilityChange);
  window.removeEventListener('blur', _onWindowBlur);
  window.removeEventListener('focus', _onWindowFocus);
  // Clear own drawing state in case we were mid-stroke
  if (_canvasId && _myUserId) setDrawingState(_canvasId, _myUserId, null).catch(() => {});
  const screen = document.getElementById('canvas-screen');
  if (screen) {
    screen.classList.remove('active');
    screen.removeEventListener('gesturestart', preventZoom);
    screen.removeEventListener('touchmove', preventMultiTouch);

    // Wait for fade-out, then clean up
    screen.addEventListener('transitionend', function onFadeOut() {
      screen.removeEventListener('transitionend', onFadeOut);
      screen.querySelectorAll('.canvas-float, .canvas-dialog-overlay').forEach(el => el.remove());
    }, { once: true });
  }

  if (_canvas) {
    _canvas.removeEventListener('pointerdown', onPointerDown);
    _canvas.removeEventListener('pointermove', onPointerMove);
    _canvas.removeEventListener('pointerup', onPointerUp);
    _canvas.removeEventListener('pointercancel', onPointerUp);
  }

  // Show main UI immediately (behind the fading canvas)
  document.getElementById('app-header').style.display = '';
  const strip = document.getElementById('favorites-strip');
  if (strip) strip.style.display = _stripWasVisible ? 'block' : 'none';
  document.getElementById('main-list').style.display = '';

  _ctx = null;
  _canvas = null;
  _canvasId = null;
  _peerId = null;
  _allStrokes = [];
  _undoStack = [];
  if (_absentTimerRef) { clearTimeout(_absentTimerRef); _absentTimerRef = null; }

  // Notify knock system to replay any knocks received while on canvas
  document.dispatchEvent(new CustomEvent('canvas-exited'));
}

function handleEnd() {
  const onExit = _onExit;
  exitCanvas();
  if (onExit) onExit();
}

// ─── Undo ────────────────────────────────────────────────────────────────────

function handleUndo() {
  if (_undoStack.length === 0) return;
  const key = _undoStack.pop();
  removeStroke(_canvasId, key).catch(() => {});
  // Remove from local strokes and redraw
  _allStrokes = _allStrokes.filter(s => s.key !== key);
  clearAndRedraw(_ctx, _canvas.width, _canvas.height, _bgColor, _allStrokes);
  updateUndoBtn();
}

function updateUndoBtn() {
  const btn = document.getElementById('canvas-undo');
  if (btn) btn.classList.toggle('disabled', _undoStack.length === 0);
}

// ─── Toolbox animation ───────────────────────────────────────────────────────

function animateToolbox(toolbox, opening) {
  // Measure current size
  const fromW = toolbox.offsetWidth;
  const fromH = toolbox.offsetHeight;

  // Toggle state to measure target size
  if (opening) {
    toolbox.classList.add('open');
  } else {
    toolbox.classList.remove('open');
  }

  // Measure target size
  toolbox.style.transition = 'none';
  toolbox.style.width = 'auto';
  toolbox.style.height = 'auto';
  const toW = toolbox.offsetWidth;
  const toH = toolbox.offsetHeight;

  // Set to start size
  toolbox.style.width = fromW + 'px';
  toolbox.style.height = fromH + 'px';
  void toolbox.offsetHeight; // force reflow

  // Animate to target
  toolbox.style.transition = '';
  requestAnimationFrame(() => {
    toolbox.style.width = toW + 'px';
    toolbox.style.height = toH + 'px';
  });

  // Clean up after transition
  const cleanup = () => {
    toolbox.style.width = '';
    toolbox.style.height = '';
    toolbox.removeEventListener('transitionend', cleanup);
  };
  toolbox.addEventListener('transitionend', cleanup);
}

// ─── Undo/toolbox overlap ────────────────────────────────────────────────────

function checkUndoOverlap(toolbox) {
  const undo = document.getElementById('canvas-undo');
  if (!undo || !toolbox) return;
  requestAnimationFrame(() => {
    const undoRect = undo.getBoundingClientRect();
    const toolRect = toolbox.getBoundingClientRect();
    const overlaps = !(undoRect.right < toolRect.left || undoRect.left > toolRect.right ||
                       undoRect.bottom < toolRect.top || undoRect.top > toolRect.bottom);
    undo.style.display = overlaps ? 'none' : '';
  });
}

// ─── Pen color broadcast ─────────────────────────────────────────────────────

function broadcastPenColor() {
  if (_canvasId && _myUserId) {
    setDrawingState(_canvasId, _myUserId, { color: _penColor }).catch(() => {});
  }
}

// ─── Thickness slider helper ─────────────────────────────────────────────────

function selectThicknessAtX(e, thkRow, toolbox) {
  const rect = thkRow.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const fraction = Math.max(0, Math.min(1, x / rect.width));
  const idx = Math.min(THICKNESS_VALUES.length - 1, Math.floor(fraction * THICKNESS_VALUES.length));
  if (THICKNESS_VALUES[idx] !== _thickness) {
    _thickness = THICKNESS_VALUES[idx];
    updateToolboxState(toolbox);
  }
}

// ─── Clear canvas ────────────────────────────────────────────────────────────

function requestClearCanvas() {
  const scr = document.getElementById('canvas-screen');
  if (!scr || scr.querySelector('.canvas-dialog-overlay')) return;
  setClearRequest(_canvasId, _myUserId).catch(() => {});
  // Show waiting dialog
  const overlay = document.createElement('div');
  overlay.className = 'canvas-dialog-overlay';
  overlay.innerHTML = `
    <div class="canvas-dialog">
      <h3>Clear canvas?</h3>
      <p>Waiting for ${document.createTextNode(_peerName).textContent} to agree...</p>
      <div class="canvas-dialog-btns">
        <button class="canvas-dialog-btn" id="canvas-clear-cancel">Cancel</button>
      </div>
    </div>`;
  scr.appendChild(overlay);
  overlay.querySelector('#canvas-clear-cancel').addEventListener('click', () => {
    overlay.remove();
    removeClearRequest(_canvasId).catch(() => {});
  });
}

function showClearApprovalDialog(requesterId) {
  const scr = document.getElementById('canvas-screen');
  if (!scr || scr.querySelector('.canvas-dialog-overlay')) return;
  if (requesterId === _myUserId) return; // I requested it, don't show approval to myself
  const overlay = document.createElement('div');
  overlay.className = 'canvas-dialog-overlay';
  overlay.innerHTML = `
    <div class="canvas-dialog">
      <h3>Clear canvas?</h3>
      <p>${document.createTextNode(_peerName).textContent} wants to start over</p>
      <div class="canvas-dialog-btns">
        <button class="canvas-dialog-btn" id="canvas-clear-keep">Keep</button>
        <button class="canvas-dialog-btn danger" id="canvas-clear-approve">Clear</button>
      </div>
    </div>`;
  scr.appendChild(overlay);
  overlay.querySelector('#canvas-clear-keep').addEventListener('click', () => {
    overlay.remove();
    removeClearRequest(_canvasId).catch(() => {});
  });
  overlay.querySelector('#canvas-clear-approve').addEventListener('click', () => {
    overlay.remove();
    clearAllStrokes(_canvasId).then(() => {
      _allStrokes = [];
      _undoStack = [];
      updateUndoBtn();
      clearAndRedraw(_ctx, _canvas.width, _canvas.height, _bgColor, []);
    }).catch(() => {});
  });
}

// ─── Visibility / presence ───────────────────────────────────────────────────

function _onVisibilityChange() {
  if (!_canvasId || !_myUserId) return;
  setCanvasPresence(_canvasId, _myUserId, document.visibilityState === 'visible').catch(() => {});
}

function _onWindowBlur() {
  if (!_canvasId || !_myUserId) return;
  setCanvasPresence(_canvasId, _myUserId, false).catch(() => {});
}

function _onWindowFocus() {
  if (!_canvasId || !_myUserId) return;
  setCanvasPresence(_canvasId, _myUserId, true).catch(() => {});
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

  // Previous point in pixel coords. Stored normalized, denormalize for the canvas.
  const prev = _currentPoints[_currentPoints.length - 1];
  const [prevPx, prevPy] = denormalizePoint(prev[0], prev[1], _canvas.width, _canvas.height);
  _currentPoints.push([nx, ny]);

  // Re-initialize context state on every segment. A concurrent peer broadcast can
  // change strokeStyle, lineWidth, and the path's current point via renderStroke;
  // without this we'd inherit the peer's color and draw a line from peer's last
  // point to ours.
  _ctx.strokeStyle = safeCssColor(_penColor);
  _ctx.lineWidth = _thickness * _canvas.width;
  _ctx.lineCap = 'round';
  _ctx.lineJoin = 'round';
  _ctx.beginPath();
  _ctx.moveTo(prevPx, prevPy);
  _ctx.lineTo(px, py);
  _ctx.stroke();

  // Throttled live drawing broadcast
  const now = Date.now();
  if (now - _lastDrawingSend > DRAWING_THROTTLE) {
    _lastDrawingSend = now;
    setDrawingState(_canvasId, _myUserId, {
      color: _penColor,
      thickness: _thickness,
      points: _currentPoints,
    }).catch(() => {});
  }
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

  // Clear live drawing state
  setDrawingState(_canvasId, _myUserId, null).catch(() => {});

  // Render locally (handles taps that had no pointermove, and ensures final state)
  renderStroke(stroke, _ctx, _canvas.width, _canvas.height);
  pushStroke(_canvasId, stroke).then(key => {
    if (key) {
      _undoStack.push(key);
      if (_undoStack.length > MAX_UNDO) _undoStack.shift();
      updateUndoBtn();
    }
  }).catch(() => {});
  _currentPoints = [];
}
