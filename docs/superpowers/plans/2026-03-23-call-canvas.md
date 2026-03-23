# Call Canvas Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared drawing canvas that two users enter when answering a call (swipe-right). Users draw with pen tool using colors from their favorites palette. Strokes sync via Firebase and persist between sessions.

**Architecture:** Three layers — Firebase sync (`canvas-sync.js`), canvas screen + drawing engine (`canvas.js`), and call flow integration (modifications to `following.js` and `db.js`). The canvas is a full-screen overlay with floating controls. Strokes are normalized to 0–1 coordinates and written to `canvases/{sortedPairId}/strokes/` on pointer-up.

**Tech Stack:** HTML Canvas API, Firebase Realtime DB (onChildAdded, push, get), pointer events, vanilla JS/CSS.

**Spec:** `docs/superpowers/specs/2026-03-23-call-canvas-design.md`

---

## Chunk 1: Firebase Sync Layer

### Task 1: Add canvas Firebase operations to db.js

**Files:**
- Modify: `js/db.js:1-5` (add `push` to imports)
- Modify: `js/db.js` (add canvas operations at end)
- Create: `tests/canvas-sync.test.js`

- [ ] **Step 1: Write failing tests for canvas sync functions**

Create `tests/canvas-sync.test.js`:

```javascript
// tests/canvas-sync.test.js
jest.mock('../js/firebase-config.js', () => ({ db: {} }));
jest.mock('firebase/database', () => ({
  ref: jest.fn(() => 'mockRef'),
  get: jest.fn(),
  push: jest.fn(),
  update: jest.fn(),
  onChildAdded: jest.fn(() => jest.fn()), // returns unsubscribe
  query: jest.fn(r => r),
  orderByKey: jest.fn(),
  startAfter: jest.fn(),
}));

const {
  getCanvasId,
  loadCanvas,
  pushStroke,
  setCanvasBg,
  watchStrokes,
  unwatchStrokes,
} = require('../js/db');

describe('getCanvasId', () => {
  test('sorts user IDs alphabetically and joins with underscore', () => {
    expect(getCanvasId('zoe123', 'alice456')).toBe('alice456_zoe123');
    expect(getCanvasId('alice456', 'zoe123')).toBe('alice456_zoe123');
  });

  test('same ID produces consistent result', () => {
    expect(getCanvasId('abc', 'def')).toBe(getCanvasId('def', 'abc'));
  });
});

describe('pushStroke', () => {
  test('calls push with stroke data on the strokes path', async () => {
    const { ref, push } = require('firebase/database');
    push.mockResolvedValue();
    const stroke = { userId: 'u1', color: '#ff0000', thickness: 0.012, tool: 'pen', points: [[0.1, 0.2]], timestamp: 1000 };
    await pushStroke('a_b', stroke);
    expect(ref).toHaveBeenCalledWith({}, 'canvases/a_b/strokes');
    expect(push).toHaveBeenCalledWith('mockRef', stroke);
  });
});

describe('setCanvasBg', () => {
  test('updates bg field on canvas path', async () => {
    const { ref, update } = require('firebase/database');
    update.mockResolvedValue();
    await setCanvasBg('a_b', '#1e293b');
    expect(ref).toHaveBeenCalledWith({}, 'canvases/a_b');
    expect(update).toHaveBeenCalledWith('mockRef', { bg: '#1e293b' });
  });
});

describe('loadCanvas', () => {
  test('returns bg and strokes from snapshot', async () => {
    const { get } = require('firebase/database');
    get.mockResolvedValue({
      exists: () => true,
      val: () => ({
        bg: '#180012',
        strokes: {
          s1: { userId: 'u1', color: '#ff0000', thickness: 0.012, tool: 'pen', points: [[0.1, 0.2]], timestamp: 1000 },
        },
      }),
    });
    const result = await loadCanvas('a_b');
    expect(result.bg).toBe('#180012');
    expect(result.strokes).toHaveLength(1);
    expect(result.strokes[0].key).toBe('s1');
    expect(result.strokes[0].data.color).toBe('#ff0000');
  });

  test('returns defaults when canvas does not exist', async () => {
    const { get } = require('firebase/database');
    get.mockResolvedValue({ exists: () => false, val: () => null });
    const result = await loadCanvas('a_b');
    expect(result.bg).toBeNull();
    expect(result.strokes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/canvas-sync.test.js --no-coverage`
