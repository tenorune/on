# Group-Context Long-Press Adoption — Design

*Date: 2026-05-29*

## Goal

Bring the Direct-context long-press-to-adopt-color/theme gesture to the group-context roster, scoped per-group. A user in a group can press-and-hold any other member's roster row to adopt that member's effective-in-this-group color and palette as their own override for **this group only**. Direct context and every other group are untouched.

This is the first writer for the `statusOverride.statusColor` / `statusOverride.paletteKey` slots that were schema-reserved in Phase 2.

## Scope decisions (locked)

- **Gate:** gesture is only active when this group's override toggle is **ON** (`≠`). When OFF, long-press is a silent no-op — no hint, no toast.
- **Source:** any other member in the roster. (Self is not rendered.) No availability filter — you can adopt an unavailable member's combo just like in Direct.
- **What gets adopted:** the source member's **effective-in-this-group** color and palette. That means:
  - If the source has their own override ON in this group with `statusColor`/`paletteKey` set, those win.
  - Else fall back to the source's broadcast `users/{srcUid}/{statusColor, paletteKey}`.
  - Else fall back to forest `#22c55e` and `null` paletteKey — same chain as Direct.
- **Write target:** `groups/{groupId}/members/{myUid}/statusOverride.{statusColor, paletteKey}` via `mergeStatusOverride`. The user's broadcast `users/{myUid}/{statusColor, paletteKey}` is **not** touched.
- **Picker mirroring:** the per-group palette picker's `userPrefs/{myUid}/perGroup/{groupId}/paletteState` is updated to reflect the adopted combo, using the same set-resolution logic Direct uses (`PALETTE_SETS[1|2].find(p => p.color === ...)`). A picker tap after adoption wins (last-write-wins, no special handling).
- **Favorites:** group adoption pushes to the same favorites list Direct uses. (The favorites×context refinement is post-MVP.)
- **Hint flag:** the existing `statusapp_seen_longpress` (a.k.a. prefs `longpress`) covers both contexts. First group-context adoption marks it seen. Hints are not surfaced *in* group context in this spec (no group roster equivalent of the inline "long-press to adopt color" hint) — the cross-context hint refinement is post-MVP.
- **Gesture:** 500ms press-and-hold, same threshold and cancellation rules as Direct's long-press (tap-to-knock is the other roster interaction; it owns the short-press path).
- **Optimistic update:** adoption calls `applyOptimisticOverride(override)` in `groupContext.js` and applies the same theme variables synchronously, so the adopter sees the new color/palette without waiting for the Firebase ack.

## Out of scope

- Refining favorites to be context-aware (deferred).
- A separate hint key for group-context adoption (deferred).
- Adopting from members of *other* groups, or from Direct mutuals, into a given group (no).
- Direct picking up adopted-from-group state (no — Direct keeps its own statusColor/paletteKey on `users/{uid}/`).
- Phase 4+ per-audience color picker work (untouched).
- Toggle-OFF clear of color/palette — already handled correctly by `mergeStatusOverride` (HANDOFF §15 is stale on this; updating in a follow-up).

## Behavior

### Trigger conditions

The gesture is active on roster row `<li>` elements in `#group-context-root` when **all** of the following hold:

