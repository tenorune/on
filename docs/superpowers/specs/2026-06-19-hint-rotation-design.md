# Hint rotation: refining where the longpress & swipe FTU hints animate

**Date:** 2026-06-19
**Status:** Design — awaiting review
**Scope:** *Where* the longpress and swipe first-time-use hints are animated. Their
**triggering and eligibility chain are unchanged** (still gated on
`customAvail` + `theme` + `stripPeek` seen and the per-type flag not yet seen).
This is purely about which card pulses, when, and one-at-a-time.

## Problem

The hints are placed per-row, independently, in `updateFolloweeRow` (`following.js`)
and `paintRosterRow` (`groupContext.js`):

- **Longpress** is added to *every* available card whose combo differs from mine →
  many cards pulse at once.
- **Swipe** is pinned to the **first mutual by DOM order** — one card, but chosen by
  position, not by visibility or availability, and not sequenced across multiple
  mutuals. Swipe also ignores availability entirely.
- **Alternation** exists only where both types qualify on the *same* card, driven by
  a module-level `setInterval` that re-renders all mutuals. It's effectively
  untestable.

Desired: one teaching pulse at a time, on a card the user can actually see, biased
toward people they're likely to interact with, cycling through the candidates.

## Agreed behavior

### B1 — One at a time (target)
At any instant, **exactly one** hint animates anywhere (single rotating spotlight).
Each step alternates **type and card**. This strict one-at-a-time is the **target**;
the **tolerated fallback** is *at most one swipe and at most one longpress
concurrently* (on different cards) — acceptable if a strict single spotlight ever
proves impractical at an edge. Model 1 below with a single step timer naturally
yields the strict target, so the fallback is a tolerance, not a designed-in mode.

### B2 — Interleave: two independent rotating pointers (Model 1)
Each type keeps its **own ordered candidate list and its own round-robin pointer**.
Each step:
1. Choose the **type**: alternate between the types that *currently have* a
   showable card. If only one type has candidates, stay on it (no wasted empty
   steps). If neither does, show nothing.
2. Advance that type's pointer to its next candidate and pulse it.

Worked example — swipe candidates `{Alex, Bo, Cy}`, longpress candidates
`{Alex, Cy}`:
`swipe Alex → longpress Alex → swipe Bo → longpress Cy → swipe Cy → longpress Alex → swipe Alex → …`

### B3 — Cadence & order
- **Step = one 6.85 s animation cycle** (one pulse), matching the existing keyframe
  length. Pulses are never shown half-played.
- **Order = current visual top-to-bottom** order of the showable candidates,
  recomputed every step so it tracks list re-sorts and availability changes.
- A spotlighted card that becomes ineligible or scrolls off is **dropped at the next
  step boundary**, not yanked mid-pulse — *except* a card removed from the DOM, or a
  global pause (see B6), which clears immediately.

### B4 — Visibility (hard filter)
A card is a candidate only if it is **fully within the visible list region**. The
region's **top edge is computed at runtime** as the bottom of the *lowest currently
pinned header* in the active context — measured from the live sticky/fixed headers
rather than hardcoded per context, so it stays correct regardless of which headers
are pinned (today: Direct pins `.nav-row` + `#app-header`; Group pins only
`.nav-row`, with its static `.group-context-header` scrolling away). The region's
**bottom edge** is the viewport bottom (less the install-fab / safe-area in Direct).
If **nothing showable is visible, show nothing** — never force a pulse onto a
partly-off card, and never make the user scroll to find the hint.

### B5 — Availability: visibility-first, prefer-available-within-visible (Interpretation Y)
Per type, per step:
1. `visible` = candidates ∩ fully-visible (B4).
2. If any `visible` card is **available**, the showable pool = the available subset.
3. Else the showable pool = the unavailable subset of `visible`.
4. If `visible` is empty, the type shows nothing this step.

So an available card that is **off-screen does not block** teaching on a visible
unavailable card — we never waste an on-screen teaching opportunity (chosen over the
stricter "available-exists-anywhere" reading). Swipe-to-call works regardless of
availability, so a swipe pulse on an unavailable mutual is valid.

