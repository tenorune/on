# KnockKnock — Session Handoff

A handoff to whoever picks this up next. Read top-to-bottom; specific subsections can be re-skimmed when working in a particular area.

**Most recent work:** Phases 0–2 of the groups feature shipped to `dev` with `GROUPS_ENABLED = true`. The nav redesign (sticky persistent nav row across contexts, override toggle as `=/≠`, "Direct" rendered as a group-card on the right in group context, default override-ON on group creation/join) shipped on top of Phase 2 and went through an extensive bug-fix cycle from manual testing. MVP is complete per spec §17.

**In-flight session branch (NOT yet merged to dev):** `claude/wonderful-heisenberg-fRek8` is **38 commits ahead of `origin/dev`**. Work on it includes (a) **per-group status color + palette picker** — each member's roster card adopts that member's color/palette, base/palette modes, with the picker per-set and forest/volt defaults; (b) **deferred-knock pulsing halo** replacing the numeric badge, plus a knock-pending halo on group cards (call-pulse keyframe, inset+outset, group's own color); (c) **fixes**: re-following a previously-revoked follower works again (sequential remove→set fixes a `Promise.all` race in `registerAsFollower`), floated knock sender stays under the Mutuals label (the float-preservation loop in `following.js` was bypassing the section-label fix via raw `prepend`), group-context availability section height stays constant across Available/Unavailable, group color leaks into Direct fixed in several spots; (d) **userPrefs migration** — large multi-commit migration moving all private user state out of the broadcast `users/{uid}/...` subtree into a new top-level `userPrefs/{uid}/...` subtree (see new §6.5). New module `js/prefs.js` is the central preferences store. 671 tests pass. **Dev RTDB MUST be wiped from the Firebase console before merging this branch to dev** — the userPrefs migration is wipe-friendly (no migration path); existing data on the old paths will be abandoned, not moved.

**Two known unfixed bugs at the time of this handoff** — read §16 before touching either area:
1. **GitHub issue #64** — knock float-to-top does not restore when the user returns to the tab. A `0098631` fix attempt was committed but did NOT actually fix it in production. Note: the session-branch float-below-section-label fix (`4189610`, `48f9477`) is a *different* float bug — issue #64 is still open.
2. **Nav-row flash before group-displayname prompt** during new-user invite redemption. Fixed on the session branch in commit `96a187c` — extended the `add('hidden')` / restore-if-`!landedInGroup` pattern to also cover `#nav-row`. Will ship to dev when the session branch is merged.

**Phase 3 (in-app push invites)** is the next planned feature work and not yet planned or built.

---

## 1. What KnockKnock is

A vanilla-JS PWA for **ambient presence**. Users mark themselves "available for N hours" and contacts see their status with personalized color themes. Layered features: knock-to-pulse, swipe-to-call, shared collaborative drawing canvas during calls.

- **Target user base:** 50–100 users (a small, hands-on sandbox, not a public app).
- **Stack:** vanilla ES modules (no framework), Firebase Realtime Database + Hosting, esbuild, jest + jsdom.
- **Tests:** 671 currently passing. Run with `npx jest`.
- **Anonymous identity model** (no Firebase Auth) — see §4.

## 2. Repo & branch model

```
main                         → prod   (Firebase project: knock-knock)
dev                          → dev    (Firebase project: on-on-22cb4)
claude/<name>                → session feature branches
```

- **Deploys via GitHub Actions.** Push to `main` → prod; push to `dev` → dev. Workflows live in `.github/workflows/deploy-{dev,prod}.yml`.
- **Required repo secrets:** `FIREBASE_CONFIG_{DEV,PROD}` (env file contents), `FIREBASE_SERVICE_ACCOUNT_{DEV,PROD}` (GCP service account JSON).
- **`production` environment** with required-reviewer rule gates prod deploys.
- **Critical CI gotcha:** the deploy step extracts `FIREBASE_PROJECT_ID` via `grep + cut` — *not* by sourcing the env file. Sourcing was fragile against secret formatting. Don't revert.
- **CI deploys `--only hosting,database`.** Database rules are pushed alongside hosting. If you change `database.rules.json`, the next deploy carries it.
- **Local deploys also push rules.** `npm run deploy:dev` (which runs `node scripts/dev-deploy.js`) and `npm run deploy` both use `--only hosting,database`. If you ever revert this, group ops break with `permission_denied` because the Phase 1 rule namespaces (`groupIdIndex`, `groups`, `inviteIndex`, `pendingInvites`) fall to the `$other: false` catch-all.

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
```

### Key JS modules

| File | Purpose |
|---|---|
| `js/app.js` | Main init, `ensureIdentity`, `watchStatus` subscription, screen orchestration, invite-redemption dispatch, group-context switching. **`initNavRow()` must be called BEFORE the `onContextChange(enterGroupContext)` registration** — otherwise the override toggle never installs (commit `ba77271`). The redemption block primes `setLastKnownGroupName(groupId, knownName)` before `navigateToGroup` so the nav shows the real group name from the first paint. `#main-ui-direct` starts hidden in markup and is revealed at the end of `main()` only if the current context is not a group (commit `7ff015f`). |
| `js/identity.js` | Secret phrase generate/parse/derive, localStorage v2 schema |
| `js/wordlist.js` | 7772-word EFF long wordlist (regenerate via `scripts/gen-wordlist.js`) |
| `js/db.js` | **All Firebase RTDB operations** (single import point). Sectioned: users / codeIndex / inviteIndex / personal-invites / groupIdIndex / users-groups enumeration / groups CRUD / group members / group invites / knocks / canvases / **userPrefs** (new). Following CRUD (`watchFollowing` / `setFollowingEntry` / `removeFollowingEntry`) now lives at `userPrefs/{uid}/following/...` not `users/{uid}/following/...` (session branch, commit `08c739f`). |
| `js/store.js` | localStorage operations. Call-counter helpers were moved out to `js/prefs.js` during the userPrefs migration; group-chip per-group LS helpers (`getGroupChipMinutes` / `setGroupChipMinutes` for `statusapp_group_chip_{groupId}`) were added so per-group chip selection doesn't leak into the Direct default. |
| `js/prefs.js` | **NEW (session branch).** Central preferences store. Reads stay synchronous via localStorage cache; writes go through here so they hit both localStorage AND `userPrefs/{uid}/...` via `mergeUserPrefs`. Exports: `initPrefs`, hint API (`isHintSeen` / `markHintSeen` keyed by short names mapped via `HINT_KEYS`), call counters (`getMadeCallCount` / `incrementMadeCallCount` / `getAnsweredCallCount` / `incrementAnsweredCallCount`), favorites-collapsed (`isFavoritesCollapsed` / `setFavoritesCollapsed`), palette state (`getPaletteState` / `setPaletteState`, wrapping store.js), per-group palette state (`getGroupPaletteState(groupId)` / `setGroupPaletteState(groupId, state)`), favorites (`getFavorites` / `setFavorites`), chip minutes (`getLastTimeout` / `setLastTimeout` Direct + `getGroupChipMinutes` / `setGroupChipMinutes` per-group), context (`getCurrentContextCached` / `setCurrentContext`), and `syncFromServer(serverPrefs)` called from app.js's `watchUserPrefs` subscription. `syncFromServer` dispatches CustomEvents (`palette-state-synced`, `group-palette-state-synced`, `favorites-synced`, `last-timeout-synced`, `group-chip-minutes-synced`, `current-context-synced`) so other modules can re-render without prefs.js importing them. |
| `js/me.js` | Own-status UI (header, dot, time chip), `initHeader`, `applyOwnStatus` |
| `js/following.js` | Direct-contacts list rendering (Mutuals/Following/Followers), call mode, knock UI, **20s float-to-top survival across re-renders** |
| `js/mycode.js` | Share-code drawer + secret-phrase reveal pill + invite-link button |
| `js/palettes.js` | Palette definitions, swatch picker, theme application, cross-device sync |
| `js/favorites.js` | Favorites strip + `getAllCombos()` / `getCanvasColors()` |
| `js/canvas.js` | Shared drawing canvas during 1:1 calls |
| `js/knock.js` | Knock pulse mechanics, 20s float-to-top anchor, group-card unread badge. Live pulse uses the `.knock-live` CSS keyframe class (NOT inline-style transitions — those got eaten by same-tick prepend + scroll). 60s clock-skew tolerance on the deferred check (`ts < appOpenTime - 60000`). `pendingByGroup` Map holds knocks received while the user wasn't in the relevant group context; `drainPendingKnocks(groupId)` replays them on enter. Scroll-to-top on knock receipt uses non-smooth, multi-target writes (`window.scrollTo`, `documentElement.scrollTop`, `body.scrollTop`). **`floatTimers` entries track `startedAt`** and the visibilitychange handler drains expired entries — but in practice this fix does NOT work in production; see issue #64 in §16. |
| `js/features.js` | **Feature flags (see §5)** |
| `js/invites.js` | **NEW (Phase 0+1).** Invite-link business logic: token gen, create/revoke/regenerate (both personal + group), redemption with structured `{ok, reason}` results, `attemptRedeemFromUrl` dispatch, `resolveInvitePreview` for welcome-screen framing. |
| `js/inviteModal.js` | **NEW (Phase 0+1).** Shared modal component, scope-parameterized via `SCOPE_COPY.{personal,group}`. State A (create) + State B (manage with URL + ↻ regen + Copy + Revoke). |
| `js/groups.js` | **NEW (Phase 1).** Group lifecycle business logic: `createGroup` / `renameGroup` / `deleteGroup` (owner-only) / `joinGroup` / `leaveGroup` (member-only) / `editOwnDisplayName`. Also `initGroupRemovalDetector` — surfaces a toast when a group the user was in disappears from their enumeration. |
| `js/groupNav.js` | **NEW (Phase 1, rewritten in nav redesign).** Navigation state machine: `currentContext` ('direct' or 'group:{id}'), `navigateToDirect` / `navigateToGroup`, listener pattern via `onContextChange`. Persistent sticky nav row. **Direct context:** large-bold "Direct" + each group as `.group-card` (status-colored border when effectively available; greyed when not) + `+`. **Group context:** small-unbold "Direct" back-link on the LEFT + group name (flex:1, large-bold, truncating) + override toggle (`=` for OFF, `≠` for ON) + "Direct" rendered as a `.group-card` on the RIGHT with the user's primary-status color as border. **Override toggle is owned here**, not in groupContext.js (was consolidated in `fd7c432`); click handler optimistically updates `_overrideByGroupId[groupId]` AND calls `applyOptimisticOverride` cross-module to keep groupContext's `_ownOverride` in sync before the Firebase ack. Caches `_lastKnownNames` per group so deletion toasts can show the name not the id. `setLastKnownGroupName(groupId, name)` primes the cache before `navigateToGroup` so first paint shows the real name. `syncMetaSubs` calls `removeUserGroupsEntry(_myUserId, groupId)` on null meta so a deleted group disappears from the nav immediately. `navigateToGroup` / `navigateToDirect` emit synchronously BEFORE any Firebase awaits. Also owns the create-group modal. |
| `js/groupContext.js` | **NEW (Phase 1).** Group context view: own status row at the top (dot + label + time-remaining + time chip + Settings `<details>` chip with rename/delete/invite/edit-name/leave actions) + roster (per-member `watchStatus`). Hosts the `_ownOverride` / `_ownPrimary` / `_membersOverrides` / `_memberPrimaries` state and exports **`applyOptimisticOverride(override)`** for cross-module sync from groupNav's toggle click. `paintRosterRow` combines override + primary and sets the `.available` class on the dot (not just `dataset.available`). Time chip uses `getLastTimeout() → chipIndexForMinutes` lookup to avoid the legacy `2 → 2 minutes` migration bug; chip cycles even when the user is currently unavailable (the `currentlyAvailable` gate was dropped in `05935e8`). The current user is **not** rendered in the roster. Settings menu auto-dismisses on outside-tap and on option-activation. |

## 4. Identity model (load-bearing — read this carefully)

v2 (secret-phrase derived):

- A user's identity = a **4-word "secret phrase"** drawn from `js/wordlist.js`. Format: `swift-river-amber-dust`.
- `userId = sha256(phrase).slice(0, 32)` — **deterministic**. Typing the same phrase on any device restores the same account.
- **No Firebase Auth.** The phrase is the only secret. Anyone who has it can claim the account.
- localStorage shape: `statusapp_identity = { userId, code, recoveryCode }`.
- Welcome screen surfaces `I'm new` / `I have a secret phrase` on empty localStorage. The welcome screen now also takes optional `inviteCreatorLabel` / `inviteGroupName` to frame the screen for brand-new users arriving via an invite link ("You've been invited to follow Mike P." / "You've been invited to join 'Family'.").
- Drawer has a "Show secret phrase" pill for recovery.
- `crypto.subtle.digest('SHA-256', ...)` is used for derivation — works in browser and Node 20+.

**Auth trust model:** honor-system. `database.rules.json` allows `.read/.write: true` to every namespace. Future **Phase B** (documented in the recovery-code spec) would add Firebase Anonymous Auth + a Cloud Function recovery validator + `auth.uid === $userId` rules. Not built. Several Phase 1 features were *designed* to be portable to Phase B without a Cloud Function — see the groups spec §19.

## 5. Feature flags

`js/features.js` exports five flags:

```js
PALETTES_ENABLED               // Palette swatch picker, color theming
PALETTE_INTERACTIONS_ENABLED   // Favorites strip + adoption + hints
KNOCK_ENABLED                  // Knock pulse system
CALL_ENABLED                   // Swipe-right call + canvas
GROUPS_ENABLED                 // Group cards row, create-group flow, group context view, group-scope invites
```

- **Currently on `dev`:** all flags `false` EXCEPT `GROUPS_ENABLED = true` (flipped in commit `596a148`).
- **Currently on `main`:** all flags `true` (pre-Phase-0 state — the groups work has NOT been merged to main yet).
- These are compile-time constants. Changing means editing + redeploying.
- **All test suites mock `../js/features.js`** per-suite. Flipping real values doesn't affect tests.
- A recent bug surfaced once: with `CALL_ENABLED = false`, stale `callState` Firebase data was still rendering "Calling you…" on cards. Fix in `following.js:670` gates `isCallee`/`isCallModeReceiver` with `CALL_ENABLED`. **Render-layer gates must match handler-layer gates** — same lesson applied for the group cards row + create modal.

## 6. Cross-device sync

When the same secret phrase is used on multiple devices, **everything that's user-state syncs**. There are two subscription paths, by design:

- **`watchStatus(myUid, cb)`** in `js/app.js` — drives the broadcast-shaped subtree `users/{uid}/...` (status, availableUntil, statusColor, paletteKey, code, callState, followers, ...). Every follower's `watchStatus(otherUid, cb)` reads this same subtree, so anything here goes out to every follower on every tick. Keep this subtree lean.
- **`watchUserPrefs(myUid, cb)`** in `js/app.js` (session branch) — drives the private subtree `userPrefs/{uid}/...`. Only the owner reads it; followers don't subscribe to it. New private state belongs here.

The pattern in each callback is the same: a `syncXFromServer(...)` function reconciling local with server.

| Surface | Mechanism |
|---|---|
| Status / availability / availableUntil | watchStatus → `applyOwnStatus` |
| Dot color (`--my-status` CSS var) | watchStatus → direct setProperty |
| Theme variables | watchStatus → `applyThemeVars` / `resetThemeVars` |
| Share code (rotated on another device) | watchStatus → `updateMyCode` |
| Followers list | `watchFollowers` (separate subscription) |
| **Following list (contacts)** | `watchFollowing` (separate subscription, now at `userPrefs/{uid}/following`) → `syncFollowingFromServer` |
| **Group enumeration** (Phase 1) | `watchUserGroups` (separate subscription) → drives the cards row and the removal detector |
| **Per-group meta** (Phase 1) | `watchGroupMeta(groupId, cb)` per enumerated group — drives card name + last-known-name cache |
| **Own per-group status override** (Phase 2) | `watchOwnMemberOverride(groupId, ownUid)` per enumerated group — drives card color and the group-context status row |
| **Group roster + statuses** (Phase 1) | `watchGroupMembers(groupId, cb)` + per-member `watchStatus(memberUid, cb)` in `groupContext.js` |
| **Personal invite collection** (Phase 0) | `watchUserInvites` — drives the drawer button label ("Create invite link" vs "View invite link") |
| **All userPrefs** (session branch) | `watchUserPrefs(uid, cb)` → `prefs.syncFromServer` → CustomEvents → per-module re-render. Covers: hints, call counters, favoritesCollapsed, palette state (direct + per-group), favorites history, lastTimeoutMinutes (direct + per-group), currentContext. See §6.5. |

**Important data path changes vs. v1:**
- The user's `code` rotation propagates via watchStatus.
- **NEW (Phase 1):** `users/{uid}/groups/{groupId}: { lastVisited? }` is the user-side enumeration index. Group facts (name, ownerId, members, invites) live under `groups/{groupId}/...`.

**Important data path changes on the session branch (NOT yet on dev):**
- Following list (contacts) moved from `users/{me}/following/...` → `userPrefs/{me}/following/...` (commit `08c739f`).
- Favorites history moved from `users/{me}/favorites` → `userPrefs/{me}/favorites` (commit `3b7f994`).
- `currentContext` moved from `users/{uid}/currentContext` → `userPrefs/{uid}/currentContext` (commit `8d463c8`). Still synced across devices; navigating into a group on one device still pulls the other device in (accepted yank semantics per spec §6).
- `lastTimeoutMinutes` (Direct chip default) moved from `users/{uid}/lastTimeoutMinutes` → `userPrefs/{uid}/lastTimeoutMinutes`. Per-group chip default added at `userPrefs/{uid}/perGroup/{groupId}/lastTimeoutMinutes` (commit `18d8d29`, after `a1459f7` fixed the leak between them at the localStorage layer).
- Direct paletteState + per-group paletteState + favoritesCollapsed are now at `userPrefs/{uid}/paletteState/direct`, `userPrefs/{uid}/perGroup/{groupId}/paletteState`, `userPrefs/{uid}/favoritesCollapsed` (commit `0173950`).
- Hints + call counters now sync at `userPrefs/{uid}/hints/{name}: true` and `userPrefs/{uid}/{madeCallCount,answeredCallCount}` (commit `55815d4`).

## 6.5. userPrefs schema (session branch)

The `userPrefs/{uid}/` subtree was introduced in the session branch's multi-commit migration to keep private user state out of the broadcast `users/{uid}/...` subtree (every follower's `watchStatus` was pulling this on every tick).

