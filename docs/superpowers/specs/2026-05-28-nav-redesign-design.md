# Navigation Redesign — Design

*Date: 2026-05-28*

## Goal

Consolidate context navigation into a single persistent row above the status surface, replacing the current group-cards strip that sits above the contact list. Make context-switching a one-tap operation from anywhere in the app. Use the nav row itself to surface per-group status at a glance, and free the group-context body of redundant labels.

## Scope decisions (locked)

- Persistent nav row, **sticky** at the top, renders only in Direct and Group contexts (overlays — splash, welcome, restore, invite-failure, displayname, create-group — hide the nav via CSS).
- "Direct" is always present as the leftmost item; tapping it returns to Direct context (no-op if already there).
- "+" is always present; the zero-state *"Create your first group"* CTA is replaced by the same `+` glyph regardless of group count.
- Sort order: `Direct` pinned left, groups by `lastVisited desc`, `+` trailing right.
- Per-group cards in the Direct-context nav use a **border-color** indicator for status:
  - Effective status (override or primary) `available` → border = `override.statusColor || primary.statusColor || forest-green-fallback`.
  - Effective status `unavailable` (incl. expired) → no border; group-name text uses `var(--text-muted)`.
- Override toggle (group context only) is a chain/link SVG icon with **inverted semantics**: the connected/solid chain represents override OFF (the user is *linked* to their primary status); the broken chain represents override ON. Initial state is connected (OFF).
- Group context's body loses its `<h2>` group-name (the nav row carries it) and loses the "Set a unique status" pill (the chain icon replaces it). A `Settings` pill takes the empty slot in the chip row.

## Out of scope

- Collapse strategies beyond horizontal scrolling — spec §6's "more than 5 groups" pile-up is still post-MVP.
- Pinning / hiding individual groups from the nav.
- Cross-group quick-switching via gestures.
- Per-audience color picker (Phase 4+, untouched).
- Phase B identity tightening (untouched).

## Visual layout

### Direct context

```
┌─────────────────────────────────────────────────────────────────┐
│  [Direct]      [Group 1]  [Group 2]  [Group 3]    …    [+]      │  ← #nav-row
├─────────────────────────────────────────────────────────────────┤
│  ●  Available · 2h 30m left                                     │
│     [2 hours]  [Share code]                                     │  ← #app-header (unchanged)
├─────────────────────────────────────────────────────────────────┤
│  ▾ Contacts (Mutuals / Following / Followers)                   │  ← <main>
│  …                                                              │
└─────────────────────────────────────────────────────────────────┘
```

- `Direct` rendered with `.nav-current` styling (large, bold; matches the existing `.group-context-name` size — `1.25rem font-weight: 700`).
- Group items use the existing `.group-card` styling for visual continuity with Phase 1's familiar shape.
- `+` button uses the existing `.group-cards-plus` styling.
- Items left-to-right, center-aligned vertically, horizontal scroll when overflow.
- The existing `#group-cards-row` element is **removed** — it's superseded by the nav row.

### Group context

```
┌─────────────────────────────────────────────────────────────────┐
│  Direct   🔗   Family                                           │  ← #nav-row
├─────────────────────────────────────────────────────────────────┤
│  ●  Available · 2h 30m left                                     │
│     [2 hours]  [Settings]                                       │  ← group's own-status box
├─────────────────────────────────────────────────────────────────┤
│  ▾ Member roster                                                │
│  …                                                              │
└─────────────────────────────────────────────────────────────────┘
```

