# Location Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opt-in location sharing that renders distance on existing contact cards — precise between sharing mutuals, coarse (<1 km floor) between sharing group co-members, nothing to everyone else.

**Architecture:** Approach A from the spec (`docs/superpowers/specs/2026-07-18-location-sharing-design.md`): raw coords in a rules-gated `locations/{uid}` subtree, grid-snapped coords in `locationCells/{gid}/{uid}`, distance computed client-side (haversine in `shared/`), reciprocity enforced by database rules keying off node existence. Glyph-as-toggle per context; capture tied to availability, 60 s refresh while foreground.

**Tech Stack:** Vanilla TS client (`.js` import specifiers), Firebase RTDB + rules, Cloud Functions (JS + JSDoc), jest (jsdom for client, node for functions/rules), `@firebase/rules-unit-testing` against the emulator.

## Global Constraints

- Branch: `claude/knockknock-feature-dev-9a3ysy`. Never push to `dev`/`main`.
- Client code is TS; imports use `.js` specifiers even for `.ts` sources (e.g. `from './db.js'`). Do NOT "fix" this.
- `functions/` stays JS with JSDoc types. Zero TS suppressions anywhere.
- `shared/` is the single source; `functions/_shared/` is a generated mirror — edit `shared/`, run `npm run sync-shared`, commit both. Never hand-edit the mirror.
- Shared modules may import ONLY sibling shared modules (purity fence, `tests/sharedMirror.test.js`).
- Never touch inline `<script>` in `index.template.html` (CSP hashes).
- Typechecks run from the repo root: `npm run typecheck && npm run typecheck:scripts`. A lingering `cd functions` breaks them.
- `tests/following.test.js` landmine: mid-file `require` returns a different module instance — bind exports at describe-eval time.
- `jest.clearAllMocks()` does not clear `mockResolvedValue`.
- Test commands: web `npx jest` (root), functions `cd functions && npm test`, rules suite needs the RTDB emulator on `127.0.0.1:9000` (`npx firebase emulators:exec --only database "npx jest -c jest.rules.config.js"` — check `package.json` for an existing `test:rules` script and prefer it).
- Distance copy (exact strings): precise `"120 m"` / `"2.3 km"` / `"23 km"`; coarse `"<1 km away"` / `"~3 km"`. Status-line separator: `" · "`.
- Grid snap: 0.01° (SNAP_DEG = 0.01).

---

### Task 1: `shared/geo.js` — haversine, snap, formatters (+ mirror)

**Files:**
- Create: `shared/geo.js`
- Create: `test-fixtures/geo-vectors.json`
- Create: `tests/geo.test.js`
- Create: `functions/test/geo.test.js`
- Modify: `functions/_shared/` (via `npm run sync-shared` only)

**Interfaces:**
- Produces: `haversineMeters(lat1, lng1, lat2, lng2): number`; `snapToCell(lat, lng): {lat, lng}` (0.01° grid); `formatDistancePrecise(m): string`; `formatDistanceCoarse(m): string`. Client imports from `../shared/geo.js` (or `../../shared/geo.js` from `js/db/`); functions import from `./_shared/geo.js`.

- [ ] **Step 1: Write the vector fixture**

`test-fixtures/geo-vectors.json` (both suites pin behavior to this one table, mirroring `time-format-vectors.json`):

```json
{
  "haversine": [
    { "a": [0, 0], "b": [0, 0], "meters": 0 },
    { "a": [52.5200, 13.4050], "b": [52.5205, 13.4055], "meters": 65 },
    { "a": [52.5200, 13.4050], "b": [52.5300, 13.4200], "meters": 1494 },
    { "a": [40.7128, -74.0060], "b": [51.5074, -0.1278], "meters": 5570222 },
    { "a": [0, 179.9], "b": [0, -179.9], "meters": 22264 },
    { "a": [89.9, 0], "b": [89.9, 180], "meters": 22239 }
  ],
  "snap": [
    { "in": [52.5237, 13.4123], "out": [52.52, 13.41] },
    { "in": [-33.8688, 151.2093], "out": [-33.87, 151.21] },
    { "in": [0.004, -0.004], "out": [0, -0] }
  ],
  "precise": [
    { "m": 0, "text": "0 m" },
    { "m": 120.4, "text": "120 m" },
    { "m": 999, "text": "999 m" },
    { "m": 1000, "text": "1.0 km" },
    { "m": 2340, "text": "2.3 km" },
    { "m": 9949, "text": "9.9 km" },
    { "m": 9950, "text": "10 km" },
    { "m": 23400, "text": "23 km" }
  ],
  "coarse": [
    { "m": 0, "text": "<1 km away" },
    { "m": 999, "text": "<1 km away" },
    { "m": 1000, "text": "~1 km" },
    { "m": 3400, "text": "~3 km" },
    { "m": 12600, "text": "~13 km" }
  ]
}
```

Haversine expectations are `Math.round` of the true value; the tests assert to within ±0.5% (floating point + Earth-radius convention).

- [ ] **Step 2: Write the failing web test**

`tests/geo.test.js`:

```js
/** @jest-environment node */
// Pins shared/geo.js behavior to test-fixtures/geo-vectors.json — the same
// table functions/test/geo.test.js pins the mirror to (parity discipline,
// like time-format-vectors.json).
const vectors = require('../test-fixtures/geo-vectors.json');
const { haversineMeters, snapToCell, formatDistancePrecise, formatDistanceCoarse } =
  require('../shared/geo.js');

describe('haversineMeters', () => {
  test.each(vectors.haversine)('%# distance', ({ a, b, meters }) => {
    const got = haversineMeters(a[0], a[1], b[0], b[1]);
    if (meters === 0) expect(got).toBe(0);
    else expect(Math.abs(got - meters) / meters).toBeLessThan(0.005);
  });
});

describe('snapToCell', () => {
  test.each(vectors.snap)('%# snap', ({ in: input, out }) => {
    const got = snapToCell(input[0], input[1]);
    expect(got.lat).toBeCloseTo(out[0], 10);
    expect(got.lng).toBeCloseTo(out[1], 10);
  });
});

describe('formatDistancePrecise', () => {
  test.each(vectors.precise)('%# $m → $text', ({ m, text }) => {
    expect(formatDistancePrecise(m)).toBe(text);
  });
});

describe('formatDistanceCoarse', () => {
  test.each(vectors.coarse)('%# $m → $text', ({ m, text }) => {
    expect(formatDistanceCoarse(m)).toBe(text);
  });
});
```

Note: `shared/` modules are ESM (`export function`); the web jest config already transpiles them (timeFormat is consumed the same way). If `require` of an ESM file fails here, mirror however `tests/` imports `shared/timeFormat.js` (check `grep -rn "shared/timeFormat" tests/`).

- [ ] **Step 3: Run it — expect FAIL** (`Cannot find module '../shared/geo.js'`)

Run: `npx jest tests/geo.test.js`

- [ ] **Step 4: Implement `shared/geo.js`**

```js
// shared/geo.js — distance math + formatters, ONE copy for web + functions.
// Consumed by js/ directly (../shared/…) and by functions/ via the committed
// byte-identical mirror functions/_shared/ (npm run sync-shared — never edit
// the mirror by hand). Behavior pinned by test-fixtures/geo-vectors.json in
// both suites.
//
// snapToCell quantizes to a 0.01° grid (~1.1 km lat, ≤1.1 km lng) BEFORE a
// coarse-tier write, so locationCells/ data is structurally incapable of
// sub-kilometer precision — the "<1 km" floor is enforced by what's stored,
// not by what's displayed.

const EARTH_RADIUS_M = 6371000;
const SNAP_DEG = 0.01;

/** @param {number} deg @returns {number} */
function toRad(deg) { return (deg * Math.PI) / 180; }

/** Great-circle distance in meters.
 * @param {number} lat1 @param {number} lng1 @param {number} lat2 @param {number} lng2
 * @returns {number} */
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/** Quantize a point to the coarse grid.
 * @param {number} lat @param {number} lng @returns {{ lat: number, lng: number }} */
export function snapToCell(lat, lng) {
  return {
    lat: Math.round(lat / SNAP_DEG) * SNAP_DEG,
    lng: Math.round(lng / SNAP_DEG) * SNAP_DEG,
  };
}

/** Precise-tier text: "120 m" / "2.3 km" / "23 km".
 * @param {number} m @returns {string} */
export function formatDistancePrecise(m) {
  if (m < 1000) return `${Math.round(m)} m`;
  const km = m / 1000;
  if (km < 9.95) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

/** Coarse-tier text: "<1 km away" / "~3 km".
 * @param {number} m @returns {string} */
export function formatDistanceCoarse(m) {
  if (m < 1000) return '<1 km away';
  return `~${Math.round(m / 1000)} km`;
}
```

- [ ] **Step 5: Run web test — expect PASS.** If the 9949/9950 boundary vectors fail, the fixture is wrong, not the code: adjust the fixture so `9.9 km`/`10 km` matches `toFixed(1)` vs `Math.round` behavior at the boundary you actually observe, keeping one vector on each side.

Run: `npx jest tests/geo.test.js`

- [ ] **Step 6: Mirror + functions test**

Run: `npm run sync-shared`

`functions/test/geo.test.js`:

