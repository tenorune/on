# Operator control panel — design

**Date:** 2026-08-01
**Status:** design approved by the operator; implementation plan not yet written.

## 1. Problem

There is no way to see the user base. `database.rules.json` is owner-scoped
(`auth.uid === $uid`), with only `users/{uid}/presence` and a few index nodes
readable by any authenticated user, so no browser client — signed in as anyone —
can enumerate accounts. Operating the service today means writing a one-shot Node
script per question (`functions/audit-available-null.js`,
`functions/repair-user-groups.js`, the two `migrate-*.js`).

Three concrete needs drive this:

1. **See the user base** — who exists, when they were last active, how many
   contacts they have, which groups they are in and under what name.
2. **Merge two accounts** — one human, two accounts (usually: lost the phrase and
   re-onboarded). Their contacts should not have to re-add them.
3. **Link a Telegram-derived account to a phrase account without losing data.**
   Production cannot do this (§8); the Admin SDK can.

## 2. Non-goals

- Not deployed, not hosted, not reachable off the operator's machine.
- No new Cloud Functions, no new callables, no RTDB rules changes. Nothing about
  this tool changes the app's runtime attack surface.
- No live listeners. Reads are explicit snapshots so what is acted on is what was
  seen.
- The integrity report (§9) is **report-only**. Every repair is a bespoke write;
  auto-fix buttons would add destructive surface for no proven need.
- Not a support console for end users. Single operator, single machine.

## 3. Shape and placement

A local Node CLI that serves a small HTML page to the operator's own browser:

```
cd functions && node ops/server.js --project <firebase-project-id> [--port 8787]
```

Auth and region handling match `migrate-presence.js` exactly:
`GOOGLE_APPLICATION_CREDENTIALS_JSON` holds the service-account JSON, with
optional `--region` and `--database-url`. Additionally reads
`TELEGRAM_UID_SECRET`; without it the provenance badge (§6) degrades to
`unknown (secret not set)` rather than guessing, because `deriveTelegramUid` is
the only exact test for a derived uid.

**Placement: `functions/ops/`.** Two reasons. The Admin SDK and the shipped
merge/purge primitives (§7, §8) both live in `functions/`, and cross-package
imports from `scripts/` would be awkward — `functions/` is ESM with its own
`package.json`. And the toolchain already covers it: `tsconfig.json` includes
`functions/**/*.js` under `checkJs: true` + `strict: true`, and Node builtins
(`node:http`, `node:fs`) resolve there (verified with a throwaway probe file
during design). Only *globals* like `process` need the locally-typed cast that
every existing script in `functions/` already uses.

**Language: `.js` with JSDoc, not `.ts`.** Nothing compiles this — `node
ops/server.js` runs the file directly, so a `.ts` entry point would need `tsx`,
`ts-node`, or an esbuild pre-step before every run. Under `checkJs` + `strict`
the type checking is identical, and the zero-suppressions rule applies the same.
Large structural types (the snapshot and row shapes) are declared in real TS
syntax in `functions/ops/types.d.ts` — a `.d.ts` needs no build — and referenced
from the `.js` files as `@type {import('./types.js').Snapshot}`. `types/app.d.ts`
is the existing precedent for that pattern.

### 3.1 Safety

- **Binds `127.0.0.1` only, never `0.0.0.0`.** The service-account credential is
  in-process; anything reachable off-box is a full-database compromise.
- **Prod gate.** The `--project` value is compared against `--prod-project`; on a
  match, startup refuses without `--i-know-this-is-prod`, and the page renders a
  persistent banner naming the project.
- **Per-action confirm.** Every destructive POST requires the full uid typed back
  in the request body, plus a nonce issued by the detail view that launched it,
  so a stale tab cannot replay a purge against a re-used row.
- **Pre-image + audit.** Before any mutation the tool reads every path its
  write-set will touch and dumps current values to
  `functions/.ops-audit/<ts>-<op>-<uid>.json` (gitignored), then appends a JSONL
  record (timestamp, op, project, uids, path count, outcome). RTDB has no undo;
  the pre-image is the only reconstruction path and the only way a bad merge is
  diagnosable afterwards.

## 4. Modules

