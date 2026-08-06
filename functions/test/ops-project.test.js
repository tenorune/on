import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import nodePath from 'node:path';
import { buildRows, buildDetail, canvasPeers, canvasUids } from '../ops/project.js';
import { canvasKeyFor } from '../ops/merge.js';
import { deriveTelegramUid } from '../telegram-auth.js';

const SECRET = 'test-uid-secret';
const NOW = 1_750_000_000_000;

// A Telegram-derived account: the uid IS the secret-keyed HMAC of the tgId
// (see telegram-auth.js deriveTelegramUid), so classifyProvenance's
// uid-derivation branch — the one place `secret` actually matters — only
// fires when the uid in the fixture equals this real derived value. Computed
// here (not hardcoded) so the fixture stays correct if the derivation ever
// changes shape.
const TG_ID = '918273645';
const DERIVED_UID = deriveTelegramUid(TG_ID, SECRET);

// A second fixture world, disjoint from world() above, for the one account
// that is genuinely telegram-derived and genuinely telegram-linked — so the
// shared 13-test fixture above stays untouched.
function telegramWorld() {
  return {
    users: {
      [DERIVED_UID]: {
        presence: { code: 'CCC333', status: 'available', availableUntil: null, lastSeen: NOW - 100 },
        followers: {},
        groups: {},
      },
    },
    userPrefs: {
      [DERIVED_UID]: { following: {}, notifyChannel: 'telegram', telegram: { tgId: TG_ID, linkedAt: NOW - 400_000 } },
    },
    groups: {},
    telegramUsers: { [TG_ID]: { uid: DERIVED_UID, chatId: TG_ID, linkedAt: NOW - 500_000 } },
    telegramByUid: { [DERIVED_UID]: { tgId: TG_ID, chatId: TG_ID } },
    pushTokens: {},
    locations: {},
    locationCells: {},
    knocks: {}, calls: {}, followRequests: {}, followGrants: {},
    pendingInvites: {}, pendingInvitesByGroup: {}, revocations: {},
    codeIndex: { CCC333: DERIVED_UID },
    inviteIndex: {}, groupIdIndex: {},
    canvasKeys: [],
    authUsers: [],
    takenAt: NOW,
  };
}

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

