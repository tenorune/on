# Keyed Render Reconciliation for the Three List Renderers — Design

**Date:** 2026-06-10
**Status:** Approved (brainstormed 2026-06-10)
**Branch:** `render-diffing`
**Tracking:** #131 backlog — "renderNavRow / renderRoster full innerHTML rebuild on every tick → diff-update existing nodes" (M · High), folding in Direct's `renderList` per maintainer decision.

## Problem

Three list renderers rebuild their entire DOM on every data tick:

- `groupNav.renderNavRow` (`groupNav.js`): `row.innerHTML = ''` + full rebuild on
  every enumeration/meta/override/own-status tick. No targeted-update path at all.
- `groupContext.renderRoster` (`groupContext.js`): `list.innerHTML = ''` + full
  rebuild on every members/meta tick — then `paintRosterRow` separately repaints
  rows on status ticks, so status data is double-handled (a full rebuild path AND
  a targeted path).
- `following.renderList` (`following.js`): same full-rebuild shape (11 call
  sites), already carrying a "skip if only knocks changed" guard.

Full rebuilds destroy transient DOM state — focus, in-progress animations, open
card-drawers, knock float-to-top ordering — which has already produced real bugs
(the drawer leak fixed by force-closing on every roster render; the float-restore
rewrite). Every tick also re-attaches every listener on every node.

## Goal (maintainer's success criterion: "both / principled cleanup")

Stop destroying DOM that didn't change. Nodes persist across ticks; updates are
in-place paints; structural changes (add/remove/reorder) touch only the affected
nodes. Correctness wins (focus/animation/drawer/float survival) come along by
construction.

## Approach (chosen: A — one shared keyed-reconciliation helper)

Alternatives considered:

- **B — per-function no-op gate + targeted paint.** Cheapest, but structural
  ticks still wipe everything; doesn't deliver the principled fix.
- **C — adopt a tiny VDOM library.** Against the vanilla-ES-module grain;
  overkill for three lists.

## 1. New module: `js/reconcile.js` (~60 lines)

```
reconcileChildren(container, keys, { create, update, onRemove })
```

- `keys`: the full desired ordered list of child keys (strings). **The caller
  owns ordering**; the reconciler converges the DOM to it.
- Each managed child carries `data-reconcile-key`, set by the helper on create.
- Per call: index existing children by key → **remove** nodes whose key is gone
  (calling `onRemove(node)` first when supplied) → for each key in order,
  **get-or-create** (`create(key)` builds the node once; event handlers attach
  here, once per node lifetime) → **always `update(node, key)`** (in-place
  paint: text, classes, styles — never handlers) → **reposition** only nodes
  that are out of place (minimal `insertBefore`s).
- Static children (inbox slot, plus button, invite row, section labels) are
  managed under static keys, so a wholesale key-set change (e.g. nav mode flip)
  degrades to a full replace — which is the correct semantics there.
- Children without a `data-reconcile-key` are removed (the renderers own their
  containers exclusively).

## 2. The three adoptions

### `groupNav.renderNavRow`
- Direct mode keys: `['inbox-slot', ...sortedGroupIds, 'plus']`.
- Group mode keys: `['name', 'override-toggle', 'direct-card']` (static
  structure; the mode flip replaces everything, correctly).
- New `paintNavCard(card, groupId)` carries the existing per-card paint (border
  color / `greyed` / `--call-color-rgb` / badge); `create` builds the card +
  click handler once.

### `groupContext.renderRoster`
- One ordering function `rosterKeys()` =
  `[invite-row (owner only), ...floatedUids, ...others availability-then-alphabetical]`,
  reusing `getFloatedUserIds()`. This **absorbs `reorderRosterByAvailability`**
  — verified safe: that pass already runs at the end of every `renderRoster`
  AND every `paintRosterRow` cycle today, so "floated → available →
  alphabetical on every render" is already the effective order.
  `reorderRosterByAvailability` becomes a reconcile-with-current-order call (or
  is inlined away).
- Member-row `update` = existing `paintRosterRow` + displayName label refresh.
- **Member-row key = `uid + ':' + eligibilityBit`** (request-to-follow
  eligibility). The eligibility flip changes the row's action-cluster structure
  (bare bell vs ⋮ drawer), so it recreates that one row rather than having
  `update` rebuild drawers in place. `following-synced` re-reconciles instead
  of full-rebuilding.
- `onRemove`: if the removed row contains the open card-drawer, `closeCardDrawer()`.
  The blanket `closeCardDrawer()` at the top of `renderRoster` is removed —
  the drawer now survives ticks that don't remove its row.

### `following.renderList`
- Keys:
  `['label:mutuals', ...'mutual:'+uid, 'label:following', ...'following:'+uid, ...'follower:'+uid]`
  with labels present only when their section is non-empty (matching today).
  The type prefix means a contact moving between sections is a remove+create —
  correct, since the row types differ structurally.
- The knock-skip guard, `editingSet` skip (update leaves rows being edited
  alone), call-mode glow class, and empty-state handling
  (`#empty-list-msg` / `add-person-area.has-list`) stay where they are.
- Same `onRemove` drawer hook as the roster (Direct rows host drawers too);
  `renderList`'s blanket `closeCardDrawer()` is likewise removed.

## 3. Behavior contract

**Preserved exactly:**
- Visual output per tick (paint logic relocated, not changed).
- Roster order (floated → available → alphabetical) and Direct section order.
- Knock float/restore stays imperative in knock.js between ticks;
  reconciliation converges order on each data tick with floats pinned top.
  `restoreFromFloat`'s sibling-restore may briefly land a row out of place —
  the next reconcile corrects it, exactly as today's reorder pass does.
- The knock-skip guard, editing-state skip, empty-state toggling.

**Deliberately improved (the point of Approach A — NOT a pure refactor):**
1. Node identity survives ticks: focus, in-progress CSS animations (key-spin,
   knock pulses), and open card-drawers persist through status/override/meta
   ticks.
2. Drawer lifecycle narrows: closes only when its row is removed, not on every
   render.
3. Listeners attach once per node lifetime (today: N nodes × M listeners
   re-attached per tick).

**Known risk areas (each gets an explicit test):**
- displayName change on a surviving roster row: label repaints AND key order
  recomputes (order is name-dependent).
- Eligibility-bit key flip must not leak drawers (recreated row passes through
  `onRemove`).
- Nav mode flip and owner-gaining/losing the invite row (wholesale/partial key
  set changes).
- Direct section moves (mutual ↔ follower-only) replace the row type.

## 4. Testing

- **New `tests/reconcile.test.js`** (unit): same-node-reference across two
  reconciles; a `create`-attached click handler fires exactly once after N
  reconciles; removal of gone keys; minimal reordering; `onRemove` receives the
  removed node; full replace on disjoint key sets; unkeyed children removed.
- **Per renderer:** node identity preserved across a second tick; no duplicated
  listeners (knock fires once per tap after two members ticks); drawer survives
  an unrelated status tick and closes when its row is removed; eligibility flip
  recreates the row; float stays pinned across a members tick; Direct
  section-move replaces the row.
- Existing renderer tests assert post-render DOM and should pass with at most
  seam-level churn.
- Full web suite + functions suite as backstop.

## Out of scope

- The `users/{uid}` schema split (#131 perf #4) — separate spec/plan/branch.
- Any data-layer change; this is client-only DOM work.
- Swatch-row renderers (already have their own compat-pinned structure).