```
userPrefs/{uid}:
  hints/{name}: true                            // 'bolt' | 'flower' | 'theme' | 'stripPeek' | 'longpress' | 'swipe' | 'customAvail'
  madeCallCount: <number>                       // server max-wins
  answeredCallCount: <number>                   // server max-wins
  favoritesCollapsed: <bool>                    // strip collapsed/expanded
  paletteState/direct: { ... }                  // Direct context swatch picker state
  favorites: [<combo>, ...]                     // Direct favorites history
  lastTimeoutMinutes: <number>                  // Direct chip default
  currentContext: 'direct' | 'group:{groupId}'  // active context, synced device-to-device
  following/{followeeUid}: { code, label }      // own-side following list
  perGroup/{groupId}:
    paletteState: { activeSet, sets: { 1: {...}, 2: {...} } }
    lastTimeoutMinutes: <number>                // per-group chip default
```

What stays in `users/{uid}/`: everything followers need to see (status, statusColor, paletteKey, availableUntil, code, callState, followers/, revokedFollowers/) plus the Phase 1 group enumeration (`groups/{groupId}`) and the personal-invite collection (`invites/{inviteId}`).

Sync wiring:
- `mergeUserPrefs(uid, fields)` in `db.js` is the multi-path atomic write helper (used by every `prefs.set*`).
- `watchUserPrefs(uid, cb)` is the one subscription that drives all prefs reconciliation. Wired in `app.js` `main()` after `initPrefs(uid)`.
- `prefs.syncFromServer(serverPrefs)` does the localStorage repopulation and dispatches CustomEvents for UI re-render — modules listen via `document.addEventListener('palette-state-synced', ...)` etc. instead of being imported by prefs.js (avoids circular imports).
- Wipe-friendly migration: no first-time push-up of pre-existing local state. **Dev RTDB must be wiped from the Firebase console before this branch is merged to dev** so existing data on the old paths doesn't shadow the new ones.