```js
// Pins the committed mirror functions/_shared/geo.js to the same vector table
// the web suite uses — a divergent mirror is a red test, not a prod surprise.
const vectors = require('../../test-fixtures/geo-vectors.json');
const { haversineMeters, snapToCell, formatDistancePrecise, formatDistanceCoarse } =
  require('../_shared/geo.js');

test.each(vectors.precise)('precise $m → $text', ({ m, text }) => {
  expect(formatDistancePrecise(m)).toBe(text);
});
test.each(vectors.coarse)('coarse $m → $text', ({ m, text }) => {
  expect(formatDistanceCoarse(m)).toBe(text);
});
test.each(vectors.haversine)('haversine %#', ({ a, b, meters }) => {
  const got = haversineMeters(a[0], a[1], b[0], b[1]);
  if (meters === 0) expect(got).toBe(0);
  else expect(Math.abs(got - meters) / meters).toBeLessThan(0.005);
});
test.each(vectors.snap)('snap %#', ({ in: input, out }) => {
  const got = snapToCell(input[0], input[1]);
  expect(got.lat).toBeCloseTo(out[0], 10);
  expect(got.lng).toBeCloseTo(out[1], 10);
});
```

Check how `functions/test/` imports `_shared/timeFormat.js` (`grep -rn "_shared" functions/test/ | head`) and mirror that import style if `require` of ESM fails.

- [ ] **Step 7: Run both suites + mirror guard — expect PASS**

Run: `npx jest tests/geo.test.js tests/sharedMirror.test.js && cd functions && npm test -- geo && cd ..`

- [ ] **Step 8: Commit**

```bash
git add shared/geo.js functions/_shared/ test-fixtures/geo-vectors.json tests/geo.test.js functions/test/geo.test.js
git commit -m "feat(geo): shared haversine, cell snap, distance formatters"
```

---

### Task 2: Database rules for `locations/` and `locationCells/` (+ rules tests)

**Files:**
- Modify: `database.rules.json` (insert both blocks before the `"notifierState"` line)
- Create: `tests/rules/locations.test.js`

**Interfaces:**
- Produces: the rules contract every later task relies on — owner-write with validators; mutual+reciprocal read on `locations/`; member+reciprocal read on `locationCells/`; delete-only carve-out on cells.

- [ ] **Step 1: Write the failing rules tests**

`tests/rules/locations.test.js`:

```js
/** @jest-environment node */
// Rules for the location-sharing feature (spec 2026-07-18): locations/{uid}
// readable only by a MUTUAL who is ALSO currently publishing (reciprocity by
// node existence); locationCells/{gid}/{uid} readable only by a co-member
// publishing into that same group.
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { makeTestEnv, dbAs, seed } = require('./helpers');

let env;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

const LOC = { lat: 52.52, lng: 13.405, updatedAt: 1752800000000 };

// alice ↔ bob mutual; alice → carol one-way (alice follows carol only).
async function seedFollows(db) {
  await db.ref('users/alice/followers/bob').set('BOBCOD');
  await db.ref('users/bob/followers/alice').set('ALICOD');
  await db.ref('users/carol/followers/alice').set('ALICOD');
}

describe('locations/{uid}', () => {
  test('owner can write a valid node', async () => {
    await assertSucceeds(dbAs(env, 'alice').ref('locations/alice').set(LOC));
  });

  test('non-owner cannot write', async () => {
    await assertFails(dbAs(env, 'bob').ref('locations/alice').set(LOC));
  });

  test('validators: out-of-range lat, out-of-range lng, non-number updatedAt, unknown child', async () => {
    const own = dbAs(env, 'alice').ref('locations/alice');
    await assertFails(own.set({ ...LOC, lat: 91 }));
    await assertFails(own.set({ ...LOC, lat: -91 }));
    await assertFails(own.set({ ...LOC, lng: 181 }));
    await assertFails(own.set({ ...LOC, lng: -181 }));
    await assertFails(own.set({ ...LOC, updatedAt: 'now' }));
    await assertFails(own.set({ ...LOC, extra: true }));
  });

  test('owner can always read own node', async () => {
    await seed(env, async (db) => { await db.ref('locations/alice').set(LOC); });
    await assertSucceeds(dbAs(env, 'alice').ref('locations/alice').get());
  });

  test('mutual who is publishing can read', async () => {
    await seed(env, async (db) => {
      await seedFollows(db);
      await db.ref('locations/alice').set(LOC);
      await db.ref('locations/bob').set(LOC);
    });
    await assertSucceeds(dbAs(env, 'bob').ref('locations/alice').get());
  });

  test('mutual who is NOT publishing cannot read (reciprocity)', async () => {
    await seed(env, async (db) => {
      await seedFollows(db);
      await db.ref('locations/alice').set(LOC); // bob has no locations/bob
    });
    await assertFails(dbAs(env, 'bob').ref('locations/alice').get());
  });

  test('one-way follower cannot read even when publishing', async () => {
    await seed(env, async (db) => {
      // alice follows carol (users/carol/followers/alice), carol never
      // followed back — carol reading alice needs users/alice/followers/carol,
      // which is absent.
      await seedFollows(db);
      await db.ref('locations/alice').set(LOC);
      await db.ref('locations/carol').set(LOC);
    });
    await assertFails(dbAs(env, 'carol').ref('locations/alice').get());
  });

  test('unauthenticated cannot read', async () => {
    await seed(env, async (db) => { await db.ref('locations/alice').set(LOC); });
    await assertFails(dbAs(env, null).ref('locations/alice').get());
  });
});

describe('locationCells/{gid}/{uid}', () => {
  const CELL = { lat: 52.52, lng: 13.41, updatedAt: 1752800000000 };

  async function seedGroup(db) {
    await db.ref('groups/G1/ownerId').set('alice');
    await db.ref('groups/G1/members/alice').set({ displayName: 'Alice' });
    await db.ref('groups/G1/members/bob').set({ displayName: 'Bob' });
  }

  test('member can write own cell', async () => {
    await seed(env, seedGroup);
    await assertSucceeds(dbAs(env, 'alice').ref('locationCells/G1/alice').set(CELL));
  });

  test('member cannot write another member cell', async () => {
    await seed(env, seedGroup);
    await assertFails(dbAs(env, 'alice').ref('locationCells/G1/bob').set(CELL));
  });

  test('non-member cannot write a cell', async () => {
    await seed(env, seedGroup);
    await assertFails(dbAs(env, 'mallory').ref('locationCells/G1/mallory').set(CELL));
  });

  test('kicked user can still DELETE own orphaned cell (carve-out)', async () => {
    await seed(env, async (db) => {
      await seedGroup(db);
      await db.ref('locationCells/G1/carol').set(CELL); // carol was a member once
    });
    await assertSucceeds(dbAs(env, 'carol').ref('locationCells/G1/carol').remove());
  });

  test('co-member publishing into the group can read cells', async () => {
    await seed(env, async (db) => {
      await seedGroup(db);
      await db.ref('locationCells/G1/alice').set(CELL);
      await db.ref('locationCells/G1/bob').set(CELL);
    });
    await assertSucceeds(dbAs(env, 'bob').ref('locationCells/G1/alice').get());
  });

  test('co-member NOT publishing into the group cannot read (reciprocity)', async () => {
    await seed(env, async (db) => {
      await seedGroup(db);
      await db.ref('locationCells/G1/alice').set(CELL); // bob has no cell in G1
    });
    await assertFails(dbAs(env, 'bob').ref('locationCells/G1/alice').get());
  });

  test('non-member cannot read even with a (stale) cell present', async () => {
    await seed(env, async (db) => {
      await seedGroup(db);
      await db.ref('locationCells/G1/alice').set(CELL);
      await db.ref('locationCells/G1/mallory').set(CELL);
    });
    await assertFails(dbAs(env, 'mallory').ref('locationCells/G1/alice').get());
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (reads/writes currently denied by `$other` catch-all, so the `assertSucceeds` cases fail)

Run: `npx firebase emulators:exec --only database "npx jest -c jest.rules.config.js tests/rules/locations.test.js"` (or the repo's `test:rules` script if one exists in `package.json` — check first)

- [ ] **Step 3: Add the rules**

In `database.rules.json`, insert before `"notifierState"`:

```json
"locations": {
  "$uid": {
    ".read": "auth != null && (auth.uid === $uid || (root.child('users').child($uid).child('followers').child(auth.uid).exists() && root.child('users').child(auth.uid).child('followers').child($uid).exists() && root.child('locations').child(auth.uid).exists()))",
    ".write": "auth != null && auth.uid === $uid",
    ".validate": "newData.hasChildren(['lat', 'lng', 'updatedAt'])",
    "lat": { ".validate": "newData.isNumber() && newData.val() >= -90 && newData.val() <= 90" },
    "lng": { ".validate": "newData.isNumber() && newData.val() >= -180 && newData.val() <= 180" },
    "updatedAt": { ".validate": "newData.isNumber()" },
    "$other": { ".validate": false }
  }
},
"locationCells": {
  "$gid": {
    "$uid": {
      ".read": "auth != null && root.child('groups').child($gid).child('members').child(auth.uid).exists() && root.child('locationCells').child($gid).child(auth.uid).exists()",
      ".write": "auth != null && auth.uid === $uid && (root.child('groups').child($gid).child('members').child(auth.uid).exists() || !newData.exists())",
      ".validate": "newData.hasChildren(['lat', 'lng', 'updatedAt'])",
      "lat": { ".validate": "newData.isNumber() && newData.val() >= -90 && newData.val() <= 90" },
      "lng": { ".validate": "newData.isNumber() && newData.val() >= -180 && newData.val() <= 180" },
      "updatedAt": { ".validate": "newData.isNumber()" },
      "$other": { ".validate": false }
    }
  }
},
```

Note the cells `.read` sits on `$uid` (per-cell), and a reader's own-cell existence check references `root`, so it works even though the read target is a sibling.

- [ ] **Step 4: Run rules suite — expect PASS** (same command as Step 2, then the FULL rules suite to catch regressions: run it without the file filter)

- [ ] **Step 5: Commit**

```bash
git add database.rules.json tests/rules/locations.test.js
git commit -m "feat(rules): locations + locationCells subtrees with rules-enforced reciprocity"
```

---

### Task 3: Types + DB primitives (`js/db/location.ts`) + barrel export

**Files:**
- Modify: `types/app.d.ts` (append)
- Create: `js/db/location.ts`
- Modify: `js/db.ts` (add one re-export line)

**Interfaces:**
- Produces (all reached via `from './db.js'`):
  - `publishLocation(userId: string, lat: number, lng: number, updatedAt: number): Promise<void>` — writes `locations/{uid}` (raw).
  - `publishLocationCell(gid: string, userId: string, lat: number, lng: number, updatedAt: number): Promise<void>` — snaps via `snapToCell` then writes `locationCells/{gid}/{uid}`. **Separate write per cell on purpose:** a multipath update fails atomically if ANY path is denied, so one stale-membership cell would kill the precise-tier write too.
  - `clearLocationData(userId: string, gids: string[]): Promise<void>` — one multipath update setting `locations/{uid}` and each `locationCells/{gid}/{uid}` to null (deletes always pass rules via the carve-out).
  - `watchLocation(userId: string, cb: (loc: LocationNode | null) => void): () => void`
  - `watchLocationCell(gid: string, userId: string, cb: (loc: LocationNode | null) => void): () => void`
- Consumes: `snapToCell` from Task 1.

- [ ] **Step 1: Append to `types/app.d.ts`**

```ts
/** locations/{uid} and locationCells/{gid}/{uid} nodes. */
interface LocationNode {
  lat?: number;
  lng?: number;
  updatedAt?: number;
}
```

- [ ] **Step 2: Create `js/db/location.ts`**

```ts
// js/db/location.ts — RTDB ops for the location-sharing feature (spec
// 2026-07-18). Raw point at locations/{uid} (mutual+reciprocity-gated by
// rules); grid-snapped point per group at locationCells/{gid}/{uid}
// (member+reciprocity-gated). Cells are written one ref per group, NOT in a
// multipath update with the raw point: a multipath write is atomic, so a
// single stale-membership cell (kicked mid-session) would fail the precise
// write too. Deletes go multipath — the cells' delete-only carve-out means
// they can't be denied.
import { db } from '../firebase-config.js';
import { ref, set, update, onValue } from 'firebase/database';
import { snapToCell } from '../../shared/geo.js';

