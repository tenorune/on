// tests/groupNav.test.js
jest.mock('../js/db.js', () => ({
  setCurrentContext: jest.fn().mockResolvedValue(undefined),
  setLastVisited: jest.fn().mockResolvedValue(undefined),
}));

const db = require('../js/db.js');
const {
  initNav, getCurrentContext, navigateToDirect, navigateToGroup,
  onContextChange, applyServerCurrentContext,
} = require('../js/groupNav');

describe('groupNav state machine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    initNav('uid1');
  });

  test('initNav defaults to direct context', () => {
    expect(getCurrentContext()).toEqual({ context: 'direct', groupId: null });
  });

  test('navigateToGroup writes currentContext + lastVisited and emits change', async () => {
    const seen = [];
    onContextChange((ctx) => seen.push(ctx));
    await navigateToGroup('G1');
    expect(getCurrentContext()).toEqual({ context: 'group', groupId: 'G1' });
    expect(db.setCurrentContext).toHaveBeenCalledWith('uid1', 'group:G1');
    expect(db.setLastVisited).toHaveBeenCalledWith('uid1', 'G1', expect.any(Number));
    expect(seen[seen.length - 1]).toEqual({ context: 'group', groupId: 'G1' });
  });

  test('navigateToDirect writes direct + emits change', async () => {
    await navigateToGroup('G1');
    const seen = [];
    onContextChange((ctx) => seen.push(ctx));
    await navigateToDirect();
    expect(getCurrentContext()).toEqual({ context: 'direct', groupId: null });
    expect(db.setCurrentContext).toHaveBeenCalledWith('uid1', 'direct');
    expect(seen[seen.length - 1]).toEqual({ context: 'direct', groupId: null });
  });

  test('navigation is idempotent: same context twice does not double-write', async () => {
    await navigateToGroup('G1');
    db.setCurrentContext.mockClear();
    await navigateToGroup('G1');
    expect(db.setCurrentContext).not.toHaveBeenCalled();
  });

  test('applyServerCurrentContext updates local state without round-tripping to Firebase', () => {
    const seen = [];
    onContextChange((ctx) => seen.push(ctx));
    applyServerCurrentContext('group:G2');
    expect(getCurrentContext()).toEqual({ context: 'group', groupId: 'G2' });
    expect(db.setCurrentContext).not.toHaveBeenCalled();
    expect(seen[seen.length - 1]).toEqual({ context: 'group', groupId: 'G2' });
  });

  test('applyServerCurrentContext for direct works', () => {
    applyServerCurrentContext('group:G2');
    applyServerCurrentContext('direct');
    expect(getCurrentContext()).toEqual({ context: 'direct', groupId: null });
  });

  test('applyServerCurrentContext no-ops when already in the same context', () => {
    const seen = [];
    onContextChange((ctx) => seen.push(ctx));
    applyServerCurrentContext('direct');
    expect(seen.length).toBe(0);
  });

  test('falls back to direct when server provides a malformed value', () => {
    applyServerCurrentContext('garbage');
    expect(getCurrentContext()).toEqual({ context: 'direct', groupId: null });
  });
});
