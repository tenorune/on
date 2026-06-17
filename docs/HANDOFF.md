# KnockKnock — Session Handoff

A handoff to whoever picks this up next. Read top-to-bottom; specific subsections can be re-skimmed when working in a particular area.

**Most recent work (session 2026-06-13):** a hygiene/perf/bugfix/docs sweep, all merged to `dev`. Highlights: a **shared presence hub** (`js/presenceHub.js`) that dedupes overlapping `watchPresence` listeners (#214 R3); the **client RTDB-listener efficiency** fixes R1/R2/R5/R6 (#214); a **shared status-dot/text renderer** (`paintStatusDot` / `availableForText`, #216); the **`permission_denied` console-error fix** (the peer-ended endCall double-teardown); the **hosting `no-cache` caching fix** (the long-standing "have to clear cache to see updates" bug); and an **add-person `<label for>` a11y fix**. The 12-June analysis transcripts were reconciled against the tracker and the gaps filed as #214–#218. See **§18** for the full per-item rundown.

**Next likely action:** tag + deploy `dev → main`. The previous prod release is `v1.0.0` (Phases 0+1+2 + userPrefs migration). **No manual cache step is needed** — `firebase.json` serves everything `no-cache` and `sw.js`'s `CACHE` is auto-stamped with a content hash at build (see §Service worker cache).

**Open follow-up work** (issues, not blockers — full list in §18):
- **#214 R4** — suspend Direct presence watches while in a group context. Deliberately separated from R3 because it's entangled with context-switching, call-mode, and flash-avoidance. The biggest dedup win (R3) already shipped.
- **#215** — Direct availability pushes carry no shared-context label (group pushes do).
- **#217** — doc drift (Phase 2 toggle-OFF + invite-push phasing). **Reconciled 2026-06-13** (HANDOFF §15, Phase 2 plan, groups spec); pending maintainer close.
- **#218** — consolidated post-MVP groups backlog (admin role, owner group color, >5-card collapse, dup-name UI, approval-gated joins).

**Phase 4+:** request-to-follow (`js/followRequests.js`), group color/palette, and the per-audience (per-group) color picker have since **shipped**. Admin role and ownership transfer remain documented in groups spec §16 but unplanned (tracked: #180, #218).

**Recently closed bugs:** #64 (knock float-to-top tab-return) and #116 (Direct swatch `<div>` a11y) are now resolved — earlier handoffs cited them as open; they are not.

---

## 1. What KnockKnock is

A vanilla-JS PWA for **ambient presence**. Users mark themselves "available for N hours" and contacts see their status with personalized color themes. Layered features: knock-to-pulse, swipe-to-call, shared collaborative drawing canvas during calls, and (Phases 1–3) groups with per-group display names, per-audience status, invite links, and in-app push invites.

- **Target user base:** 50–100 users (a small, hands-on sandbox, not a public app).
- **Stack:** vanilla ES modules (no framework), Firebase Realtime Database + Hosting, esbuild, jest + jsdom.
- **Tests:** 1128 currently passing on `dev` (web suite, 39 suites). Cloud Functions have their own suite — 67 tests (`cd functions && npm test`). Run the web suite with `npx jest`.
- **Phrase-based identity with Firebase custom-token auth** (`validateRecovery` callable + `auth.uid`-scoped rules) — see §4.

## 2. Repo & branch model

```
main                         → prod   (Firebase project: knock-knock, tagged v1.0.0)
dev                          → dev    (Firebase project: on-on-22cb4)
feature branches (off dev)  → merged to dev by the user
```

- **Deploys via GitHub Actions.** Push to `main` → prod; push to `dev` → dev. Workflows live in `.github/workflows/deploy-{dev,prod}.yml`.
- **Required repo secrets:** `FIREBASE_CONFIG_{DEV,PROD}` (env file contents), `FIREBASE_SERVICE_ACCOUNT_{DEV,PROD}` (GCP service account JSON).
- **`production` environment** with required-reviewer rule gates prod deploys.
- **Critical CI gotcha:** the deploy step extracts `FIREBASE_PROJECT_ID` via `grep + cut` — *not* by sourcing the env file. Sourcing was fragile against secret formatting. Don't revert.
- **CI deploys `--only hosting,database`.** Database rules are pushed alongside hosting. If you change `database.rules.json`, the next deploy carries it.
- **Local deploys also push rules.** `npm run deploy:dev` and `npm run deploy` both use `--only hosting,database`.
- **Branch policy: NEVER push to `dev` or `main`.** Do feature work on branches cut from `dev`, push the feature branch, and the user merges it to `dev` themselves (then `dev` → `main`).

## 3. Code layout

```
/index.template.html       Source of truth (built into index.html via build script)
/index.html                Build output (gitignored)
/js/                       ES modules
/css/app.css               Main stylesheet
/css/canvas.css            Canvas-screen styles
/scripts/                  Build scripts
  dev.js                   esbuild watch + local dev server
  dev-build.js             Build for dev env
  dev-deploy.js            Build + firebase deploy --only hosting,database (uses .env.local)
  prod.js                  Build for prod env
  build.js                 Shared env-loading + index.html template substitution
  gen-wordlist.js          One-shot generator for js/wordlist.js (idempotent)
/tests/                    Jest tests
/docs/                     Project docs
/docs/superpowers/specs/   Design specs (YYYY-MM-DD-<topic>-design.md)
/docs/superpowers/plans/   Implementation plans
/.github/workflows/        CI
/database.rules.json       Firebase RTDB rules
/firebase.json             Hosting + RTDB config + CSP headers
/sw.js                     Service worker (PWA shell cache)
```

### Key JS modules

| File | Purpose |
|---|---|
| `js/app.js` | Main init (`main()` is split into named init steps: `initOwnStatusSync` / `initPaletteBoot` / `initPushNotifications` / `initCallRecovery` / `initServiceWorker`), `ensureIdentity`, own-status sync via `subscribeOwnStatus` (from `ownStatus.js`), screen orchestration, invite-redemption dispatch, group-context switching. **`initNavRow()` must be called BEFORE the `onContextChange(enterGroupContext)` registration**. The redemption block primes `setLastKnownGroupName(groupId, knownName)` before `navigateToGroup`. `#main-ui-direct` starts hidden in markup and is revealed at the end of `main()` only if the current context is not a group. **`initOwnStatusSync`'s callback gates `--my-status` / `--my-glow` / theme-var writes on `getCurrentContext().context === 'direct'`** — the synchronous `applyPaletteVars(selectedKey)` at boot is also gated — both prevent the Direct primary echo from clobbering the group override's color (fix commit `e3ebc37`). **`initCallRecovery` one-shots `watchOwnCall`** (captures the unsub, tears down after first fire — #214 R1) and **`initFollowGrants`'s unsub is stored** in a module var (#214 R2). |
| `js/identity.js` | Secret phrase generate/parse/derive, localStorage v2 schema |
| `js/wordlist.js` | 7772-word EFF long wordlist (regenerate via `scripts/gen-wordlist.js`) |
| `js/db.js` | **Barrel re-export — the single import point for RTDB ops, but the implementations now live in `js/db/{social,groups,canvas}.js`** (split in #183 H5). `db.js` re-exports `* from db/social.js`, `* from db/groups.js`, `* from db/canvas.js`, plus the time/format helpers from `js/utils.js` (`isExpired`, `isAvailable`, `timeRemainingMs`, `formatTimeRemaining`, `formatTimeRemainingFuzzy`, `formatLastSeen`). Call sites still `import { … } from './db.js'`. **`db/social.js`** = identity/presence, code/invite indexes, personal invites, followers/following, userPrefs, **calls mailbox** (`startCall`/`answerCall`/`endCall`/`watchOwnCall`), knocks. **`db/groups.js`** = group CRUD, members, group invites, pending-invite mailbox. **`db/canvas.js`** = shared-canvas strokes. |
| `js/ownStatus.js` | **Single own-status watch, fanned out.** `subscribeOwnStatus(cb)` multiplexes one `watchPresence(myUid)` to all own-status consumers (app.js, groupNav, groupContext) instead of each opening its own — the precedent the presence hub (#214 R3) generalizes. Synchronous-replay of the cached value to late consumers. |
| `js/presenceHub.js` | **NEW (#214 R3). Shared per-uid presence-watch registry.** `subscribePresence(uid, cb)` multiplexes one underlying `watchPresence(uid)` (`onValue` on `users/{uid}/presence`) out to every consumer, ref-counted: created on the first consumer, torn down when the last leaves. A uid that is both a Direct followee *and* a group co-member is now watched **once** instead of twice. The last value is cached per uid and async-replayed to a late consumer so a second subscriber doesn't flash "Unavailable" until the next write. **Consumers register BEFORE the underlying watch is created** so a synchronous first delivery still reaches them. `following.js` + `groupContext.js` both subscribe through here. |
| `js/store.js` | localStorage operations |
| `js/prefs.js` | Central preferences store. Reads stay synchronous via localStorage cache; writes hit both localStorage AND `userPrefs/{uid}/...` via `mergeUserPrefs`. Exports the hint API (`isHintSeen` / `markHintSeen`), call counters, favorites-collapsed, palette state (direct + per-group), favorites, chip minutes (direct + per-group), context, and `getFollowing()` (re-exported from store). `syncFromServer` dispatches CustomEvents for cross-module re-render without creating circular imports. |
| `js/me.js` | Own-status UI (header, dot, time chip), `initHeader`, `applyOwnStatus`. Exports `clearFirstUsePulse` (used by groupContext after clone-and-replace wipes the FTU once-listener). |
| `js/following.js` | Direct-contacts list rendering (Mutuals/Following/Followers), call mode, knock UI, 20s float-to-top survival. **Exports `getCurrentFollowersMap` / `getCurrentMutuals`** — snapshot accessors used by the Phase 3 invite picker without setting up a duplicate subscription. **Subscribes to presence via `subscribePresence(uid)` (the shared hub), not `watchPresence` directly** (#214 R3). Status dot + text rendered through the shared `paintStatusDot` + `availableForText` helpers (#216). **`exitCallMode(myUid, { peerEnded })`** — when the *peer* ended the call (`handlePeerEnded`), it passes `{ peerEnded: true }` so we DON'T re-call `endCall` and clear the peer's already-empty mailbox (that redundant write was the `permission_denied "at /"` console error). |
| `js/mycode.js` | Share-code drawer + secret-phrase reveal pill + invite-link button |
| `js/palettes.js` | Palette definitions, swatch picker, theme application, cross-device sync. **Centralized hint predicates moved to `js/hints.js`**; this file just consumes them. The hint-wave timers are now per-row in a `Map<Element, timeoutId>` so Direct + group rows animate independently. The `_paletteEnterAt` timestamp pattern keeps the `key-spin` animation alive across the userPrefs echo re-render. **Also home to the shared `paintStatusDot(dot, { color, available, palettesEnabled })` renderer (#216)** — the single status-dot painter (3-branch: available+color+palettes → bg+border+glow; available+color → bg only; else clear) used by both `following.js` and `groupContext.js` so the two rosters can't drift. (`availableForText` lives in `js/utils.js`.) |
| `js/hints.js` | **Centralized hint-visibility predicates.** `shouldShowSwatchWave`, `shouldShowThemeHint`, `shouldShowDotGoHint`, `shouldShowSetTogglePulse`, `isLongpressHintEligible`, `isSwipeHintEligible`. Each renderer (palettes/groupContext/following) imports and calls these instead of re-deriving the gate inline. Context-specific guards (override.enabled, PALETTE_INTERACTIONS_ENABLED, peer-availability) remain at call sites. |
| `js/favorites.js` | Favorites strip + `getCanvasColors()`. Strip is also rendered in group contexts. `saveCombo` is the single writer (full-array dedupe + head-match fast path). |
| `js/canvas.js` | Shared drawing canvas during 1:1 calls |
| `js/knock.js` | Knock pulse mechanics, 20s float-to-top anchor, group-card unread badge. Live pulse uses `.knock-live` CSS keyframe class. 60s clock-skew tolerance. `pendingByGroup` Map holds knocks received while user wasn't in the relevant group context; `drainPendingKnocks(groupId)` replays them on enter. Scroll-to-top uses non-smooth, multi-target writes. `floatTimers` entries track `startedAt` — but issue #64 reports this doesn't actually restore on tab return; unfixed. |
| `js/features.js` | Feature flags (see §5) |
| `js/invites.js` | Invite-link business logic: token gen, create/revoke/regenerate (both personal + group), redemption with structured `{ok, reason}` results, `attemptRedeemFromUrl` dispatch, `resolveInvitePreview` for welcome-screen framing. |
| `js/inviteModal.js` | Shared modal component, scope-parameterized via `SCOPE_COPY.{personal,group}`. **Dismiss on tap-outside or Escape** (Cancel/Close buttons removed in Phase 3). Group scope renders **Section 2 (in-app picker)** below the link section; personal scope hides it. Group title: `"Invite to {group name}"`. |
| `js/invitePicker.js` | **NEW (Phase 3).** In-app invite picker module. Renders mutuals (by local label) then non-mutual followers (by share code). Excludes current group members and the inviter themself. Multi-select state, Invite button writes `pendingInvites` via `writePendingInvite`, rows flip to "Invited" pill in place, tapping the pill un-invites via `deletePendingInvite`. Data is injected by the caller (followers map, mutuals list, current member set, pending invitee set) — no subscriptions inside the module. |
| `js/inbox.js` | **NEW (Phase 3).** Invitee-side Inbox. Subscribes to `watchPendingInvites(uid)`. `renderInboxNavSlot()` populates `#nav-row-inbox-slot` with an "Inbox" button when there's ≥1 pending invite, hidden when 0. `openInboxModal()` reveals `#inbox-modal` and lists all pending invites with per-row Join/Decline. `handleJoin` does race-protection (`readMember`/`readGroup` in parallel), prompts for displayName via `showGroupDisplayNamePrompt`, calls `joinGroup`, deletes pending, navigates. Join button has a double-tap guard. Modal dismisses on tap-outside or Escape. |
| `js/groupDisplayNamePrompt.js` | **NEW (Phase 3).** Extracted from `js/app.js` so both Flow A/B (link-redemption) and Flow C (Inbox Join) share the same `#group-displayname-screen` prompt component. |
| `js/groups.js` | Group lifecycle business logic: `createGroup` / `renameGroup` / `deleteGroup` (owner-only) / `joinGroup` / `leaveGroup` / `editOwnDisplayName`. **`deleteGroup` now sweeps `pendingInvites/*/{groupId}` before removing the group entity** (Phase 3) so a concurrent Inbox Join sees the group missing and silently dismisses. `initGroupRemovalDetector` surfaces a toast when a group disappears from enumeration. |
| `js/groupNav.js` | Nav state machine: `currentContext`, `navigateToDirect` / `navigateToGroup`, listener pattern via `onContextChange`. Persistent sticky nav row. Direct context: each group as `.group-card` + `+`. **`renderNavRowDirectMode` injects `#nav-row-inbox-slot` as its first child and calls `renderInboxNavSlot()` after** so the Inbox button appears before group cards. Group context: Direct back-link + group name + override toggle (`=`/`≠`) + Direct card on right. Override toggle is owned here; cross-module sync via `applyOptimisticOverride` exported from groupContext. |
| `js/groupContext.js` | Group context view: own-status row + roster + per-group palette picker. Hosts `_ownOverride` / `_ownPrimary` / `_membersOverrides` / `_memberPrimaries` plus `_groupOwnerId` / `_groupName` captured from `watchGroupMeta`. **`syncStatusSubscriptions` subscribes to member presence via `subscribePresence(uid)` (the shared hub, #214 R3)** and paints via `paintStatusDot` + `availableForText` (#216). Shares the `exitCallMode(..., { peerEnded })` peer-ended contract with `following.js`. **`renderRoster` renders an owner-only `+ Invite to group` row** at the top (Phase 3), opening the unified invite modal. The "Invite" entry in the settings menu (renamed from "Invite link") also opens the same modal with picker data. Both pass `getCurrentFollowersMap()` / `getCurrentMutuals()` / `new Set(Object.keys(_membersOverrides || {}))` so the picker can filter to non-members. |
| **Onboarding install (2026-06)** | `onboardingLane()` in `js/installGuidance.js` routes per platform; `js/installPrompt.js` captures `beforeinstallprompt`; `js/installAffordance.js` renders the bottom-left install fab + toast. iOS uses a Keychain-save (recovery modal hidden credential form) → standalone restore-primed handoff (`shouldPrimeRestore`). The phrase-reminder block is shared from `js/notifyPrompt.js`. Notifications remain bell-gated/unchanged. Spec: `docs/superpowers/specs/2026-06-16-onboarding-install-redesign-design.md`. |

## 4. Identity model (load-bearing — read this carefully)

v2 (secret-phrase derived):

- A user's identity = a **4-word "secret phrase"** drawn from `js/wordlist.js`. Format: `swift-river-amber-dust`.
- `userId = sha256(phrase).slice(0, 32)` — **deterministic**. Typing the same phrase on any device restores the same account.
- **The phrase is the only *credential*.** Anyone who has it can claim the account. (Sign-in itself uses Firebase Auth custom tokens minted from the phrase — see the auth trust model below — but there's no email/password/social login.)
- localStorage shape: `statusapp_identity = { userId, code, recoveryCode }`.
- Welcome screen surfaces `I'm new` / `I have a secret phrase` on empty localStorage. The welcome screen also takes optional `inviteCreatorLabel` / `inviteGroupName` to frame the screen for brand-new users arriving via an invite link.
- Drawer has a "Show secret phrase" pill for recovery.
- `crypto.subtle.digest('SHA-256', ...)` is used for derivation — works in browser and Node 20+.

**Auth trust model (R1 + R1.5 shipped — this is the "Phase B" the older docs called future):** Firebase Auth via **custom tokens**. `ensureSignedIn(phrase)` calls the rate-limited `validateRecovery` Cloud Function (`functions/auth.js`, the onCall in `functions/index.js`) with the phrase; it mints a Firebase custom token for the derived uid; the client `signInWithCustomToken`s, so `auth.uid === userId`. `database.rules.json` is scoped to `auth.uid === $uid` with field-level `.validate` — the broadcast `presence` subtree is readable by any authed user, everything else is owner-scoped (knocks/calls/pendingInvites/followRequests use `auth.uid`-keyed mailbox rules). The one remaining hardening is **App Check enforcement (deferred, #193)**. (The phrase is still the only credential — anyone with it can claim the account.)

## 5. Feature flags

`js/features.js` exports seven flags:

```js
PALETTES_ENABLED               // Palette swatch picker, color theming
PALETTE_INTERACTIONS_ENABLED   // Favorites strip + adoption + hints
KNOCK_ENABLED                  // Knock pulse system
CALL_ENABLED                   // Swipe-right call + canvas
GROUPS_ENABLED                 // Group cards row, group context view, invites, Inbox
NOTIFICATIONS_ENABLED          // Web Push / FCM presence notifications (notifier program)
FOLLOW_REQUESTS_ENABLED        // Request-to-follow a co-member (groups §11)
```

- **Currently on `dev` AND `main`:** all seven flags `true`.
- These are compile-time constants. Changing means editing + redeploying.
- **All test suites mock `../js/features.js`** per-suite. Flipping real values doesn't affect tests.
- A recurring lesson: **render-layer gates must match handler-layer gates.** A stale render path can keep showing UI for a feature that's been disabled at the handler.

## 6. Cross-device sync

When the same secret phrase is used on multiple devices, **everything that's user-state syncs**. There are three subscription paths:

- **Own status:** `subscribeOwnStatus(cb)` (in `js/ownStatus.js`, fanned out from one `watchPresence(myUid)`) drives the broadcast-shaped subtree **`users/{uid}/presence/...`** (status, availableUntil, statusColor, paletteKey, code, ...). Every follower watches the *other* user's presence via `subscribePresence(otherUid, cb)` → `watchPresence` → `onValue` on `users/{uid}/presence`, so anything here goes out to every follower on every tick. Keep it lean. **Calls are NOT a field here** — call signaling uses per-user mailboxes at `calls/{uid}` (`startCall`/`answerCall`/`endCall`/`watchOwnCall`), and knocks use `knocks/{recipient}/{sender}`.
- **`watchUserPrefs(myUid, cb)`** in `js/app.js` — drives the private subtree `userPrefs/{uid}/...`. Only the owner reads it; followers don't subscribe. New private state belongs here.
- **`watchPendingInvites(myUid, cb)`** in `js/inbox.js` — drives the mailbox subtree `pendingInvites/{myUid}/...`. Each child key is a `groupId` (deterministic, one entry per (invitee, group) pair). Callback receives a map of `groupId → { from, ts }`.

The pattern in each callback is the same: reconcile local with server. `prefs.syncFromServer` dispatches CustomEvents (`palette-state-synced`, `favorites-synced`, `last-timeout-synced`, `current-context-synced`, etc.) so other modules can re-render without `prefs.js` importing them (avoids circular imports).

| Surface | Mechanism |
|---|---|
| Status / availability / availableUntil | `subscribeOwnStatus` → `applyOwnStatus` |
| Dot color (`--my-status` CSS var) | `subscribeOwnStatus` → setProperty **only when context is Direct** (the gate prevents clobbering the group override) |
| Theme variables | `subscribeOwnStatus` → `applyThemeVars` / `resetThemeVars`, also gated on Direct context |
| Share code (rotated on another device) | `subscribeOwnStatus` → `updateMyCode` |
| Followers list | `watchFollowers` (separate subscription) |
| Following list (contacts) | `watchFollowing` at `userPrefs/{uid}/following` → `syncFollowingFromServer` |
| Group enumeration | `watchUserGroups` (separate subscription) → cards row + removal detector |
| Per-group meta | `watchGroupMeta(groupId, cb)` per enumerated group → card name + last-known-name cache |
| Own per-group status override | `watchOwnMemberOverride(groupId, ownUid)` per enumerated group → card color + group-context status row |
| Group roster + statuses | `watchGroupMembers(groupId, cb)` + per-member `subscribePresence(memberUid, cb)` (shared hub) |
| Personal invite collection | `watchUserInvites` → drawer button label |
| **Pending invites mailbox** (Phase 3) | `watchPendingInvites(uid, cb)` → Inbox button + Inbox modal |
| All userPrefs | `watchUserPrefs(uid, cb)` → `prefs.syncFromServer` → CustomEvents → per-module re-render |

## 6.5. userPrefs schema

`userPrefs/{uid}/` keeps private user state out of the broadcast subtree.

```
userPrefs/{uid}:
  hints/{name}: true                            // 'bolt' | 'flower' | 'theme' | 'stripPeek' | 'longpress' | 'swipe' | 'customAvail'
  madeCallCount: <number>                       // server max-wins
  answeredCallCount: <number>                   // server max-wins
  favoritesCollapsed: <bool>
  paletteState/direct: { ... }
  favorites: [<combo>, ...]
  lastTimeoutMinutes: <number>                  // Direct chip default
  currentContext: 'direct' | 'group:{groupId}'  // synced device-to-device
  following/{followeeUid}: { code, label }
  perGroup/{groupId}:
    paletteState: { activeSet, sets: { 1: {...}, 2: {...} } }
    lastTimeoutMinutes: <number>                // per-group chip default
```

What stays in `users/{uid}/`: everything followers need to see — the broadcast `presence/` subtree (status, statusColor, paletteKey, availableUntil, code), plus `followers/`, `revokedFollowers/`, the group enumeration (`groups/{groupId}`) and the personal-invite collection (`invites/{inviteId}`). Call signaling is NOT here — it lives in the top-level `calls/{uid}` mailbox.

Sync wiring:
- `mergeUserPrefs(uid, fields)` in `db.js` is the multi-path atomic write helper.
- `watchUserPrefs(uid, cb)` is wired in `app.js` `main()` after `initPrefs(uid)`.
- `prefs.syncFromServer(serverPrefs)` repopulates localStorage and dispatches CustomEvents.
- **Don't import UI modules from `js/prefs.js`.** Cross-module re-renders go through CustomEvents.

## 6.6. Pending-invite mailbox schema (Phase 3)

```
pendingInvites/{inviteeUid}/{groupId}: { from: inviterUid, ts: timestamp }
pendingInvitesByGroup/{groupId}/{inviteeUid}: true     // sweep index
```

- **Deterministic key** (`{groupId}`, not a random `inviteId`) so re-inviting the same person to the same group is a natural overwrite — no duplicate entries, no race window between read-check and write.
- **Dual-write / dual-delete** via `update(ref(db), { multipath })` for atomicity. `writePendingInvite` writes both paths; `deletePendingInvite` nulls both.
- **Sweep index** (`pendingInvitesByGroup/{groupId}`) lets `deleteGroup` enumerate affected invitees without scanning the entire `pendingInvites` tree. `readPendingInviteesForGroup(groupId)` returns the list of uids. `groups.deleteGroup` calls this first, deletes each pending invite, then removes the group entity.
- **Top-level mailbox** is Phase-B-rules-compatible without a Cloud Function (inviter writes own, invitee reads/deletes own, both can delete; rules sketch in spec §10 Flow C).
- **No TTL in MVP.** Invites wait until accepted, declined, or revoked.

## 7. Phase 0–3 data model (summary)

Per the groups spec §7 (rev 2, with Phase 3 update):

```
groups/{groupId}:
  name, ownerId, createdAt, (color/paletteKey: post-MVP)
  members/{memberUid}: { role, displayName, joinedAt, statusOverride?:Phase2 }
  invites/{inviteId}: { scope: 'group', token, creatorUid, ts, cap, revoked, ... }

users/{uid}:
  // existing fields ...
  groups/{groupId}: { lastVisited? }                  // enumeration only
  invites/{inviteId}: { scope: 'personal', token, creatorLabel, ts, cap, revoked, ... }

userPrefs/{uid}/...                                   // private state, see §6.5

inviteIndex/{token}: { scope, ownerPath }             // global lookup for redemption
groupIdIndex/{groupId}: true                          // existence lock for transactional alloc
pendingInvites/{inviteeUid}/{groupId}: { from, ts }   // Phase 3 in-app push invites
pendingInvitesByGroup/{groupId}/{inviteeUid}: true    // Phase 3 sweep index
```

Key design decisions:
- **Membership is canonical at `groups/{groupId}/members/{uid}`.** The user-side `users/{uid}/groups/{groupId}` is just an enumeration index. Portable to Phase B rules.
- **`inviteIndex` is one shared lookup for both scopes.**
- **One active invite per scope-target.**
- **`pendingInvites` lives at a top-level mailbox path** so Phase B rules can express invitee-reads + inviter-writes-with-from-eq-auth.uid without a Cloud Function.

## 8. Layout & visual constraints

- `html, body { min-width: 360px }`, `body { max-width: 600px; margin: 0 auto }`. Canvas is `position: fixed; inset: 0`.
- Modals and overlay screens are fixed-positioned, full-viewport.
- Sticky `<div id="nav-row">` at the top, above both `#main-ui-direct` and `#group-context-root`. Inbox slot (`#nav-row-inbox-slot`) is first child in Direct mode.
- **Nav row height parity:** `.nav-row > *` is `height: 2.5rem`; `.group-context-header` mirrors `#app-header`.
- **`#main-ui-direct` starts hidden in markup** — revealed at end of `main()` only if current context isn't a group. Prevents the empty Availability shell from flashing during first-use redemption.
- **Modal dismissal convention:** tap outside the card (overlay click with `e.target === overlay` guard) AND Escape. Both `#invite-modal` and `#inbox-modal` follow this pattern.

## 9. CSP

`firebase.json` headers contain a CSP allowing:
- `*.firebaseio.com`, `wss://*.firebaseio.com`, `*.firebasedatabase.app`, `wss://*.firebasedatabase.app`, `*.googleapis.com`, `*.cloudfunctions.net` in `connect-src` (the last for the R1 `validateRecovery` callable)
- `*.firebaseapp.com`, `*.firebasedatabase.app` in `frame-src` (RTDB long-polling iframe; without this, realtime delivery silently fails on restrictive networks)

**The enforced CSP lives ONLY in the `firebase.json` header.** `index.template.html` also has a `<meta http-equiv="Content-Security-Policy">` but it is intentionally **commented out** (a meta CSP blocks `'self'` on local dev and ignores `frame-ancestors`). So new runtime hosts (e.g. the R1 Functions host) only need adding to `firebase.json`. If you ever re-enable the meta tag, keep its host list in sync — both would then be enforced as an intersection.

## 10. Build pipeline + deploy

`index.html` is generated from `index.template.html` at build time, with `__APP_TITLE__` substituted. `index.html` is gitignored.

Run locally:
- `npm run dev` — esbuild watch + local server (uses `.env.local`)
- `node scripts/dev-build.js` — build using `.env.local` once
- `node scripts/prod.js` — build using `.env.production` once
- `npm run deploy:dev` — build then `firebase deploy --only hosting,database --project <id>` (reads project id from `.env.local`)
- `npm run deploy` — prod build then `firebase deploy --only hosting,database` (uses `.firebaserc` default alias)

**Required local files (both gitignored):**
- `.env.local` — runtime config + dev `FIREBASE_PROJECT_ID`
- `.env.production` — prod env config
- `.firebaserc` (optional) — default project alias for prod

### Service worker cache

Two things make app updates reach users automatically — **no manual cache step is needed**:

1. **`firebase.json` serves everything `no-cache`** (a single `**` header rule). Because the app has no content-hashed filenames (`dist/bundle.js`, `css/app.css`, `index.html` change in place), every file must revalidate; `no-cache` = store + revalidate → `304` when unchanged, fresh bytes right after a deploy. The CDN no longer pins shell assets at `max-age=3600`.
   - *History:* an earlier header rule used an extglob `source` (`@(/|/index.html|…)`) that Firebase Hosting silently doesn't match, so `index.html`/`sw.js`/`bundle.js` were served `max-age=3600` and CDN-cached for an hour — the root cause of the long-standing "have to clear cache to see updates" problem. Fixed by moving `no-cache` onto the `**` source (commit on `fix-hosting-no-cache-headers`).

2. **`sw.js`'s `CACHE` is auto-stamped** with a content hash of the shell at build time (`build.js` → `writeServiceWorker`: `knockknock-${sha256(shell).slice(0,12)}`). Any shell change yields a byte-different `sw.js` → the browser detects the update → install re-caches the fresh shell → activate purges the old cache → the app's `controllerchange` listener reloads. No literal version to bump.

Offline still works — the SW serves the shell cache-first from Cache Storage, independent of the HTTP `no-cache` headers.

### Tagging releases

Use `v<MAJOR>.<MINOR>.<PATCH>` per the existing tag history. Most recent release: `v1.0.0` (Phases 0+1+2 + userPrefs migration). Phase 3 should ship as `v1.1.0` (additive feature, no breaking changes) when promoted from dev → main.

## 11. In-progress work / what's next

**MVP per spec §17 (Phases 0+1+2+3) is complete on dev.** Awaiting dev → main deploy.

**No further phases planned right now.** Phase 4+ work (admin role, ownership transfer, request-to-follow, per-audience color picker, in-place edit of personal invite creator label, etc.) is documented in groups spec §16 Phase 4+ but not scheduled.

**Deferred follow-up tracked as issues** (full current list in §18):
- **#214 R4** — suspend Direct presence watches in a group context (R1/R2/R3/R5/R6 done).
- **#215** — Direct availability pushes carry no shared-context label.
- **#217** — doc drift (Phase 2 toggle-OFF + invite-push phasing).
- **#218** — post-MVP groups backlog.
- **#124** — Phase 3 inviter-side "sent invites" view + cross-device revoke. The MVP Phase 3 doesn't include this; the picker's in-modal "Invited" pill is the only revoke surface. Mirror at `userPrefs/{ownerUid}/sentInvites/{groupId}/{inviteeUid}` is the suggested shape.
- **#180 / #181 / #193 / #161 / #160 / #156 / #148 / #34** — longer-standing deferrals (moderation, invite controls, App Check, install nudge, Telegram channel, desktop-notif debug, lastVisited migration, npm deprecations).

*(Resolved since earlier handoffs: #64 knock float-to-top, #116 Direct swatch a11y, #182/#183 perf+hygiene waves, #216 status-dot renderer.)*

**Possible (not committed) follow-up:** collapse `palettes.renderSwatchRow` and `groupContext.renderGroupSwatchRow` into a single renderer (the "option 3" discussion). A compat test (`tests/swatch-renderers.compat.test.js`) locks down the structural-shape contract between the two; revisit only if a third caller appears or drift becomes a recurring source of bugs. *(Note: the status-**dot** painter and "Available for…" text were already unified into `paintStatusDot` / `availableForText` in #216 — that's the dot/text, not the swatch row.)*

## 12. Recent significant fixes & gotchas

**Phase 3 (in-app push invites, shipped to dev as PR #125):**
- 15-task plan executed via subagent-driven development (2-stage review per task + final integration review). Net: new `js/invitePicker.js`, `js/inbox.js`, `js/groupDisplayNamePrompt.js`; substantial extensions to `js/inviteModal.js`, `js/db.js`, `js/groups.js`, `js/groupNav.js`, `js/groupContext.js`, `js/app.js`; new DOM in `index.template.html`; new CSS; rule additions for `pendingInvitesByGroup`.
- **Race protection in Inbox-Join:** `readMember` + `readGroup` in parallel before joining. If already a member → silently delete pending and return; if group deleted → same.
- **Dual-write atomicity:** `writePendingInvite` and `deletePendingInvite` use `update(ref(db), { multipath })` for the primary + sweep-index pair.
- **`showGroupDisplayNamePrompt` extracted** from `js/app.js` into `js/groupDisplayNamePrompt.js` so Flow A/B (link redemption) and Flow C (Inbox Join) share one component.
- **Modal dismiss UX unified:** tap-outside + Escape on both invite and Inbox modals. Cancel/Close buttons removed.
- **Spec-compliant title:** invite modal in group scope now says `"Invite to {group name}"` (not `"Invite link for {group}"`).
- **Inbox Join double-tap guard:** disabling the button on first click prevents two `showGroupDisplayNamePrompt` calls.

**Group-context label color clobbered by Direct primary echo on boot (fix `e3ebc37`):**
- On fresh boot with `currentContext='group:X'` + override on, three async writers competed for `--my-status`. The synchronous `applyPaletteVars(selectedKey)` at `app.js:510` was the last writer (running after `await navigateToGroup` yielded the event loop and let Firebase callbacks fire). Result: group label rendered in the Direct picker color.
- Fix: gated both the sync `applyPaletteVars` AND the async own-status-sync callback's `--my-status` write (then `watchStatus`, now `subscribeOwnStatus`) on `getCurrentContext().context === 'direct'`. In group context, only `groupContext.applyEffectivePalette` writes `--my-status`.

**Hint system centralization:**
- All inline `localStorage.getItem('statusapp_*')` reads (17 of them) migrated through `isHintSeen('name')`.
- Six hint-visibility predicates centralized in `js/hints.js`: `shouldShowSwatchWave`, `shouldShowThemeHint`, `shouldShowDotGoHint`, `shouldShowSetTogglePulse`, `isLongpressHintEligible`, `isSwipeHintEligible`. Context-specific guards stay at the call site.
- Per-row hint-wave timers (`Map<rowElement, timeoutId>`) so Direct + group swatch rows animate independently. Previous design used a single module-global timer that stopped whichever row didn't render last.
- Per-active-set wave gating (not "both sets default") — picking a non-default in Set 1 doesn't kill Set 2's wave anymore.
- `key-spin` animation survives the userPrefs-echo re-render via `_paletteEnterAt` timestamp + CSS `--key-spin-delay` custom property.

**Cross-renderer compat test (`tests/swatch-renderers.compat.test.js`):**
- Mounts both `renderSwatchRow` (Direct) and `renderGroupSwatchRow` (Group) under matched palette state + hint flags and asserts the structural shape agrees on dimensions that should match (swatch count, `.selected` index, `.theme-hint` placement, `.hint-wave` count, key-swatch index, set-toggle position + pulse). Known accepted differences (tag, container ID, dataset name, `.group-swatch` class) are explicitly excluded.

**FTU first-use-pulse termination in group context:**
- `enterGroupContext` clones `#group-my-dot` and replaces it, which wiped the once-listener `enterFirstUseMode` installed for clearing `first-use-pulse`. Fix: exported `clearFirstUsePulse` from `me.js` and re-installed it as a once-listener on the dot clone in `groupContext.js`. Same FTU termination contract as Direct now.

**Default group members to Available for 2h:**
- `createGroup` and `joinGroup` write `statusOverride: { enabled: true, status: 'available', availableUntil: now + 2h }` so new members are immediately visible to fellow members. They can flip the override off via the nav toggle or tap the dot to go unavailable.

**Favorites sync race (fix `0f1f8f9`):**
- `prefs.syncFromServer` was overwriting local favorites with stale server data after a race with `mergeUserPrefs`. Fixed by MERGING local-only entries at head instead of overwriting. `dedupeServerFavorites` helper for the merge logic.

**Older significant fixes worth knowing:**
- Phase 1 navigation ordering (commit `9bcf602`): `initNav` + `onContextChange` must be wired before the redemption block.
- Phase 1 deletion detection for non-owners: `watchGroupMeta(null)` callback calls `removeUserGroupsEntry` so the local enumeration delta fires the removal toast.
- Phase 1 group-name cache for deletion toast (`53f1572`).
- Deploy scripts `--only hosting,database` (commit `07fd02e`) — local deploys must push rules.
- Knock pulse uses CSS keyframe class (`.knock-live`) not imperative inline-style transitions — same-tick prepend + scroll eats them.
- `#main-ui-direct` starts hidden in markup; revealed at end of `main()` only if context isn't a group.
- Canvas concurrent-drawing race (`61db133`).
- CSP frame-src `*.firebasedatabase.app` (`cdd845a`) — without it, realtime silently fails on restrictive networks.

## 13. Conventions

- **Commit messages:** `type: short description` first line + body. Types: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `ci:`, `build:`.
- **Spec/plan docs:** `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` and `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`.
- **Branch naming:** feature branches are cut from `dev` and named for the feature (e.g. `follow-group-member`). Long-lived: `main`, `dev`. The user merges to dev/main themselves.
- **Git user identity for this repo:** `tenorune` / `117549102+tenorune@users.noreply.github.com`.
- **Test-mock discipline:** **20 test files** (as of 2026-06-13) mock `../js/db.js` per-suite. Every new `db.js` export must be added as a `jest.fn()` stub in all of them. Run `grep -l "jest.mock.*'../js/db.js'" tests/ | wc -l` to confirm the current count and `grep -l ...` for the list. Missing entries cause `(0, _db.foo) is not a function` failures. **Note:** even though the implementations now live in `js/db/{social,groups,canvas}.js`, suites still mock the `js/db.js` barrel (call sites import from there). Tests touching the presence hub call `require('../js/presenceHub.js')._resetPresenceHub()` in `beforeEach` to avoid cross-test state leakage.
- **Placeholder identity discipline:** **never** use the project owner's first or last name in code, tests, fixtures, docs, commit messages, or chat replies. Use generic placeholders (`Alex K.`, `Bea`, etc.). The repo was previously scrubbed of references; keep it clean. **Don't put memory rules in a repo file (no CLAUDE.md).** Hold the rule in your session context.

## 14. Workflows & superpowers conventions

The user uses the **superpowers** skills. Workflow:
1. **brainstorming** skill → produces a spec at `docs/superpowers/specs/...`
2. **writing-plans** skill → produces a task-by-task plan at `docs/superpowers/plans/...`
3. **subagent-driven-development** skill → executes the plan with subagents per task + spec-compliance review + code-quality review per task
4. **finishing-a-development-branch** skill → wraps up

**Accessibility preferences:**
- **Don't use the `AskUserQuestion` tool's UI** — they can't read it. Ask questions inline in chat instead.

## 15. Things to know before changing things

- **Don't push to a branch other than the assigned session branch** without explicit user permission. The user merges to dev/main themselves via PR UI.
- **No manual `sw.js` `CACHE` bump.** It's auto-stamped with a content hash at build, and `firebase.json` serves the shell `no-cache` — updates propagate on their own (see §Service worker cache).
- **The SW must present a notification for EVERY push — never suppress on focus.** `sw.js`'s `push` handler calls `showNotification` unconditionally. Do **not** re-add a foreground de-dupe (`if (focused) return`) or any path that receives a push without displaying one: Apple's web-push rule is *"Safari doesn't support invisible push notifications… if you don't [present one], Safari revokes the push notification permission for your site."* A single suppressed push silently kills **all** future Safari delivery for that user (this cost a whole debugging session to find). The accepted tradeoff is a possibly-redundant banner when the app is already focused.
- **macOS Safari web push needs the installed Dock app.** In-browser macOS Safari accepts a push and silently never displays it; only the installed (File → Add to Dock) web app delivers reliably. `detectNotifyCapability` returns `needs-install-macos` for a non-standalone macOS Safari tab so the promo/bell show "Add to Dock" guidance (mirrors `needs-install-ios`) instead of an Enable button that leads to silence. iOS is the same (needs Home Screen install). The `#156` `NOTIFY_DEBUG` readout (`?notifydebug=1`) is the tool for diagnosing push issues — it surfaces token registration + whether a push reached the SW.
- **Don't introduce real-name placeholders.** See §13.
- **Don't create CLAUDE.md or similar memory files in the repo.** Hold rules in your session context.
- **Test the build after any change to identity / palette / canvas / groups / inbox / picker code** — the cross-device sync subtleties and the modal-stack ordering are easy to break.
- **Mind the 20 test mock files** (per §13).
- **Identity auth (R1/R1.5) is SHIPPED:** custom-token sign-in via the `validateRecovery` callable + `auth.uid`-scoped RTDB rules with field validation. The only remaining hardening is **App Check enforcement (deferred, #193)** — don't re-describe this as honor-system/not-built.
- **Phase 0/1/2/3 designs are forward-compatible with Phase B.** The membership-canonical-on-group-side layout, the top-level `pendingInvites/{inviteeUid}/...` mailbox path, the `groups/{groupId}/members/{uid}` self-write rule, and the `pendingInvites` `from === auth.uid` write rule were all chosen so Phase B doesn't need a Cloud Function.
- **`users/{uid}/` vs `userPrefs/{uid}/` split.** New private user state goes in `userPrefs/{uid}/...` via `js/prefs.js` (which calls `mergeUserPrefs`). Only put something in `users/{uid}/...` if followers genuinely need to see it on every status tick.
- **Don't import UI modules from `js/prefs.js`.** Cross-module re-renders go through CustomEvents.
- **Optimistic-update + cross-module sync pattern (load-bearing).** Both groupNav and groupContext have their own copies of own-override state. When one mutates it, it must call the other's optimistic-apply API.
- **`--my-status` writes from `app.js`'s own-status sync are gated on Direct context.** Don't add new `--my-status` setters that bypass the gate — the group override owns the var when context is group.
- **Toggling a group status-override OFF *preserves* its color/palette.** `toggleStatusOverride(OFF)` calls `mergeStatusOverride({ enabled: false, status: null, availableUntil: null })`, which keeps `statusColor`/`paletteKey` so an adopted color survives a toggle (the 2026-05-29 adoption behavior). It does **not** delete the whole `statusOverride` record. `clearStatusOverride` still exists as a db primitive but is no longer the toggle-OFF path. (Earlier versions of the Phase 2 plan described an old "delete the record" behavior; reconciled 2026-06-13 under #217.)
- **Knock pulse uses a CSS keyframe class, not inline-style transitions.**
- **`#main-ui-direct` starts hidden in markup.** Don't change without revisiting first-use UX flashes.
- **Hint predicates live in `js/hints.js`.** Don't re-derive `isHintSeen` chains inline; import a predicate. Context-specific guards (override.enabled, etc.) stay at call sites.
- **Hint-wave timers are per-row.** Don't reintroduce a single module-global timer.

## 16. Known unknowns / open decisions / open bugs

**Open issues (filed; full annotated list in §18):**
- **#214 R4 — suspend Direct presence watches in a group context** (R1/R2/R3/R5/R6 shipped this session). Entangled with context-switch + call-mode + flash-avoidance; deliberately its own pass.
- **#215 — Direct availability pushes carry no shared-context label** (group pushes do).
- **#217 — doc drift (reconciled 2026-06-13, pending maintainer close):** the Phase 2 plan described the old `clearStatusOverride` toggle-OFF (code uses `mergeStatusOverride`, which preserves `statusColor`/`paletteKey`) and framed the per-group picker + push-on-invite as Phase 4+ though both shipped. HANDOFF §15, the Phase 2 plan, and the groups spec §16 now describe the shipped behavior.
- **#218 — post-MVP groups backlog** (admin role, owner group color, >5-card collapse, dup-name UI, approval-gated joins).
- **#124 — Phase 3 inviter-side "sent invites" view + cross-device revoke.** The picker's in-modal "Invited" pill is the only revoke surface today (same-modal-session only, no cross-device).
- Longer-standing: **#180** (group moderation: kick + ownership transfer), **#181** (invite TTL/cap UI + confirm card + label edit + index sweep + stale "Requested"), **#193** (App Check enforcement — flag-day risk, deferred), **#161** (standalone install nudge), **#160** (Telegram notification channel), **#156** (desktop PWA notification debug), **#148** (lastVisited userPrefs migration, Option A), **#34** (npm deprecation warnings).

*(Closed since earlier handoffs: **#64** knock float-to-top tab-return, **#116** Direct swatch `<div>` a11y. Both were previously listed here as open.)*

**Open decisions:**
- When (if) to do Phase B identity tightening.
- Whether to collapse `palettes.renderSwatchRow` and `groupContext.renderGroupSwatchRow` into a single renderer. The compat test in `tests/swatch-renderers.compat.test.js` catches drift cheaply; collapse only if a third caller appears.
- Whether the post-MVP "co-members can use 1:1 primitives without mutual" relaxation lands soon.
- `database.rules.json` IS now `auth.uid`-scoped with explicit rules + field `.validate` across the tree — including `userPrefs/{uid}` (owner-only), `pendingInvites/{inviteeUid}` and `followRequests/{targetUid}` (mailbox rules keyed on `auth.uid`), and `notifierState` (server-only, `.read/.write: false`). The remaining open security item is App Check enforcement (#193).
- Mock-file maintenance: 20 db-mocking test files. A shared mock factory would scale better but isn't worth the refactor cost yet.

## 17. Key reference artifacts

When picking this up, the documents to read together:

1. **`docs/HANDOFF.md`** (this file) — orientation
2. **`docs/superpowers/specs/2026-05-23-recovery-code-design.md`** — v2 identity model
3. **`docs/superpowers/specs/2026-05-25-groups-design.md`** — groups design (canonical source for all four phases)
4. **`docs/superpowers/plans/2026-05-25-groups-phase-0-invite-links.md`** — Phase 0 plan as executed
5. **`docs/superpowers/plans/2026-05-26-groups-phase-1.md`** — Phase 1 plan as executed
6. **`docs/superpowers/plans/2026-05-27-groups-phase-2-status-overrides.md`** — Phase 2 plan as executed
7. **`docs/superpowers/specs/2026-05-28-nav-redesign-design.md`** + **`docs/superpowers/plans/2026-05-28-nav-redesign.md`** — Nav redesign as shipped
8. **`docs/superpowers/plans/2026-05-31-groups-phase-3-in-app-invites.md`** — Phase 3 plan as executed
9. **`docs/color-theme-architecture-v0.8.html`** — current color/theme/favorites architecture walkthrough (refreshed 2026-06-13: favorites-no-slots, prefs.js/userPrefs storage, calls mailboxes, db split, thickness grades).

## 18. Session 2026-06-13 — what changed and what's still open

A hygiene/perf/bugfix/docs sweep. Everything below is **merged to `dev`** unless marked otherwise. The 12-June multi-pass analysis transcripts were reconciled against the issue tracker; the genuinely-untracked findings were filed as #214–#218.

### Shipped this session

- **#214 RTDB client-listener efficiency (R1/R2/R3/R5/R6):**
  - **R1** — boot call-recovery `watchOwnCall` was leaked *and* a duplicate of `following.js`'s watch. Now `initCallRecovery` captures the unsub and tears the listener down after the first fire (one-shot).
  - **R2** — `initFollowGrants`'s unsub is now stored in a module var (`_followGrantsUnsub`) for a future user-switch teardown.
  - **R3** — **`js/presenceHub.js`** (new): a shared per-uid presence-watch registry. A uid that is both a Direct followee and a group co-member is now watched **once**. Late consumers get an async replay of the cached value (no "Unavailable" flash). `following.js` + `groupContext.js` subscribe via `subscribePresence`. (Biggest steady-state bandwidth win.)
  - **R5** — inbox `readGroup` N+1 per mailbox tick → per-session `cachedReadGroup` cache in `inbox.js`, cleared on `initInbox`; regression test added.
  - **R6** — `rotateCode` now does one atomic multi-path `update()` instead of a `set()` per followee.
  - **Remaining → #214 R4** (open): suspend Direct presence watches while parked in a group context. Deliberately deferred — it's entangled with `onContextChange` wiring, call-mode (an incoming-call peer is a Direct contact whose watch would be suspended), the float-to-top/sort lifecycle, and resume-without-flash. Plus two low-priority DOM items (inbox `innerHTML` rebuild; add-person `getElementById` re-query).
- **#216 — shared status renderer:** `paintStatusDot(dot, { color, available, palettesEnabled })` (in `palettes.js`) + `availableForText(availableUntil)` (in `utils.js`). Both `following.js` and `groupContext.js` route the status dot and the "Available / Available for …" text through these, so the two rosters can't drift. (Closed.)
- **`permission_denied` console-error fix:** repro was *ANN calls BOB, BOB declines → error on ANN's console*. ANN's peer-ended path was redundantly calling `endCall`, which tried to clear BOB's already-empty `calls/` mailbox → `update at / failed: permission_denied`. Fixed with the `exitCallMode(myUid, { peerEnded })` flag: when the peer ended it, skip the teardown write. Shared by `following.js` + `groupContext.js`.
- **Hosting `no-cache` caching fix:** the chronic "have to clear cache to see updates" bug. `firebase.json`'s header rule used an extglob `source` (`@(/|/index.html|…)`) that Firebase Hosting silently doesn't match, so `index.html`/`sw.js`/`bundle.js` were served `max-age=3600` and CDN-cached for an hour. Replaced with a single `**` source carrying `Cache-Control: no-cache` (+ the CSP / X-Content-Type-Options / X-Frame-Options / Referrer-Policy headers). Confirmed fixed in prod (incognito shows `cache-control: no-cache`). See §10 §Service worker cache for the full model.
- **Add-person `<label for>` a11y fix:** `index.template.html` labels now associate with their inputs (`for="add-code-input"`, `for="add-label-input"`).
- **`db.js` → `db/{social,groups,canvas}.js` split (#183 H5)** plus helper extraction into `js/utils.js`; `db.js` is now a barrel. (See §3 module table.)
- **Docs:** `color-theme-architecture-v0.7.html` → **`-v0.8.html`**, refreshed; this HANDOFF updated.

### Filed this session (open issues)

| # | Title | Notes |
|---|---|---|
| **#214** | Client RTDB listener efficiency | R1/R2/R3/R5/R6 done; **R4 + 2 minor DOM items remain** |
| **#215** | Direct availability pushes carry no shared-context label | Group pushes label the context ("…in Family"); Direct don't. Plus a documented cross-invocation duplicate-push caveat |
| **#217** | Doc drift: Phase-2 toggle-OFF + invite-push phasing | D1 `clearStatusOverride`→`mergeStatusOverride`; D2 per-group picker shipped; D3 push-on-invite shipped. **Code is correct, docs were stale — reconciled 2026-06-13:** HANDOFF §15, the Phase 2 plan (top banner + inline `[Superseded]` notes), and the groups spec §16 push-on-invite lines now describe the shipped behavior. Pending maintainer close |
| **#218** | Post-MVP groups backlog (tracking) | G-A admin role, G-B owner group color, G-C >5-card collapse, G-D dup-name UI, G-E approval-gated joins. Holding list — promote items when prioritized |

### Deferred deliberately (with rationale)

- **#214 R4** — see above.
- **P3 wordlist build migration** (from #182) — couldn't verify the build path; risk > reward.
- **#183 H5 remaining splits** — `following.js` → call-mode extraction and a further `groupContext.js` split are entangled; left for a focused pass.
- **#193 App Check** — flag-day lockout risk; maintainer not convinced it's worth it for a 50–100 trusted-user app.

### Pattern worth keeping

Several of the above were split into "ship the safe, high-value part now; file the entangled remainder as its own issue" (R3 vs R4; the status-**dot** unification #216 vs the swatch-**row** collapse left as a decision). This was the repeatedly-endorsed approach: don't bundle a risky, cross-cutting behavioral change onto a clean mechanical one.

Those eight artifacts together cover everything that matters.

## 19. Session 2026-06-14 — web push / notifications + Safari + install nudges

A long debugging + polish pass on the notifications stack, all merged to `dev`. This is also where the **clean-test runbook** lives: `docs/notifications-testing.md` (read it before testing push).

### The notification surfaces (inventory)
- **`#notify-promo` banner** (`js/notifyPrompt.js`) — passive promo (engaged, 2nd+ session) OR reprompt (synced bells but no local permission). Renders an **Enable** button when push is usable, or **install/guidance copy** otherwise.
- **Per-contact bell** (`js/notifyBell.js`) — 3 switches (knock/call/availability); turning one on with no permission routes through `ensureNotificationsReady`.
- **`js/installGuidance.js`** — `detectNotifyCapability()` → `supported | denied | needs-install-ios | needs-install-macos | in-app-browser | unsupported`; `guidanceCopyFor(state)` returns the (now icon-bearing) copy.
- **`js/notifyDebug.js`** — the `#156` `NOTIFY_DEBUG` / `?notifydebug=1` readout (token state, SW cache, last-push).

### Bugs found + fixed (each a real SW/notification trap)
- **SW must only intercept same-origin requests.** The old fetch handler used a host *denylist* (`firebaseio.com`/`googleapis.com`) and took over everything else — including `apis.google.com/js/api.js` (gapi), which **fails to re-fetch on Safari** ("FetchEvent.respondWith … Load failed") and broke Firebase Auth + FCM there. Now an origin allowlist.
- **The SW must present a notification for EVERY push** — never a foreground de-dupe (`if (focused) return`). Apple: *"Safari … revokes the push notification permission for your site"* if a push arrives without a visible notification. That was the "worked once, then silently stopped" cause. (See §15.) `renotify: true` on reused tags so repeat knocks/calls re-alert.
- **macOS Safari needs the installed Dock app.** In-browser macOS Safari accepts a push and never displays it (separate matter from delivery — even a manual `showNotification` resolves but shows nothing in a tab). `detectNotifyCapability` returns `needs-install-macos` (mirrors iOS); the installed Dock app runs standalone → `supported`. **Installed Safari apps use a separate storage partition** → the identity is lost until the phrase is re-entered (the install nudges show a "Copy secret phrase" button + reminder for exactly this). Chrome/Android installs share storage — no loss.
- **Promo Enable no longer silently no-ops** on failure (denied → guidance; granted-but-token-failed → "couldn't enable" + retry).
- **`denied` guidance is browser-aware** — Safari gets the Settings → Websites → Notifications menu path; others get the address-bar hint.

### Platform reality (matrix in `docs/notifications-testing.md`)
- **iOS (16.4+):** push works from *any* browser's installed Home Screen web app — Chrome/FF/Edge install via their own Share menu, same as Safari (→ `needs-install-ios`). Only **in-app/embedded WebViews** (IG/FB/Android `wv`) can't install → `in-app-browser` ("open in your browser"). Installing lands in a fresh storage partition (identity must be re-entered, hence the save-your-phrase reminder), but the installed app's storage is **system-managed** and survives clearing/deleting the installing browser (verified on iOS 26).
- **macOS:** **Safari needs Add to Dock** (separate partition, identity loss); **Chrome/Firefox work in-browser** (Enable, identity kept).
- **Android / Windows:** in-browser push works everywhere (Enable, identity kept) — no nudge.

### Token hygiene (#156 item 3) — considered done
Covered by the **server-side dead-token drop** (`functions/index.js` drops `registration-token-not-registered` on a failed send) + **#157's 90-day TTL cull** (`cullStalePushTokens`). A per-user token cap isn't worth it.

### Open follow-up
- **Token-rotation-on-foreground** (not built): `refreshPushToken` only runs on load, so a token that rotates mid-session leaves the server sending to a stale token until the next reload — the likely lever if "delivery stops after a while" recurs on desktop Chrome. File as its own issue if it reproduces.
- **#161** (standalone, un-gated install nudge) — the macOS/iOS *notification-gated* guidance shipped and is reusable; the un-gated "install for the app-like experience" nudge is still open.

## 20. Release note (2026-06-14)

`dev` is **~447 commits ahead of `main`** — this is a large release covering everything since `v1.0.0`: groups **Phase 3** (in-app invites + Inbox), the entire **notifications/push program** (FCM, Cloud Functions notifier, install nudges, the Safari work above), **security hardening** (R1 Auth/RTDB-rules + R1.5 callable/notifier hardening + field validation), the **presence-schema-split** (`users/{uid}/presence`, `calls/`+`knocks/` mailboxes), the card tool drawer, PWA auto-update, and the 2026-06-13/14 hygiene+fix sweeps. Suggested prod tag: **`v1.1.0`**. Use `docs/DEPLOY-PROD.md`; smoke-test per `docs/notifications-testing.md` + the manual checklist before cutting the release.
