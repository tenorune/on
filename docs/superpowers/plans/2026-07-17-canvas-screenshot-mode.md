# Canvas Screenshot Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A consent-gated "Screenshot" action on the call canvas that fades out all floating chrome on both devices (200ms out, 5s hidden, 200ms back) so either user can take a clean OS screenshot.

**Architecture:** One RTDB key `canvases/$canvasId/screenshotRequest` carries a tiny state machine (`null` → `{by}` → `{by, approved:true}` → `null`), mirroring the existing `clearRequest` flow. A single `onValue` watcher in `enterCanvas` dispatches: show consent dialog, run the hide sequence (a `screenshot-mode` class on `#canvas-screen` drives a CSS opacity fade on all `.canvas-float` elements), or dismiss dialogs. The requester is the single writer for post-sequence cleanup.

**Tech Stack:** Vanilla TS (`js/canvas.ts`, `js/db/canvas.ts`), plain CSS (`css/canvas.css`), Jest + jsdom with mocked `firebase/database`.

**Spec:** `docs/superpowers/specs/2026-07-17-canvas-screenshot-mode-design.md`

## Global Constraints

- Zero TS suppressions (`@ts-ignore`/`@ts-expect-error` forbidden).
- Never touch inline `<script>` in HTML templates (CSP pins hashes). This plan touches no HTML.
- All new DB writes use `.catch(() => {})` (file convention in `js/canvas.ts`).
- Run typechecks from the repo root: `npm run typecheck && npm run typecheck:scripts` (beware a lingering `cd functions`).
- Web tests: `npx jest` from repo root.
- No RTDB rules change — both participants already have read/write on `canvases/$canvasId` (`database.rules.json:171-175`).
- `jest.clearAllMocks()` does not clear `mockResolvedValue` — set resolved values inside each test or in `beforeEach`.

---

### Task 1: DB ops for the screenshot handshake

**Files:**
- Modify: `js/db/canvas.ts` (append after `watchClearRequest`, ~line 75)
- Test: `tests/canvas-sync.test.js`

**Interfaces:**
- Consumes: existing `ref`/`update`/`onValue` imports already present in `js/db/canvas.ts`.
- Produces (Task 2/3 rely on these exact signatures, re-exported via the `js/db.ts` barrel — no barrel change needed, it has `export * from './db/canvas.js'`):
  - `setScreenshotRequest(canvasId: string, requesterId: string): Promise<void>` — writes `{ screenshotRequest: { by: requesterId } }`
  - `approveScreenshotRequest(canvasId: string, requesterId: string): Promise<void>` — writes `{ screenshotRequest: { by: requesterId, approved: true } }`
  - `removeScreenshotRequest(canvasId: string): Promise<void>` — writes `{ screenshotRequest: null }`
  - `watchScreenshotRequest(canvasId: string, onChange: (value: unknown) => void): () => void` — `onValue` on `canvases/$canvasId/screenshotRequest`, passes `snap.val()` raw

- [ ] **Step 1: Write the failing tests**

In `tests/canvas-sync.test.js`, extend the require at line 19-25 to:

```js
const {
  getCanvasId,
  loadCanvas,
  pushStroke,
  setCanvasBg,
  watchStrokes,
  setScreenshotRequest,
  approveScreenshotRequest,
  removeScreenshotRequest,
  watchScreenshotRequest,
} = require('../js/db');
```

Append at the end of the file:

```js
describe('screenshot request handshake ops', () => {
  test('setScreenshotRequest writes { by } under screenshotRequest', async () => {
    const { ref, update } = require('firebase/database');
    update.mockResolvedValue();
    await setScreenshotRequest('a_b', 'u1');
    expect(ref).toHaveBeenCalledWith({}, 'canvases/a_b');
    expect(update).toHaveBeenCalledWith('mockRef', { screenshotRequest: { by: 'u1' } });
  });

  test('approveScreenshotRequest writes { by, approved: true }', async () => {
    const { update } = require('firebase/database');
    update.mockResolvedValue();
    await approveScreenshotRequest('a_b', 'u1');
    expect(update).toHaveBeenCalledWith('mockRef', { screenshotRequest: { by: 'u1', approved: true } });
  });

  test('removeScreenshotRequest nulls the key', async () => {
    const { update } = require('firebase/database');
    update.mockResolvedValue();
    await removeScreenshotRequest('a_b');
    expect(update).toHaveBeenCalledWith('mockRef', { screenshotRequest: null });
  });

  test('watchScreenshotRequest passes raw values through and returns the unsub', () => {
    const { ref, onValue } = require('firebase/database');
    const unsub = jest.fn();
    let cb;
    onValue.mockImplementationOnce((r, fn) => { cb = fn; return unsub; });
    const got = [];
    const ret = watchScreenshotRequest('a_b', v => got.push(v));
    expect(ref).toHaveBeenCalledWith({}, 'canvases/a_b/screenshotRequest');
    cb({ val: () => ({ by: 'u1' }) });
    cb({ val: () => ({ by: 'u1', approved: true }) });
    cb({ val: () => null });
    expect(got).toEqual([{ by: 'u1' }, { by: 'u1', approved: true }, null]);
    expect(ret).toBe(unsub);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/canvas-sync.test.js`
