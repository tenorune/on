# Favorites Simplification — Design

*Date: 2026-05-29*

## Goal

Collapse the favorites strip's mixed "live picker slots + history" model into a single uniform history of combos the user has committed to. Two events commit a combo to favorites: going active in any context (Direct or group), and adopting a combo via long-press in any context. The picker swatch row (`#swatch-row` / `#group-swatch-row`) remains as the live workspace; the favorites strip becomes a pure history surface.

## Scope decisions (locked)

- **Two writers, no others:** (1) unavailable→available transition (Direct dot-tap, group dot-tap-to-go-available) pushes the going-active combo; (2) long-press adoption (Direct mutual or group member) pushes the *adopted* combo (NOT the pre-adoption combo as today).
- **Tap-to-restore is adopt-only:** tapping a strip pill restores that combo to the picker + applies its statusColor/paletteKey. The strip is unchanged. No swap, no reordering. If the user later goes active with the restored combo, the going-active push will dedupe at head — no churn.
- **Head-only dedupe:** an incoming combo is suppressed only if it matches the existing head (slot 1). Combos appearing deeper in history aren't deduped against; they age out naturally.
- **Capacity 8.** When the strip is full and a new push lands, the oldest entry falls off.
- **No "previous combo" concept.** `_lastCommittedCombo` and the `onPaletteStateChanged` baseline-update both go away. The picker is a draft workspace; un-committed picker state is not saved.
- **Chip cycles while available do NOT push.** Cycling the chip changes `availableUntil`, not the combo. The going-active push only fires on transitions.
- **Group override-toggle-ON auto-seeding does NOT push.** The auto-seed lands at `{ enabled: true, status: 'unavailable' }` — no transition to available, no push. A subsequent user-initiated go-available DOES push.
- **No schema change.** `userPrefs/{uid}/favorites` stays a flat array of combo objects. Cap changes from 6 to 8 (existing arrays ≤6 fit). No migration.

## Out of scope

- Explicit delete-from-favorites gesture (e.g. long-press a pill to remove). Strip remains age-out only.
- Per-context favorites lists. Strip stays shared across Direct and all groups.
- Reordering favorites by drag.
- Visual indicator on the strip pill that's currently active. (The picker swatch row is the source of truth for "what's active.")
- Going-active hint on combo capacity ("you have 8 favorites; this commit will displace the oldest"). No-op displacement.

## API

