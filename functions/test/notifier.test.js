import { jest } from '@jest/globals';
import { sendToUser, resolveName, handleKnock, handleCall, handleAvailability, resolveGroupMemberName, notifyGroupAvailability, handleGroupOverrideChange } from '../notifier.js';

function makeDeps(overrides = {}) {
  const store = overrides.store || {};
  return {
    store,
    getVal: jest.fn(async (path) => store[path]),
    update: jest.fn(async () => {}),
    send: jest.fn(async () => ({ failedTokens: [] })),
    now: () => 1000,
    ...overrides,
  };
}

describe('sendToUser', () => {
  test('no tokens → no send', async () => {
    const deps = makeDeps({ store: { 'userPrefs/u1/pushTokens': null } });
    await sendToUser(deps, 'u1', { title: 'hi', body: '' }, {});
    expect(deps.send).not.toHaveBeenCalled();
  });
  test('sends to all registered tokens', async () => {
    const deps = makeDeps({ store: { 'userPrefs/u1/pushTokens': { tokA: {}, tokB: {} } } });
    await sendToUser(deps, 'u1', { title: 'hi', body: '' }, { type: 'knock' });
    expect(deps.send).toHaveBeenCalledWith(['tokA', 'tokB'], { title: 'hi', body: '' }, { type: 'knock' });
  });
  test('prunes failed tokens', async () => {
    const deps = makeDeps({ store: { 'userPrefs/u1/pushTokens': { tokA: {}, tokBad: {} } } });
    deps.send = jest.fn(async () => ({ failedTokens: ['tokBad'] }));
    await sendToUser(deps, 'u1', { title: 'hi', body: '' }, {});
    expect(deps.update).toHaveBeenCalledWith('userPrefs/u1/pushTokens', { tokBad: null });
  });
});

describe('resolveName', () => {
  test('prefers the viewer\'s following label, falls back to target code, then "Someone"', async () => {
    const deps = makeDeps({ store: {
      'userPrefs/v/following/t': { label: 'Bea', code: 'x' },
    }});
    expect(await resolveName(deps, 'v', 't')).toBe('Bea');

    const deps2 = makeDeps({ store: { 'users/t/code': 'cool-code' } });
    expect(await resolveName(deps2, 'v', 't')).toBe('cool-code');

    const deps3 = makeDeps({ store: {} });
    expect(await resolveName(deps3, 'v', 't')).toBe('Someone');
  });
});

describe('handleKnock', () => {
  test('Direct knock: uses the Direct name, no group suffix, no contextGroupId', async () => {
    const deps = makeDeps({ store: {
      'userPrefs/rcpt/notify/sndr': { knock: true },
      'userPrefs/rcpt/following/sndr': { label: 'Bea' },
      'userPrefs/rcpt/pushTokens': { tokA: {} },
    }});
    await handleKnock(deps, 'rcpt', 'sndr', { count: 1, ts: 1 });
    expect(deps.send).toHaveBeenCalledWith(['tokA'],
      { title: 'Bea knocked', body: '' },
      { type: 'knock', targetUid: 'sndr' });
  });
  test('group knock: uses the group member displayName and names the group', async () => {
    const deps = makeDeps({ store: {
      'userPrefs/rcpt/notify/sndr': { knock: true },
      'groups/g1/members/sndr/displayName': 'Bobby',
      'groups/g1/name': 'Divers',
      'userPrefs/rcpt/pushTokens': { tokA: {} },
    }});
    await handleKnock(deps, 'rcpt', 'sndr', { count: 1, ts: 1, contextGroupId: 'g1' });
    expect(deps.send).toHaveBeenCalledWith(['tokA'],
      { title: 'Bobby knocked in Divers', body: '' },
      { type: 'knock', targetUid: 'sndr', contextGroupId: 'g1' });
  });
  test('group knock with missing group name → no suffix, still group-scoped name', async () => {
    const deps = makeDeps({ store: {
      'userPrefs/rcpt/notify/sndr': { knock: true },
      'groups/g1/members/sndr/displayName': 'Bobby',
      'userPrefs/rcpt/pushTokens': { tokA: {} },
    }});
    await handleKnock(deps, 'rcpt', 'sndr', { count: 1, ts: 1, contextGroupId: 'g1' });
    expect(deps.send).toHaveBeenCalledWith(['tokA'],
      { title: 'Bobby knocked', body: '' },
      { type: 'knock', targetUid: 'sndr', contextGroupId: 'g1' });
  });
  test('does nothing when not opted in', async () => {
    const deps = makeDeps({ store: { 'userPrefs/rcpt/notify/sndr': { knock: false } } });
    await handleKnock(deps, 'rcpt', 'sndr', { count: 1, ts: 1 });
    expect(deps.send).not.toHaveBeenCalled();
  });
});