export async function publishLocation(userId: string, lat: number, lng: number, updatedAt: number): Promise<void> {
  await set(ref(db, `locations/${userId}`), { lat, lng, updatedAt });
}

export async function publishLocationCell(gid: string, userId: string, lat: number, lng: number, updatedAt: number): Promise<void> {
  const cell = snapToCell(lat, lng);
  await set(ref(db, `locationCells/${gid}/${userId}`), { lat: cell.lat, lng: cell.lng, updatedAt });
}

export async function clearLocationData(userId: string, gids: string[]): Promise<void> {
  const updates: Record<string, null> = { [`locations/${userId}`]: null };
  for (const gid of gids) updates[`locationCells/${gid}/${userId}`] = null;
  await update(ref(db), updates);
}

export function watchLocation(userId: string, cb: (loc: LocationNode | null) => void): () => void {
  return onValue(ref(db, `locations/${userId}`), (snap) => cb(snap.val()));
}

export function watchLocationCell(gid: string, userId: string, cb: (loc: LocationNode | null) => void): () => void {
  return onValue(ref(db, `locationCells/${gid}/${userId}`), (snap) => cb(snap.val()));
}
```

Match the `onValue`-unsubscribe convention used in `js/db/social.ts` (`watchPresence`, `js/db/social.ts:130-133`) — if that file wraps `onValue` differently (e.g. returns `off`-based teardown), copy its exact pattern.

- [ ] **Step 3: Add to `js/db.ts` after `export * from './db/social.js';`**

```ts
export * from './db/location.js';
```

- [ ] **Step 4: Typecheck — expect PASS**

Run: `npm run typecheck && npm run typecheck:scripts`

- [ ] **Step 5: Run the web suite to confirm nothing regressed** (the barrel is mocked at `./db.js` in tests; new exports are additive)

Run: `npx jest`
Expected: 81+ suites pass.

- [ ] **Step 6: Commit**

```bash
git add types/app.d.ts js/db/location.ts js/db.ts
git commit -m "feat(db): location publish/clear/watch primitives"
```

---

### Task 4: Prefs — per-context opt-in accessors + server sync

**Files:**
- Modify: `js/prefs.ts`
- Modify: `tests/prefs.test.js`
- Modify: `types/app.d.ts` (extend `UserPrefs`)

**Interfaces:**
- Produces: `getLocationOptIn(context: string): boolean` and `setLocationOptIn(context: string, on: boolean): void` where `context` is `'direct'` or a group id. `syncFromServer` handles `serverPrefs.location` and dispatches `location-prefs-synced` (a `CustomEvent` with no detail — consumers re-read via the getter).
- Storage: localStorage key `statusapp_location_prefs` caching `{ direct?: boolean, groups?: Record<string, boolean> }`; server path `userPrefs/{uid}/location/direct` and `userPrefs/{uid}/location/groups/{gid}`.

- [ ] **Step 1: Extend `UserPrefs` in `types/app.d.ts`.** Find the `interface UserPrefs` declaration (`grep -n "interface UserPrefs" types/app.d.ts`) and add:

```ts
  location?: { direct?: boolean; groups?: Record<string, boolean> };
```

- [ ] **Step 2: Write the failing tests** (append a describe block to `tests/prefs.test.js`, following that file's existing setup conventions — read its top ~40 lines first for how it mocks `./db.js` and resets localStorage):

```js
describe('location opt-in prefs', () => {
  test('defaults off for direct and any group', () => {
    expect(prefs.getLocationOptIn('direct')).toBe(false);
    expect(prefs.getLocationOptIn('G1')).toBe(false);
  });

  test('set direct writes cache and userPrefs', () => {
    prefs.setLocationOptIn('direct', true);
    expect(prefs.getLocationOptIn('direct')).toBe(true);
    expect(mergeUserPrefs).toHaveBeenCalledWith('me', { 'location/direct': true });
  });

  test('set group writes cache and userPrefs', () => {
    prefs.setLocationOptIn('G1', true);
    expect(prefs.getLocationOptIn('G1')).toBe(true);
    expect(prefs.getLocationOptIn('G2')).toBe(false);
    expect(mergeUserPrefs).toHaveBeenCalledWith('me', { 'location/groups/G1': true });
  });

  test('syncFromServer hydrates the cache and dispatches location-prefs-synced', () => {
    const seen = jest.fn();
    document.addEventListener('location-prefs-synced', seen);
    prefs.syncFromServer({ location: { direct: true, groups: { G1: true, G2: false } } });
    expect(prefs.getLocationOptIn('direct')).toBe(true);
    expect(prefs.getLocationOptIn('G1')).toBe(true);
    expect(prefs.getLocationOptIn('G2')).toBe(false);
    expect(seen).toHaveBeenCalled();
  });
});
```

Adapt the `mergeUserPrefs` mock reference and the `initPrefs('me')` call to the file's existing pattern — the assertions above are the contract; the harness lines around them follow the file.

- [ ] **Step 3: Run — expect FAIL** (`getLocationOptIn is not a function`)

Run: `npx jest tests/prefs.test.js`

- [ ] **Step 4: Implement in `js/prefs.ts`** (new section after the notify-prefs section, same cache pattern):

```ts
// ── Location sharing opt-in (per context: 'direct' | groupId) ───────────────
// The glyph next to the time-remaining text is the ONLY control surface for
// these (spec 2026-07-18 §6.1). Cached as one JSON map so reads stay sync.
const LOCATION_PREFS_KEY = 'statusapp_location_prefs';

function readLocationCache(): { direct?: boolean; groups?: Record<string, boolean> } {
  try { return JSON.parse(localStorage.getItem(LOCATION_PREFS_KEY) as string) || {}; }
  catch { return {}; }
}
function writeLocationCache(map: { direct?: boolean; groups?: Record<string, boolean> }) {
  try { localStorage.setItem(LOCATION_PREFS_KEY, JSON.stringify(map)); } catch { /* quota */ }
}

export function getLocationOptIn(context: string): boolean {
  const map = readLocationCache();
  return context === 'direct' ? !!map.direct : !!map.groups?.[context];
}