```
functions/ops/
  server.js       CLI entry — argv, gates, HTTP routes, serves panel.html
  snapshot.js     ALL RTDB reads → one plain object (the only impure read module)
  provenance.js   pure: (uid, telegram nodes, secret) → one of 4 categories
  project.js      pure: snapshot → { rows, detail(uid) }
  integrity.js    pure: snapshot → findings[]
  merge.js        pure: (snapshot, loserUid, survivorUid) → write-set + conflicts
  purge.js        wrapper over expungeDerivedAccount + pre-image capture
  audit.js        pre-image dump + JSONL append
  panel.html      plain HTML/CSS/JS, no app styling
  types.d.ts      shared structural types
```

The load-bearing seam: **`snapshot.js` is the only module that touches the
network.** Everything downstream is a pure function of a plain object, so
`project`, `provenance`, `integrity` and `merge` test against hand-written
fixtures with no `firebase-admin` and no emulator — the same dependency-injection
posture `telegram-auth.js` already uses via `TelegramAuthDeps`, which is what
makes its handlers testable at all.

## 5. Read model

One refresh issues a fixed set of reads in parallel: `users`, `userPrefs`,
`groups`, `telegramUsers`, `telegramByUid`, `pushTokens`, `locations`,
`locationCells`, the uid-keyed mailboxes, plus `admin.auth().listUsers()` paged
for account creation time and the `tg-*@telegram.invalid` marker.

`canvases` is read **shallow** — the REST endpoint `…/canvases.json?shallow=true`
with the service-account access token, since the Admin SDK has no shallow read.
`canvases/{pair}/strokes` is the only unbounded node in the database and the
panel must never load stroke bodies. Canvas rows therefore show presence, peer
uid and last activity, but **not** stroke counts, which would cost one extra
shallow read per canvas.

Under 100 users this is roughly nine round trips per refresh. Refresh is an
explicit button; there are no listeners.

## 6. What the panel shows

**Row (per account):** uid (truncated, copyable), share `code`, provenance badge,
Auth-record creation time, last active (`users/{uid}/presence.lastSeen`), current
status, total contacts, group count, canvas presence, push-token count,
`notifyChannel`, location opt-in.

**Detail pane:**

- **Groups** — per group: group name, the member's `displayName` *in that group*,
  `role`, whether they own it, and whether they carry a `statusOverride`.
- **Reachability** — push-token count with per-token `lastSeen`, and
  `notifyChannel`.
- **Location opt-in** — whether `locations/{uid}` exists, which gids have a
  `locationCells` entry, and the fix age of each.
- **Canvases** — peer uid and last activity.
- **Contacts** — broken into followers / following / mutuals. The row keeps the
  single "of any kind" total as originally specified; the breakdown appears only
  in the detail pane. It is free (§9 computes one-sided edges anyway) and a bare
  total hides exactly the asymmetry a merge exists to fix.
- **Telegram** — `tgId`, `chatId`, mapping `linkedAt`, and
  `userPrefs/{uid}/telegram/linkedAt`.

### 6.1 Provenance classification

| Category | Signal | Confidence |
|---|---|---|
| Telegram-derived (shadow) | `uid === deriveTelegramUid(tgId, secret)` | exact |
| Phrase account, no Telegram | not derived, no `telegramByUid/{uid}` | exact |
| Graduated (was derived, now phrase) | phrase uid **and** `userPrefs/{uid}/telegram/linkedAt < telegramUsers/{tgId}.linkedAt` | heuristic |
| Phrase account linked to Telegram | phrase uid **and** the two `linkedAt` values are equal | heuristic |

Whether a uid *has a phrase* is not directly observable — `uid = sha256(phrase)`
is one-way — but it is inferable: uids are minted by exactly three paths (web
`initUser` from a phrase, Telegram bootstrap via `deriveTelegramUid`, and
graduation to a phrase uid), so **not-derived implies phrase-born**.

The graduated-vs-linked split rests on a timestamp relationship rather than a
stored fact. `performLink` writes `userPrefs/{uid}/telegram/linkedAt` and
`telegramUsers/{tgId}.linkedAt` in the *same* update, so they are equal;
graduation copies the `userPrefs` subtree wholesale, so its `linkedAt` is the
original **bootstrap** time and is strictly older. **Known limitation:** a
graduated account that later re-links reads as "linked". The panel labels this
category as inferred rather than asserting it. Making it exact would require the
app to stamp provenance at graduation/link time — out of scope here, and worth
considering separately.

## 7. Merge