### B6 — Global pauses
Clear the active hint and stop stepping while **any** of these hold; resume with a
fresh recompute when **all** clear:
- **A focus-stealing surface over the list is open** (generalized "is anything
  overlaying the list?" check): card drawer, share-code drawer (`#code-drawer`),
  add-person form, create-group / invite modals, the group **Settings** menu, the
  notify-bell popover, the revealed recovery phrase.
- **A call is active or incoming** (`getCallModeCalleeId() !== null ||
  getIncomingCallFrom() !== null`). (Call cards are also never candidates, as a
  belt-and-suspenders.)
- **App backgrounded** (`document.visibilityState === 'hidden'`).
- **Active scroll** in progress — pause during the scroll gesture, recompute
  visibility on scroll-end.

### B7 — Context scope
- **Direct:** both types.
  - *Swipe* candidates: mutual cards (`data-mutual="1"`), not a call card.
  - *Longpress* candidates: followee cards whose combo differs from my saved combos,
    not a call card.
- **Group:** **longpress only** (swipe is direct-only). Candidates: member rows where
  the group override is ON and the member's combo differs from my group-effective
  combo.
- Only the **active context's** list participates (the other is hidden). The
  `longpress` seen-flag is global, so performing it in either context retires it
  everywhere (unchanged).

### B8 — Not changed
- Eligibility chain (FTU prerequisites + per-type not-yet-seen) is unchanged.
- `prefers-reduced-motion` is **not** honored — hints animate regardless.
- Performing the gesture still calls `markHintSeen(type)`, which drops that type out;
  when all relevant types are seen the engine goes idle.

## Architecture (Approach 1: central scheduler + per-context providers)

A new module **`js/hintRotation.js`** becomes the *single owner* of all
`.longpress-hint` / `.swipe-hint` DOM. `following.js` and `groupContext.js` stop
placing hints inline and instead expose **providers**.

### `js/hintRotation.js` (the core)
Owns: the step timer, `currentType`, per-type round-robin pointers, the single
`activeHint = { li, type } | null`, and the pause state.

- `initHintRotation()` — wires listeners (`visibilitychange`, scroll start/end, the
  custom re-eval events below), then `refresh()`.
- `registerHintProvider(context, fn)` — `'direct'` and `'group'` register their
  candidate providers.
- `refresh()` — recompute pause state (B6) and whether the engine should be running;
  if paused, clear the active hint and stop the timer; otherwise ensure the timer is
  running. Does **not** itself advance the pointer (that's the timer), but clears the
  active hint immediately if its card vanished from the DOM.
- `step()` (every 6.85 s) — ask the active context's provider for candidates, apply
  visibility (B4) + Y-availability (B5), pick the next type (B2.1) and next card
  (B2.2), place the pulse, clear the prior.
- Helpers: `placeHint(li, type)`, `clearActiveHint()`, `isFullyVisible(li, region)`.
- Visibility: `getBoundingClientRect` per candidate at each step / refresh (cheap for
  a handful of rows). The clip-region top is computed generically (B4) by measuring
  the lowest currently-pinned header in the active context, not a hardcoded element —
  so it survives the group-header-sticky change tracked separately. IntersectionObserver
  is an acceptable optimization but not required.

### Providers
Each returns, for its context, candidates **already eligibility-filtered but not
visibility-filtered**, in top-to-bottom order, tagged with availability:

```
getHintCandidates() → {
  longpress: [{ li, available }, …],
  swipe:     [{ li, available }, …],   // omitted/empty in group
}
```

- **Direct provider** (`following.js`): builds the lists from `getFollowing()` +
  cached `lastUserData` + `getFavorites()` (combo-differs) + the mutual flag + call
  state. No DOM-position "first mutual" logic anymore.
- **Group provider** (`groupContext.js`): builds the longpress list from the member
  state (`_memberPrimaries` / `_membersOverrides` / `_ownOverride`) it already holds.

### Re-evaluation triggers → `refresh()`
Presence/availability updates, `my-combo-changed`, context switch (Direct↔Group),
list re-render / re-sort, roster membership change, call-state change, overlay
open/close, `visibilitychange`, and scroll-end. `refresh()` recomputes pause +
candidate availability; rotation timing stays on the step boundary (B3).

### Removed
- `following.js`: inline hint placement in `updateFolloweeRow`, the
  `_hintAlternateTimer` / `_hintAlternateShow` machinery, the `isFirstMutual` swipe
  placement, and `refreshLongpressHints` (folded into provider + `refresh()`).
- `groupContext.js`: inline longpress placement in `paintRosterRow`.

## Testing

**Core (`hintRotation`) — unit, with a fake provider, fake clock (`jest` fake
timers), and an injected visibility predicate:**
- Type alternation when both types have candidates (flips each step).
- Single type present → no flip; round-robin advances through its cards, wraps.
- Y-availability: prefers available-visible; uses unavailable-visible when no
  available is visible; shows nothing when nothing visible.
- Pointer advance + wrap across changing candidate sets.
- Pause clears the active hint and halts stepping; resume recomputes and restarts.
- Single shared card eligible for both types → alternates type on that one card.
- Active card removed from DOM / scrolled off → cleared at the right moment
  (immediately for DOM-removal; next step for eligibility/visibility changes).

**Providers — in `following.test.js` / `groupContext.test.js`:**
- Direct: correct swipe (mutual, not call) and longpress (combo-differs, not call)
  candidate sets with availability tags, in list order.
- Group: correct longpress candidates (override ON, combo differs) with availability.

## Decisions of note (resolved)
- **B5 / Interpretation Y** was chosen over the stricter "available-exists-anywhere"
  reading (X). Recorded here for traceability.
- **Fallback (B1)** is a tolerance only; the design targets a strict single spotlight.
- **Runtime-measured clip (B4)** decouples this feature from the group-header-sticky
  inconsistency tracked in **#274** — landing or not landing that change requires no
  edit here.
