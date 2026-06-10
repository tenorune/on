# Collapse Redundant Own-Status / Group-Meta Subscriptions — Design

**Date:** 2026-06-10
**Status:** Approved (brainstormed 2026-06-10)
**Branch:** `collapse-own-status-subs`
**Tracking:** #131 Wave 2 — "Collapse redundant Firebase subscriptions (perf #1+#2)"

## Problem

Two clusters of duplicate RTDB subscriptions, both at their worst while a user
is inside a group context:

1. **Own `users/{uid}` watched 3×.** `app.js:577` (call-mode recovery, theme
   writes, own-card render), `groupNav.js:132` (`_ownPrimary` → nav cards), and
   `groupContext.js:1059` (`_ownPrimary` + override-palette re-apply) each open
   `watchStatus(self)`. Every status write is delivered three times — and
   because `watchStatus` reads the whole user node, every knock/follower write
   re-fires all three.
2. **Active group meta + own override watched 2×.** `groupNav.syncMetaSubs`
   already holds `watchGroupMeta` + `watchOwnMemberOverride` for *every*
   enumerated group (nav cards need them), including the active one — while
   `enterGroupContext` opens a private pair for that same group.

## Contract: pure refactor

Observable behavior is byte-identical: same renders, same same-tick callback
ordering (the theme-write/re-apply sequence), same group-deleted handling, same
subscription lifetimes for enumerated groups. Only the number of underlying
RTDB listeners changes. Any behavior consolidation discovered along the way is
noted for follow-up, not done here.

## Approach (chosen: A — two targeted owner modules)

Alternatives considered:

- **B — generic ref-counted subscription broker.** One mechanism for all future
  collapses, but refcounted teardown changes subscription lifetimes (violating
  the pure-refactor contract without extra pinning machinery), and it is the
  largest diff for exactly two use cases. Can still be introduced later *behind*
  the APIs below without touching consumers.
- **C — events + getters** (the `following-synced` pattern). No new API, but
  replay must be hand-rolled at every consumer (getter + listener; forgetting
  the getter read is a silent boot-race bug), unsubscribing requires retained
  handler refs across groupContext's enter/exit lifecycle, and cross-listener
  ordering is implicit.

A is the smallest design that provides replay, explicit ordering, and
per-consumer teardown.

## 1. New module: `js/ownStatus.js`

The single owner of the own-user `watchStatus` subscription.

```
initOwnStatus(uid)        // opens the ONE watchStatus(uid); re-callable (user
                          // switch / re-init): tears down the previous sub,
                          // resets the last-value sentinel
subscribeOwnStatus(cb)    // registers cb; replays the last value IF a tick has
                          // arrived; returns an unsubscribe function
```

Semantics:

- Callbacks receive the **raw `userData`** exactly as `watchStatus` delivers it
  (consumers read `callState`, `paletteKey`, etc. — no narrowing).
- **Registration-order fan-out.** Each call site swaps
  `watchStatus(uid, cb)` → `subscribeOwnStatus(cb)` in place, so registration
  order equals today's Firebase attach order (initNav → groupContext-on-enter →
  app.js handler). The same-tick ordering that protects the group-override
  theme from app.js's Direct-theme write is preserved by construction and
  documented as an invariant in the module header.
- **Replay only after the first tick.** `_last` starts as a sentinel distinct
  from `null` (`null` = user node absent). A pre-tick subscriber waits, exactly
  as `onValue` behaves today; a post-tick subscriber (groupContext on enter)
  gets the cached value immediately.

`initOwnStatus(userId)` is called in app.js immediately before `initNav(userId)`
(the earliest current subscriber).

## 2. groupNav provider APIs

groupNav already owns per-group `watchGroupMeta` / `watchOwnMemberOverride`
subscriptions (`_metaSubs` / `_overrideSubs`) and caches
(`_metaByGroupId` / `_overrideByGroupId`). It grows two read-only subscribe
APIs backed by them:

```
subscribeGroupMeta(groupId, cb)     // replay-from-cache + per-tick notify
subscribeOwnOverride(groupId, cb)   // same, for the own statusOverride
```

Three load-bearing rules:

