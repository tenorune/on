# User feature toggles (experimental) — design

**Date:** 2026-06-14
**Status:** approved, pre-implementation
**Branch:** `user-feature-toggles` (off `dev`)

## Summary

Let a user switch off whole features for their own account, turning the
build-time feature flags in `js/features.js` into **per-user runtime
overrides**. First cut exposes two switches:

- **Palettes** — bundles `PALETTES_ENABLED` + `PALETTE_INTERACTIONS_ENABLED`
  (interactions already require palettes).
- **Groups** — `GROUPS_ENABLED`.

Toggles are **client-side only** (they change *the user's own* UI), **sync
across devices**, and **apply on reload** (model A). The toggle UI lives in
the existing header `#code-drawer` and is **gated behind a `?features` query
param** while experimental.

## Decisions (locked)

1. **Client-side only.** This cut hides features in the user's own app. It
   does NOT change what other users or the server can do to them.
2. **Reload-to-apply (model A).** The existing gates fire at init time in
   `app.js` (`if (GROUPS_ENABLED) ...`). We keep that and re-read the override
   at boot; flipping a toggle reloads. No live in-place teardown.
3. **Sync via `userPrefs`.** A toggle is a user-level intent, not a
   device-level one. Reuses `prefs.js` → `mergeUserPrefs` → `syncFromServer`.
4. **Placement in the header `#code-drawer`**, visibility gated behind
   `?features` for now.
5. **Gate mechanic = eval-time effective constants (Approach 1).**
   `features.js` keeps the same export names; consumers are untouched.

## Non-goals (deferred)

- Server-enforced / privacy gates: opting out of follow requests, suppressing
  one's own activity from generating others' notifications. These need RTDB
  rules and/or Cloud Functions changes — separate spec, later phase.
- Live in-place apply (no reload).
- User-facing toggles for the other five build flags (`KNOCK_ENABLED`,
  `CALL_ENABLED`, `NOTIFICATIONS_ENABLED`, `FOLLOW_REQUESTS_ENABLED` — though
  follow-requests init is gated *under* groups below; see §5).

## 1. Data model & storage

A new private pref, **feature toggles**, default *on*.

- **localStorage** (synchronous source of truth at boot) — one JSON key:

  ```
  statusapp_feature_overrides = { "palettes": false, "groups": false }
  ```

  A field is present only when the user has changed it. **Missing field =
  enabled.** Only the literal `false` disables. Following the established
  prefs convention, the key is NOT uid-scoped; `syncFromServer` overwrites it
  for the current account.

- **userPrefs** (cross-device sync):

  ```
  userPrefs/{uid}/featureToggles/{key}: <bool>      // e.g. featureToggles/palettes: false
  ```

- **Controlled keys this cut:** `palettes`, `groups`.

## 2. Gate mechanic (Approach 1 — eval-time effective constants)

New dependency-free module **`js/featureOverrides.js`** owns the key + shape:

```js
// js/featureOverrides.js — localStorage only, no other imports.
const KEY = 'statusapp_feature_overrides';
export function readOverrides() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
  catch { return {}; }
}
export function writeOverride(key, enabled) {
  const ov = readOverrides();
  ov[key] = !!enabled;
  try { localStorage.setItem(KEY, JSON.stringify(ov)); } catch { /* quota */ }
}
```

`js/features.js` stays import-light but reads the override at module-eval and
exports the **effective** values:

```js
import { readOverrides } from './featureOverrides.js';
const ov = readOverrides();
const eff = (buildDefault, key) => buildDefault && ov[key] !== false;

export const PALETTES_ENABLED             = eff(true, 'palettes');
export const PALETTE_INTERACTIONS_ENABLED = eff(true, 'palettes');
export const KNOCK_ENABLED                = true;
export const CALL_ENABLED                 = true;
export const GROUPS_ENABLED               = eff(true, 'groups');
export const NOTIFICATIONS_ENABLED        = true;
export const FOLLOW_REQUESTS_ENABLED      = true;
export const NOTIFY_DEBUG                 = false;
```

- **No consumer edits.** Every existing `if (PALETTES_ENABLED)` /
  `if (GROUPS_ENABLED)` site now reads the effective value — reusing the exact
  gate points the features were designed around.
- A user can only **disable** a build-enabled feature, never enable a
  build-disabled one (`buildDefault &&` short-circuits).
- Evaluating once at load is correct under model A (reload-to-apply).
- Suites that `jest.mock('../js/features.js')` are unaffected — the real eval
  (and `featureOverrides.js`) never runs in those.

## 3. prefs.js sync + cross-device reload

In `js/prefs.js`:

- `getFeatureToggle(key)` → reads `readOverrides()`, returns `ov[key] !== false`
  (default `true`).
- `setFeatureToggle(key, enabled)` → `writeOverride(key, enabled)` +
  `mergeUserPrefs(_myUserId, { ['featureToggles/' + key]: !!enabled })`.
- `initPrefs(userId)` snapshots the boot override values for the controlled
  keys (`_bootToggles`).
- `syncFromServer(serverPrefs)` handles `serverPrefs.featureToggles`:
  - writes each incoming value into the localStorage overrides JSON (server
    wins, consistent with the rest of `syncFromServer`);
  - if any **controlled** key now differs from `_bootToggles`, dispatches a
    `feature-toggles-synced` CustomEvent (no UI import — the established
    cross-module re-render pattern).

Reload behavior:

- **Same-device flip:** `setFeatureToggle` → brief "Reloading…" affordance →
  `location.reload()`. The reload preserves the `?features` query string, so
  the Experimental section stays visible.
- **Cross-device flip:** `app.js` listens for `feature-toggles-synced` and
  shows a small, **dismissible** reload prompt ("Feature settings changed —
  Reload"). It does **not** auto-reload mid-use. Reuse the existing toast
  surface (`initGroupRemovalDetector` surfaces a toast) if it generalizes;
  otherwise a minimal inline banner.

## 4. UI — "Experimental" section in `#code-drawer`

- New markup in `index.template.html` inside `#code-drawer`: an **Experimental**
  group containing two labeled switches — **Palettes** and **Groups** — each
  with a one-line description of what turning it off does. Switches follow the
  existing form/label a11y convention (`<label for>` association).
- **Visibility gate:** the section renders only when the URL has the `features`
  query param (`new URLSearchParams(location.search).has('features')`). Because
  the apply-reload preserves the query string, it persists across reloads.
  Ungating later = removing the guard.
- Each switch's initial state reflects `getFeatureToggle(key)`. On change →
  `setFeatureToggle(key, enabled)` → reload (§3).

A new module (e.g. `js/featureSettings.js`) owns rendering + wiring the section;
`app.js` calls its init once near the other drawer inits (`initCodeDrawer`).

## 5. Closing the groups handler-gating gap

`GROUPS_ENABLED` today only gates the **render** layer (inside `groupNav.js` /
`groupContext.js`). These `app.js` inits run **unconditionally**:

`initNav`, `initNavRow`, `startCardsRowSubscriptions`,
`initGroupRemovalDetector`, `initInbox`, `initFollowGrants`.

Wrap them behind `GROUPS_ENABLED` so "groups off" stops the subscriptions, not
just the rendering (the handoff's "render-gate must match handler-gate"
lesson). `initFollowGrants` is included because request-to-follow is a
co-member (groups §11) affordance reachable only from group context.

**Audit task (groups off):** confirm the cards row, the nav row's group
affordances, group context, the Inbox (pending **group** invites), and
group-invite entry points all disappear — while Direct, knock, call, and the
**personal** invite link remain intact. Care points: `initNavRow` reveals
`#nav-row`; with groups off and no group cards, the Direct-mode nav row is
effectively empty (Inbox is group-invites) — hide it. Verify no leaked
presence/mailbox watchers remain.

**Audit task (palettes off):** mostly reuses existing `=== false` render paths
(swatch row hidden via `initPaletteBoot` early-return, plain status dot via
`paintStatusDot({ palettesEnabled: false })`, no theme vars applied,
favorites strip not initialized). Confirm the status dot still shows the
user's `statusColor` and theme vars stay at default.

## 6. Testing

- **`tests/features.test.js`** (new; does NOT mock `features.js`): seed
  localStorage overrides, `jest.resetModules()` + dynamic `import`, assert —
  default on; `false` disables (both palette flags via the single `palettes`
  key); a build-`false` default stays `false` even with a `true` override.
- **`featureOverrides`**: read defaults `{}`; write round-trips; parse errors
  swallowed.
- **`prefs`**: `setFeatureToggle` dual-writes (localStorage +
  `mergeUserPrefs`); `syncFromServer` writes incoming `featureToggles` and
  dispatches `feature-toggles-synced` only when a controlled key differs from
  the boot snapshot.
- **UI (`featureSettings`)**: section renders only with `?features`; switches
  reflect current state; flipping writes the pref and calls `location.reload`
  (mocked).
- **Groups gating**: with `GROUPS_ENABLED` mocked `false`, `app.js`'s `main()`
  skips the six groups inits (the app suites already mock `../js/features.js`).
- **Mock discipline:** suites mocking `../js/features.js` are unaffected. No
  new `js/db.js` exports are expected; if any are added, update the ~20
  db-mocking suites per the handoff convention.

## 7. Rollout

Ships dark: the section is invisible without `?features`. The maintainer opts
in by URL, exercises both toggles, then ungates by removing the query-param
guard in a later change. Build-time flags remain `true` on dev + main; the
override can only narrow per user.