Expected: FAIL — functions not exported from db.js

- [ ] **Step 3: Add push to Firebase imports in db.js**

In `js/db.js` line 4, add `push` and the query functions:

```javascript
import {
  ref, set, get, update, onValue, remove, runTransaction, onChildAdded,
  push, query, orderByKey, startAfter,
} from 'firebase/database';
```

- [ ] **Step 4: Implement canvas functions in db.js**

Add at the end of `js/db.js`, before the closing (there is no closing — just at the bottom):

```javascript
// --- Canvas operations ---

export function getCanvasId(uid1, uid2) {
  return [uid1, uid2].sort().join('_');
}

export async function loadCanvas(canvasId) {
  const snap = await get(ref(db, `canvases/${canvasId}`));
  if (!snap.exists()) return { bg: null, strokes: [] };
  const val = snap.val();
  const strokes = val.strokes
    ? Object.entries(val.strokes).map(([key, data]) => ({ key, data }))
    : [];
  return { bg: val.bg || null, strokes };
}

export async function pushStroke(canvasId, stroke) {
  await push(ref(db, `canvases/${canvasId}/strokes`), stroke);
}

export async function setCanvasBg(canvasId, color) {
  await update(ref(db, `canvases/${canvasId}`), { bg: color });
}

let _strokeUnsub = null;

export function watchStrokes(canvasId, lastKey, onStroke) {
  const strokesRef = ref(db, `canvases/${canvasId}/strokes`);
  const q = lastKey
    ? query(strokesRef, orderByKey(), startAfter(lastKey))
    : strokesRef;
  _strokeUnsub = onChildAdded(q, (snap) => {
    onStroke({ key: snap.key, data: snap.val() });
  });
}

export function unwatchStrokes() {
  if (_strokeUnsub) { _strokeUnsub(); _strokeUnsub = null; }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/canvas-sync.test.js --no-coverage`
Expected: All tests PASS

- [ ] **Step 6: Run full test suite**

Run: `npx jest --no-coverage`
Expected: All 327+ tests pass

- [ ] **Step 7: Commit**

```bash
git add js/db.js tests/canvas-sync.test.js
git commit -m "feat: add canvas Firebase operations — getCanvasId, loadCanvas, pushStroke, watchStrokes"
```

---

## Chunk 2: Canvas Screen + Drawing Engine

### Task 2: Create canvas CSS

**Files:**
- Create: `css/canvas.css`
- Modify: `index.html` (add CSS link)

- [ ] **Step 1: Create css/canvas.css**

