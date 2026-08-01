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

// --- Round-1 review coverage: kinds runChecks can emit but that were never
// asserted by name in the original 20 tests. See task-5-report.md for the list.

describe('follower names', () => {
  test('a follower with no entry in followerNames is missing a published name', () => {
    const w = clean();
    w.users.u1.followerNames = {};
    expect(checks(runChecks(w))).toContain('follower-name-missing');
  });

  test('a followerNames entry with no matching follower is an orphan', () => {
    const w = clean();
    w.users.u1.followerNames = { ghost: 'Ghost Name' };
    expect(checks(runChecks(w))).toContain('follower-name-orphan');
  });
});

describe('personal invite tokens', () => {
  test('a personal invite token missing from inviteIndex is flagged', () => {
    const w = clean();
    w.users.u1.invites = { tok1: true };
    expect(checks(runChecks(w))).toContain('invite-index-missing');
  });

  test('an inviteIndex entry resolving to a dead uid is dangling', () => {
    const w = clean();
    w.inviteIndex.tok2 = { ownerPath: 'x', ownerUid: 'ghost' };
    expect(checks(runChecks(w))).toContain('invite-index-dangling');
  });
});

describe('group membership vs enumeration (directional)', () => {
  // group-not-a-member: enumerated a group but the group's member list doesn't
  // include the uid. group-member-dangling: uid IS in the member list but has
  // no user record at all. These two point in opposite directions, so this
  // test is written to fail if the two check codes were ever swapped between
  // the two branches in integrity.js (confirmed by an actual swap-and-run;
  // see task-5-report.md).
  test('an enumerated group the user is not actually a member of is flagged, not as a dangling member', () => {
    const w = clean();
    w.groups.g2 = { name: 'G2', ownerId: 'u2', members: { u2: { role: 'owner' } } };
    w.groupIdIndex.g2 = true;
    w.users.u1.groups.g2 = { lastVisited: 1 }; // u1 enumerates g2 ...
    w.users.u2.groups.g2 = { lastVisited: 1 }; // ... but only u2 is actually a member
    const found = checks(runChecks(w));
    expect(found).toContain('group-not-a-member');
    expect(found).not.toContain('group-member-dangling');
  });

  test('a user who is an actual member of every group they enumerate is not flagged', () => {
    const w = clean();
    expect(checks(runChecks(w))).not.toContain('group-not-a-member');
  });
});

describe('group empty and id-index mirrors', () => {
  test('a group with no members is flagged as empty', () => {
    const w = clean();
    w.groups.g2 = { name: 'Empty', ownerId: null, members: {} };
    w.groupIdIndex.g2 = true;
    expect(checks(runChecks(w))).toContain('group-empty');
  });

  test('a group missing from groupIdIndex is flagged', () => {
    const w = clean();
    delete w.groupIdIndex.g1;
    expect(checks(runChecks(w))).toContain('group-id-index-missing');
  });

  test('a groupIdIndex entry for a group that no longer exists is dangling', () => {
    const w = clean();
    w.groupIdIndex.gone = true;
    expect(checks(runChecks(w))).toContain('group-id-index-dangling');
  });
});

describe('pending invite mirror (directional, both ways)', () => {
  test('a pendingInvites entry with no reciprocal by-group entry is asymmetric', () => {
    const w = clean();
    w.pendingInvites.p1 = { g1: true };
    // pendingInvitesByGroup.g1.p1 intentionally left absent.
    expect(checks(runChecks(w))).toContain('pending-invite-asymmetric');
  });

  test('a pendingInvitesByGroup entry with no reciprocal pendingInvites entry is asymmetric', () => {
    const w = clean();
    w.pendingInvitesByGroup.g1 = { p2: true };
    // pendingInvites.p2.g1 intentionally left absent.
    expect(checks(runChecks(w))).toContain('pending-invite-asymmetric');
  });

  test('a symmetric pending invite mirror in both directions is not flagged', () => {
    const w = clean();
    w.pendingInvites.p3 = { g1: true };
    w.pendingInvitesByGroup.g1 = { p3: true };
    expect(checks(runChecks(w))).not.toContain('pending-invite-asymmetric');
  });
});

describe('telegram prefs agreement', () => {
  test('a userPrefs telegram tgId disagreeing with the reverse index is flagged', () => {
    const w = clean();
    w.telegramByUid.u1 = { tgId: '42' };
    w.telegramUsers['42'] = { uid: 'u1' };
    w.userPrefs.u1.telegram = { tgId: '99' };
    expect(checks(runChecks(w))).toContain('telegram-prefs-disagree');
  });

  test('a userPrefs telegram tgId matching the reverse index is not flagged', () => {
    const w = clean();
    w.telegramByUid.u1 = { tgId: '42' };
    w.telegramUsers['42'] = { uid: 'u1' };
    w.userPrefs.u1.telegram = { tgId: '42' };
    expect(checks(runChecks(w))).not.toContain('telegram-prefs-disagree');
  });
});

describe('more residue', () => {
  test('a location point for a uid with no user record is dangling', () => {
    const w = clean();
    w.locations.ghost = { lat: 1, lng: 2, updatedAt: NOW };
    expect(checks(runChecks(w))).toContain('location-dangling');
  });

  test('push tokens for a uid with no user record are dangling', () => {
    const w = clean();
    w.pushTokens.ghost = { tok1: { createdAt: 1, lastSeen: 1 } };
    expect(checks(runChecks(w))).toContain('push-tokens-dangling');
  });
});

describe('canvas keys (no canvas subtree ever read — keys only)', () => {
  test('a canvas key naming two nonexistent uids flags both as dangling', () => {
    const w = clean();
    w.canvasKeys = ['ghost1_ghost2'];
    const found = runChecks(w).filter((f) => f.check === 'canvas-dangling');
    expect(found.map((f) => f.uid).sort()).toEqual(['ghost1', 'ghost2']);
  });

  test('a canvas key naming two real uids is not flagged', () => {
    const w = clean();
    w.canvasKeys = ['u1_u2'];
    expect(checks(runChecks(w))).not.toContain('canvas-dangling');
  });
});