`js/favorites.js` collapses three writer functions (`saveFavorite(force)`, `saveCustomCombo(combo)`, the `force=false` branch's "previous combo" logic) into a single export:

```js
const MAX_FAVORITES = 8;

export function saveCombo(combo) {
  if (!PALETTES_ENABLED || !PALETTE_INTERACTIONS_ENABLED) return;
  if (!combo) return;
  const history = getFavorites();
  if (history.length && pillsLookSame(history[0], combo)) return; // head-only dedupe
  writeFavorites([combo, ...history].slice(0, MAX_FAVORITES));
  renderStrip();
}
```

The combo shape (`{ statusColor, surface, surface2, paletteKey, selectedKey, activeSet }`) is unchanged from today.

## Call sites — exactly four

| # | Where | Trigger | What's pushed |
|---|---|---|---|
| 1 | `js/me.js` `setAvailable` (~line 166-168) | Direct dot-tap, unavailable→available | `buildCombo()` — the current Direct combo from picker state + `--my-status` |
| 2 | `js/following.js` `triggerAdoption` (~line 418-427) | Direct long-press of a mutual | An `adoptedCombo` built from the source's effective combo (statusColor + paletteKey from their broadcast `users/{srcUid}/...` or forest fallback). Replaces today's `saveFavorite(true)` push of the pre-adoption combo. |
| 3 | `js/groupContext.js`, the dot-tap-to-go-available handler in the own-status row (~line 902, around `setOverrideStatusAvailable(...)`) | Group dot-tap, override-on + unavailable → available | `buildGroupCombo({ ownOverride: nextOverride, ownPrimary: _ownPrimary, paletteState: getGroupPaletteState(groupId) })` — the going-active group combo. NEW call site. |
| 4 | `js/groupContext.js` `triggerGroupAdoption` (~line 1049) | Group long-press of a roster member | The `adoptedCombo` (already computed in step 1 of `triggerGroupAdoption` as `{ statusColor: adoptedColor, paletteKey: adoptedPaletteKey, ... }`). Replaces today's pre-adoption combo push via `saveCustomCombo(preCombo)`. |

For call site 2, the adopted combo shape mirrors `buildGroupCombo`'s output shape — same `{ statusColor, surface, surface2, paletteKey, selectedKey, activeSet }` keys. A small helper `buildAdoptedCombo(srcStatusColor, srcPaletteKey)` can be exported from `favorites.js` (or live as a private helper in `following.js`) to produce this shape consistently.

## Tap-to-restore (`handleHistoryTap`)

`handleHistoryTap(idx)` simplifies to "adopt the favorite, leave the strip alone":

```js
function handleHistoryTap(idx) {
  const combo = getFavorites()[idx];
  if (!combo) return;
  // Restore picker state to reflect this combo.
  const state = JSON.parse(JSON.stringify(getPaletteState()));
  state.sets[String(combo.activeSet)].selectedKey = combo.selectedKey;
  state.sets[String(combo.activeSet)].selectedColor = combo.statusColor;
  setPaletteState(state);
  switchSet(combo.activeSet, _myUserId);
  if (combo.paletteKey) enterPaletteMode(combo.paletteKey, _myUserId);
  else exitPaletteMode(_myUserId);
  // Apply canonical status color (overrides what switchSet wrote).
  setStatusColor(_myUserId, combo.statusColor).catch(() => {});
  document.documentElement.style.setProperty('--my-status', combo.statusColor);
  document.documentElement.style.setProperty('--my-glow', getGlowForColor(combo.statusColor));
}
```

No `oldSlot` snapshot, no `shouldPrepend` check, no `writeFavorites` call. The strip stays exactly as it was — the tapped favorite remains in its position. The picker swatch row updates to reflect the new pick.

## Rendering

### `renderExpanded`

Drops the slot-pill section. The strip is just the history pills + the collapse button:

```js
function renderExpanded(container, history) {
  const pills = history
    .map((c, i) => renderPill(c, 'history', 'history', i))
    .join('');
  container.innerHTML =
    `<div class="fav-strip">${pills}` +
    `<button class="fav-collapse-btn" aria-label="Collapse">▲</button></div>`;
  // Width sizing logic (current pillCount-driven calc) unchanged — works for
  // up to 8 pills the same way it worked for up to 2+6=8.
}
```

### `renderCollapsed` (single-line gradient)

Drops `slot1`/`slot2` from the gradient stops:

```js
function renderCollapsed(container, history) {
  const colors = history.map(c => c.statusColor);
  // existing gradient construction over `colors` instead of `[s1, s2, ...colors]`.
  // Rest of the function unchanged.
}
```

### `renderPill`

The `state` parameter no longer takes `'inactive'`/`'active'` values — only `'history'`. Could be dropped entirely (the `data-type` attribute already carries the "history" semantic). Optional cleanup.

## Tap-to-restore vs. "currently active" indicator

There is no visual indicator on the strip showing which pill (if any) matches the user's currently active combo. The picker swatch row already shows the active set's swatch; that's the source of truth for "what's active." A strip pill highlight was considered and rejected as scope creep — the two surfaces have distinct purposes.

If the user goes active with a combo that's currently in slot 5, the going-active push fires; head-only dedupe doesn't suppress it (head is whatever the previous commit was, not slot 5); the combo moves to slot 1, and the rest of the strip shifts down by one. This is the only natural "promote to recent" path — happens on real commit, not on browse.

## Dead code removed

- `slotCombo(setNum)` — derives a combo from picker state. Unused after slots collapse.
- `slotVisuallyMatches(combo, setNum)` — only used by `saveFavorite`'s gone branch.
- `combosMatch(a, b)` — only used by `slotVisuallyMatches` and the gone `handleHistoryTap` swap logic.
- `removeHistoryDuplicatesOfSlots()` + its call site in `following.js` after `triggerAdoption`. (Slots no longer exist as a privileged set, so there's nothing to dedupe history against.)
- `handleSlotTap(slotNum)` — no slot pills to tap.
- `_lastCommittedCombo` module-level state + `onPaletteStateChanged` listener + `initFavoritesStrip`'s baseline initialization (`_lastCommittedCombo = buildCombo()`).
- `saveFavorite`'s `force` parameter and the entire non-force "previous combo" branch.
- `saveCustomCombo` — name absorbed by `saveCombo`.
- `MAX_HISTORY` const — renamed `MAX_FAVORITES = 8`.

## What stays

- `buildCombo()` — still used by Direct go-active call site.
- `buildGroupCombo()` — still used by group go-active and group adoption (already on dev).
- `pillsLookSame(a, b)` — still used by `saveCombo`'s dedupe check.
- `writeFavorites(arr)` — still the persistence wrapper around `setFavorites`.
- `getFavorites()` — public read.
- `getAllCombos()` — now equivalent to `getFavorites()`. Can stay as a one-liner re-export or be inlined at its single consumer (`getCanvasColors`).
- `getCanvasColors()` — unchanged behavior. Reads `getAllCombos()` which now returns just `getFavorites()`. Canvas pen colors are still the user's committed combos. Edge case: the local user in a call has necessarily gone active, so their current combo is in favorites. Pad-with-defaults logic unchanged.
- `renderStrip` / `renderCollapsed` / `renderExpanded` / `renderPill` — the rendering chain. Simplified per above.
- `initFavoritesStrip(myUserId)` — keeps the context-change listener that snaps the peek animation closed when leaving Direct.
- The FTU gating (`statusapp_seen_theme` hides the strip until the user has interacted with themes) and peek-hint behavior (`statusapp_seen_strip_peek_done` controls the 6s peek animation in collapsed state) — unchanged.
- Cross-device sync via `watchUserPrefs` → `prefs.syncFromServer` → `favorites-synced` CustomEvent → `renderStrip()` re-fires — unchanged.

## Tests

| File | Change |
|---|---|
| `tests/favorites.test.js` | Existing `saveFavorite` and `saveCustomCombo` describe blocks rewritten as a single `saveCombo` block. Cover: push to empty history, push to non-empty, head-only dedupe (push when head matches → no-op; push when middle matches → push happens), cap at 8 (push when full → oldest drops), feature-flag off → no-op. Existing slot/`_lastCommittedCombo` tests deleted. |
| `tests/favorites.test.js` | `handleHistoryTap` test (if present) rewritten to assert the strip is unchanged after a tap. |
| `tests/following.test.js` | Direct adoption test asserts `saveCombo(adoptedCombo)` is called with the adopted combo's shape. Replaces the existing `saveFavorite(true)` assertion. |
| `tests/groupContext.test.js` | Long-press adoption test asserts `saveCombo(adoptedCombo)` is called with the adopted combo. Replaces the existing `saveCustomCombo(preCombo)` assertion. |
| `tests/groupContext.test.js` | NEW test: dot-tap-to-go-available in group context with override ON fires `saveCombo(buildGroupCombo(...))` with the post-toggle combo. |
| `tests/me.test.js` | `setAvailable` test asserts `saveCombo` is called with the current Direct combo. Replaces any existing `saveFavorite()` assertion. |

## Edge cases

| Case | Behavior |
|---|---|
| First going-available of a session (no history yet) | `saveCombo` pushes; favorites becomes `[combo]`. (Today: nothing pushed — there's no "previous" combo.) |
| Going-available with the same combo twice in a row | First push lands; second push dedupes at head → no-op. Strip unchanged. |
| Adopting a combo that's already at head | Dedupe → no-op. Strip unchanged. Picker swatches still update to reflect the source. |
| Adopting a combo that's currently at slot 5 | Push lands at slot 1; the existing slot-5 entry stays at slot 5 (no auto-removal). Result: the same combo appears twice in the strip — once at slot 1 (just adopted) and once at slot 5 (older commit). Acceptable: subsequent commits naturally age the duplicate out. Could revisit with full-list dedupe if it bothers users. |
| Tapping a favorite pill | Picker updates, statusColor/paletteKey applied. Strip unchanged. |
| Going active in group context with override OFF | No-op for favorites. (Override OFF means the user is showing Direct status; the Direct go-active path handles its own push.) |
| Auto-seed when override toggles ON | No push — the seed is `{ status: 'unavailable' }`, no transition to available. |
| Chip cycle while available | No push — combo doesn't change. (Cycling cycles `availableUntil` only.) |
| Cross-device: device A pushes; device B receives the sync | `watchUserPrefs` → `prefs.syncFromServer` overwrites the favorites array → `favorites-synced` event → `renderStrip()` re-fires. Same as today. |
| `PALETTES_ENABLED && !PALETTE_INTERACTIONS_ENABLED` | `saveCombo` early-returns. Same as today's `saveFavorite`. |
| `getAllCombos()` consumers (canvas pen colors) | Behavior preserved: now returns `getFavorites()`. The local user in a call has gone active → their combo is in favorites → pen colors include it. Pad-with-defaults logic for users with <4 colors unchanged. |
| Migration of existing user data | None needed. Existing favorites arrays are ≤6 entries (old `MAX_HISTORY` cap), all fit the new 8-entry cap. Schema unchanged. |
| User with full 8 strip; new push lands | Slot 8 falls off, new push lands at slot 1. The dropped combo is gone (no undo). Same as today's "slot 6 of history falls off." |

## Cross-module touch points

| Module | Change |
|---|---|
| `js/favorites.js` | Major rewrite. Replace `saveFavorite` + `saveCustomCombo` with `saveCombo`. Remove dead helpers (`slotCombo`, `slotVisuallyMatches`, `combosMatch`, `removeHistoryDuplicatesOfSlots`, `handleSlotTap`). Remove `_lastCommittedCombo` state + `onPaletteStateChanged` listener. Rewrite `handleHistoryTap` to adopt-only. Simplify `renderExpanded`, `renderCollapsed`, `renderPill`. `MAX_HISTORY` → `MAX_FAVORITES = 8`. |
| `js/me.js` | Replace `saveFavorite()` call in `setAvailable` (~line 168) with `saveCombo(buildCombo())`. Import `saveCombo` instead of `saveFavorite`. |
| `js/following.js` | Replace `saveFavorite(true)` in `triggerAdoption` (~line 424) with `saveCombo(adoptedCombo)`. Build the `adoptedCombo` from `targetData.statusColor` + `targetData.paletteKey` (the source's broadcast state) via a small inline helper or imported `buildAdoptedCombo`. Remove the `removeHistoryDuplicatesOfSlots()` call at ~line 426. |
| `js/groupContext.js` | Replace `saveCustomCombo(preCombo)` in `triggerGroupAdoption` (~line 1049) with `saveCombo(adoptedCombo)` — `adoptedCombo` is built in the same function from `adoptedColor` + `adoptedPaletteKey`, using `buildGroupCombo`. NEW call site: in the dot-tap-to-go-available handler (~line 902 `setOverrideStatusAvailable(groupId, userId, availableUntil)`), insert `saveCombo(buildGroupCombo({ ownOverride: { ..._ownOverride, status: 'available', availableUntil }, ownPrimary: _ownPrimary, paletteState: getGroupPaletteState(groupId) }))` before the Firebase write. |
| `js/canvas.js` (or wherever `getCanvasColors` is consumed) | No change. `getAllCombos` now returns `getFavorites()`; pen colors are unchanged in behavior. |

## Why this is simpler

- One writer function instead of three.
- One reader interaction (`handleHistoryTap`) instead of two (`handleSlotTap` + `handleHistoryTap`).
- One rendering branch for the strip (history pills) instead of two (slot pills + history pills).
- No `_lastCommittedCombo` baseline-tracking machinery.
- No "previous combo" semantic — every commit is its own event.
- The picker (swatch row) and the favorites strip become genuinely independent surfaces, each with one job.
- Group context becomes a first-class contributor to favorites, removing today's asymmetry where only Direct adoption contributed.

## Open follow-ups (post-MVP)

- Per-context favorites lists. The spec's strip-is-shared-across-contexts decision may want revisiting once users have lived with the unified strip.
- Explicit delete-from-favorites gesture (long-press a pill).
- "Auto-promote" when a deep favorite is committed (today's "duplicate at slot 1 and slot 5" edge case). Could resolve with full-list dedupe if friction surfaces in practice.
- Visual indicator on the strip pill that matches the currently active combo. Currently rejected as scope creep — the picker swatch row is the source of truth.