// M3: the canvas key's shape — a sorted uid pair joined by `_` — was written in
// three places: canvasPeers here, an inline `key.split('_')` in
// ops/integrity.js, and canvasKeyFor in ops/merge.js. Taking one apart is now
// canvasUids, consumed by both readers; the guard below is what keeps a fourth
// copy from appearing, since the concept is one line and re-typing it is
// always the path of least resistance.
describe('canvasUids — the ONE place a canvas key is taken apart', () => {
  test('returns both sides of the pair', () => {
    expect(canvasUids('u1_u2')).toEqual(['u1', 'u2']);
  });

  // The join lives in ops/merge.js and is deliberately left there — it is
  // merge's own write-target builder. Pinning the round trip is what stops the
  // two halves disagreeing without moving code between modules.
  test('round-trips with merge.js\'s canvasKeyFor, whichever order the pair arrives in', () => {
    expect(canvasUids(canvasKeyFor('u2', 'u1'))).toEqual(['u1', 'u2']);
    expect(canvasUids(canvasKeyFor('u1', 'u2'))).toEqual(['u1', 'u2']);
  });

  test('canvasPeers reads its pair through it — both sides, either position', () => {
    const [a, b] = canvasUids('alpha_beta');
    expect(canvasPeers(['alpha_beta'], a)).toEqual([{ peer: b, key: 'alpha_beta' }]);
    expect(canvasPeers(['alpha_beta'], b)).toEqual([{ peer: a, key: 'alpha_beta' }]);
  });

  // A source assertion, and the only reachable check that no module re-typed
  // the split: ops/project.js is the one file allowed to contain it.
  test('no other ops module splits a canvas key by hand', () => {
    const dir = nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), '..', 'ops');
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.js') && f !== 'project.js')
      .filter((f) => readFileSync(nodePath.join(dir, f), 'utf8').includes("split('_')"));
    expect(offenders).toEqual([]);
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

  // `status` is the string SITTING IN THE DATABASE. It is not the answer to
  // "is this account available", because availability is timed: the app writes
  // 'available' with an availableUntil and never rewrites the status when that
  // moment passes. An account last seen fifteen days ago still reads
  // status='available' forever, and the panel used to print exactly that.
  //
  // The predicate is NOT re-derived here. functions/presence-core.js
  // primaryAvailable is the server-side one, pinned against the client's by
  // tests/presencePredicateParity.test.js; a third copy in the panel is how
  // three predicates start disagreeing.
  describe('effective availability', () => {
    test('a live availability window reads available', () => {
      const row = buildRows(world(), SECRET, NOW).find((r) => r.uid === 'u1');
      expect(row.available).toBe(true);
    });

    // The operator's report: accounts marked available that could not be.
    test('an expired availability window does NOT read available', () => {
      const w = world();
      w.users.u1.presence.availableUntil = NOW - 1;
      const row = buildRows(w, SECRET, NOW).find((r) => r.uid === 'u1');
      expect(row.available).toBe(false);
    });

    test('an unavailable account reads unavailable whatever the window says', () => {
      const w = world();
      w.users.u2.presence.availableUntil = NOW + 60_000;
      expect(buildRows(w, SECRET, NOW).find((r) => r.uid === 'u2').available).toBe(false);
    });

    // Open-ended availability is the documented client/server divergence
    // (tests/presencePredicateParity.test.js). The panel follows the SERVER
    // predicate — fail-closed — because an operator deciding whether to purge
    // an account should not be told it is live on an input no writer emits.
    test('available with no availableUntil follows the server predicate, not the client one', () => {
      const w = world();
      w.users.u1.presence.availableUntil = null;
      expect(buildRows(w, SECRET, NOW).find((r) => r.uid === 'u1').available).toBe(false);
    });

    // The panel's job is to show what is in the database, so the raw string
    // has to survive alongside the computed answer — an operator needs to see
    // that the stored status says 'available' while the account is not.
    test('the stored status string is still carried, not replaced', () => {
      const w = world();
      w.users.u1.presence.availableUntil = NOW - 1;
      const row = buildRows(w, SECRET, NOW).find((r) => r.uid === 'u1');
      expect(row.status).toBe('available');
      expect(row.availableUntil).toBe(NOW - 1);
    });
  });

  // The label the status column actually prints. Computed here rather than in
  // panel.html for the same reason as the ages: the page has no unit coverage,
  // and this is the cell that was telling the operator the wrong thing.
  describe('status label', () => {
    const rowFor = (mutate) => {
      const w = world();
      mutate(w.users.u1.presence);
      return buildRows(w, SECRET, NOW).find((r) => r.uid === 'u1');
    };

    test('a live window reads plainly available', () => {
      const row = rowFor((p) => { p.availableUntil = NOW + 60_000; });
      expect(row.statusLabel).toBe('available');
      expect(row.statusTitle).toBeNull();
    });

    // Not "available", and not a bare "unavailable" either — the stored string
    // still says available, and an operator looking at a purge candidate should
    // be able to see both facts without opening the database.
    test('an expired window reads expired and says when, and how it is stored', () => {
      const row = rowFor((p) => { p.availableUntil = NOW - (15 * 24 + 9) * 60 * 60_000; });
      expect(row.statusLabel).toBe('expired');
      expect(row.statusTitle).toBe('stored status is "available"; the window ended 15d 9h ago');
    });

    // integrity.js already reports this as an `available-without-until` error.
    // The status cell must not quietly render it as either available or
    // expired — neither is true, and the row is the one an operator sees first.
    test('available with no window is named as such, not flattened', () => {
      const row = rowFor((p) => { p.availableUntil = null; });
      expect(row.statusLabel).toBe('available (no window)');
      expect(row.statusTitle).toMatch(/availableUntil/);
    });

    test('any other stored status passes through unchanged', () => {
      const row = rowFor((p) => { p.status = 'unavailable'; p.availableUntil = null; });
      expect(row.statusLabel).toBe('unavailable');
    });

    test('no stored status at all is a dash', () => {
      const row = rowFor((p) => { delete p.status; delete p.availableUntil; });
      expect(row.statusLabel).toBe('—');
    });
  });

  // Rendered server-side because panel.html cannot be unit-tested: it is served
  // as one static file with no bundler, so a formatter living in it is a rule
  // no test can reach.
  describe('human-readable ages', () => {
    test('createdAt and lastSeen arrive preformatted', () => {
      const row = buildRows(world(), SECRET, NOW).find((r) => r.uid === 'u1');
      expect(row.createdAtLabel).toBe('15m ago');
      expect(row.lastSeenLabel).toBe('<1m ago');
    });

    test('an absent timestamp is a dash, not an age since the epoch', () => {
      const row = buildRows(world(), SECRET, NOW).find((r) => r.uid === 'u2');
      expect(row.createdAtLabel).toBe('—');
    });

    test('the raw timestamps survive, so the table can still sort on them', () => {
      const row = buildRows(world(), SECRET, NOW).find((r) => r.uid === 'u1');
      expect(row.createdAt).toBe(NOW - 900_000);
      expect(row.lastSeen).toBe(NOW - 1000);
    });
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
    expect(d.location.cells).toEqual([{ gid: 'g1', fixAge: 40_000, fixAgeLabel: '<1m' }]);
  });

  test('push tokens carry per-token lastSeen and ua', () => {
    expect(buildDetail(world(), 'u1', SECRET, NOW).pushTokens).toEqual([
      { token: 'tokA', lastSeen: NOW - 2000, ua: 'iPhone', lastSeenLabel: '<1m ago' },
    ]);
  });

  // The detail view rendered these two as raw seconds, so a fix taken a
  // fortnight ago read "1328700s old" — the same unit problem as the table,
  // in the view an operator opens right before pressing purge.
  describe('durations in the detail view are legible too', () => {
    test('a stale point fix reads in days, not seconds', () => {
      const w = world();
      w.locations.u1.updatedAt = NOW - (15 * 24 * 60 + 9 * 60) * 60_000;
      expect(buildDetail(w, 'u1', SECRET, NOW).location.fixAgeLabel).toBe('15d 9h');
    });

    test('an absent point has no age label to give', () => {
      const w = world();
      delete w.locations.u1;
      const d = buildDetail(w, 'u1', SECRET, NOW);
      expect(d.location.hasPoint).toBe(false);
      expect(d.location.fixAgeLabel).toBeNull();
    });

    test('a stale push token reads in days too', () => {
      const w = world();
      w.pushTokens.u1.tokA.lastSeen = NOW - 3 * 24 * 60 * 60_000;
      expect(buildDetail(w, 'u1', SECRET, NOW).pushTokens[0].lastSeenLabel).toBe('3d 0h ago');
    });

    test('the detail inherits the row availability, computed at the same instant', () => {
      const w = world();
      w.users.u1.presence.availableUntil = NOW - 1;
      expect(buildDetail(w, 'u1', SECRET, NOW).available).toBe(false);
    });
  });

  test('an unknown uid returns null', () => {
    expect(buildDetail(world(), 'nope', SECRET)).toBeNull();
  });
});

