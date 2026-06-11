import { jest } from '@jest/globals';
import { sendToUser, resolveName, handleKnock, handleCall, handleAvailability, resolveGroupMemberName, notifyGroupAvailability, handleGroupOverrideChange, handleInvite, handleFollowRequest } from '../notifier.js';

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

    const deps2 = makeDeps({ store: { 'users/t/presence/code': 'cool-code' } });
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
    await handleCall(deps, 'callee', 'caller');
    expect(deps.send).toHaveBeenCalledWith(['tokA'],
      { title: 'Alex K. is calling', body: '' },
      { type: 'call', targetUid: 'caller' });
  });
  test('does nothing when callee did not opt in', async () => {
    const deps = makeDeps({ store: { 'userPrefs/callee/notify/caller': { call: false } } });
    await handleCall(deps, 'callee', 'caller');
    expect(deps.send).not.toHaveBeenCalled();
  });
});

const FUTURE = 9_999_999_999; // >> now (1000)

describe('handleAvailability (narrowed: availableUntil before/after + status read)', () => {
  test('on availableUntil null→future with available status, notifies opted-in followers and stamps cooldown', async () => {
    const deps = makeDeps({ store: {
      'users/star/presence/status': 'available',
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
    const deps = makeDeps({ store: { 'users/star/presence/status': 'available' } });
    await handleAvailability(deps, 'star', FUTURE - 1, FUTURE);
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.update).not.toHaveBeenCalled();
  });
  test('debounce: skip if within cooldown of last fire', async () => {
    const deps = makeDeps({ store: {
      'users/star/presence/status': 'available',
      'notifierState/availability/star': 999, // now=1000, cooldown 5min
    }});
    await handleAvailability(deps, 'star', null, FUTURE);
    expect(deps.send).not.toHaveBeenCalled();
  });
  test('does NOT stamp the cooldown when nothing was delivered (no tokens)', async () => {
    const deps = makeDeps({ store: {
      'users/star/presence/status': 'available',
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
      'users/star/presence/status': 'available',
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

    const deps2 = makeDeps({ store: { 'users/u/presence/code': 'ABC123' } });
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
  test('alreadyNotified set: skips members already in it, adds the ones it notifies', async () => {
    const deps = makeDeps({ store: groupStore({
      'userPrefs/co2/notify/m': { availability: true },
      'userPrefs/co2/pushTokens': { tokCo2: {} },
    }) });
    const seen = new Set(['co1']); // co1 already got a push elsewhere
    await notifyGroupAvailability(deps, 'g1', 'm', 1000, seen);
    expect(deps.send).toHaveBeenCalledTimes(1); // only co2
    expect(deps.send).toHaveBeenCalledWith(['tokCo2'],
      { title: 'Bobby is available in Divers', body: '' },
      { type: 'availability', targetUid: 'm', contextGroupId: 'g1' });
    expect(seen.has('co2')).toBe(true);
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
      'users/m/presence/status': 'available',
      'users/m/presence/availableUntil': FUTURE,
    }) });
    await handleGroupOverrideChange(deps, 'g1', 'm', UNAVAIL, { enabled: false });
    expect(deps.send).toHaveBeenCalledTimes(1);
  });
});

describe('handleAvailability → group co-members (primary path)', () => {
  test('notifies co-members of override-OFF groups, skips override-ON groups', async () => {
    const deps = makeDeps({ store: {
      'users/star/presence/status': 'available',
      'users/star/presence/availableUntil': FUTURE,
      'users/star/followers': null,
      'users/star/groups': { gOff: true, gOn: true },
      // gOff: override disabled → group shows primary → notify
      'groups/gOff/members/star/statusOverride': { enabled: false },
      'groups/gOff/name': 'OffGroup',
      'groups/gOff/members/star/displayName': 'Star',
      'groups/gOff/members': { star: {}, a: {} },
      'userPrefs/a/notify/star': { availability: true },
      'userPrefs/a/pushTokens': { tokA: {} },
      'notifierState/groupAvailability/gOff/star': null,
      // gOn: override enabled → handled by onMemberOverride, not the primary path
      'groups/gOn/members/star/statusOverride': { enabled: true, status: 'available', availableUntil: FUTURE },
      'groups/gOn/members': { star: {}, b: {} },
      'userPrefs/b/notify/star': { availability: true },
      'userPrefs/b/pushTokens': { tokB: {} },
      'notifierState/availability/star': null,
    }});
    await handleAvailability(deps, 'star', null, FUTURE);
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.send).toHaveBeenCalledWith(['tokA'],
      { title: 'Star is available in OffGroup', body: '' },
      { type: 'availability', targetUid: 'star', contextGroupId: 'gOff' });
  });
  test('group fan-out runs even when the Direct cooldown is active', async () => {
    const deps = makeDeps({ store: {
      'users/star/presence/status': 'available',
      'users/star/presence/availableUntil': FUTURE,
      'users/star/groups': { gOff: true },
      'groups/gOff/members/star/statusOverride': null, // absent → treated as off
      'groups/gOff/name': 'OffGroup',
      'groups/gOff/members/star/displayName': 'Star',
      'groups/gOff/members': { star: {}, a: {} },
      'userPrefs/a/notify/star': { availability: true },
      'userPrefs/a/pushTokens': { tokA: {} },
      'notifierState/availability/star': 999, // Direct within cooldown (now=1000)
      'notifierState/groupAvailability/gOff/star': null,
    }});
    await handleAvailability(deps, 'star', null, FUTURE);
    expect(deps.send).toHaveBeenCalledTimes(1); // group send, despite Direct cooldown
    expect(deps.send).toHaveBeenCalledWith(['tokA'],
      { title: 'Star is available in OffGroup', body: '' },
      { type: 'availability', targetUid: 'star', contextGroupId: 'gOff' });
  });
});

describe('handleAvailability → one push per recipient (dedup)', () => {
  test('a follower who is also a co-member of two override-off groups gets ONE Direct push', async () => {
    const deps = makeDeps({ store: {
      'users/bob/presence/status': 'available',
      'users/bob/presence/availableUntil': FUTURE,
      'users/bob/followers': { ann: 'codeAnn' },
      'userPrefs/ann/notify/bob': { availability: true },
      'userPrefs/ann/following/bob': { label: 'Bobby' },
      'userPrefs/ann/pushTokens': { tokAnn: {} },
      'users/bob/groups': { g1: true, g2: true },
      'groups/g1/members/bob/statusOverride': { enabled: false },
      'groups/g2/members/bob/statusOverride': { enabled: false },
      'groups/g1/members': { bob: {}, ann: {} },
      'groups/g2/members': { bob: {}, ann: {} },
      'groups/g1/name': 'G1', 'groups/g2/name': 'G2',
      'groups/g1/members/bob/displayName': 'BobG1',
      'groups/g2/members/bob/displayName': 'BobG2',
      'notifierState/availability/bob': null,
      'notifierState/groupAvailability/g1/bob': null,
      'notifierState/groupAvailability/g2/bob': null,
    }});
    await handleAvailability(deps, 'bob', null, FUTURE);
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.send).toHaveBeenCalledWith(['tokAnn'],
      { title: 'Bobby is available', body: '' },
      { type: 'availability', targetUid: 'bob' });
  });

  test('a co-member of two override-off groups (not a follower) gets ONE group push (first group wins)', async () => {
    const deps = makeDeps({ store: {
      'users/bob/presence/status': 'available',
      'users/bob/presence/availableUntil': FUTURE,
      'users/bob/followers': null,
      'userPrefs/ann/notify/bob': { availability: true },
      'userPrefs/ann/pushTokens': { tokAnn: {} },
      'users/bob/groups': { g1: true, g2: true },
      'groups/g1/members/bob/statusOverride': { enabled: false },
      'groups/g2/members/bob/statusOverride': { enabled: false },
      'groups/g1/members': { bob: {}, ann: {} },
      'groups/g2/members': { bob: {}, ann: {} },
      'groups/g1/name': 'G1', 'groups/g2/name': 'G2',
      'groups/g1/members/bob/displayName': 'BobG1',
      'groups/g2/members/bob/displayName': 'BobG2',
      'notifierState/groupAvailability/g1/bob': null,
      'notifierState/groupAvailability/g2/bob': null,
    }});
    await handleAvailability(deps, 'bob', null, FUTURE);
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.send).toHaveBeenCalledWith(['tokAnn'],
      { title: 'BobG1 is available in G1', body: '' },
      { type: 'availability', targetUid: 'bob', contextGroupId: 'g1' });
  });

  test('Direct owns a follower even when the Direct cooldown suppresses the send (no group double)', async () => {
    const deps = makeDeps({ store: {
      'users/bob/presence/status': 'available',
      'users/bob/presence/availableUntil': FUTURE,
      'users/bob/followers': { ann: 'codeAnn' },
      'userPrefs/ann/notify/bob': { availability: true },
      'userPrefs/ann/pushTokens': { tokAnn: {} },
      'users/bob/groups': { g1: true },
      'groups/g1/members/bob/statusOverride': { enabled: false },
      'groups/g1/members': { bob: {}, ann: {} },
      'groups/g1/name': 'G1',
      'groups/g1/members/bob/displayName': 'BobG1',
      'notifierState/availability/bob': 999, // Direct within cooldown (now=1000)
      'notifierState/groupAvailability/g1/bob': null,
    }});
    await handleAvailability(deps, 'bob', null, FUTURE);
    expect(deps.send).not.toHaveBeenCalled(); // Direct cooled, group skips the follower
  });
});