```css
/* css/canvas.css */

/* ── Canvas screen overlay ─────────────────────────────────────── */
#canvas-screen {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: none;
  flex-direction: column;
}
#canvas-screen.active {
  display: flex;
}

#draw-canvas {
  flex: 1;
  width: 100%;
  touch-action: none;
  cursor: crosshair;
}

/* ── Floating UI elements ──────────────────────────────────────── */
.canvas-float {
  position: absolute;
  background: rgba(20, 20, 50, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 4px 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  z-index: 210;
}

/* End button — top left */
.canvas-end-btn {
  top: 52px;
  left: 10px;
  display: flex;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  color: #f87171;
  font-size: 0.6rem;
  font-weight: 500;
}
.canvas-end-btn svg { flex-shrink: 0; }

/* Peer indicator — top right */
.canvas-peer {
  top: 52px;
  right: 10px;
  display: flex;
  align-items: center;
  gap: 5px;
}
.canvas-peer-name {
  font-size: 0.55rem;
  color: rgba(255, 255, 255, 0.5);
  font-weight: 500;
}
.canvas-peer-dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  box-shadow: 0 0 8px currentColor;
}

/* Toolbox — bottom right */
.canvas-toolbox {
  bottom: 24px;
  right: 10px;
}
.canvas-toolbox-collapsed {
  display: flex;
  gap: 6px;
  padding: 2px;
  align-items: center;
  cursor: pointer;
}
.canvas-toolbox-expanded {
  display: none;
}
.canvas-toolbox.open .canvas-toolbox-collapsed { display: none; }
.canvas-toolbox.open .canvas-toolbox-expanded { display: block; }

.canvas-color-ring {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}
.canvas-thickness-dot {
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.35);
}

/* Color row */
.canvas-colors {
  display: flex;
  gap: 3px;
  margin-bottom: 4px;
}
.canvas-color-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
}
.canvas-color-dot.selected { border-color: #fff; }

/* Thickness row */
.canvas-thicknesses {
  display: flex;
  gap: 6px;
  align-items: center;
}
.canvas-thickness-btn {
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.25);
  cursor: pointer;
  border: none;
}
.canvas-thickness-btn.selected {
  background: #e2e8f0;
  outline: 1px solid rgba(99, 102, 241, 0.5);
}

/* Confirm dialog */
.canvas-dialog-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 220;
}
.canvas-dialog {
  background: rgba(20, 20, 50, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  padding: 20px 28px;
  text-align: center;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
}
.canvas-dialog h3 {
  font-size: 0.85rem;
  color: #eeeeff;
  margin-bottom: 12px;
  font-weight: 500;
}
.canvas-dialog p {
  font-size: 0.65rem;
  color: #8080c0;
  margin-bottom: 14px;
}
.canvas-dialog-btns {
  display: flex;
  gap: 8px;
  justify-content: center;
}
.canvas-dialog-btn {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 6px 20px;
  font-size: 0.7rem;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.08);
  color: #8080c0;
}
.canvas-dialog-btn.danger {
  background: rgba(220, 38, 38, 0.3);
  border-color: rgba(220, 38, 38, 0.4);
  color: #f87171;
}
.canvas-dialog-btn.primary {
  background: rgba(99, 102, 241, 0.2);
  border-color: rgba(99, 102, 241, 0.3);
  color: #a5b4fc;
}
```

- [ ] **Step 2: Add CSS link to index.html**

In `index.html`, after the existing CSS link (line 12):

```html
  <link rel="stylesheet" href="css/canvas.css" />
```

- [ ] **Step 3: Commit**

```bash
git add css/canvas.css index.html
git commit -m "feat: add canvas screen CSS — floating UI, toolbox, dialog styles"
```

---

### Task 3: Create canvas.js — screen, drawing engine, floating UI

**Files:**
- Create: `js/canvas.js`
- Modify: `index.html` (add `#canvas-screen` container)
- Create: `tests/canvas.test.js`

- [ ] **Step 1: Add canvas-screen HTML to index.html**

In `index.html`, after `<div id="favorites-strip"></div>` (line 56), add:

```html
  <div id="canvas-screen">
    <canvas id="draw-canvas"></canvas>
  </div>
```

- [ ] **Step 2: Write failing tests for canvas.js**

Create `tests/canvas.test.js`:

```javascript
// tests/canvas.test.js

// Mock all dependencies
jest.mock('../js/firebase-config.js', () => ({ db: {} }));
jest.mock('firebase/database', () => ({
  ref: jest.fn(() => 'mockRef'),
  get: jest.fn(),
  push: jest.fn(),
  update: jest.fn(),
  onChildAdded: jest.fn(() => jest.fn()),
  onValue: jest.fn(),
  query: jest.fn(r => r),
  orderByKey: jest.fn(),
  startAfter: jest.fn(),
  set: jest.fn(),
  remove: jest.fn(),
  runTransaction: jest.fn(),
}));
jest.mock('../js/store.js', () => ({
  getPaletteState: jest.fn(() => ({
    activeSet: 1,
    sets: { '1': { selectedKey: 'forest', activePaletteKey: null }, '2': { selectedKey: 'volt', activePaletteKey: null } },
  })),
  setPaletteState: jest.fn(),
  getFavorites: jest.fn(() => []),
  setFavorites: jest.fn(),
  getFollowing: jest.fn(() => []),
}));
jest.mock('../js/palettes.js', () => ({
  getPaletteByKey: jest.fn(key => ({
    forest: { color: '#22c55e', theme: { surface: '#0f2e18', surface2: '#184226' } },
    volt: { color: '#aaff00', theme: { surface: '#192500', surface2: '#243600' } },
  })[key] ?? null),
  getGlowForColor: jest.fn(() => 'rgba(0,0,0,0)'),
  switchSet: jest.fn(),
  enterPaletteMode: jest.fn(),
  exitPaletteMode: jest.fn(),
}));
jest.mock('../js/features.js', () => ({
  PALETTES_ENABLED: true,
  PALETTE_INTERACTIONS_ENABLED: true,
  KNOCK_ENABLED: true,
  CALL_ENABLED: true,
}));

describe('canvas module', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <header id="app-header"></header>
      <div id="favorites-strip"></div>
      <div id="canvas-screen"><canvas id="draw-canvas"></canvas></div>
      <main id="main-list"></main>
    `;
    // Mock canvas context
    const canvas = document.getElementById('draw-canvas');
    canvas.getContext = jest.fn(() => ({
      clearRect: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      arc: jest.fn(),
      fill: jest.fn(),
      lineWidth: 0,
      strokeStyle: '',
      lineCap: '',
      lineJoin: '',
      fillStyle: '',
    }));
  });

  test('normalizePoint converts pixel coords to 0-1 range', () => {
    const { normalizePoint } = require('../js/canvas.js');
    const result = normalizePoint(100, 200, 400, 800);
    expect(result[0]).toBeCloseTo(0.25);
    expect(result[1]).toBeCloseTo(0.25);
  });

  test('denormalizePoint converts 0-1 coords to pixel coords', () => {
    const { denormalizePoint } = require('../js/canvas.js');
    const result = denormalizePoint(0.25, 0.25, 400, 800);
    expect(result[0]).toBeCloseTo(100);
    expect(result[1]).toBeCloseTo(200);
  });

  test('getThicknessValues returns 3 normalized grades', () => {
    const { getThicknessValues } = require('../js/canvas.js');
    const values = getThicknessValues();
    expect(values).toHaveLength(3);
    expect(values[0]).toBeLessThan(values[1]);
    expect(values[1]).toBeLessThan(values[2]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest tests/canvas.test.js --no-coverage`
Expected: FAIL — module not found or functions not exported

- [ ] **Step 4: Create js/canvas.js**

```javascript
// js/canvas.js
import { getCanvasColors } from './favorites.js';
import { safeCssColor } from './utils.js';
import {
  getCanvasId, loadCanvas, pushStroke, setCanvasBg, watchStrokes, unwatchStrokes,
} from './db.js';

const THICKNESS_VALUES = [0.005, 0.012, 0.025]; // thin, medium, thick
const THICKNESS_PX_LABELS = [3, 7, 13]; // visual dot sizes in toolbox

let _ctx = null;
let _canvas = null;
let _canvasId = null;
let _myUserId = null;
let _peerName = '';
let _penColor = '#22c55e';
let _thickness = THICKNESS_VALUES[1]; // default medium
let _isDrawing = false;
let _currentPoints = [];
let _onExit = null; // callback when exiting canvas

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
  ctx.beginPath();
  const [x0, y0] = denormalizePoint(pts[0][0], pts[0][1], cw, ch);
  ctx.moveTo(x0, y0);
  if (pts.length === 1) {
    // Single point — draw a dot
    ctx.arc(x0, y0, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    return;
  }
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

function buildFloatingUI(container, penColors, onEnd, onColorChange, onThicknessChange) {
  // End button (top-left)
  const endBtn = document.createElement('div');
  endBtn.className = 'canvas-float canvas-end-btn';
  endBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg><span>End</span>`;
  endBtn.addEventListener('click', () => showEndDialog(container, onEnd));
  container.appendChild(endBtn);

  // Peer indicator (top-right)
  const peer = document.createElement('div');
  peer.className = 'canvas-float canvas-peer';
  peer.id = 'canvas-peer-indicator';
  peer.innerHTML = `<span class="canvas-peer-name">${_peerName}</span><div class="canvas-peer-dot" id="canvas-peer-dot" style="background:${safeCssColor(_penColor)};color:${safeCssColor(_penColor)}"></div>`;
  container.appendChild(peer);

  // Toolbox (bottom-right)
  const toolbox = document.createElement('div');
  toolbox.className = 'canvas-float canvas-toolbox';
  toolbox.id = 'canvas-toolbox';

  // Collapsed state
  const collapsed = document.createElement('div');
  collapsed.className = 'canvas-toolbox-collapsed';
  const penIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>`;
  collapsed.innerHTML = `${penIcon}<div class="canvas-color-ring" id="canvas-ring" style="background:${safeCssColor(_penColor)}"><div class="canvas-thickness-dot" id="canvas-ring-dot" style="width:${_thickness * 200}px;height:${_thickness * 200}px"></div></div>`;
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
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      _penColor = c;
      onColorChange(c);
      updateToolboxState(toolbox);
    });
    colorRow.appendChild(dot);
  });
  expanded.appendChild(colorRow);

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
      onThicknessChange(t);
      updateToolboxState(toolbox);
    });
    thkRow.appendChild(btn);
  });
  expanded.appendChild(thkRow);
  toolbox.appendChild(expanded);

  // Toggle expand/collapse
  collapsed.addEventListener('click', () => toolbox.classList.add('open'));
  container.appendChild(toolbox);

  // Close on tap outside
  container.addEventListener('pointerdown', (e) => {
    if (!toolbox.contains(e.target) && toolbox.classList.contains('open')) {
      toolbox.classList.remove('open');
    }
  });
}