Merge is the one genuinely new primitive. `graduateAccountData(deps, oldUid,
newUid, extraWrites)` (`functions/telegram-auth.js:442`) is a *rename into a free
uid* — it hard-fails when the target exists (`already-exists`). Merging into a
**live** account means every moved path can collide.

**Two-phase, always.** `POST /merge/preview` returns the conflict report and the
complete write-set; `POST /merge/execute` replays that exact write-set under a
nonce. Nothing mutates until every collision has been displayed. Execution is a
single atomic `rootUpdate`, exactly as graduation does — a crash cannot
half-merge, and the loser's own subtree deletion folds into the same update via
the established `extraWrites` seam.

The operator picks the survivor per merge. The write-set walks the loser's
footprint and classifies each path: **target absent → move**, **target exists →
family rule**.

| Family | Rule |
|---|---|
| `userPrefs/{loser}` (hints, palette, favorites, `currentContext`) | survivor's prefs win wholesale |
| `following` / `followers` / `followerNames` / `notify` | union; survivor's entry wins on collision |
| peer backrefs (`userPrefs/{p}/following/{loser}`, `users/{t}/followers/{loser}`, `followerNames`) | repointed to survivor; a peer who followed **both** collapses to one card |
| `users/{loser}/invites` + `inviteIndex` | moved and repointed — outstanding invite links keep working |
| `groups/{gid}/members/{loser}` | survivor's member record wins; higher role wins; `ownerId` repoints to survivor |
| `users/{loser}/groups/{gid}` enumeration | union; higher `lastVisited` wins |
| `pushTokens` | union — both devices stay reachable |
| `locations` / `locationCells` | loser's dropped; republished on the next tick |
| `presence.lastSeen` | max of the two |

**Structural traps**, both handled by the shipped enumerator: canvas keys are
**sorted** uid pairs, so a merge must rebuild the key from `sorted([survivor,
peer])` rather than string-replace the uid — `crossRefRenderers()` emits both
orderings and moves whichever exists. And `canvases/{loser}_{survivor}` — a
canvas *between* the two merging accounts — becomes a self-canvas and is
special-cased to a delete.

**Decisions:**

- **D1. The loser's share code is freed** (its `codeIndex` entry deleted).
  Retaining it as a permanent alias resolving to the survivor would work, but
  nothing in the app ever cleans it and `presence.code` remains the single
  canonical code, so it would be invisible debt.
- **D2. Canvas collision → the survivor's drawing wins**, the loser's is deleted
  and recoverable from the pre-image dump. Two stroke histories for one pair
  cannot be concatenated into a coherent drawing.
- **D3. Mailboxes split by durability.** `knocks` and `calls` are **dropped** —
  stale within seconds, and merging call state is how a stuck call gets
  resurrected. `followRequests`, `followGrants`, `pendingInvites` and
  `revocations` are **unioned**: a pending group invite, or a revocation that
  blocks re-following, is real state.
- **D4. Per-group `displayName` → the survivor's wins**, with a per-group "adopt
  the loser's name" checkbox in the preview.

**Accepted consequence.** After a merge the loser's uid is empty, so typing the
loser's phrase later creates a fresh blank account rather than erroring. This is
inherent to `uid = sha256(phrase)`: there is nowhere to record a tombstone that
the sign-in path reads.

## 8. Purge, and the Telegram link use case

### 8.1 Purge

Purge is `expungeDerivedAccount(deps, uid)` (`functions/telegram-auth.js:319`)
unchanged. It already nulls the own
subtree, `codeIndex`, `inviteIndex`, every peer backref, canvases, group
memberships, owned groups wholesale, and the uid-keyed mailboxes, in one atomic
update. The panel adds the pre-image dump, the typed-uid confirm, and a
**preview** naming exactly which peers lose a contact and which groups are
deleted outright — owned groups vanish for *all* members, the sharpest edge in
the tool. Its two documented non-cleanups (knocks this uid sent sitting in other
inboxes; `notifierState` bookkeeping) surface in the integrity report instead of
staying invisible. For a phrase account the Telegram mapping teardown rides the
same `extraNulls` seam `unlinkTelegramHandler` uses.

### 8.2 What production does when linking

