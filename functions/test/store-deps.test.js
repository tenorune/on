import { makeStoreDeps } from './store-deps.js';

// Fidelity contract for the shared RTDB mock — the two real-RTDB behaviors
// the old per-file flat mocks could not model (HANDOFF §38):
//  1. update() rejects a write map where one path is an ancestor of another.
//  2. Writing a node REPLACES it wholesale (descendants die with it), and
//     reads assemble a subtree instead of only hitting the exact flat key.

describe('makeStoreDeps update(): ancestor-overlap rejection', () => {
  test('a path that is an ancestor of another path in the same update throws', async () => {
    const deps = makeStoreDeps();
    await expect(deps.update('/', {
      'users/u1': null,
      'users/u1/presence': null,
    })).rejects.toThrow(/ancestor/);
  });
  test('order does not matter (descendant listed first still throws)', async () => {
    const deps = makeStoreDeps();
    await expect(deps.update('/', {
      'userPrefs/u1/following/u2': null,
      'userPrefs/u1': null,
    })).rejects.toThrow(/ancestor/);
  });
  test('a rejected update writes NOTHING (all-or-nothing, like the SDK argument check)', async () => {
    const deps = makeStoreDeps({ 'users/u1/presence': { code: 'AAAAAA' } });
    await deps.update('/', { 'users/u1': null, 'users/u1/presence': null }).catch(() => {});
    expect(await deps.getVal('users/u1/presence')).toEqual({ code: 'AAAAAA' });
  });
  test('sibling and prefix-but-not-ancestor paths are fine', async () => {
    const deps = makeStoreDeps();
    await deps.update('/', {
      'users/u1': { a: 1 },
      'users/u10': { b: 2 },       // string prefix, NOT a path ancestor
      'userPrefs/u1/following': { u2: true },
    });
    expect(await deps.getVal('users/u10')).toEqual({ b: 2 });
  });
});

describe('makeStoreDeps: whole-node writes replace descendants', () => {
  test('set() on a node clears previously-seeded deeper flat keys', async () => {
    const deps = makeStoreDeps({ 'users/u1/presence': { code: 'AAAAAA' }, 'users/u1/name': 'Ada' });
    await deps.set('users/u1', { presence: { code: 'BBBBBB' } });
    expect(await deps.getVal('users/u1/name')).toBeNull();
    expect(await deps.getVal('users/u1/presence')).toEqual({ code: 'BBBBBB' });
  });
  test('nulling a node via update() deletes its whole subtree', async () => {
    const deps = makeStoreDeps({ 'users/u1/presence': { code: 'AAAAAA' } });
    await deps.update('/', { 'users/u1': null });
    expect(await deps.getVal('users/u1/presence')).toBeNull();
    expect(await deps.getVal('users/u1')).toBeNull();
    // The flat deletion marker stays visible to direct store assertions.
    expect(deps.store['users/u1']).toBeNull();
  });
});

describe('makeStoreDeps getVal(): subtree assembly', () => {
  test('reading a node assembles deeper flat keys into one object', async () => {
    const deps = makeStoreDeps({
      'users/u1/presence': { code: 'AAAAAA' },
      'users/u1/followers/u2': true,
    });
    expect(await deps.getVal('users/u1')).toEqual({
      presence: { code: 'AAAAAA' },
      followers: { u2: true },
    });
  });
  test('reading a deep path descends into a whole-node value', async () => {
    const deps = makeStoreDeps({ 'users/u1': { presence: { code: 'AAAAAA' }, name: 'Ada' } });
    expect(await deps.getVal('users/u1/presence')).toEqual({ code: 'AAAAAA' });
    expect(await deps.getVal('users/u1/presence/code')).toBe('AAAAAA');
    expect(await deps.getVal('users/u1/missing')).toBeNull();
  });
  test('a deeper write overrides content embedded in a shallower seed', async () => {
    const deps = makeStoreDeps({ 'users/u1': { presence: { code: 'AAAAAA' }, name: 'Ada' } });
    await deps.set('users/u1/presence', { code: 'BBBBBB' });
    expect(await deps.getVal('users/u1/presence')).toEqual({ code: 'BBBBBB' });
    expect((await deps.getVal('users/u1')).name).toBe('Ada');
  });
  test('a deep null marker deletes that subpath from the assembled parent', async () => {
    const deps = makeStoreDeps({ 'users/u1': { presence: { code: 'AAAAAA' }, name: 'Ada' } });
    await deps.update('/', { 'users/u1/presence': null });
    expect(await deps.getVal('users/u1/presence')).toBeNull();
    expect(await deps.getVal('users/u1')).toEqual({ name: 'Ada' });
  });
  test('a node that is empty after deletions reads as null (RTDB prunes empty nodes)', async () => {
    const deps = makeStoreDeps({ 'knocks/u1/k1': { at: 1 } });
    await deps.update('/', { 'knocks/u1/k1': null });
    expect(await deps.getVal('knocks/u1')).toBeNull();
  });
});

describe('makeStoreDeps transaction(): reads/writes the assembled tree', () => {
  test('transaction sees a value embedded in a whole-node seed', async () => {
    const deps = makeStoreDeps({ codeIndex: { AAAAAA: 'u1' } });
    const { committed } = await deps.transaction('codeIndex/AAAAAA', (cur) => {
      if (cur !== null) return undefined;
      return 'u2';
    });
    expect(committed).toBe(false);
  });
});
