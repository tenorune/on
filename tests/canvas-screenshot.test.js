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