Expected: FAIL — `setScreenshotRequest is not a function` (and siblings).

- [ ] **Step 3: Implement the four ops**

In `js/db/canvas.ts`, after `watchClearRequest` (line 71-75), add:

```ts
// --- Screenshot handshake (mirrors the clearRequest trio) ---
// State machine on canvases/$canvasId/screenshotRequest:
//   null → idle/cancelled/declined/done
//   { by } → pending peer consent
//   { by, approved: true } → both clients run the chrome-hide sequence

export async function setScreenshotRequest(canvasId: string, requesterId: string): Promise<void> {
  await update(ref(db, `canvases/${canvasId}`), { screenshotRequest: { by: requesterId } });
}

export async function approveScreenshotRequest(canvasId: string, requesterId: string): Promise<void> {
  await update(ref(db, `canvases/${canvasId}`), { screenshotRequest: { by: requesterId, approved: true } });
}

export async function removeScreenshotRequest(canvasId: string): Promise<void> {
  await update(ref(db, `canvases/${canvasId}`), { screenshotRequest: null });
}

export function watchScreenshotRequest(canvasId: string, onChange: (value: unknown) => void): () => void {
  return onValue(ref(db, `canvases/${canvasId}/screenshotRequest`), (snap) => {
    onChange(snap.val());
  });
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx jest tests/canvas-sync.test.js` → PASS (all, including pre-existing).
Run: `npm run typecheck && npm run typecheck:scripts` → clean.

- [ ] **Step 5: Commit**

```bash
git add js/db/canvas.ts tests/canvas-sync.test.js
git commit -m "feat(canvas): screenshot-request DB ops — {by}/{by,approved} state machine"
```

---

### Task 2: Toolbox button, consent dialogs, watcher dispatch (request/decline paths)

**Files:**
- Modify: `js/canvas.ts` (import list line 4-10; `buildFloatingUI` after the Clear button ~line 243; new functions after `showClearApprovalDialog` ~line 713; watcher registration in `enterCanvas` after the clearRequest watcher ~line 415)
- Test: create `tests/canvas-screenshot.test.js`

**Interfaces:**
- Consumes (Task 1): `setScreenshotRequest`, `approveScreenshotRequest`, `removeScreenshotRequest`, `watchScreenshotRequest` via `./db.js`.
- Produces (Task 3 relies on): the watcher dispatch with a marked `// approved branch — Task 3` seam calling `runScreenshotSequence(isRequester: boolean)`, which Task 2 defines as an exported stub `export function runScreenshotSequence(_isRequester: boolean): void {}` so the file compiles and Task 3 fills it in. Screenshot dialogs carry the extra class `canvas-shot-dialog` (dismissal targeting).

- [ ] **Step 1: Write the failing tests**

Create `tests/canvas-screenshot.test.js`:

```js
// tests/canvas-screenshot.test.js — screenshot-mode consent flow + hide sequence.
// ref is mocked to RETURN THE PATH so watcher registrations are identifiable
// (canvas.test.js's 'mockRef' constant can't distinguish onValue targets).

jest.mock('../js/firebase-config.js', () => ({ db: {} }));
jest.mock('../js/telegram.js', () => ({ isTelegramContext: jest.fn(() => false), openTelegramShare: jest.fn() }));
jest.mock('firebase/database', () => ({
  ref: jest.fn((db, path) => path),
  get: jest.fn(() => Promise.resolve({ exists: () => false, val: () => null })),
  push: jest.fn(() => Promise.resolve({ key: 'k1' })),
  update: jest.fn(() => Promise.resolve()),
  set: jest.fn(() => Promise.resolve()),
  remove: jest.fn(() => Promise.resolve()),
  onValue: jest.fn(() => jest.fn()),
  onChildAdded: jest.fn(() => jest.fn()),
  onChildRemoved: jest.fn(() => jest.fn()),
  onDisconnect: jest.fn(() => ({ set: jest.fn() })),
  runTransaction: jest.fn(),
  query: jest.fn(r => r),
  orderByKey: jest.fn(),
  startAfter: jest.fn(),
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

const { enterCanvas, exitCanvas } = require('../js/canvas.js');

function fakeCtx() {
  return new Proxy({}, {
    get: (t, p) => (p in t ? t[p] : () => {}),
    set: (t, p, v) => { t[p] = v; return true; },
  });
}

function setupCanvasDom() {
  document.body.innerHTML = `
    <div id="app-header"></div>
    <div id="favorites-strip"></div>
    <div id="main-list"></div>
    <div id="canvas-screen"><canvas id="draw-canvas"></canvas></div>`;
  HTMLCanvasElement.prototype.getContext = () => fakeCtx();
}

// enterCanvas('peer1', 'Peer', 'me', …) → canvasId sorts to 'me_peer1'
const SHOT_PATH = 'canvases/me_peer1/screenshotRequest';
const CANVAS_PATH = 'canvases/me_peer1';

function getShotWatcher() {
  const { onValue } = require('firebase/database');
  const call = onValue.mock.calls.find(c => c[0] === SHOT_PATH);
  return call ? call[1] : null;
}

function fire(value) {
  const cb = getShotWatcher();
  expect(cb).toBeTruthy();
  cb({ val: () => value });
}

async function enter() {
  setupCanvasDom();
  await enterCanvas('peer1', 'Peer', 'me', '#111111', '#abcdef', '#000000', () => {});
}

afterEach(() => {
  exitCanvas();
  jest.clearAllMocks();
});

describe('screenshot toolbox button', () => {
  test('renders next to Clear and requesting writes {by: me} + shows waiting dialog', async () => {
    await enter();
    const clearBtn = Array.from(document.querySelectorAll('.canvas-clear-btn'))
      .find(el => el.textContent === 'Clear');
    const shotBtn = clearBtn.nextElementSibling;
    expect(shotBtn.classList.contains('canvas-screenshot-btn')).toBe(true);
    expect(shotBtn.textContent).toBe('Screenshot');

    shotBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const { update } = require('firebase/database');
    expect(update).toHaveBeenCalledWith(CANVAS_PATH, { screenshotRequest: { by: 'me' } });
    const dialog = document.querySelector('.canvas-shot-dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('Waiting for Peer');
  });

  test('cancelling the waiting dialog removes the request', async () => {
    await enter();
    Array.from(document.querySelectorAll('.canvas-clear-btn'))
      .find(el => el.classList.contains('canvas-screenshot-btn'))
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.getElementById('canvas-shot-cancel')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const { update } = require('firebase/database');
    expect(update).toHaveBeenCalledWith(CANVAS_PATH, { screenshotRequest: null });
    expect(document.querySelector('.canvas-shot-dialog')).toBeNull();
  });
});

describe('screenshot watcher dispatch — request/decline', () => {
  test('{by: peer} shows the consent dialog', async () => {
    await enter();
    fire({ by: 'peer1' });
    const dialog = document.querySelector('.canvas-shot-dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('Peer wants a screenshot');
    expect(document.getElementById('canvas-shot-allow')).toBeTruthy();
    expect(document.getElementById('canvas-shot-decline')).toBeTruthy();
  });

  test('{by: me} (echo of own request) never shows the consent dialog', async () => {
    await enter();
    fire({ by: 'me' });
    expect(document.getElementById('canvas-shot-allow')).toBeNull();
  });

  test('Allow writes approved:true; Not now removes the request', async () => {
    await enter();
    fire({ by: 'peer1' });
    document.getElementById('canvas-shot-allow')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const { update } = require('firebase/database');
    expect(update).toHaveBeenCalledWith(CANVAS_PATH, { screenshotRequest: { by: 'peer1', approved: true } });
    expect(document.querySelector('.canvas-shot-dialog')).toBeNull();

    fire({ by: 'peer1' });
    document.getElementById('canvas-shot-decline')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(update).toHaveBeenCalledWith(CANVAS_PATH, { screenshotRequest: null });
    expect(document.querySelector('.canvas-shot-dialog')).toBeNull();
  });

  test('null dismisses screenshot dialogs but not other overlays', async () => {
    await enter();
    fire({ by: 'peer1' });
    expect(document.querySelector('.canvas-shot-dialog')).toBeTruthy();
    // An unrelated overlay (e.g. end-session) must survive the null-dispatch
    const other = document.createElement('div');
    other.className = 'canvas-dialog-overlay';
    document.getElementById('canvas-screen').appendChild(other);
    fire(null);
    expect(document.querySelector('.canvas-shot-dialog')).toBeNull();
    expect(document.querySelector('.canvas-dialog-overlay')).toBe(other);
  });

  test('a request arriving while another overlay is up shows nothing', async () => {
    await enter();
    const other = document.createElement('div');
    other.className = 'canvas-dialog-overlay';
    document.getElementById('canvas-screen').appendChild(other);
    fire({ by: 'peer1' });
    expect(document.querySelector('.canvas-shot-dialog')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/canvas-screenshot.test.js`
