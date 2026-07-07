# Telegram bot: group-context support — design

Date: 2026-07-07
Status: approved (naming = name substring match; /status //off never touch `enabled`)
Scope: `functions/telegram.js` (+ its tests). No client changes. Builds on the
2026-07-02 Telegram adaptation spec (§2 commands, §4 data model) and the
2026-07-05 onboarding spec's as-built state.

## Problem

The bot's commands and its knock-back callback are Direct-context only. Group
scope exists everywhere else in the product — per-group `statusOverride`,
group membership, `contextGroupId` on knocks — and the notifier already
*sends* group context (`notifier.js` puts `contextGroupId` in knock and
availability payloads), but the bot can't act on it:

1. Knock-back on a group knock loses the group: the button is
   `knock:${targetUid}` and the callback writes a plain Direct knock.
2. `/knock` can't reach someone followed in no Direct sense but co-membered
   in a group.
3. `/who` has no group variant.
4. `/status` can't go available in one group.
5. `/off` can't go unavailable in one group.

## Decision: naming a group on the command line

**Name substring match** — the same idiom `/knock` already uses for people.
`/who fam` matches the user's own groups' names case-insensitively by
substring. No new state, readable in chat history.

- 0 matches → `No group matching "fam".`
- 2+ matches → reply listing the matching group names, ask for more letters.
  (No inline keyboard: `/status`/`/off` carry extra args that don't fit a
  callback, and the plain-text retry is one short message.)

Rejected: index from `/groups` (needs a stable sort + numbering, stale
between messages), group-id prefix (nobody knows their 16-hex group id).

## Semantics: `/status <group>` and `/off <group>` respect `enabled`

The override's `enabled` flag is the user's app-side choice of whether the
group follows their global status or has its own. **The bot never flips it.**

- **Override ON** (`enabled === true`): the commands merge only
  `status`/`availableUntil` into the existing `statusOverride`
  (`update()` on the override path — `enabled`, `statusColor`, `paletteKey`
  untouched, matching the client's `mergeStatusOverride` contract).
- **Override OFF** (`enabled !== true`, including no override node): the
  group mirrors global presence; a per-group change is impossible without
  enabling the override, which is the app's call. The commands write
  nothing and reply with guidance (exact texts in §4/§5).

Fan-out: the `onMemberOverride` RTDB trigger (functions/index.js) fires on
Admin-SDK writes too, so an override-ON `/status <group>` gets the
`notifyGroupAvailability` fan-out with no direct call from telegram.js.
(Override-OFF never writes, so no fan-out question arises.)

## Design

### 1. Knock-back / knock button carries the group

- `buildNotificationKeyboard`: when the payload has `contextGroupId`, the
  `knock` and `availability` buttons emit
  `knock:${targetUid}:${contextGroupId}`; without it, unchanged
  `knock:${targetUid}`. (32-hex uid + 16-hex gid + `knock:` = 55 bytes,
  under Telegram's 64-byte callback_data cap.)
- `handleCallback`: parse an optional third `:`-segment; `knock` passes it
  through.
- `writeKnock(deps, recipientUid, senderUid, contextGroupId?)` mirrors the
  client transaction exactly (js/db/social.js writeKnock): on create, set
  `contextGroupId` when provided; on increment, overwrite when provided,
  else carry the existing one.

### 2. `/knock <name>` reaches group-only members

- Direct following is searched first, exactly as today. Any Direct match
  (1 or several) keeps today's behavior — Direct owns the name.
- Zero Direct matches → search group rosters: for each gid under
  `users/{uid}/groups`, read `groups/{gid}/members`, match `displayName`
  by substring (self excluded). Collect `{ uid, gid, name, groupName }`.
  - One match → knock with `contextGroupId = gid`; reply
    `Knocked on NAME (GroupName).`
  - Several → inline keyboard (cap 8), labels `NAME (GroupName)`,
    callbacks `knock:uid:gid`.
  - None anywhere → `Couldn't find "X" among the people you follow or your
    groups.`

### 3. `/who <group>`

- Bare `/who` unchanged (Direct global presence).
- With args: resolve the group by name; for each co-member (self excluded)
  compute `effectiveAvailable(statusOverride, presence.status,
  presence.availableUntil, now)` — the `/groups` idiom — and list
  `🟢 displayName` for the available ones.
- Replies: `Available in GroupName:` + lines, or
  `No one is available in GroupName right now.`

### 4. `/status [group] [duration]`

Grammar (bare `/status [dur]` must stay byte-identical in behavior):

1. No args → global, 60 min (unchanged).
2. All args parse as a duration (`parseDurationMinutes` over the joined
   args) → global (unchanged; covers `/status 1h 30m`).
3. Else: if the *last* token parses as a duration, it's the duration and
   the preceding tokens are the group name; otherwise all tokens are the
   group name and the duration defaults to 60. (Covers `/status family 2h`
   and `/status my family`.)

Group path:

- Override ON → merge `{ status: 'available', availableUntil: now + dur }`;
  reply `You're available in GroupName for 1h.` (duration formatted as the
  global path does). Fan-out rides `onMemberOverride`.
- Override OFF, globally available → no write;
  `GroupName follows your global status — you're already available there.`
- Override OFF, globally unavailable → no write;
  `GroupName follows your global status. /status goes available everywhere,
  or turn on a group status in the app.`

### 5. `/off [group]`

- Bare `/off` unchanged (global presence).
- Override ON → merge `{ status: 'unavailable', availableUntil: null }`;
  reply `You're unavailable in GroupName.`
- Override OFF, globally available → no write;
  `GroupName follows your global status. /off goes unavailable everywhere,
  or turn on a group status in the app.`
- Override OFF, globally unavailable → no write;
  `You're already unavailable in GroupName.`

### `/help`

Update the four lines to show the group forms:

```
/status [group] [30m|2h] — go available (default 1h)
/off [group] — go unavailable
/who [group] — who's available now
/knock <name> — send a knock (searches your people, then your groups)
```

## Data-model notes (all pre-existing, nothing new)

- `groups/{gid}/members/{uid}/statusOverride` =
  `{ enabled, status, availableUntil, statusColor?, paletteKey? }`.
  RTDB strips null-valued keys; readers use loose null checks — the bot's
  merges follow the client's `mergeStatusOverride` write shapes.
- `knocks/{recipient}/{sender}` = `{ count, ts, contextGroupId? }`, cap 5.
- Bot writes use the Admin SDK (bypass rules): write shapes must mirror the
  client exactly; invariants are pinned only by tests.

## Testing (TDD, functions Jest, flat mock seeding whole objects)

- Keyboard: knock/availability payloads with `contextGroupId` → 3-segment
  callback_data; without → 2-segment (regression).
- Callback: `knock:uid:gid` → knock record with `contextGroupId: gid`;
  `knock:uid` → no `contextGroupId` (regression); increment
  overwrite/carry semantics.
- `/knock`: Direct match still wins (regression); roster-only match knocks
  with context; ambiguity keyboard carries `uid:gid`; self excluded;
  no-match text.
- `/who <group>`: override-ON available member listed, override-ON
  unavailable member hidden even when globally available, override-OFF
  member follows global; self excluded; bare `/who` regression.
- `/status`: grammar cases (bare, `2h`, `1h 30m`, `family`, `family 2h`,
  `my family`); override-ON merge leaves `enabled`/`statusColor`/
  `paletteKey` untouched; override-OFF writes nothing (both reply
  variants); bare-path regression.
- `/off`: override-ON merge shape; override-OFF writes nothing (both reply
  variants); bare-path regression.
- `/help` text includes the group forms.