- **Replay only after that group's underlying sub has ticked** (per-group
  flag). groupContext treats `meta === null` as "group deleted" (toast +
  navigate out); replaying a not-yet-ticked cache as `null` would fake a
  deletion. Until the tick, the subscriber waits.
- **Union rule.** `syncMetaSubs` maintains underlying subs for
  *enumerated groups ∪ groups with ≥1 active consumer*. `subscribeGroupMeta` /
  `subscribeOwnOverride` ensure the sub exists on registration — covering the
  deep-link boot race (`?group=` enters a group before the first enumeration
  tick). Cleanup tears a sub down only when the group is both un-enumerated
  AND consumer-free; enumerated groups keep today's app-long lifetimes.
- **Deletion fan-out order.** On a `null` meta tick, groupNav runs its own
  existing reaction first (cache delete + `removeUserGroupsEntry`), then
  notifies consumers with `null` — preserving today's attach order
  (groupNav before groupContext).

Override fan-out passes the **raw value including `null`** (groupNav's own
cache stores only truthy overrides; consumers get what
`watchOwnMemberOverride` delivered, so groupContext's null handling is
unchanged).

## 3. Consumer changes (in-place swaps; callback bodies untouched)

| Site | Before | After |
|---|---|---|
| `js/app.js` boot | — | `initOwnStatus(userId)` right before `initNav(userId)` |
| `js/app.js:577` | `watchStatus(userId, handler)` | `subscribeOwnStatus(handler)` |
| `js/groupNav.js` initNav | `_ownPrimaryUnsub = watchStatus(...)` | `_ownPrimaryUnsub = subscribeOwnStatus(...)` |
| `js/groupContext.js` enter | `watchStatus(userId, ...)` | `subscribeOwnStatus(...)` |
| `js/groupContext.js` enter | `watchGroupMeta(groupId, ...)` | `subscribeGroupMeta(groupId, ...)` |
| `js/groupContext.js` enter | `watchOwnMemberOverride(groupId, userId, ...)` | `subscribeOwnOverride(groupId, ...)` |

`exitGroupContext` keeps calling the same stored unsub handles (now registry
unsubs). `db.js` primitives keep their signatures — each is now called from
exactly one place.

Net in a group: `users/{uid}` 3→1, active-group meta 2→1, own override 2→1.

## 4. Edge cases & invariants

- **Same-tick ordering** (theme clobber): registration order; documented
  invariant.
- **Deep-link boot race:** ensure-sub on subscribe; later enumeration tick
  finds the sub already present (no duplicate).
- **Group deleted while inside:** groupNav's reaction first, consumers second
  — both of today's behaviors, today's order.
- **Leave/eviction while inside:** enumeration drops the group; the union rule
  keeps the sub alive until `exitGroupContext` unsubscribes (matches today,
  where groupContext's private sub outlived enumeration until exit).
- **User switch / re-init:** `initOwnStatus` re-opens against the new uid;
  consumers re-register through their existing re-init paths.
- **No fabricated `null`s:** pre-tick subscribers never receive a value
  (sentinel rule in both providers).

## 5. Testing

- **New `tests/ownStatus.test.js`:** one underlying `watchStatus` regardless of
  subscriber count; registration-order fan-out; replay after tick / none
  before; unsubscribe stops delivery; re-init tears down and re-opens.
- **groupNav suite additions:** replay-only-after-tick (both providers); union
  rule (subscribe to un-enumerated group opens a sub; cleanup spares
  consumer-held subs; tears down when un-enumerated AND consumer-free);
  deletion fan-out order.
- **Repointed mocks:** `tests/groupContext.test.js` repoints its
  `watchStatus`/`watchGroupMeta`/`watchOwnMemberOverride` db mocks to the new
  provider APIs with the same captured-callback pattern. Assertions stay
  identical — pure refactor means the tests' expectations don't change, only
  the seams.
- **Full suite** (`npx jest`, `cd functions && npm test`) as the backstop for
  mock stragglers.

## Out of scope

- Item 3 (render diffing for `renderNavRow`/`renderRoster`) and item 4
  (`users/{uid}` schema split) — post-Wave-2 backlog per #131.
- Behavior consolidations (e.g. unifying the two group-deleted reactions) —
  pure-refactor contract; note candidates for follow-up instead.
- A generic subscription broker (approach B) — can later land behind these
  APIs without consumer churn.
