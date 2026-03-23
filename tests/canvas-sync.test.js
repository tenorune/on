// tests/canvas-sync.test.js
jest.mock('../js/firebase-config.js', () => ({ db: {} }));
jest.mock('firebase/database', () => ({
  ref: jest.fn(() => 'mockRef'),
  get: jest.fn(),
  set: jest.fn(),
  push: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  onValue: jest.fn(),
  onChildAdded: jest.fn(() => jest.fn()),
  runTransaction: jest.fn(),
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

  test('same ID produces consistent result regardless of order', () => {
    expect(getCanvasId('abc', 'def')).toBe(getCanvasId('def', 'abc'));
  });
});

describe('pushStroke', () => {
  test('calls push with stroke data on the strokes path', async () => {
    const { ref, push } = require('firebase/database');
    push.mockResolvedValue({ key: 'stroke123' });
    const stroke = { userId: 'u1', color: '#ff0000', thickness: 0.012, tool: 'pen', points: [[0.1, 0.2]], timestamp: 1000 };
    const key = await pushStroke('a_b', stroke);
    expect(ref).toHaveBeenCalledWith({}, 'canvases/a_b/strokes');
    expect(push).toHaveBeenCalledWith('mockRef', stroke);
    expect(key).toBe('stroke123');
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