Expected: FAIL — no `.canvas-screenshot-btn`, `getShotWatcher()` finds no call (watcher not registered).

- [ ] **Step 3: Implement button, dialogs, and dispatch**

In `js/canvas.ts`:

**(a)** Extend the `./db.js` import (lines 4-10) with the four new names:

```ts
import {
  getCanvasId, loadCanvas, pushStroke, removeStroke, setCanvasBg, watchStrokes,
  setCanvasPresence, watchCanvasPresence,
  watchCanvasBg,
  setDrawingState, watchDrawing,
  setClearRequest, removeClearRequest, clearAllStrokes, watchClearRequest,
  setScreenshotRequest, approveScreenshotRequest, removeScreenshotRequest, watchScreenshotRequest,
} from './db.js';
```

**(b)** In `buildFloatingUI`, right after `expanded.appendChild(clearBtn);` (line 243), add:

```ts
  const shotBtn = document.createElement('div');
  shotBtn.className = 'canvas-clear-btn canvas-screenshot-btn';
  shotBtn.textContent = 'Screenshot';
  shotBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toolbox.classList.remove('open');
    requestScreenshot();
  });
  expanded.appendChild(shotBtn);
```

**(c)** After `showClearApprovalDialog` (line 713), add the screenshot section:

```ts
// ─── Screenshot mode ─────────────────────────────────────────────────────────

type ScreenshotRequest = { by?: string; approved?: boolean };

function requestScreenshot() {
  const scr = document.getElementById('canvas-screen');
  if (!scr || scr.querySelector('.canvas-dialog-overlay')) return;
  setScreenshotRequest(_canvasId, _myUserId).catch(() => {});
  const overlay = document.createElement('div');
  overlay.className = 'canvas-dialog-overlay canvas-shot-dialog';
  overlay.innerHTML = `
    <div class="canvas-dialog">
      <h3>Screenshot</h3>
      <p>Waiting for ${escapeHtml(_peerName)} to agree...</p>
      <div class="canvas-dialog-btns">
        <button class="canvas-dialog-btn" id="canvas-shot-cancel">Cancel</button>
      </div>
    </div>`;
  scr.appendChild(overlay);
  (overlay.querySelector('#canvas-shot-cancel') as Element).addEventListener('click', () => {
    overlay.remove();
    removeScreenshotRequest(_canvasId).catch(() => {});
  });
}

function showScreenshotApprovalDialog(requesterId: string) {
  const scr = document.getElementById('canvas-screen');
  if (!scr || scr.querySelector('.canvas-dialog-overlay')) return;
  if (requesterId === _myUserId) return; // own request echoed back
  const overlay = document.createElement('div');
  overlay.className = 'canvas-dialog-overlay canvas-shot-dialog';
  overlay.innerHTML = `
    <div class="canvas-dialog">
      <h3>Screenshot?</h3>
      <p>${escapeHtml(_peerName)} wants a screenshot — the controls will hide for 5 seconds</p>
      <div class="canvas-dialog-btns">
        <button class="canvas-dialog-btn" id="canvas-shot-decline">Not now</button>
        <button class="canvas-dialog-btn primary" id="canvas-shot-allow">Allow</button>
      </div>
    </div>`;
  scr.appendChild(overlay);
  (overlay.querySelector('#canvas-shot-decline') as Element).addEventListener('click', () => {
    overlay.remove();
    removeScreenshotRequest(_canvasId).catch(() => {});
  });
  (overlay.querySelector('#canvas-shot-allow') as Element).addEventListener('click', () => {
    overlay.remove();
    approveScreenshotRequest(_canvasId, requesterId).catch(() => {});
  });
}

export function runScreenshotSequence(_isRequester: boolean): void {
  // Task 3: chrome-hide sequence (screenshot-mode class + timers).
}

function dismissScreenshotDialogs() {
  document.querySelectorAll('.canvas-shot-dialog').forEach(el => el.remove());
}
```

