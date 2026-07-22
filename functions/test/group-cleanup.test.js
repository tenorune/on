import { jest } from '@jest/globals';
import { handleMemberRemoved } from '../group-cleanup.js';

describe('handleMemberRemoved', () => {
  const mkDeps = () => ({ set: jest.fn(() => Promise.resolve()) });

  test('deletes the member cell on a real removal (before set, after null)', async () => {
    const deps = mkDeps();
    await handleMemberRemoved(deps, 'G1', 'bob', { role: 'member' }, null);
    expect(deps.set).toHaveBeenCalledWith('locationCells/G1/bob', null);
  });

  test('no-op when this is not a deletion (after still present)', async () => {
    const deps = mkDeps();
    await handleMemberRemoved(deps, 'G1', 'bob', { role: 'member' }, { role: 'admin' });
    expect(deps.set).not.toHaveBeenCalled();
  });

  test('no-op when there was no member before (spurious create/no-op)', async () => {
    const deps = mkDeps();
    await handleMemberRemoved(deps, 'G1', 'bob', null, null);
    expect(deps.set).not.toHaveBeenCalled();
  });
});
