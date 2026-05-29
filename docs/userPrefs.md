# userPrefs — cross-device sync of private user state

This document covers the `userPrefs/{uid}/` Firebase RTDB subtree: what it is, what lives in it, when to use it, how to add a new pref, and how it differs from the older `users/{uid}/` subtree.

> **Status:** introduced in `claude/wonderful-heisenberg-fRek8` (commits `55815d4` → `08c739f`). Wipe-friendly migration — no forward path from old `users/{uid}/...` paths.

---

## 1. Why it exists

The app's main per-user record is at `users/{uid}/...`. Every follower of a user subscribes to that record via `watchStatus(otherUid, cb)` so they can see status / availability / color / paletteKey / code. That subscription delivers the **entire** `users/{uid}` subtree on every change.

Before `userPrefs/`, anything we put on `users/{uid}/` was broadcast to every follower on every tick — even private state nobody else needed to read: hint flags, call counters, favorites history, the user's preferred chip default, the user's currently-active context. With ~10 followers per user that's 10× the read bandwidth on every write.

`userPrefs/{uid}/` is a sibling top-level subtree that **only the owner subscribes to**. New private state belongs here. The `users/{uid}/` subtree stays lean and broadcast-shaped.

### Decision rule

> If anyone other than the owner needs to read it, it goes in `users/{uid}/`. Otherwise it goes in `userPrefs/{uid}/`.

Examples on each side:

| `users/{uid}/` (broadcast) | `userPrefs/{uid}/` (private) |
|---|---|
| `status`, `availableUntil`, `statusColor`, `paletteKey` | hints, call counters |
| `code` (rotates; followers need new value) | favoritesCollapsed |
| `callState` (peer needs it for call mode) | paletteState (picker UI state) |
| `followers/`, `revokedFollowers/` | favorites (combo history) |
| `groups/{groupId}` (enumeration index) | lastTimeoutMinutes (chip default) |
| `invites/` (Phase 0 personal-invite collection) | currentContext (the active 'direct' or 'group:{id}') |
|   | following/ (own-side of the follow relationship) |
|   | perGroup/{groupId}/paletteState |
|   | perGroup/{groupId}/lastTimeoutMinutes |

---

## 2. Schema

```
userPrefs/{uid}:
  hints/
    bolt:        true    // statusapp_seen_bolt
    flower:      true    // statusapp_seen_flower
    theme:       true    // statusapp_seen_theme
    stripPeek:   true    // statusapp_seen_strip_peek_done
    longpress:   true    // statusapp_seen_longpress
    swipe:       true    // statusapp_seen_swipe
    customAvail: true    // statusapp_went_avail_custom

  madeCallCount:     <number>   // gates "swipe right to answer" hint at >= 4
  answeredCallCount: <number>   // gates "swipe left to hang up" hint at >= 4

  favoritesCollapsed: <bool>    // favorites strip collapsed/expanded

  paletteState/
    direct: { ... }             // Direct's swatch picker state

  favorites: [ <combo>, ... ]   // user's history of saved palette combos

  lastTimeoutMinutes: <number>  // Direct chip default (in minutes)

  currentContext: 'direct' | 'group:{groupId}'

  following/
    {followeeUid}: { code, label }

  perGroup/
    {groupId}/
      paletteState:
        activeSet: 1 | 2
        sets:
          '1': { selectedKey, selectedColor, activePaletteKey }
          '2': { selectedKey, selectedColor, activePaletteKey }
      lastTimeoutMinutes: <number>   // per-group chip default
```

### Schema notes

- **Hint keys** are short names (`bolt`, `flower`, `theme`, …). The localStorage keys keep their legacy `statusapp_seen_*` shape so any inline `localStorage.getItem('statusapp_seen_bolt')` reads scattered through the codebase keep working. The mapping lives in `HINT_KEYS` in `js/prefs.js`.
- **Counters use server-max-wins** in `syncFromServer` — both devices may have incremented locally, so the larger value wins.
- **Per-group palette state defaults** to set 1 = forest / `#22c55e`, set 2 = volt / `#aaff00`. Defaults live in `DEFAULT_GROUP_PALETTE_STATE` in `js/prefs.js`.
- **`paletteState/direct/`** vs **`perGroup/{groupId}/paletteState`**: parallel shapes. Direct's lives at top level (legacy reason — was already there); group's is nested under `perGroup` so adding a new per-group pref doesn't require schema work.
- **`favorites`** is written as a plain JavaScript array. RTDB serializes empty/sparse arrays back as keyed objects, so `syncFromServer` normalizes via `Array.isArray() ? : Object.values()`.

---

## 3. How writes work

A write goes through `js/prefs.js`, which does two things every time:

1. Updates **localStorage** synchronously so same-tab reads see the new value immediately.
2. Calls **`mergeUserPrefs(uid, fields)`** to write to `userPrefs/{uid}/...` in Firebase.