**(d)** In `enterCanvas`, right after the clearRequest watcher push (line 406-415), register the screenshot watcher:

```ts
  // Watch the screenshot handshake (see js/db/canvas.ts state machine)
  _canvasUnsubs.push(watchScreenshotRequest(_canvasId, (value) => {
    const req = (value ?? null) as ScreenshotRequest | null;
    if (req && req.by && req.approved === true) {
      dismissScreenshotDialogs();
      runScreenshotSequence(req.by === _myUserId);
    } else if (req && req.by) {
      showScreenshotApprovalDialog(req.by);
    } else {
      dismissScreenshotDialogs();
    }
  }));
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx jest tests/canvas-screenshot.test.js tests/canvas.test.js` → PASS.
Run: `npm run typecheck && npm run typecheck:scripts` → clean.

- [ ] **Step 5: Commit**

```bash
git add js/canvas.ts tests/canvas-screenshot.test.js
git commit -m "feat(canvas): Screenshot toolbox button + consent handshake dialogs"
```

---

### Task 3: Hide sequence — CSS fade, timers, exit cleanup

**Files:**
- Modify: `js/canvas.ts` (session singletons ~line 52; fill `runScreenshotSequence`; `exitCanvas` cleanup ~line 520)
- Modify: `css/canvas.css` (append at end of file)
- Test: `tests/canvas-screenshot.test.js` (append a describe block)