describe('handleCall', () => {
  test('notifies the callee when they opted in for the caller', async () => {
    const deps = makeDeps({ store: {
      'userPrefs/callee/notify/caller': { call: true },
      'userPrefs/callee/following/caller': { label: 'Alex K.' },
      'userPrefs/callee/pushTokens': { tokA: {} },
    }});
    await handleCall(deps, 'caller', { calleeId: 'callee', since: 1 });
    expect(deps.send).toHaveBeenCalledWith(['tokA'],
      { title: 'Alex K. is calling', body: '' },
      { type: 'call', targetUid: 'caller' });
  });
  test('does nothing when callState cleared (null) or no calleeId', async () => {
    const deps = makeDeps();
    await handleCall(deps, 'caller', null);
    await handleCall(deps, 'caller', { since: 1 });
    expect(deps.send).not.toHaveBeenCalled();
  });
  test('does nothing when callee did not opt in', async () => {
    const deps = makeDeps({ store: { 'userPrefs/callee/notify/caller': { call: false } } });
    await handleCall(deps, 'caller', { calleeId: 'callee', since: 1 });
    expect(deps.send).not.toHaveBeenCalled();
  });
});

const FUTURE = 9_999_999_999; // >> now (1000)

describe('handleAvailability (narrowed: availableUntil before/after + status read)', () => {
  test('on availableUntil null→future with available status, notifies opted-in followers and stamps cooldown', async () => {
    const deps = makeDeps({ store: {
      'users/star/status': 'available',
      'users/star/followers': { f1: 'code1', f2: 'code2' },
      'userPrefs/f1/notify/star': { availability: true },
      'userPrefs/f2/notify/star': { availability: false },
      'userPrefs/f1/following/star': { label: 'Bea' },
      'userPrefs/f1/pushTokens': { tokF1: {} },
      'notifierState/availability/star': null,
    }});
    await handleAvailability(deps, 'star', null, FUTURE);
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.send).toHaveBeenCalledWith(['tokF1'],
      { title: 'Bea is available', body: '' }, { type: 'availability', targetUid: 'star' });
    expect(deps.update).toHaveBeenCalledWith('notifierState/availability', { star: 1000 });
  });
  test('no notify on re-up (availableUntil future→future)', async () => {
    const deps = makeDeps({ store: { 'users/star/status': 'available' } });
    await handleAvailability(deps, 'star', FUTURE - 1, FUTURE);
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.update).not.toHaveBeenCalled();
  });
  test('debounce: skip if within cooldown of last fire', async () => {
    const deps = makeDeps({ store: {
      'users/star/status': 'available',
      'notifierState/availability/star': 999, // now=1000, cooldown 5min
    }});
    await handleAvailability(deps, 'star', null, FUTURE);
    expect(deps.send).not.toHaveBeenCalled();
  });
  test('does NOT stamp the cooldown when nothing was delivered (no tokens)', async () => {
    const deps = makeDeps({ store: {
      'users/star/status': 'available',
      'users/star/followers': { f1: 'code1' },
      'userPrefs/f1/notify/star': { availability: true },
      // f1 has no pushTokens → nothing delivered
      'notifierState/availability/star': null,
    }});
    await handleAvailability(deps, 'star', null, FUTURE);
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.update).not.toHaveBeenCalledWith('notifierState/availability', expect.anything());
  });
  test('one follower send failure does not abort the fan-out; stamps on any success', async () => {
    const deps = makeDeps({ store: {
      'users/star/status': 'available',
      'users/star/followers': { f1: 'c1', f2: 'c2' },
      'userPrefs/f1/notify/star': { availability: true },
      'userPrefs/f2/notify/star': { availability: true },
      'userPrefs/f1/pushTokens': { tokF1: {} },
      'userPrefs/f2/pushTokens': { tokF2: {} },
      'notifierState/availability/star': null,
    }});
    deps.send = jest.fn(async (tokens) => {
      if (tokens[0] === 'tokF1') throw new Error('fcm down');
      return { failedTokens: [] };
    });
    await handleAvailability(deps, 'star', null, FUTURE);
    expect(deps.send).toHaveBeenCalledTimes(2); // both attempted despite f1 throwing
    expect(deps.update).toHaveBeenCalledWith('notifierState/availability', { star: 1000 });
  });
});

