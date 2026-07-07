# KnockKnock — Session Handoff

A handoff to whoever picks this up next. Read top-to-bottom; specific subsections can be re-skimmed when working in a particular area.

**Most recent work (session 2026-07-07b): group-context support for the Telegram bot — BUILT, reviewed, pushed, and ON-DEVICE VERIFIED.** Branch **`claude/telegram-group-context-jkiwxq`** (cut from the onboarding tip `85708a7`; contains **all** of `claude/telegram-app-adaptation-t1r1jp` + `…-sk15hw`), tip `a5df4ad`, pushed, working tree clean, **not merged** (maintainer merges `dev`). Web **1385/1385**, functions **197/197** (+26 tests). All five §32-queued gaps closed in `functions/telegram.js` (+ tests): knock-back/availability buttons carry `knock:uid:gid` and `writeKnock` sets `contextGroupId` (mirrors the client transaction); `/knock` falls back to shared-group rosters (Direct always wins) with group-context knocks + `(GroupName)`-labelled disambiguation; `/who <group>` lists co-members by `effectiveAvailable` (override masking honored, self excluded); `/status <group> [dur]` and `/off <group>` merge only `status`/`availableUntil` into an **enabled** `statusOverride` — the bot **never flips `enabled`** (or statusColor/paletteKey); with the override OFF they write **nothing** and reply with guidance (fan-out rides the existing `onMemberOverride` trigger). Group naming = case-insensitive **name-substring** match over the user's own groups. Final whole-branch review found one Important issue, **fixed** (`e1523c7`): callback-supplied gids are attacker-controllable and Admin-SDK writes bypass DB rules, so the `knock` callback now enforces `/^[A-Z0-9]{8}$/` before writing `contextGroupId`. **Operator verified the shipped work on device (2026-07-07).** Spec `docs/superpowers/specs/2026-07-07-telegram-group-context-design.md`; plan `docs/superpowers/plans/2026-07-07-telegram-group-context.md`; rundown **§33**. Session admin: `t1r1jp` fast-forwarded to `85708a7` (all three Telegram branches now converge; merging `jkiwxq` alone brings everything); `sk15hw` deleted locally (remote delete was 403-refused — still on GitHub, safe to delete there).