describe('handleInvite', () => {
  test('notifies the invitee using their label for the inviter + group name', async () => {
    const deps = makeDeps({ store: {
      'userPrefs/inv/following/owner': { label: 'Alex' },
      'groups/g1/name': 'Divers',
      'userPrefs/inv/pushTokens': { tokI: {} },
    }});
    await handleInvite(deps, 'inv', 'g1', { from: 'owner', ts: 1 });
    expect(deps.send).toHaveBeenCalledWith(['tokI'],
      { title: 'Alex invited you to Divers', body: '' },
      { type: 'invite', targetUid: 'owner', groupId: 'g1' });
  });
  test('falls back to the inviter group displayName when the invitee does not follow them', async () => {
    const deps = makeDeps({ store: {
      'groups/g1/members/owner/displayName': 'Bobby',
      'groups/g1/name': 'Divers',
      'userPrefs/inv/pushTokens': { tokI: {} },
    }});
    await handleInvite(deps, 'inv', 'g1', { from: 'owner', ts: 1 });
    expect(deps.send).toHaveBeenCalledWith(['tokI'],
      { title: 'Bobby invited you to Divers', body: '' },
      expect.objectContaining({ type: 'invite' }));
  });
  test('no record / no from → no send', async () => {
    const deps = makeDeps();
    await handleInvite(deps, 'inv', 'g1', null);
    await handleInvite(deps, 'inv', 'g1', { ts: 1 });
    expect(deps.send).not.toHaveBeenCalled();
  });
});