## 7. Phase 0 + Phase 1 data model (summary)

Per the groups spec §7 (rev 2):

```
groups/{groupId}:
  name, ownerId, createdAt, (color/paletteKey: post-MVP)
  members/{memberUid}: { role, displayName, joinedAt, statusOverride?:Phase2 }
  invites/{inviteId}: { scope: 'group', token, creatorUid, ts, cap, revoked, ... }

users/{uid}:
  // existing fields ...
  groups/{groupId}: { lastVisited? }          // enumeration only
  currentContext: 'direct' | 'group:{id}'      // synced via watchStatus
  invites/{inviteId}: { scope: 'personal', token, creatorLabel, ts, cap, revoked, ... }

inviteIndex/{token}: { scope, ownerPath }     // global lookup for redemption
groupIdIndex/{groupId}: true                  // existence lock for transactional alloc
pendingInvites/{inviteeUid}/{inviteId}: ...   // Phase 3 schema — currently no writers
```

Key design decisions worth remembering:
- **Membership is canonical at `groups/{groupId}/members/{uid}`.** The user-side `users/{uid}/groups/{groupId}` is JUST an enumeration index with `lastVisited` for ordering. Avoids the dual-write coordination problem and stays portable to Phase B rules.
- **`inviteIndex` is one shared lookup for both scopes** — `attemptRedeemFromUrl` reads it, dispatches by `scope`.
- **One active invite per scope-target:** per `(creatorUid)` for personal, per `(creatorUid, groupId)` for group. Enforced client-side via collection scan (not transactional — race window accepted for Phase 1).
- **`pendingInvites` lives at a top-level mailbox path** (`pendingInvites/{inviteeUid}/{inviteId}`) so Phase 3 + Phase B rules can express invitee-reads + inviter-writes-with-from-eq-auth.uid without needing a Cloud Function. No writers in Phase 1.