// Closes a coverage gap: none of the 13 tests above populate telegramByUid,
// so classifyProvenance's uid-derivation branch — the only place the
// `secret` argument does anything — was never exercised through project.js,
// and buildDetail's `telegram` object was never asserted non-null.
describe('buildRows provenance on a telegram-derived account', () => {
  test('classifies via the real secret-keyed derivation (fails if secret is dropped from the classifyProvenance call)', () => {
    const rows = buildRows(telegramWorld(), SECRET);
    const row = rows.find((r) => r.uid === DERIVED_UID);
    // If buildRows called classifyProvenance(uid, snapshot) without the
    // secret, deriveTelegramUid would throw on a missing secret and this
    // would come back { kind: 'unknown', exact: false, tgId } instead.
    expect(row.provenance).toEqual({ kind: 'telegram-derived', exact: true, tgId: TG_ID });
  });
});

describe('buildDetail telegram mapping', () => {
  test('reports the real tgId, chatId, and both linkedAt timestamps when linked', () => {
    const d = buildDetail(telegramWorld(), DERIVED_UID, SECRET);
    expect(d.telegram).toEqual({
      tgId: TG_ID,
      chatId: TG_ID,
      mappingLinkedAt: NOW - 500_000,
      prefsLinkedAt: NOW - 400_000,
    });
  });
});