Linking a phrase account to a Telegram that already carries a standalone derived
account calls `expungeDerivedAccount(deps, prior.uid)` inside `performLink`
(`functions/telegram-auth.js:210`). **The derived account is destroyed, not
merged.** The only warning is `redeemTelegramLinkTokenHandler`'s
`needsConfirm: { reason: 'replace', counts: { contacts, groups } }`, which counts
only `followers`/`following`/`groups`. It is silent about groups the derived
account **owns** (expunge deletes those wholesale, for every member), canvases
with real drawing history, outstanding invite tokens and their `redemptionsUsed`,
and pending invites or follow requests. "contacts: 0, groups: 0" can still be a
lossy link.

### 8.3 Three actions

1. **Link impact** — the honest version of that warning. Renders
   `expungeDerivedAccount`'s write-set as losses in plain language: which peers
   lose a contact (by code and the name they use), which groups the account is
   dropped from, **which groups would be deleted outright and who else is in
   them**, canvases with peer and last activity, invite tokens with redemption
   counts, push tokens, pending state. Verdict is **safe to link** only when
   contacts, groups, canvases and redeemed invite tokens are all zero and prefs
   are default — strictly stronger than the app's gate. Transient residue
   (knocks, calls, location nodes) is listed explicitly as *not a loss* so the
   report is not noisy.
2. **Link via merge** — the operation production cannot perform.
   `merge(loser = derived, survivor = phrase)` with the mapping repoint folded
   into the *same* atomic write-set, mirroring `performLink`'s writes exactly:
   `telegramUsers/{tgId} → survivor`, `telegramByUid/{derived}` nulled,
   `telegramByUid/{survivor}` written, `userPrefs/{survivor}/telegram/{tgId,
   linkedAt}`, `notifyChannel: 'telegram'`. Net result is the link the user asked
   for with nothing lost — contacts, groups, per-group names, canvases and invite
   tokens all transfer under the §7 family rules.
3. **Link as production does** — expunge-then-link, byte-identical to
   `performLink`, for when the impact report says the derived account holds
   nothing.

**Why the panel can do this at all:** `performLink` requires signed Telegram
`initData`, which an operator cannot produce on a user's behalf. The panel writes
the mapping through the Admin SDK, and the `tgId` comes from the derived
account's existing `telegramByUid`/`telegramUsers` record — no `initData` in the
loop. Afterwards the user's next Mini App open resolves `tgId → survivor` through
`ensureTelegramUser` (mapping present, presence present, so no bootstrap), and
their phrase still signs them in on the web.

**Relink conflict.** If the phrase account already holds a *different* `tgId`,
`performLink`'s direct-relink branch resets the prior account's
`userPrefs/telegram` and sets `notifyChannel: 'push'`. The panel's preview must
surface that as a conflict and apply the same reset, or the two paths drift.

### 8.4 D5 — Firebase Auth records

Purge and merge leave the dead uid's Firebase Auth record behind; nothing in the
codebase deletes Auth users, so they accumulate (derived ones identifiable by the
`tg-*@telegram.invalid` synthetic email). **Decision: an optional "also delete
the Auth record" checkbox**, defaulting off.

**UNVERIFIED:** reading the code, custom-token sign-in creates the Auth user on
demand, so deleting a record appears harmless. This has not been exercised at
runtime and should be confirmed against the dev project before the checkbox is
trusted in prod.

## 9. Integrity report

Report-only. Each finding renders as `severity · check-id · uid/path · one-line
explanation`.

- **Follow graph** — one-sided edges (`users/{a}/followers/{b}` without
  `userPrefs/{b}/following/{a}`, and the reverse); backrefs pointing at a uid
  with no presence; `followerNames` entries with no matching `followers`.
- **Indexes** — `codeIndex` entries resolving to a dead uid or to a uid whose
  `presence.code` has since rotated; a `presence.code` with no index entry;
  `inviteIndex` ↔ `users/{uid}/invites` mismatches in both directions.
- **Groups** — members with no user record; membership without the
  `users/{uid}/groups/{gid}` enumeration entry (**the exact breakage
  `repair-user-groups.js` was written to repair** — this check is its detector);
  `ownerId` not in `members`; empty groups; enumeration entries for groups that
  no longer exist; `pendingInvites` ↔ `pendingInvitesByGroup` asymmetry;
  `groupIdIndex` entries with no group.