1. `PALETTES_ENABLED && PALETTE_INTERACTIONS_ENABLED` (same flags Direct gates on).
2. `GROUPS_ENABLED` (the context exists).
3. This group's own override is currently ON — i.e. `_ownOverride?.enabled === true` in `groupContext.js`.
4. The target row's `data-user-id` is not the current user's uid. (Already enforced — self isn't in roster.)

When (3) is false, the gesture handler short-circuits and the row behaves as if the long-press handler isn't installed. Tap-to-knock continues to work in that state.

### Source resolution

For target row with `data-user-id === srcUid`:

```
srcOverride = _membersOverrides[srcUid]            // may be undefined
srcPrimary  = _memberPrimaries[srcUid]             // may be undefined

if (srcOverride?.enabled && srcOverride.statusColor)
  adoptedColor = srcOverride.statusColor
  adoptedPaletteKey = srcOverride.paletteKey ?? null
else
  adoptedColor = srcPrimary?.statusColor ?? '#22c55e'
  adoptedPaletteKey = srcPrimary?.paletteKey ?? null
```

`paletteKey` defaults to `null` (no palette) only when the source has none. `statusColor` always resolves to a concrete value via the forest fallback.

### Writes (single transaction conceptually, two atomic ops)

1. **Override merge** — `mergeStatusOverride(groupId, myUid, { statusColor: adoptedColor, paletteKey: adoptedPaletteKey })`. RTDB `update()` semantics preserve `enabled`/`status`/`availableUntil` untouched.
2. **Picker mirror** — recompute the per-group palette state shape and call `setGroupPaletteState(groupId, newState)`. The shape mirrors what Direct does:
   - If `adoptedPaletteKey` is set, find which set it belongs to (`PALETTE_SETS[1].some(...) ? 1 : 2`), set `activeSet`, set `sets[set].selectedKey = adoptedPaletteKey`, `sets[set].selectedColor = adoptedColor`, `sets[set].activePaletteKey = adoptedPaletteKey`.
   - Else if `adoptedColor` matches a known palette key color in either set, snap to that set and base mode.
   - Else (color matches nothing) leave `activeSet` and `selectedKey` as-is and write `sets[activeSet].selectedColor = adoptedColor`, `sets[activeSet].activePaletteKey = null`. (Adopter sees the picker hold its own swatch position; the color override still applies because the override record is authoritative for the dot/theme.)

   The picker is mirrored *for visual feedback only*. The override record is the source of truth for the dot color and the group-context theme variables.
3. **Favorites push** — call the existing `saveFavorite(true)` path with the adopter's *pre-adoption* group-effective combo. (Matches Direct's "save pre-adoption state; the adopted state enters history on next adoption or go-available" rule.)

### Optimistic UI

In `groupContext.js`'s long-press handler:

1. Build the new override object: `{ ...currentOverride, statusColor: adoptedColor, paletteKey: adoptedPaletteKey }`.
2. Call `applyOptimisticOverride(newOverride)` — this updates the local `_ownOverride` cache and triggers a paint of the own-status row + the roster row reflecting the user's effective color.
3. Fire the picker mirror call (synchronous against localStorage; CustomEvent re-renders the picker).
4. Fire the Firebase override merge and favorites push (async, both `.catch(() => {})`).
5. Mark the longpress hint seen if not already (covers both contexts via the shared flag).
6. Add the `.adopted-from` class to the source row for a brief visual flash (same affordance Direct uses).

### Other members' view

`watchGroupMembers(groupId, cb)` on every other member's device picks up the override delta. `paintRosterRow` already combines override + primary and uses the effective color for the row's swatch / theme variables. No new code on the receiver side.

If the adopter's effective availability is `unavailable` (override status is `unavailable` or `availableUntil` is in the past), the dot is muted and the color change is technically present in the DOM but visually de-emphasized. This matches the user's stated rule "other members see it immediately if the adopter is available" — there's no asymmetry to add; the muted state is just how unavailable rosters already look.

### Cross-device sync

The adopter's other devices pick up the new override via `watchOwnMemberOverride(groupId, myUid)`. The picker mirror syncs via `watchUserPrefs` → `prefs.syncFromServer` → the `group-palette-state-synced` CustomEvent. Both are already wired in Phase 2 + the userPrefs migration; no new subscriptions.

### Tap-to-knock interaction

Tap-to-knock is the only existing roster row interaction. The gesture-arbitration shape:

- `pointerdown` starts a 500ms timer + records start position.
- If `pointerup` happens before the timer fires AND the pointer hasn't moved more than ~10px → fire **knock**.
- If the 500ms timer fires before `pointerup` AND override is ON → fire **adopt** (and suppress the subsequent `pointerup` so it doesn't re-fire knock).
- If override is OFF when the 500ms timer fires → no-op; the subsequent `pointerup` still fires knock if movement < threshold. *(This is the "silent no-op" rule.)*
- A move beyond threshold cancels both (no scroll-to-knock).

This mirrors Direct's existing long-press gesture in `js/following.js` — the implementation lives in `groupContext.js`'s roster row construction, but the timing constants and cancellation rules are copied from Direct so the feel matches across contexts.

## Data flow

| State | Source | Already wired? |
|---|---|---|
| Adopter's own override | `watchOwnMemberOverride(groupId, myUid, ...)` in `groupContext.js` (via `groupNav`) | Yes |
| Source members' overrides | `watchGroupMembers(groupId, ...)` | Yes |
| Source members' primary status | per-member `watchStatus(memberUid, ...)` in `groupContext.js` | Yes |
| Per-group palette picker state | `watchUserPrefs(myUid)` → `prefs.syncFromServer` → `group-palette-state-synced` | Yes |
| Adopter's own effective render | `applyOptimisticOverride` + paint chain | Yes (existing override toggle path) |

No new subscriptions. One new writer (`mergeStatusOverride` with `{statusColor, paletteKey}`). Picker mirror uses the existing `setGroupPaletteState` setter.

## Schema

No schema changes. The Phase 2 `statusOverride` already has `statusColor` and `paletteKey` slots reserved (per the groups spec §13 and HANDOFF §15). This is the first code path to populate them.

```
groups/{groupId}/members/{myUid}/statusOverride:
  enabled:        true            (gated by the toggle being ON)
  status:         'available' | 'unavailable'  (untouched by adoption)
  availableUntil: <number> | null              (untouched by adoption)
  statusColor:    '#22c55e' (or adopted)       ← written by adoption
  paletteKey:     'forest' | ... | null        ← written by adoption
```

`userPrefs/{myUid}/perGroup/{groupId}/paletteState` — the existing per-group picker state — is mirrored to reflect the adoption (see "Picker mirroring" above).

## Edge cases

| Case | Behavior |
|---|---|
| Source has no `statusColor` and no `paletteKey` | Fall back to forest `#22c55e` + `null` paletteKey. Override write still happens. |
| Source has only `paletteKey`, no `statusColor` | `adoptedColor` falls back to the palette's key color (`PALETTE_SETS[set].find(p => p.key === srcPaletteKey).color`), or forest if unresolved. |
| Adopter has override ON but currently unavailable (`status: 'unavailable'`) | Adoption succeeds. Color/palette are stored on the override. Roster dot is muted for both adopter and other members until adopter goes available — at which point the adopted color lights up the dot. |
| Adopter toggles override OFF → ON later | Adopted `statusColor`/`paletteKey` persist (via `mergeStatusOverride` semantics — the toggle's null-write doesn't touch them). On toggle back ON, the adopted color reappears. |
| Adopter long-presses, then taps a swatch in the picker | Picker write wins (last-write-wins). Adopted color is replaced by the picker's selection. No conflict resolution needed. |
| Adopter long-presses member A, then member B | Member B's combo overwrites A's via the same `mergeStatusOverride` write. No history. (Favorites captures the pre-A combo on the first adoption.) |
| Source member's status changes mid-press | Source resolution snapshots at the moment the 500ms timer fires. A mid-press status change isn't reflected. |
| Source leaves the group between source-resolution and write | The override write succeeds anyway — the adopted color/palette are values, not references. The source leaving the group doesn't unmake the adoption. |
| Gesture fires while group context is mid-switch (entering/leaving) | Same guard as other roster handlers — the `pointerdown` handler is installed on rows; if the row is detached during the 500ms window, the timer's callback no-ops because it looks up `_state.currentGroupId` and the active `_ownOverride`. |
| `KNOCK_ENABLED` is OFF | Long-press still fires when override is ON. Knock short-press becomes a no-op (`KNOCK_ENABLED` already gates the knock path). |
| `PALETTES_ENABLED` is OFF | Long-press is not installed at all — same as Direct, which doesn't show the swatch row when palettes are disabled. |
| `PALETTE_INTERACTIONS_ENABLED` is OFF but `PALETTES_ENABLED` is ON | Long-press is not installed. Picker still works (matches Direct's behavior where favorites strip + adoption are gated separately from the swatch row itself). |
| Direct nav-row group-card border for this group while adopter is in this group | Already correct via the existing fallback chain `ov?.statusColor || _ownPrimary?.statusColor || '#22c55e'`. Adopted color shows on the Direct nav card while override is ON; falls back to primary when OFF. |

## Cross-module touch points

| Module | Change |
|---|---|
| `js/groupContext.js` | Add long-press gesture installer on roster row construction. Resolve source. Build the new override + new per-group palette state. Call `applyOptimisticOverride`, `setGroupPaletteState`, `mergeStatusOverride`, `saveFavorite(true)`, `markHintSeen('longpress')`. Add `.adopted-from` class for visual flash. |
| `js/db.js` | No changes — `mergeStatusOverride` already exists. |
| `js/prefs.js` | No changes — `setGroupPaletteState` already exists. |
| `js/groupNav.js` | No changes — `applyOptimisticOverride` is already exported from `groupContext.js` for cross-module use. |
| `js/following.js` | No changes — Direct adoption path stays as-is. |
| `js/favorites.js` | No changes — `saveFavorite(true)` already handles both contexts. (Refinement deferred.) |
| `css/app.css` | Add an `.adopted-from` flash rule scoped to group-context roster rows (mirror the Direct rule). |

## Tests

- `tests/groupContext.test.js`: long-press fires adoption when override is ON; no-op when OFF; resolves source via override-then-primary-then-fallback chain; writes correct `mergeStatusOverride` payload; mirrors picker state via `setGroupPaletteState`; pushes pre-adoption combo to favorites; marks `longpress` hint seen; respects feature flags.
- `tests/groupContext.test.js`: gesture arbitration — short-press fires knock, long-press fires adopt, movement beyond threshold cancels both.
- Existing `tests/groupContext.test.js` roster paint coverage already exercises the receive-side rendering — no new tests needed there.

## Manual verification

1. Group context, override OFF: long-press a roster row → nothing happens, no toast, no hint. Short-tap fires knock as before.
2. Group context, override ON, source member with set primary statusColor: long-press → my dot adopts that color, group-context theme vars shift, per-group palette picker updates, picker shows that swatch as active.
3. Same as (2) but source has a paletteKey set: my paletteKey adopts too, theme variables shift to the source's palette.
4. Adopt member A, then adopt member B: my override shows B's combo; favorites strip has the pre-A combo from the first adoption.
5. Adopt while currently unavailable: my dot stays muted but my color/palette settings update. Toggle to available → dot lights up the adopted color.
6. Adopt → toggle override OFF → toggle ON: adopted color/palette reappear.
7. Adopt on device A: device B's group context shows the new color/palette without reload (`watchOwnMemberOverride` + `group-palette-state-synced`).
8. Adopt on device A: other members in the group see the new color in their roster's row for me (`watchGroupMembers` delta + `paintRosterRow`).
9. Direct context group-card border for this group reflects adopted color while override ON; falls back to my primary statusColor when override OFF.
10. Long-press hint flag: hadn't been marked seen → first group-context adoption marks it seen → Direct context no longer shows the inline "long-press to adopt color" hint.

## Open follow-ups (post-MVP)

- Favorites × context refinement (the user wants this; not yet scoped).
- Hints × context refinement (single longpress flag is good enough for MVP; cross-context discoverability story is a separate spec).
- HANDOFF §15 update: the "toggle-OFF clears the whole override; Phase 4+ will revisit" note is stale. `mergeStatusOverride` already preserves color/palette across toggle. Fix in a follow-up doc commit.
- Direct adoption currently gates on **mutual** relationship. Group context adoption gates on **same group membership**. Worth aligning the social model in a later pass — feels intentional but isn't called out anywhere.
