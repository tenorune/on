// tests/canvas.test.js

jest.mock('../js/firebase-config.js', () => ({ db: {} }));
// inviteModal.js (reached transitively via favorites.js → groupNav.js → groupContext.js)
// now imports telegram.js, which pulls in firebase/auth; stub it out inertly.
jest.mock('../js/telegram.js', () => ({ isTelegramContext: jest.fn(() => false), openTelegramShare: jest.fn() }));
jest.mock('firebase/database', () => ({
  ref: jest.fn(() => 'mockRef'),
  get: jest.fn(() => Promise.resolve({ exists: () => false, val: () => null })),
  push: jest.fn(() => Promise.resolve()),
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

const { normalizePoint, denormalizePoint, getThicknessValues, showPeerLeftDialog, enterCanvas, exitCanvas } = require('../js/canvas.js');

// Minimal 2D context stub — jsdom returns null from getContext, but enterCanvas
// needs a context to clear/redraw. A Proxy no-ops every method and stores every
// property assignment (strokeStyle, fillStyle, …).
function fakeCtx() {
  return new Proxy({}, {
    get: (t, p) => (p in t ? t[p] : () => {}),
    set: (t, p, v) => { t[p] = v; return true; },
  });
}

describe('peer-name rendering is XSS-safe', () => {
  test('showPeerLeftDialog escapes a malicious peer name (no element injection)', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById('host');
    const evil = `<img src=x onerror="window.__pwned=1">`;
    showPeerLeftDialog(host, evil, () => {});
    // The payload must be rendered as text, never as elements.
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('.canvas-dialog h3').textContent).toContain('<img src=x');
  });
});

describe('canvas re-entry is idempotent (peer-dot duplication)', () => {
  function setupCanvasDom() {
    document.body.innerHTML = `
      <div id="app-header"></div>
      <div id="favorites-strip"></div>
      <div id="main-list"></div>
      <div id="canvas-screen"><canvas id="draw-canvas"></canvas></div>`;
    HTMLCanvasElement.prototype.getContext = () => fakeCtx();
  }

  // Regression: on the callee's screen the caller's pen-color dot froze at its
  // initial color. Root cause: exitCanvas defers float removal to a fade-out
  // `transitionend` that is skipped when a quick re-enter cancels the out-
  // transition, so a stale #canvas-peer-dot survives. The next enterCanvas
  // appended a SECOND #canvas-peer-dot; getElementById resolves the stale
  // (first) one, so updatePeerDot wrote to a hidden dot while the visible
  // (newer) dot stayed frozen. enterCanvas must leave exactly one dot.
  test('re-entering after an interrupted teardown leaves a single peer dot', async () => {
    setupCanvasDom();
    const screen = document.getElementById('canvas-screen');

    await enterCanvas('peer1', 'Peer', 'me', '#111111', '#abcdef', '#000000', () => {});
    // jsdom never fires `transitionend`, mirroring the interrupted fade-out:
    // exitCanvas's deferred float cleanup does not run.
    exitCanvas();
    await enterCanvas('peer1', 'Peer', 'me', '#111111', '#abcdef', '#000000', () => {});

    expect(screen.querySelectorAll('#canvas-peer-dot')).toHaveLength(1);
    exitCanvas();
  });
});

describe('canvas capture-phase pointerdown listener does not leak per session', () => {
  function setupCanvasDom() {
    document.body.innerHTML = `
      <div id="app-header"></div>
      <div id="favorites-strip"></div>
      <div id="main-list"></div>
      <div id="canvas-screen"><canvas id="draw-canvas"></canvas></div>`;
    HTMLCanvasElement.prototype.getContext = () => fakeCtx();
  }

  // Regression: buildFloatingUI added a capture-phase pointerdown listener via
  // an inline arrow closing over that session's toolbox, on the PERSISTENT
  // #canvas-screen container. exitCanvas never removed it, so every
  // enterCanvas/exitCanvas cycle left one more stale listener behind, each
  // still holding a live reference to its own (now-detached) toolbox element.
  //
  // animateToolbox isn't exported, so we can't spy on call count directly.
  // Instead we hold a reference to session 1's toolbox element (captured
  // before session 2's buildFloatingUI detaches it from the DOM) and mark it
  // '.open'. A single outside-tap pointerdown is then dispatched after two
  // enter/exit cycles. With the leak, session 1's stale listener still fires
  // on that tap and closes ITS toolbox too (toolbox1 loses '.open') even
  // though it belongs to a session that's long gone — i.e. the close effect
  // fires once per past session, not once. Fixed, only the current session's
  // listener is registered, so the stale toolbox1 is untouched.
  test('outside tap after two enter/exit cycles only affects the current session, not stale ones', async () => {
    setupCanvasDom();
    const screen = document.getElementById('canvas-screen');

    await enterCanvas('peer1', 'Peer', 'me', '#111111', '#abcdef', '#000000', () => {});
    const toolbox1 = document.getElementById('canvas-toolbox');
    toolbox1.classList.add('open');
    exitCanvas();

    await enterCanvas('peer1', 'Peer', 'me', '#111111', '#abcdef', '#000000', () => {});
    const toolbox2 = document.getElementById('canvas-toolbox');
    expect(toolbox2).not.toBe(toolbox1); // buildFloatingUI built a fresh toolbox
    toolbox2.classList.add('open');

    // Outside tap: dispatched directly on screen (the target), so it isn't
    // contained by either toolbox — matches the "close" branch for any
    // listener still watching.
    screen.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));

    // Current session's toolbox always closes correctly.
    expect(toolbox2.classList.contains('open')).toBe(false);
    // The stale (session 1) toolbox must NOT be touched — its listener should
    // have been removed by session 1's exitCanvas, not still be leaking.
    expect(toolbox1.classList.contains('open')).toBe(true);

    exitCanvas();
  });
});

describe('canvas coordinate helpers', () => {
  test('normalizePoint converts pixel coords to 0-1 range', () => {
    const result = normalizePoint(100, 200, 400, 800);
    expect(result[0]).toBeCloseTo(0.25);
    expect(result[1]).toBeCloseTo(0.25);
  });

  test('normalizePoint at origin returns [0, 0]', () => {
    const result = normalizePoint(0, 0, 400, 800);
    expect(result).toEqual([0, 0]);
  });

  test('normalizePoint at max returns [1, 1]', () => {
    const result = normalizePoint(400, 800, 400, 800);
    expect(result).toEqual([1, 1]);
  });

  test('denormalizePoint converts 0-1 coords to pixel coords', () => {
    const result = denormalizePoint(0.25, 0.25, 400, 800);
    expect(result[0]).toBeCloseTo(100);
    expect(result[1]).toBeCloseTo(200);
  });

  test('normalize then denormalize is identity', () => {
    const [nx, ny] = normalizePoint(150, 300, 400, 800);
    const [px, py] = denormalizePoint(nx, ny, 400, 800);
    expect(px).toBeCloseTo(150);
    expect(py).toBeCloseTo(300);
  });
});

describe('thickness values', () => {
  test('getThicknessValues returns 6 grades in ascending order', () => {
    const values = getThicknessValues();
    expect(values).toHaveLength(6);
    expect(values[0]).toBeLessThan(values[1]);
    expect(values[1]).toBeLessThan(values[2]);
  });

  test('all thickness values are between 0 and 1', () => {
    getThicknessValues().forEach(v => {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    });
  });
});
