import { makeStoreDeps } from './store-deps.js';
import { readSnapshot, SNAPSHOT_PATHS } from '../ops/snapshot.js';

const NOW = 1_750_000_000_000;

function io({ canvasKeys = [], authUsers = [] } = {}) {
  return {
    listCanvasKeys: async () => canvasKeys,
    listAuthUsers: async () => authUsers,
    now: () => NOW,
  };
}

describe('readSnapshot', () => {
  test('reads every root path and stamps takenAt', async () => {
    const deps = makeStoreDeps({
      'users/u1/presence': { code: 'ABC123', status: 'available', lastSeen: 1000 },
      'userPrefs/u1/notifyChannel': 'push',
      'groups/g1/name': 'Climbers',
      'codeIndex/ABC123': 'u1',
    });

    const snap = await readSnapshot(deps, io());

    expect(snap.users.u1.presence.code).toBe('ABC123');
    expect(snap.userPrefs.u1.notifyChannel).toBe('push');
    expect(snap.groups.g1.name).toBe('Climbers');
    expect(snap.codeIndex.ABC123).toBe('u1');
    expect(snap.takenAt).toBe(NOW);
  });

  test('absent roots become empty objects, never null', async () => {
    const snap = await readSnapshot(makeStoreDeps({}), io());
    for (const path of SNAPSHOT_PATHS) {
      expect(snap[path]).toEqual({});
    }
  });

  test('canvas keys and auth users come from the injected listers', async () => {
    const snap = await readSnapshot(makeStoreDeps({}), io({
      canvasKeys: ['u1_u2'],
      authUsers: [{ uid: 'u1', email: null, createdAt: 900 }],
    }));
    expect(snap.canvasKeys).toEqual(['u1_u2']);
    expect(snap.authUsers).toEqual([{ uid: 'u1', email: null, createdAt: 900 }]);
  });

  test('never reads the canvases subtree itself (strokes are unbounded)', async () => {
    const deps = makeStoreDeps({});
    await readSnapshot(deps, io());
    const readPaths = deps.getVal.mock.calls.map(([p]) => p);
    expect(readPaths).not.toContain('canvases');
    expect(readPaths.some((p) => p.startsWith('canvases'))).toBe(false);
  });
});
