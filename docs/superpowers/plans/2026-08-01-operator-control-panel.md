# Operator Control Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local-only, Admin-SDK operator panel that lists every account with its activity, contacts, group memberships and provenance, and can merge, purge, and Telegram-link accounts with a preview of exactly what each write destroys.

**Architecture:** A Node CLI under `functions/ops/` serves a plain HTML page to `127.0.0.1`. All RTDB access flows through the same injected-deps surface the shipped Cloud Functions use (`{ getVal, set, update, transaction, now }`), so every module is testable against `functions/test/store-deps.js` with no `firebase-admin` and no emulator. Display modules (`provenance`, `project`, `integrity`) are pure functions over a snapshot object. Mutation modules (`merge`, `purge`) re-read through `deps` at preview time and return a write-set that a separate execute step applies via `rootUpdate` in one atomic update.

**Tech Stack:** Node 18+ ESM, `firebase-admin`, Jest (`node --experimental-vm-modules`), JSDoc types checked by `tsc --noEmit` (`checkJs` + `strict`), plain HTML/CSS/JS for the page.

**Spec:** `docs/superpowers/specs/2026-08-01-operator-control-panel-design.md`

## Global Constraints

- **Zero TS suppressions.** No `@ts-ignore`, `@ts-expect-error`, or `as any`. `npm run typecheck` and `npm run typecheck:scripts` must stay green. `tsconfig.json` includes `functions/**/*.js` under `checkJs: true` + `strict: true`, so every new `.js` file here is strict-checked.
- **`types: []` means no ambient Node globals.** `process` is not typed. Use the locally-typed alias idiom already used by every script in `functions/` (see `functions/migrate-presence.js:19-23`). Explicit `import` of `node:http` / `node:fs` **does** typecheck — verified during design.
- **All files are `.js` with JSDoc.** Nothing compiles this; `node ops/server.js` runs the source directly. Structural types live in `functions/ops/types.d.ts` (real TS syntax, no build) and are referenced as `@type {import('./types.js').Snapshot}`.
- **Jest flag is `--testPathPatterns` (PLURAL).** The singular form is rejected by this repo's Jest.
- **`cd functions` lingers.** Compound shell commands that `cd functions` leave the session there; always `cd /home/user/on` before running root-level commands.
- **Committer identity:** `git config user.email noreply@anthropic.com && git config user.name Claude`. No model version in commits or artifacts.
- **Web tests:** `npx jest --maxWorkers=2` from repo root (default workers OOM the container). **Functions tests:** `cd functions && npm test`.
- **Per-task commits are sanctioned** by this plan; do not push or merge without the operator's say-so.
- **Never load `canvases/{pair}/strokes`.** It is the only unbounded node in the database.
- **The panel binds `127.0.0.1` only**, never `0.0.0.0`.

## File Structure

| File | Responsibility |
|---|---|
| `functions/ops/types.d.ts` | Structural types shared by every ops module |
| `functions/ops/provenance.js` | Classify a uid into one of four account categories |
| `functions/ops/snapshot.js` | Read the whole picture through injected deps; no other module touches I/O |
| `functions/ops/deps.js` | Admin-SDK factory: argv → `{ getVal, set, update, transaction, now }` + canvas/auth listers |
| `functions/ops/project.js` | Snapshot → table rows and per-uid detail |
| `functions/ops/integrity.js` | Snapshot → findings |
| `functions/ops/merge.js` | Build a merge write-set + conflict report |
| `functions/ops/purge.js` | Build a purge write-set + loss report; link-impact report |
| `functions/ops/audit.js` | Pre-image dump + JSONL audit log |
| `functions/ops/server.js` | CLI entry: argv, prod gate, HTTP routes |
| `functions/ops/panel.html` | The page — plain HTML/CSS/JS |
| `functions/ops/README.md` | Runbook: how to run it, what each action does |
| `functions/telegram-auth.js` | **Modified:** extract `buildExpungeWrites`, export `crossRefRenderers` |
| `firebase.json` | **Modified:** `functions.ignore`, `hosting.ignore` |

---

### Task 1: Deploy-config prerequisites

Closes the confirmed exposure (spec §11) and keeps `ops/` out of the deploy archive. Independent of every other task — do it first so nothing built later can leak.

**Files:**
- Modify: `firebase.json`
- Modify: `.gitignore`
- Test: `tests/firebaseConfig.test.js` (create)

**Interfaces:**
- Consumes: nothing
- Produces: nothing (config only)

- [ ] **Step 1: Write the failing test**

Create `tests/firebaseConfig.test.js`:

```javascript
// Pins the two ignore lists that keep server-side source off the public site
// and the ops panel out of the functions deploy archive. The hosting gap was
// live and confirmed (curl -I .../functions/telegram-auth.js -> 200) before
// this test existed.
const config = require('../firebase.json');

describe('hosting.ignore', () => {
  test('excludes functions/** so Cloud Functions source is not served publicly', () => {
    expect(config.hosting.ignore).toContain('functions/**');
  });

  test('still excludes the pre-existing entries', () => {
    for (const entry of ['**/node_modules/**', 'tests/**', 'scripts/**', 'docs/**', 'css/**']) {
      expect(config.hosting.ignore).toContain(entry);
    }
  });
});

describe('functions.ignore', () => {
  test('excludes the ops panel from the deploy archive', () => {
    expect(config.functions.ignore).toContain('ops/**');
  });

  test('re-lists the CLI defaults, which specifying `ignore` replaces', () => {
    for (const entry of ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log']) {
      expect(config.functions.ignore).toContain(entry);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /home/user/on && npx jest --maxWorkers=2 --testPathPatterns firebaseConfig`
Expected: FAIL — `config.functions.ignore` is `undefined` and `hosting.ignore` lacks `functions/**`.

- [ ] **Step 3: Make the change**

In `firebase.json`, add `functions/**` to the existing `hosting.ignore` array, and add an `ignore` array to the `functions` object:

```json
"functions": {
  "source": "functions",
  "predeploy": [
    "npm --prefix \"$RESOURCE_DIR\" ci"
  ],
  "ignore": [
    "node_modules",
    ".git",
    "firebase-debug.log",
    "firebase-debug.*.log",
    "ops/**"
  ]
}
```

Specifying `ignore` **replaces** the CLI defaults, which is why the four defaults are re-listed. Leave `functions.source` and `predeploy` untouched.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/user/on && npx jest --maxWorkers=2 --testPathPatterns firebaseConfig`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the audit directory to `.gitignore`**

Append to `.gitignore`:

```
functions/.ops-audit/
```

- [ ] **Step 6: Commit**

```bash
cd /home/user/on
git add firebase.json .gitignore tests/firebaseConfig.test.js
git commit -m "fix(hosting): stop serving Cloud Functions source; gitignore ops audit

hosting.ignore omitted functions/**, and hosting is public \".\", so the
deployed site served functions/*.js as static files (confirmed 200 on
/functions/telegram-auth.js). Adds the exclusion and pins both ignore
lists with a test. Also adds functions.ignore so the ops panel stays out
of the deploy archive -- specifying ignore replaces the CLI defaults, so
they are re-listed."
```

---

### Task 2: Shared types and provenance classification

**Files:**
- Create: `functions/ops/types.d.ts`
- Create: `functions/ops/provenance.js`
- Test: `functions/test/ops-provenance.test.js`

**Interfaces:**
- Consumes: `deriveTelegramUid(tgId, secret)` from `../telegram-auth.js`
- Produces:
  - `type Provenance = 'telegram-derived' | 'phrase' | 'phrase-linked' | 'graduated' | 'unknown'`
  - `classifyProvenance(uid, snapshot, secret) => { kind: Provenance, exact: boolean, tgId: string | null }`

- [ ] **Step 1: Write `types.d.ts`**

```typescript
// Structural types for the ops panel. Real TS syntax in a .d.ts (no build
// step) referenced from the .js modules as
// `@type {import('./types.js').Snapshot}` — the types/app.d.ts pattern.

export type Provenance =
  | 'telegram-derived'
  | 'phrase'
  | 'phrase-linked'
  | 'graduated'
  | 'unknown';

export interface ProvenanceResult {
  kind: Provenance;
  /** false when the answer rests on the linkedAt heuristic or a missing secret */
  exact: boolean;
  tgId: string | null;
}

export interface AuthUserRecord {
  uid: string;
  email: string | null;
  createdAt: number;
}

export interface Snapshot {
  users: Record<string, any>;
  userPrefs: Record<string, any>;
  groups: Record<string, any>;
  telegramUsers: Record<string, { uid: string; chatId?: string; createdAt?: number; linkedAt?: number }>;
  telegramByUid: Record<string, { tgId: string; chatId?: string }>;
  pushTokens: Record<string, Record<string, { createdAt: number; lastSeen: number; ua?: string }>>;
  locations: Record<string, { lat: number; lng: number; updatedAt: number }>;
  locationCells: Record<string, Record<string, { lat: number; lng: number; updatedAt: number }>>;
  knocks: Record<string, Record<string, any>>;
  calls: Record<string, any>;
  followRequests: Record<string, Record<string, any>>;
  followGrants: Record<string, Record<string, any>>;
  pendingInvites: Record<string, Record<string, any>>;
  pendingInvitesByGroup: Record<string, Record<string, true>>;
  revocations: Record<string, Record<string, true>>;
  codeIndex: Record<string, string>;
  inviteIndex: Record<string, { ownerPath: string; ownerUid: string }>;
  groupIdIndex: Record<string, unknown>;
  canvasKeys: string[];
  authUsers: AuthUserRecord[];
  takenAt: number;
}

export interface GroupMembership {
  gid: string;
  name: string | null;
  displayName: string | null;
  role: string | null;
  isOwner: boolean;
  hasStatusOverride: boolean;
}

export interface Row {
  uid: string;
  code: string | null;
  provenance: ProvenanceResult;
  createdAt: number | null;
  lastSeen: number | null;
  status: string | null;
  availableUntil: number | null;
  contacts: number;
  groupCount: number;
  canvasCount: number;
  pushTokenCount: number;
  notifyChannel: string | null;
  locationOptIn: boolean;
}

export interface Detail extends Row {
  followers: string[];
  following: string[];
  mutuals: string[];
  groups: GroupMembership[];
  canvases: Array<{ peer: string; key: string }>;
  pushTokens: Array<{ token: string; lastSeen: number | null; ua: string | null }>;
  telegram: { tgId: string; chatId: string | null; mappingLinkedAt: number | null; prefsLinkedAt: number | null } | null;
  location: { hasPoint: boolean; fixAge: number | null; cells: Array<{ gid: string; fixAge: number | null }> };
}

export interface Finding {
  severity: 'error' | 'warn' | 'info';
  check: string;
  uid: string | null;
  path: string | null;
  detail: string;
}

export interface Conflict {
  kind: string;
  path: string;
  detail: string;
  resolution: string;
}

export interface WritePlan {
  writes: Record<string, unknown>;
  conflicts: Conflict[];
  losses: string[];
}
```

- [ ] **Step 2: Write the failing test**

Create `functions/test/ops-provenance.test.js`:

```javascript
import { classifyProvenance } from '../ops/provenance.js';
import { deriveTelegramUid } from '../telegram-auth.js';

const SECRET = 'test-uid-secret';
const TG_ID = '42';
const DERIVED = deriveTelegramUid(TG_ID, SECRET);
const PHRASE = 'a'.repeat(32);

/** Minimal snapshot carrying only the nodes provenance reads. */
function snap({ telegramUsers = {}, telegramByUid = {}, userPrefs = {} } = {}) {
  return { telegramUsers, telegramByUid, userPrefs };
}