describe('resolveGroupMemberName', () => {
  test('prefers the group member displayName, then user code, then "Someone"', async () => {
    const deps1 = makeDeps({ store: { 'groups/g1/members/u/displayName': 'Bobby' } });
    expect(await resolveGroupMemberName(deps1, 'g1', 'u')).toBe('Bobby');

    const deps2 = makeDeps({ store: { 'users/u/code': 'ABC123' } });
    expect(await resolveGroupMemberName(deps2, 'g1', 'u')).toBe('ABC123');

    const deps3 = makeDeps({ store: {} });
    expect(await resolveGroupMemberName(deps3, 'g1', 'u')).toBe('Someone');
  });
});

describe('notifyGroupAvailability', () => {
  function groupStore(extra = {}) {
    return {
      'groups/g1/name': 'Divers',
      'groups/g1/members/m/displayName': 'Bobby',
      'groups/g1/members': { m: {}, co1: {}, co2: {} },
      'userPrefs/co1/notify/m': { availability: true },
      'userPrefs/co2/notify/m': { availability: false },
      'userPrefs/co1/pushTokens': { tokCo1: {} },
      'notifierState/groupAvailability/g1/m': null,
      ...extra,
    };
  }
  test('notifies opted-in co-members (not the member, not opted-out), stamps cooldown', async () => {
    const deps = makeDeps({ store: groupStore() });
    await notifyGroupAvailability(deps, 'g1', 'm', 1000);
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.send).toHaveBeenCalledWith(['tokCo1'],
      { title: 'Bobby is available in Divers', body: '' },
      { type: 'availability', targetUid: 'm', contextGroupId: 'g1' });
    expect(deps.update).toHaveBeenCalledWith('notifierState/groupAvailability/g1', { m: 1000 });
  });
  test('within cooldown → no send', async () => {
    const deps = makeDeps({ store: groupStore({ 'notifierState/groupAvailability/g1/m': 999 }) });
    await notifyGroupAvailability(deps, 'g1', 'm', 1000);
    expect(deps.send).not.toHaveBeenCalled();
  });
  test('nothing delivered (no tokens) → does not stamp cooldown', async () => {
    const deps = makeDeps({ store: groupStore({ 'userPrefs/co1/pushTokens': null }) });
    await notifyGroupAvailability(deps, 'g1', 'm', 1000);
    expect(deps.update).not.toHaveBeenCalledWith('notifierState/groupAvailability/g1', expect.anything());
  });
});

describe('handleGroupOverrideChange', () => {
  const AVAIL = { enabled: true, status: 'available', availableUntil: FUTURE };
  const UNAVAIL = { enabled: true, status: 'unavailable', availableUntil: null };
  function store(extra = {}) {
    return {
      'groups/g1/name': 'Divers',
      'groups/g1/members/m/displayName': 'Bobby',
      'groups/g1/members': { m: {}, co1: {} },
      'userPrefs/co1/notify/m': { availability: true },
      'userPrefs/co1/pushTokens': { tokCo1: {} },
      'notifierState/groupAvailability/g1/m': null,
      ...extra,
    };
  }
  test('override flips unavailable→available → notifies', async () => {
    const deps = makeDeps({ store: store() });
    await handleGroupOverrideChange(deps, 'g1', 'm', UNAVAIL, AVAIL);
    expect(deps.send).toHaveBeenCalledWith(['tokCo1'],
      { title: 'Bobby is available in Divers', body: '' },
      { type: 'availability', targetUid: 'm', contextGroupId: 'g1' });
  });
  test('appearance-only change (still available) → no send', async () => {
    const deps = makeDeps({ store: store() });
    await handleGroupOverrideChange(deps, 'g1', 'm',
      { ...AVAIL, statusColor: '#111' }, { ...AVAIL, statusColor: '#222' });
    expect(deps.send).not.toHaveBeenCalled();
  });
  test('before == null (member just joined) → no send', async () => {
    const deps = makeDeps({ store: store() });
    await handleGroupOverrideChange(deps, 'g1', 'm', null, AVAIL);
    expect(deps.send).not.toHaveBeenCalled();
  });
  test('override turned OFF but primary is available → effective on → notifies', async () => {
    const deps = makeDeps({ store: store({
      'users/m/status': 'available',
      'users/m/availableUntil': FUTURE,
    }) });
    await handleGroupOverrideChange(deps, 'g1', 'm', UNAVAIL, { enabled: false });
    expect(deps.send).toHaveBeenCalledTimes(1);
  });
});
