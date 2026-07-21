import { jest } from '@jest/globals';
import { sendToUser, resolveName, handleKnock, handleCall, handleAvailability, resolveGroupMemberName, notifyGroupAvailability, handleGroupOverrideChange, handleInvite, handleFollowRequest, availabilityRelevantOverrideChange } from '../notifier.js';
import channelDefault from '../../test-fixtures/notify-channel-vectors.json' with { type: 'json' };

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
  // F6: tokens now live at the top-level pushTokens/{uid} node; sendToUser reads
  // it first and only falls back to the legacy userPrefs copy until migration.
  test('sends to tokens under the new pushTokens/{uid} path', async () => {
    const deps = makeDeps({ store: { 'pushTokens/u1': { tokA: {}, tokB: {} } } });
    await sendToUser(deps, 'u1', { title: 'hi', body: '' }, { type: 'knock' });
    expect(deps.send).toHaveBeenCalledWith(['tokA', 'tokB'], { title: 'hi', body: '' }, { type: 'knock' });
  });
  // Legacy fallback: a user not yet migrated (tokens still only under userPrefs)
  // still receives — the new-path read returns undefined and we fall back.
  test('legacy-only user still receives via the userPrefs fallback', async () => {
    const deps = makeDeps({ store: { 'userPrefs/u1/pushTokens': { tokA: {}, tokB: {} } } });
    await sendToUser(deps, 'u1', { title: 'hi', body: '' }, { type: 'knock' });
    expect(deps.send).toHaveBeenCalledWith(['tokA', 'tokB'], { title: 'hi', body: '' }, { type: 'knock' });
  });
  // The new path wins when both exist (post-migration the legacy copy is gone,
  // but during the window the new path is authoritative).
  test('new path takes precedence over the legacy copy when both exist', async () => {
    const deps = makeDeps({ store: {
      'pushTokens/u1': { tokNew: {} },
      'userPrefs/u1/pushTokens': { tokOld: {} },
    } });
    await sendToUser(deps, 'u1', { title: 'hi', body: '' }, {});
    expect(deps.send).toHaveBeenCalledWith(['tokNew'], { title: 'hi', body: '' }, {});
  });
  test('prunes failed tokens to the NEW path', async () => {
    const deps = makeDeps({ store: { 'pushTokens/u1': { tokA: {}, tokBad: {} } } });
    deps.send = jest.fn(async () => ({ failedTokens: ['tokBad'] }));
    await sendToUser(deps, 'u1', { title: 'hi', body: '' }, {});
    expect(deps.update).toHaveBeenCalledWith('pushTokens/u1', { tokBad: null });
  });
  // Even a legacy-only send prunes to the new path — the migration removes the
  // legacy copies, the prune never writes back into userPrefs.
  test('a legacy-fallback send still prunes failed tokens to the NEW path', async () => {
    const deps = makeDeps({ store: { 'userPrefs/u1/pushTokens': { tokA: {}, tokBad: {} } } });
    deps.send = jest.fn(async () => ({ failedTokens: ['tokBad'] }));
    await sendToUser(deps, 'u1', { title: 'hi', body: '' }, {});
    expect(deps.update).toHaveBeenCalledWith('pushTokens/u1', { tokBad: null });
  });
});