## 8. Layout & visual constraints

- `html, body { min-width: 360px }` — narrower viewports get horizontal scroll.
- `body { max-width: 600px; margin: 0 auto }` — capped + centered on wider viewports.
- **Canvas exception:** `#canvas-screen` is `position: fixed; inset: 0` — escapes the body cap.
- Modals and overlay screens (welcome, recovery, restore, stale, invite, create-group, group-displayname, invite-failure) are fixed-positioned, full-viewport.
- **Direct context vs group context:** the existing main UI is wrapped in `<div id="main-ui-direct">`. The group context view is `<div id="group-context-root">`. A sticky `<div id="nav-row">` (top-level, above both) is hidden by `.hidden` class until `initNavRow` runs. Only one of `#main-ui-direct` / `#group-context-root` is visible at a time, toggled by `groupContext.js`'s `enterGroupContext`/`exitGroupContext` based on `groupNav.onContextChange` listener; the nav row re-renders independently via its own internal `onContextChange` listener registered in `initNavRow`. **`#main-ui-direct` starts hidden in markup** and is revealed at the end of `main()` only if the current context is not a group — this prevents the empty Availability shell from flashing behind the secret-phrase modal on first use (commit `7ff015f`).
- **Nav row height parity:** `.nav-row > *` is locked to `height: 2.5rem` so the row height stays identical across Direct and group contexts. The `.group-context-header` surface band mirrors `#app-header` so elements don't appear to shift when switching contexts.

