import { buildRows, buildDetail, canvasPeers } from '../ops/project.js';

const SECRET = 'test-uid-secret';
const NOW = 1_750_000_000_000;

// One fixture world reused across the projection tests: u1 is a phrase account
// in a group it owns, mutual with u2, sharing a canvas with u2.
function world() {
  return {
    users: {
      u1: {
        presence: { code: 'AAA111', status: 'available', availableUntil: NOW + 60_000, lastSeen: NOW - 1000 },
        followers: { u2: 'BBB222' },
        groups: { g1: { lastVisited: NOW - 5000 } },
      },
      u2: {
        presence: { code: 'BBB222', status: 'unavailable', availableUntil: null, lastSeen: NOW - 90_000 },
        followers: { u1: 'AAA111' },
        groups: { g1: { lastVisited: NOW - 7000 } },
      },
    },
    userPrefs: {
      u1: { following: { u2: { code: 'BBB222', label: 'Sam' } }, notifyChannel: 'push' },
      u2: { following: { u1: { code: 'AAA111', label: 'Ada' } }, notifyChannel: 'telegram' },
    },
    groups: {
      g1: {
        name: 'Climbers',
        ownerId: 'u1',
        members: {
          u1: { role: 'owner', displayName: 'Ada' },
          u2: { role: 'member', displayName: 'Sam', statusOverride: { enabled: true, status: 'available' } },
        },
      },
    },
    telegramUsers: {},
    telegramByUid: {},
    pushTokens: { u1: { tokA: { createdAt: 1, lastSeen: NOW - 2000, ua: 'iPhone' } } },
    locations: { u1: { lat: 1, lng: 2, updatedAt: NOW - 30_000 } },
    locationCells: { g1: { u1: { lat: 1, lng: 2, updatedAt: NOW - 40_000 } } },
    knocks: {}, calls: {}, followRequests: {}, followGrants: {},
    pendingInvites: {}, pendingInvitesByGroup: {}, revocations: {},
    codeIndex: { AAA111: 'u1', BBB222: 'u2' },
    inviteIndex: {}, groupIdIndex: {},
    canvasKeys: ['u1_u2'],
    authUsers: [{ uid: 'u1', email: null, createdAt: NOW - 900_000 }],
    takenAt: NOW,
  };
}

describe('canvasPeers', () => {
  test('matches either side of the sorted pair key', () => {
    expect(canvasPeers(['u1_u2', 'u2_u3'], 'u2')).toEqual([
      { peer: 'u1', key: 'u1_u2' },
      { peer: 'u3', key: 'u2_u3' },
    ]);
  });

  test('ignores keys that do not name the uid', () => {
    expect(canvasPeers(['u3_u4'], 'u1')).toEqual([]);
  });
});

describe('buildRows', () => {
  test('one row per user, sorted by lastSeen descending', () => {
    const rows = buildRows(world(), SECRET);
    expect(rows.map((r) => r.uid)).toEqual(['u1', 'u2']);
  });

  test('contacts is the union of followers and following, counted once', () => {
    const rows = buildRows(world(), SECRET);
    // u1 is followed by u2 AND follows u2 — one contact, not two.
    expect(rows.find((r) => r.uid === 'u1').contacts).toBe(1);
  });

  test('carries code, status, counts, notifyChannel and location opt-in', () => {
    const row = buildRows(world(), SECRET).find((r) => r.uid === 'u1');
    expect(row.code).toBe('AAA111');
    expect(row.status).toBe('available');
    expect(row.groupCount).toBe(1);
    expect(row.canvasCount).toBe(1);
    expect(row.pushTokenCount).toBe(1);
    expect(row.notifyChannel).toBe('push');
    expect(row.locationOptIn).toBe(true);
  });

  test('createdAt comes from the Auth record, and is null when there is none', () => {
    const rows = buildRows(world(), SECRET);
    expect(rows.find((r) => r.uid === 'u1').createdAt).toBe(NOW - 900_000);
    expect(rows.find((r) => r.uid === 'u2').createdAt).toBeNull();
  });

  test('a user with no lastSeen sorts last rather than first', () => {
    const w = world();
    delete w.users.u1.presence.lastSeen;
    expect(buildRows(w, SECRET).map((r) => r.uid)).toEqual(['u2', 'u1']);
  });
});

describe('buildDetail', () => {
  test('splits contacts into followers, following and mutuals', () => {
    const d = buildDetail(world(), 'u1', SECRET);
    expect(d.followers).toEqual(['u2']);
    expect(d.following).toEqual(['u2']);
    expect(d.mutuals).toEqual(['u2']);
  });

  test('group rows carry the per-group displayName, role, ownership and override flag', () => {
    expect(buildDetail(world(), 'u2', SECRET).groups).toEqual([
      { gid: 'g1', name: 'Climbers', displayName: 'Sam', role: 'member', isOwner: false, hasStatusOverride: true },
    ]);
  });

  test('ownership is read from the group ownerId, not the member role string', () => {
    const d = buildDetail(world(), 'u1', SECRET);
    expect(d.groups[0].isOwner).toBe(true);
  });

  test('location detail reports the point fix age and per-gid cell ages', () => {
    const d = buildDetail(world(), 'u1', SECRET);
    expect(d.location.hasPoint).toBe(true);
    expect(d.location.fixAge).toBe(30_000);
    expect(d.location.cells).toEqual([{ gid: 'g1', fixAge: 40_000 }]);
  });

  test('push tokens carry per-token lastSeen and ua', () => {
    expect(buildDetail(world(), 'u1', SECRET).pushTokens).toEqual([
      { token: 'tokA', lastSeen: NOW - 2000, ua: 'iPhone' },
    ]);
  });

  test('an unknown uid returns null', () => {
    expect(buildDetail(world(), 'nope', SECRET)).toBeNull();
  });
});
