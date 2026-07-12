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
