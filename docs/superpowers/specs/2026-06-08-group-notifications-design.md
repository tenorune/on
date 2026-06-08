# Group-context notifications: knocks + availability

**Date:** 2026-06-08
**Status:** Approved design

## Goal

Make notifications work correctly in group context for **knocks** and **availability**:

1. **Group knock text** — a group knock should read `"{name in group} knocked in {group name}"`,
   using the knocker's group member displayName (not their Direct label / share code) and
   naming the group.
2. **Group availability** — when a member becomes available **in a group**, notify the other
   members of that group who opted in, with text `"{name in group} is available in {group name}"`,
   deep-linking into the group.

"Available in a group" uses the member's **effective in-group status**: their per-group override
when `enabled`, otherwise their primary status.

## Scope

**Entirely server-side (`functions/`).** No client or service-worker changes are required:

- The group roster bell already renders `['knock','availability']` toggles and persists prefs to
  `userPrefs/{viewer}/notify/{target}/{type}` (cross-device synced).
- The SW already deep-links via `contextGroupId` and tags availability as `availability:{uid}`
  (no group id) — i.e. the chosen **shared-tag/collapse** behavior already holds. A mutual
  (group co-member + Direct follower) who gets both a Direct and a group availability push sees a
  single notification; the last to arrive wins the deep-link target. This is accepted.

Files touched: `functions/presence-core.js`, `functions/notifier.js`, `functions/index.js`,
`functions/test/notifier.test.js` (plus presence-core tests if present).

## Background (current state)

- `onKnock` (`/users/{recipientId}/knocks/{senderId}`) → `handleKnock`: checks
  `userPrefs/{recipientId}/notify/{senderId}/knock`, already preserves `record.contextGroupId`
  in the payload, but resolves the name via Direct follow label → user code → "Someone".
- `onAvailability` (`/users/{uid}/availableUntil`) → `handleAvailability`: fans out to
  `users/{uid}/followers` only (Direct), watches primary only, 5-min per-uid cooldown at
  `notifierState/availability/{uid}`.
- Group member override lives at `groups/{g}/members/{uid}/statusOverride =
  { enabled, status, availableUntil, statusColor?, paletteKey? }`. Members default to
  `{ enabled:true, status:'available', availableUntil: now+2h }` at join.
- Delivery (`sendToUser`) reads tokens from `userPrefs/{uid}/pushTokens`; pure decision logic
  lives in `presence-core.js`; handlers take injected `deps` (`now/getVal/update/send`).

## Design

### 1. Group-aware naming (shared)

`functions/notifier.js`:
- `resolveGroupMemberName(deps, groupId, uid)` → `groups/{g}/members/{uid}/displayName`,
  falling back to `users/{uid}/code`, then `"Someone"`.

`functions/presence-core.js` — extend `buildMessage` to support a group label:
- `buildMessage('knock', name, { group })` → title `"{name} knocked in {group}"` when `group`
  is present, else the existing `"{name} knocked"`.
- `buildMessage('availability', name, { group })` → `"{name} is available in {group}"` /
  existing `"{name} is available"`.

Group name is read by the caller from `groups/{g}/name` (fallback: omit the "in {group}" suffix
if absent, i.e. pass no `group`).

### 2. Knock text (`handleKnock`)

When `record.contextGroupId` is set:
- name = `resolveGroupMemberName(deps, contextGroupId, senderId)`
- group = `groups/{contextGroupId}/name`
- message = `buildMessage('knock', name, { group })`

Direct knocks (no `contextGroupId`) are unchanged.

### 3. Effective-availability logic (`presence-core.js`, pure)

- `overrideAvailable(override, now)` → `!!(override && override.enabled === true &&
  override.status === 'available' && isFutureMs(override.availableUntil, now))`.
- `effectiveAvailable(override, primaryStatus, primaryAU, now)`:
  - if `override && override.enabled === true` → `overrideAvailable(override, now)`
  - else → `primaryStatus === 'available' && isFutureMs(primaryAU, now)`.

