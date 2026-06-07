# Relationship-Gated Notification Toggles — Design

**Date:** 2026-06-07
**Branch:** `messaging-api`
**Status:** Design approved, pre-plan
**Tracks:** follow-on to the presence-notifications work (spec `2026-06-05-presence-notifications-design.md`); related #128.

## Problem

The per-person notification bell (`js/notifyBell.js`) offers all three toggles — **Knock / Call / Availability** — on every contact, regardless of relationship. But several of those notifications can never fire for a given contact, so the toggle is a silent dead end:

- **Knock / Call are mutual-only interactions** — `following.js:469/480` already gate the knock/call *UI* on `isMutual`. A non-mutual can't knock or call you, so a Knock/Call notification toggle for them does nothing.
- **Group context has no Call feature** at all (`groupContext.js` imports `KNOCK_ENABLED` only) — so the Call toggle on a group member is dead.
- **A pure Follower** (they follow you, you don't follow them) has nothing that can fire: can't knock/call (not mutual), and you don't see their availability (you don't follow them).

## Design

Show **only the toggles for notifications that can actually fire** for that contact.

**Mechanism.** `createNotifyBell(uid, { types, onNeedPermission })` gains a `types` array (list of `'knock'|'call'|'availability'`). It renders only those switches (filtering the existing `TYPES` list) and its active-state counts only visible types. Defaults to all three for back-compat. The call sites decide `types` because they know the relationship.

**Per-context mapping:**

| Where | `types` |
|---|---|
| Direct — **Mutual** | `['knock','call','availability']` |
| Direct — **Following** (you follow them, not mutual) | `['availability']` |
| Direct — **Follower** (they follow you, you don't) | *(no bell)* |
| **Group** member | `['knock','availability']` (no Call — groups have no call) |

- **`following.js`** — `renderList` already splits `mutuals` / `followingOnly` / `followerOnly`; it passes the right `types` (or none) down through `createFolloweeRow`.
- **`groupContext.js`** — `renderRoster` passes `['knock','availability']`.

**Group Availability note:** availability notifications are *followers-only* in v1, so the group Availability toggle is dormant for a member you don't also follow — until the deferred "availability option (c)" (shared-group context) ships. We still show it: it's forward-compatible with (c), and the roster already surfaces the member's live status, so the intent is sensible.

## Out of scope / non-goals
- **No server or data-model change.** Knock/call only fire for mutuals (the interactions can't happen otherwise), so hidden-type prefs never deliver. Saved prefs for a now-hidden type stay dormant (no migration) and reappear if the relationship changes back.
- No change to availability's followers-only audience (that's option (c), deferred).
- No change to the `NOTIFICATIONS_ENABLED` gate or the bell's popover/dismiss mechanics.

## Testing
- `notifyBell`: renders exactly the passed `types` (e.g. `['availability']` → one switch); active-state reflects only visible types; defaults to all three when `types` omitted.
- `following.js`: Mutuals row → bell with all three; Following row → bell with availability only; Follower row → **no** bell.
- `groupContext.js`: roster member → bell with `['knock','availability']` (no call switch).
