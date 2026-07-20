import { jest } from '@jest/globals';
import { handleCallCleanup } from '../call-cleanup.js';

const mkDeps = (store = {}) => ({
  getVal: jest.fn(async (p) => (p in store ? store[p] : null)),
  set: jest.fn(async () => {}),
});

describe('handleCallCleanup', () => {
  test('nulls the counterpart when it still references the removed user (callee removed)', async () => {
    // callee's node was deleted; its .from pointed at caller. Caller's node still
    // points back at callee → reap it so the caller isn't stranded on the canvas.
    const deps = mkDeps({ 'calls/caller': { to: 'callee', answered: true, ts: 1 } });
    await handleCallCleanup(deps, 'callee', { from: 'caller', answered: true, ts: 1 });
    expect(deps.set).toHaveBeenCalledWith('calls/caller', null);
  });

  test('resolves the peer from the removed node .to as well (caller removed)', async () => {
    const deps = mkDeps({ 'calls/callee': { from: 'caller', ts: 1 } });
    await handleCallCleanup(deps, 'caller', { to: 'callee', ts: 1 });
    expect(deps.set).toHaveBeenCalledWith('calls/callee', null);
  });

  test('leaves a counterpart that has moved on to a different call', async () => {
    const deps = mkDeps({ 'calls/caller': { to: 'someoneElse', ts: 2 } });
    await handleCallCleanup(deps, 'callee', { from: 'caller', ts: 1 });
    expect(deps.set).not.toHaveBeenCalled();
  });

  test('no-op when the counterpart mailbox is already gone (avoids reap loop)', async () => {
    const deps = mkDeps({});
    await handleCallCleanup(deps, 'callee', { from: 'caller', ts: 1 });
    expect(deps.set).not.toHaveBeenCalled();
  });

  test('no-op when the removed node carried no peer reference', async () => {
    const deps = mkDeps({ 'calls/x': { to: 'callee', ts: 1 } });
    await handleCallCleanup(deps, 'callee', { ts: 1 });
    expect(deps.set).not.toHaveBeenCalled();
  });

  test('no-op when there is no before value', async () => {
    const deps = mkDeps({});
    await handleCallCleanup(deps, 'callee', null);
    expect(deps.set).not.toHaveBeenCalled();
  });
});