function updateToolboxState(toolbox) {
  const ring = toolbox.querySelector('#canvas-ring');
  const dot = toolbox.querySelector('#canvas-ring-dot');
  if (ring) ring.style.background = safeCssColor(_penColor);
  if (dot) { dot.style.width = _thickness * 200 + 'px'; dot.style.height = _thickness * 200 + 'px'; }
  toolbox.querySelectorAll('.canvas-color-dot').forEach(el => {
    el.classList.toggle('selected', el.style.background === safeCssColor(_penColor));
  });
  toolbox.querySelectorAll('.canvas-thickness-btn').forEach((el, i) => {
    el.classList.toggle('selected', THICKNESS_VALUES[i] === _thickness);
  });
}

function updatePeerDot(color) {
  const dot = document.getElementById('canvas-peer-dot');
  if (dot) {
    dot.style.background = safeCssColor(color);
    dot.style.color = safeCssColor(color);
  }
}

// ─── Dialogs ─────────────────────────────────────────────────────────────────

function showEndDialog(container, onEnd) {
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
    onEnd();
  });
}

export function showPeerLeftDialog(container, peerName, onDone) {
  const overlay = document.createElement('div');
  overlay.className = 'canvas-dialog-overlay';
  overlay.innerHTML = `
    <div class="canvas-dialog">
      <h3>${peerName} left</h3>
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

export async function enterCanvas(peerId, peerName, myUserId, myStatusColor, callerSurface, onExit) {
  _canvasId = getCanvasId(myUserId, peerId);
  _myUserId = myUserId;
  _peerName = peerName;
  _penColor = myStatusColor || '#22c55e';
  _thickness = THICKNESS_VALUES[1];
  _onExit = onExit;

  const screen = document.getElementById('canvas-screen');
  _canvas = document.getElementById('draw-canvas');
  screen.classList.add('active');

  // Hide main UI
  document.getElementById('app-header').style.display = 'none';
  document.getElementById('favorites-strip').style.display = 'none';
  document.getElementById('main-list').style.display = 'none';

  // Size canvas to screen
  _canvas.width = screen.clientWidth;
  _canvas.height = screen.clientHeight;
  _ctx = _canvas.getContext('2d');

  // Load existing canvas state
  const { bg, strokes } = await loadCanvas(_canvasId);
  const bgColor = bg || callerSurface || '#0f172a';
  if (!bg) setCanvasBg(_canvasId, bgColor).catch(() => {});

  const allStrokes = strokes; // array of { key, data }
  clearAndRedraw(_ctx, _canvas.width, _canvas.height, bgColor, allStrokes);

  // Get pen colors from favorites
  const { penColors } = getCanvasColors();
  if (!penColors.includes(_penColor)) penColors.unshift(_penColor);

  // Build floating UI
  buildFloatingUI(screen, penColors, handleEnd, () => {}, () => {});

  // Watch for new strokes from peer
  const lastKey = allStrokes.length > 0 ? allStrokes[allStrokes.length - 1].key : null;
  watchStrokes(_canvasId, lastKey, (entry) => {
    if (entry.data.userId !== _myUserId) {
      renderStroke(entry.data, _ctx, _canvas.width, _canvas.height);
      updatePeerDot(entry.data.color);
    }
    allStrokes.push(entry);
  });

  // Drawing event handlers
  _canvas.addEventListener('pointerdown', onPointerDown);
  _canvas.addEventListener('pointermove', onPointerMove);
  _canvas.addEventListener('pointerup', onPointerUp);
  _canvas.addEventListener('pointercancel', onPointerUp);
}

export function exitCanvas() {
  unwatchStrokes();
  const screen = document.getElementById('canvas-screen');
  screen.classList.remove('active');

  // Remove floating UI (but keep the canvas element)
  screen.querySelectorAll('.canvas-float, .canvas-dialog-overlay').forEach(el => el.remove());

  // Remove drawing listeners
  if (_canvas) {
    _canvas.removeEventListener('pointerdown', onPointerDown);
    _canvas.removeEventListener('pointermove', onPointerMove);
    _canvas.removeEventListener('pointerup', onPointerUp);
    _canvas.removeEventListener('pointercancel', onPointerUp);
  }

  // Show main UI
  document.getElementById('app-header').style.display = '';
  document.getElementById('favorites-strip').style.display = '';
  document.getElementById('main-list').style.display = '';

  _ctx = null;
  _canvas = null;
  _canvasId = null;
}

function handleEnd() {
  exitCanvas();
  if (_onExit) _onExit();
}

// ─── Pointer event handlers ──────────────────────────────────────────────────

function onPointerDown(e) {
  _isDrawing = true;
  const rect = _canvas.getBoundingClientRect();
  const [nx, ny] = normalizePoint(e.clientX - rect.left, e.clientY - rect.top, _canvas.width, _canvas.height);
  _currentPoints = [[nx, ny]];
  _ctx.strokeStyle = safeCssColor(_penColor);
  _ctx.lineWidth = _thickness * _canvas.width;
  _ctx.lineCap = 'round';
  _ctx.lineJoin = 'round';
  _ctx.beginPath();
  _ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
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
    color: _penColor,
    thickness: _thickness,
    tool: 'pen',
    points: _currentPoints,
    timestamp: Date.now(),
  };

  pushStroke(_canvasId, stroke).catch(() => {});
  _currentPoints = [];
}
```

- [ ] **Step 5: Run tests**

Run: `npx jest tests/canvas.test.js --no-coverage`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `npx jest --no-coverage`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add js/canvas.js css/canvas.css index.html tests/canvas.test.js
git commit -m "feat: add canvas screen with drawing engine, floating toolbox, and peer indicator"
```

---

## Chunk 3: Call Flow Integration

### Task 4: Hook canvas into call answer flow

**Files:**
- Modify: `js/following.js` (import canvas, modify swipe handler and watchStatus)
- Modify: `js/app.js` (handle canvas recovery on app load)

- [ ] **Step 1: Import canvas module in following.js**

At the top of `js/following.js`, add:

```javascript
import { enterCanvas, exitCanvas, showPeerLeftDialog } from './canvas.js';
```

- [ ] **Step 2: Modify swipe-right handler for receiver**

In `js/following.js`, inside `createFolloweeRow`, in the `CALL_ENABLED && isMutual` block, the swipe-right trigger at approximately line 445:

Change:
```javascript
if (dx > threshold) {
  swipeActive = false;
  enterCallMode(entry, myUserId);
}
```

To:
```javascript
if (dx > threshold) {
  swipeActive = false;
  // If this card is in call-mode (someone is calling us), answer = enter canvas
  if (li.classList.contains('call-mode') && callModeCalleeId !== entry.userId) {
    // We are the receiver — answer the call
    const peerData = lastUserData.get(entry.userId);
    const peerColor = peerData?.statusColor || '#22c55e';
    const peerSurface = peerData?.paletteKey
      ? (getPaletteByKey(peerData.paletteKey)?.theme?.surface || '#1e293b')
      : '#1e293b';
    const myColor = getComputedStyle(document.documentElement).getPropertyValue('--my-status').trim() || '#22c55e';
    enterCallMode(entry, myUserId); // write callState so caller detects answer
    enterCanvas(entry.userId, entry.label || entry.code, myUserId, myColor, peerSurface, () => {
      exitCallMode(myUserId);
    });
  } else {
    // Normal call initiation
    enterCallMode(entry, myUserId);
  }
}
```

- [ ] **Step 3: Add canvas entry for caller when they detect answer**

In `js/following.js`, in `updateFolloweeRow`, after the call mode detection block (approximately line 636–646), add canvas auto-entry for the caller:

Find the block:
```javascript
const isCallee = callModeCalleeId !== null && entry.userId === callModeCalleeId;
const isCallModeReceiver = !isCallee && userData.callState?.calleeId === myUserId;
```

After this detection, add:
```javascript
// Caller: detect when receiver answers (mutual callState)
if (isCallee && userData.callState?.calleeId === myUserIdRef) {
  // Both have callState pointing at each other — enter canvas
  const screen = document.getElementById('canvas-screen');
  if (screen && !screen.classList.contains('active')) {
    const peerColor = userData.statusColor || '#22c55e';
    const peerSurface = userData.paletteKey
      ? (getPaletteByKey(userData.paletteKey)?.theme?.surface || '#1e293b')
      : '#1e293b';
    const myColor = getComputedStyle(document.documentElement).getPropertyValue('--my-status').trim() || '#22c55e';
    enterCanvas(entry.userId, entry.label || entry.code, myUserIdRef, myColor, peerSurface, () => {
      exitCallMode(myUserIdRef);
    });
  }
}
```

- [ ] **Step 4: Handle peer disconnect on canvas**

In `js/app.js`, in the `watchStatus` callback, the existing block that detects remote callState clearing (approximately line 140):

```javascript
} else if (CALL_ENABLED && getCallModeCalleeId() !== null && !userData.callState) {
  exitCallMode(userId);
}
```

Modify to also handle canvas exit:

```javascript
} else if (CALL_ENABLED && getCallModeCalleeId() !== null && !userData.callState) {
  const screen = document.getElementById('canvas-screen');
  if (screen && screen.classList.contains('active')) {
    // Peer left while on canvas — show dialog
    const { showPeerLeftDialog, exitCanvas } = await import('./canvas.js');
    showPeerLeftDialog(screen, 'Your partner', () => {
      exitCanvas();
      exitCallMode(userId);
    });
  } else {
    exitCallMode(userId);
  }
}
```

- [ ] **Step 5: Run full test suite**

Run: `npx jest --no-coverage`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add js/following.js js/app.js
git commit -m "feat: integrate canvas into call flow — receiver swipe-right answers, caller auto-enters"
```

---

### Task 5: Manual testing checklist and documentation

**Files:**
- Modify: `docs/color-theme-architecture-v0.7.html` (add canvas section, changelog)

- [ ] **Step 1: Manual test on two devices/tabs**

Test the following scenarios:
1. User A swipes right on User B's card → card glows on both sides
2. User B swipes right on glowing card → both enter canvas
3. Both users can draw — strokes appear on the other's canvas on pointerup
4. User A taps `< End` → confirmation → exits → User B sees "left" dialog
5. Reopen call between same pair → previous strokes are still there
6. Color picker works — changing color changes pen
7. Thickness picker works
8. Peer indicator dot updates with peer's latest stroke color

- [ ] **Step 2: Update architecture doc**

Add a new section for Call Canvas covering:
- Canvas Firebase schema (`canvases/{id}/`)
- Canvas entry/exit flow
- Stroke normalization
- Floating UI components
- Changelog entry

- [ ] **Step 3: Commit docs**

```bash
git add docs/color-theme-architecture-v0.7.html
git commit -m "docs: add Call Canvas section to architecture doc"
```