## 9. CSP

`firebase.json` headers contain a CSP allowing:
- `*.firebaseio.com`, `wss://*.firebaseio.com`, `*.firebasedatabase.app`, `wss://*.firebasedatabase.app`, `*.googleapis.com` in `connect-src`
- `*.firebaseapp.com`, `*.firebasedatabase.app` in `frame-src` (RTDB long-polling iframe; without this, realtime delivery silently fails on restrictive networks)

## 10. Build pipeline

`index.html` is generated from `index.template.html` at build time, with `__APP_TITLE__` substituted (`KnockKnock` for prod, `On - Dev` for dev). `index.html` is gitignored.

Run locally:
- `npm run dev` — esbuild watch + local server (uses `.env.local`)
- `node scripts/dev-build.js` — build using `.env.local` once
- `node scripts/prod.js` — build using `.env.production` once
- `npm run deploy:dev` — build then `firebase deploy --only hosting,database --project <id>` (reads project id from `.env.local`)
- `npm run deploy` — prod build then `firebase deploy --only hosting,database` (uses `.firebaserc` default alias)

**Required local files (both gitignored):**
- `.env.local` — runtime config. Keys read by `scripts/build.js`: `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_DATABASE_URL`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`, optional `APP_TITLE`. Same values are in the GitHub secret `FIREBASE_CONFIG_DEV`. `FIREBASE_PROJECT_ID` doubles as the deploy target.
- `.firebaserc` (optional, but typical) — `{ "projects": { "default": "on-on-22cb4" } }`. `dev-deploy.js` always passes `--project` explicitly, so this is for `firebase` CLI usage outside the npm scripts.

Plus you need `npx firebase login` (or `firebase login` if installed globally) once.

## 10.5. Session branch (`claude/wonderful-heisenberg-fRek8`) — what's on it

38 commits ahead of `origin/dev`. Broadly three buckets:

**Per-group color + palette picker** (multiple commits, oldest `adf87b9` → newest `a8ee9a8`):
- Member roster cards adopt that member's statusColor + palette theme.
- Group context gets a per-group palette picker with a set toggle (sets `1` + `2`) and base/palette modes. Per-group palette state shape: `{ activeSet, sets: { '1': { selectedKey, selectedColor, activePaletteKey }, '2': {...} } }`. Defaults: set 1 = forest/`#22c55e`, set 2 = volt/`#aaff00`.
- "Self-theming" for the user's own row inside the group context view.
- Fix cycle for leaks: group color into Direct (`e1bf947`, `c1e3805`, `a652396`), Direct paletteKey into group override-ON (`a8ee9a8`), favorites strip peek hint into group context (`6d4124d`).

**Deferred-knock pulsing halo + knock-pending halo on group cards** (commits `6682b03`, `041251e`, `9fac7b5`, `b977236`, plus `d30b6dc` `5409f4b` `df7e405` `48f9477`):
- Numeric badge replaced with a CSS-keyframe pulsing halo using the `call-pulse` keyframe pattern. Reuses inset+outset box-shadow so the glow shows both inside and outside the chip.
- Group-card knock-pending halo (`@keyframes knock-pending-pulse`) shows the recipient there's a deferred knock waiting in a group they're not currently in.
- Animations defer one frame so they actually play (`5409f4b`); sender flash color matches the recipient's dot in group context too (`df7e405`).
- `nav-row > *` vertical padding bumped 0.5rem → 0.75rem so the outset glow has room.

**Direct-context knock + re-follow fixes** (commit `4189610`):
- Floated knock sender now stays under the Mutuals section label. The float-preservation loop in `following.js:354` was bypassing the earlier `applyFloatToTop` section-label fix via raw `list.prepend(li)`. Added the same `insertBefore(firstLabel.nextSibling)` logic.
- Re-following a previously-revoked follower works again. Root cause: `Promise.all` race in `registerAsFollower` where remove + set could land in either order, causing the new entry to be wiped by a late remove. Fixed by making them sequential.
- Standalone fix `02723e3` covers the re-following case after revoke as well.

**The userPrefs migration** (commits `55815d4` → `08c739f`, 6 commits): see §6.5.

**Other smaller fixes & polish on this branch:**
- `b016553` / `08c5380` smooth the Create-group → group-context transition (suspend renderNavRow during the transition).
- `26bc473` auto-opens the invite modal after group create; reorders + restyles Settings.
- `d087693` pre-fills Edit-my-name; tightens Create-a-group modal copy.
- `9a1143b` personal-invite redeem lands in Direct (not the previous group); roster sorts available members to the top.
- `153a42d` recovery modal uses the welcome-screen bg (not modal-overlay).
- `2900938` FTU group-invite redemption latency cut roughly in half — see commit body for the prefetch + cache plumbing.
- `99326f6` enlarges the override toggle ~1.5x.
- `96a187c` suppresses the nav-row flash before the group-displayname prompt during new-user invite redemption (the second of the two "known unfixed bugs" from the previous handoff).
- `bb1f96f` restore lands directly in last group context without flashes.

Status: tests pass (671), build is clean. Ready for the user to merge to dev via PR. **Before merge: wipe dev RTDB from Firebase console** (§6.5).

## 11. In-progress work / what's next

**Nav redesign (post-Phase-2) — shipped on dev (with extensive follow-up fixes):**

