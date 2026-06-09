// tests/canvas.test.js

jest.mock('../js/firebase-config.js', () => ({ db: {} }));
jest.mock('firebase/database', () => ({
  ref: jest.fn(() => 'mockRef'),
  get: jest.fn(() => Promise.resolve({ exists: () => false, val: () => null })),
  push: jest.fn(() => Promise.resolve()),
  update: jest.fn(() => Promise.resolve()),
  set: jest.fn(),
  remove: jest.fn(),
  onValue: jest.fn(),
  onChildAdded: jest.fn(() => jest.fn()),
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

const { normalizePoint, denormalizePoint, getThicknessValues, showPeerLeftDialog } = require('../js/canvas.js');

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