**Interfaces:**
- Consumes (Task 2): `runScreenshotSequence(isRequester: boolean)` stub, `removeScreenshotRequest` (Task 1).
- Produces: `#canvas-screen.screenshot-mode` class contract for CSS; `_screenshotTimers` singleton cleared by `exitCanvas`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/canvas-screenshot.test.js`:

```js
describe('screenshot hide sequence', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  test('approved → screenshot-mode class on; off after 5200ms; requester cleans up at 5400ms', async () => {
    await enter();
    const scr = document.getElementById('canvas-screen');
    const { update } = require('firebase/database');
    update.mockClear();

    fire({ by: 'me', approved: true }); // this client requested
    expect(scr.classList.contains('screenshot-mode')).toBe(true);

    jest.advanceTimersByTime(5199);
    expect(scr.classList.contains('screenshot-mode')).toBe(true);
    jest.advanceTimersByTime(1);
    expect(scr.classList.contains('screenshot-mode')).toBe(false);

    expect(update).not.toHaveBeenCalledWith(CANVAS_PATH, { screenshotRequest: null });
    jest.advanceTimersByTime(200);
    expect(update).toHaveBeenCalledWith(CANVAS_PATH, { screenshotRequest: null });
  });

  test('approver runs the same sequence but never removes the key', async () => {
    await enter();
    const scr = document.getElementById('canvas-screen');
    const { update } = require('firebase/database');
    update.mockClear();

    fire({ by: 'peer1', approved: true }); // peer requested
    expect(scr.classList.contains('screenshot-mode')).toBe(true);
    jest.advanceTimersByTime(6000);
    expect(scr.classList.contains('screenshot-mode')).toBe(false);
    expect(update).not.toHaveBeenCalledWith(CANVAS_PATH, { screenshotRequest: null });
  });

  test('approved dismisses the requester waiting dialog before hiding', async () => {
    await enter();
    Array.from(document.querySelectorAll('.canvas-clear-btn'))
      .find(el => el.classList.contains('canvas-screenshot-btn'))
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.canvas-shot-dialog')).toBeTruthy();
    fire({ by: 'me', approved: true });
    expect(document.querySelector('.canvas-shot-dialog')).toBeNull();
  });

  test('a duplicate approved dispatch does not restart the sequence', async () => {
    await enter();
    const scr = document.getElementById('canvas-screen');
    fire({ by: 'peer1', approved: true });
    jest.advanceTimersByTime(5000);
    fire({ by: 'peer1', approved: true }); // watcher echo mid-sequence
    jest.advanceTimersByTime(200);
    expect(scr.classList.contains('screenshot-mode')).toBe(false);
  });

  test('exitCanvas mid-sequence clears timers and the class', async () => {
    await enter();
    const scr = document.getElementById('canvas-screen');
    const { update } = require('firebase/database');
    fire({ by: 'me', approved: true });
    jest.advanceTimersByTime(1000);
    exitCanvas();
    expect(scr.classList.contains('screenshot-mode')).toBe(false);
    update.mockClear();
    jest.advanceTimersByTime(10000);
    expect(update).not.toHaveBeenCalledWith(CANVAS_PATH, { screenshotRequest: null });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/canvas-screenshot.test.js`
Expected: the new describe FAILS (`screenshot-mode` class never set — stub body is empty); Task 2's tests still PASS.

- [ ] **Step 3: Implement the sequence + CSS**

In `js/canvas.ts`:

**(a)** With the session singletons (after line 52, `_peerPreview`), add:

```ts
let _screenshotTimers: Array<ReturnType<typeof setTimeout>> = [];
const SCREENSHOT_FADE_MS = 200;
const SCREENSHOT_HOLD_MS = 5000;
```

**(b)** Replace the Task 2 stub of `runScreenshotSequence`:

```ts
export function runScreenshotSequence(isRequester: boolean): void {
  const scr = document.getElementById('canvas-screen');
  if (!scr || scr.classList.contains('screenshot-mode')) return; // already running
  scr.classList.add('screenshot-mode'); // fade-out 200ms, then hidden hold
  _screenshotTimers.push(setTimeout(() => {
    scr.classList.remove('screenshot-mode'); // fade-in 200ms
  }, SCREENSHOT_FADE_MS + SCREENSHOT_HOLD_MS));
  if (isRequester) {
    // Single writer for cleanup: key removal after the fade-in completes.
    _screenshotTimers.push(setTimeout(() => {
      removeScreenshotRequest(_canvasId).catch(() => {});
    }, SCREENSHOT_FADE_MS + SCREENSHOT_HOLD_MS + SCREENSHOT_FADE_MS));
  }
}
```

**(c)** In `exitCanvas`, inside the `if (screen)` block right after `screen.classList.remove('active');` (line 522), add:

```ts
    screen.classList.remove('screenshot-mode');
```

and directly after `_canvasUnsubs = [];` (line 514), add:

```ts
  _screenshotTimers.forEach(t => clearTimeout(t));
  _screenshotTimers = [];
```

In `css/canvas.css`, append at the end of the file:

```css
/* ── Screenshot mode ───────────────────────────────────────────── */
/* Chrome fades out (200ms), holds hidden 5s, fades back (200ms) —
   driven by the screenshot-mode class on #canvas-screen. */
.canvas-float {
  transition: opacity 0.2s ease;
}
/* .canvas-toolbox's own transition (width/height, line ~94) would override
   .canvas-float's — restate it with opacity added. */
.canvas-toolbox {
  transition: width 0.2s ease-out, height 0.2s ease-out, opacity 0.2s ease;
}
#canvas-screen.screenshot-mode .canvas-float {
  opacity: 0;
  pointer-events: none;
}
```

- [ ] **Step 4: Run the full suite + typechecks**

Run: `npx jest` → all green (1812+ web tests).
Run: `npm run typecheck && npm run typecheck:scripts` → clean.

- [ ] **Step 5: Commit**

```bash
git add js/canvas.ts css/canvas.css tests/canvas-screenshot.test.js
git commit -m "feat(canvas): screenshot hide sequence — 200ms fades around a 5s chrome hold"
```

---

## Verification beyond the suite

- jsdom cannot observe CSS transitions; the 200ms fades and the composed
  behavior with the undo overlap-hide are visual — device/two-browser
  walkthrough is the operator's call ("done" is theirs).
- Suggested manual check: two browser windows on the dev server
  (`node scripts/dev.js`), open a call canvas both sides, request from one,
  approve on the other, watch both chromes fade/return; confirm drawing still
  works while hidden; confirm Cancel and Not now paths leave both screens
  unchanged.