- Persistent sticky `#nav-row` replaces the old `#group-cards-row` strip that used to sit above the contact list.
- **Direct context:** each group as `.group-card` + `+`. The "Direct" label itself was dropped from this context (commit `d67b3c6`). Each group's card shows a status-colored border when the user is effectively available in that group; greyed name + no border when unavailable. Forest-green fallback (`#22c55e`) when no `statusColor` is set.
- **Group context:** `Direct` back-link on the LEFT (small/unbold) + group name (flex:1, large/bold, truncating) + override toggle + `Direct` rendered as a `.group-card` on the RIGHT styled like a group with the user's primary statusColor as border.
- **Override toggle:** Unicode `=` (OFF, linked to primary) / `≠` (ON, distinct from primary). Earlier iterations tried Tabler SVG chain icons (`ba77271`) then a simple circle (`56746e5`) — both failed to render reliably. The Unicode glyphs were the final choice (`fd7c432`, glyphs swapped to `=/≠` in `4d40fcf`).
- **Default override-ON on group creation/join** (commit `4d40fcf`): both `createGroup` and `joinGroup` write `statusOverride: { enabled: true, status: 'unavailable', availableUntil: null }` so a new member is private-by-default in the group.
- Group context body lost its h2 group name, its breadcrumb back button, and the override-toggle pill. Settings became a chip in the chip row alongside the time chip (auto-dismisses on outside-tap + option-activation).
- **Override toggle ownership consolidation** (commit `fd7c432`): the toggle is owned by `groupNav.js`, not handed off to `groupContext.js` via a slot. Cross-module state sync is via the exported `applyOptimisticOverride(override)` from `groupContext.js` — `groupNav` calls it after each toggle click so the group-context render reflects the new state before Firebase ack.
- **Init ordering**: `initNavRow()` must run BEFORE the `onContextChange(enterGroupContext)` registration in `app.js`. Otherwise on emit, `enterGroupContext` fires first and the nav-row DOM isn't ready (commit `ba77271`).
- Spec: `docs/superpowers/specs/2026-05-28-nav-redesign-design.md`. Plan: `docs/superpowers/plans/2026-05-28-nav-redesign.md`.

**Phase 3 — in-app push invites** (spec §16 Phase 3, Flow C in spec §10). Not yet planned or built.

- The data path is already designed and the security rules are in place: `pendingInvites/{inviteeUid}/{inviteId}` (top-level mailbox, forward-compatible with Phase B without a Cloud Function).
- Phase 3 adds writers and the receiving UI (the inline card at the top of Direct's contact list with Join / Decline).
- Spec §16 Phase 3 has the deliverable list. Use the `writing-plans` skill to produce a plan.

**Phase 2 — per-group status overrides** (now shipped on dev):

- Spec scope locked to per-**group** overrides only — the spec's symmetric "followers audience" override was dropped from Phase 2 because the primary status IS the followers' view.
- Per-audience color picker also deferred to Phase 4+; the `statusOverride.statusColor` and `paletteKey` schema slots are preserved (forward-compat) but not written by Phase 2.
- New code: own status row + override toggle inside the group-context header; group cards reflect own-override color when ON+available (primary statusColor as the Phase 2 fill); roster renders each member's context-appropriate status.
- New db.js exports: `setStatusOverride`, `clearStatusOverride`, `watchOwnMemberOverride`. New groups.js exports: `toggleStatusOverride`, `setOverrideStatusAvailable`, `setOverrideStatusUnavailable`.

**Other planned work (post-MVP, not on roadmap yet):**
- Phase B: identity tightening via Firebase Anonymous Auth + Cloud Function recovery validator + `auth.uid` rules. The current Phase 0/1/2 data layout was deliberately designed to be portable to Phase B without a Cloud Function (see spec §19).
- Phase 4+: admin role, ownership transfer, request-to-follow, group color/palette, per-audience color picker, etc. — listed in spec §16 Phase 4+.

## 12. Recent significant fixes & gotchas

Phase 0 (1:1 invite links):
- 22-task plan executed via subagent-driven development. Net: new `js/invites.js`, `js/inviteModal.js`; minor extensions to `db.js`, `app.js`, `mycode.js`; new markup + CSS. Modal layout uses the same `.recovery-display` row pattern as the secret-phrase modal for visual consistency.
- Failure-overlay copy covers all reasons (`not-found`, `revoked`, `expired`, `cap`, `self`, `already-following`, `creator-missing`, plus the Phase 1 additions `group-missing`, `already-member`, `invalid-display-name`, `needs-display-name`).
- Welcome screen for brand-new users redeeming an invite link shows the inviter's `creatorLabel` (personal) or group name (group).

Phase 1 (groups MVP):
- 22-task plan executed via subagent-driven development. Net: new `js/groups.js`, `js/groupNav.js`, `js/groupContext.js`; further extensions to `db.js`, `app.js`, `knock.js`, `following.js`; substantial markup additions (group cards row, group context root, breadcrumb, create-group modal, group-displayname screen, group-removal toast).
- **Knock-via-group-context:** the `knocks/{recipient}/{sender}` record carries optional `contextGroupId`; recipient routes the pulse to the relevant group's roster or bumps the group card's unread badge. 20s float-to-top anchor implemented in `knock.js`; direct-context list also gets the float treatment with `getFloatedUserIds()` consumed by `following.js` to survive re-renders.
- **`navigateToGroup` ordering bug:** initially in `js/app.js` the redemption block fired `navigateToGroup` BEFORE `initNav`, causing writes to `users/null/...` and the navigation to be wiped by initNav's reset. Fixed in commit `9bcf602` — `initNav` + `onContextChange` are now wired before the redemption block.
- **Non-owner deletion detection:** when the owner deletes a group, `watchUserGroups` doesn't fire for non-owner members (the owner can't write to their user records). `groupContext.js`'s `watchGroupMeta(null)` callback now calls `removeUserGroupsEntry(userId, groupId)` for the local user; that delta then triggers `groups.js`'s removal detector + toast. Fix in commit `9bcf602`.
- **Group-name cache for deletion toast:** `groupNav.js` maintains `_lastKnownNames[groupId]` so the deletion toast shows `'Family' has been deleted.` instead of the random `'1ASSKU46' has been deleted.`. Cache survives the `watchGroupMeta(null)` event. Fix in commit `53f1572` (since-rebased onto dev).
- **Deploy scripts `--only hosting`:** initially the local `npm run deploy:dev` and `npm run deploy` scripts deployed only hosting, so a fresh `database.rules.json` change wouldn't ship and group ops would `permission_denied` against the old rules. Fixed in commit `07fd02e` — both now `--only hosting,database` (matches what the CI workflows already did).