export function setLocationOptIn(context: string, on: boolean) {
  const map = readLocationCache();
  if (context === 'direct') map.direct = !!on;
  else map.groups = { ...(map.groups || {}), [context]: !!on };
  writeLocationCache(map);
  if (_myUserId) {
    const field = context === 'direct' ? 'location/direct' : `location/groups/${context}`;
    mergeUserPrefs(_myUserId, { [field]: !!on }).catch(() => {});
  }
}
```

And in `syncFromServer`, after the notify-prefs block:

```ts
  // Location-sharing opt-ins (per context)
  if (serverPrefs.location && typeof serverPrefs.location === 'object') {
    writeLocationCache({
      direct: !!serverPrefs.location.direct,
      groups: { ...(serverPrefs.location.groups || {}) },
    });
    document.dispatchEvent(new CustomEvent('location-prefs-synced'));
  }
```

- [ ] **Step 5: Run — expect PASS**

Run: `npx jest tests/prefs.test.js && npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add js/prefs.ts tests/prefs.test.js types/app.d.ts
git commit -m "feat(prefs): per-context location opt-in with cross-device sync"
```

---

### Task 5: `js/locationHub.ts` — multiplexed watches + distance fan-out

**Files:**
- Create: `js/locationHub.ts`
- Create: `tests/locationHub.test.js`

**Interfaces:**
- Consumes: `watchLocation`, `watchLocationCell` from `./db.js` (Task 3); `haversineMeters` from `../shared/geo.js` (Task 1).
- Produces:
  - `subscribeDistance(myUid: string, peerUid: string, cb: (meters: number | null) => void): () => void` — precise tier. Internally multiplexes ONE `watchLocation` per uid (own node included) across all consumers, combines own + peer points, calls `cb` with haversine meters, or `null` when either point is absent.
  - `subscribeCellDistance(gid: string, myUid: string, peerUid: string, cb: (meters: number | null) => void): () => void` — coarse tier, same contract over `watchLocationCell`.
  - `_activeLocationWatchCount(): number`, `_resetLocationHub(): void` — tests/diagnostics.

- [ ] **Step 1: Write the failing tests.** Model the file on `tests/presenceHub.test.js` (read it first; reuse its mock style for `./db.js`). Contract to pin:

```js
// tests/locationHub.test.js — mirrors presenceHub.test.js's harness style.
// Mock './db.js' BEFORE importing the hub, capturing per-path callbacks so
// tests can push location ticks by hand.
jest.mock('../js/db.js', () => {
  const watchers = new Map(); // key: uid or `${gid}/${uid}` → Set<cb>
  return {
    __watchers: watchers,
    watchLocation: jest.fn((uid, cb) => {
      if (!watchers.has(uid)) watchers.set(uid, new Set());
      watchers.get(uid).add(cb);
      return () => watchers.get(uid)?.delete(cb);
    }),
    watchLocationCell: jest.fn((gid, uid, cb) => {
      const key = `${gid}/${uid}`;
      if (!watchers.has(key)) watchers.set(key, new Set());
      watchers.get(key).add(cb);
      return () => watchers.get(key)?.delete(cb);
    }),
  };
});
const db = require('../js/db.js');
const { subscribeDistance, subscribeCellDistance, _activeLocationWatchCount, _resetLocationHub } =
  require('../js/locationHub.js');

const fire = (key, val) => { for (const cb of db.__watchers.get(key) || []) cb(val); };

beforeEach(() => { _resetLocationHub(); db.__watchers.clear(); });

test('emits null until both points exist, then meters', () => {
  const cb = jest.fn();
  subscribeDistance('me', 'peer', cb);
  fire('me', { lat: 52.52, lng: 13.405, updatedAt: 1 });
  expect(cb).toHaveBeenLastCalledWith(null);
  fire('peer', { lat: 52.5205, lng: 13.4055, updatedAt: 1 });
  expect(cb.mock.calls.at(-1)[0]).toBeGreaterThan(50);
  expect(cb.mock.calls.at(-1)[0]).toBeLessThan(80);
});

test('peer going null (stopped publishing) emits null', () => {
  const cb = jest.fn();
  subscribeDistance('me', 'peer', cb);
  fire('me', { lat: 1, lng: 1, updatedAt: 1 });
  fire('peer', { lat: 1, lng: 1.001, updatedAt: 1 });
  fire('peer', null);
  expect(cb).toHaveBeenLastCalledWith(null);
});

test('own node is watched ONCE across N peer subscriptions', () => {
  subscribeDistance('me', 'a', () => {});
  subscribeDistance('me', 'b', () => {});
  subscribeDistance('me', 'c', () => {});
  // 1 own + 3 peers = 4 underlying watches, not 6
  expect(_activeLocationWatchCount()).toBe(4);
});

test('unsubscribe tears down the underlying watch when last consumer leaves', () => {
  const un1 = subscribeDistance('me', 'a', () => {});
  const un2 = subscribeDistance('me', 'a', () => {});
  un1(); un2();
  expect(_activeLocationWatchCount()).toBe(0);
});

