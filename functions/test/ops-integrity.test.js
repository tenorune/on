import { runChecks } from '../ops/integrity.js';

const NOW = 1_750_000_000_000;

/** A clean world: every check should pass against this. */
function clean() {
  return {
    users: {
      u1: { presence: { code: 'AAA111', status: 'unavailable', availableUntil: null }, followers: { u2: 'BBB222' }, groups: { g1: { lastVisited: 1 } } },
      u2: { presence: { code: 'BBB222', status: 'unavailable', availableUntil: null }, followers: { u1: 'AAA111' }, groups: { g1: { lastVisited: 1 } } },
    },
    userPrefs: {
      u1: { following: { u2: {} }, notifyChannel: 'push' },
      u2: { following: { u1: {} }, notifyChannel: 'push' },
    },
    groups: { g1: { name: 'G', ownerId: 'u1', members: { u1: { role: 'owner' }, u2: { role: 'member' } } } },
    telegramUsers: {}, telegramByUid: {},
    pushTokens: {}, locations: {}, locationCells: {},
    knocks: {}, calls: {}, followRequests: {}, followGrants: {},
    pendingInvites: {}, pendingInvitesByGroup: {}, revocations: {},
    codeIndex: { AAA111: 'u1', BBB222: 'u2' },
    inviteIndex: {}, groupIdIndex: { g1: true },
    canvasKeys: [], authUsers: [{ uid: 'u1', email: null, createdAt: 1 }, { uid: 'u2', email: null, createdAt: 1 }],
    takenAt: NOW,
  };
}

const checks = (findings) => findings.map((f) => f.check);

describe('runChecks on a clean world', () => {
  test('reports nothing', () => {
    expect(runChecks(clean())).toEqual([]);
  });
});

describe('follow graph', () => {
  test('a follower with no matching following entry is one-sided', () => {
    const w = clean();
    delete w.userPrefs.u2.following.u1;
    expect(checks(runChecks(w))).toContain('follow-one-sided');
  });

  test('a following entry pointing at a nonexistent uid is dangling', () => {
    const w = clean();
    w.userPrefs.u1.following.ghost = {};
    expect(checks(runChecks(w))).toContain('follow-dangling');
  });
});

describe('indexes', () => {
  test('a codeIndex entry resolving to a dead uid is flagged', () => {
    const w = clean();
    w.codeIndex.ZZZ999 = 'ghost';
    expect(checks(runChecks(w))).toContain('code-index-dangling');
  });

  test('a rotated code leaves a stale index entry', () => {
    const w = clean();
    w.users.u1.presence.code = 'NEW111';
    w.codeIndex.NEW111 = 'u1';
    // AAA111 still points at u1, whose canonical code has moved on.
    expect(checks(runChecks(w))).toContain('code-index-stale');
  });

  test('a presence code with no index entry is flagged', () => {
    const w = clean();
    delete w.codeIndex.AAA111;
    expect(checks(runChecks(w))).toContain('code-index-missing');
  });
});

describe('groups', () => {
  test('membership without the users/{uid}/groups enumeration entry is flagged', () => {
    // The exact breakage repair-user-groups.js was written to repair.
    const w = clean();
    delete w.users.u2.groups.g1;
    expect(checks(runChecks(w))).toContain('group-enumeration-missing');
  });

  test('an enumeration entry for a group that no longer exists is flagged', () => {
    const w = clean();
    w.users.u1.groups.gone = { lastVisited: 1 };
    expect(checks(runChecks(w))).toContain('group-missing');
  });

  test('an ownerId that is not a member is flagged', () => {
    const w = clean();
    w.groups.g1.ownerId = 'ghost';
    expect(checks(runChecks(w))).toContain('group-owner-not-member');
  });

  test('a member with no user record is flagged', () => {
    const w = clean();
    w.groups.g1.members.ghost = { role: 'member' };
    expect(checks(runChecks(w))).toContain('group-member-dangling');
  });
});

describe('telegram', () => {
  test('notifyChannel telegram with no mapping means notifications go nowhere', () => {
    const w = clean();
    w.userPrefs.u1.notifyChannel = 'telegram';
    expect(checks(runChecks(w))).toContain('telegram-channel-unroutable');
  });

  test('telegramByUid without its reciprocal telegramUsers entry is flagged', () => {
    const w = clean();
    w.telegramByUid.u1 = { tgId: '42' };
    expect(checks(runChecks(w))).toContain('telegram-mapping-asymmetric');
  });

  test('a mapping pointing at a dead uid is flagged', () => {
    const w = clean();
    w.telegramUsers['42'] = { uid: 'ghost' };
    w.telegramByUid.ghost = { tgId: '42' };
    expect(checks(runChecks(w))).toContain('telegram-mapping-dangling');
  });
});

describe('residue', () => {
  test('a knock from a sender that no longer exists is residue', () => {
    const w = clean();
    w.knocks.u1 = { ghost: { count: 1, ts: NOW } };
    expect(checks(runChecks(w))).toContain('knock-dangling');
  });

  test('a call older than the stale window is flagged', () => {
    const w = clean();
    w.calls.u1 = { from: 'u2', to: 'u1', ts: NOW - 60 * 60 * 1000 };
    expect(checks(runChecks(w))).toContain('call-stale');
  });

  test('a locationCell for a non-member is flagged', () => {
    const w = clean();
    w.locationCells.g1 = { ghost: { lat: 1, lng: 2, updatedAt: NOW } };
    expect(checks(runChecks(w))).toContain('location-cell-non-member');
  });
});

describe('availability invariant', () => {
  test('available with no concrete availableUntil is flagged on presence', () => {
    const w = clean();
    w.users.u1.presence = { code: 'AAA111', status: 'available', availableUntil: null };
    expect(checks(runChecks(w))).toContain('available-without-until');
  });

  test('available with no concrete availableUntil is flagged on a statusOverride', () => {
    const w = clean();
    w.groups.g1.members.u2.statusOverride = { enabled: true, status: 'available' };
    expect(checks(runChecks(w))).toContain('available-without-until');
  });
});

describe('auth ↔ rtdb', () => {
  test('an Auth record with no RTDB user is flagged', () => {
    const w = clean();
    w.authUsers.push({ uid: 'ghost', email: 'tg-ghost@telegram.invalid', createdAt: 1 });
    expect(checks(runChecks(w))).toContain('auth-orphan');
  });

  test('an RTDB user with no Auth record is flagged', () => {
    const w = clean();
    w.authUsers = w.authUsers.filter((u) => u.uid !== 'u2');
    expect(checks(runChecks(w))).toContain('auth-missing');
  });
});