A transition "turned on" = `effectiveAvailable(after) && !effectiveAvailable(before)`.

### 4. Fan-out (`notifier.js`)

`notifyGroupAvailability(deps, groupId, memberUid, now)`:
1. Cooldown: read `notifierState/groupAvailability/{groupId}/{memberUid}`; if within
   `AVAIL_COOLDOWN_MS` (5 min), return.
2. name = `resolveGroupMemberName`, group = `groups/{groupId}/name`.
3. Read `groups/{groupId}/members`; for each `coUid !== memberUid`:
   - if `wantsAvailability(userPrefs/{coUid}/notify/{memberUid})` →
     `sendToUser(deps, coUid, buildMessage('availability', name, { group }),
     { type:'availability', targetUid: memberUid, contextGroupId: groupId })`.
4. If anything delivered, set `notifierState/groupAvailability/{groupId}/{memberUid} = now`.

### 5. Triggers (`index.js`)

- **New** `onMemberOverride = onValueWritten('/groups/{groupId}/members/{memberUid}/statusOverride')`
  → `handleGroupOverrideChange(deps, groupId, memberUid, before.val(), after.val())`:
  - If `before` is `null`/absent → **return** (member just joined / first write; not a
    "became available" event — avoids a blast on every new member).
  - Read current primary `users/{memberUid}/status` + `availableUntil`.
  - `effBefore = effectiveAvailable(before, status, primaryAU, now)`,
    `effAfter = effectiveAvailable(after, status, primaryAU, now)`.
  - If `effAfter && !effBefore` → `notifyGroupAvailability(deps, groupId, memberUid, now)`.
- **Extend** `handleAvailability` (primary trigger, unchanged signature): after the existing
  Direct-follower fan-out, if `availabilityTurnedOn(beforeAU, afterAU, status, now)`:
  - read `users/{uid}/groups` → for each `groupId`, read
    `groups/{groupId}/members/{uid}/statusOverride`; if override is **off**
    (`!override || override.enabled !== true`) → `notifyGroupAvailability(deps, groupId, uid, now)`.
  - (Override-**on** groups are driven by `onMemberOverride`, not the primary.)

`onKnock` / `onAvailability` triggers themselves are unchanged; only handlers extend.

## Edge cases / decisions

- **Join is silent:** `onMemberOverride` returns when `before == null`, so a new member defaulting
  to available does not notify co-members.
- **Override appearance-only writes** (statusColor/paletteKey) don't flip `effectiveAvailable`, so
  they don't notify.
- **Override-off + primary available** is handled by the extended primary trigger; **override-on +
  override available** by `onMemberOverride`. The two paths are mutually exclusive per group
  (gated on `override.enabled`), so a single availability event notifies a given group once.
- **Mutual double-send:** a co-member who also follows the member may receive both a Direct and a
  group availability push; the shared `availability:{uid}` SW tag collapses them to one
  (non-deterministic deep-link target). Accepted; no server-side cross-dedup.
- **Cooldown** is per-(group, member) so availability in one group doesn't suppress another.
- **Name fallback:** a member who left (no displayName) falls back to code → "Someone"; missing
  group name omits the "in {group}" suffix.
- **Opt-in required:** co-members are notified only if `notify/{memberUid}/availability` is true
  (the existing bell toggle).

## Testing (`functions/test/notifier.test.js`, injected deps)

Group knock:
- `handleKnock` with `contextGroupId` uses the group member displayName + `"… knocked in {group}"`.
- Direct knock unchanged.

Pure logic (`presence-core` tests):
- `overrideAvailable` / `effectiveAvailable` truth table (override on/off × available/not).

Group availability:
- `onMemberOverride` off→on (override enabled+available) → notifies opted-in co-members, not the
  member, not opted-out co-members.
- Appearance-only override change → no send.
- `before == null` (join) → no send.
- Primary turns available, member override **off** in group G → co-members of G notified;
  member override **on** in another group → that group **not** notified via primary.
- Cooldown: second event within window → no send; cooldown only consumed on delivery.
- Direct-follower availability path remains intact.