Post-nav-redesign fix cycle (all on dev):
- **Color fallback chain** (commit `8a3d7f6` — in summary, see commit messages): Direct nav's group-card border uses `ov?.statusColor || _ownPrimary?.statusColor || '#22c55e'`. An earlier implementation collapsed the chain and lost the primary fallback when override was ON with no `statusColor`.
- **Time chip stuck when override ON** (commit `05935e8`): a `currentlyAvailable` early-return blocked the chip from cycling. Dropped the gate; chip now cycles regardless of available state, writes available even when not currently available.
- **Cross-module override desync** (commit `05935e8`): chain icon updated `_overrideByGroupId` but `groupContext._ownOverride` stayed stale until Firebase ack. Fixed via `applyOptimisticOverride` export.
- **Knock-receive double bug** (commit `ae6e9fc`): clock-skew misclassified live knocks as deferred (`ts < appOpenTime`); `applyDeferredKnock` used a global selector that landed on the hidden Direct contact `<li>`. Fixed with 60s tolerance + context-aware `findKnockTargetCard`.
- **Scroll-to-top on knock didn't work** (commits `1b86be8`, `e456a51`): `behavior: 'smooth'` was unreliable post-DOM-mutation. Dropped smooth and write all three scroll targets (`window`, `documentElement`, `body`).
- **Live pulse animation didn't display** (commit `8c642bf`): imperative transition (`set boxShadow → reflow → set new boxShadow`) was eaten by the same-tick prepend + scroll. Switched to `.knock-live` CSS keyframe class.
- **Group lingered in nav after owner deleted it** (commit `8c642bf`): `syncMetaSubs` now calls `removeUserGroupsEntry` on null meta.
- **First-use UX flashes** in invite redemption (commits `b8bf19e`, `7ff015f`): hidden `#main-ui-direct` during redemption + `setLastKnownGroupName` before `navigateToGroup`; `#main-ui-direct` starts hidden in markup, revealed at end of `main()`.
- **Group-context availability section parity** (commits `20eb680`, `904d175`, `3f2718e`, `ae17000`): pixel-aligned to Direct context after several rounds (chip sizes, band height, nav-row child height).

Older (pre-groups) fixes worth knowing:
- **Canvas concurrent-drawing race** (commit `61db133`).
- **CSP frame-src `*.firebasedatabase.app`** (commit `cdd845a`).
- **Mobile-web-app-capable** (commit `ec55bb8`).
- **Time-chip selection sync** (commit `6a4d8b6`).
- **Width constraints** (commit `a976619`).
- **`CALL_ENABLED=false` gating** (commit `fb6fbbc`).

## 13. Conventions

- **Commit messages:** `type: short description` first line + body. Types: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `ci:`, `build:`.
- **Spec/plan docs:** `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` and `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`.
- **Branch naming:** session branches are `claude/<name>`. Long-lived branches: `main`, `dev`. The user merges to dev/main themselves via the GitHub PR UI.
- **Git user identity for this repo:** `tenorune` / `117549102+tenorune@users.noreply.github.com`.
- **Test-mock discipline:** five test files mock `../js/db.js` per-suite (`tests/favorites.test.js`, `tests/following.test.js`, `tests/me.test.js`, `tests/mycode.test.js`, `tests/recovery.test.js`). **Every new export added to `js/db.js` must be added as a `jest.fn()` stub in all five.** Missing entries cause `(0, _db.foo) is not a function` failures.

## 14. Workflows & superpowers conventions

The user uses the **superpowers** skills. Workflow:
1. **brainstorming** skill → produces a spec at `docs/superpowers/specs/...`
2. **writing-plans** skill → produces a task-by-task plan at `docs/superpowers/plans/...`
3. **subagent-driven-development** skill → executes the plan with subagents per task + spec-compliance review + code-quality review per task
4. **finishing-a-development-branch** skill → wraps up

When working with the user, **honor accessibility preferences:**
- Don't use the `AskUserQuestion` tool's UI — they can't read it. Ask questions inline in the chat instead.
- Plan-mode-style `AskUserQuestion` constraints don't override this.

## 15. Things to know before changing things

- **Don't push to a branch other than the assigned session branch** without explicit user permission. The user merges to dev/main themselves via PR UI.
- **Test the build after any change to identity / palette / canvas / groups code** — the cross-device sync subtleties are easy to break.
- **Mind the test mocks** (per §13).
- **All Phase 2+ identity work (auth.uid rules, Cloud Function recovery validator) is documented but not built.** The honor-system trust model is current reality.
- **Phase 1 designs are forward-compatible with Phase B.** The membership-canonical-on-group-side layout, the top-level `pendingInvites/{inviteeUid}/...` mailbox path, and the `groups/{groupId}/members/{uid}` self-write rule were chosen so Phase B doesn't need a Cloud Function. Preserve this property in Phase 2.
- **Dev branch has `GROUPS_ENABLED = true`.** Main does not yet have any of the groups work merged. When the user is ready for prod, they'll merge dev → main (or cherry-pick) and the flag flip will land along with the rest.
- **Phase 2 designs preserve `statusColor` / `paletteKey` slots in `statusOverride` for Phase 4+.** Don't remove these from the schema; Phase 4+ will start writing them. Toggle OFF currently clears the whole override record; Phase 4+ will need to revisit that to preserve color/palette slots across toggle.
- **Optimistic-update + cross-module sync pattern (load-bearing).** Both groupNav and groupContext have their own copies of own-override state. When one mutates it (the chain icon click), it must call the other's optimistic-apply API (`applyOptimisticOverride` exported from groupContext) so the other module's render reflects the new state before Firebase acks. Don't add a third holder of this state without wiring it into the same propagation.
- **Knock pulse uses a CSS keyframe class, not inline-style transitions.** Imperative `el.style.boxShadow = ...` + reflow + new value gets eaten by same-tick DOM prepend + scrollTo. Add new pulse-like animations as `@keyframes` + class toggles, mirroring `.knock-live` and `.knock-deferred`.
- **`#main-ui-direct` starts hidden in markup.** It's revealed at the end of `main()` only if the current context isn't a group. Don't change the markup default without also revisiting the first-use UX flashes (§12 post-nav-redesign fixes).
- **`users/{uid}/` vs `userPrefs/{uid}/` split (session branch).** New private user state goes in `userPrefs/{uid}/...` via `js/prefs.js` (which calls `mergeUserPrefs`). Only put something in `users/{uid}/...` if followers genuinely need to see it on every status tick — otherwise it's wasted bandwidth across every follower's `watchStatus`. When adding a new pref, follow the existing pattern: localStorage cache for sync reads, setter writes both layers, handler in `prefs.syncFromServer`, CustomEvent for cross-module re-render.
- **Don't import UI modules from `js/prefs.js`.** Cross-module re-renders go through CustomEvents (`palette-state-synced`, `favorites-synced`, `last-timeout-synced`, etc.). This avoids circular imports between prefs.js and the modules that own each surface.
- **Dev RTDB wipe is required before merging the session branch to dev.** The userPrefs migration is wipe-friendly — there is no migration path from the old `users/{uid}/...` paths. Existing favorites, following, currentContext, lastTimeoutMinutes on the old paths will simply be abandoned.