describe('handleFollowRequest', () => {
  test('notifies the target using their own label for the requester', async () => {
    const deps = makeDeps({ store: {
      'userPrefs/tgt/following/req': { label: 'Cara' },
      'userPrefs/tgt/pushTokens': { tokT: {} },
    }});
    await handleFollowRequest(deps, 'tgt', 'req', { from: 'req', groupId: 'g1', ts: 1 });
    expect(deps.send).toHaveBeenCalledWith(['tokT'],
      { title: 'Cara wants to follow you', body: '' },
      { type: 'followRequest', targetUid: 'req' });
  });

  test('falls back to the requester group displayName when not followed', async () => {
    const deps = makeDeps({ store: {
      'groups/g1/members/req/displayName': 'Req Name',
      'userPrefs/tgt/pushTokens': { tokT: {} },
    }});
    await handleFollowRequest(deps, 'tgt', 'req', { from: 'req', groupId: 'g1', ts: 1 });
    expect(deps.send).toHaveBeenCalledWith(['tokT'],
      { title: 'Req Name wants to follow you', body: '' },
      expect.objectContaining({ type: 'followRequest', targetUid: 'req' }));
  });

  test('no record / no from → no send', async () => {
    const deps = makeDeps();
    await handleFollowRequest(deps, 'tgt', 'req', null);
    await handleFollowRequest(deps, 'tgt', 'req', { ts: 1 });
    expect(deps.send).not.toHaveBeenCalled();
  });
});
