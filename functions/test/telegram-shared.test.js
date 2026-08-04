import { makeStoreDeps } from './store-deps.js';
import { rootUpdate } from '../telegram-shared.js';

// rootUpdate is the ONE way functions/ issues a multi-path root update
// (HANDOFF §38): real RTDB rejects an update where one path is an ancestor
// of another, a contract eight hand-built write-maps rely on but only
// expunge self-enforces. The helper drops a REDUNDANT overlap (a null
// descendant under a null ancestor — the delete already covers it) and
// throws on any other overlap, so a future residue path added under a
// wholesale-deleted subtree can't blow up the whole update in production.

describe('rootUpdate', () => {
  test('passes disjoint writes through as ONE root update', async () => {
    const deps = makeStoreDeps();
    await rootUpdate(deps, { 'users/u1/presence': { code: 'AAAAAA' }, 'codeIndex/AAAAAA': 'u1' });
    expect(deps.update).toHaveBeenCalledTimes(1);
    expect(deps.update).toHaveBeenCalledWith('/', {
      'users/u1/presence': { code: 'AAAAAA' },
      'codeIndex/AAAAAA': 'u1',
    });
  });
  test('filters a null descendant already covered by a null ancestor', async () => {
    const deps = makeStoreDeps({ 'users/u1/presence': { code: 'AAAAAA' } });
    await rootUpdate(deps, {
      'users/u1': null,
      'users/u1/followers/u2': null, // redundant — the wholesale delete covers it
      'codeIndex/AAAAAA': null,
    });
    expect(deps.update).toHaveBeenCalledWith('/', { 'users/u1': null, 'codeIndex/AAAAAA': null });
    expect(await deps.getVal('users/u1')).toBeNull();
  });
  test('throws on a VALUE write under an ancestor also being written', async () => {
    const deps = makeStoreDeps();
    await expect(rootUpdate(deps, {
      'users/u1': { presence: { code: 'AAAAAA' } },
      'users/u1/followers/u2': 'F2CODE',
    })).rejects.toThrow(/ancestor/);
    expect(deps.update).not.toHaveBeenCalled();
  });
  test('throws on a value write under a null ancestor (not a redundant delete)', async () => {
    const deps = makeStoreDeps();
    await expect(rootUpdate(deps, {
      'users/u1': null,
      'users/u1/followers/u2': 'F2CODE',
    })).rejects.toThrow(/ancestor/);
    expect(deps.update).not.toHaveBeenCalled();
  });
  test('throws on a null descendant under a VALUE ancestor (delete would be lost)', async () => {
    const deps = makeStoreDeps();
    await expect(rootUpdate(deps, {
      'users/u1': { name: 'Ada' },
      'users/u1/followers/u2': null,
    })).rejects.toThrow(/ancestor/);
    expect(deps.update).not.toHaveBeenCalled();
  });
  test('an empty write map is a no-op (no update call)', async () => {
    const deps = makeStoreDeps();
    await rootUpdate(deps, {});
    expect(deps.update).not.toHaveBeenCalled();
  });
});

// SEC-4 — rootUpdate decided whether a write-map was conflict-free by RAW
// STRING prefix, and the SDK decides it on the path it will actually write.
// Those are not the same function. Probed offline against the installed
// firebase-admin: `db.ref('a//b')` is `/a/b`, `ref('users//')` is `/users`, and
// `update('/', {'a//': null, 'a/b': null})` is REJECTED for the ancestor overlap
// that rootUpdate had just certified absent, while `{'x//y': 1}` is accepted and
// silently retargeted to `/x/y`. Empty segments are dropped, so a key is not the
// path it looks like — which is the same collapse behind SEC-1/B and SEC-2, and
// this is the systemic backstop under both.
describe('rootUpdate refuses a key that is not the path it names', () => {
  // Collapsing these to `x/y` / `users/u1` and sending them would make
  // rootUpdate AGREE with the SDK, which is all the disagreement above
  // strictly requires — but it would still let `users/${uid}` with an empty
  // uid land as a write to the whole `users` node, with the overlap analysis
  // nodding along. An empty segment is never intentional (an RTDB key cannot
  // be empty), so the write-map is refused rather than reinterpreted.
  test.each(['x//y', '/users/u1/', 'a//', 'users//'])('%p is refused, and nothing is written', async (key) => {
    const deps = makeStoreDeps();
    await expect(rootUpdate(deps, { [key]: null })).rejects.toThrow(/empty segment/);
    expect(deps.update).not.toHaveBeenCalled();
  });

  // The whole map dies with the bad key: these updates are atomic, and half of
  // a destructive write-set is worse than none of it.
  test('one bad key refuses the whole write-map', async () => {
    const deps = makeStoreDeps();
    await expect(rootUpdate(deps, { 'users/u1': null, 'a//': null })).rejects.toThrow(/empty segment/);
    expect(deps.update).not.toHaveBeenCalled();
  });

  // The sharpest edge: a key that collapses to nothing at all is an update AT
  // THE ROOT, which replaces the entire database.
  test.each(['/', '', '//', '///'])('a key naming the root (%p) is refused', async (key) => {
    const deps = makeStoreDeps();
    await expect(rootUpdate(deps, { [key]: null })).rejects.toThrow(/root/);
    expect(deps.update).not.toHaveBeenCalled();
  });

  // With the above refused, every surviving key IS its own path, so the
  // ancestor check below can go on comparing raw strings and be right by
  // construction. The ordinary case must be untouched: every shipped caller
  // builds keys by interpolating a uid, gid or token, and none of those can
  // contain a slash.
  test('a well-formed write-map is passed through unchanged', async () => {
    const deps = makeStoreDeps();
    const writes = { 'users/u1/presence': { code: 'AAAAAA' }, 'codeIndex/AAAAAA': 'u1' };
    await rootUpdate(deps, writes);
    expect(deps.update).toHaveBeenCalledWith('/', writes);
  });
});