`mergeUserPrefs` (in `js/db.js`) is a thin wrapper over RTDB's multi-path `update()`:

```js
export async function mergeUserPrefs(userId, fields) {
  await update(ref(db, `userPrefs/${userId}`), fields);
}
```

`fields` is a flat object keyed by slash-separated paths relative to `userPrefs/{uid}`, e.g.:

```js
mergeUserPrefs(uid, {
  'hints/bolt':              true,
  'lastTimeoutMinutes':      30,
  'perGroup/abc123/paletteState': { activeSet: 1, sets: { ... } },
});
```

RTDB's `update()` applies each leaf atomically, so a multi-pref batch is a single network op.

Writes are **fire-and-forget**: every setter does `mergeUserPrefs(...).catch(() => {})`. If the network is down the localStorage cache still reflects the user's intent and the next successful write batches naturally on top.

---

## 4. How reads work

Reads from consumer code stay synchronous against **localStorage**:

```js
// In some UI module:
import { isHintSeen, getLastTimeout, getFavorites } from './prefs.js';

if (!isHintSeen('bolt')) { showBoltHint(); }
const minutes = getLastTimeout();
```

The localStorage cache is kept fresh by `prefs.syncFromServer(serverPrefs)`, called from `app.js`'s `watchUserPrefs` subscription on every server change. So the read path stays cheap and synchronous; freshness is the responsibility of the subscription.

`getUserPrefs(uid)` (also in `db.js`) is a **one-shot** read of the entire subtree. The boot path uses it to pre-resolve `currentContext` before any UI paints, so a returning group-context user doesn't see a Direct flash before `watchUserPrefs` catches up.

---

## 5. Cross-device sync (the full path)

```
device A: user clicks bolt-hint dismiss
   → prefs.markHintSeen('bolt')
   → localStorage.setItem('statusapp_seen_bolt', '1')
   → mergeUserPrefs(uid, { 'hints/bolt': true })
   → RTDB: userPrefs/{uid}/hints/bolt = true

device B: watchUserPrefs callback fires
   → prefs.syncFromServer(serverPrefs)
   → localStorage.setItem('statusapp_seen_bolt', '1')
   → (no event dispatched for hints — read is synchronous)
```

For surfaces where the UI needs to re-render on a sync (e.g. the favorites strip, the swatch picker), `syncFromServer` dispatches a `CustomEvent` on `document`. Modules subscribe to those events instead of being imported by `prefs.js` (avoids circular imports).

| Event | Dispatched when | Listened to in |
|---|---|---|
| `palette-state-synced` | Direct paletteState changes on server | `js/palettes.js` (re-renders swatch row) |
| `group-palette-state-synced` (detail: `{ groupId }`) | Per-group paletteState changes | `js/groupContext.js` |
| `favorites-synced` | favorites array changes | `js/favorites.js` |
| `last-timeout-synced` (detail: `{ minutes }`) | Direct chip default changes | `js/me.js` |
| `group-chip-minutes-synced` (detail: `{ groupId, minutes }`) | Per-group chip default changes | `js/groupContext.js` |
| `current-context-synced` (detail: `{ currentContext }`) | Active context changes | `js/app.js` (forwards into `groupNav`) |

`syncFromServer` is **server-wins on conflict** for most fields (favorites, palette state, currentContext) and **server-max-wins** for counters. Hints are write-once-true so there's no conflict to resolve.

---

## 6. Wiring in `app.js`

Boot order:

```js
import { initPrefs, syncFromServer as syncPrefsFromServer } from './prefs.js';
import { watchUserPrefs, getUserPrefs } from './db.js';

// ... identity established, userId resolved ...

initPrefs(userId);                          // makes prefs module aware of writer

watchUserPrefs(userId, (serverPrefs) => {
  syncPrefsFromServer(serverPrefs);
});

document.addEventListener('current-context-synced', (e) => {
  applyServerCurrentContext(e.detail?.currentContext || 'direct');
});
```

The one-shot `getUserPrefs(userId)` is also called earlier in the boot flow so `currentContext` is resolved before nav and group context modules initialize.

---

## 7. Cookbook — adding a new pref

Say you want to sync the user's preferred dark/light theme.

**1. Pick a localStorage key.** Use a stable prefix; existing prefs use `statusapp_*` (legacy keys) or just descriptive ones (`favorites`, `paletteState`).

**2. Decide where the localStorage layer lives.** Two options:
- For state already owned by `js/store.js` (favorites, palette state, chip minutes), add the getter/setter there and re-export from `prefs.js`.
- For new state, add the getter/setter directly in `prefs.js` (see hints + counters + favoritesCollapsed for the pattern).

**3. Add getter/setter in `js/prefs.js`:**

