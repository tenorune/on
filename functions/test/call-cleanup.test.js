import { jest } from '@jest/globals';
import { handleCallCleanup, handleCallSweep, CALL_TTL_MS } from '../call-cleanup.js';

const mkDeps = (store = {}) => ({
  getVal: jest.fn(async (p) => (p in store ? store[p] : null)),
  set: jest.fn(async () => {}),
});

// Deps for the sweep: reads the whole calls/ map, nulls stale entries via update.
const NOW = 1_800_000_000_000;
const mkSweepDeps = (callsMap) => ({
  now: () => NOW,
  getVal: jest.fn(async (p) => (p === 'calls' ? callsMap : null)),
  update: jest.fn(async () => {}),
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

describe('handleCallSweep', () => {
  test('nulls a mailbox whose ts is older than the TTL', async () => {
    const deps = mkSweepDeps({ stale: { to: 'x', ts: NOW - CALL_TTL_MS - 1 } });
    const swept = await handleCallSweep(deps, CALL_TTL_MS);
    expect(deps.update).toHaveBeenCalledWith('calls', { stale: null });
    expect(swept).toEqual(['stale']);
  });

  test('keeps a mailbox within the TTL', async () => {
    const deps = mkSweepDeps({ fresh: { to: 'x', ts: NOW - 1000 } });
    const swept = await handleCallSweep(deps, CALL_TTL_MS);
    expect(deps.update).not.toHaveBeenCalled();
    expect(swept).toEqual([]);
  });

  test('sweeps only the stale entries in a mixed set (one update)', async () => {
    const deps = mkSweepDeps({
      old1: { to: 'a', ts: NOW - CALL_TTL_MS - 5 },
      liveNow: { from: 'b', ts: NOW - 60_000 },
      old2: { from: 'c', ts: NOW - CALL_TTL_MS - 999 },
    });
    const swept = await handleCallSweep(deps, CALL_TTL_MS);
    expect(deps.update).toHaveBeenCalledTimes(1);
    expect(deps.update).toHaveBeenCalledWith('calls', { old1: null, old2: null });
    expect(swept.sort()).toEqual(['old1', 'old2']);
  });

  test('sweeps a malformed node with no numeric ts (never a live call)', async () => {
    const deps = mkSweepDeps({ junk: { answered: true } });
    await handleCallSweep(deps, CALL_TTL_MS);
    expect(deps.update).toHaveBeenCalledWith('calls', { junk: null });
  });

  test('no-op when calls/ is empty or absent', async () => {
    const empty = mkSweepDeps(null);
    await handleCallSweep(empty, CALL_TTL_MS);
    expect(empty.update).not.toHaveBeenCalled();
  });
});