describe('resolveName', () => {
  test('prefers the viewer\'s following label, falls back to target code, then "Someone"', async () => {
    const deps = makeDeps({ store: {
      'userPrefs/v/following/t': { label: 'Bea', code: 'x' },
    }});
    expect(await resolveName(deps, 'v', 't')).toBe('Bea');

    const deps2 = makeDeps({ store: { 'users/t/presence/code': 'cool-code' } });
    expect(await resolveName(deps2, 'v', 't')).toBe('Your contact cool-code');

    const deps3 = makeDeps({ store: {} });
    expect(await resolveName(deps3, 'v', 't')).toBe('Someone');
  });

  test('resolveName prefixes a bare share-code fallback', async () => {
    const deps = makeDeps({ store: { 'users/u2/presence/code': 'K7Q2ZP' } });
    expect(await resolveName(deps, 'u1', 'u2')).toBe('Your contact K7Q2ZP');
  });

  test('resolveName returns a real label unchanged', async () => {
    const deps = makeDeps({ store: { 'userPrefs/u1/following/u2': { label: 'Ana' } } });
    expect(await resolveName(deps, 'u1', 'u2')).toBe('Ana');
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
  // audit F8 gate preservation: phase 1 reads BOTH gates in parallel, so an
  // opted-out recipient now also reads the cooldown (one extra tiny read) but
  // still does ZERO name/group/send reads.
  test('opted-out knock still reads only prefs + cooldown (audit F8 gate preservation)', async () => {
    const reads = [];
    const deps = makeDeps({ getVal: jest.fn((p) => { reads.push(p); return Promise.resolve(null); }) }); // null prefs → not opted in
    await handleKnock(deps, 'r1', 's1', {});
    expect(reads.sort()).toEqual([
      'notifierState/knockCooldown/r1/s1',
      'userPrefs/r1/notify/s1',
    ]);
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
      'users/m/presence': { status: 'available', availableUntil: FUTURE },
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
      // gOn: override enabled → handled by onMemberWritten's override branch, not the primary path
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

// #183 H6 — dedup + cooldown-write behavior under multi-group fan-out. The
// dedup set is shared across Direct + every override-off group; only a group
// that actually delivered a push should stamp its per-(group, member) cooldown.
describe('handleAvailability → multi-group fan-out: exactly one push + selective cooldown stamps', () => {
  function threeGroupStore(extra = {}) {
    return {
      'users/bob/presence/status': 'available',
      'users/bob/presence/availableUntil': FUTURE,
      'users/bob/followers': null,
      'userPrefs/ann/notify/bob': { availability: true },
      'userPrefs/ann/pushTokens': { tokAnn: {} },
      'users/bob/groups': { g1: true, g2: true, g3: true },
      'groups/g1/members/bob/statusOverride': { enabled: false },
      'groups/g2/members/bob/statusOverride': { enabled: false },
      'groups/g3/members/bob/statusOverride': { enabled: false },
      'groups/g1/members': { bob: {}, ann: {} },
      'groups/g2/members': { bob: {}, ann: {} },
      'groups/g3/members': { bob: {}, ann: {} },
      'groups/g1/name': 'G1', 'groups/g2/name': 'G2', 'groups/g3/name': 'G3',
      'groups/g1/members/bob/displayName': 'BobG1',
      'groups/g2/members/bob/displayName': 'BobG2',
      'groups/g3/members/bob/displayName': 'BobG3',
      'notifierState/groupAvailability/g1/bob': null,
      'notifierState/groupAvailability/g2/bob': null,
      'notifierState/groupAvailability/g3/bob': null,
      ...extra,
    };
  }

  test('a co-member of THREE override-off groups gets exactly ONE push (first group wins)', async () => {
    const deps = makeDeps({ store: threeGroupStore() });
    await handleAvailability(deps, 'bob', null, FUTURE);
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.send).toHaveBeenCalledWith(['tokAnn'],
      { title: 'BobG1 is available in G1', body: '' },
      { type: 'availability', targetUid: 'bob', contextGroupId: 'g1' });
  });

  test('only the group that delivered stamps its cooldown; deduped groups do NOT', async () => {
    const deps = makeDeps({ store: threeGroupStore() });
    await handleAvailability(deps, 'bob', null, FUTURE);
    // g1 delivered → stamped. g2/g3 found ann already in the dedup set → no send
    // → must not stamp (otherwise a re-up within the window would be wrongly muted
    // even though that group never actually notified anyone).
    expect(deps.update).toHaveBeenCalledWith('notifierState/groupAvailability/g1', { bob: 1000 });
    expect(deps.update).not.toHaveBeenCalledWith('notifierState/groupAvailability/g2', expect.anything());
    expect(deps.update).not.toHaveBeenCalledWith('notifierState/groupAvailability/g3', expect.anything());
  });

  test('when the first group is within its own cooldown, the next override-off group delivers (still one push)', async () => {
    const deps = makeDeps({ store: threeGroupStore({
      'notifierState/groupAvailability/g1/bob': 999, // g1 within cooldown (now=1000)
    }) });
    await handleAvailability(deps, 'bob', null, FUTURE);
    // g1 is cooled → notifyGroupAvailability returns before touching the dedup set,
    // so g2 delivers the single push and stamps only g2.
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.send).toHaveBeenCalledWith(['tokAnn'],
      { title: 'BobG2 is available in G2', body: '' },
      { type: 'availability', targetUid: 'bob', contextGroupId: 'g2' });
    expect(deps.update).toHaveBeenCalledWith('notifierState/groupAvailability/g2', { bob: 1000 });
    expect(deps.update).not.toHaveBeenCalledWith('notifierState/groupAvailability/g1', expect.anything());
  });

  test('distinct co-members across groups each get exactly one push from their first eligible group', async () => {
    const deps = makeDeps({ store: {
      'users/bob/presence/status': 'available',
      'users/bob/presence/availableUntil': FUTURE,
      'users/bob/followers': null,
      'userPrefs/ann/notify/bob': { availability: true },
      'userPrefs/ann/pushTokens': { tokAnn: {} },
      'userPrefs/cal/notify/bob': { availability: true },
      'userPrefs/cal/pushTokens': { tokCal: {} },
      'users/bob/groups': { g1: true, g2: true },
      'groups/g1/members/bob/statusOverride': { enabled: false },
      'groups/g2/members/bob/statusOverride': { enabled: false },
      // ann in both groups; cal only in g2
      'groups/g1/members': { bob: {}, ann: {} },
      'groups/g2/members': { bob: {}, ann: {}, cal: {} },
      'groups/g1/name': 'G1', 'groups/g2/name': 'G2',
      'groups/g1/members/bob/displayName': 'BobG1',
      'groups/g2/members/bob/displayName': 'BobG2',
      'notifierState/groupAvailability/g1/bob': null,
      'notifierState/groupAvailability/g2/bob': null,
    }});
    await handleAvailability(deps, 'bob', null, FUTURE);
    expect(deps.send).toHaveBeenCalledTimes(2); // ann via g1, cal via g2 — never doubled
    expect(deps.send).toHaveBeenCalledWith(['tokAnn'],
      { title: 'BobG1 is available in G1', body: '' },
      { type: 'availability', targetUid: 'bob', contextGroupId: 'g1' });
    expect(deps.send).toHaveBeenCalledWith(['tokCal'],
      { title: 'BobG2 is available in G2', body: '' },
      { type: 'availability', targetUid: 'bob', contextGroupId: 'g2' });
    // both groups delivered → both stamped
    expect(deps.update).toHaveBeenCalledWith('notifierState/groupAvailability/g1', { bob: 1000 });
    expect(deps.update).toHaveBeenCalledWith('notifierState/groupAvailability/g2', { bob: 1000 });
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

  test('names the shared group when its name resolves', async () => {
    const deps = makeDeps({ store: {
      'userPrefs/tgt/following/req': { label: 'Cara' },
      'groups/g1/name': 'Hiking',
      'userPrefs/tgt/pushTokens': { tokT: {} },
    }});
    await handleFollowRequest(deps, 'tgt', 'req', { from: 'req', groupId: 'g1', ts: 1 });
    expect(deps.send).toHaveBeenCalledWith(['tokT'],
      { title: 'Cara in Hiking wants to follow you', body: '' },
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

// ── R1.5 #179 S3: per-(recipient, sender) directed-event send cooldowns ───────
describe('directed-event send cooldowns', () => {
  test('knock: suppressed within the window; recorded after a send; sends again after it elapses', async () => {
    const base = { 'userPrefs/rcpt/notify/sndr': { knock: true }, 'userPrefs/rcpt/pushTokens': { tokA: {} } };

    const cooled = makeDeps({ store: { ...base, 'notifierState/knockCooldown/rcpt/sndr': 990 } }); // now=1000
    await handleKnock(cooled, 'rcpt', 'sndr', { count: 1, ts: 1 });
    expect(cooled.send).not.toHaveBeenCalled();

    const fresh = makeDeps({ store: { ...base } });
    await handleKnock(fresh, 'rcpt', 'sndr', { count: 1, ts: 1 });
    expect(fresh.send).toHaveBeenCalled();
    expect(fresh.update).toHaveBeenCalledWith('notifierState/knockCooldown/rcpt', { sndr: 1000 });

    const elapsed = makeDeps({ store: { ...base, 'notifierState/knockCooldown/rcpt/sndr': 1000 - 40000 } });
    await handleKnock(elapsed, 'rcpt', 'sndr', { count: 1, ts: 1 });
    expect(elapsed.send).toHaveBeenCalled();
  });

  test('call: suppressed within the window; recorded after a send', async () => {
    const base = { 'userPrefs/callee/notify/caller': { call: true }, 'userPrefs/callee/pushTokens': { tokA: {} } };

    const cooled = makeDeps({ store: { ...base, 'notifierState/callCooldown/callee/caller': 995 } });
    await handleCall(cooled, 'callee', 'caller');
    expect(cooled.send).not.toHaveBeenCalled();

    const fresh = makeDeps({ store: { ...base } });
    await handleCall(fresh, 'callee', 'caller');
    expect(fresh.update).toHaveBeenCalledWith('notifierState/callCooldown/callee', { caller: 1000 });
  });

  test('invite: suppressed within the window (unconditional event still throttled)', async () => {
    const cooled = makeDeps({ store: {
      'userPrefs/inv/pushTokens': { tokA: {} },
      'groups/g/name': 'Fam',
      'notifierState/inviteCooldown/inv/from': 1000 - 1000, // < 1h
    }});
    await handleInvite(cooled, 'inv', 'g', { from: 'from', ts: 1 });
    expect(cooled.send).not.toHaveBeenCalled();

    const fresh = makeDeps({ store: { 'userPrefs/inv/pushTokens': { tokA: {} }, 'groups/g/name': 'Fam' } });
    await handleInvite(fresh, 'inv', 'g', { from: 'from', ts: 1 });
    expect(fresh.update).toHaveBeenCalledWith('notifierState/inviteCooldown/inv', { from: 1000 });
  });

  test('followRequest: suppressed within the window', async () => {
    const cooled = makeDeps({ store: {
      'userPrefs/tgt/pushTokens': { tokA: {} },
      'notifierState/followReqCooldown/tgt/req': 999,
    }});
    await handleFollowRequest(cooled, 'tgt', 'req', { from: 'req', groupId: 'g', ts: 1 });
    expect(cooled.send).not.toHaveBeenCalled();

    const fresh = makeDeps({ store: { 'userPrefs/tgt/pushTokens': { tokA: {} } } });
    await handleFollowRequest(fresh, 'tgt', 'req', { from: 'req', groupId: 'g', ts: 1 });
    expect(fresh.update).toHaveBeenCalledWith('notifierState/followReqCooldown/tgt', { req: 1000 });
  });

  test('a genuine re-request re-notifies once the short window has elapsed (onValueCreated re-create)', async () => {
    // followRequest/invite are onValueCreated — a re-request after a decline is
    // a delete→create that SHOULD notify. The window must be short enough not to
    // swallow it: 45s ago was suppressed under the old 1h, must send now.
    const deps = makeDeps({ store: {
      'userPrefs/tgt/pushTokens': { tokA: {} },
      'notifierState/followReqCooldown/tgt/req': 1000 - 45000,
    }});
    await handleFollowRequest(deps, 'tgt', 'req', { from: 'req', groupId: 'g', ts: 1 });
    expect(deps.send).toHaveBeenCalled();
  });
});

describe('sendToUser telegram channel', () => {
  const tgStore = {
    'userPrefs/u1/notifyChannel': 'telegram',
    'telegramByUid/u1': { tgId: '42', chatId: '42' },
    'userPrefs/u1/pushTokens': { tokA: {} },
  };
  test('channel=telegram with chatId → telegram send, no FCM', async () => {
    const deps = makeDeps({ store: { ...tgStore } });
    deps.sendTelegram = jest.fn(async () => true);
    const ok = await sendToUser(deps, 'u1', { title: 'hi', body: '' }, { type: 'knock', targetUid: 's' });
    expect(ok).toBe(true);
    expect(deps.sendTelegram).toHaveBeenCalledWith('42', { title: 'hi', body: '' }, { type: 'knock', targetUid: 's' });
    expect(deps.send).not.toHaveBeenCalled();
  });
  test('telegram send fails → falls back to FCM', async () => {
    const deps = makeDeps({ store: { ...tgStore } });
    deps.sendTelegram = jest.fn(async () => false);
    await sendToUser(deps, 'u1', { title: 'hi', body: '' }, {});
    expect(deps.send).toHaveBeenCalled();
  });
  test('telegram send throws → falls back to FCM', async () => {
    const deps = makeDeps({ store: { ...tgStore } });
    deps.sendTelegram = jest.fn(async () => { throw new Error('blocked'); });
    await sendToUser(deps, 'u1', { title: 'hi', body: '' }, {});
    expect(deps.send).toHaveBeenCalled();
  });
  test('channel=push → FCM even when a telegram route exists', async () => {
    const deps = makeDeps({ store: { ...tgStore, 'userPrefs/u1/notifyChannel': 'push' } });
    deps.sendTelegram = jest.fn(async () => true);
    await sendToUser(deps, 'u1', { title: 'hi', body: '' }, {});
    expect(deps.sendTelegram).not.toHaveBeenCalled();
    expect(deps.send).toHaveBeenCalled();
  });

  // Shared cross-reader guard (W2 C10): the server route gate must agree with
  // the client readers (js/notifySuppression.js botDelivered, js/notifyChannel.js
  // pill) on the channel!=='push' default. All three consume the same fixture.
  test.each(channelDefault.vectors)(
    'C10: linked route, channel=$notifyChannel → telegram-delivered=$telegramDelivered',
    async (v) => {
      const deps = makeDeps({ store: { ...tgStore, 'userPrefs/u1/notifyChannel': v.notifyChannel } });
      deps.sendTelegram = jest.fn(async () => true);
      await sendToUser(deps, 'u1', { title: 'hi', body: '' }, {});
      if (v.telegramDelivered) {
        expect(deps.sendTelegram).toHaveBeenCalled();
        expect(deps.send).not.toHaveBeenCalled();
      } else {
        expect(deps.sendTelegram).not.toHaveBeenCalled();
        expect(deps.send).toHaveBeenCalled();
      }
    },
  );
  test('no sendTelegram dep (bot not configured) → FCM', async () => {
    const deps = makeDeps({ store: { ...tgStore } });
    await sendToUser(deps, 'u1', { title: 'hi', body: '' }, {});
    expect(deps.send).toHaveBeenCalled();
  });
  // F#9: with the bot configured, the pushTokens read joins the SAME parallel
  // phase as notifyChannel + telegramByUid — the FCM fall-through must not pay
  // a third sequential round-trip. The probe defers every getVal a macrotask,
  // so reads issued together peak at 3 in-flight; a trailing read peaks lower.
  test('bot configured: channel, route, and pushTokens are read in ONE parallel phase (F#9)', async () => {
    const deps = makeDeps({ store: { ...tgStore } });
    deps.sendTelegram = jest.fn(async () => false); // falls through to FCM
    const probe = { inFlight: 0, max: 0 };
    const store = deps.store;
    deps.getVal = jest.fn(async (path) => {
      probe.inFlight += 1;
      probe.max = Math.max(probe.max, probe.inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      probe.inFlight -= 1;
      return store[path];
    });
    await sendToUser(deps, 'u1', { title: 'hi', body: '' }, {});
    expect(probe.max).toBeGreaterThanOrEqual(3);
    expect(deps.send).toHaveBeenCalledWith(['tokA'], { title: 'hi', body: '' }, {});
  });
  test('a failing pushTokens read must not break healthy telegram delivery', async () => {
    const deps = makeDeps({ store: { ...tgStore } });
    deps.sendTelegram = jest.fn(async () => true);
    deps.getVal = jest.fn(async (path) => {
      if (path === 'userPrefs/u1/pushTokens') throw new Error('transient RTDB error');
      return deps.store[path];
    });
    const ok = await sendToUser(deps, 'u1', { title: 'hi', body: '' }, {});
    expect(ok).toBe(true);
    expect(deps.sendTelegram).toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
  });
  test('with telegram failing, a failing pushTokens read still surfaces (FCM path unchanged)', async () => {
    const deps = makeDeps({ store: { ...tgStore } });
    deps.sendTelegram = jest.fn(async () => false);
    deps.getVal = jest.fn(async (path) => {
      if (path === 'userPrefs/u1/pushTokens') throw new Error('transient RTDB error');
      return deps.store[path];
    });
    await expect(sendToUser(deps, 'u1', { title: 'hi', body: '' }, {})).rejects.toThrow(/transient/);
  });
  test('bot NOT configured: only the token reads happen (new path, then legacy fallback)', async () => {
    const deps = makeDeps({ store: { ...tgStore } });
    await sendToUser(deps, 'u1', { title: 'hi', body: '' }, {});
    // tgStore keeps tokens under the legacy path, so the new-path read misses and
    // the legacy fallback fires — exactly two reads, both for tokens.
    expect(deps.getVal.mock.calls.map(([p]) => p)).toEqual(['pushTokens/u1', 'userPrefs/u1/pushTokens']);
    expect(deps.send).toHaveBeenCalled();
  });
  test('bot NOT configured, tokens on the new path: a single token read', async () => {
    const deps = makeDeps({ store: { 'pushTokens/u1': { tokA: {} } } });
    await sendToUser(deps, 'u1', { title: 'hi', body: '' }, {});
    expect(deps.getVal.mock.calls.map(([p]) => p)).toEqual(['pushTokens/u1']);
    expect(deps.send).toHaveBeenCalled();
  });

  test('missing channel with a telegram route → telegram (mirrors the client default-to-telegram predicate)', async () => {
    const deps = makeDeps({ store: { ...tgStore, 'userPrefs/u1/notifyChannel': null } });
    deps.sendTelegram = jest.fn(async () => true);
    const ok = await sendToUser(deps, 'u1', { title: 'hi', body: '' }, {});
    expect(ok).toBe(true);
    expect(deps.sendTelegram).toHaveBeenCalledWith('42', { title: 'hi', body: '' }, {});
    expect(deps.send).not.toHaveBeenCalled();
  });
});

describe('token-less push fallback (W1 J#3)', () => {
  test('channel push + linked + zero tokens delivers via telegram instead of dropping', async () => {
    const store = {
      'userPrefs/u1/notifyChannel': 'push',
      'telegramByUid/u1': { chatId: '42' },
      // no userPrefs/u1/pushTokens
    };
    const deps = {
      getVal: jest.fn(async (p) => store[p] ?? null),
      update: jest.fn(async () => {}),
      send: jest.fn(async () => ({ failedTokens: [] })),
      sendTelegram: jest.fn(async () => true),
      now: () => 1_000_000,
    };
    const ok = await sendToUser(deps, 'u1', { title: 'Ana knocked' }, { type: 'knock', targetUid: 'a'.repeat(32) });
    expect(ok).toBe(true);
    expect(deps.sendTelegram).toHaveBeenCalledTimes(1);
    expect(deps.send).not.toHaveBeenCalled();
  });

  test('channel push + zero tokens + NOT linked still returns false', async () => {
    const store = { 'userPrefs/u1/notifyChannel': 'push' };
    const deps = {
      getVal: jest.fn(async (p) => store[p] ?? null),
      update: jest.fn(async () => {}),
      send: jest.fn(async () => ({ failedTokens: [] })),
      sendTelegram: jest.fn(async () => true),
      now: () => 1_000_000,
    };
    expect(await sendToUser(deps, 'u1', { title: 't' }, {})).toBe(false);
    expect(deps.sendTelegram).not.toHaveBeenCalled();
  });

  test('telegram-channel send failure does not retry telegram via the fallback', async () => {
    const store = {
      'userPrefs/u1/notifyChannel': 'telegram',
      'telegramByUid/u1': { chatId: '42' },
    };
    const deps = {
      getVal: jest.fn(async (p) => store[p] ?? null),
      update: jest.fn(async () => {}),
      send: jest.fn(async () => ({ failedTokens: [] })),
      sendTelegram: jest.fn(async () => { throw new Error('blocked'); }),
      now: () => 1_000_000,
    };
    expect(await sendToUser(deps, 'u1', { title: 't' }, {})).toBe(false);
    expect(deps.sendTelegram).toHaveBeenCalledTimes(1); // no second attempt
  });
});

describe('availabilityRelevantOverrideChange (merged member-trigger gate)', () => {
  test('absent on both sides is not a change', () => {
    expect(availabilityRelevantOverrideChange(null, undefined)).toBe(false);
    expect(availabilityRelevantOverrideChange(undefined, undefined)).toBe(false);
  });
  test('appearing or vanishing is a change', () => {
    expect(availabilityRelevantOverrideChange(null, { enabled: true })).toBe(true);
    expect(availabilityRelevantOverrideChange({ enabled: true }, null)).toBe(true);
  });
  test('availability-relevant field diffs are changes', () => {
    const a = { enabled: true, status: 'available', statusColor: 'blue', availableUntil: 99 };
    expect(availabilityRelevantOverrideChange(a, { ...a })).toBe(false);
    expect(availabilityRelevantOverrideChange(a, { ...a, enabled: false })).toBe(true);
    expect(availabilityRelevantOverrideChange(a, { ...a, status: 'unavailable' })).toBe(true);
    expect(availabilityRelevantOverrideChange(a, { ...a, availableUntil: 100 })).toBe(true);
  });
  test('appearance-only diffs are NOT changes — effectiveAvailable never reads them (audit-2 N4)', () => {
    const a = { enabled: true, status: 'available', statusColor: 'blue', availableUntil: 99 };
    expect(availabilityRelevantOverrideChange(a, { ...a, statusColor: 'red' })).toBe(false);
    expect(availabilityRelevantOverrideChange(a, { ...a, paletteKey: 'sunset' })).toBe(false);
  });
});