```js
const THEME_LS = 'statusapp_theme_pref';

export function getThemePref() {
  return localStorage.getItem(THEME_LS) || 'auto';
}

export function setThemePref(value) {
  if (localStorage.getItem(THEME_LS) === value) return; // idempotent
  localStorage.setItem(THEME_LS, value);
  if (_myUserId) mergeUserPrefs(_myUserId, { themePref: value }).catch(() => {});
}
```

**4. Handle it in `syncFromServer`:**

```js
if (typeof serverPrefs.themePref === 'string') {
  localStorage.setItem(THEME_LS, serverPrefs.themePref);
  document.dispatchEvent(new CustomEvent('theme-pref-synced', {
    detail: { value: serverPrefs.themePref },
  }));
}
```

The event is only needed if some module's UI must re-render on sync. For "next read picks it up" cases (like hints, where the next time a hint check happens it just reads the new value), skip the event.

**5. Consume in the owning module:** import `getThemePref`/`setThemePref` from `./prefs.js`. If you dispatched a sync event, add a `document.addEventListener('theme-pref-synced', ...)` in the owning module's init.

**6. If you added a new `db.js` export** (e.g. a new lookup helper): add a `jest.fn()` stub to all 5 db-mocking test files (`tests/favorites.test.js`, `tests/following.test.js`, `tests/me.test.js`, `tests/mycode.test.js`, `tests/recovery.test.js`). Missing entries cause `(0, _db.foo) is not a function` failures.

**7. Add coverage in `tests/prefs.test.js`** for the getter/setter and for the `syncFromServer` branch.

---

## 8. Migration model

The `userPrefs/{uid}/` migration was **wipe-friendly**: no forward migration path from the old `users/{uid}/...` paths. Existing data at the old paths is abandoned, not moved.

When this branch first reached dev, **the dev RTDB was wiped from scratch** so users didn't see stale data shadowing the new paths. After the wipe, every device's localStorage cache pushed up to the new path naturally on first write.

If you make a similar schema move in the future, consider:

- **Wipe-friendly is cheapest.** Only viable when (a) the data is non-critical (hints, favorites, picker state — all easy to lose) and (b) you can coordinate a wipe with the deploy.
- **Push-up-on-empty-server.** What `following.js` already does for its own list: if local has entries and server is empty, write them up. Works without a migration script but only for path moves where the schema shape is unchanged.
- **Migration script + dual-write.** What we'd need if userPrefs had to preserve real data — left as future work; not warranted yet.

---

## 9. Security rules

The current dev/prod rule (added in `b61160b` after the migration first hit `permission_denied`):

```json
"userPrefs": {
  "$userId": {
    ".read": true,
    ".write": true
  }
}
```

This matches the honor-system trust model already in place for `users/{uid}/` and other namespaces. Phase B (identity tightening via Firebase Anonymous Auth) will tighten this to:

```json
"userPrefs": {
  "$userId": {
    ".read":  "auth.uid === $userId",
    ".write": "auth.uid === $userId"
  }
}
```

This is **strictly stricter** than the Phase B `users/{uid}/` rules (which still need to allow followers to read), so the Phase B port is one-line and forward-compatible.

---

## 10. What's NOT in userPrefs (and why)

Some "preferences-shaped" state lives elsewhere on purpose:

- **`statusColor`, `paletteKey`, `availableUntil`, `status`, `code`, `callState`** — all in `users/{uid}/`. Followers need them.
- **`followers/`, `revokedFollowers/`** — in `users/{uid}/`. Other users write to your followers list when they follow you.
- **`groups/{groupId}` enumeration index** — in `users/{uid}/groups/`. Kept there for v1 forward-compat with future rule strictness (one-write-self pattern).
- **Per-group `statusOverride`** — at `groups/{groupId}/members/{uid}/statusOverride`. Other group members read it. Phase 2 schema slot, may add `statusColor`/`paletteKey` slots in Phase 4+.

If you find yourself wanting to put follower-readable state in `userPrefs/`, that's a smell — it means somewhere downstream a peer is going to need a second subscription. Put it in `users/{uid}/` instead.

---

## 11. Files at a glance

| File | Role |
|---|---|
| `js/db.js` | `watchUserPrefs`, `getUserPrefs`, `mergeUserPrefs`, plus the following-list paths now under `userPrefs/{uid}/following/`. |
| `js/prefs.js` | The central preferences store. Getters, setters, `syncFromServer`. |
| `js/store.js` | localStorage-layer helpers for state that's also surfaced via `prefs.js` (favorites, palette state, chip minutes). |
| `js/app.js` | Boot wiring: `initPrefs`, `watchUserPrefs`, `current-context-synced` listener. |
| `js/me.js`, `js/groupContext.js`, `js/favorites.js`, `js/palettes.js`, `js/groupNav.js` | Consumers — import getters/setters from `prefs.js`, subscribe to sync events. |
| `tests/prefs.test.js` | Coverage for getters/setters + `syncFromServer` branches. |
| `database.rules.json` | `userPrefs` namespace rule. |