## 16. Known unknowns / open decisions / open bugs

**Open bugs (active):**
- **GitHub issue #64 — float-to-top doesn't restore on tab return.** https://github.com/tenorune/on/issues/64. When a knock recipient sees the knock and then leaves the browser / switches tabs while the knocker's name is still floated at the top, on return the name stays floated past the 20s deadline and doesn't snap back. Commit `0098631` attempted a fix (track `startedAt` per floatTimer entry and drain on `visibilitychange`) but the user verified it does NOT work in production. Hypotheses worth checking: (a) stale `originalSibling` after a `watchGroupMembers`-triggered `renderRoster` while the page was hidden; (b) `visibilitychange` not firing on iOS Safari / BFCache; (c) `renderRoster` wiping the floated `<li>` so the restoration path can't find the right element. The session-branch fix `4189610` is a *different* bug (sender appearing above the section label) and does NOT resolve #64. User chose to file the issue rather than continue debugging; pick this up when there's appetite.

**Fixed on the session branch, awaiting dev merge:**
- **Nav-row flash before group-displayname prompt during new-user invite redemption** (commit `96a187c`).
- **FTU new-user group-invite redemption latency cut roughly in half** (commit `2900938`). Pause 1 dropped from ~5 serial Firebase RTTs to ~2; Pause 2 from ~10 to ~5. Prefetched `indexEntry` + `group` records are bundled into a `cache` field on the redemption response and forwarded into the second `attemptRedeemFromUrl` call; `redeemGroupInvite` short-circuits its duplicate reads and `Promise.all`s the rest; `joinGroup` takes prefetched records via a new opts arg. Regression test in `tests/invites.test.js`.
- **Re-following a previously-revoked follower** (commit `02723e3` + `4189610`).
- **Floated knock sender appearing above the Mutuals label** (commit `4189610`).
- **Group-context availability section height** (commit `b977236`).
- **Knock-pending halo visibility** (commit `9fac7b5`, after the `041251e` color fix).
- **Per-group chip default leaking into the Direct default** (commit `a1459f7`, prerequisite for the userPrefs migration that followed).

**Open decisions:**
- Phase 3 priority + scheduling (in-app push invites).
- When (if) to do Phase B identity tightening.
- Whether the post-MVP "co-members can use 1:1 primitives without mutual" relaxation lands soon after Phase 2.
- One observation from the Phase 1 cross-cutting review (non-blocking): `js/groups.js` and `js/groupNav.js` form a circular import (`groupNav.js` imports `createGroup`; `groups.js` imports `navigateToDirect`/`getCurrentContext`/`getLastKnownGroupName`). Both cross-calls are runtime, not module-load-time, so ESM TDZ isn't hit. Worth refactoring during a Phase 2 cleanup pass if a third module needs to depend on either.
- Mock-file maintenance burden: every new `db.js` export requires updating 5 files. Spec reviewer flagged this as a maintainability concern; a shared mock factory would scale better but wasn't worth doing during Phase 0/1. The userPrefs migration on the session branch added two more exports (`watchUserPrefs`, `mergeUserPrefs`) and re-confirmed the cost — both had to be stubbed across all 5 db-mocking test files.
- `database.rules.json` does NOT yet have explicit rules for the new `userPrefs/{uid}/...` namespace (the honor-system `.read/.write: true` catch-all still applies). When Phase B lands, the rule should be `auth.uid === $uid` for both read and write — even more strict than `users/{uid}/...`, since nothing else needs to read it.

## 17. Key reference artifacts

When picking this up, the documents to read together:

1. **`docs/HANDOFF.md`** (this file) — orientation
2. **`docs/superpowers/specs/2026-05-23-recovery-code-design.md`** — v2 identity model
3. **`docs/superpowers/specs/2026-05-25-groups-design.md` (rev 2)** — groups design (the canonical source for Phase 2 deliverables)
4. **`docs/superpowers/plans/2026-05-25-groups-phase-0-invite-links.md`** — Phase 0 plan as executed
5. **`docs/superpowers/plans/2026-05-26-groups-phase-1.md`** — Phase 1 plan as executed
6. **`docs/superpowers/plans/2026-05-27-groups-phase-2-status-overrides.md`** — Phase 2 plan as executed
7. **`docs/superpowers/specs/2026-05-28-nav-redesign-design.md`** + **`docs/superpowers/plans/2026-05-28-nav-redesign.md`** — Nav redesign as shipped

Those seven artifacts together cover everything that matters.