describe('classifyProvenance', () => {
  test('a uid equal to the HMAC of its tgId is telegram-derived, exactly', () => {
    const s = snap({
      telegramUsers: { [TG_ID]: { uid: DERIVED, chatId: TG_ID, createdAt: 1000 } },
      telegramByUid: { [DERIVED]: { tgId: TG_ID, chatId: TG_ID } },
    });
    expect(classifyProvenance(DERIVED, s, SECRET)).toEqual({ kind: 'telegram-derived', exact: true, tgId: TG_ID });
  });

  test('no telegram mapping at all is a plain phrase account, exactly', () => {
    expect(classifyProvenance(PHRASE, snap(), SECRET)).toEqual({ kind: 'phrase', exact: true, tgId: null });
  });

  test('prefs linkedAt older than the mapping linkedAt reads as graduated (heuristic)', () => {
    const s = snap({
      telegramUsers: { [TG_ID]: { uid: PHRASE, chatId: TG_ID, linkedAt: 5000 } },
      telegramByUid: { [PHRASE]: { tgId: TG_ID, chatId: TG_ID } },
      // graduation copies the prefs subtree wholesale, so linkedAt is the
      // ORIGINAL bootstrap time — strictly older than the mapping's.
      userPrefs: { [PHRASE]: { telegram: { tgId: TG_ID, linkedAt: 1000 } } },
    });
    expect(classifyProvenance(PHRASE, s, SECRET)).toEqual({ kind: 'graduated', exact: false, tgId: TG_ID });
  });

  test('equal linkedAt values read as a linked phrase account (heuristic)', () => {
    const s = snap({
      telegramUsers: { [TG_ID]: { uid: PHRASE, chatId: TG_ID, linkedAt: 5000 } },
      telegramByUid: { [PHRASE]: { tgId: TG_ID, chatId: TG_ID } },
      userPrefs: { [PHRASE]: { telegram: { tgId: TG_ID, linkedAt: 5000 } } },
    });
    expect(classifyProvenance(PHRASE, s, SECRET)).toEqual({ kind: 'phrase-linked', exact: false, tgId: TG_ID });
  });

  test('a missing uid secret degrades to unknown rather than guessing', () => {
    const s = snap({
      telegramUsers: { [TG_ID]: { uid: DERIVED } },
      telegramByUid: { [DERIVED]: { tgId: TG_ID } },
    });
    expect(classifyProvenance(DERIVED, s, null)).toEqual({ kind: 'unknown', exact: false, tgId: TG_ID });
  });

  test('a linked uid with no prefs timestamp is reported inexactly, not as graduated', () => {
    const s = snap({
      telegramUsers: { [TG_ID]: { uid: PHRASE, linkedAt: 5000 } },
      telegramByUid: { [PHRASE]: { tgId: TG_ID } },
      userPrefs: { [PHRASE]: {} },
    });
    expect(classifyProvenance(PHRASE, s, SECRET)).toEqual({ kind: 'phrase-linked', exact: false, tgId: TG_ID });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd /home/user/on/functions && npm test -- --testPathPatterns ops-provenance`
Expected: FAIL — `Cannot find module '../ops/provenance.js'`.

- [ ] **Step 4: Write the implementation**

Create `functions/ops/provenance.js`:

```javascript
// functions/ops/provenance.js — classify an account's origin.
//
// Three of the four categories are exact. Graduated-vs-linked is a HEURISTIC:
// performLink writes userPrefs/{uid}/telegram/linkedAt and
// telegramUsers/{tgId}.linkedAt in the SAME update (equal), while graduation
// copies the prefs subtree wholesale so its linkedAt is the original bootstrap
// time (strictly older). A graduated account that later re-links reads as
// 'phrase-linked' — hence `exact: false` on both. See spec §6.1.
import { deriveTelegramUid } from '../telegram-auth.js';

/**
 * @param {string} uid
 * @param {{ telegramUsers?: any, telegramByUid?: any, userPrefs?: any }} snapshot
 * @param {string | null | undefined} secret
 * @returns {import('./types.js').ProvenanceResult}
 */
export function classifyProvenance(uid, snapshot, secret) {
  const link = snapshot.telegramByUid?.[uid];
  const tgId = link?.tgId != null ? String(link.tgId) : null;

  if (!tgId) return { kind: 'phrase', exact: true, tgId: null };

  // deriveTelegramUid throws on a missing secret (fail-closed by design), so a
  // panel run without TELEGRAM_UID_SECRET reports unknown instead of guessing.
  let derived = null;
  try {
    derived = deriveTelegramUid(tgId, secret);
  } catch {
    return { kind: 'unknown', exact: false, tgId };
  }

  if (uid === derived) return { kind: 'telegram-derived', exact: true, tgId };

  const mappingLinkedAt = snapshot.telegramUsers?.[tgId]?.linkedAt;
  const prefsLinkedAt = snapshot.userPrefs?.[uid]?.telegram?.linkedAt;
  const graduated = typeof mappingLinkedAt === 'number'
    && typeof prefsLinkedAt === 'number'
    && prefsLinkedAt < mappingLinkedAt;

  return { kind: graduated ? 'graduated' : 'phrase-linked', exact: false, tgId };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /home/user/on/functions && npm test -- --testPathPatterns ops-provenance`
Expected: PASS (6 tests).

- [ ] **Step 6: Typecheck**

Run: `cd /home/user/on && npm run typecheck`
Expected: clean, no output.

- [ ] **Step 7: Commit**

```bash
cd /home/user/on
git add functions/ops/types.d.ts functions/ops/provenance.js functions/test/ops-provenance.test.js
git commit -m "feat(ops): account provenance classification

Four categories from the telegram mapping nodes. Derived and unlinked
phrase accounts are exact; graduated-vs-linked rests on the linkedAt
relationship and is reported with exact:false. A missing uid secret
degrades to unknown rather than guessing."
```

---

### Task 3: Snapshot reader

**Files:**
- Create: `functions/ops/snapshot.js`
- Create: `functions/ops/deps.js`
- Test: `functions/test/ops-snapshot.test.js`

**Interfaces:**
- Consumes: the injected deps surface `{ getVal }` (same shape as `TelegramAuthDeps`)
- Produces:
  - `SNAPSHOT_PATHS: string[]` — every root read, in order
  - `readSnapshot(deps, io) => Promise<Snapshot>` where `io = { listCanvasKeys, listAuthUsers, now }`
  - `makeOpsDeps({ projectId, saJson, databaseURL }) => { deps, io }` (from `deps.js`, untested — thin admin wiring)

- [ ] **Step 1: Write the failing test**

Create `functions/test/ops-snapshot.test.js`:

```javascript
import { makeStoreDeps } from './store-deps.js';
import { readSnapshot, SNAPSHOT_PATHS } from '../ops/snapshot.js';

const NOW = 1_750_000_000_000;

function io({ canvasKeys = [], authUsers = [] } = {}) {
  return {
    listCanvasKeys: async () => canvasKeys,
    listAuthUsers: async () => authUsers,
    now: () => NOW,
  };
}

describe('readSnapshot', () => {
  test('reads every root path and stamps takenAt', async () => {
    const deps = makeStoreDeps({
      'users/u1/presence': { code: 'ABC123', status: 'available', lastSeen: 1000 },
      'userPrefs/u1/notifyChannel': 'push',
      'groups/g1/name': 'Climbers',
      'codeIndex/ABC123': 'u1',
    });

    const snap = await readSnapshot(deps, io());

    expect(snap.users.u1.presence.code).toBe('ABC123');
    expect(snap.userPrefs.u1.notifyChannel).toBe('push');
    expect(snap.groups.g1.name).toBe('Climbers');
    expect(snap.codeIndex.ABC123).toBe('u1');
    expect(snap.takenAt).toBe(NOW);
  });

  test('absent roots become empty objects, never null', async () => {
    const snap = await readSnapshot(makeStoreDeps({}), io());
    for (const path of SNAPSHOT_PATHS) {
      expect(snap[path]).toEqual({});
    }
  });

  test('canvas keys and auth users come from the injected listers', async () => {
    const snap = await readSnapshot(makeStoreDeps({}), io({
      canvasKeys: ['u1_u2'],
      authUsers: [{ uid: 'u1', email: null, createdAt: 900 }],
    }));
    expect(snap.canvasKeys).toEqual(['u1_u2']);
    expect(snap.authUsers).toEqual([{ uid: 'u1', email: null, createdAt: 900 }]);
  });

  test('never reads the canvases subtree itself (strokes are unbounded)', async () => {
    const deps = makeStoreDeps({});
    await readSnapshot(deps, io());
    const readPaths = deps.getVal.mock.calls.map(([p]) => p);
    expect(readPaths).not.toContain('canvases');
    expect(readPaths.some((p) => p.startsWith('canvases'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /home/user/on/functions && npm test -- --testPathPatterns ops-snapshot`
Expected: FAIL — `Cannot find module '../ops/snapshot.js'`.

- [ ] **Step 3: Write `snapshot.js`**

```javascript
// functions/ops/snapshot.js — the ONLY ops module that reads. Everything
// downstream is a pure function of the object this returns.
//
// `canvases` is deliberately absent from SNAPSHOT_PATHS: canvases/{pair}/strokes
// is the only unbounded node in the database, so canvas KEYS arrive through the
// injected listCanvasKeys() (a shallow REST read) and stroke bodies are never
// loaded at all.

/** Every root this panel reads through getVal, in read order. */
export const SNAPSHOT_PATHS = [
  'users',
  'userPrefs',
  'groups',
  'telegramUsers',
  'telegramByUid',
  'pushTokens',
  'locations',
  'locationCells',
  'knocks',
  'calls',
  'followRequests',
  'followGrants',
  'pendingInvites',
  'pendingInvitesByGroup',
  'revocations',
  'codeIndex',
  'inviteIndex',
  'groupIdIndex',
];

/**
 * @param {{ getVal: (path: string) => Promise<any> }} deps
 * @param {{
 *   listCanvasKeys: () => Promise<string[]>,
 *   listAuthUsers: () => Promise<import('./types.js').AuthUserRecord[]>,
 *   now: () => number,
 * }} io
 * @returns {Promise<import('./types.js').Snapshot>}
 */
export async function readSnapshot(deps, io) {
  const [values, canvasKeys, authUsers] = await Promise.all([
    Promise.all(SNAPSHOT_PATHS.map((path) => deps.getVal(path))),
    io.listCanvasKeys(),
    io.listAuthUsers(),
  ]);

  /** @type {Record<string, any>} */
  const out = {};
  SNAPSHOT_PATHS.forEach((path, i) => { out[path] = values[i] || {}; });
  out.canvasKeys = canvasKeys;
  out.authUsers = authUsers;
  out.takenAt = io.now();
  return /** @type {import('./types.js').Snapshot} */ (out);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /home/user/on/functions && npm test -- --testPathPatterns ops-snapshot`
Expected: PASS (4 tests).

- [ ] **Step 5: Write `deps.js` (the admin wiring)**

This is the one module with no unit tests — it is thin wiring over `firebase-admin`, exercised by the manual smoke in Task 10. Keep it that way; anything with logic belongs in a tested module.

```javascript
// functions/ops/deps.js — admin-SDK wiring. Mirrors migrate-presence.js's auth
// and region handling. The ONLY untested ops module: keep it free of logic.
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';

/**
 * @param {{ projectId: string, saJson: string, databaseURL: string }} config
 */
export function makeOpsDeps({ projectId, saJson, databaseURL }) {
  const credential = cert(JSON.parse(saJson));
  initializeApp({ credential, databaseURL, projectId });
  const db = getDatabase();
  const auth = getAuth();

  const deps = {
    /** @param {string} path */
    getVal: async (path) => (await db.ref(path).get()).val(),
    /** @param {string} path @param {unknown} value */
    set: async (path, value) => db.ref(path).set(value),
    /** @param {string} path @param {Record<string, unknown>} writes */
    update: async (path, writes) => db.ref(path).update(writes),
    /** @param {string} path @param {(current: any) => unknown} fn */
    transaction: async (path, fn) => {
      const res = await db.ref(path).transaction(fn);
      return { committed: res.committed };
    },
    now: () => Date.now(),
  };

  const io = {
    // Shallow REST read: the Admin SDK has no shallow query, and loading
    // `canvases` normally would pull every stroke body.
    listCanvasKeys: async () => {
      const token = await credential.getAccessToken();
      const url = `${databaseURL}/canvases.json?shallow=true&access_token=${token.access_token}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`shallow canvases read failed: ${res.status}`);
      return Object.keys((await res.json()) || {});
    },
    listAuthUsers: async () => {
      /** @type {import('./types.js').AuthUserRecord[]} */
      const out = [];
      let pageToken;
      do {
        const page = await auth.listUsers(1000, pageToken);
        for (const u of page.users) {
          out.push({ uid: u.uid, email: u.email || null, createdAt: Date.parse(u.metadata.creationTime) });
        }
        pageToken = page.pageToken;
      } while (pageToken);
      return out;
    },
    now: () => Date.now(),
  };

  return { deps, io, auth };
}
```

- [ ] **Step 6: Typecheck**

Run: `cd /home/user/on && npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
cd /home/user/on
git add functions/ops/snapshot.js functions/ops/deps.js functions/test/ops-snapshot.test.js
git commit -m "feat(ops): snapshot reader and admin deps factory

readSnapshot pulls every root through the injected deps surface, so it
tests against store-deps with no firebase-admin. Canvas keys arrive via a
shallow REST read -- the canvases subtree is never read, since strokes are
the only unbounded node in the database."
```

---

### Task 4: Row and detail projection

**Files:**
- Create: `functions/ops/project.js`
- Test: `functions/test/ops-project.test.js`

**Interfaces:**
- Consumes: `classifyProvenance` (Task 2), `Snapshot` (Task 3)
- Produces:
  - `buildRows(snapshot, secret) => Row[]` — sorted by `lastSeen` descending, nulls last
  - `buildDetail(snapshot, uid, secret) => Detail | null`
  - `canvasPeers(canvasKeys, uid) => Array<{ peer: string, key: string }>`

- [ ] **Step 1: Write the failing test**

Create `functions/test/ops-project.test.js`:

```javascript
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /home/user/on/functions && npm test -- --testPathPatterns ops-project`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `project.js`**

```javascript
// functions/ops/project.js — pure snapshot → display shapes. No I/O.
import { classifyProvenance } from './provenance.js';

/**
 * Canvas keys are SORTED uid pairs, so a uid can appear on either side.
 * @param {string[]} canvasKeys
 * @param {string} uid
 * @returns {Array<{ peer: string, key: string }>}
 */
export function canvasPeers(canvasKeys, uid) {
  /** @type {Array<{ peer: string, key: string }>} */
  const out = [];
  for (const key of canvasKeys) {
    const [a, b] = key.split('_');
    if (a === uid) out.push({ peer: b, key });
    else if (b === uid) out.push({ peer: a, key });
  }
  return out;
}

/** @param {import('./types.js').Snapshot} snapshot @param {string} uid */
function contactSets(snapshot, uid) {
  const followers = Object.keys(snapshot.users?.[uid]?.followers || {});
  const following = Object.keys(snapshot.userPrefs?.[uid]?.following || {});
  const mutuals = followers.filter((f) => following.includes(f));
  return { followers, following, mutuals };
}

/**
 * @param {import('./types.js').Snapshot} snapshot
 * @param {string | null | undefined} secret
 * @returns {import('./types.js').Row[]}
 */
export function buildRows(snapshot, secret) {
  const authByUid = new Map(snapshot.authUsers.map((u) => [u.uid, u]));
  const rows = Object.keys(snapshot.users || {}).map((uid) => {
    const presence = snapshot.users[uid]?.presence || {};
    const { followers, following } = contactSets(snapshot, uid);
    return {
      uid,
      code: presence.code ?? null,
      provenance: classifyProvenance(uid, snapshot, secret),
      createdAt: authByUid.get(uid)?.createdAt ?? null,
      lastSeen: typeof presence.lastSeen === 'number' ? presence.lastSeen : null,
      status: presence.status ?? null,
      availableUntil: typeof presence.availableUntil === 'number' ? presence.availableUntil : null,
      contacts: new Set([...followers, ...following]).size,
      groupCount: Object.keys(snapshot.users[uid]?.groups || {}).length,
      canvasCount: canvasPeers(snapshot.canvasKeys, uid).length,
      pushTokenCount: Object.keys(snapshot.pushTokens?.[uid] || {}).length,
      notifyChannel: snapshot.userPrefs?.[uid]?.notifyChannel ?? null,
      locationOptIn: Boolean(snapshot.locations?.[uid]),
    };
  });
  // Most recently active first; never-seen accounts sort last rather than
  // leading the table on a null.
  rows.sort((a, b) => (b.lastSeen ?? -Infinity) - (a.lastSeen ?? -Infinity));
  return rows;
}

/**
 * @param {import('./types.js').Snapshot} snapshot
 * @param {string} uid
 * @param {string | null | undefined} secret
 * @returns {import('./types.js').Detail | null}
 */
export function buildDetail(snapshot, uid, secret) {
  if (!snapshot.users?.[uid]) return null;
  const row = buildRows(snapshot, secret).find((r) => r.uid === uid);
  if (!row) return null;
  const { followers, following, mutuals } = contactSets(snapshot, uid);

  const groups = Object.keys(snapshot.users[uid]?.groups || {}).map((gid) => {
    const group = snapshot.groups?.[gid] || {};
    const member = group.members?.[uid] || {};
    return {
      gid,
      name: group.name ?? null,
      displayName: member.displayName ?? null,
      role: member.role ?? null,
      isOwner: group.ownerId === uid,
      hasStatusOverride: Boolean(member.statusOverride),
    };
  });

  const point = snapshot.locations?.[uid];
  const cells = Object.keys(snapshot.locationCells || {})
    .filter((gid) => snapshot.locationCells[gid]?.[uid])
    .map((gid) => ({
      gid,
      fixAge: age(snapshot.takenAt, snapshot.locationCells[gid][uid].updatedAt),
    }));

  const link = snapshot.telegramByUid?.[uid];
  const tgId = link?.tgId != null ? String(link.tgId) : null;

  return {
    ...row,
    followers,
    following,
    mutuals,
    groups,
    canvases: canvasPeers(snapshot.canvasKeys, uid),
    pushTokens: Object.entries(snapshot.pushTokens?.[uid] || {}).map(([token, t]) => ({
      token,
      lastSeen: typeof t?.lastSeen === 'number' ? t.lastSeen : null,
      ua: t?.ua ?? null,
    })),
    telegram: tgId ? {
      tgId,
      chatId: link.chatId ?? null,
      mappingLinkedAt: snapshot.telegramUsers?.[tgId]?.linkedAt ?? null,
      prefsLinkedAt: snapshot.userPrefs?.[uid]?.telegram?.linkedAt ?? null,
    } : null,
    location: {
      hasPoint: Boolean(point),
      fixAge: point ? age(snapshot.takenAt, point.updatedAt) : null,
      cells,
    },
  };
}

/** @param {number} takenAt @param {unknown} updatedAt */
function age(takenAt, updatedAt) {
  return typeof updatedAt === 'number' ? takenAt - updatedAt : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /home/user/on/functions && npm test -- --testPathPatterns ops-project`
Expected: PASS (12 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
cd /home/user/on && npm run typecheck
git add functions/ops/project.js functions/test/ops-project.test.js
git commit -m "feat(ops): row and detail projection

Rows carry a single union contact count as specified; the detail pane
splits followers/following/mutuals. Group rows carry the per-group
displayName, role, ownership (read from group ownerId, not the role
string) and statusOverride flag."
```

---

### Task 5: Integrity report

**Files:**
- Create: `functions/ops/integrity.js`
- Test: `functions/test/ops-integrity.test.js`

**Interfaces:**
- Consumes: `Snapshot` (Task 3)
- Produces: `runChecks(snapshot, opts) => Finding[]`, `opts = { staleCallMs?: number }` (default 10 minutes)

Report-only — no fix actions anywhere in this task.

- [ ] **Step 1: Write the failing test**

Create `functions/test/ops-integrity.test.js`:

```javascript
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /home/user/on/functions && npm test -- --testPathPatterns ops-integrity`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `integrity.js`**

```javascript
// functions/ops/integrity.js — pure snapshot → findings. REPORT ONLY: every
// repair is a bespoke write, so this module never proposes or applies one.
//
// The `available-without-until` check is the same invariant
// functions/audit-available-null.js audits (that standalone script stays as
// is); folding it in gives one place to look.

const STALE_CALL_MS = 10 * 60 * 1000;

/**
 * @param {import('./types.js').Snapshot} snapshot
 * @param {{ staleCallMs?: number }} [opts]
 * @returns {import('./types.js').Finding[]}
 */
export function runChecks(snapshot, opts = {}) {
  const staleCallMs = opts.staleCallMs ?? STALE_CALL_MS;
  /** @type {import('./types.js').Finding[]} */
  const out = [];
  /** @type {(severity: 'error'|'warn'|'info', check: string, uid: string|null, path: string|null, detail: string) => void} */
  const add = (severity, check, uid, path, detail) => out.push({ severity, check, uid, path, detail });

  const users = snapshot.users || {};
  const prefs = snapshot.userPrefs || {};
  const groups = snapshot.groups || {};
  const exists = (uid) => Boolean(users[uid]);

  // --- follow graph ---
  for (const [uid, user] of Object.entries(users)) {
    for (const follower of Object.keys(user?.followers || {})) {
      if (!exists(follower)) {
        add('warn', 'follow-dangling', uid, `users/${uid}/followers/${follower}`, `follower ${follower} has no user record`);
      } else if (!prefs[follower]?.following?.[uid]) {
        add('warn', 'follow-one-sided', uid, `users/${uid}/followers/${follower}`, `${follower} is listed as a follower but does not follow ${uid}`);
      }
      if (user?.followerNames && user.followerNames[follower] === undefined) {
        add('info', 'follower-name-missing', uid, `users/${uid}/followerNames/${follower}`, 'follower has no published name');
      }
    }
    for (const name of Object.keys(user?.followerNames || {})) {
      if (!user?.followers?.[name]) {
        add('warn', 'follower-name-orphan', uid, `users/${uid}/followerNames/${name}`, 'followerName with no matching follower');
      }
    }
  }
  for (const [uid, pref] of Object.entries(prefs)) {
    for (const followee of Object.keys(pref?.following || {})) {
      if (!exists(followee)) {
        add('warn', 'follow-dangling', uid, `userPrefs/${uid}/following/${followee}`, `followee ${followee} has no user record`);
      } else if (!users[followee]?.followers?.[uid]) {
        add('warn', 'follow-one-sided', uid, `userPrefs/${uid}/following/${followee}`, `${uid} follows ${followee} but is not in their followers`);
      }
    }
  }

  // --- indexes ---
  for (const [code, uid] of Object.entries(snapshot.codeIndex || {})) {
    if (!exists(String(uid))) {
      add('warn', 'code-index-dangling', String(uid), `codeIndex/${code}`, 'index entry resolves to a uid with no user record');
    } else if (users[String(uid)]?.presence?.code !== code) {
      add('warn', 'code-index-stale', String(uid), `codeIndex/${code}`, 'index entry survives a code rotation');
    }
  }
  for (const [uid, user] of Object.entries(users)) {
    const code = user?.presence?.code;
    if (code && snapshot.codeIndex?.[code] !== uid) {
      add('error', 'code-index-missing', uid, `codeIndex/${code}`, 'canonical presence code has no index entry pointing back');
    }
    for (const token of Object.keys(user?.invites || {})) {
      if (snapshot.inviteIndex?.[token]?.ownerUid !== uid) {
        add('warn', 'invite-index-missing', uid, `inviteIndex/${token}`, 'personal invite token has no matching index entry');
      }
    }
  }
  for (const [token, rec] of Object.entries(snapshot.inviteIndex || {})) {
    const owner = rec?.ownerUid;
    if (!owner || !exists(String(owner))) {
      add('warn', 'invite-index-dangling', owner ? String(owner) : null, `inviteIndex/${token}`, 'index entry resolves to a uid with no user record');
    }
  }

  // --- groups ---
  for (const [uid, user] of Object.entries(users)) {
    for (const gid of Object.keys(user?.groups || {})) {
      if (!groups[gid]) {
        add('warn', 'group-missing', uid, `users/${uid}/groups/${gid}`, 'enumeration entry for a group that no longer exists');
      } else if (!groups[gid]?.members?.[uid]) {
        add('warn', 'group-not-a-member', uid, `groups/${gid}/members/${uid}`, 'enumerated group but no membership record');
      }
    }
  }
  for (const [gid, group] of Object.entries(groups)) {
    const members = Object.keys(group?.members || {});
    if (!members.length) add('warn', 'group-empty', null, `groups/${gid}`, 'group has no members');
    if (group?.ownerId && !members.includes(String(group.ownerId))) {
      add('error', 'group-owner-not-member', String(group.ownerId), `groups/${gid}/ownerId`, 'ownerId is not in the member list');
    }
    for (const uid of members) {
      if (!exists(uid)) {
        add('warn', 'group-member-dangling', uid, `groups/${gid}/members/${uid}`, 'member has no user record');
      } else if (!users[uid]?.groups?.[gid]) {
        // This is the exact breakage repair-user-groups.js was written to fix.
        add('error', 'group-enumeration-missing', uid, `users/${uid}/groups/${gid}`, 'member with no group enumeration entry — the group is invisible in their nav');
      }
      const override = group.members[uid]?.statusOverride;
      if (override?.status === 'available' && typeof override.availableUntil !== 'number') {
        add('error', 'available-without-until', uid, `groups/${gid}/members/${uid}/statusOverride`, 'available with no concrete availableUntil');
      }
    }
    if (!snapshot.groupIdIndex?.[gid]) {
      add('info', 'group-id-index-missing', null, `groupIdIndex/${gid}`, 'group has no id-index entry');
    }
  }
  for (const gid of Object.keys(snapshot.groupIdIndex || {})) {
    if (!groups[gid]) add('warn', 'group-id-index-dangling', null, `groupIdIndex/${gid}`, 'id-index entry for a group that no longer exists');
  }
  for (const [invitee, byGroup] of Object.entries(snapshot.pendingInvites || {})) {
    for (const gid of Object.keys(byGroup || {})) {
      if (!snapshot.pendingInvitesByGroup?.[gid]?.[invitee]) {
        add('warn', 'pending-invite-asymmetric', invitee, `pendingInvitesByGroup/${gid}/${invitee}`, 'pendingInvites entry with no by-group mirror');
      }
    }
  }
  for (const [gid, invitees] of Object.entries(snapshot.pendingInvitesByGroup || {})) {
    for (const invitee of Object.keys(invitees || {})) {
      if (!snapshot.pendingInvites?.[invitee]?.[gid]) {
        add('warn', 'pending-invite-asymmetric', invitee, `pendingInvites/${invitee}/${gid}`, 'by-group entry with no pendingInvites mirror');
      }
    }
  }

  // --- telegram ---
  for (const [uid, link] of Object.entries(snapshot.telegramByUid || {})) {
    const tgId = link?.tgId != null ? String(link.tgId) : null;
    if (!tgId || snapshot.telegramUsers?.[tgId]?.uid !== uid) {
      add('error', 'telegram-mapping-asymmetric', uid, `telegramByUid/${uid}`, 'reverse index with no matching telegramUsers mapping');
    }
    if (!exists(uid)) {
      add('warn', 'telegram-mapping-dangling', uid, `telegramByUid/${uid}`, 'telegram link for a uid with no user record');
    }
    const prefsTgId = prefs[uid]?.telegram?.tgId;
    if (prefsTgId != null && String(prefsTgId) !== tgId) {
      add('error', 'telegram-prefs-disagree', uid, `userPrefs/${uid}/telegram/tgId`, 'prefs tgId disagrees with the reverse index');
    }
  }
  for (const [tgId, mapping] of Object.entries(snapshot.telegramUsers || {})) {
    const uid = mapping?.uid ? String(mapping.uid) : null;
    if (!uid || !exists(uid)) {
      add('warn', 'telegram-mapping-dangling', uid, `telegramUsers/${tgId}`, 'mapping resolves to a uid with no user record');
    }
  }
  for (const [uid, pref] of Object.entries(prefs)) {
    if (pref?.notifyChannel === 'telegram' && !snapshot.telegramByUid?.[uid]) {
      add('error', 'telegram-channel-unroutable', uid, `userPrefs/${uid}/notifyChannel`, 'notifyChannel is telegram but there is no mapping — notifications go nowhere');
    }
  }

  // --- residue ---
  for (const [recipient, senders] of Object.entries(snapshot.knocks || {})) {
    if (!exists(recipient)) {
      add('warn', 'knock-dangling', recipient, `knocks/${recipient}`, 'knock inbox for a uid with no user record');
      continue;
    }
    for (const sender of Object.keys(senders || {})) {
      if (!exists(sender)) {
        // expungeDerivedAccount documents this as deliberately not cleaned.
        add('warn', 'knock-dangling', recipient, `knocks/${recipient}/${sender}`, 'knock from a sender with no user record');
      }
    }
  }
  for (const [uid, call] of Object.entries(snapshot.calls || {})) {
    if (typeof call?.ts === 'number' && snapshot.takenAt - call.ts > staleCallMs) {
      add('warn', 'call-stale', uid, `calls/${uid}`, 'call record older than the stale-call window');
    }
  }
  for (const [gid, cells] of Object.entries(snapshot.locationCells || {})) {
    for (const uid of Object.keys(cells || {})) {
      if (!groups[gid]?.members?.[uid]) {
        add('warn', 'location-cell-non-member', uid, `locationCells/${gid}/${uid}`, 'location cell for a non-member of the group');
      }
    }
  }
  for (const uid of Object.keys(snapshot.locations || {})) {
    if (!exists(uid)) add('warn', 'location-dangling', uid, `locations/${uid}`, 'location point for a uid with no user record');
  }
  for (const uid of Object.keys(snapshot.pushTokens || {})) {
    if (!exists(uid)) add('warn', 'push-tokens-dangling', uid, `pushTokens/${uid}`, 'push tokens for a uid with no user record');
  }
  for (const key of snapshot.canvasKeys || []) {
    for (const uid of key.split('_')) {
      if (!exists(uid)) add('warn', 'canvas-dangling', uid, `canvases/${key}`, 'canvas naming a uid with no user record');
    }
  }

  // --- availability invariant (presence side) ---
  for (const [uid, user] of Object.entries(users)) {
    const p = user?.presence;
    if (p?.status === 'available' && typeof p.availableUntil !== 'number') {
      add('error', 'available-without-until', uid, `users/${uid}/presence`, 'available with no concrete availableUntil');
    }
  }

  // --- auth ↔ rtdb ---
  const authUids = new Set((snapshot.authUsers || []).map((u) => u.uid));
  for (const rec of snapshot.authUsers || []) {
    if (!exists(rec.uid)) {
      add('info', 'auth-orphan', rec.uid, null, `Auth record with no RTDB user${rec.email?.endsWith('@telegram.invalid') ? ' (telegram-derived)' : ''}`);
    }
  }
  for (const uid of Object.keys(users)) {
    if (!authUids.has(uid)) add('info', 'auth-missing', uid, null, 'RTDB user with no Auth record');
  }

  const rank = { error: 0, warn: 1, info: 2 };
  out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.check.localeCompare(b.check));
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /home/user/on/functions && npm test -- --testPathPatterns ops-integrity`
Expected: PASS (18 tests). If the clean-world test reports findings, the fixture is under-specified — fix the fixture, never weaken the check.

- [ ] **Step 5: Typecheck and commit**

```bash
cd /home/user/on && npm run typecheck
git add functions/ops/integrity.js functions/test/ops-integrity.test.js
git commit -m "feat(ops): integrity report

Report-only checks over the snapshot: follow-graph asymmetry, index drift,
group enumeration gaps (the breakage repair-user-groups.js repairs),
telegram mapping asymmetry and unroutable notify channels, residue from
the documented expunge non-cleanups, the available-without-availableUntil
invariant, and Auth/RTDB mismatches."
```

---

### Task 6: Expose the shared enumerator and a build-only expunge

A refactor of shipped, tested code. Behavior must not change — `functions/test/telegram-auth.test.js` is the proof.

**Files:**
- Modify: `functions/telegram-auth.js:319-363` (`expungeDerivedAccount`), `functions/telegram-auth.js:388-410` (`crossRefRenderers`)
- Test: `functions/test/ops-expunge-build.test.js`

**Interfaces:**
- Produces:
  - `export function crossRefRenderers({ followers, following, groups }) => Array<(u: string) => string>` (was module-private)
  - `export async function buildExpungeWrites(deps, uid, extraNulls) => Record<string, unknown>`
  - `expungeDerivedAccount` keeps its exact current signature and behavior, now implemented as build + `rootUpdate`

- [ ] **Step 1: Write the failing test**

Create `functions/test/ops-expunge-build.test.js`:

```javascript
import { makeStoreDeps } from './store-deps.js';
import { buildExpungeWrites, crossRefRenderers, expungeDerivedAccount } from '../telegram-auth.js';

function seeded() {
  return makeStoreDeps({
    'users/dead': { presence: { code: 'DEAD01' }, followers: { peer: 'PEER01' }, groups: { g1: { lastVisited: 1 } }, invites: { tok1: { redemptionsUsed: 0 } } },
    'userPrefs/dead': { following: { peer: {} } },
    'groups/g1': { name: 'G', ownerId: 'other', members: { dead: { role: 'member' }, other: { role: 'owner' } } },
    'codeIndex/DEAD01': 'dead',
    'inviteIndex/tok1': { ownerPath: 'users/dead/invites/tok1', ownerUid: 'dead' },
  });
}

describe('crossRefRenderers', () => {
  test('is exported and renders every residue family at a given uid', () => {
    const paths = crossRefRenderers({
      followers: { peer: 'PEER01' },
      following: { peer: {} },
      groups: { g1: {} },
    }).map((render) => render('dead'));

    expect(paths).toEqual(expect.arrayContaining([
      'userPrefs/peer/following/dead',
      'users/peer/followers/dead',
      'users/peer/followerNames/dead',
      'canvases/dead_peer',
      'canvases/peer_dead',
      'groups/g1/members/dead',
      'pendingInvitesByGroup/g1/dead',
      'knocks/dead',
      'calls/dead',
      'followRequests/dead',
      'followGrants/dead',
      'pendingInvites/dead',
      'revocations/dead',
    ]));
  });
});

describe('buildExpungeWrites', () => {
  test('returns the null-set without writing anything', async () => {
    const deps = seeded();
    const before = JSON.stringify(deps.store);

    const writes = await buildExpungeWrites(deps, 'dead');

    expect(JSON.stringify(deps.store)).toBe(before); // nothing applied
    expect(writes['users/dead']).toBeNull();
    expect(writes['userPrefs/dead']).toBeNull();
    expect(writes['codeIndex/DEAD01']).toBeNull();
    expect(writes['inviteIndex/tok1']).toBeNull();
    expect(writes['groups/g1/members/dead']).toBeNull();
    expect(deps.update).not.toHaveBeenCalled();
  });

  test('folds extraNulls into the same set', async () => {
    const writes = await buildExpungeWrites(seeded(), 'dead', { 'telegramByUid/dead': null });
    expect(writes['telegramByUid/dead']).toBeNull();
  });

  test('expungeDerivedAccount still applies exactly this set', async () => {
    const deps = seeded();
    const writes = await buildExpungeWrites(deps, 'dead');

    const applyDeps = seeded();
    await expungeDerivedAccount(applyDeps, 'dead');

    for (const path of Object.keys(writes)) {
      expect(await applyDeps.getVal(path)).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /home/user/on/functions && npm test -- --testPathPatterns ops-expunge-build`
Expected: FAIL — `buildExpungeWrites` and `crossRefRenderers` are not exported.

- [ ] **Step 3: Refactor `telegram-auth.js`**

Change `crossRefRenderers` from `function crossRefRenderers(...)` to `export function crossRefRenderers(...)`. Leave its body and its comment block untouched — the comment explains that expunge and graduation share it *specifically* to prevent drift, and merge is about to become its third consumer.

Split `expungeDerivedAccount` into a builder plus a one-line applier. The entire current body up to (but not including) the final `await rootUpdate(deps, nulls);` becomes `buildExpungeWrites`, returning `nulls`:

```javascript
/**
 * Build the null-set that expunges `uid` — everything expungeDerivedAccount
 * writes, without applying it. Split out so the ops panel can PREVIEW a purge
 * (and render it as a loss report) before anything is destroyed; expunge
 * itself is now this plus one rootUpdate, so preview and execute cannot drift.
 * @param {TelegramAuthDeps} deps
 * @param {string} uid
 * @param {Record<string, unknown> | null} [extraNulls]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function buildExpungeWrites(deps, uid, extraNulls = null) {
  // ...existing body of expungeDerivedAccount, unchanged, ending with:
  if (extraNulls) Object.assign(nulls, extraNulls);
  return nulls;
}

/**
 * @param {TelegramAuthDeps} deps
 * @param {string} uid
 * @param {Record<string, unknown> | null} [extraNulls]
 */
export async function expungeDerivedAccount(deps, uid, extraNulls = null) {
  await rootUpdate(deps, await buildExpungeWrites(deps, uid, extraNulls));
}
```

Keep the original doc comment above `buildExpungeWrites` (it documents the two read phases, the atomic update, and the deliberate non-cleanups).

- [ ] **Step 4: Run the new tests AND the existing telegram-auth suite**

Run: `cd /home/user/on/functions && npm test -- --testPathPatterns "ops-expunge-build|telegram-auth"`
Expected: PASS. The pre-existing `telegram-auth` tests are the proof that behavior did not change — if any of them fails, the refactor is wrong; do not edit those tests.

- [ ] **Step 5: Run the whole functions suite**

Run: `cd /home/user/on/functions && npm test`
Expected: PASS, count at or above the 462 baseline recorded in `docs/HANDOFF.md`.

- [ ] **Step 6: Typecheck and commit**

```bash
cd /home/user/on && npm run typecheck
git add functions/telegram-auth.js functions/test/ops-expunge-build.test.js
git commit -m "refactor(telegram-auth): split expunge into build + apply

buildExpungeWrites returns the null-set; expungeDerivedAccount is now that
plus one rootUpdate, so the ops panel can preview a purge as a loss report
with no chance of preview and execute drifting. Also exports
crossRefRenderers so merge can consume the same residue enumerator that
expunge and graduation already share. No behavior change -- pinned by the
existing telegram-auth suite."
```

---

### Task 7: Merge

The one genuinely new primitive. `graduateAccountData` refuses a live target, so every moved path needs a collision rule (spec §7).

**Files:**
- Create: `functions/ops/merge.js`
- Test: `functions/test/ops-merge.test.js`

**Interfaces:**
- Consumes: `crossRefRenderers` (Task 6), `rootUpdate` from `../telegram-shared.js`
- Produces:
  - `buildMergePlan(deps, opts) => Promise<WritePlan>` where `opts = { loserUid, survivorUid, adoptGroupNames?: string[], telegramRepoint?: boolean, canvasKeys?: string[], now: number }` — `canvasKeys` comes from the snapshot's shallow read, since merge has no cheap way to enumerate canvases itself
  - `applyMergePlan(deps, plan) => Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `functions/test/ops-merge.test.js`:

```javascript
import { makeStoreDeps } from './store-deps.js';
import { buildMergePlan, applyMergePlan } from '../ops/merge.js';
import { crossRefRenderers } from '../telegram-auth.js';

const NOW = 1_750_000_000_000;

/** loser L and survivor S, both real, overlapping in several families. */
function world(extra = {}) {
  return makeStoreDeps({
    'users/L': {
      presence: { code: 'LLL111', status: 'unavailable', availableUntil: null, lastSeen: 9000 },
      followers: { shared: 'SHR001', onlyL: 'ONL001' },
      followerNames: { shared: 'Shared', onlyL: 'OnlyL' },
      groups: { g1: { lastVisited: 5000 }, g2: { lastVisited: 100 } },
      invites: { tokL: { redemptionsUsed: 2 } },
    },
    'users/S': {
      presence: { code: 'SSS222', status: 'unavailable', availableUntil: null, lastSeen: 1000 },
      followers: { shared: 'SHR001' },
      followerNames: { shared: 'Shared' },
      groups: { g1: { lastVisited: 200 } },
    },
    'users/shared': { presence: { code: 'SHR001' }, followers: { L: 'LLL111', S: 'SSS222' } },
    'users/onlyL': { presence: { code: 'ONL001' }, followers: { L: 'LLL111' } },
    'userPrefs/L': { following: { shared: {}, onlyL: {} }, favorites: ['loser-combo'], notifyChannel: 'push' },
    'userPrefs/S': { following: { shared: {} }, favorites: ['survivor-combo'], notifyChannel: 'push' },
    'userPrefs/shared': { following: { L: {}, S: {} } },
    'userPrefs/onlyL': { following: { L: {} } },
    'groups/g1': {
      name: 'Shared Group',
      ownerId: 'other',
      members: { L: { role: 'member', displayName: 'LoserName' }, S: { role: 'member', displayName: 'SurvivorName' }, other: { role: 'owner' } },
    },
    'groups/g2': { name: 'Loser Owns', ownerId: 'L', members: { L: { role: 'owner', displayName: 'LoserName' } } },
    'codeIndex/LLL111': 'L',
    'codeIndex/SSS222': 'S',
    'inviteIndex/tokL': { ownerPath: 'users/L/invites/tokL', ownerUid: 'L' },
    'pushTokens/L': { tokenL: { createdAt: 1, lastSeen: 9000 } },
    'pushTokens/S': { tokenS: { createdAt: 1, lastSeen: 1000 } },
    'knocks/L': { shared: { count: 1, ts: 500 } },
    'pendingInvites/L': { g3: { from: 'other', ts: 400 } },
    ...extra,
  });
}

const merge = (deps, opts = {}) => buildMergePlan(deps, { loserUid: 'L', survivorUid: 'S', now: NOW, ...opts });

describe('buildMergePlan — nothing is applied at preview time', () => {
  test('returns writes without touching the store', async () => {
    const deps = world();
    const before = JSON.stringify(deps.store);
    await merge(deps);
    expect(JSON.stringify(deps.store)).toBe(before);
    expect(deps.update).not.toHaveBeenCalled();
  });
});

describe('contacts', () => {
  test('a peer who followed only the loser is repointed to the survivor', async () => {
    const { writes } = await merge(world());
    expect(writes['users/onlyL/followers/S']).toBe('SSS222');
    expect(writes['users/onlyL/followers/L']).toBeNull();
    expect(writes['userPrefs/S/following/onlyL']).toEqual({});
  });

  test('a peer who followed BOTH collapses to one card, reported as a conflict', async () => {
    const { writes, conflicts } = await merge(world());
    expect(writes['users/shared/followers/L']).toBeNull();
    // the survivor's existing entry is untouched, not overwritten
    expect(writes['users/shared/followers/S']).toBeUndefined();
    expect(conflicts.some((c) => c.kind === 'contact-collapsed' && c.path.includes('shared'))).toBe(true);
  });
});

describe('groups', () => {
  test('a group only the loser is in moves the member record intact', async () => {
    const { writes } = await merge(world());
    expect(writes['groups/g2/members/S']).toEqual({ role: 'owner', displayName: 'LoserName' });
    expect(writes['groups/g2/members/L']).toBeNull();
  });

  test('ownership of a group the loser owns repoints to the survivor', async () => {
    const { writes } = await merge(world());
    expect(writes['groups/g2/ownerId']).toBe('S');
  });

  test('a shared group keeps the survivor displayName by default (D4)', async () => {
    const { writes, conflicts } = await merge(world());
    expect(writes['groups/g1/members/S']).toBeUndefined(); // survivor's record untouched
    expect(writes['groups/g1/members/L']).toBeNull();
    expect(conflicts.some((c) => c.kind === 'group-member-collision' && c.path === 'groups/g1/members/S')).toBe(true);
  });

  test('adoptGroupNames swaps in the loser displayName for the named group only (D4)', async () => {
    const { writes } = await merge(world(), { adoptGroupNames: ['g1'] });
    expect(writes['groups/g1/members/S/displayName']).toBe('LoserName');
  });

  test('the group enumeration entry keeps the higher lastVisited', async () => {
    const { writes } = await merge(world());
    expect(writes['users/S/groups/g1']).toEqual({ lastVisited: 5000 });
  });
});

describe('identity and indexes', () => {
  test('the loser share code is freed, not aliased (D1)', async () => {
    const { writes } = await merge(world());
    expect(writes['codeIndex/LLL111']).toBeNull();
    expect(writes['codeIndex/SSS222']).toBeUndefined();
  });

  test('invite tokens move and their index repoints, so links keep working', async () => {
    const { writes } = await merge(world());
    expect(writes['users/S/invites/tokL']).toEqual({ redemptionsUsed: 2 });
    expect(writes['inviteIndex/tokL']).toEqual({ ownerPath: 'users/S/invites/tokL', ownerUid: 'S' });
  });

  test('lastSeen takes the max of the two accounts', async () => {
    const { writes } = await merge(world());
    expect(writes['users/S/presence/lastSeen']).toBe(9000);
  });

  test('survivor prefs win wholesale; only following unions', async () => {
    const { writes } = await merge(world());
    expect(writes['userPrefs/S/favorites']).toBeUndefined(); // survivor's kept
    expect(writes['userPrefs/S/following/onlyL']).toEqual({});
  });
});

describe('push tokens, mailboxes, canvases', () => {
  test('push tokens union so both devices stay reachable', async () => {
    const { writes } = await merge(world());
    expect(writes['pushTokens/S/tokenL']).toEqual({ createdAt: 1, lastSeen: 9000 });
    expect(writes['pushTokens/L']).toBeNull();
  });

  test('transient mailboxes are dropped, durable ones union (D3)', async () => {
    const { writes } = await merge(world());
    expect(writes['knocks/L']).toBeNull();
    expect(writes['knocks/S']).toBeUndefined();
    expect(writes['pendingInvites/S/g3']).toEqual({ from: 'other', ts: 400 });
    expect(writes['pendingInvites/L']).toBeNull();
  });

  test('a canvas with a peer moves under the correctly sorted key', async () => {
    const deps = world({ 'canvases/L_peerz': { strokes: { s1: {} } } });
    const { writes } = await buildMergePlan(deps, { loserUid: 'L', survivorUid: 'S', now: NOW, canvasKeys: ['L_peerz'] });
    // sorted([S, peerz]) — NOT a string replacement of the uid
    expect(writes['canvases/S_peerz']).toEqual({ strokes: { s1: {} } });
    expect(writes['canvases/L_peerz']).toBeNull();
  });

  test('a canvas collision keeps the survivor drawing and reports it (D2)', async () => {
    const deps = world({
      'canvases/L_peerz': { strokes: { loser: {} } },
      'canvases/S_peerz': { strokes: { survivor: {} } },
    });
    const { writes, conflicts } = await buildMergePlan(deps, { loserUid: 'L', survivorUid: 'S', now: NOW, canvasKeys: ['L_peerz', 'S_peerz'] });
    expect(writes['canvases/S_peerz']).toBeUndefined();
    expect(writes['canvases/L_peerz']).toBeNull();
    expect(conflicts.some((c) => c.kind === 'canvas-collision')).toBe(true);
  });

  test('a canvas BETWEEN the two merging accounts is deleted, never self-keyed', async () => {
    const deps = world({ 'canvases/L_S': { strokes: { s1: {} } } });
    const { writes } = await buildMergePlan(deps, { loserUid: 'L', survivorUid: 'S', now: NOW, canvasKeys: ['L_S'] });
    expect(writes['canvases/L_S']).toBeNull();
    expect(writes['canvases/S_S']).toBeUndefined();
  });
});

describe('telegram repoint', () => {
  test('mirrors performLink writes when telegramRepoint is set', async () => {
    const deps = world({
      'telegramUsers/42': { uid: 'L', chatId: '42', createdAt: 100 },
      'telegramByUid/L': { tgId: '42', chatId: '42' },
    });
    const { writes } = await buildMergePlan(deps, { loserUid: 'L', survivorUid: 'S', now: NOW, telegramRepoint: true });
    expect(writes['telegramUsers/42']).toEqual({ uid: 'S', chatId: '42', linkedAt: NOW });
    expect(writes['telegramByUid/L']).toBeNull();
    expect(writes['telegramByUid/S']).toEqual({ tgId: '42', chatId: '42' });
    expect(writes['userPrefs/S/telegram/tgId']).toBe('42');
    expect(writes['userPrefs/S/telegram/linkedAt']).toBe(NOW);
    expect(writes['userPrefs/S/notifyChannel']).toBe('telegram');
  });

  test('a survivor already holding a DIFFERENT tgId is reported as a relink conflict', async () => {
    const deps = world({
      'telegramUsers/42': { uid: 'L', chatId: '42' },
      'telegramByUid/L': { tgId: '42', chatId: '42' },
      'telegramUsers/99': { uid: 'S', chatId: '99' },
      'telegramByUid/S': { tgId: '99', chatId: '99' },
    });
    const { conflicts } = await buildMergePlan(deps, { loserUid: 'L', survivorUid: 'S', now: NOW, telegramRepoint: true });
    expect(conflicts.some((c) => c.kind === 'telegram-relink')).toBe(true);
  });
});

describe('the loser is gone afterwards', () => {
  test('own subtrees are nulled and the plan applies atomically', async () => {
    const deps = world();
    const plan = await merge(deps);
    await applyMergePlan(deps, plan);

    expect(await deps.getVal('users/L')).toBeNull();
    expect(await deps.getVal('userPrefs/L')).toBeNull();
    expect(await deps.getVal('users/onlyL/followers/S')).toBe('SSS222');
    expect(await deps.getVal('groups/g2/ownerId')).toBe('S');
    // one atomic update, exactly like graduation
    expect(deps.update).toHaveBeenCalledTimes(1);
  });
});

describe('parity with the shared residue enumerator', () => {
  test('every family crossRefRenderers emits for the loser is handled', async () => {
    // The source comments state expunge and graduation share this enumerator
    // SPECIFICALLY so a new residue family cannot be added to one and missed
    // by the other. Merge is its third consumer; this is the drift guard.
    const deps = world();
    const own = await deps.getVal('users/L');
    const prefs = await deps.getVal('userPrefs/L');
    const families = crossRefRenderers({ followers: own.followers, following: prefs.following, groups: own.groups })
      .map((render) => render('L'));

    const { writes } = await merge(deps);

    for (const path of families) {
      const handled = path in writes
        // or covered by a wholesale delete of an ancestor
        || Object.keys(writes).some((w) => writes[w] === null && path.startsWith(`${w}/`));
      expect({ path, handled }).toEqual({ path, handled: true });
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /home/user/on/functions && npm test -- --testPathPatterns ops-merge`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `merge.js`**

```javascript
// functions/ops/merge.js — merge the loser account into the survivor.
//
// graduateAccountData is a RENAME into a FREE uid (it hard-fails on an
// existing target). Merging into a LIVE account means every moved path can
// collide, so this builds a write-set with an explicit rule per family and a
// conflict report for everything a human should see before pressing execute.
// Family rules and their rationale: spec §7 (D1-D4).
//
// Reads happen at PREVIEW time through deps — not from a cached snapshot —
// because a destructive write must not be planned against minutes-old state.
import { rootUpdate } from '../telegram-shared.js';

/** Transient: a knock or a call is stale within seconds, and merging call state resurrects stuck calls. */
const DROP_MAILBOXES = ['knocks', 'calls'];
/** Durable: a pending invite or a revocation that blocks re-following is real state. */
const UNION_MAILBOXES = ['followRequests', 'followGrants', 'pendingInvites', 'revocations'];

/** Canvas keys are SORTED uid pairs. @param {string} a @param {string} b */
const canvasKey = (a, b) => [a, b].sort().join('_');

/**
 * @param {{ getVal: (path: string) => Promise<any> }} deps
 * @param {{
 *   loserUid: string,
 *   survivorUid: string,
 *   adoptGroupNames?: string[],
 *   telegramRepoint?: boolean,
 *   canvasKeys?: string[],
 *   now: number,
 * }} opts
 * @returns {Promise<import('./types.js').WritePlan>}
 */
export async function buildMergePlan(deps, opts) {
  const { loserUid: L, survivorUid: S, now } = opts;
  if (L === S) throw new Error('merge: loser and survivor are the same uid');
  const adopt = new Set(opts.adoptGroupNames || []);

  const [loser, survivor, loserPrefs, survivorPrefs, loserTokens] = await Promise.all([
    deps.getVal(`users/${L}`),
    deps.getVal(`users/${S}`),
    deps.getVal(`userPrefs/${L}`),
    deps.getVal(`userPrefs/${S}`),
    deps.getVal(`pushTokens/${L}`),
  ]);
  if (!loser) throw new Error(`merge: no account at users/${L}`);
  if (!survivor) throw new Error(`merge: no account at users/${S} — use graduateAccountData for a free target`);

  /** @type {Record<string, unknown>} */
  const writes = {};
  /** @type {import('./types.js').Conflict[]} */
  const conflicts = [];
  /** @type {string[]} */
  const losses = [];
  /** @type {(kind: string, path: string, detail: string, resolution: string) => void} */
  const conflict = (kind, path, detail, resolution) => conflicts.push({ kind, path, detail, resolution });

  // --- followers / followerNames: union, survivor wins ---
  for (const [follower, name] of Object.entries(loser.followers || {})) {
    if (follower === S) continue; // the survivor following the loser is not a contact to keep
    if (survivor.followers?.[follower] === undefined) {
      writes[`users/${S}/followers/${follower}`] = name;
      const fname = loser.followerNames?.[follower];
      if (fname !== undefined) writes[`users/${S}/followerNames/${follower}`] = fname;
    } else {
      conflict('contact-collapsed', `users/${S}/followers/${follower}`, `${follower} followed both accounts`, 'survivor entry kept');
    }
  }

  // --- following: union, survivor wins ---
  for (const [followee, rec] of Object.entries(loserPrefs?.following || {})) {
    if (followee === S) continue;
    if (survivorPrefs?.following?.[followee] === undefined) {
      writes[`userPrefs/${S}/following/${followee}`] = rec;
    } else {
      conflict('contact-collapsed', `userPrefs/${S}/following/${followee}`, `both accounts followed ${followee}`, 'survivor entry kept');
    }
  }

  // --- notify prefs: union, survivor wins ---
  for (const [contact, rec] of Object.entries(loserPrefs?.notify || {})) {
    if (survivorPrefs?.notify?.[contact] === undefined) writes[`userPrefs/${S}/notify/${contact}`] = rec;
  }

  // --- peer backrefs: repoint L → S, collapse where the peer had both ---
  const peers = new Set([
    ...Object.keys(loser.followers || {}),
    ...Object.keys(loserPrefs?.following || {}),
  ]);
  peers.delete(S);
  for (const peer of peers) {
    // peer follows L  →  peer follows S
    const peerFollowing = await deps.getVal(`userPrefs/${peer}/following/${L}`);
    if (peerFollowing !== null && peerFollowing !== undefined) {
      const already = await deps.getVal(`userPrefs/${peer}/following/${S}`);
      if (already === null || already === undefined) writes[`userPrefs/${peer}/following/${S}`] = peerFollowing;
      else conflict('contact-collapsed', `userPrefs/${peer}/following/${S}`, `${peer} followed both accounts`, 'survivor card kept');
      writes[`userPrefs/${peer}/following/${L}`] = null;
    }
    // L follows peer  →  S appears in the peer's followers
    const backref = await deps.getVal(`users/${peer}/followers/${L}`);
    if (backref !== null && backref !== undefined) {
      const already = await deps.getVal(`users/${peer}/followers/${S}`);
      if (already === null || already === undefined) {
        writes[`users/${peer}/followers/${S}`] = backref;
        const fname = await deps.getVal(`users/${peer}/followerNames/${L}`);
        if (fname !== null && fname !== undefined) writes[`users/${peer}/followerNames/${S}`] = fname;
      } else {
        conflict('contact-collapsed', `users/${peer}/followers/${S}`, `${peer} was followed by both accounts`, 'survivor entry kept');
      }
      writes[`users/${peer}/followers/${L}`] = null;
      writes[`users/${peer}/followerNames/${L}`] = null;
    }
  }

  // --- groups: union; survivor member record wins; ownership follows ---
  for (const gid of Object.keys(loser.groups || {})) {
    const [group, loserMember, survivorMember] = await Promise.all([
      deps.getVal(`groups/${gid}/name`).then((name) => ({ name })),
      deps.getVal(`groups/${gid}/members/${L}`),
      deps.getVal(`groups/${gid}/members/${S}`),
    ]);
    const ownerId = await deps.getVal(`groups/${gid}/ownerId`);

    if (loserMember && (survivorMember === null || survivorMember === undefined)) {
      writes[`groups/${gid}/members/${S}`] = loserMember;
    } else if (loserMember && survivorMember) {
      conflict(
        'group-member-collision',
        `groups/${gid}/members/${S}`,
        `both accounts are members of ${group.name || gid}: "${loserMember.displayName ?? '—'}" vs "${survivorMember.displayName ?? '—'}"`,
        adopt.has(gid) ? "loser's displayName adopted" : "survivor's record kept",
      );
      if (adopt.has(gid) && loserMember.displayName !== undefined) {
        writes[`groups/${gid}/members/${S}/displayName`] = loserMember.displayName;
      }
      // Higher role wins: owner outranks member.
      if (loserMember.role === 'owner' && survivorMember.role !== 'owner') {
        writes[`groups/${gid}/members/${S}/role`] = 'owner';
      }
    }
    if (loserMember) writes[`groups/${gid}/members/${L}`] = null;
    if (ownerId === L) writes[`groups/${gid}/ownerId`] = S;

    // Enumeration entry: keep the more recent visit.
    const loserEnum = loser.groups[gid];
    const survivorEnum = survivor.groups?.[gid];
    if (!survivorEnum) writes[`users/${S}/groups/${gid}`] = loserEnum;
    else if ((loserEnum?.lastVisited ?? 0) > (survivorEnum?.lastVisited ?? 0)) {
      writes[`users/${S}/groups/${gid}`] = loserEnum;
    }

    const pending = await deps.getVal(`pendingInvitesByGroup/${gid}/${L}`);
    if (pending !== null && pending !== undefined) {
      writes[`pendingInvitesByGroup/${gid}/${S}`] = pending;
      writes[`pendingInvitesByGroup/${gid}/${L}`] = null;
    }
  }

  // --- identity: free the loser code (D1), move invite tokens ---
  const loserCode = loser.presence?.code;
  if (loserCode) writes[`codeIndex/${loserCode}`] = null;
  for (const [token, rec] of Object.entries(loser.invites || {})) {
    writes[`users/${S}/invites/${token}`] = rec;
    writes[`inviteIndex/${token}`] = { ownerPath: `users/${S}/invites/${token}`, ownerUid: S };
  }
  const loserLastSeen = loser.presence?.lastSeen;
  const survivorLastSeen = survivor.presence?.lastSeen;
  if (typeof loserLastSeen === 'number' && loserLastSeen > (survivorLastSeen ?? -Infinity)) {
    writes[`users/${S}/presence/lastSeen`] = loserLastSeen;
  }

  // --- push tokens: union, both devices stay reachable ---
  for (const [token, rec] of Object.entries(loserTokens || {})) {
    writes[`pushTokens/${S}/${token}`] = rec;
  }
  writes[`pushTokens/${L}`] = null;

  // --- mailboxes (D3) ---
  for (const box of DROP_MAILBOXES) {
    writes[`${box}/${L}`] = null;
    losses.push(`${box}/${L} dropped (transient)`);
  }
  for (const box of UNION_MAILBOXES) {
    const own = await deps.getVal(`${box}/${L}`);
    for (const [key, rec] of Object.entries(own || {})) {
      const already = await deps.getVal(`${box}/${S}/${key}`);
      if (already === null || already === undefined) writes[`${box}/${S}/${key}`] = rec;
    }
    if (own) writes[`${box}/${L}`] = null;
  }

  // --- canvases (D2): sorted-pair keys, survivor wins, self-canvas deleted ---
  for (const key of opts.canvasKeys || []) {
    const [a, b] = key.split('_');
    if (a !== L && b !== L) continue;
    const peer = a === L ? b : a;
    if (peer === S) {
      // A canvas BETWEEN the merging accounts would become a self-canvas.
      writes[`canvases/${key}`] = null;
      losses.push(`canvases/${key} deleted (canvas between the two merged accounts)`);
      continue;
    }
    const target = canvasKey(S, peer);
    const existing = await deps.getVal(`canvases/${target}`);
    if (existing === null || existing === undefined) {
      writes[`canvases/${target}`] = await deps.getVal(`canvases/${key}`);
    } else {
      conflict('canvas-collision', `canvases/${target}`, `both accounts have a canvas with ${peer}`, "survivor's drawing kept, loser's deleted");
      losses.push(`canvases/${key} deleted (collision with ${target})`);
    }
    writes[`canvases/${key}`] = null;
  }

  // --- locations: loser's dropped, republished on the next tick ---
  writes[`locations/${L}`] = null;
  for (const gid of Object.keys(loser.groups || {})) {
    const cell = await deps.getVal(`locationCells/${gid}/${L}`);
    if (cell !== null && cell !== undefined) writes[`locationCells/${gid}/${L}`] = null;
  }

  // --- telegram repoint: mirrors performLink exactly ---
  if (opts.telegramRepoint) {
    const link = await deps.getVal(`telegramByUid/${L}`);
    if (!link?.tgId) throw new Error(`merge: telegramRepoint requested but ${L} has no telegram link`);
    const tgId = String(link.tgId);
    const survivorLink = await deps.getVal(`telegramByUid/${S}`);
    if (survivorLink?.tgId && String(survivorLink.tgId) !== tgId) {
      conflict('telegram-relink', `telegramByUid/${S}`, `survivor already holds tgId ${survivorLink.tgId}`, `its mapping is dropped and prefs reset to push`);
      writes[`telegramUsers/${survivorLink.tgId}`] = null;
    }
    const chatId = link.chatId || tgId;
    writes[`telegramUsers/${tgId}`] = { uid: S, chatId, linkedAt: now };
    writes[`telegramByUid/${L}`] = null;
    writes[`telegramByUid/${S}`] = { tgId, chatId };
    writes[`userPrefs/${S}/telegram/tgId`] = tgId;
    writes[`userPrefs/${S}/telegram/linkedAt`] = now;
    writes[`userPrefs/${S}/notifyChannel`] = 'telegram';
  } else {
    const link = await deps.getVal(`telegramByUid/${L}`);
    if (link?.tgId) {
      writes[`telegramUsers/${link.tgId}`] = null;
      writes[`telegramByUid/${L}`] = null;
    }
  }

  // --- the loser's own subtrees go last: survivor prefs win wholesale ---
  writes[`users/${L}`] = null;
  writes[`userPrefs/${L}`] = null;
  losses.push(`userPrefs/${L} discarded (survivor's prefs win)`);

  return { writes, conflicts, losses };
}

/**
 * Apply a plan built by buildMergePlan. ONE atomic update, exactly like
 * graduation — a crash cannot half-merge.
 * @param {{ update: (path: string, writes: Record<string, unknown>) => Promise<unknown> }} deps
 * @param {import('./types.js').WritePlan} plan
 */
export async function applyMergePlan(deps, plan) {
  await rootUpdate(deps, plan.writes);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /home/user/on/functions && npm test -- --testPathPatterns ops-merge`
Expected: PASS (21 tests). `rootUpdate` throws on ancestor-overlapping paths and `makeStoreDeps.update` rejects them too — if the atomic-apply test fails with an overlap error, the write-set genuinely conflicts and the family rules need fixing, not the test.

- [ ] **Step 5: Typecheck and commit**

```bash
cd /home/user/on && npm run typecheck
git add functions/ops/merge.js functions/test/ops-merge.test.js
git commit -m "feat(ops): merge two live accounts

Builds a write-set with a rule per family plus a conflict report, applied
as one atomic rootUpdate. Reads at preview time rather than from a cached
snapshot. Canvas keys are rebuilt from the sorted pair (never a string
replacement) and a canvas between the two merging accounts is deleted
rather than becoming a self-canvas. A parity test pins that every family
crossRefRenderers emits is handled, so merge cannot drift from expunge and
graduation."
```

---

### Task 8: Purge and link-impact reports

**Files:**
- Create: `functions/ops/purge.js`
- Test: `functions/test/ops-purge.test.js`

**Interfaces:**
- Consumes: `buildExpungeWrites` (Task 6), `Snapshot` (Task 3)
- Produces:
  - `buildPurgePlan(deps, uid) => Promise<WritePlan>`
  - `buildLinkImpact(deps, derivedUid, canvasKeys?: string[]) => Promise<{ verdict: 'safe'|'lossy', losses: string[], keeps: string[] }>`
  - `buildProductionLinkPlan(deps, { derivedUid, phraseUid, now }) => Promise<WritePlan>`
  - `applyPurgePlan(deps, plan) => Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `functions/test/ops-purge.test.js`:

```javascript
import { makeStoreDeps } from './store-deps.js';
import { buildPurgePlan, buildLinkImpact, buildProductionLinkPlan, applyPurgePlan } from '../ops/purge.js';

/** A derived account that owns a group, holds a canvas and a redeemed invite. */
function loaded() {
  return makeStoreDeps({
    'users/D': {
      presence: { code: 'DDD111' },
      followers: { peer: 'PEER01' },
      groups: { owned: { lastVisited: 1 }, joined: { lastVisited: 1 } },
      invites: { tokD: { redemptionsUsed: 3 } },
    },
    'userPrefs/D': { following: { peer: {} } },
    'users/peer': { presence: { code: 'PEER01' }, followers: { D: 'DDD111' } },
    'userPrefs/peer': { following: { D: {} } },
    'groups/owned': { name: 'Owned Group', ownerId: 'D', members: { D: { role: 'owner' }, other: { role: 'member' } } },
    'groups/joined': { name: 'Joined Group', ownerId: 'other', members: { D: { role: 'member' }, other: { role: 'owner' } } },
    'codeIndex/DDD111': 'D',
    'inviteIndex/tokD': { ownerPath: 'users/D/invites/tokD', ownerUid: 'D' },
  });
}

/** A derived account that holds nothing. */
function empty() {
  return makeStoreDeps({ 'users/E': { presence: { code: 'EEE111' } }, 'codeIndex/EEE111': 'E' });
}

describe('buildPurgePlan', () => {
  test('previews without writing', async () => {
    const deps = loaded();
    const before = JSON.stringify(deps.store);
    await buildPurgePlan(deps, 'D');
    expect(JSON.stringify(deps.store)).toBe(before);
    expect(deps.update).not.toHaveBeenCalled();
  });

  test('names the peers who lose a contact', async () => {
    const { losses } = await buildPurgePlan(loaded(), 'D');
    expect(losses.some((l) => l.includes('peer'))).toBe(true);
  });

  test('names owned groups as deleted for every member — the sharpest edge', async () => {
    const { losses } = await buildPurgePlan(loaded(), 'D');
    expect(losses.some((l) => l.includes('Owned Group') && l.includes('other'))).toBe(true);
  });

  test('does not claim the joined group is deleted', async () => {
    const { losses } = await buildPurgePlan(loaded(), 'D');
    expect(losses.some((l) => l.includes('Joined Group') && l.includes('deleted'))).toBe(false);
  });

  test('applying it removes the account and its residue', async () => {
    const deps = loaded();
    await applyPurgePlan(deps, await buildPurgePlan(deps, 'D'));
    expect(await deps.getVal('users/D')).toBeNull();
    expect(await deps.getVal('users/peer/followers/D')).toBeNull();
    expect(await deps.getVal('groups/owned')).toBeNull();
    expect(await deps.getVal('groups/joined/members/D')).toBeNull();
    expect(await deps.getVal('codeIndex/DDD111')).toBeNull();
  });
});

describe('buildLinkImpact', () => {
  test('an account holding contacts, groups, canvases or redeemed invites is lossy', async () => {
    const impact = await buildLinkImpact(loaded(), 'D');
    expect(impact.verdict).toBe('lossy');
    expect(impact.losses.some((l) => l.includes('Owned Group'))).toBe(true);
    expect(impact.losses.some((l) => l.includes('tokD'))).toBe(true);
  });

  test('an empty account is safe to link', async () => {
    const impact = await buildLinkImpact(empty(), 'E');
    expect(impact.verdict).toBe('safe');
    expect(impact.losses).toEqual([]);
  });

  test('transient residue is listed as kept, not as a loss', async () => {
    const deps = empty();
    deps.store['knocks/E'] = { peer: { count: 1, ts: 1 } };
    deps.store['locations/E'] = { lat: 1, lng: 2, updatedAt: 1 };
    const impact = await buildLinkImpact(deps, 'E');
    expect(impact.verdict).toBe('safe');
    expect(impact.keeps.some((k) => k.includes('knocks'))).toBe(true);
  });

  test('a redeemed invite token alone makes it lossy', async () => {
    const deps = empty();
    deps.store['users/E'] = { presence: { code: 'EEE111' }, invites: { tokE: { redemptionsUsed: 1 } } };
    expect((await buildLinkImpact(deps, 'E')).verdict).toBe('lossy');
  });
});

describe('buildProductionLinkPlan', () => {
  const NOW = 1_750_000_000_000;

  function linkable() {
    const deps = empty();
    deps.store['telegramUsers/42'] = { uid: 'E', chatId: '42', createdAt: 100 };
    deps.store['telegramByUid/E'] = { tgId: '42', chatId: '42' };
    deps.store['users/P'] = { presence: { code: 'PPP111' } };
    return deps;
  }

  test('expunges the derived account and writes exactly what performLink writes', async () => {
    const { writes } = await buildProductionLinkPlan(linkable(), { derivedUid: 'E', phraseUid: 'P', now: NOW });
    expect(writes['users/E']).toBeNull();
    expect(writes['userPrefs/E']).toBeNull();
    expect(writes['telegramByUid/E']).toBeNull();
    expect(writes['telegramUsers/42']).toEqual({ uid: 'P', chatId: '42', linkedAt: NOW });
    expect(writes['telegramByUid/P']).toEqual({ tgId: '42', chatId: '42' });
    expect(writes['userPrefs/P/telegram/tgId']).toBe('42');
    expect(writes['userPrefs/P/notifyChannel']).toBe('telegram');
  });

  test('refuses when the derived account has no telegram mapping', async () => {
    await expect(buildProductionLinkPlan(empty(), { derivedUid: 'E', phraseUid: 'P', now: NOW }))
      .rejects.toThrow(/no telegram mapping/);
  });

  test('refuses when the phrase uid has no account', async () => {
    const deps = linkable();
    delete deps.store['users/P'];
    await expect(buildProductionLinkPlan(deps, { derivedUid: 'E', phraseUid: 'P', now: NOW }))
      .rejects.toThrow(/no account with that phrase uid/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /home/user/on/functions && npm test -- --testPathPatterns ops-purge`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `purge.js`**

```javascript
// functions/ops/purge.js — purge previews and the Telegram link-impact report.
//
// Purge is buildExpungeWrites unchanged (one enumerator for expunge,
// graduation and merge). What this module adds is the human-readable loss
// report: which peers lose a contact, and — the sharpest edge — which groups
// are deleted for EVERY member because the purged account owns them.
//
// buildLinkImpact answers "would linking this Telegram-derived account to a
// phrase account destroy anything?". Production's own gate
// (redeemTelegramLinkTokenHandler) counts only followers/following/groups, so
// it is silent about owned groups, canvases and redeemed invite tokens. This
// verdict is deliberately stricter. See spec §8.2-8.3.
import { buildExpungeWrites } from '../telegram-auth.js';
import { rootUpdate } from '../telegram-shared.js';

/**
 * @param {{ getVal: (path: string) => Promise<any> }} deps
 * @param {string} uid
 * @returns {Promise<import('./types.js').WritePlan>}
 */
export async function buildPurgePlan(deps, uid) {
  const writes = await buildExpungeWrites(deps, uid);
  const losses = await describeLosses(deps, uid);
  return { writes, conflicts: [], losses };
}

/**
 * @param {{ update: (path: string, writes: Record<string, unknown>) => Promise<unknown> }} deps
 * @param {import('./types.js').WritePlan} plan
 */
export async function applyPurgePlan(deps, plan) {
  await rootUpdate(deps, plan.writes);
}

/** @param {{ getVal: (path: string) => Promise<any> }} deps @param {string} uid */
async function describeLosses(deps, uid) {
  const [own, prefs] = await Promise.all([deps.getVal(`users/${uid}`), deps.getVal(`userPrefs/${uid}`)]);
  /** @type {string[]} */
  const losses = [];

  const peers = new Set([
    ...Object.keys(own?.followers || {}),
    ...Object.keys(prefs?.following || {}),
  ]);
  for (const peer of peers) {
    const code = await deps.getVal(`users/${peer}/presence/code`);
    losses.push(`${peer} (${code || 'no code'}) loses this contact`);
  }

  for (const gid of Object.keys(own?.groups || {})) {
    const [name, ownerId, members] = await Promise.all([
      deps.getVal(`groups/${gid}/name`),
      deps.getVal(`groups/${gid}/ownerId`),
      deps.getVal(`groups/${gid}/members`),
    ]);
    const others = Object.keys(members || {}).filter((m) => m !== uid);
    if (ownerId === uid) {
      losses.push(`group "${name || gid}" is DELETED for every member${others.length ? `: ${others.join(', ')}` : ' (no other members)'}`);
    } else {
      losses.push(`dropped from group "${name || gid}"`);
    }
  }

  for (const [token, rec] of Object.entries(own?.invites || {})) {
    losses.push(`invite token ${token} stops working (${rec?.redemptionsUsed ?? 0} redemptions used)`);
  }

  return losses;
}

/**
 * @param {{ getVal: (path: string) => Promise<any> }} deps
 * @param {string} derivedUid
 * @param {string[]} [canvasKeys]
 * @returns {Promise<{ verdict: 'safe' | 'lossy', losses: string[], keeps: string[] }>}
 */
export async function buildLinkImpact(deps, derivedUid, canvasKeys = []) {
  const [own, prefs] = await Promise.all([
    deps.getVal(`users/${derivedUid}`),
    deps.getVal(`userPrefs/${derivedUid}`),
  ]);

  const losses = await describeLosses(deps, derivedUid);
  for (const key of canvasKeys) {
    const [a, b] = key.split('_');
    if (a === derivedUid || b === derivedUid) {
      losses.push(`canvas ${key} is deleted with its drawing history`);
    }
  }

  /** @type {string[]} */
  const keeps = [];
  for (const box of ['knocks', 'calls', 'followRequests', 'followGrants', 'pendingInvites', 'revocations']) {
    if (await deps.getVal(`${box}/${derivedUid}`)) keeps.push(`${box}/${derivedUid} — transient, not a loss`);
  }
  if (await deps.getVal(`locations/${derivedUid}`)) keeps.push('location point — republished on the next tick, not a loss');

  const hasPrefs = Object.keys(prefs || {}).some((k) => k !== 'telegram' && k !== 'notifyChannel');
  if (hasPrefs) losses.push('private prefs (palette, favorites, hints) are discarded');

  return { verdict: losses.length ? 'lossy' : 'safe', losses, keeps };
}

/**
 * "Link as production does" — expunge the derived account, then write exactly
 * what performLink writes. Byte-identical to the shipped path (spec §8.3 #3),
 * for when buildLinkImpact returns 'safe'. Use link-via-merge (ops/merge.js
 * with telegramRepoint) whenever the verdict is 'lossy'.
 * @param {{ getVal: (path: string) => Promise<any> }} deps
 * @param {{ derivedUid: string, phraseUid: string, now: number }} opts
 * @returns {Promise<import('./types.js').WritePlan>}
 */
export async function buildProductionLinkPlan(deps, { derivedUid, phraseUid, now }) {
  const link = await deps.getVal(`telegramByUid/${derivedUid}`);
  if (!link?.tgId) throw new Error(`link: ${derivedUid} has no telegram mapping`);
  if (!(await deps.getVal(`users/${phraseUid}/presence`))) {
    throw new Error(`link: no account with that phrase uid (${phraseUid})`);
  }
  const tgId = String(link.tgId);
  const chatId = link.chatId || tgId;

  // performLink folds the expunge and the mapping writes into one update; the
  // extraNulls seam is exactly how the shipped handler does it.
  const writes = await buildExpungeWrites(deps, derivedUid, {
    [`telegramByUid/${derivedUid}`]: null,
  });
  writes[`telegramUsers/${tgId}`] = { uid: phraseUid, chatId, linkedAt: now };
  writes[`telegramByUid/${phraseUid}`] = { tgId, chatId };
  writes[`userPrefs/${phraseUid}/telegram/tgId`] = tgId;
  writes[`userPrefs/${phraseUid}/telegram/linkedAt`] = now;
  writes[`userPrefs/${phraseUid}/notifyChannel`] = 'telegram';

  return { writes, conflicts: [], losses: await describeLosses(deps, derivedUid) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /home/user/on/functions && npm test -- --testPathPatterns ops-purge`
Expected: PASS (12 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
cd /home/user/on && npm run typecheck
git add functions/ops/purge.js functions/test/ops-purge.test.js
git commit -m "feat(ops): purge preview, link impact, production-parity link

Purge reuses buildExpungeWrites and adds the loss report -- which peers
lose a contact and which groups are deleted for every member because the
account owns them. buildLinkImpact answers whether linking a derived
account would destroy anything; its verdict is stricter than production's
own gate, which counts only contacts and groups and is silent about owned
groups, canvases and redeemed invite tokens. buildProductionLinkPlan
reproduces the shipped expunge-then-link path for the safe case."
```

---

### Task 9: Audit trail

**Files:**
- Create: `functions/ops/audit.js`
- Test: `functions/test/ops-audit.test.js`

**Interfaces:**
- Consumes: `WritePlan` (Tasks 7-8)
- Produces:
  - `capturePreImage(deps, paths) => Promise<Record<string, unknown>>`
  - `writeAuditRecord(fs, dir, record) => string` (returns the pre-image file path)

- [ ] **Step 1: Write the failing test**

Create `functions/test/ops-audit.test.js`:

```javascript
import { makeStoreDeps } from './store-deps.js';
import { capturePreImage, writeAuditRecord } from '../ops/audit.js';

describe('capturePreImage', () => {
  test('reads the current value of every path the plan will write', async () => {
    const deps = makeStoreDeps({ 'users/u1': { presence: { code: 'AAA111' } }, 'codeIndex/AAA111': 'u1' });
    const pre = await capturePreImage(deps, ['users/u1', 'codeIndex/AAA111', 'users/absent']);
    expect(pre).toEqual({
      'users/u1': { presence: { code: 'AAA111' } },
      'codeIndex/AAA111': 'u1',
      'users/absent': null,
    });
  });
});

describe('writeAuditRecord', () => {
  test('writes the pre-image file and appends one JSONL line', () => {
    /** @type {Record<string, string>} */
    const files = {};
    const fakeFs = {
      mkdirSync: () => {},
      writeFileSync: (path, body) => { files[path] = body; },
      appendFileSync: (path, body) => { files[path] = (files[path] || '') + body; },
    };

    const path = writeAuditRecord(fakeFs, '/audit', {
      ts: 1000, op: 'merge', project: 'demo', uids: ['L', 'S'], preImage: { 'users/L': { a: 1 } }, outcome: 'ok',
    });

    expect(path).toBe('/audit/1000-merge-L.json');
    expect(JSON.parse(files[path]).preImage).toEqual({ 'users/L': { a: 1 } });
    const line = JSON.parse(files['/audit/audit.jsonl'].trim());
    expect(line).toEqual({ ts: 1000, op: 'merge', project: 'demo', uids: ['L', 'S'], paths: 1, outcome: 'ok', preImageFile: path });
  });

  test('the JSONL line carries no payload values, only the path count', () => {
    const files = {};
    const fakeFs = {
      mkdirSync: () => {},
      writeFileSync: (p, b) => { files[p] = b; },
      appendFileSync: (p, b) => { files[p] = (files[p] || '') + b; },
    };
    writeAuditRecord(fakeFs, '/audit', { ts: 1, op: 'purge', project: 'demo', uids: ['D'], preImage: { 'users/D': { secret: 'x' } }, outcome: 'ok' });
    expect(files['/audit/audit.jsonl']).not.toContain('secret');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /home/user/on/functions && npm test -- --testPathPatterns ops-audit`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `audit.js`**

```javascript
// functions/ops/audit.js — the only thing resembling undo. RTDB has no
// rollback, so before any mutation the panel dumps the CURRENT value of every
// path the write-set touches. The JSONL line stays payload-free (path count
// only) so it can be read at a glance; the values live in the per-op file.
//
// `fs` is injected so this tests without touching disk.

/**
 * @param {{ getVal: (path: string) => Promise<any> }} deps
 * @param {string[]} paths
 * @returns {Promise<Record<string, unknown>>}
 */
export async function capturePreImage(deps, paths) {
  const values = await Promise.all(paths.map((p) => deps.getVal(p)));
  /** @type {Record<string, unknown>} */
  const out = {};
  paths.forEach((p, i) => { out[p] = values[i] ?? null; });
  return out;
}

/**
 * @param {{
 *   mkdirSync: (path: string, opts?: object) => unknown,
 *   writeFileSync: (path: string, body: string) => unknown,
 *   appendFileSync: (path: string, body: string) => unknown,
 * }} fs
 * @param {string} dir
 * @param {{ ts: number, op: string, project: string, uids: string[], preImage: Record<string, unknown>, outcome: string }} record
 * @returns {string} the pre-image file path
 */
export function writeAuditRecord(fs, dir, record) {
  fs.mkdirSync(dir, { recursive: true });
  const file = `${dir}/${record.ts}-${record.op}-${record.uids[0]}.json`;
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  fs.appendFileSync(`${dir}/audit.jsonl`, `${JSON.stringify({
    ts: record.ts,
    op: record.op,
    project: record.project,
    uids: record.uids,
    paths: Object.keys(record.preImage).length,
    outcome: record.outcome,
    preImageFile: file,
  })}\n`);
  return file;
}
```

- [ ] **Step 4: Run the tests, typecheck, commit**

Run: `cd /home/user/on/functions && npm test -- --testPathPatterns ops-audit`
Expected: PASS (3 tests).

```bash
cd /home/user/on && npm run typecheck
git add functions/ops/audit.js functions/test/ops-audit.test.js
git commit -m "feat(ops): pre-image capture and audit log

RTDB has no undo, so every mutation dumps the current value of each path
its write-set touches before applying. The JSONL line stays payload-free
(path count only); values live in the per-op file."
```

---

### Task 10: Server, gates, and the panel page

The last task: argv parsing and the prod gate are unit-tested; the HTTP wiring and the page get a documented manual smoke against the dev project.

**Files:**
- Create: `functions/ops/server.js`
- Create: `functions/ops/panel.html`
- Create: `functions/ops/README.md`
- Test: `functions/test/ops-server.test.js`

**Interfaces:**
- Consumes: every module from Tasks 2-9
- Produces: `parseArgs(argv, env) => Options`, `assertProdGate(options) => void`, `requireConfirm(body, expectedUid, expectedNonce) => void`, `createRoutes(ctx) => Record<string, handler>`

- [ ] **Step 1: Write the failing test**

Create `functions/test/ops-server.test.js`:

```javascript
import { parseArgs, assertProdGate, requireConfirm } from '../ops/server.js';

const ENV = { GOOGLE_APPLICATION_CREDENTIALS_JSON: '{"x":1}', TELEGRAM_UID_SECRET: 's' };

describe('parseArgs', () => {
  test('reads project, port, region and the prod flags', () => {
    const opts = parseArgs(['--project', 'demo', '--port', '9999', '--prod-project', 'live', '--i-know-this-is-prod'], ENV);
    expect(opts.projectId).toBe('demo');
    expect(opts.port).toBe(9999);
    expect(opts.prodProject).toBe('live');
    expect(opts.prodAcknowledged).toBe(true);
  });

  test('defaults the port and the region', () => {
    const opts = parseArgs(['--project', 'demo'], ENV);
    expect(opts.port).toBe(8787);
    expect(opts.region).toBe('europe-west1');
  });

  test('derives the regional database URL', () => {
    expect(parseArgs(['--project', 'demo'], ENV).databaseURL)
      .toBe('https://demo-default-rtdb.europe-west1.firebasedatabase.app');
  });

  test('us-central1 uses the legacy host', () => {
    expect(parseArgs(['--project', 'demo', '--region', 'us-central1'], ENV).databaseURL)
      .toBe('https://demo-default-rtdb.firebaseio.com');
  });

  test('throws without --project', () => {
    expect(() => parseArgs([], ENV)).toThrow(/--project/);
  });

  test('throws without the service-account env', () => {
    expect(() => parseArgs(['--project', 'demo'], {})).toThrow(/GOOGLE_APPLICATION_CREDENTIALS_JSON/);
  });

  test('a missing uid secret is allowed but recorded', () => {
    const opts = parseArgs(['--project', 'demo'], { GOOGLE_APPLICATION_CREDENTIALS_JSON: '{"x":1}' });
    expect(opts.uidSecret).toBeNull();
  });
});

describe('assertProdGate', () => {
  test('refuses the prod project without the acknowledgement flag', () => {
    expect(() => assertProdGate({ projectId: 'live', prodProject: 'live', prodAcknowledged: false }))
      .toThrow(/--i-know-this-is-prod/);
  });

  test('allows the prod project with the flag', () => {
    expect(() => assertProdGate({ projectId: 'live', prodProject: 'live', prodAcknowledged: true })).not.toThrow();
  });

  test('allows any non-prod project', () => {
    expect(() => assertProdGate({ projectId: 'demo', prodProject: 'live', prodAcknowledged: false })).not.toThrow();
  });
});

describe('requireConfirm', () => {
  test('rejects a body whose typed uid does not match', () => {
    expect(() => requireConfirm({ confirmUid: 'wrong', nonce: 'n1' }, 'right', 'n1')).toThrow(/confirm/i);
  });

  test('rejects a stale nonce', () => {
    expect(() => requireConfirm({ confirmUid: 'right', nonce: 'old' }, 'right', 'n1')).toThrow(/nonce/i);
  });

  test('accepts a matching uid and nonce', () => {
    expect(() => requireConfirm({ confirmUid: 'right', nonce: 'n1' }, 'right', 'n1')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /home/user/on/functions && npm test -- --testPathPatterns ops-server`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `server.js`**

Bind `127.0.0.1` explicitly. Routes: `GET /` (page), `GET /api/snapshot`, `GET /api/detail?uid=`, `GET /api/integrity`, `POST /api/merge/preview`, `POST /api/merge/execute`, `POST /api/purge/preview`, `POST /api/purge/execute`, `POST /api/link/impact`. Every execute route: `requireConfirm` → `capturePreImage` → apply → `writeAuditRecord`.

```javascript
#!/usr/bin/env node
// functions/ops/server.js — local operator panel. Binds 127.0.0.1 ONLY: the
// service-account credential is in-process, so anything reachable off-box is a
// full-database compromise.
//
// Usage: cd functions && node ops/server.js --project <id> [--port 8787]
//   GOOGLE_APPLICATION_CREDENTIALS_JSON = service-account JSON (required)
//   TELEGRAM_UID_SECRET                 = enables exact provenance
//   --prod-project <id> --i-know-this-is-prod   to point at production
import { createServer } from 'node:http';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The ambient process shim types only .env (types/app.d.ts); this Node CLI
// also needs argv/exit, so view the global through a locally-typed alias.
const proc = /** @type {{ argv: string[]; env: Record<string, string | undefined>; exit: (code?: number) => never }} */ (
  /** @type {unknown} */ (process)
);

const DEFAULT_PORT = 8787;
const DEFAULT_REGION = 'europe-west1';

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 */
export function parseArgs(argv, env) {
  /** @param {string} name */
  const val = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

  const projectId = val('--project') || env.GCLOUD_PROJECT;
  if (!projectId) throw new Error('Pass --project <firebase-project-id>');

  const saJson = env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!saJson) throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS_JSON to the service-account JSON');

  const region = val('--region') || env.FUNCTIONS_REGION || DEFAULT_REGION;
  const databaseURL = val('--database-url') || env.DATABASE_URL
    || (region === 'us-central1'
      ? `https://${projectId}-default-rtdb.firebaseio.com`
      : `https://${projectId}-default-rtdb.${region}.firebasedatabase.app`);

  return {
    projectId,
    saJson,
    region,
    databaseURL,
    port: Number(val('--port') || DEFAULT_PORT),
    prodProject: val('--prod-project') || env.PROD_PROJECT || null,
    prodAcknowledged: argv.includes('--i-know-this-is-prod'),
    uidSecret: env.TELEGRAM_UID_SECRET || null,
    auditDir: val('--audit-dir') || '.ops-audit',
  };
}

/** @param {{ projectId: string, prodProject: string | null, prodAcknowledged: boolean }} opts */
export function assertProdGate(opts) {
  if (opts.prodProject && opts.projectId === opts.prodProject && !opts.prodAcknowledged) {
    throw new Error(`${opts.projectId} is the production project — re-run with --i-know-this-is-prod if that is deliberate`);
  }
}

/**
 * @param {{ confirmUid?: unknown, nonce?: unknown }} body
 * @param {string} expectedUid
 * @param {string} expectedNonce
 */
export function requireConfirm(body, expectedUid, expectedNonce) {
  if (body?.confirmUid !== expectedUid) throw new Error('confirm failed: the typed uid does not match');
  if (body?.nonce !== expectedNonce) throw new Error('nonce failed: this preview is stale — refresh and try again');
}
```

Then the wiring. Append to `server.js`:

```javascript
const HERE = dirname(fileURLToPath(import.meta.url));

/** Nonces issued by a detail/preview response, consumed by the matching execute. */
const nonces = new Map();
let nonceSeq = 0;
/** @param {string} uid */
function issueNonce(uid) {
  nonceSeq += 1;
  const nonce = `n${nonceSeq}-${uid}`;
  nonces.set(uid, nonce);
  return nonce;
}

/**
 * @param {{ deps: any, io: any, opts: ReturnType<typeof parseArgs>, auth: any }} ctx
 */
export function createRoutes(ctx) {
  const { deps, io, opts } = ctx;
  /** @type {import('./types.js').Snapshot | null} */
  let cached = null;
  const refresh = async () => { cached = await readSnapshot(deps, io); return cached; };
  const current = async () => cached || refresh();

  /**
   * Capture the pre-image, apply, then record the audit line. Any throw is
   * recorded as a failed outcome — an audit trail that only logs successes is
   * not an audit trail.
   * @param {string} op @param {string[]} uids @param {import('./types.js').WritePlan} plan
   * @param {(plan: import('./types.js').WritePlan) => Promise<void>} apply
   */
  async function execute(op, uids, plan, apply) {
    const paths = Object.keys(plan.writes);
    const preImage = await capturePreImage(deps, paths);
    const ts = deps.now();
    try {
      await apply(plan);
      writeAuditRecord(fs, opts.auditDir, { ts, op, project: opts.projectId, uids, preImage, outcome: 'ok' });
    } catch (e) {
      writeAuditRecord(fs, opts.auditDir, { ts, op, project: opts.projectId, uids, preImage, outcome: `failed: ${String(e)}` });
      throw e;
    }
    cached = null; // force a fresh read after any mutation
    return { ok: true, paths: paths.length };
  }

  return {
    'GET /api/snapshot': async () => {
      const snap = await refresh();
      return { takenAt: snap.takenAt, project: opts.projectId, isProd: opts.projectId === opts.prodProject, rows: buildRows(snap, opts.uidSecret) };
    },
    'GET /api/detail': async (/** @type {URLSearchParams} */ query) => {
      const uid = String(query.get('uid'));
      const detail = buildDetail(await current(), uid, opts.uidSecret);
      if (!detail) throw new Error(`no account at users/${uid}`);
      return { detail, nonce: issueNonce(uid) };
    },
    'GET /api/integrity': async () => ({ findings: runChecks(await current()) }),

    'POST /api/merge/preview': async (/** @type {any} */ body) => {
      const snap = await current();
      const plan = await buildMergePlan(deps, {
        loserUid: body.loserUid,
        survivorUid: body.survivorUid,
        adoptGroupNames: body.adoptGroupNames || [],
        telegramRepoint: Boolean(body.telegramRepoint),
        canvasKeys: snap.canvasKeys,
        now: deps.now(),
      });
      return { plan, nonce: issueNonce(body.loserUid) };
    },
    'POST /api/merge/execute': async (/** @type {any} */ body) => {
      requireConfirm(body, body.loserUid, nonces.get(body.loserUid));
      const snap = await current();
      const plan = await buildMergePlan(deps, {
        loserUid: body.loserUid,
        survivorUid: body.survivorUid,
        adoptGroupNames: body.adoptGroupNames || [],
        telegramRepoint: Boolean(body.telegramRepoint),
        canvasKeys: snap.canvasKeys,
        now: deps.now(),
      });
      return execute('merge', [body.loserUid, body.survivorUid], plan, (p) => applyMergePlan(deps, p));
    },

    'POST /api/purge/preview': async (/** @type {any} */ body) => ({
      plan: await buildPurgePlan(deps, body.uid),
      nonce: issueNonce(body.uid),
    }),
    'POST /api/purge/execute': async (/** @type {any} */ body) => {
      requireConfirm(body, body.uid, nonces.get(body.uid));
      const plan = await buildPurgePlan(deps, body.uid);
      return execute('purge', [body.uid], plan, (p) => applyPurgePlan(deps, p));
    },

    'POST /api/link/impact': async (/** @type {any} */ body) => {
      const snap = await current();
      return buildLinkImpact(deps, body.derivedUid, snap.canvasKeys);
    },
    'POST /api/link/production': async (/** @type {any} */ body) => {
      requireConfirm(body, body.derivedUid, nonces.get(body.derivedUid));
      const plan = await buildProductionLinkPlan(deps, { derivedUid: body.derivedUid, phraseUid: body.phraseUid, now: deps.now() });
      return execute('link-production', [body.derivedUid, body.phraseUid], plan, (p) => applyPurgePlan(deps, p));
    },
  };
}

async function main() {
  const opts = parseArgs(proc.argv.slice(2), proc.env);
  assertProdGate(opts);
  const { deps, io, auth } = makeOpsDeps(opts);
  const routes = createRoutes({ deps, io, opts, auth });
  const page = fs.readFileSync(join(HERE, 'panel.html'), 'utf8');

  createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const key = `${req.method} ${url.pathname}`;
    /** @param {number} code @param {string} type @param {string} body */
    const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };

    if (key === 'GET /') return send(200, 'text/html; charset=utf-8', page);
    const handler = routes[key];
    if (!handler) return send(404, 'text/plain', 'not found');

    /** @param {unknown} payload */
    const ok = (payload) => send(200, 'application/json', JSON.stringify(payload));
    /** @param {unknown} e */
    const fail = (e) => send(400, 'application/json', JSON.stringify({ error: String(e) }));

    if (req.method === 'GET') return Promise.resolve(handler(url.searchParams)).then(ok).catch(fail);

    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => Promise.resolve(handler(JSON.parse(raw || '{}'))).then(ok).catch(fail));
    return undefined;
  // 127.0.0.1 ONLY — this process holds a service-account credential.
  }).listen(opts.port, '127.0.0.1', () => {
    console.log(`ops panel: http://127.0.0.1:${opts.port}  project=${opts.projectId}`);
    if (opts.projectId === opts.prodProject) console.log('*** PRODUCTION ***');
    if (!opts.uidSecret) console.log('TELEGRAM_UID_SECRET unset — provenance will read "unknown"');
  });
}

// Only run when invoked directly, so the test can import the pure helpers.
if (proc.argv[1] && proc.argv[1].endsWith('ops/server.js')) main();
```

Add the matching imports at the top of the file: `makeOpsDeps` from `./deps.js`, `readSnapshot` from `./snapshot.js`, `buildRows`/`buildDetail` from `./project.js`, `runChecks` from `./integrity.js`, `buildMergePlan`/`applyMergePlan` from `./merge.js`, `buildPurgePlan`/`applyPurgePlan`/`buildLinkImpact`/`buildProductionLinkPlan` from `./purge.js`, and `capturePreImage`/`writeAuditRecord` from `./audit.js`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /home/user/on/functions && npm test -- --testPathPatterns ops-server`
Expected: PASS (13 tests).

- [ ] **Step 5: Write `panel.html`**

One page, no framework, no build. Deliberately unstyled beyond legibility — this is a tool, not a product surface, and it must not borrow the app's CSS.

```html
<!doctype html>
<meta charset="utf-8">
<title>KnockKnock ops</title>
<style>
  body { font: 13px/1.4 ui-monospace, Menlo, monospace; margin: 0; padding: 1rem; }
  #prod { display: none; background: #b00; color: #fff; padding: .5rem; font-weight: bold; }
  #prod.on { display: block; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border-bottom: 1px solid #ccc; padding: .25rem .4rem; text-align: left; white-space: nowrap; }
  th { cursor: pointer; user-select: none; }
  tbody tr:hover { background: #f3f3f3; cursor: pointer; }
  .badge { padding: 0 .3rem; border: 1px solid #999; border-radius: 3px; font-size: 11px; }
  .inexact { opacity: .6; font-style: italic; }
  #detail, #integrity { margin-top: 1rem; }
  .error { color: #b00; } .warn { color: #a60; } .info { color: #555; }
  dialog { max-width: 46rem; font: inherit; }
  pre { white-space: pre-wrap; max-height: 18rem; overflow: auto; background: #f6f6f6; padding: .5rem; }
</style>

<div id="prod">PRODUCTION — every action here is irreversible</div>
<header>
  <strong id="project"></strong>
  <button id="refresh">refresh</button>
  <span id="takenAt"></span>
  <input id="filter" placeholder="filter uid / code">
  <button id="tab-users">users</button><button id="tab-integrity">integrity</button>
</header>

<div id="users">
  <table><thead><tr>
    <th data-k="uid">uid</th><th data-k="code">code</th><th data-k="provenance">origin</th>
    <th data-k="createdAt">created</th><th data-k="lastSeen">last active</th><th data-k="status">status</th>
    <th data-k="contacts">contacts</th><th data-k="groupCount">groups</th><th data-k="canvasCount">canvas</th>
    <th data-k="pushTokenCount">tokens</th><th data-k="notifyChannel">channel</th><th data-k="locationOptIn">loc</th>
  </tr></thead><tbody id="rows"></tbody></table>
  <div id="detail"></div>
</div>
<div id="integrity" hidden></div>

<dialog id="preview"><form method="dialog">
  <div id="preview-body"></div>
  <label>type the uid to confirm: <input id="confirm-uid"></label>
  <button id="go" value="go">execute</button><button value="cancel">cancel</button>
</form></dialog>

<script>
const $ = (id) => document.getElementById(id);
const api = async (path, body) => {
  const res = await fetch(path, body ? { method: 'POST', body: JSON.stringify(body) } : undefined);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
};
let state = { rows: [], sort: 'lastSeen', dir: -1, nonce: null, uid: null };
const ago = (t) => (t == null ? '—' : `${Math.round((Date.now() - t) / 60000)}m ago`);

function render() {
  const q = $('filter').value.toLowerCase();
  const rows = state.rows
    .filter((r) => !q || r.uid.toLowerCase().includes(q) || (r.code || '').toLowerCase().includes(q))
    .sort((a, b) => ((a[state.sort] ?? -Infinity) < (b[state.sort] ?? -Infinity) ? 1 : -1) * state.dir);
  $('rows').innerHTML = rows.map((r) => `<tr data-uid="${r.uid}">
    <td>${r.uid.slice(0, 10)}…</td><td>${r.code || '—'}</td>
    <td><span class="badge ${r.provenance.exact ? '' : 'inexact'}">${r.provenance.kind}</span></td>
    <td>${ago(r.createdAt)}</td><td>${ago(r.lastSeen)}</td><td>${r.status || '—'}</td>
    <td>${r.contacts}</td><td>${r.groupCount}</td><td>${r.canvasCount ? 'yes' : '—'}</td>
    <td>${r.pushTokenCount}</td><td>${r.notifyChannel || '—'}</td><td>${r.locationOptIn ? 'on' : '—'}</td>
  </tr>`).join('');
}

async function refresh() {
  const snap = await api('/api/snapshot');
  state.rows = snap.rows;
  $('project').textContent = snap.project;
  $('takenAt').textContent = `snapshot ${new Date(snap.takenAt).toLocaleTimeString()}`;
  $('prod').className = snap.isProd ? 'on' : '';
  render();
}

async function openDetail(uid) {
  const { detail, nonce } = await api(`/api/detail?uid=${encodeURIComponent(uid)}`);
  state = { ...state, nonce, uid };
  $('detail').innerHTML = `<h3>${uid}</h3>
    <p>followers ${detail.followers.length} · following ${detail.following.length} · mutuals ${detail.mutuals.length}</p>
    <table><tr><th>group</th><th>name in group</th><th>role</th><th>owner</th><th>override</th></tr>
    ${detail.groups.map((g) => `<tr><td>${g.name || g.gid}</td><td>${g.displayName || '—'}</td><td>${g.role || '—'}</td><td>${g.isOwner ? 'yes' : '—'}</td><td>${g.hasStatusOverride ? 'yes' : '—'}</td></tr>`).join('')}</table>
    <p>canvases: ${detail.canvases.map((c) => c.peer).join(', ') || 'none'}</p>
    <p>tokens: ${detail.pushTokens.map((t) => `${t.token.slice(0, 8)}… ${ago(t.lastSeen)}`).join(' · ') || 'none'} · channel ${detail.notifyChannel || '—'}</p>
    <p>location: ${detail.location.hasPoint ? `point ${Math.round(detail.location.fixAge / 1000)}s old` : 'off'}${detail.location.cells.map((c) => ` · ${c.gid} ${Math.round(c.fixAge / 1000)}s`).join('')}</p>
    <p>telegram: ${detail.telegram ? `tgId ${detail.telegram.tgId}` : 'none'}</p>
    <button data-act="purge">purge…</button>
    <button data-act="merge">merge into…</button>
    <button data-act="impact">link impact</button>
    <button data-act="link-merge">link via merge…</button>
    <button data-act="link-prod">link as production…</button>`;
}

function preview(bodyHtml, onGo) {
  $('preview-body').innerHTML = bodyHtml;
  $('confirm-uid').value = '';
  $('preview').returnValue = '';
  $('preview').showModal();
  $('preview').onclose = () => { if ($('preview').returnValue === 'go') onGo($('confirm-uid').value); };
}

$('refresh').onclick = refresh;
$('filter').oninput = render;
$('rows').onclick = (e) => { const tr = e.target.closest('tr'); if (tr) openDetail(tr.dataset.uid); };
document.querySelectorAll('th[data-k]').forEach((th) => {
  th.onclick = () => { state.dir = state.sort === th.dataset.k ? -state.dir : -1; state.sort = th.dataset.k; render(); };
});
$('tab-users').onclick = () => { $('users').hidden = false; $('integrity').hidden = true; };
$('tab-integrity').onclick = async () => {
  const { findings } = await api('/api/integrity');
  $('integrity').innerHTML = findings.length
    ? findings.map((f) => `<div class="${f.severity}">${f.severity} · ${f.check} · ${f.path || f.uid || ''} — ${f.detail}</div>`).join('')
    : '<p>no findings</p>';
  $('users').hidden = true; $('integrity').hidden = false;
};

$('detail').onclick = async (e) => {
  const act = e.target.dataset?.act;
  if (!act) return;
  const uid = state.uid;
  if (act === 'purge') {
    const { plan, nonce } = await api('/api/purge/preview', { uid });
    state.nonce = nonce;
    preview(`<h3>purge ${uid}</h3><pre>${plan.losses.join('\n') || 'nothing of value'}</pre>
      <p>${Object.keys(plan.writes).length} paths</p>`,
    async (confirmUid) => {
      await api('/api/purge/execute', { uid, confirmUid, nonce: state.nonce });
      await refresh();
    });
  }
  if (act === 'merge') {
    const survivorUid = prompt('survivor uid (the account that SURVIVES)');
    if (!survivorUid) return;
    const { plan, nonce } = await api('/api/merge/preview', { loserUid: uid, survivorUid });
    state.nonce = nonce;
    preview(`<h3>merge ${uid} → ${survivorUid}</h3>
      <pre>${plan.conflicts.map((c) => `${c.kind}: ${c.detail} → ${c.resolution}`).join('\n') || 'no conflicts'}</pre>
      <pre>${plan.losses.join('\n')}</pre><p>${Object.keys(plan.writes).length} paths</p>`,
    async (confirmUid) => {
      await api('/api/merge/execute', { loserUid: uid, survivorUid, confirmUid, nonce: state.nonce });
      await refresh();
    });
  }
  if (act === 'impact') {
    const impact = await api('/api/link/impact', { derivedUid: uid });
    alert(`${impact.verdict.toUpperCase()}\n\nlosses:\n${impact.losses.join('\n') || 'none'}\n\nkept:\n${impact.keeps.join('\n') || 'none'}`);
  }
  // Link via merge: the non-lossy link. Same merge path, plus the mapping
  // repoint — contacts, groups, per-group names and canvases all transfer.
  if (act === 'link-merge') {
    const survivorUid = prompt('phrase-account uid to link this Telegram to (it SURVIVES)');
    if (!survivorUid) return;
    const { plan, nonce } = await api('/api/merge/preview', { loserUid: uid, survivorUid, telegramRepoint: true });
    state.nonce = nonce;
    preview(`<h3>link ${uid} → ${survivorUid} via merge (nothing is lost)</h3>
      <pre>${plan.conflicts.map((c) => `${c.kind}: ${c.detail} → ${c.resolution}`).join('\n') || 'no conflicts'}</pre>
      <p>${Object.keys(plan.writes).length} paths</p>`,
    async (confirmUid) => {
      await api('/api/merge/execute', { loserUid: uid, survivorUid, telegramRepoint: true, confirmUid, nonce: state.nonce });
      await refresh();
    });
  }
  // Link as production does: expunge-then-link. Only for a 'safe' impact
  // verdict — this DESTROYS the derived account exactly as performLink would.
  if (act === 'link-prod') {
    const phraseUid = prompt('phrase-account uid to link this Telegram to');
    if (!phraseUid) return;
    const impact = await api('/api/link/impact', { derivedUid: uid });
    preview(`<h3>link as production: ${uid} is DESTROYED</h3>
      <p>verdict: <strong>${impact.verdict}</strong></p>
      <pre>${impact.losses.join('\n') || 'nothing of value'}</pre>`,
    async (confirmUid) => {
      await api('/api/link/production', { derivedUid: uid, phraseUid, confirmUid, nonce: state.nonce });
      await refresh();
    });
  }
};

refresh();
</script>
```

- [ ] **Step 6: Write `functions/ops/README.md`**

Cover: the exact invocation, the two required env vars and what degrades without `TELEGRAM_UID_SECRET`, the prod gate flags, where audit files land and how to read a pre-image back, and one line per action stating what it destroys. State plainly that **link-via-merge is the non-lossy option** and production's own link path is not.

- [ ] **Step 7: Manual smoke against the dev project**

Record the result in the commit body. This is the only verification the server and page get.

```bash
cd /home/user/on/functions
GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat ~/sa-dev.json)" \
TELEGRAM_UID_SECRET="<dev secret>" \
node ops/server.js --project <dev-project> --port 8787
```

Check, in order: the table lists every account with a provenance badge; a detail pane shows groups with per-group `displayName`; the integrity tab renders; a merge **preview** on two disposable dev accounts lists conflicts and does not mutate; execute performs the merge and writes a pre-image file; a purge preview names the owned-group deletion.

- [ ] **Step 8: Full gates and commit**

```bash
cd /home/user/on/functions && npm test
cd /home/user/on && npx jest --maxWorkers=2
npm run typecheck && npm run typecheck:scripts
node scripts/prod.js
git add functions/ops/server.js functions/ops/panel.html functions/ops/README.md functions/test/ops-server.test.js
git commit -m "feat(ops): panel server, page and runbook

Binds 127.0.0.1 only. Prod requires --i-know-this-is-prod plus a typed-uid
confirm and a per-preview nonce on every destructive route; each mutation
captures a pre-image before applying. Argv parsing, the prod gate and the
confirm check are unit-tested; the HTTP wiring and page were smoked against
the dev project."
```

---

### Task 11: Documentation

**Files:**
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Add the landmines**

Under **Landmines**, add:

- **`hosting.ignore` must keep `functions/**`.** Hosting is `"public": "."`; without the entry the deployed site serves Cloud Functions source as static files (confirmed live, 2026-08-01). Pinned by `tests/firebaseConfig.test.js`.
- **`functions.ignore` must re-list the CLI defaults.** Specifying `ignore` *replaces* `node_modules`, `.git`, `firebase-debug.log`, `firebase-debug.*.log` — dropping them balloons the deploy archive.
- **Merge/expunge/graduation share one residue enumerator** (`crossRefRenderers` in `functions/telegram-auth.js`). A new residue family must be added there, not in a consumer. Pinned by the parity test in `functions/test/ops-merge.test.js`.
- **The ops panel binds `127.0.0.1`.** It holds a service-account credential in-process; never bind it to `0.0.0.0` or put it behind a tunnel.
- **Graduated-vs-linked provenance is a heuristic** (`prefsLinkedAt < mappingLinkedAt`) and reads "linked" for a graduated account that later re-links.

- [ ] **Step 2: Update Where things stand and Verification state**

Record the new test counts from Task 10's full run, and note that the panel is local-only and never deployed.

- [ ] **Step 3: Commit**

```bash
cd /home/user/on
git add docs/HANDOFF.md
git commit -m "docs(handoff): record the ops panel and its landmines"
```

---

## Deviations from the spec

Recorded here so a reviewer can check them deliberately rather than discover them:

1. **`merge.js` and `purge.js` read through `deps`, not from a cached snapshot** (spec §4 described them as pure functions of a `Snapshot`). A destructive write must not be planned against state that may be minutes old, and reading through `deps` means `makeStoreDeps` certifies the write-set is free of ancestor-overlapping paths the same way it certifies the shipped handlers. `provenance`, `project` and `integrity` remain pure over the snapshot exactly as specified.
2. **`expungeDerivedAccount` is split into `buildExpungeWrites` + apply** (Task 6). The spec assumed purge could preview by inspection; it cannot, because the function applies internally. The split is behavior-preserving and pinned by the existing `telegram-auth` suite.
3. **D5's Auth-record deletion is not implemented in these tasks.** The spec marks the underlying behavior UNVERIFIED. Verify against dev first (`admin.auth().deleteUser(uid)` on a disposable account, then sign in with that phrase and confirm the account re-mints), then add the checkbox as a follow-up. Building it before verifying would ship an unproven destructive option.