test('cell distance combines per-group cells', () => {
  const cb = jest.fn();
  subscribeCellDistance('G1', 'me', 'peer', cb);
  fire('G1/me', { lat: 52.52, lng: 13.41, updatedAt: 1 });
  fire('G1/peer', { lat: 52.53, lng: 13.42, updatedAt: 1 });
  expect(cb.mock.calls.at(-1)[0]).toBeGreaterThan(1000);
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found)

Run: `npx jest tests/locationHub.test.js`

- [ ] **Step 3: Implement `js/locationHub.ts`**

```ts
// js/locationHub.js
// Multiplexes location watches the way presenceHub.js multiplexes presence:
// one underlying onValue per node, fanned out to every consumer. Consumers
// subscribe to a DISTANCE (own point + peer point combined via haversine),
// not to raw nodes — so the own-location watch is shared by every row on
// screen, and no renderer ever holds raw peer coordinates beyond the combine.
import { watchLocation, watchLocationCell } from './db.js';
import { haversineMeters } from '../shared/geo.js';

type LocCb = (loc: LocationNode | null) => void;
interface NodeEntry {
  unsub: (() => void) | null;
  consumers: Set<LocCb>;
  last: LocationNode | null;
  hasValue: boolean;
}

const _nodes = new Map<string, NodeEntry>(); // key: `loc:${uid}` | `cell:${gid}/${uid}`

function subscribeNode(key: string, start: (cb: LocCb) => () => void, cb: LocCb): () => void {
  let e = _nodes.get(key);
  const isNew = !e;
  if (isNew) {
    e = { unsub: null, consumers: new Set(), last: null, hasValue: false };
    _nodes.set(key, e);
  }
  e!.consumers.add(cb);
  if (isNew) {
    e!.unsub = start((data) => {
      e!.last = data;
      e!.hasValue = true;
      for (const c of [...e!.consumers]) { try { c(data); } catch { /* one consumer threw */ } }
    });
  } else if (e!.hasValue) {
    const v = e!.last;
    Promise.resolve().then(() => {
      const cur = _nodes.get(key);
      if (cur && cur.consumers.has(cb)) cb(v);
    });
  }
  return () => {
    const cur = _nodes.get(key);
    if (!cur) return;
    cur.consumers.delete(cb);
    if (cur.consumers.size === 0) {
      if (cur.unsub) cur.unsub();
      _nodes.delete(key);
    }
  };
}

function combine(
  subA: (cb: LocCb) => () => void,
  subB: (cb: LocCb) => () => void,
  cb: (meters: number | null) => void,
): () => void {
  let a: LocationNode | null = null;
  let b: LocationNode | null = null;
  const emit = () => {
    if (a && b && typeof a.lat === 'number' && typeof a.lng === 'number'
      && typeof b.lat === 'number' && typeof b.lng === 'number') {
      cb(haversineMeters(a.lat, a.lng, b.lat, b.lng));
    } else {
      cb(null);
    }
  };
  const unA = subA((v) => { a = v; emit(); });
  const unB = subB((v) => { b = v; emit(); });
  return () => { unA(); unB(); };
}

export function subscribeDistance(myUid: string, peerUid: string, cb: (meters: number | null) => void) {
  return combine(
    (c) => subscribeNode(`loc:${myUid}`, (h) => watchLocation(myUid, h), c),
    (c) => subscribeNode(`loc:${peerUid}`, (h) => watchLocation(peerUid, h), c),
    cb,
  );
}

export function subscribeCellDistance(gid: string, myUid: string, peerUid: string, cb: (meters: number | null) => void) {
  return combine(
    (c) => subscribeNode(`cell:${gid}/${myUid}`, (h) => watchLocationCell(gid, myUid, h), c),
    (c) => subscribeNode(`cell:${gid}/${peerUid}`, (h) => watchLocationCell(gid, peerUid, h), c),
    cb,
  );
}

export function _activeLocationWatchCount() { return _nodes.size; }

export function _resetLocationHub() {
  for (const e of _nodes.values()) { if (e.unsub) e.unsub(); }
  _nodes.clear();
}
```

- [ ] **Step 4: Run — expect PASS.** Then typecheck.

Run: `npx jest tests/locationHub.test.js && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add js/locationHub.ts tests/locationHub.test.js
git commit -m "feat(location): distance hub — multiplexed watches, own-node sharing"
```

---

### Task 6: `js/locationShare.ts` — capture loop, permission, teardown

**Files:**
- Create: `js/locationShare.ts`
- Create: `tests/locationShare.test.js`

**Interfaces:**
- Consumes: `publishLocation`, `publishLocationCell`, `clearLocationData` from `./db.js`; `getLocationOptIn`, `setLocationOptIn` from `./prefs.js`; `subscribeOwnStatus` from `./ownStatus.js` (`js/ownStatus.ts:42`); `isAvailable` from `./db.js`; `isTelegramContext` from `./telegram.js`.
- Produces:
  - `initLocationShare(userId: string, getOptedInGids: () => string[]): void` — wires the own-status subscription and visibility listener; `getOptedInGids` returns ALL group ids whose opt-in pref is on, with NO membership filter. Deliberate: a publish to a group the user was kicked from fails as a single harmless denied write (cells are written one ref at a time), while clears sweep the orphaned cell via the delete-only rules carve-out — this IS the spec-§8 "kicked user's next tick or launch cleans it" mechanism.
  - `toggleContext(context: string): Promise<'on' | 'off' | 'denied' | 'unsupported'>` — the glyph handler. Flips the pref; on first enable requests permission; returns the resulting state for glyph painting.
  - `capabilityState(): 'supported' | 'unsupported'` — for initial glyph rendering.
  - `_tickNow(): Promise<void>`, `_resetLocationShare(): void` — tests.
- Behavior contract (all TDD'd below): publishes every 60 s while (any context opted in ∧ own status available ∧ document visible ∧ permission granted); raw point written only when `'direct'` opted in; one cell per opted-in gid; going unavailable or toggling the last context off calls `clearLocationData`; hidden pauses the timer, visible resumes with an immediate tick.

- [ ] **Step 1: Write the failing tests**

`tests/locationShare.test.js`:

```js
// Capture-loop contract for js/locationShare.ts. Geolocation is mocked at
// navigator.geolocation; db at the './db.js' barrel; prefs real (jsdom
// localStorage). Fake timers drive the 60s cadence.
jest.mock('../js/db.js', () => ({
  publishLocation: jest.fn().mockResolvedValue(undefined),
  publishLocationCell: jest.fn().mockResolvedValue(undefined),
  clearLocationData: jest.fn().mockResolvedValue(undefined),
  isAvailable: (status, until) => status === 'available' && (until == null || until > Date.now()),
  mergeUserPrefs: jest.fn().mockResolvedValue(undefined),
  readPushTokens: jest.fn().mockResolvedValue(null),
}));
jest.mock('../js/telegram.js', () => ({ isTelegramContext: () => false }));
jest.mock('../js/ownStatus.js', () => {
  let cbs = [];
  return {
    subscribeOwnStatus: jest.fn((cb) => { cbs.push(cb); return () => { cbs = cbs.filter(c => c !== cb); }; }),
    __fireOwnStatus: (presence) => cbs.forEach(c => c(presence)),
  };
});

const db = require('../js/db.js');
const ownStatus = require('../js/ownStatus.js');
const prefs = require('../js/prefs.js');

const POS = { coords: { latitude: 52.52, longitude: 13.405 } };
let geoBehavior;

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  jest.clearAllMocks();
  geoBehavior = (ok, err) => ok(POS);
  Object.defineProperty(global.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: jest.fn((ok, err) => geoBehavior(ok, err)) },
  });
  prefs.initPrefs('me');
});
afterEach(() => {
  const { _resetLocationShare } = require('../js/locationShare.js');
  _resetLocationShare();
  jest.useRealTimers();
});

// Fresh module instance per test-file run is fine; state resets via _resetLocationShare.
const share = () => require('../js/locationShare.js');

async function flush() { await Promise.resolve(); await Promise.resolve(); }

test('no publish while nothing is opted in, even when available', async () => {
  const { initLocationShare } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await flush();
  expect(db.publishLocation).not.toHaveBeenCalled();
});

test('direct opt-in + available publishes raw point immediately and every 60s', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await expect(toggleContext('direct')).resolves.toBe('on');
  await flush();
  expect(db.publishLocation).toHaveBeenCalledWith('me', 52.52, 13.405, expect.any(Number));
  db.publishLocation.mockClear();
  jest.advanceTimersByTime(60000);
  await flush();
  expect(db.publishLocation).toHaveBeenCalledTimes(1);
});

test('group opt-in publishes that cell, not the raw point', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await expect(toggleContext('G1')).resolves.toBe('on');
  await flush();
  expect(db.publishLocationCell).toHaveBeenCalledWith('G1', 'me', 52.52, 13.405, expect.any(Number));
  expect(db.publishLocation).not.toHaveBeenCalled();
});

test('going unavailable clears published data and stops the loop', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('direct');
  await flush();
  ownStatus.__fireOwnStatus({ status: 'unavailable', availableUntil: null });
  await flush();
  expect(db.clearLocationData).toHaveBeenCalledWith('me', []);
  db.publishLocation.mockClear();
  jest.advanceTimersByTime(120000);
  await flush();
  expect(db.publishLocation).not.toHaveBeenCalled();
  // …and the opt-in pref SURVIVES (publishing resumes on next available)
  expect(prefs.getLocationOptIn('direct')).toBe(true);
});

test('toggling the last context off clears data', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('direct');
  await flush();
  await expect(toggleContext('direct')).resolves.toBe('off');
  await flush();
  expect(db.clearLocationData).toHaveBeenCalled();
});

test('permission denial returns denied, flips the pref back off, and clears', async () => {
  geoBehavior = (ok, err) => err({ code: 1 }); // PERMISSION_DENIED
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await expect(toggleContext('direct')).resolves.toBe('denied');
  expect(prefs.getLocationOptIn('direct')).toBe(false);
  expect(db.publishLocation).not.toHaveBeenCalled();
});

test('a failed tick is silent — no clear, loop continues', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('direct');
  await flush();
  geoBehavior = (ok, err) => err({ code: 3 }); // TIMEOUT
  jest.advanceTimersByTime(60000);
  await flush();
  expect(db.clearLocationData).not.toHaveBeenCalled();
  geoBehavior = (ok) => ok(POS);
  db.publishLocation.mockClear();
  jest.advanceTimersByTime(60000);
  await flush();
  expect(db.publishLocation).toHaveBeenCalledTimes(1);
});

test('hidden document pauses ticks; visible resumes with an immediate tick', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('direct');
  await flush();
  db.publishLocation.mockClear();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  jest.advanceTimersByTime(180000);
  await flush();
  expect(db.publishLocation).not.toHaveBeenCalled();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
  await flush();
  expect(db.publishLocation).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found)

Run: `npx jest tests/locationShare.test.js`

- [ ] **Step 3: Implement `js/locationShare.ts`**

```ts
// js/locationShare.js
// The location-sharing capture loop (spec 2026-07-18 §5). One loop, gated per
// tick on: any context opted in ∧ own status available ∧ document visible ∧
// permission. Raw point published only when 'direct' is opted in; one snapped
// cell per opted-in group. Going unavailable (or toggling the last context
// off) deletes everything published — the opt-in prefs survive, so returning
// to available resumes silently. Failed ticks are silent by design (Decision
// 3): the last written value stands and the next tick tries again.
import { publishLocation, publishLocationCell, clearLocationData, isAvailable } from './db.js';
import { getLocationOptIn, setLocationOptIn } from './prefs.js';
import { subscribeOwnStatus } from './ownStatus.js';
import { isTelegramContext } from './telegram.js';

const TICK_MS = 60000;

let _userId: string | null = null;
let _getOptedInGids: () => string[] = () => [];
let _available = false;
let _timer: ReturnType<typeof setInterval> | null = null;
let _unsubOwn: (() => void) | null = null;
let _visListener: (() => void) | null = null;

function anyOptIn(): boolean {
  return getLocationOptIn('direct') || _getOptedInGids().length > 0;
}

// One position read, browser or Telegram. Rejects with the underlying error;
// callers map code 1 (PERMISSION_DENIED) to the denied state.
function getPositionOnce(): Promise<{ lat: number; lng: number }> {
  if (isTelegramContext()) {
    return new Promise((resolve, reject) => {
      const lm = (window as unknown as {
        Telegram?: { WebApp?: { LocationManager?: {
          init: (cb?: () => void) => void;
          getLocation: (cb: (data: { latitude: number; longitude: number } | null) => void) => void;
        } } };
      }).Telegram?.WebApp?.LocationManager;
      if (!lm) { reject(new Error('unsupported')); return; }
      lm.init(() => {
        lm.getLocation((data) => {
          if (data) resolve({ lat: data.latitude, lng: data.longitude });
          else reject({ code: 1 }); // user declined in Telegram's dialog
        });
      });
    });
  }
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('unsupported')); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 },
    );
  });
}

async function tick(): Promise<void> {
  if (!_userId || !_available || !anyOptIn()) return;
  if (document.visibilityState !== 'visible') return;
  let pos;
  try { pos = await getPositionOnce(); } catch { return; } // silent failed tick
  const now = Date.now();
  if (getLocationOptIn('direct')) {
    publishLocation(_userId, pos.lat, pos.lng, now).catch(() => {});
  }
  // One write per cell, NOT multipath with the raw point — a stale-membership
  // cell denial must not take the precise tier down with it (db/location.js).
  for (const gid of _getOptedInGids()) {
    publishLocationCell(gid, _userId, pos.lat, pos.lng, now).catch(() => {});
  }
}

function startLoop() {
  if (_timer !== null) return;
  _timer = setInterval(() => { tick(); }, TICK_MS);
  tick();
}

function stopLoop() {
  if (_timer !== null) { clearInterval(_timer); _timer = null; }
}