- `Direct` is **smaller, unbold** (matches a `.group-card`'s font-size, ~0.9rem) and tappable; this is now the back-link.
- Chain icon sits between the two labels.
- Group name uses `.nav-current` (1.25rem / 700) — same treatment `Direct` gets in the Direct-context nav. Truncates with ellipsis at viewport width (or 600px body cap, whichever is narrower).
- The previous group-name `<h2>` above the roster is removed.
- The previous override-toggle pill is removed.
- The chip row gains a `Settings` pill where the override toggle used to be. The Settings dropdown anchors to this pill (`position: absolute; right: 0`), drops below it over the roster.

## Override toggle icon

- **Markup:** an inline `<svg>` element inside a `<button id="group-override-toggle">`. Two SVG paths swap on state change (or two SVGs both present, one hidden — easier to animate later).
- **Glyphs:** any public-domain link-vs-broken-link pair. Feather Icons, Tabler, Bootstrap Icons all offer suitable pairs. Implementer picks one and standardizes.
- **State semantics:**
  - Override OFF (default) → connected chain glyph. `aria-pressed="false"`. `aria-label="Set a unique status for this group"`.
  - Override ON → broken chain glyph. `aria-pressed="true"`. `aria-label="Stop using a unique status for this group"`.
- **Click handler:** mirrors the existing toggle pill — call `toggleStatusOverride(groupId, userId, nextEnabled)` with `nextEnabled = !current`. **Optimistic update** of `_ownOverride` before awaiting Firebase (the fix in commit `bb4107d` must carry over to the new icon button).

## Border color logic (Direct-context nav per-group items)

For each group card in the nav, compute the effective status the same way `paintRosterRow` does today:

```
override = _overrideByGroupId[groupId]   // from watchOwnMemberOverride per group
primary  = _ownPrimary                    // from watchStatus(myUserId)

overrideOn = override?.enabled === true
source     = overrideOn ? override : primary
isAvailable = source?.status === 'available'
              && (source.availableUntil == null || source.availableUntil > now)
```

Then:

- `isAvailable === true`:
  - Border color = `override.statusColor || primary.statusColor || 'var(--my-status)'`.
  - `var(--my-status)` resolves to `#22c55e` (forest green) by default when no palette is active — this is the fallback the user requested.
  - Group name text uses normal `var(--text)`.
- `isAvailable === false`:
  - No border (or a 1px transparent border to keep the card from shifting layout).
  - Group name text uses `var(--text-muted)` (#94a3b8).

The active-context indicator (`outline: 2px solid var(--accent)`) on the current group card in Direct context is preserved — but with the new nav, the current context is always reflected by the larger/bolder `Direct` or `Group name` text rather than by an outline. Drop the `.active` class wiring on the nav-row items; rely on the size/weight contrast.

## Data flow

The nav row needs four kinds of state:

| State | Source | Already wired? |
|---|---|---|
| Current context (Direct vs Group) | `groupNav.js` `_state` + `onContextChange` | Yes |
| Group enumeration (which groups exist) | `watchUserGroups(myUserId, ...)` in `groupNav.js` | Yes |
| Group meta (name) per group | `watchGroupMeta(groupId, ...)` per group | Yes |
| Own override per group | `watchOwnMemberOverride(groupId, myUserId, ...)` per group | Yes (Task 9 of Phase 2) |
| Own primary status | `watchStatus(myUserId, ...)` | Yes |

The redesign reorganizes existing data — no new subscriptions needed.

## Markup structure

A new top-level `<div id="nav-row" class="nav-row hidden">` sits inside `<body>` above `#main-ui-direct` and `#group-context-root`. Hidden by default; shown once `ensureIdentity` completes successfully and the app enters Direct/Group context.

Inside, the contents are dynamic — re-rendered by `groupNav.js` on every change to enumeration / meta / context / override / primary state. Two render modes:

```html
<!-- Direct context -->
<div id="nav-row" class="nav-row">
  <button class="nav-current">Direct</button>
  <button class="group-card" data-group-id="G1" style="border-color: #22c55e">Family</button>
  <button class="group-card greyed" data-group-id="G2">Work</button>
  <button class="group-cards-plus">+</button>
</div>

<!-- Group context -->
<div id="nav-row" class="nav-row">
  <button class="nav-back">Direct</button>
  <button id="group-override-toggle" aria-pressed="false" aria-label="Set a unique status for this group">
    <svg>…connected chain…</svg>
  </button>
  <span class="nav-current nav-current-truncate">Family</span>
</div>
```

`groupNav.js` owns rendering. The render mode swaps when `onContextChange` fires.

## CSS notes

- New `.nav-row` rule: `position: sticky; top: 0; z-index: 100; background: var(--surface); padding: 0.5rem 1rem; border-bottom: 1px solid var(--surface2); display: flex; align-items: center; gap: 0.5rem; overflow-x: auto;`. (Matches `#app-header`'s sticky band so the two sit visually as a unified top region.)
- `#app-header`'s sticky `top: 0` becomes `top: <nav-row height>` so the two sticky bands don't overlap, OR the nav row is positioned outside the scroll container. Simpler: nav row is `position: sticky; top: 0` and `#app-header`'s `top` is recomputed to sit below it. The cleanest implementation is to give the nav-row a fixed-ish height via padding and set `#app-header { top: 3rem; }` (or compute via CSS custom property).
- `.nav-current` class: `font-size: 1.25rem; font-weight: 700; color: var(--text);`.
- `.nav-back` class: `font-size: 0.9rem; font-weight: normal; color: var(--text-muted); background: transparent; border: none; cursor: pointer; padding: 0.25rem 0.5rem;`.
- `.nav-current-truncate`: `overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;` (group-context group name).
- Group-card max-width in Direct-context nav: `max-width: 8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` (truncate long group names in the nav).
- `.group-card.greyed` (new): `color: var(--text-muted)`.
- Existing group-cards-row CSS is removed.

## Group context body — availability section

Today the group-context status row sits inside `#group-context-root > header.group-context-header > #group-header-row`. To match Direct's `#app-header` visual treatment, give the wrapping `<header class="group-context-header">` (or a new wrapper) the same surface band style:

```css
.group-context-header {
  background: var(--surface);
  padding: 1rem;
  border-bottom: 1px solid var(--surface2);
  /* existing flex layout removed; the header is now the surface band, not the status row */
}
```

Inside the band:
- Status row (`#group-header-row`): dot + label + time-remaining + chip row.
- Chip row: time-chip + `Settings` pill (replaces the override-toggle pill).
- `<h2 id="group-context-name">` and the existing `<details>` markup are deleted from this header.

The `.group-context-header-row` introduced in commit `6db617e` is also deleted.

## Settings menu placement

The `<details id="group-context-actions">` markup itself is preserved, but its `<summary>` becomes a chip alongside the time chip:

```html
<div class="group-header-chips">
  <button id="group-time-chip" class="chip time-chip">2 hours</button>
  <details id="group-context-actions" class="group-context-actions">
    <summary class="chip">Settings</summary>
    <div class="group-actions-menu">
      <button id="group-action-rename" class="ghost-btn hidden">Rename group</button>
      <button id="group-action-invite" class="ghost-btn hidden">Invite link</button>
      <button id="group-action-delete" class="ghost-btn hidden">Delete group</button>
      <button id="group-action-edit-name" class="ghost-btn hidden">Edit my name</button>
      <button id="group-action-leave" class="ghost-btn hidden">Leave group</button>
    </div>
  </details>
</div>
```

The menu drops below the chip via the existing `position: absolute; right: 0` styling. Existing dismissal-on-outside-tap + dismissal-on-option-activation behavior carries over unchanged.

## Edge cases handled

- **Long group names in Direct-context nav:** `max-width: 8rem` + ellipsis. Tap still navigates.
- **Long current-group name in group-context nav:** `max-width: 100%` with ellipsis, bounded by viewport / 600px body cap.
- **Many groups in Direct context:** horizontal scroll. `+` is the last item; users scroll to it. `Direct` stays visible only if it's pinned via CSS (`position: sticky; left: 0` on `.nav-current` inside a horizontally-scrolling parent) — recommend pinning `Direct` so users can always get back from a wide nav.
- **Brand-new user with zero groups:** Direct context renders `[Direct]   [+]` only. No groups, no zero-state CTA copy.
- **Group rename mid-session:** nav re-renders via `watchGroupMeta` change. Existing wiring covers this.
- **Group deletion (own or by owner):** `watchUserGroups` removes the entry; nav re-renders; if the user was viewing that group, the group-deletion-toast + `navigateToDirect()` from Phase 1 still handles the exit. The nav drops the entry as part of the re-render.
- **Override transitions:** border color (Direct-context nav) updates as `watchOwnMemberOverride` fires. Chain icon (group-context nav) updates the same way. Both share the optimistic-update pattern from `bb4107d`.
- **Expired availableUntil:** the effective-status calculation already handles this (`availableUntil > now`). No additional timer needed for the nav specifically; piggyback on existing renders.
- **Knock badge on group-card nav items:** unchanged; existing `bumpGroupCardBadge` / `clearGroupCardBadge` and CSS apply since the nav items reuse `.group-card` styling.

## Testing surface

| Area | Test file | What to assert |
|---|---|---|
| Nav renders correctly in Direct context | `tests/groupNav.test.js` | Order: Direct, groups (lastVisited desc), +. `Direct` has `.nav-current`. Each group has `.group-card`. |
| Nav renders correctly in group context | `tests/groupNav.test.js` | Order: Direct (`.nav-back`), chain icon, group name (`.nav-current`). No other groups. |
| Tap Direct in group context navigates back | `tests/groupNav.test.js` | Calls `navigateToDirect`. |
| Tap group card in Direct nav navigates in | `tests/groupNav.test.js` | Calls `navigateToGroup(groupId)`. |
| Tap + in Direct nav opens create-group modal | `tests/groupNav.test.js` | Triggers the create-group request listener. |
| Tap chain icon toggles override | `tests/groupContext.test.js` | Calls `toggleStatusOverride` with the inverted enabled state. Optimistic-update test from `bb4107d` carries over. |
| Border color reflects override-on + available | `tests/groupNav.test.js` | `card.style.borderColor` set to the user's statusColor (or forest green fallback). |
| Border absent when effective status is unavailable | `tests/groupNav.test.js` | `card.style.borderColor` empty; `.greyed` class present. |
| Settings pill opens menu, dismisses correctly | `tests/groupContext.test.js` | Existing tests adapt to the new pill placement. |
| Group-context body no longer has the h2 group name | `tests/groupContext.test.js` | `#group-context-name` removed; group name visible only via the nav. |

## Implementation considerations (for the plan)

- `groupNav.js` owns the nav render. Its existing `renderCardsRow(enumeration, metaByGroupId)` is replaced by `renderNavRow()` which renders into `#nav-row` and branches on `_state.context`.
- `app.js` no longer initializes `#group-cards-row` (delete `initCardsRow`); instead it initializes the nav row.
- `groupContext.js` loses the toggle-pill wiring and the `<h2>` rendering. It gains a `Settings` pill wiring (the existing `<details>` logic moves) and a chain-icon click handler (replaces the override-toggle click handler). The optimistic-update logic in toggle, dot, and chip handlers stays.
- Markup in `index.template.html`: add `<div id="nav-row">` above `#main-ui-direct`; remove `<div id="group-cards-row">` and `<h2 id="group-context-name">`; restructure the `<header class="group-context-header">` body; move the `<details>` into the chip row.
- CSS in `css/app.css`: add `.nav-row`, `.nav-current`, `.nav-back`, `.greyed` rules; adjust `#app-header` `top` to sit below the nav row; remove `.group-cards-row`, `.group-cards-plus`, `.group-cards-zero` rules.

## References

- `docs/superpowers/specs/2026-05-25-groups-design.md` — Phase 1/2 design (this redesign supersedes spec §6 "Navigation" and the §16 Phase 1 cards-row deliverable).
- Phase 2 plan + Phase 1 plan — for the existing subscriptions and patterns this redesign builds on.
- Commit `bb4107d` — optimistic-update pattern; must carry over to the chain icon.
- Commit `6db617e` — Settings dismissal behaviors; carry over to the new pill.

End of design.