- **Telegram** — `telegramUsers/{tgId}.uid` → dead uid; `telegramByUid` without
  its reciprocal mapping; the two disagreeing; `userPrefs/{uid}/telegram/tgId`
  disagreeing with `telegramByUid/{uid}`; and the user-visible one,
  **`notifyChannel: 'telegram'` with no mapping** — notifications silently going
  nowhere.
- **Residue** — knocks whose sender or recipient no longer exists (the documented
  `expungeDerivedAccount` non-cleanup, now visible); `calls/{uid}` older than the
  stale-call window; `locationCells/{gid}/{uid}` for a non-member;
  `locations`/`pushTokens` for dead uids; canvases naming a dead uid.
- **Availability invariant** — `status: 'available'` with null or absent
  `availableUntil`, on presence nodes *and* group `statusOverride`s. This is what
  `functions/audit-available-null.js` checks; folding it in gives one place to
  look. That script stays as-is.
- **Auth ↔ RTDB** — Auth records with no RTDB user (including
  `tg-*@telegram.invalid` orphans), and RTDB users with no Auth record.

## 10. UI

One page, plain HTML with an inline `<style>` and a small inline `<script>` — no
framework, no build, no app CSS. The CSP inline-script landmine does not apply:
nothing here is served by Hosting or covered by `firebase.json`'s hash pinning.

Top bar: project name, the prod banner when gated, a refresh button, and the
snapshot timestamp — since reads are snapshots rather than live, showing *when*
is part of not acting on stale data. Below it, a sortable and filterable user
table (§6 row fields); clicking a row opens the detail pane (§6). Actions live in
the detail pane — Merge, Purge, Link impact, Link via merge, Link as production —
and each opens the same preview modal: conflicts, losses, write-set summary,
typed-uid confirm, execute. A second tab holds the integrity report.

## 11. Deploy-config prerequisites

Two unrelated `firebase.json` fields, both approved:

- **`functions.ignore`** — currently absent, so everything under `functions/`
  ships in the deploy archive. Add an `ignore` array excluding `ops/**`. Because
  specifying `ignore` **replaces** the defaults, it must re-list `node_modules`,
  `.git`, `firebase-debug.log`, and `firebase-debug.*.log`.
- **`hosting.ignore`** — add `functions/**`.

The hosting change is a **confirmed pre-existing exposure, not a
panel-introduced one.** Hosting is `"public": "."` and its ignore list omits
`functions/**`; Firebase Hosting uploads everything under `public` minus
`ignore` and does not auto-exclude the functions source directory. The operator
confirmed with `curl -sI https://<site>/functions/telegram-auth.js` → **200**:
the deployed site serves Cloud Functions source as static files today. This is
not a secret leak — the repository is public and `TELEGRAM_UID_SECRET` lives in
env, not source — but it is server-side code on a public URL, and it is what
would publish `functions/ops/panel.html`. Nothing under `functions/` is fetched
by the web app at runtime (`_shared/` is a build-time mirror), so the exclusion
is safe.

## 12. Testing

Tests live in `functions/test/ops-*.test.js` and run under the existing
`cd functions && npm test`. A shared fixture world — a handful of users spanning
all four provenance categories, two groups with one owned, a canvas pair, a
Telegram mapping — backs them. No `firebase-admin`, no emulator.

- `provenance` — all four categories, plus the `unknown` degradation when
  `TELEGRAM_UID_SECRET` is absent.
- `project` — row and detail projection.
- `integrity` — one red-first test per check.
- `merge` — per-family rules, every collision case, the self-canvas special case,
  and sorted-pair key ordering.
- **Parity test (highest value).** The merge write-set must cover every path
  family `crossRefRenderers()` emits. The source comments state outright that
  expunge and graduation share that enumerator *specifically* so a new residue
  family cannot be added to one and missed by the other. Merge becomes its third
  consumer; this test is what stops it being the one that drifts.

`snapshot.js` and `server.js` stay thin and get a documented manual smoke against
the dev project rather than mocked network tests.

## 13. Open and unverified

- **Auth-record deletion (§8.4)** — behaviour after deleting a custom-token uid's
  Auth record is reasoned from source, not exercised. Confirm on dev first.
- **Graduated-vs-linked provenance (§6.1)** — heuristic, and wrong for a
  graduated account that later re-links. An explicit provenance stamp written by
  the app would make it exact; that is an app change, deliberately out of scope.
- **Merge is unproven against real data.** First runs belong on the dev project,
  with the pre-image dumps checked before any prod use.