function clearPublished() {
  if (!_userId) return;
  clearLocationData(_userId, _getOptedInGids()).catch(() => {});
}

function reconcile() {
  if (_available && anyOptIn()) startLoop();
  else stopLoop();
}

export function capabilityState(): 'supported' | 'unsupported' {
  if (isTelegramContext()) {
    const tg = (window as unknown as { Telegram?: { WebApp?: { LocationManager?: unknown } } }).Telegram;
    return tg?.WebApp?.LocationManager ? 'supported' : 'unsupported';
  }
  return navigator.geolocation ? 'supported' : 'unsupported';
}

export function initLocationShare(userId: string, getOptedInGids: () => string[]) {
  _userId = userId;
  _getOptedInGids = getOptedInGids;
  _unsubOwn = subscribeOwnStatus((presence: PresenceNode | null) => {
    const wasAvailable = _available;
    _available = isAvailable(presence?.status ?? null, presence?.availableUntil ?? null);
    if (wasAvailable && !_available) { stopLoop(); clearPublished(); }
    else reconcile();
  });
  _visListener = () => {
    if (document.visibilityState === 'visible' && _timer !== null) tick();
  };
  document.addEventListener('visibilitychange', _visListener);
}

// The glyph handler. Flips the context's pref; first enable proves permission
// with an immediate position read before committing the pref.
export async function toggleContext(context: string): Promise<'on' | 'off' | 'denied' | 'unsupported'> {
  if (getLocationOptIn(context)) {
    setLocationOptIn(context, false);
    if (!anyOptIn()) { stopLoop(); clearPublished(); }
    else if (context !== 'direct' && _userId) {
      // Only this group's cell needs deleting; other contexts keep publishing.
      clearLocationData(_userId, [context]).catch(() => {});
      // clearLocationData also nulls locations/{uid}; re-publish next tick if
      // direct is still on — acceptable within one tick, but avoid the gap:
      if (getLocationOptIn('direct')) tick();
    }
    return 'off';
  }
  if (capabilityState() === 'unsupported') return 'unsupported';
  try {
    await getPositionOnce(); // permission prompt fires here, on explicit intent
  } catch (err) {
    if ((err as { code?: number })?.code === 1) return 'denied';
    return 'unsupported';
  }
  setLocationOptIn(context, true);
  reconcile();
  if (_timer !== null) tick(); // immediate first publish for this context
  return 'on';
}

export async function _tickNow() { await tick(); }

export function _resetLocationShare() {
  stopLoop();
  if (_unsubOwn) { _unsubOwn(); _unsubOwn = null; }
  if (_visListener) { document.removeEventListener('visibilitychange', _visListener); _visListener = null; }
  _userId = null;
  _available = false;
  _getOptedInGids = () => [];
}
```

- [ ] **Step 4: Run — expect PASS** (iterate; the visibility test may need the interval-vs-immediate-tick ordering adjusted — keep the contract, adjust internals)

Run: `npx jest tests/locationShare.test.js && npm run typecheck`

- [ ] **Step 5: Simplify the group-toggle-off path** if the test survives it: the `clearLocationData(uid, [context])` + conditional re-publish is the subtle spot — verify with a dedicated test if any doubt (opt in direct + G1, toggle G1 off, assert raw point returns within one tick).

- [ ] **Step 6: Commit**

```bash
git add js/locationShare.ts tests/locationShare.test.js
git commit -m "feat(location): capture loop — per-context opt-in, availability-tied, 60s cadence"
```

---

### Task 7: Direct header glyph (template + CSS + `js/me.ts` wiring + boot init)

**Files:**
- Modify: `index.template.html` (line ~269, next to `<span id="time-remaining">`)
- Modify: `css/app.css` (append)
- Modify: `js/me.ts` (wire glyph in `initHeader`)
- Modify: `js/app.js` or the boot module that calls `initHeader` — find with `grep -n "initLocationShare\|initHeader(" js/app.* js/*.ts | head` and add `initLocationShare` beside the other init calls (it needs `userId` and the opted-in-gids getter)
- Modify: `tests/me.test.js`

**Interfaces:**
- Consumes: `toggleContext`, `capabilityState` from `./locationShare.js`; `getLocationOptIn` from `./prefs.js`.
- Produces: `#location-glyph` button element; CSS classes `location-glyph`, `on`, `denied`. Task 8 reuses the same classes for `#group-location-glyph`.

- [ ] **Step 1: Template.** In `index.template.html`, immediately after the `<span id="time-remaining" style="display:none"></span>` line (line ~269), add:

```html
<button id="location-glyph" class="location-glyph" aria-label="Share location" aria-pressed="false" style="display:none">
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 21s-7-5.1-7-11a7 7 0 0 1 14 0c0 5.9-7 11-7 11z"/>
    <circle cx="12" cy="10" r="2.5"/>
  </svg>
</button>
```

`display:none` matches `#time-remaining`'s hidden-by-default: the glyph shows only while available (it toggles a publishing context, and publishing requires availability — a dead control while unavailable would lie).

- [ ] **Step 2: CSS.** Append to `css/app.css`:

```css
/* Location-sharing glyph — the ONLY control for the feature (spec 2026-07-18
   §6.1). Sits inline after the time-remaining text in both headers. Dimmed =
   off, colored = opted in, strikethrough-ish opacity pulse never used —
   denied renders dimmer still with a tooltip via title attr set in JS. */
