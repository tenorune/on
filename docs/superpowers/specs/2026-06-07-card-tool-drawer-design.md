# User-Card Tool Drawer — Design

**Date:** 2026-06-07
**Status:** Approved design, pre-plan

## Problem

User cards currently scatter per-person action buttons along the right edge —
today "unfollow" (`×`) and the notification bell. As more actions arrive, the
card's right side gets crowded and the bell competes for attention with the
card's primary gestures (knock, call-swipe, long-press). We want a single,
predictable home for these secondary actions that also keeps them from
interfering with the card's gestures while in use.

## Solution

Introduce a **tool drawer** on user cards. When a card has **two or more
right-side action buttons**, collapse them behind a vertical three-dot ellipsis
(`⋮`). Tapping `⋮` slides a drawer in from the right, overlaying a slice of the
card and revealing the actions. When a card has **exactly one** right-side
action (e.g. a follower card's "remove"), keep that button inline — no drawer.

### Which cards get a drawer

Count only **right-side action buttons** toward the threshold. Left-side
affordances (the follower "follow-back" `+`) do not count.

| Card type      | Right-side actions            | Result          |
|----------------|-------------------------------|-----------------|
| Mutual         | unfollow + bell (3 types)     | **Drawer**      |
| Following-only | unfollow + bell (avail. only) | **Drawer**      |
| Follower       | remove                        | No drawer (inline) |
| Group roster   | bell (knock + avail.)         | No drawer yet (inline) |

The group roster (`groupContext.js`) currently has only one right-side action,
so it stays inline today. The drawer component is built to be reusable so group
rosters adopt it automatically if/when they gain a second action.

### Bell behavior change (applies wherever the bell renders)

The bell's interaction now depends on how many notification types it offers:

- **One type** (following-only → availability): the bell *is* a direct on/off
  toggle ("notify me when this person is Available"). No popover.
- **More than one type** (mutual → 3 types; group roster → 2 types): tapping the
  bell opens the existing switch popover.

This is a standalone change to `notifyBell.js` and is correct independent of the
drawer.

### Bell icon — new monochrome, theme-shaded glyph

Replace the emoji bell (`🔔`) with a single-color SVG bell, inlined into the
button as `<svg fill="currentColor">` (the supplied `notification-bell` path,
`viewBox="0 0 122.88 122.83"`). The button sets `color: var(--text-muted)`, so
the glyph inherits the **same per-palette muted color as the Remove `×`** — no
per-theme code. (`--text-muted` is rewritten per palette by `palettes.js:168`
and reset to `#94a3b8` at `:182`; each of the 16 palettes defines its own
`textMuted`.)

On/off state stays **monochrome via opacity** (off = `0.45`, on = `1`), matching
the existing `.notify-bell` / `.notify-bell.active` rules. No color change
between states, no active-color accent.

### Drawer ⟷ popover layering

When the bell lives inside a drawer and offers a popover (mutual cards):

- Tapping the bell opens the popover **directly under the still-open drawer,
  aligned right**. The drawer stays open.
- Tap **outside the popover** → close the popover only (drawer remains).
- Tap **outside the drawer** → close the drawer (and the popover if open).

Two nested outside-tap handlers, popover inner / drawer outer.

### Open-state behavior (global while any drawer is open)

Only one drawer is open at a time; opening another closes the first.

While **any** drawer is open, across **all** cards:

- **Gestures disabled:** knock (card tap), call (right-swipe), long-press
  (palette adoption) are suppressed.
- **Incoming events buffered:** knocks and calls arriving from Firebase are held
  and delivered on close:
  - **Knocks:** replay **each** buffered knock (no coalescing).
  - **Calls:** on close, **reconcile against current Firebase state**. Apply the
    call UI only if the call is still live. **Never replay a stale call** (e.g.
    one the caller cancelled while the drawer was open).

### Close triggers

The drawer closes on any of:

- Tapping a **terminal action** (unfollow → drawer closes, *then* the confirm
  dialog appears).
- Tapping **outside** the drawer.
- **Escape** key.
- **Scrolling** the people list.

Toggling the bell or its switches does **not** close the drawer (toggles are not
terminal actions).

### Visuals

- Closed: a plain `⋮` at the card's right edge. **No active-state indicator** —
  the user opens the drawer to see notification state.
- Open: a right-aligned slice overlays the card, sliding in from the right,
  showing the action buttons (bell, unfollow). Slide-out on close.

## Components

- **`notifyBell.js`** — add the one-type direct-toggle path; keep the popover
  path for multi-type. Popover positioning supports the drawer-aligned case.
  Swap the emoji bell for the inline monochrome SVG (`fill="currentColor"`).
- **New card-drawer module** (shared, e.g. `js/cardDrawer.js`) — renders the
  `⋮`, owns open/close, the slide animation, and the singleton open-drawer state.
  Exposes whether a drawer is currently open (for the global gesture/event gate).
- **`following.js`** — replace the inline right-side buttons on mutual and
  following-only cards with the drawer; route knock/call/long-press handlers
  through the global "drawer open?" gate; buffer + flush Firebase knock/call UI.
- **`groupContext.js`** — adopt the shared drawer if action count reaches two
  (no change in behavior today).
- **`css/app.css`** — drawer slice, slide animation, popover-under-drawer
  alignment.

## Testing

- Drawer appears only at ≥2 right-side actions; follower/group cards stay inline.
- One-type bell toggles directly; multi-type bell opens popover.
- Bell renders the inline SVG with `fill="currentColor"`; color follows
  `--text-muted` across palettes; on/off differs only by opacity.
- Layered dismissal: outside-popover closes popover only; outside-drawer closes
  both.
- Global gate: gestures suppressed while a drawer is open; re-enabled on close.
- Buffering: each knock replays on close; a cancelled call does not replay; a
  still-live call applies on close.
- Close triggers: action tap (+ confirm sequencing), outside tap, Escape, scroll.

## Out of scope

- Adding new card actions.
- Applying the drawer to group rosters now (it has one action).
- Any change to notification delivery/server behavior.