**Prior work (session 2026-07-07a): documented a bot-invite gap + reconciled both Telegram specs with the shipped code.** 4 docs-only commits on `claude/telegram-onboarding-ux-sk15hw` (`74d73f4..7a36ca0`), all pushed, working tree clean, **not merged** (maintainer merges `dev`). Web **1385/1385**, functions **171/171**. No code touched. Traced + recorded the **web-invite-in-Telegram-in-app-browser gap** (a plain `?i=` link opened in Telegram's in-app browser can't reach the opener's Mini-App-only account → duplicate web account, follow on the wrong identity; fix direction "option A1" = an "Open in Telegram" CTA via the `startapp` deep link) in onboarding-spec **§9**. Then analyzed both specs for drift vs. reality and reconciled: the **2026-07-05 onboarding spec** got an **"As-built deltas"** section (graduation shipped; landing banners removed → `{graduated}`-only toast; standalone walker not a refactor; `__TELEGRAM_APP_LINK__`→esbuild `define`; `shareInvite`→`shareInviteLink`; drifted line refs), and the **2026-07-02 adaptation spec** got a header supersession pointer (`isTelegram()`→`isTelegramContext()`; `/start` reshaped). Rundown **§32**.

**Prior work (session 2026-07-06d): §29 stale-inviter-label fixed + the 07-06c build fully on-device verified.** 1 commit on `claude/telegram-onboarding-ux-sk15hw` (`a712618..74d73f4`), pushed, working tree clean, **not merged** (maintainer merges `dev`). Web **1385/1385**, functions **171/171**. Rundown **§31**. Fixed the **§29 arrival-interstitial stale inviter name** (option A — refresh for all accounts): `sharePersonalInvite` (`js/mycode.js`) now rewrites an active invite's `creatorLabel` to the current `telegramFirstName()` when it differs, via new `updateInviteLabel` (`js/invites.js`) → `setInviteLabel` (`js/db/social.js`, a partial `creatorLabel` update — token/URL unchanged so already-shared links keep working); skips the write when unchanged and keeps the existing label (**no clobber**) when TG exposes no name. And **on-device verification of the 07-06c build is DONE** — the graduation round-trip, the "?" affordance on both surfaces, the boot toast ("This account now works in any browser too."), the "Bits n bobs" chip, the web "Share to Telegram" placement, and the refreshed inviter name were all walked in the real Telegram webview / browser.

**Prior work (session 2026-07-06c): Graduation flow BUILT + follow-on UX + web "Share to Telegram".** 8 commits on `claude/telegram-onboarding-ux-sk15hw` (tip `0bc88a8`), all pushed, working tree clean, **not merged** (maintainer merges `dev`). Web **1380/1380**, functions **171/171**. Rundown **§30**. Shipped: the **Graduation flow** (spec §7) — server `graduateTelegram({ initData, code })` + a shared account-move walker `graduateAccountData` (copy own subtree → rewrite backrefs/indexes/canvases/groups → move mailboxes → repoint `telegramUsers`/`telegramByUid` → drop old subtree; require **unlinked** mapping + **free** target uid; `validateRecovery` rate limiter on the candidate uid). Client entry is a small **"?" info toast** (guided empty state beside "Link your account", AND the drawer Account section) → recovery modal with graduation knobs → migrate-and-reload; success feedback **reuses the shared `showToast`** at boot (the bespoke `landing-notice` banner + `showLandingNotice` deleted; `consumeLandingNotice()` returns the copy). Follow-on UX: recovery-modal **Cancel beside "I've saved it"** + a single generic error for every code; header chip reads **"Bits n bobs"** outside the guided-empty state (else "Share code"); the shared toast width widened. And spec §4's **web "Share to Telegram"** — the invite-modal share button un-gates to web via `telegramSharingEnabled()` (`TELEGRAM_ENABLED && TELEGRAM_APP_LINK`), opens the `t.me/share/url` intent in a new tab (popup-blocked → copy the deep link), sits **below Copy**, caption blank-lined for desktop. (On-device verification of this build was **completed in 07-06d** — see the top block + §31.)

**Prior work (session 2026-07-06b): THIRD smoke-test round + the notification-channel pill.** 10 commits on `claude/telegram-onboarding-ux-sk15hw` (tip `4381100`), all pushed, working tree clean, **not merged** (maintainer merges `dev`). Web **1355/1355**, functions **160/160**. Rundown **§29**. Highlights: TG chrome color **memoized** (redundant `set_header_color`/`set_background_color` postEvents were flooding the webview bridge + console); guided-empty-state **declutter** (install corner-icon suppressed with the toast; the drawer's "Invite your people" button + "Invite" label + "Or…" hint framing hidden, Telegram account section hidden for **unlinked** — all restored when non-empty; **linked** accounts keep their account/unlink section); drawer "Invite your people" now **one-tap shares** in TG; and a **notification-channel toggle pill** `[ Telegram | Push ]` for linked accounts on **both** TG and web, reconciled live from `watchUserPrefs` (link/unlink + cross-device channel switches reflect **without reload**; "linked" decided **per surface** since a Telegram-*derived* account also carries the `userPrefs.telegram` marker). **macOS chrome-color question CLOSED:** the native `macos` client ignores chrome color even at Bot API 9.6 (works on `tdesktop`+iOS) — a client limitation, not app-fixable. **Testing NOT finished — expect more rounds.**

**Prior work (session 2026-07-06a): SECOND round of on-device smoke-test feedback applied.** 9 commits on `claude/telegram-onboarding-ux-sk15hw` (tip `5a605fa`), all pushed, working tree clean, **not merged** (maintainer merges `dev` per convention). Web **1334/1334**, functions **160/160**. Fixes this round (rundown **§28**): invite-accepters now show as "CODE (Name)" on the inviter's followers list (new cross-device `users/{inviter}/followerNames/{follower}` propagation, fill-if-empty into the roster); welcome-tagline reword + guided-empty-state spacing; interstitial tagline removed; **group-deletion detection fixed** — owner delete cancels the member's membership-gated `watchGroupMeta` listener (PERMISSION_DENIED, not a null tick), now handled so the stale nav card self-cleans (general bug, web too); **unified group invite flow** — one modal in both contexts (TG "Share on Telegram" + picker; web link-UI + picker), now shown *synchronously* which also fixes the create→group transition jank; and **`js/promptModal.js`** replacing `window.prompt/confirm/alert` (all no-ops in Telegram macOS Desktop) for group rename/edit-name/delete/leave + the last `window.alert` error-paths — `js/` is now native-dialog-free. **Testing is NOT finished — expect more rounds.** One maintainer-deferred item: the group-deletion **toast** the remaining member sees still shows the 8-char group *code*, not the name (won't-fix for now).

**Prior work (session 2026-07-05c): FIRST round of on-device smoke-test feedback applied.** 7 commits on `claude/telegram-onboarding-ux-sk15hw` (tip `1f56037`), all pushed, working tree clean, **not merged** (maintainer merges `dev` per convention). Web **1311/1311**, functions **160/160**. Fixes this round (rundown **§27**): drawer `max-height` clip after the §4 regroup; TG empty-state "Invite your people" now shares the `t.me` deep link (not the web modal); macOS share caption separator; unlink confirm → the shared `.confirm-overlay` modal (was an inline drawer block); post-link/post-unlink landing banners **removed** (unwanted inline-toast style — graduation's reuse of the mechanism flagged in spec §7); the "this browser doesn't support web notifications" toast suppressed inside Telegram (the bot is the channel there); and a **one-time welcome DM on first Mini App open** (server-side, `validateTelegramHandler`, verified on-device with a fresh account).

**Next likely action:** nothing queued — the §32-queued bot group-context work is **done and on-device verified** (see the top block + §33). Remaining open items are below.

**Also still open (no owner yet):** the web-invite-in-Telegram-in-app-browser gap (onboarding spec §9, option A1 — documented, not built); and merge itself is the maintainer's (flag-flip scripted in `docs/telegram-setup.md` § "Merge prep"). **Deploy landmine:** every push to `dev` **wipes the branch-only Telegram functions** (CI `--force` from `dev`'s source — redeploy per runbook A5) and reverts DB rules, so the Mini App dies at boot until redeployed; deploy deps `TELEGRAM_APP_LINK` (root `.env.local`) / `TELEGRAM_APP_URL` (`functions/.env`) + preview rebuilt. See `docs/telegram-setup.md` A5/A6 + Part A.

**Prior work (session 2026-07-05b): Telegram new-user onboarding + UX polish — BUILT, reviewed, pushed.** Branch `claude/telegram-onboarding-ux-sk15hw` (cut from the Telegram-adaptation tip `2abb56b`; carries all of that branch + `dev`). 11 TDD tasks, each independently reviewed, whole-branch opus review returned **ready-to-merge = Yes** (no Critical/Important). What shipped: the Telegram onramp (`t.me/…?startapp=` deep-link invites → first-run interstitial; bot `/start` funnels strangers instead of dumping commands), a guided empty state (`js/firstRun.js`, web + TG), link/unlink confirmations + landing banners, drawer regroup (Invite/Account/Notifications), Telegram chrome (back button, swipe-disable, call close-confirm, color re-sync), and the recovery-modal extraction that ENABLES (but does not build) the future "graduation" flow. Spec `docs/superpowers/specs/2026-07-05-telegram-onboarding-ux-design.md`; plan `docs/superpowers/plans/2026-07-05-telegram-onboarding-ux.md`; rundown **§26**. (Session 07-05c above applied the first smoke-test feedback on top.)

**Prior work (sessions 2026-07-02 → 2026-07-05a): the experimental Telegram adaptation** — branch `claude/telegram-app-adaptation-t1r1jp`, the base the onboarding branch builds on. A Telegram Mini App (auto sign-in via signed `initData` → Firebase custom token; optional phrase-account linking — linking or unlinking **expunges** the temporary Telegram-derived account), a companion bot (webhook Cloud Function; commands + inline action buttons), and a `sendToUser()` channel switch (Telegram message when `notifyChannel==='telegram'`, FCM fallback). Feature flag `TELEGRAM_ENABLED` in `js/features.js` — **true on the branch**; flag-flip-at-merge (also reverts the ungated script tag + CSP relaxation) scripted in `docs/telegram-setup.md` § "Merge prep". Implementation rundown **§24**; testing/hardening **§25**; operator runbooks in `docs/telegram-setup.md`.

---

**Prior work (session 2026-06-21 — shipped as `v1.3.0`, `dev → main` PR #281):** a sorting / hints / cross-device-polish pass on branch `claude/stoic-edison-fd4173` — FTU **hint rotation** (new `js/hintRotation.js`), **Direct contact-list live sorting** (rename / availability / incoming-call pin / knock-float-restore), layout consistency (authoritative `--nav-h`; group header now sticky, **#274**), and the cross-device **favorites sync fix (#253)**. Full rundown in **§23**.

**Prior work (sessions 2026-06-18):** two waves on branch `onboarding-platform-matrix`.
1. **Onboarding & install redesign + invite-preview fix — shipped as `v1.2.0`** (merged `dev → main`): platform-aware install lanes (`onboardingLane()`), a capability-driven Install button shown from page load on Chromium, an in-flow corner install icon + toast inside `#main-ui-direct` (Direct-only), a rebuilt restore/sign-in screen (always-visible field, one adaptive "Paste & Sign in"/"Sign in" button), Telegram/in-app-browser handling with a clipboard + `?setup=install` handoff, and a new **unauthenticated `resolveInvitePreview` Cloud callable** so invite framing works for brand-new users. Full rundown in **§21**.
2. **`/about` page + invite framing — POST-v1.2.0, about to merge `dev → main`**: a shareable `/about` landing page (merged from `claude/adoring-fermi-panh4e`), an in-app-browser "Open app" escape (iOS `x-safari-https://` / Android `intent://`, device-tested on iOS+Android), and invite framing on `/about?i=TOKEN` (fetches `resolveInvitePreview`, carries the token into the app). Full rundown in **§22**. Shipped in **`v1.3.0`** (this release).

(Prior sessions: §18 = 2026-06-13 perf/hygiene, §19 = 2026-06-14 push/notifications, §20 = the v1.1.0 release note.)

**Next likely action:** `v1.3.0` is merged to `main` (PR #281) and being tagged/deployed — no blockers. Background follow-ups remain: **#265** (configurable invite-link surface), **#214 R4** (suspend Direct presence watches in group), **#217** (doc-drift close), **#218** (groups backlog). **No manual cache step is needed** — `firebase.json` serves everything `no-cache` and `sw.js`'s `CACHE` is auto-stamped with a content hash at build (see §Service worker cache).

**Open follow-up work** (issues, not blockers — full list in §18):
- **#214 R4** — suspend Direct presence watches while in a group context. Deliberately separated from R3 because it's entangled with context-switching, call-mode, and flash-avoidance. The biggest dedup win (R3) already shipped.
- **#217** — doc drift (Phase 2 toggle-OFF + invite-push phasing). **Reconciled 2026-06-13** (HANDOFF §15, Phase 2 plan, groups spec); pending maintainer close.
- **#218** — consolidated post-MVP groups backlog (admin role, owner group color, >5-card collapse, dup-name UI, approval-gated joins).
- **#265** — make the invite-modal link surface configurable (canonical `/?i=` vs a framed `/invite` landing). Background only; canonical flow unaffected (see §22).

**Phase 4+:** request-to-follow (`js/followRequests.js`), group color/palette, and the per-audience (per-group) color picker have since **shipped**. Admin role and ownership transfer remain documented in groups spec §16 but unplanned (tracked: #180, #218).

**Recently closed bugs:** #64 (knock float-to-top tab-return) and #116 (Direct swatch `<div>` a11y) are now resolved — earlier handoffs cited them as open; they are not. **#215** (Direct availability push has no shared-context label) is **closed as accept-and-document** — the unlabelled Direct push is *intended* (see §18). **#253** (cross-device favorites resurrecting stale pills) and **#274** (group availability box not sticky) were **fixed in `v1.3.0`** — see §23 (close them).

---

## 1. What KnockKnock is

A vanilla-JS PWA for **ambient presence**. Users mark themselves "available for N hours" and contacts see their status with personalized color themes. Layered features: knock-to-pulse, swipe-to-call, shared collaborative drawing canvas during calls, and (Phases 1–3) groups with per-group display names, per-audience status, invite links, and in-app push invites.

- **Target user base:** 50–100 users (a small, hands-on sandbox, not a public app).
- **Stack:** vanilla ES modules (no framework), Firebase Realtime Database + Hosting, esbuild, jest + jsdom.
- **Tests:** web suite **43 suites / 1203 tests** on `onboarding-platform-matrix` (run `npx jest`). Cloud Functions have their own suite — **4 suites / 76 tests** (`cd functions && npm test`; run `npm install` there first if `node_modules` is absent). (Counts grow as branches merge to `dev`; older handoffs cite lower numbers.)
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
- **CI deploys `--only hosting,database,functions --force`** (an earlier version of this note said hosting,database only — stale). Database rules ship with every deploy, and so do functions. **`--force` deletes deployed functions that are missing from the pushed source** — this is what tears down branch-only functions (e.g. the unmerged Telegram callables on the dev project) on every push to `dev`; see `docs/telegram-setup.md` Part A caveats (bit us 2026-07-05).
- **Local deploys:** `npm run deploy:dev` uses `--only hosting,database` (does NOT touch functions); `npm run deploy` (prod) uses `--only hosting,database,functions`.
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
| **Onboarding install (2026-06, redesigned — see §21)** | `js/installGuidance.js` = platform detection + `onboardingLane()` (lanes: `ready` \| `in-app-browser` \| `ios-install` \| `macos-install` \| `installable` \| `push-in-tab`) + install/guidance copy + `supportsInstallPrompt()` feature-detect. `js/installPrompt.js` captures `beforeinstallprompt` (Chromium only). `js/installAffordance.js` renders the **in-flow corner install icon + toast inside `#main-ui-direct`** (Direct-context only; the icon seats at the screen bottom via a flex `min-height` column, and toasts always render above it). `js/phraseReminder.js` = Firebase-free shared "save your phrase" reminder + clipboard copy (extracted so the affordance doesn't pull in firebase-config). iOS Chrome/Firefox install **normally** (iOS 16.4+, not Safari-only); only true in-app WebViews (Telegram/IG/etc.) get `showInAppBrowserRedirect()`. Telegram→install handoff carries the phrase via clipboard + the `?setup=install` URL marker (a Safari-hop guard prevents duplicate accounts). **The Keychain-credential-save approach was abandoned** (programmatically-filled hidden fields don't trigger an iOS save — verified dead on device). Restore screen: always-visible `type=text` field, single adaptive **"Paste & Sign in" / "Sign in"** button. Spec: `docs/superpowers/specs/2026-06-16-onboarding-install-redesign-design.md`. |

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
- **#217** — doc drift (Phase 2 toggle-OFF + invite-push phasing).
- **#218** — post-MVP groups backlog.
- **#265** — configurable invite-modal link surface (canonical vs framed `/invite` landing).
- **#124** — Phase 3 inviter-side "sent invites" view + cross-device revoke. The MVP Phase 3 doesn't include this; the picker's in-modal "Invited" pill is the only revoke surface. Mirror at `userPrefs/{ownerUid}/sentInvites/{groupId}/{inviteeUid}` is the suggested shape.
- **#180 / #181 / #193 / #161 / #160 / #156 / #148 / #34** — longer-standing deferrals (moderation, invite controls, App Check, install nudge, Telegram channel, desktop-notif debug, lastVisited migration, npm deprecations).

*(Resolved since earlier handoffs: #64 knock float-to-top, #116 Direct swatch a11y, #182/#183 perf+hygiene waves, #216 status-dot renderer, **#215 Direct-push label — closed accept-and-document**.)*

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
- **#214 R4 — suspend Direct presence watches in a group context** (R1/R2/R3/R5/R6 shipped). Entangled with context-switch + call-mode + flash-avoidance; deliberately its own pass.
- **#265 — configurable invite-modal link surface** (canonical `/?i=` vs framed `/invite` landing; see §22). Background, canonical flow unaffected.
- **#217 — doc drift (reconciled 2026-06-13, pending maintainer close):** the Phase 2 plan described the old `clearStatusOverride` toggle-OFF (code uses `mergeStatusOverride`, which preserves `statusColor`/`paletteKey`) and framed the per-group picker + push-on-invite as Phase 4+ though both shipped. HANDOFF §15, the Phase 2 plan, and the groups spec §16 now describe the shipped behavior.
- **#218 — post-MVP groups backlog** (admin role, owner group color, >5-card collapse, dup-name UI, approval-gated joins).
- **#124 — Phase 3 inviter-side "sent invites" view + cross-device revoke.** The picker's in-modal "Invited" pill is the only revoke surface today (same-modal-session only, no cross-device).
- Longer-standing: **#180** (group moderation: kick + ownership transfer), **#181** (invite TTL/cap UI + confirm card + label edit + index sweep + stale "Requested"), **#193** (App Check enforcement — flag-day risk, deferred), **#161** (standalone install nudge), **#160** (Telegram notification channel), **#156** (desktop PWA notification debug), **#148** (lastVisited userPrefs migration, Option A), **#34** (npm deprecation warnings).

*(Closed since earlier handoffs: **#64** knock float-to-top tab-return, **#116** Direct swatch `<div>` a11y, **#215** Direct-push shared-context label (accept-and-document — see §18). All were previously listed here as open.)*

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
| **#215** | Direct availability pushes carry no shared-context label | **CLOSED — accept-and-document (not a gap).** `handleAvailability` only fires on the sender's *primary* and its group pass skips override-ON groups (those go via `onMemberOverride`), so every group it could label is override-OFF = already equal to primary → "X is available in {group}" adds no info and can mislead a dual follower+co-member into reading it as group-bounded. The label only earns its place on divergence (override-ON), which `onMemberOverride` already labels. Finding #7's rare cross-invocation duplicate push (a Direct follower who is also an override-ON co-member) was also **accepted** for a 50–100-user app. Both decisions documented in `functions/notifier.js` ("One push per recipient" note). Comment-only. |
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

## 21. Session 2026-06-18 — onboarding & install redesign + invite-preview fix (shipped as v1.2.0)

A focused product pass on **first-time-user onboarding and PWA install**, plus a backend fix so invite links greet new users by name. All merged `dev → main` and tagged **`v1.2.0`** (the first feature release after v1.1.0). Branch: `onboarding-platform-matrix`.

### Goal of this work
Make creating an account + installing the PWA dead-simple, and right-sized per platform — install is genuinely valuable on iOS/macOS-Safari (notifications need an installed app) but optional elsewhere. The driving real-world constraint: **most users arrive via the Telegram in-app browser**, where they must create an account, then move to a real browser / installed app, carrying their secret phrase.

### What shipped

**Install lanes & affordance** (`js/installGuidance.js`, `js/installAffordance.js`, `js/installPrompt.js`)
- `onboardingLane({ installPromptAvailable })` → `ready | in-app-browser | ios-install | macos-install | installable | push-in-tab`. Order: standalone→`ready`; in-app WebView→`in-app-browser`; macOS Safari→`macos-install`; iOS→`ios-install`; Chromium (capability OR captured event)→`installable`; Firefox desktop→`push-in-tab`; else `ready`.
- **Install button is capability-driven, not event-timed.** `supportsInstallPrompt()` = `'onbeforeinstallprompt' in window` (true on Chromium). The `installable` lane activates from page load. With a captured `beforeinstallprompt`, the toast shows a one-tap **Install** button (native dialog via `promptInstall()`); **without** a captured event it appends the platform-aware manual step **inline** (address-bar install glyph / Android menu) — **no button** (an earlier iteration had a button that swapped to instructions on click; simplified away).
- **Corner install icon is in-flow inside `#main-ui-direct`** (Direct-context only). It's a flex-column child that seats at the **bottom of the viewport** (via `#main-ui-direct { display:flex; flex-direction:column; min-height:calc(100dvh - 3rem) }` + `.install-fab { margin-top:auto }`), gets pushed down by the roster/contact lists, and clears the bottom safe-area. **Toasts always render above the icon** (the icon is in normal flow, not `position:fixed`).
- **Lane lead-in:** `installable` and `push-in-tab` lead with the **toast**; the icon takes over after dismiss. `ios-install`/`macos-install` land **already-dismissed** (icon first, toast on tap) — because the user has just tapped "Maybe later" on the install step of the new-user flow, so re-popping the same content would nag.

**Restore / sign-in screen** (`showRestoreScreen` in `js/app.js`)
- Always-visible `type=text` field (no masking), placeholder `your-four-secret-words`. One adaptive button: empty field → **"Paste & Sign in"** (reads clipboard); typed/pasted text → **"Sign in"**; busy → "Signing in…".
- Six possible errors (all via `showError`): empty-after-paste, malformed phrase, sign-in failure (retryable), no-account, post-sign-in read failure (retryable), empty-user. The malformed-phrase copy was shortened to **"That doesn't look like a secret phrase."** (post-v1.2.0 commit).

**Telegram / in-app-browser handling**
- `isInAppBrowser()` regex catches FBAN/FBAV/Instagram/Line/Snapchat/Telegram/MicroMessenger/Android `; wv)` etc. → `showInAppBrowserRedirect()`. **Caveat:** Telegram's *in-app Safari* mode (SFSafariViewController) has a byte-identical Safari UA and is **undetectable** — only the custom-WebView mode is caught.
- The handoff that actually works: create the account in Telegram (persists in that partition), **clipboard-carry the phrase**, one-tap Paste in the installed app. The `?setup=install` URL marker + a Safari-hop guard (`isSetupInstall() && !isStandalone()` → show install step, not the chooser) prevent forking a duplicate account when the user opens the page in a real browser to install.

**Invite-preview framing fix** (`functions/invites.js`, `js/invites.js`, `js/firebase-config.js`, `js/db/social.js`)
- **Root cause:** the welcome-screen "You've been invited to follow/join …" framing calls `resolveInvitePreview` *before* a brand-new user has any Firebase auth session, but every invite node (`inviteIndex`, the invite record, group name) is gated by `auth != null` → permission-denied → null → no framing. It only appeared where a cached auth session happened to exist (e.g. the Telegram partition); it was broken for the new users it targets (incognito/fresh confirmed this).
- **Fix:** new **unauthenticated** `resolveInvitePreview` Cloud callable (`functions/invites.js`, wired in `functions/index.js`) reads via the Admin SDK (bypasses rules) and returns only preview-safe fields (`{ preview: { scope, label } | { scope, groupName, groupId } | null }`). Mirrors the pre-auth `validateRecovery` pattern. Client `resolveInvitePreview` now delegates to `callResolveInvitePreview` (in `firebase-config.js`, **re-exported through the `db.js` barrel via `db/social.js`** so `invites.js` doesn't import firebase-config directly — that pulled `firebase/auth` into db-mock-only test graphs and broke them).
- **DB rules unchanged.** No rate limit (invite tokens are 128-bit; enumeration infeasible) — a global limiter is a possible later DoS backstop.
- **Requires a functions deploy**, but it ships automatically with the normal CI deploy (`--only hosting,database,functions` on push to `dev`/`main`). Documented in `docs/DEPLOY-PROD.md` → "Addendum — `resolveInvitePreview` callable".

**Copy**
- Group-invite display-name prompt (`js/groupDisplayNamePrompt.js`, used by both link-join and Inbox-Join) reworded to **"What name would you like to use in '{group}'?"** (was "Your name in '{group}'"). The in-group rename prompt in `groupContext.js` ("Your name in this group") was intentionally left.

**Other**
- `notifyPrompt.js`: the passive 2nd-session promo was **removed** — notifications are now purely bell-gated (the reprompt path stays). `phraseReminder.js` was extracted from `notifyPrompt.js` (Firebase-free) so the install affordance can share it.
- PWA: canonical 180px apple-touch-icon + templated `apple-mobile-web-app-title` meta.
- `isIos()` keys off `maxTouchPoints > 0` (not `ontouchend`) so desktop Chrome-on-macOS isn't misrouted into the iOS lane.

### Load-bearing context for this area (read before touching it)
- **iOS 16.4+ web push works from ANY browser's installed Home-Screen app** — not Safari-only. The installed app runs in system WebKit with its own storage partition, independent of (and surviving the deletion of) the installing browser. Don't "fix" the lanes back to Safari-only.
- **`resolveInvitePreview` MUST stay an unauthenticated callable.** Moving it back to client-side direct reads re-breaks framing for new users (auth-gated nodes).
- **Build pitfall (cost a debugging session):** missing `.env.*` makes the bundle fall back to `REPLACE_ME` Firebase keys → `getDatabase()` throws at module load → **splash freeze**. Dev preview builds need `.env.local` (`node scripts/dev-build.js`); prod uses `.env.production` (`npm run build`).
- **`callResolveInvitePreview` is a new `db.js` barrel export** (re-exported from `firebase-config.js` via `db/social.js`). Only `tests/invites.test.js` exercises `resolveInvitePreview`, so only it needed the mock entry — but keep the barrel-routing pattern if you add more pre-auth callables.
- **The corner icon and all install toasts are Direct-context only** (the markup lives inside `#main-ui-direct`).

### Test state on this branch
Web suite **42 suites / 1171 tests** (`npx jest`); Cloud Functions **4 suites / 76 tests** (`cd functions && npm test`; run `npm install` there first if `node_modules` is absent). Key suites: `tests/installGuidance.test.js`, `tests/installAffordance.test.js`, `tests/invites.test.js`, `tests/recovery.test.js`, `functions/test/invites.test.js`.

### Open / deferred from this session
- **Rate-limit `resolveInvitePreview`** (optional DoS backstop) — deferred; tokens are 128-bit so enumeration is a non-issue.
- **Telegram in-app-Safari is undetectable** — no fix possible client-side; the clipboard + `?setup=install` handoff is the mitigation.
- Restore-screen error #1 ("Paste or type your secret phrase.") was reviewed and **left as-is** by the maintainer.

> **All of the above shipped in `v1.2.0`** — the release was tagged after the final copy commits merged to `main`, so nothing from this session is awaiting a later tag.

## 22. `/about` page (side experiment, 2026-06-18)

A standalone, shareable landing/about page — candidate for the link that gets passed around. Merged from `claude/adoring-fermi-panh4e`. **Not yet released** (post-v1.2.0; rides the next tag).

- **`about.template.html` → `about.html`** (built by `renderAbout`/`writeAboutHtml` in `scripts/build.js`, emitted from all build paths; `about.html` is gitignored). Served at the clean URL **`/about`** via a `firebase.json` hosting rewrite that **precedes** the `**` catch-all. Substitutions: `__APP_TITLE__`, `__DATA_REGION__`, `__ABOUT_MADE_BY__` (author optional; degrades to "Made with a little help from Claude"). Spec/plan: `docs/superpowers/specs|plans/2026-06-18-about-page*`.
- **Self-contained static page** — its own `css/about.css`, no app bundle. Two inline `<head>` scripts (theme-restore, byte-identical to index's so it shares the CSP hash; + a status-color easter-egg that tints "ambient presence" — its body hash is whitelisted in the `firebase.json` CSP, asserted by `tests/about-page.test.js`). Don't edit those inline scripts without updating the CSP hash.
- **In-app-browser escape on the "Open app" links** (`js/about-cta.js`, a plain classic script loaded via `<script src>` — allowed by `script-src 'self'`, so **no CSP hash to maintain**). Detection is impossible (Telegram's in-app Safari has a byte-identical Safari UA), so it rewrites `a[data-open-app]` **by platform, always**: **iOS → `x-safari-https://<host>/`** (opens Safari; in real Safari it just prompts "Open in Safari?" — verified harmless on iOS/macOS 26), **Android → `intent://<host>/#Intent;scheme=https;…browser_fallback_url…;end`** (hands off to the default browser; real Chrome resolves it too). **Desktop (incl. macOS) is left as the normal new-tab link** so a Chrome/Firefox user isn't hijacked into Safari. The trade-off: every iOS visitor (even those already in Safari) sees the one-time "Open in Safari?" prompt.
- **Invite framing on `/about?i=TOKEN`** (option (b) — alternate share surface; `buildInviteUrl` still emits `/?i=`). `js/about-invite.js` plain-`fetch`es the unauthenticated `resolveInvitePreview` callable (URL substituted into `#about-invite-framing[data-preview-url]` at build via `__INVITE_PREVIEW_URL__` = `https://europe-west1-<projectId>.cloudfunctions.net/resolveInvitePreview`; CSP `connect-src` already allows `*.cloudfunctions.net`) and fills "You've been invited to follow/join …" (`textContent`, XSS-safe). `js/about-cta.js` carries `?i=TOKEN` through to the app on **every** platform (the about page doesn't redeem — it frames + funnels; the app redeems after account creation). Null preview / no token / unsubstituted URL → framing stays hidden.
- Tests: `tests/about-page.test.js` (renderAbout + `invitePreviewUrl` substitution, template content, `/about` rewrite ordering, theme-script parity, easter-egg + CSP-hash, and a vm-driven test of `about-cta.js` token-carry + platform escape).
- Framing style: `.invite-framing` in `css/about.css` is centered, semibold, status-tinted (`var(--status-echo, var(--accent))`), no left bar. (`css/about.css` also gained the `.hidden { display:none }` rule it was missing.)
- **Device-tested** on iOS + Android (the escape works from real in-app browsers). Accepted trade-off: an iOS visitor already in real Safari sees a one-time "Open in Safari?" prompt on the Open-app tap.
- **Follow-up #265** — make the invite *modal* able to emit a framed-landing link (e.g. `/invite?i=TOKEN`) instead of the canonical `/?i=`, configurably; canonical links stay default. The framing/token-carry scripts aren't path-specific, so a `/invite` → `about.html` rewrite would light up framing for free.
- **Build wrinkle:** `__INVITE_PREVIEW_URL__` is built from the env's `FIREBASE_PROJECT_ID` (+ fixed `europe-west1`). A build with no project id (e.g. this sandbox, missing `.env.*`) emits `data-preview-url=""` → framing inert (the script bails). Real dev/prod builds inject the live URL — verify `/about?i=<real token>` shows framing on the dev deploy.

## 23. Session 2026-06-21 — list sorting, FTU hint rotation, layout consistency, favorites sync (shipped as v1.3.0)

A polish-heavy session on branch `claude/stoic-edison-fd4173`, merged to `dev` in pieces (PRs #272–#280) and promoted `dev → main` as **`v1.3.0`** (PR #281). Web suite **44 suites / 1247 tests**, Functions **4 / 76**.

### 23.1 FTU hint rotation (the big feature) — `js/hintRotation.js`
The longpress (adopt-color) and swipe (call) first-use hints were re-architected from "every eligible card pulses at once" into a **single rotating spotlight**. Spec + plan: `docs/superpowers/specs|plans/2026-06-19-hint-rotation*`.
- **New central engine `js/hintRotation.js` owns ALL hint DOM.** Pure core (unit-tested, no DOM): `resolvePool` (visibility + prefer-available), `selectNextHint` (type alternation + per-type round-robin), `isPaused`. Engine: candidate collection, visibility, pause detection, 6.85s timer, single-hint placement.
- **Row painters only stamp eligibility attributes now** — `updateFolloweeRow` (Direct) and `paintRosterRow` (group) set `data-hint-longpress` / `data-hint-swipe` / `data-hint-avail`; the engine reads them from the active context's list (`#people-list` / `#group-roster`). The old inline `.longpress-hint`/`.swipe-hint` placement + the `_hintAlternate*` timer + `refreshLongpressHints` are gone.
- **Behavior (B1–B8 in the spec):** one hint at a time, alternating type each step; two **identity-stable** round-robin pointers (state `{ lastType, lastIds }`, advanced via `pool.indexOf(lastId)` so re-sorts don't desync); fully-visible cards only; **visibility-first prefer-available** (Interpretation Y — among visible cards prefer available, else visible-unavailable; an off-screen available card does NOT block a visible unavailable one); 6.85s cadence; Direct = both types, Group = longpress only; `prefers-reduced-motion` is **NOT** honored (deliberate).
- **Pauses** (clear + halt): any focus-stealing overlay open (card / share-code drawer, add-person form, create-group / invite modals, group Settings `<details>`, notify popover, revealed recovery phrase — detected centrally via a debounced `MutationObserver` on class/`open`/childList), a call active/incoming, app backgrounded, or active scroll.
- **Visible-region top is runtime-measured** (`_regionTop`): bottom of the lowest *currently-pinned* header in the active context (reads `getComputedStyle().position`), so it adapts whether or not the group header is sticky (decoupled from #274 — see 23.3).
- **Gestures retire a hint via `clearActiveHint()`** (never remove the DIV directly). Group adoption re-stamps the roster synchronously so the engine can't re-pulse before the async override echo. App boot wires `initHintRotation()`.
- **Import-cycle note:** `hintRotation.js` imports `getCallModeCalleeId`/`getIncomingCallFrom` from `following.js`, which imports `refreshHints`/`clearActiveHint` back — safe (runtime-only). **App-boot test suites (e.g. `tests/app-call-recovery.test.js`) must mock `../js/hintRotation.js` or `main()` throws.**

### 23.2 Direct contact-list live sorting (4 fixes) — `js/following.js`
Group already re-sorted on every change (`syncRosterOrder` → `renderRoster`); Direct painted rows in place and never re-invoked `renderList`. Brought Direct in line.
- **`scheduleResort()` is the shared re-sort entry point** (new). Coalesced (one pending), **deferred to a microtask** (a presence value can arrive *synchronously* during `subscribePresence`, which runs inside `renderList`'s reconcile — a synchronous `renderList` there re-enters `reconcileChildren` and **throws** the re-entrancy guard), and **skip-while-editing** (a reorder blurs an open rename input; held + flushed by `confirmRename`/`cancelRename`).
- **Rename** (`confirmRename`) now `renderList()`s after committing — was: only on browser refresh.
- **Availability** — the `subscribeToFollowee` presence callback `scheduleResort()`s only when availability **flips** (not on every color/lastSeen tick).
- **Incoming-call pin** — `sortFollowees` pins `callModeCalleeId ?? _incomingCall?.from` (mutually exclusive) to its section top; the own-call watcher `scheduleResort()`s on ring start/end. **Calls sit above knocks, both directions:** `renderList`'s float loop lifts the call card above floated knockers, and `knock.js applyFloatToTop` inserts a float *below* a top `.call-mode` card.
- **Knock-float expiry** — see 23.4.

### 23.3 Layout / CSS — `css/app.css`
- **Direct availability box no longer drifts/scrolls.** `#nav-row` renders ~`4rem+1px` but `#app-header`'s sticky `top` and `#main-ui-direct`'s `min-height` hardcoded `3rem` → content box ~17px over-tall → spurious page scroll. Fix: a single authoritative **`--nav-h`** sourced on `#nav-row`, referenced by both. (Install-fab bottom margin dropped `2rem → 1rem` since the column is now the right height.)
- **Group availability box is now sticky like Direct's (#274).** `.group-context-header` gained `position:sticky; top:var(--nav-h); z-index:100`. The hint engine's runtime clip (23.1) picks it up automatically.

### 23.4 Knock-float restore is now re-sort-based — `js/knock.js`
`restoreFromFloat` used to manually `insertBefore` the card at a neighbor captured when the float *started* — stale after any re-sort during the float (now frequent with 23.2), landing the card wrong or appended to the bottom, and ignoring status changes during the float. **Intermittent** because a later unrelated re-sort sometimes corrected it. Now expiry just clears the float and dispatches **`knock-float-restored`**; `following.js` (→ `scheduleResort`) and `groupContext.js` (→ `syncRosterOrder`) re-sort so the now-unfloated card lands correctly. The manual DOM move (and its cross-context phantom-row risk) is gone.

### 23.5 Cross-device favorites sync fix (#253) — `js/prefs.js`
`syncFromServer` preserved *every* local-only favorite at the head as a "pending write". A local-only entry *after* a server-known entry is actually a stale remnant (cap-dropped on the other device) → it zombied at slot 1. Fix: preserve only the **leading run** of local-only entries; the server owns everything from the first server-known entry down. (Surfaced in groups because per-group `paletteState` writes wake the favorites merge constantly.)

### Load-bearing context (read before touching sort / hints)
- **`scheduleResort()` MUST stay deferred** (microtask) — a synchronous re-sort from a presence/own-call callback can re-enter `renderList`'s reconcile and crash. It's coalesced + skip-while-editing; the edit flush lives in `confirmRename`/`cancelRename`.
- **The engine is the sole owner of hint DOM.** Row code only stamps `data-hint-*`; don't place hint elements elsewhere. `prefers-reduced-motion` is intentionally not honored.
- **`--nav-h` is the single source of nav height** — `#app-header` top, `#main-ui-direct` min-height, and `.group-context-header` top all reference it; the hint clip measures pinned headers at runtime. Don't reintroduce a hardcoded `3rem`.
- **Calls-above-knocks precedence is enforced in BOTH** `renderList` (float-loop lift) and `applyFloatToTop` (`.call-mode` anchor). Change one, change both.

### Open / deferred from this session
- **#253** and **#274** are fixed — close them. **#265** (configurable invite-link surface) still open, background.
- The hint engine's layout-dependent paths (`_isFullyVisible`/`_regionTop`) are **verified manually, not in jsdom** (no layout engine) — the pure rotation algorithm is fully unit-tested. If you change header pinning, re-check on-device.

## 24. Session 2026-07-02 — Telegram adaptation (experimental, flagged)

Branch `claude/telegram-app-adaptation-t1r1jp` (from `dev`-equivalent `main` tip `184546c`), ~25 commits, built task-by-task against a reviewed spec + plan. **Point at the source docs instead of restating them:**

- **Spec:** `docs/superpowers/specs/2026-07-02-telegram-adaptation-design.md` (updated in place as semantics evolved — link/unlink expunge, env-var config, data model).
- **Plan (executed, all 14 tasks):** `docs/superpowers/plans/2026-07-02-telegram-adaptation.md`.
- **Operator runbooks:** `docs/telegram-setup.md` — Part A (dev preview channel + TEST bot, fully self-contained) and Part B (prod, fresh bot, rollback ladder). Hard-won prerequisites baked in: Node 20/22 LTS for firebase-tools (newer Nodes → "Premature close"/attest failures), verify CLI auth with `projects:list` not `login:list`.

Shape of the implementation (all server logic dependency-injected, tests network-free):

- `functions/telegram-auth.js` — initData HMAC verification (timing-safe, freshness-bounded both directions), deterministic derived uid `sha256("telegram:"+tgId)`, idempotent account bootstrap, `validateTelegram`/`linkTelegram`/`unlinkTelegram` callables. **Link and unlink both expunge the Telegram-derived account** (`expungeDerivedAccount`: mapping, reverse index, own subtree, cross-user residue — follower/following backrefs, canvases, group memberships, owned groups, invite tokens). Rationale: the derived uid is deterministic, so anything left behind resurrects as a shadow account (bit the user in testing — one-way "Following" doppelgänger).
- `functions/telegram.js` — bot router (commands + callback queries + notification keyboards), mirrors client RTDB write shapes exactly (knock cap-5 transaction, join defaults, follow-grant shape).
- `functions/notifier.js` `sendToUser()` — channel switch; route read from server-only `telegramByUid/{uid}` (client-tamper-safe), FCM fallback on any failure.
- `functions/index.js` — webhook endpoint (constant-time secret check, always-200), callable wiring, `tgApi` fetch helper. Config via `functions/.env` env vars (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_APP_URL`) — **inert when unset; never put secrets in the git-tracked `functions/.env.<projectId>`**.
- Client: `js/telegram.js` (context detection, initData boot auth, share sheet), `js/telegramSettings.js` (drawer: link with expunge warning, unlink, channel toggle), `js/cacheOwner.js` (**account-scoped localStorage wiped on uid change** — fixes cross-account cache bleed where `following.js`'s empty-server migration uploaded one account's contacts to another; latent in the web app too), boot gating in `js/app.js` (no install/push/SW affordances inside Telegram).
- Rules: `telegramUsers`/`telegramByUid` deny-all; `userPrefs/$uid/notifyChannel` validated `push|telegram`. Rules tests in `tests/rules/telegram.test.js`.

**Deferred minors** (triaged acceptable in the final review; batch-hardening already applied for webhook compare, callback arg guard, auth_date future bound, boot-failure alert): unbounded `claimShareCode` retry (pathological only), non-atomic link/unlink write sequences (self-healing states), unclamped bot reply labels, `about.template.html` inline theme reads bypass `cacheOwner` (cosmetic).

**Known product boundary:** an unlinked Telegram user always auto-creates a fresh derived account on next Mini App open (Telegram identity = an account, by design). No merge of a Telegram-only account's contacts/groups into a linked phrase account — linking expunges after an in-UI warning (user-approved decision; full merge specced as a possible future project).

## 25. Session 2026-07-05 — Telegram dev testing complete + merge prep + two fixes

Same branch (`claude/telegram-app-adaptation-t1r1jp`). Point at sources rather than restating:

- **A8 smoke test passed in full on-device** (dev preview channel + test bot): boot auth, phrase-account link with the doppelgänger expunge verified in the dev RTDB, unlink expunge, bot commands, knock → bot message → "Knock back" round-trip, `/notifications push|telegram` toggle.
- **Flag-flip decision (the final review's open Important finding) resolved: revert the ungated artifacts.** The three-file flag-flip commit (flag off + delete the telegram.org script tag + restore `firebase.json` headers) and its one-command `git revert` launch path are scripted in `docs/telegram-setup.md` § "Merge prep — the flag-flip commit"; Part B updated to assume it. Verified the web suite passes with the flag off.
- **Incident: a docs push to `dev` deleted the Telegram functions from the dev project.** Root cause: the dev CI workflow deploys `--only hosting,database,functions --force`, and `--force` deletes deployed functions missing from the pushed source; it also reverts database rules. Preview-channel hosting keeps serving, so the Mini App loads and dies at boot ("Couldn't start KnockKnock"). Documented in `docs/telegram-setup.md` Part A caveats + §2 above (whose old "CI deploys hosting,database only" claim was stale). Recovery: re-run runbook A5 from the branch. Diagnostic shortcut that found it: POST `{"data":{"initData":""}}` to the `validateTelegram` URL — `FAILED_PRECONDITION` = env vars missing, `UNAUTHENTICATED` = configured and healthy, 404 = function gone.
- **Fix: stale theme after unlink (account switch)** — commit `1de4b4e`. The inline theme-restore script paints the previous owner's theme vars before the bundle runs; the cache-owner wipe cleared storage but not the painted vars, and the own-status watcher skips its reset when the new account has no palette (`null === null`, `js/app.js` own-status watcher). `ensureCacheOwner` now returns whether it wiped; boot calls `resetThemeVars()` on a wipe. New `tests/app-boot-cacheOwner.test.js` (mirrors the app-call-recovery scaffold) pins the wiring. Verified on-device.
- Housekeeping: HANDOFF §23 collision from parallel sessions resolved (v1.3.0 keeps §23, Telegram is §24); branch carries post-v1.3.0 `dev` merges and stays conflict-free against `dev`.

**Next (user's roadmap): Telegram new-user onramp/onboarding + UX polish** — the bot's immediate full command list means nothing to a stranger, and a fresh Mini App user lands in an empty app with no guidance. Design work (brainstorm → spec) before code. Web suite 47 suites / 1265 tests; functions 6 / 149. **← This work is now DONE — see §26.**

## 26. Session 2026-07-05b — Telegram onboarding + UX polish (BUILT; awaiting on-device smoke test)

Branch `claude/telegram-onboarding-ux-sk15hw` (cut from adaptation tip `2abb56b`), tip `b2f53fc`, pushed, **not merged**. Full brainstorm → spec → plan → subagent-driven implementation. **Point at the source docs rather than restating:**

- **Spec:** `docs/superpowers/specs/2026-07-05-telegram-onboarding-ux-design.md` (9 sections + known gaps + graduation design).
- **Plan (executed, all 11 tasks):** `docs/superpowers/plans/2026-07-05-telegram-onboarding-ux.md`.
- **Runbook additions:** `docs/telegram-setup.md` — A6 (`TELEGRAM_APP_LINK` via `/newapp`), BotFather descriptions, **A9 on-device checklist** (the smoke test the next session acts on).

What shipped (12 commits `136c628..b2f53fc`; each task independently spec+quality reviewed, whole-branch opus review = ready-to-merge=Yes, no Critical/Important):

- **Deep-link invites + interstitial** — `js/inviteFlow.js` builds `t.me/<bot>/<app>?startapp=<token>` (one share seam; `inviteModal` routes through it). `js/telegramFirstRun.js` reads the token from signed `initData` `start_param`, shows a first-run interstitial (Accept / "I have a secret phrase" / Not now) to unlinked arrivals, and feeds accepted tokens into app.js's EXISTING `pendingInviteToken` redemption. Linked arrivals redeem silently + toast.
- **Bot `/start` funnel** — strangers (no mapping) get 3 lines + Open button, no command dump; returning users get compact live status. `/help` unchanged. (`functions/telegram.js`)
- **Guided empty state** — `js/firstRun.js` OWNS the empty-state DOM (web + TG); `following.js` only signals `setListEmpty()`. Add-person form demotes to "Add by code". Install toast defers while it's up.
- **Landing banners + unlink confirm** — `kk-landing` sessionStorage handoff survives the link/unlink reload (deliberately NOT in cacheOwner's wipe list); inline unlink confirmation replaces the instant-unlink.
- **Drawer regroup** — Invite / Account / Notifications sections with stable slots (`#tg-account-slot` reserved for the graduation button).
- **Telegram chrome** — `js/telegramChrome.js`: pure `resolveBackAction()` maps BackButton to the top overlay, `disableVerticalSwipes()`, closing-confirmation during calls (back hidden during calls), chrome color re-sync on `--bg` change (**memoized** — posts `set_header_color`/`set_background_color` only when `--bg` actually changes, so the observer's per-mutation fire no longer floods the webview bridge or the console).
- **Recovery-modal extraction** — `js/recoveryModal.js` with intro/warning/cancel knobs; web signup renders byte-identical. This + the drawer slot are the ENABLERS for the future "use the app outside Telegram" graduation flow (spec §7) — **the graduation callable and button were deliberately NOT built** this session.
- **Synthetic Auth email** — `tg-<uid>@telegram.invalid` at bootstrap so Telegram-derived accounts are distinguishable in the Firebase console (anonymous — no handle/tgId; non-fatal).

**Config the smoke test needs:** `TELEGRAM_APP_LINK` (root `.env.local`, client-build var, baked at build) must be set for deep-link invites — else shares fall back to plain web URLs (inert, non-breaking). Get it from BotFather `/newapp` on the EXISTING test bot (not a new bot); rebuild + redeploy the preview channel after setting it. A 640×360 placeholder Mini App photo was generated this session (scratchpad `tg-app-card.png`; regenerate if needed).

**Recorded known gaps (deferred by design, spec §9):** web/PWA sessions blind to the Telegram link (empty Notifications drawer section is its future home); graduation designed but unbuilt; **native macOS Telegram ignores Mini App chrome color** — at Bot API 9.6, `setHeaderColor`/`setBackgroundColor` recolor on `tdesktop` + iOS but are silently dropped by the native `macos` client (a client limitation, **not** a version gap and **not** app-fixable — same family as `prompt/confirm/alert` no-op'ing there; a platform/version probe confirmed it on-device and was removed in `b93bbf7`). **Minor cleanups the whole-branch review logged but didn't block:** all addressed in `b2f53fc` except the token-not-encodeURIComponent'd nit (won't-fix — tokens are URL-safe).

## 27. Session 2026-07-05c — first round of on-device smoke-test feedback (ONGOING)

Same branch `claude/telegram-onboarding-ux-sk15hw`, `b2f53fc..1f56037` (7 commits), pushed, **not merged**, working tree clean. Web **1311/1311**, functions **160/160**. **Smoke testing is NOT finished** — this is the first feedback pass; the maintainer keeps testing on-device and more rounds are expected. Each fix is TDD; the on-device-only surfaces were verified by the maintainer (jsdom has no layout engine / no Telegram webview).

Findings turned into fixes (each its own commit):
- **`cc5291b` drawer clipped** — the §4 regroup stacks Invite/Account/Notifications (+ expandable unlink-confirm) where the drawer held one code-row; `#code-drawer.open` `max-height` `12.5rem → 28rem` (`css/app.css`). Layout-only, on-device verified.
- **`f6de85e` empty-state invite pointed at web** — `js/app.js:732` opened the web modal on every surface. Added `mycode.js sharePersonalInvite()`: on Telegram share the `t.me` deep link straight to the share sheet (auto-create a personal invite labelled with the Telegram first name if none), web keeps the modal. New `telegram.js telegramFirstName()`. The **drawer** "Invite your people" still opens the modal (keeps TG link regenerate/revoke reachable) — deliberate.
- **`165560d` macOS share caption butted against the link** — `openTelegramShare` prepends a newline to the caption on non-iOS clients (iOS left as-is). Client-rendered, so best-effort; verify on-device.
- **`64e7a19` unlink confirm + toasts** — unlink now opens the shared `.confirm-overlay` modal (Unfollow/Remove-follower pattern), not the inline drawer block; **post-link/post-unlink landing banners removed** (unwanted inline-toast style) — neither flow stamps `kk-landing` now; the `showLandingNotice`/`stampLanding` mechanism + `graduated` copy are **retained only for the unbuilt graduation flow** (`.danger-btn` CSS dropped). `b5c8edb` flags this in spec §7 (**reuse an existing pattern for graduation, don't default to this one-off**).
- **`c33a6e2` "browser doesn't support web notifications" toast inside Telegram** — the per-person bell ran the web-push capability flow, which falls to `'unsupported'` in the TG webview. In Telegram the **bot** is the channel (`notifyChannel:'telegram'`), so `ensureNotificationsReady()` + the notify-promo now no-op when `isTelegramContext()` (`js/notifyPrompt.js`). Spec §9 gap, from inside Telegram.
- **`1f56037` one-time welcome DM** — an invited user can accept a `startapp` deep link and never open the bot chat → no persistent entry point until a notification. `validateTelegramHandler` now sends a one-time welcome DM (same `WELCOME_STRANGER_TEXT` + Open button as `/start`) when it **creates** the account (`created===true`); a `/start`-first user has `created===false` so gets no duplicate; non-fatal if it can't send. Shared copy/keyboard extracted to `functions/telegram-shared.js` (avoids the `telegram.js`↔`telegram-auth.js` cycle); reuses `TELEGRAM_APP_URL`. Spec §2 updated. **Verified on-device with a fresh Telegram account** (an already-seen account correctly does NOT re-fire — that's the anti-dup guard, not a bug).

**Established this round (write-access correction):** opening the bot's Mini App grants the bot PM write access — no `/start` or `requestWriteAccess()` needed for the server to DM the user (an earlier caveat to the contrary was wrong; the received notification + welcome DM both confirm it). If a *future* finding shows a cold deep-link arrival lacks write access at first open, the fix is a client-side `WebApp.requestWriteAccess()` on first run — **not built** (no evidence it's needed).

**Candidate follow-ups if feedback goes quiet:** the deferred §9 gaps (web/PWA blindness to the TG link; the graduation build — reconsider its success-feedback pattern per the §7 flag); the `encodeURIComponent` token nit (still won't-fix). The `icon-512` "blue dot" recolor the maintainer asked for was delivered **in-session only, NOT committed** — the repo icon is still green; wire it into `scripts/gen-icons.js` only if asked.

Web suite 53 suites / 1301 tests; functions 6 / 157.

## 28. Session 2026-07-06 — second round of on-device smoke-test feedback (ONGOING)

Same branch `claude/telegram-onboarding-ux-sk15hw`, `15dacf5..5a605fa` (9 commits), pushed, **not merged**, working tree clean. Web **1334/1334**, functions **160/160**. **Still not finished** — the maintainer keeps testing on-device; more rounds expected. Each fix is TDD; the Telegram-webview / cross-client surfaces were confirmed (or flagged for confirmation) on-device.

Findings → fixes (each its own commit):
- **`d17e34d` invite-accepters showed as a bare code** — a follow made via a personal invite is registered on the *redeemer's* device (no follow-request approval), so the inviter's followers list never learned the name. The redeemer now publishes their Telegram first name to a new `users/{inviter}/followerNames/{follower}` node (rules mirror `followers`; write is cosmetic/non-fatal, clamped to 40); the inviter's client (`following.js watchFollowerNames`) folds it into the device-local follower-name roster **fill-if-empty** so the existing "CODE (Name)" render lights up. `expungeDerivedAccount` clears the cross-user residue. Web-only redeemers pass no name → unchanged.
- **`3891958` welcome copy + empty-state spacing** — bot first-contact DM and the guided empty-state lede reworded to "…for when you're around and open to company." (bot keeps "Welcome to KnockKnock — ", empty state leads "KnockKnock — "); "No one's here yet." + the "Invite your people" CTA got vertical breathing room; the "Link your account" secondary drops onto its own line.
- **`ab4c616` interstitial tagline removed** — dropped the "KnockKnock shows your people…" `.hint` line from `#tg-invite-screen`.
- **`fee0284` + `4111a98` (SUPERSEDED by `7af3ec3`)** — first attempt at TG group invites: one-tap deep-link share on "Invite to group", skip the create-time modal in TG, a picker-only secondary. The maintainer then asked to **unify** instead, so these were reverted.
- **`6dd3f9d` deleted group lingered in a member's nav (as its raw id)** — real root cause: `watchGroupMeta` reads the membership-gated whole `groups/{gid}` node; owner deletion makes the read rule false against the now-null node, so Firebase **cancels the listener with PERMISSION_DENIED** (the `onValue` *cancel* callback) rather than delivering null. The pre-built deletion self-clean (`removeUserGroupsEntry` in groupNav + groupContext, both keyed on a null meta tick) never fired. Fix: `watchGroupMeta` now passes a cancel handler → `callback(null)`, lighting up that machinery (also covers member-removal). **General bug** (web too); surfaced in TG testing.
- **`7af3ec3` unify the group invite flow** — both group-creation and "Invite to group" now open **one** modal in both contexts; inside, group scope branches: **Telegram** → a "Share on Telegram" button (mints the invite on demand → `t.me` deep link) with the web-URL create/manage UI hidden; **web** → the existing create/regen/copy/revoke UI; **both** show the "invite specific people" picker below. The modal now un-hides **synchronously** and populates the picker afterwards — the fix for the create→group transition jank (it used to pop in late after `readPendingInviteesForGroup`).
- **`ca8560b` group rename / edit-my-name / delete / leave were dead in Telegram macOS Desktop** — they used `window.prompt`/`window.confirm`, which that webview no-ops. New **`js/promptModal.js`**: promise-based `showTextPrompt` (trimmed non-empty string or null) + `showConfirmModal` (boolean), reusing the invite-modal input styling and the `.confirm-overlay` styling (no new CSS). `window.alert` catch-paths → `showToast`.
- **`5a605fa` remaining `window.alert` → `showToast`** — `app.js` Telegram boot-fail + `inbox.js` approve/join failures (same Mac-Desktop no-op). The app is now free of `window.prompt/confirm/alert` in `js/`.

**Deferred by the maintainer this round:**
- **#1 (won't-fix for now):** the group-deletion **toast** that the remaining member sees on return shows the 8-char group *code* instead of the group name.
- Personal invites in Telegram still use the one-tap `sharePersonalInvite` (no modal, no picker) — left as-is; unify into a modal only if asked.

Web suite 54 suites / 1334 tests; functions 6 / 160.

## 29. Session 2026-07-06b — third smoke-test round + the notification-channel pill (ONGOING)

Same branch `claude/telegram-onboarding-ux-sk15hw`, `e8ff78e..4381100` (10 commits), pushed, **not merged**, working tree clean. Web **1355/1355**, functions **160/160**. Each fix TDD; the Telegram-webview / cross-client surfaces were confirmed (or flagged) on-device. **Testing NOT finished.**

Findings → fixes:
- **`e83c15e` TG chrome color memoized** — `syncChromeColor` (now exported) posts `set_header_color`/`set_background_color` only when `--bg` actually changes; the mutation observer fired it per-mutation, flooding the webview bridge + DevTools console with redundant postEvents. Memo resets on `initTelegramChrome`. (Body §"Key JS modules" → Telegram chrome updated.)
- **macOS chrome-color question CLOSED** — `fe92545` added a temporary platform/version probe (toast, since native macOS Telegram has no console), `b93bbf7` removed it, `492ec2f` recorded the finding: native `macos` Telegram ignores `setHeaderColor`/`setBackgroundColor` **even at Bot API 9.6** (recolors on `tdesktop` + iOS). A **client limitation** — not a version gap, not app-fixable (same family as `prompt/confirm/alert` no-op'ing there). See body §"known gaps (spec §9)".
- **`1794e13` guided-empty-state declutter** — first-run now suppresses the install **corner icon** as well as the toast (alone it's a no-op tease: its toast can't open while first-run holds). The drawer's "Invite your people" button is hidden on every surface (dup of the on-screen CTA); the Telegram account section is hidden (unlinked). Restored when the list is non-empty.
- **`2ca9c3d` invite section stripped in guided-empty** — with only the share code left, the drawer's "Invite" label is hidden and the hint drops its "Or …" framing ("Share this code…"); both restored when non-empty. New ids `#drawer-invite-label`, `#drawer-invite-hint`.
- **`909c541` TG drawer refinements** — (a) drawer "Invite your people" now one-tap `sharePersonalInvite()` in TG (was opening the web modal); (b) a **linked** account keeps its account/unlink section visible even in guided-empty (hide is now `empty && !linked`); (c) more `margin-bottom` under the "Link your account" line.
- **`9fd56d1` → `f626903` → `4381100` notification-channel pill** (`js/notifyChannel.js`, shared TG + web) — replaces the single "Notifications: Telegram" chip with a two-segment toggle pill `[ Telegram | Push ]`, left-aligned, shown **only for a linked account** on both surfaces. `syncNotifyChannel(userId, prefs)` is called from the shared `watchUserPrefs` tick, so it reconciles **live**: link/unlink shows/hides the section and cross-device channel switches flip the active segment **without reload**. Clicks are optimistic then persist via `mergeUserPrefs` (revert on write failure); the pill mounts once, idempotent across ticks. **"Linked" is decided per surface** — `telegramLinkState().linked` on TG, `userPrefs.telegram != null` on web — because a Telegram-**derived** account also carries `userPrefs.telegram` (stamped at creation for bot routing, `functions/telegram-auth.js:74`), so the marker alone can't distinguish derived from linked; `4381100` fixed derived accounts (incl. the fresh account after an unlink) wrongly showing the pill. `telegramSettings.js` delegates to the section (its old `wireChannelToggle` chip is gone); the pill CSS (`.toggle-pill`) is on `--accent`, active segment filled.

**Confirmed on-device:** notification channel routes correctly (Telegram vs Push). **To verify after deploy:** the pill look vs. the screenshot; web-linked section appearing without reload; fresh/derived TG account shows no pill; unlink → pill gone; linked → live channel sync both ways.

**Open finding (fix next session): arrival interstitial shows the wrong inviter name.** A **linked** Telegram account's personal invite, accepted by another user, renders the inviter as a stale/other name on `#tg-invite-screen` — observed **"Pwa"** instead of the Telegram first name **"Tenorune"** (possibly a follower-assigned name, or an old default). The interstitial prints `preview.label` = the invite's `creatorLabel` (`js/telegramFirstRun.js:20` → `resolveInvitePreview` → `js/invites.js:222`). `createPersonalInvite` stamps `creatorLabel` once at creation (`invites.js:62`); `sharePersonalInvite` (`js/mycode.js`) **reuses the existing active invite** from `watchUserInvites` and only sets the label (to `telegramFirstName()`) when it **auto-creates** one — so a label from an earlier creation sticks and is never refreshed. Next session: confirm where "Pwa" came from, then decide whether the share should refresh the invite label to the current `telegramFirstName()` / account name (vs. reusing a stale `creatorLabel`), or whether linked accounts need a different name source. Repro: a linked TG account inviting a fresh user, then read the accepter's interstitial.

**Deferred / accepted this round:**
- **"Show secret phrase" for linked accounts: NOT shown (accepted).** A linked Telegram account has no phrase available client-side (Telegram boot returns `recoveryCode: null`; the phrase typed at link time is dropped on the post-link reload). Showing it would mean storing the phrase in the shared webview localStorage — which, because `cacheOwner` keeps `statusapp_identity` across account switches, would leak the previous account's phrase into the next derived account after unlink. Left hidden by design.

## 30. Session 2026-07-06c — Graduation flow + follow-on UX + web "Share to Telegram" (BUILT; on-device VERIFIED in §31)

Same branch `claude/telegram-onboarding-ux-sk15hw`, `6e61d7c..0bc88a8` (8 commits), pushed, **not merged**, working tree clean. Web **1380/1380**, functions **171/171**. Each change TDD; the Telegram-webview / real-browser surfaces are **not yet verified** (jest only) — that's the top of the next session.

**Graduation flow (spec §7) — "use the app outside Telegram."** Gives an unlinked Telegram-derived account a secret phrase, migrating it to the phrase-derived uid so it becomes a first-class phrase account (a rename, not a merge — the "no merge" boundary stays uncrossed).
- **Server** (`functions/telegram-auth.js`, `index.js`): `graduateTelegramHandler({ initData, code })` — verify initData, rate-limit on the **candidate (phrase) uid**, require an **unlinked** mapping (`prior.uid === deriveTelegramUid(tgId)`), require the target uid **free** (`already-exists` on collision). Order is load-bearing: `graduateAccountData` copies the own subtree + rewrites every backref/index/canvas/group/mailbox old→new, THEN the handler repoints `telegramUsers`/`telegramByUid`, THEN drops the old subtree (old stays authoritative until the mapping flips). `graduateAccountData` is a standalone move walker (NOT a refactor of `expungeDerivedAccount` — the flat test-mock can't do whole-subtree reads, and touching expunge risks the pinned link/unlink tests). New callable wired with the same deps as link/unlink.
- **Client**: `callGraduateTelegram` (`firebase-config.js`); new `js/graduation.js` owns the flow — a `.help-badge` "?" opens a two-button info toast ("With an account you can use KnockKnock outside of Telegram." / Close / I want an account); "I want an account" → recovery modal with graduation knobs → `graduateTelegram` → `stampLanding('graduated')` + reload. The "?" sits beside "Link your account" in the guided empty state (via an injected `onGraduateInfo` callback so `firstRun` doesn't import `graduation` — cycle-safe) AND beside "I have a secret phrase" in the drawer Account section (`telegramSettings.js`). The old full-text graduation button is gone.
- **Success feedback (spec §7 flag resolved):** reuse the shared `showToast`. `firstRun.consumeLandingNotice()` read-and-clears the `kk-landing` marker and returns the copy; boot (`app.js`) routes it through `showToast`. The bespoke `showLandingNotice`/`landing-notice` banner + CSS were deleted.
- **Recovery modal**: gained an inline `#recovery-modal-error` surface shown only when a thrown error carries `userMessage` (web signup renders byte-identical); the graduation error is a single generic "Couldn't set that up right now. Try again." for every code (collision-specific copy dropped — uid collisions are effectively impossible). Cancel moved beside "I've saved it" in a `.recovery-modal-actions` flex row (full-width primary preserved when Cancel is hidden).

**Follow-on UX (maintainer feedback, same session):**
- **Header chip relabel** — `#mycode-chip` reads "Bits n bobs" outside the guided-empty state and "Share code" only when the drawer is stripped to just the code. Keyed `empty && !tgLinked` (a linked account keeps its account/unlink + notification sections even when empty, so it's never code-only). In `setListEmpty` (`firstRun.js`).
- **Toast width** — the shared `.group-removal-toast` had no explicit width and shrink-wrapped narrow (text wrapped to 4 lines); now `width: 80%; max-width: 480px` with the dismiss button pushed to the trailing edge.
- **"?" placement** — the empty-state "?" wrapped below the link button (`#first-run-link-btn` was `display:block`); wrapped button + badge in a centered `.first-run-link-row` flex.

**Web "Share to Telegram" (spec §4 "designed-for" → BUILT):** the invite-modal manage-state share button (`#invite-modal-share-btn`) un-gates from Telegram-only to `isTelegramContext() || telegramSharingEnabled()`. New in `inviteFlow.js`: `telegramSharingEnabled()` (`TELEGRAM_ENABLED && TELEGRAM_APP_LINK`), `buildTelegramShareUrl(url, text)`, `shareInviteToTelegramWeb(invite, text)` (opens `t.me/share/url?url=<deep link>` in a new tab; returns false when unconfigured or the popup is blocked). On web the button is labeled "Share to Telegram", sits on its own row **below** Copy (`.invite-share-btn`), and its caption is prepended with `\n` so desktop Telegram blank-lines the link and message (mirrors `openTelegramShare`'s non-iOS branch); a blocked popup falls back to copying the deep link with brief button feedback. Applies to personal + group. Gated so a pre-launch `main` (`TELEGRAM_ENABLED=false`) never renders it. Spec §4 note updated from "Designed-for, not built" to "Built".

**Still open / deferred (as of this session — both resolved in §31):**
- **§29 stale inviter name** — FIXED in 07-06d (§31), option A.
- **On-device verification** of everything above — DONE in 07-06d (§31).

## 31. Session 2026-07-06d — §29 stale-inviter-label fix + on-device verification of the 07-06c build

Same branch `claude/telegram-onboarding-ux-sk15hw`, `a712618..74d73f4` (1 commit `9ff220d`), pushed, **not merged**, working tree clean. Web **1385/1385** (was 1380; +5 tests), functions **171/171** (untouched — the fix is client-only). TDD.

**§29 arrival-interstitial stale inviter name — FIXED (maintainer chose option A, "refresh for all accounts").** The arrival interstitial names the inviter by reading `creatorLabel` from RTDB (`resolveInviteCreatorLabel`). `sharePersonalInvite` (`js/mycode.js`) reused an active invite's stored `creatorLabel` and only set it (to `telegramFirstName()`) on the auto-create branch, so a label captured at create time went stale when the TG first name changed ("Pwa" stuck instead of "Tenorune").
- `js/db/social.js` — `setInviteLabel(userId, token, creatorLabel)`: a partial `update()` of just `creatorLabel` (mirrors `setInviteRevoked`; surfaced via the `export *` db.js barrel). Token/URL unchanged, so already-shared links keep working.
- `js/invites.js` — `updateInviteLabel(userId, token, labelRaw)`: `validateLabel` (trim / non-empty / ≤40) then `setInviteLabel`.
- `js/mycode.js` — when reusing an active invite, `sharePersonalInvite` now rewrites the label to the current `telegramFirstName()` if it differs, updates the in-memory invite + `_currentActiveInvite`, then shares. **Skips** the write when the name is unchanged; keeps the existing label (**no clobber**) when TG exposes no name (rather than overwrite with the `'Someone'` fallback).
- Tests: +2 `tests/invites.test.js` (write + validation), +3 `tests/mycode.test.js` (refresh stale, no-op on match, no-clobber on empty name); the existing "reuse, no create" test tightened to also assert no rewrite.
- **Considered but not chosen:** option B (refresh only for unlinked/Telegram-derived accounts, to avoid overwriting a web-customized label on a linked account). Maintainer chose A for the single code path; the clobber edge is marginal on this tiny-sandbox audience.

**On-device verification of the 07-06c build — DONE.** Walked in the real Telegram webview / browser: the graduation round-trip (info-toast → recovery modal → migrate → reload lands as a "linked" account); the "?" affordance on both surfaces (guided empty state + drawer Account section); the boot confirmation toast (`showToast("This account now works in any browser too.")`, stamped by `graduation.js`'s `stampLanding('graduated')`, read at boot by `app.js`'s `consumeLandingNotice()`); the "Bits n bobs" chip label; the web "Share to Telegram" placement (below Copy); and the newly-refreshed inviter name on the arrival interstitial. All confirmed by the maintainer.

**New known gap documented (not fixed).** Traced a scenario: a **web** invite URL (`?i=TOKEN`) pasted into a Telegram chat and opened by someone who already has a Telegram account opens in Telegram's in-app *browser* (not the Mini App) → `isTelegramContext()` false → they can't reach their Mini-App-only account, so boot mints a **duplicate web account** and the invite redeems onto the wrong (nameless) identity. The fix direction (option A1 — an "Open in Telegram" CTA that reopens via the `startapp` deep link, `buildTelegramInviteLink(token)`, so the Mini App redeems onto the real account) is recorded in the onboarding spec **§9 "Known gaps"**. Maintainer's call this session: **document for now, don't build.** No code change.

## 32. Session 2026-07-07 — bot-invite gap doc + spec reconciliation (docs only)

Same branch, `74d73f4..7a36ca0` (4 docs-only commits), pushed, **not merged**, working tree clean. Web **1385/1385**, functions **171/171** — no code touched.

- **Documented the web-invite-in-Telegram-in-app-browser gap** (traced with a subagent; see §31's "New known gap" note + onboarding spec **§9**, fix direction option A1).
- **Analyzed both Telegram specs for drift vs. shipped code and reconciled them** (frozen the as-designed sections; recorded deltas):
  - `2026-07-05-telegram-onboarding-ux-design.md` → new **"As-built deltas"** section. Eight items, two of which were internal contradictions: graduation is built (§7 said "next session"); post-link/unlink landing banners removed and `kk-landing` is `{graduated}`-only via the shared toast (resolves §5⇄§7); the account walker shipped as two standalone functions (`expungeDerivedAccount` + `graduateAccountData`), not a refactor; graduation collision handling is one generic error; `__TELEGRAM_APP_LINK__` shipped as an esbuild `define(process.env.TELEGRAM_APP_LINK)`; `shareInvite`→`shareInviteLink`(+`shareInviteToTelegramWeb`); mid-file line refs drifted. Verified-still-accurate: §8 synthetic Auth email, §4 web share, §9 gaps.
  - `2026-07-02-telegram-adaptation-design.md` → header supersession pointer. Verified it shipped almost exactly as written; only drift is `isTelegram()`→`isTelegramContext()` and parts (notably §2 `/start`) reshaped by the onboarding spec.
- **Next session's target queued** in the top-block "Next likely action": group-context support for the bot (5 gaps). *(Done in 07-07b — see §33.)*

## 33. Session 2026-07-07b — Telegram bot group-context support (built + verified)

Branch **`claude/telegram-group-context-jkiwxq`**, cut from `85708a7` (the converged tip of `…-sk15hw` / `…-t1r1jp`); 10 commits `50dfb01..a5df4ad`, pushed, **not merged**. Web **1385/1385**, functions **197/197** (+26). All code in `functions/telegram.js` + `functions/test/telegram.test.js`; spec + plan under `docs/superpowers/`. Built via subagent-driven TDD (per-task reviews + final whole-branch review). **On-device verified by the operator (2026-07-07).**

- **Design decisions** (spec `2026-07-07-telegram-group-context-design.md`): group named by **case-insensitive name-substring** over the user's own groups (0 → `No group matching "…"`; 2+ → list + "give me more letters"); `/status`/`/off` group forms **never flip `enabled`** — override ON merges `{status, availableUntil}` only (statusColor/paletteKey preserved), override OFF writes **nothing** (guidance reply, two variants by global state); `/status` grammar: pure-duration args stay global (`/status 1h 30m` regression-pinned), else trailing duration token splits off the group name.
- **The five gaps, as shipped:** (1) `knock:uid:gid` buttons + callback → `writeKnock(deps, r, s, gid)` mirroring the client transaction (set on create / overwrite on increment / else carry); (2) `/knock` roster fallback — Direct match always wins; roster match knocks with `contextGroupId`, `Name (Group)` keyboard on ambiguity; (3) `/who <group>` via `effectiveAvailable` (an enabled-unavailable override masks global availability); (4) `/status <group> [dur]` — fan-out rides the existing `onMemberOverride` trigger (Admin-SDK writes fire RTDB triggers; `before != null` guaranteed since the bot only writes when an override exists with `enabled === true`); (5) `/off <group>` symmetric.
- **Security fix from the final review** (`e1523c7`): `callback_query.data` is attacker-controllable and bot writes bypass DB rules, so the knock callback validates the gid segment against `/^[A-Z0-9]{8}$/` (the rules' format for client knock writes) before it reaches `writeKnock`; malformed gids are dropped (knock still lands, Direct-shaped). Test-pinned.
- **Known minor non-blockers** (triaged in the final review): sequential per-group reads in `matchGroupsByName`/`knockGroupReach`/`handleWhoGroup` (N+1, fine at 50–100 users); a person sharing two groups yields a two-button "Which one?" instead of a direct knock; recipient-uid callback segment (`arg`) is unvalidated — pre-existing on the base, a follow-up 32-hex guard would close it.
- **Deploy reminder:** these functions are branch-only — the standing A5 landmine applies (any `dev` push wipes them; redeploy per `docs/telegram-setup.md`).