.location-glyph {
  background: none;
  border: none;
  padding: 2px;
  margin-left: 6px;
  cursor: pointer;
  color: var(--text-muted, #6b7280);
  opacity: 0.45;
  vertical-align: middle;
  line-height: 0;
}
.location-glyph.on {
  opacity: 1;
  color: var(--green, #22c55e);
}
.location-glyph.denied {
  opacity: 0.25;
  cursor: default;
}
```

(If `--text-muted`/`--green` variable names differ in this codebase, `grep -n "var(--" css/app.css | head` and use the established tokens.)

- [ ] **Step 3: Failing tests.** Append to `tests/me.test.js` (mirror its existing harness for DOM scaffolding + `./db.js`/module mocks; add a `jest.mock('../js/locationShare.js', …)`):

```js
describe('location glyph (Direct header)', () => {
  test('hidden while unavailable, shown while available, reflects opt-in', () => {
    // after applyOwnStatus('available', future): glyph display !== 'none'
    // after applyOwnStatus('unavailable', null): glyph display === 'none'
    // with getLocationOptIn('direct') true: glyph has class 'on'
  });

  test('click calls toggleContext("direct") and repaints from the result', async () => {
    // toggleContext resolves 'on'  → classList contains 'on', aria-pressed true
    // toggleContext resolves 'denied' → classList contains 'denied', title set
  });
});
```

Write these as real assertions against the harness conventions in the file (the skeleton above states the contract; the file's top shows how `initHeader` is driven — reuse it exactly).

- [ ] **Step 4: Run — expect FAIL.** `npx jest tests/me.test.js`

- [ ] **Step 5: Wire in `js/me.ts`.** Add imports:

```ts
import { toggleContext, capabilityState } from './locationShare.js';
import { getLocationOptIn } from './prefs.js';
```

Add a paint helper + click wiring in `initHeader` (after the `mycodeChip` listener):

```ts
  const locGlyph = document.getElementById('location-glyph');
  if (locGlyph) {
    paintLocationGlyph(locGlyph, getLocationOptIn('direct') ? 'on' : 'off');
    if (capabilityState() === 'unsupported') paintLocationGlyph(locGlyph, 'denied');
    locGlyph.addEventListener('click', async () => {
      const state = await toggleContext('direct');
      paintLocationGlyph(locGlyph, state === 'on' ? 'on' : state === 'off' ? 'off' : 'denied');
    });
    // Cross-device echo: another device flipping the pref repaints this glyph.
    document.addEventListener('location-prefs-synced', () => {
      paintLocationGlyph(locGlyph, getLocationOptIn('direct') ? 'on' : 'off');
    });
  }
```

Module-level helper (exported for reuse by groupContext in Task 8):

```ts
// Paint a location glyph's tri-state. Shared by the Direct header (me.js) and
// the group band (groupContext.js) — same classes, different element.
export function paintLocationGlyph(el: HTMLElement, state: 'on' | 'off' | 'denied') {
  el.classList.toggle('on', state === 'on');
  el.classList.toggle('denied', state === 'denied');
  el.setAttribute('aria-pressed', state === 'on' ? 'true' : 'false');
  if (state === 'denied') el.title = 'Location unavailable — check permissions';
  else el.removeAttribute('title');
}
```

Show/hide with availability — in `setAvailable` add `const lg = document.getElementById('location-glyph'); if (lg) lg.style.display = '';` next to the `timeRemaining.style.display = ''` line; in `setUnavailable` add `if (lg) lg.style.display = 'none'` next to `timeRemaining.style.display = 'none'` (declare `lg` beside the other element lookups).

- [ ] **Step 6: Boot init.** In the boot module that calls `initHeader(userId)`, add (same spot, after prefs init):

```ts
initLocationShare(userId, getOptedInLocationGids);
```

where the getter comes from prefs alone — add to `js/prefs.ts` (and test in Task 4's describe block: opted-in G1 + opted-out G2 → `['G1']`):

```ts
// All group ids whose location opt-in is on. NO membership filter on purpose:
// locationShare uses this both to publish (a stale gid fails as one harmless
// denied write) and to CLEAR — including sweeping the orphaned cell of a
// group the user was kicked from (rules delete-only carve-out).
export function getOptedInLocationGids(): string[] {
  const groups = readLocationCache().groups || {};
  return Object.keys(groups).filter((gid) => groups[gid]);
}
```

- [ ] **Step 7: Run — expect PASS.** `npx jest tests/me.test.js && npm run typecheck`

- [ ] **Step 8: Commit**

```bash
git add index.template.html css/app.css js/me.ts tests/me.test.js js/app.*
git commit -m "feat(location): Direct header glyph — the precise-tier toggle"
```

---

### Task 8: Group band glyph (`js/groupContext.ts`)

**Files:**
- Modify: `index.template.html` (line ~373, next to `<span id="group-time-remaining">`)
- Modify: `js/groupContext.ts`
- Modify: `tests/groupContext.test.js`

**Interfaces:**
- Consumes: `toggleContext`, `capabilityState` from `./locationShare.js`; `getLocationOptIn` from `./prefs.js`; `paintLocationGlyph` from `./me.js` (Task 7).
- Produces: `#group-location-glyph` element toggling the CURRENT group's context (gid from `getCurrentGroupId()`).

- [ ] **Step 1: Template.** After `<span id="group-time-remaining" style="display:none"></span>` add the same button markup as Task 7 Step 1 with `id="group-location-glyph"`.

- [ ] **Step 2: Failing tests** in `tests/groupContext.test.js` (same contract as Task 7's, but: click calls `toggleContext(currentGid)`; entering a different group repaints from that group's pref). Follow the file's harness (it drives group entry; bind exports at describe-eval time if it uses the mid-file-require pattern like following.test.js).

- [ ] **Step 3: Run — expect FAIL.** `npx jest tests/groupContext.test.js`

- [ ] **Step 4: Wire.** In `js/groupContext.ts`: import the three functions; in the group-entry/paint path where the own-status band is painted (the `#group-time-remaining` handling around `js/groupContext.ts:396-442`), add:

```ts
  const glyph = document.getElementById('group-location-glyph');
  if (glyph) {
    const gid = getCurrentGroupId();
    paintLocationGlyph(glyph, capabilityState() === 'unsupported' ? 'denied'
      : getLocationOptIn(gid) ? 'on' : 'off');
  }
```

One-time listener wiring (in the group-context init, NOT per entry — guard with a module flag):

```ts
let _glyphWired = false;
function wireGroupLocationGlyph() {
  if (_glyphWired) return;
  _glyphWired = true;
  const glyph = document.getElementById('group-location-glyph');
  if (!glyph) return;
  glyph.addEventListener('click', async () => {
    const gid = getCurrentGroupId();
    if (!gid) return;
    const state = await toggleContext(gid);
    paintLocationGlyph(glyph, state === 'on' ? 'on' : state === 'off' ? 'off' : 'denied');
  });
  document.addEventListener('location-prefs-synced', () => {
    const gid = getCurrentGroupId();
    if (gid) paintLocationGlyph(glyph, getLocationOptIn(gid) ? 'on' : 'off');
  });
}
```

Show/hide with the band's own availability exactly as `#group-time-remaining` does — add the glyph beside every `group-time-remaining` `style.display` write (`grep -n "group-time-remaining" js/groupContext.ts`).

- [ ] **Step 5: Run — expect PASS.** `npx jest tests/groupContext.test.js && npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add index.template.html js/groupContext.ts tests/groupContext.test.js
git commit -m "feat(location): group band glyph — per-group coarse-tier toggle"
```

---

### Task 9: Distance on Direct mutual cards (`js/following.ts`)

**Files:**
- Modify: `js/following.ts`
- Modify: `tests/following.test.js`

**Interfaces:**
- Consumes: `subscribeDistance` from `./locationHub.js`; `formatDistancePrecise` from `../shared/geo.js`; `getLocationOptIn` from `./prefs.js`; `lastUserData` map + `updateFolloweeRow` internals (`js/following.ts:1019-1126`).
- Produces: distance suffix inside the available status span: `Available for 2h · 120 m`.

- [ ] **Step 1: Failing tests.** In `tests/following.test.js` (bind exports at describe-eval time — the mid-file-require landmine), add a describe block pinning:

```js
// Contract:
// 1. A MUTUAL row (li.dataset.mutual === '1'), available, with a known
//    distance and direct opt-in ON renders status text matching
//    /Available for .* · 120 m$/.
// 2. Distance ticks re-render: pushing a new meters value through the
//    subscribeDistance callback updates the suffix without a presence tick.
// 3. Direct opt-in OFF → no subscribeDistance calls at all, no suffix.
// 4. Non-mutual rows (Following/Followers sections) never subscribe.
// 5. distance null → suffix absent (plain "Available for …").
```

Mock `../js/locationHub.js` with a capture-the-callback `subscribeDistance` (same style as the hub test's mock); mock `../js/prefs.js` `getLocationOptIn` per-test with `mockReturnValue` (remember `jest.clearAllMocks()` doesn't clear it).

- [ ] **Step 2: Run — expect FAIL.** `npx jest tests/following.test.js`

- [ ] **Step 3: Implement.** In `js/following.ts`:

Imports: `import { subscribeDistance } from './locationHub.js';`, `import { formatDistancePrecise } from '../shared/geo.js';`, and add `getLocationOptIn` to the existing `./prefs.js` import.

Module state near the other row-tracking maps:

```ts
// Distance ticks land here; updateFolloweeRow reads it when painting. One
// subscription per rendered MUTUAL row, opened only while our own Direct
// publishing pref is on (rules would deny the reads regardless — we just
// never attempt them).
const _distances = new Map<string, number | null>();
const _distanceUnsubs = new Map<string, () => void>();
```

In `createFolloweeRow` (after the row is registered, where other per-row watches start — find the `subscribePresence` call for the row) add:

```ts
  if (isMutual && getLocationOptIn('direct')) {
    _distanceUnsubs.set(entry.userId, subscribeDistance(myUserId, entry.userId, (meters) => {
      _distances.set(entry.userId, meters);
      const data = lastUserData.get(entry.userId);
      if (data) updateFolloweeRow(entry, data, myUserId);
    }));
  }
```

(Use the same `isMutual` signal the row already stamps as `li.dataset.mutual` — read the variable it's derived from at that point in `createFolloweeRow`, ~line 702-876.)

In the row-teardown path (wherever the presence unsub for a removed row is called — `grep -n "unsub" js/following.ts | head -20`) add the paired:

```ts
  _distanceUnsubs.get(uid)?.();
  _distanceUnsubs.delete(uid);
  _distances.delete(uid);
```

In `updateFolloweeRow`, extend the available branch (`js/following.ts:1053-1057`):

```ts
  } else if (isAvail) {
    const meters = _distances.get(entry.userId);
    const dist = typeof meters === 'number' ? ` · ${formatDistancePrecise(meters)}` : '';
    const text = availableForText(userData.availableUntil) + dist;
    statusText = PALETTES_ENABLED
      ? `<span class="status-available" style="color:${safeCssColor(color)}">${text}</span>`
      : `<span class="status-available">${text}</span>`;
  }
```

Also react to the opt-in changing mid-session: in the `location-prefs-synced` / post-toggle path, the simplest correct behavior is a full list re-render (the same entry point a followers-list change uses — find `renderList`'s trigger). Subscriptions then open/close on the next `createFolloweeRow`/teardown cycle. Wire: `document.addEventListener('location-prefs-synced', () => { /* call the existing re-render entry point */ });` and ALSO call it after the glyph toggle resolves (Task 7's handler already repaints the glyph; add a custom event dispatch `document.dispatchEvent(new CustomEvent('location-prefs-synced'))` inside `setLocationOptIn` in prefs.ts is WRONG — it would double-fire on server echo. Instead dispatch a distinct `location-optin-changed` event from `toggleContext` in locationShare.ts after the pref flip, and listen for both events here).

- [ ] **Step 4: Add the `location-optin-changed` dispatch to `js/locationShare.ts`** (both branches of `toggleContext`, after `setLocationOptIn`):

```ts
  document.dispatchEvent(new CustomEvent('location-optin-changed', { detail: { context } }));
```

Update `tests/locationShare.test.js` with one assertion that the event fires on toggle.

- [ ] **Step 5: Run — expect PASS.** `npx jest tests/following.test.js tests/locationShare.test.js && npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add js/following.ts js/locationShare.ts tests/following.test.js tests/locationShare.test.js
git commit -m "feat(location): precise distance on Direct mutual cards"
```

---

### Task 10: Coarse distance on the group roster (`js/groupContext.ts`)

**Files:**
- Modify: `js/groupContext.ts`
- Modify: `tests/groupContext.test.js`

**Interfaces:**
- Consumes: `subscribeCellDistance`, `subscribeDistance` from `./locationHub.js`; `formatDistanceCoarse`, `formatDistancePrecise` from `../shared/geo.js`; `getLocationOptIn` from `./prefs.js`.
- Produces: roster status suffix — coarse by default; precise when the precise gate ALSO passes (both parties Direct-publishing mutuals — spec §6.2 "precise wins").

- [ ] **Step 1: Failing tests** in `tests/groupContext.test.js`:

```js
// Contract:
// 1. Own group opt-in ON + co-member cell distance known + member available →
//    status text ends with " · <1 km away" (or "~N km").
// 2. Own group opt-in OFF → no cell subscriptions, no suffix.
// 3. Member ALSO a Direct-publishing mutual with precise distance known →
//    precise text wins ("· 120 m", not "· <1 km away").
// 4. Unavailable member → status stays EMPTY (the roster's existing rule) —
//    no distance-only text appears.
```

- [ ] **Step 2: Run — expect FAIL.** `npx jest tests/groupContext.test.js`

- [ ] **Step 3: Implement.** Mirror Task 9's shape: module maps `_cellDistances`, `_preciseDistances`, `_cellUnsubs` keyed by uid; open subscriptions where roster rows are created (`createRosterRow`) — cell subscription when `getLocationOptIn(currentGid)`, plus a precise subscription when the member is a mutual (`getCurrentMutuals()` exists — see `js/groupContext.ts:143`) AND `getLocationOptIn('direct')`. Tear down in the roster `onRemove` path (`js/groupContext.ts:300-302`) and on group exit (find the context-teardown function). In `paintRosterRow`'s available branch (`:346-350`):

```ts
      const precise = _preciseDistances.get(uid);
      const cell = _cellDistances.get(uid);
      const dist = typeof precise === 'number' ? ` · ${formatDistancePrecise(precise)}`
        : typeof cell === 'number' ? ` · ${formatDistanceCoarse(cell)}` : '';
      const text = availableForText(availableUntil) + dist;
```

Distance ticks repaint via `paintRosterRow(uid)` directly (it takes a uid and finds the row — `js/groupContext.ts:313`).

Re-render on `location-optin-changed` / `location-prefs-synced`: call `syncRosterOrder()` (`js/groupContext.ts:308-311`) — it re-runs `renderRoster`, whose `update` path repaints every row; subscriptions reconcile in create/remove. If subscriptions need explicit reconciliation for existing rows (rows aren't recreated on repaint), add a `reconcileDistanceSubs()` helper called from the event listener that opens/closes subs against the current roster + prefs.

- [ ] **Step 4: Run — expect PASS.** `npx jest tests/groupContext.test.js && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add js/groupContext.ts tests/groupContext.test.js
git commit -m "feat(location): coarse distance on group roster, precise-wins for mutuals"
```

---

### Task 11: Bot `/who` distances (`functions/telegram.js`)

**Files:**
- Modify: `functions/telegram.js` (`handleSocialCommand` `:531-550`, `handleWhoGroup` `:445-464`)
- Modify: `functions/test/telegram.test.js`

**Interfaces:**
- Consumes: `haversineMeters`, `formatDistancePrecise`, `formatDistanceCoarse` from `./_shared/geo.js`; `deps.getVal` (Admin SDK — bypasses rules, so every gate is re-implemented explicitly here).
- Produces: `/who` lines gain ` · 120 m` (requester publishing ∧ target publishing ∧ mutual); `/who <group>` lines gain ` · <1 km away` (requester cell ∧ target cell in that gid).

- [ ] **Step 1: Failing tests.** In `functions/test/telegram.test.js`, find the existing `/who` tests (`grep -n "who" functions/test/telegram.test.js | head`) and add cases using the same fake-deps store:

```js
// /who (Direct):
// - requester has locations/req + target has locations/t + mutual follower
//   entries both ways → line contains "· 65 m" (seed points ~65 m apart:
//   [52.5200,13.4050] vs [52.5205,13.4055]).
// - requester NOT publishing → no "·" distance fragment in any line.
// - target publishing but NOT mutual (missing users/req/followers/t) → no fragment.
// /who <group>:
// - both cells in gid → "· <1 km away" for same-cell points.
// - requester cell missing → no fragment.
```

- [ ] **Step 2: Run — expect FAIL.** `cd functions && npm test -- telegram` (then `cd ..` — root typechecks break from a lingering cd).

- [ ] **Step 3: Implement.** Import at the top of `functions/telegram.js` beside the presence-core import:

```js
const { haversineMeters, formatDistancePrecise, formatDistanceCoarse } = require('./_shared/geo.js');
```

(Match the file's actual import style — if it uses `import … from`, use that form; check line 7.)

In `handleSocialCommand`'s `/who` branch, before the `following.map`, read once:

```js
    const myLoc = await deps.getVal(`locations/${uid}`);
```

Inside the map, after the `primaryAvailable` gate:

```js
      let dist = '';
      if (myLoc) {
        // Explicit gates — Admin SDK bypasses rules: mutual (they follow me;
        // my following list already proves I follow them) + both publishing.
        const [theirLoc, followsMe] = await Promise.all([
          deps.getVal(`locations/${entry.userId}`),
          deps.getVal(`users/${uid}/followers/${entry.userId}`),
        ]);
        if (theirLoc && followsMe) {
          dist = ` · ${formatDistancePrecise(haversineMeters(myLoc.lat, myLoc.lng, theirLoc.lat, theirLoc.lng))}`;
        }
      }
      return `${statusCircle(presence.statusColor)} ${entry.label || entry.code}${tail}${dist}`;
```

In `handleWhoGroup`, before the `coMembers` map:

```js
  const myCell = await deps.getVal(`locationCells/${match.gid}/${uid}`);
```

Inside its map, after the `effectiveAvailable` gate:

```js
    let dist = '';
    if (myCell) {
      const theirCell = await deps.getVal(`locationCells/${match.gid}/${mid}`);
      if (theirCell) {
        dist = ` · ${formatDistanceCoarse(haversineMeters(myCell.lat, myCell.lng, theirCell.lat, theirCell.lng))}`;
      }
    }
    return `${statusCircle(color)} ${m?.displayName || 'Someone'}${tail}${dist}`;
```

- [ ] **Step 4: Run — expect PASS.** `cd functions && npm test` then `cd ..`.

- [ ] **Step 5: Commit**

```bash
git add functions/telegram.js functions/test/telegram.test.js
git commit -m "feat(telegram): /who distance text — explicit reciprocity + mutuality gates"
```

---

### Task 12: `Permissions-Policy` header

**Files:**
- Modify: `firebase.json` (headers array, `firebase.json:22-31`)
- Possibly modify: `tests/deploy-workflows.test.js`, `tests/build-env.test.js` (header pins)

- [ ] **Step 1: Add the header** to the existing `"headers"` array for `"source": "**"` (after Referrer-Policy):

```json
{ "key": "Permissions-Policy", "value": "geolocation=(self)" }
```

No CSP change: capture uses device APIs only (no external geo endpoints), and the Telegram Mini App path uses `LocationManager`, not iframe `navigator.geolocation`, so no embedder `allow` attribute is needed (spec §9).

- [ ] **Step 2: Run the guard tests.** `npx jest tests/deploy-workflows.test.js tests/build-env.test.js`. If a header-pin assertion fails, extend that test's expected headers with the new entry (the pin exists to force exactly this conscious update).

- [ ] **Step 3: Commit**

```bash
git add firebase.json tests/deploy-workflows.test.js tests/build-env.test.js
git commit -m "feat(headers): Permissions-Policy geolocation=(self)"
```

---

### Task 13: Full verification sweep

- [ ] **Step 1: Web suite.** Run from repo root: `npx jest`
Expected: all suites green (was 81 suites / 1812 tests before this feature; now more).

- [ ] **Step 2: Functions suite.** `cd functions && npm test` then `cd ..`
Expected: all green (was 9 suites / 360 tests).

- [ ] **Step 3: Rules suite** (emulator): the Task 2 command, full suite.
Expected: all green including the pre-existing rules tests.

- [ ] **Step 4: Typechecks.** From repo root: `npm run typecheck && npm run typecheck:scripts`
Expected: clean, zero suppressions added anywhere (`git diff dev --stat` then `grep -rn "@ts-ignore\|@ts-expect-error" js/ shared/` must show nothing new).

- [ ] **Step 5: Build.** `node scripts/prod.js`
Expected: builds clean (template change flows through).

- [ ] **Step 6: Commit anything outstanding; do NOT push to dev/main.** Final state: all work committed on `claude/knockknock-feature-dev-9a3ysy`, pushed to origin with `git push -u origin claude/knockknock-feature-dev-9a3ysy`.

- [ ] **Step 7: Device-smoke checklist for the operator** (visual "done" is the operator's call): glyph on/off/denied states in both headers; permission prompt on first tap only; distance appears on a mutual card within ~1 min of both sides opting in while available; coarse text in a shared group; distances vanish when either side goes unavailable; Telegram Mini App glyph + `/who` lines.

---

## Self-review notes (resolved inline)

- Spec §5 teardown "logout/user-switch": covered by `_resetLocationShare` — the boot module that handles user-switch teardown must call it; Task 7 Step 6's boot wiring is the place (add `_resetLocationShare()` beside the other teardowns if a user-switch path exists — `grep -rn "user-switch\|signOut" js/app.*`).
- Spec §8 "stale rows cleaned on next launch": `initLocationShare`'s first own-status tick delivers `unavailable` → `clearPublished()` fires, which is exactly the opportunistic cleanup. When the first tick is `available` with opt-ins, publishing resumes — also correct. No extra code needed; noted so nobody adds a redundant sweep.
- Spec §3.4 sharing-but-unavailable sees nothing: enforced by rules (own `locations/{uid}` absent) — display code needs no extra gate beyond not-rendering on unavailable cards, which Tasks 9/10 pin.
