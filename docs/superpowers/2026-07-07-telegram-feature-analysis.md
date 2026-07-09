# Telegram feature analysis — gaps, opportunities & code efficiency (2026-07-07)

**What this is.** A post-completion analysis of the whole Telegram adaptation + onboarding feature
(branch `claude/telegram-app-adaptation-t1r1jp`, diff base `2dc5b8c` on `dev`: 137 commits,
~4,000 non-test source lines across 38 source files). Two workstreams, run as five parallel
analysis agents:

- **Workstream 1 — UX:** (1) end-to-end user journeys, (2) UI/interaction consistency across the
  web and Telegram surfaces, (3) the bot conversation.
- **Workstream 2 — code:** (4) client `js/` inefficiencies and redundancies, (5) Cloud Functions
  inefficiencies and redundancies.

**Status of the findings.** Everything below is OBSERVED-IN-CODE by the reporting agent unless
marked INFERRED. Three of the most consequential claims were independently re-verified in source
by the coordinating session (marked ✓RV): the channel-pill push-switch hole, the knock-cap
"Knock sent." confirmation, and the `setListEmpty` churn. Nothing here has had an on-device
pass; none of it is "verified" in this project's sense. Already-tracked issue **#283** (web
`?i=` invite in Telegram's in-app browser) was excluded by instruction from all agents.

**How to read this.** §1 is the synthesis — deduplicated, ranked, grouped into four candidate
fix waves. §2–§6 are the five agent reports in full, unabridged (one mojibake glitch and HTML
entities cleaned; content untouched). Cross-references: `J#n` = journeys (§2), `C#n` =
consistency (§3), `B#n` = bot (§4), `CL#n` = client code (§5), `F#n` = functions code (§6).

---

## Status accounting (added 2026-07-09)

Every finding below now carries a **Status** line recording what waves **W1–W4** (all merged into `t1r1jp`) actually did with it. Sources: the wave-execution records in `docs/HANDOFF.md` — §37 (W1), §38 + §40 (W2 + loose ends), §42–§43 (W3), §45 (W4). Every "not implemented" call was re-verified against current source on 2026-07-09.

**Rollup (71 findings):**
- **Shipped — 57:** J#1–J#7, J#15 (W1 + W4) · C#1, C#2, C#4–C#7, C#9–C#14 (W1 + W4) · B#1, B#2, B#8–B#14 (W1 + W4) · CL#1–CL#13 (W3) · F#1–F#15 (W2; F#5 landed in the §40 loose-ends pass).
- **Cut by decision — 1:** B#7 (deep-link "Open in KnockKnock" keyboard row, operator's call, §44).
- **Not implemented — 13** (no wave assigned; verified still-absent 2026-07-09): J#8, J#9, J#10, J#11, J#12, J#13, J#14, C#3 (partial), C#8, B#3, B#4, B#5, B#6.

**The shape of what's left.** The four waves covered §1.1 (HIGH tier), §1.6 (functions), §1.7 (client) and §1.4 + §1.5 (copy/CSS + bot delight) in full. What was **never scheduled into a wave** is the **§1.2/§1.3 consent-&-parity remainder** — the `/start`-first newcomer parity (J#8), invite management from Telegram (J#9), fire-and-forget invite CTAs (J#10, C#3), graduation re-view/discoverability/copy (J#11, J#12), link/unlink + web-pill feedback (J#13, J#14), the Mini-App name prefill (C#8), and the four bot conversation dead-ends (B#3–B#6). (J#4/5/6 from §1.2 rode W1.)

---

## §1. Synthesis

### 1.1 The HIGH tier — user-facing dead ends and broken trust

> **Status — 2026-07-09:** ✅ **All 7 shipped in W1** and on-device verified (item 1 = J#3, 2 = J#1, 3 = J#2, 4 = B#1/B#9, 5 = B#2, 6 = C#1, 7 = J#7/C#2).

1. **Switching the channel pill to "Push" inside Telegram can silence ALL notifications with no
   warning** (J#3, ✓RV). `js/notifyChannel.js:62-68` — its own comment says the permission flow
   is "inert in Telegram context". The pref is written, but `sendToUser` returns false when the
   account has zero push tokens (`functions/notifier.js:27-42`); the bot's channel command shares
   the hole (`functions/telegram.js:167-175`). A curious tap in the Mini App = no knocks, no
   calls, no cue on any surface. Fix direction: warn/refuse when no push tokens exist, or fall
   back to Telegram on token-less sends.
2. **A valid deep-link invite can silently evaporate** (J#1). `resolveInvitePreview` swallows
   network errors into `null` and the gate treats `null` as "no invite"
   (`js/telegramFirstRun.js:61-62`, `js/invites.js:232-239`) — a transient blip drops a valid
   invite with zero acknowledgment. Web shows an explicit failure overlay for the same cases.
3. **Telegram boot failure is a blank-screen dead end** (J#2). `ensureTelegramIdentity` failure
   → one toast → `main()` dies with the UI hidden and no retry affordance (`js/app.js:109-121`).
4. **Bot inline keyboards never update after a tap — and later taps lie** (B#1 + B#9). No
   `editMessageText` exists anywhere (`functions/index.js:246-249`); Accept/Decline stay live
   forever, so Decline tapped after Accept answers "Declined." while the user remains a member
   (`functions/telegram.js:400-453`). Same for follow requests. Editing the message post-action
   ("✅ Joined Divers") fixes the stale buttons, the lie, and the vanishing-toast-only record in
   one move.
5. **"Knock sent." even when the 5-cap silently dropped the knock** (B#2, ✓RV). `writeKnock`
   ignores the transaction's committed state (`functions/telegram.js:196`); the callback answers
   "Knock sent." unconditionally (`:387`), commands likewise (`:324,353`).
6. **The Telegram back button ignores every confirm/prompt overlay this branch added** (C#1).
   `resolveBackAction` (`js/telegramChrome.js:23-41`) has no entry for `#confirm-modal`,
   `#text-prompt-modal`, the unlink confirm, or the graduation toast — worst case, back with
   "Delete 'X'?" open navigates the surface underneath while the destructive sheet stays up.
7. **Unlink is the only destructive action that fails silently** (J#7 = C#2).
   `catch { btn.disabled = false; }` — no message, sheet stays open
   (`js/telegramSettings.js:67-76`) — while link, graduation, and inbox actions all surface
   errors.

### 1.2 Consent & state surprises (MEDIUM)

> **Status — 2026-07-09:** ◑ **Mostly shipped.** J#4, J#5, J#6 (= C#6) rode **W1**. ❌ **B#6** — the silent 2h-availability broadcast on a bot group-join — was never scheduled and is still open.

- **"Not now" isn't remembered** (J#5): decline an invite, later link an account, and the
  still-present `start_param` silently redeems the invite the user declined.
- **Re-tapping the original invite link re-shows the interstitial forever** (J#4), even after
  acceptance — the spec's own table says re-taps should show nothing.
- **Interstitial "I have a secret phrase" → Cancel drops the invite** (J#6 = C#6):
  `showLinkScreen()` isn't awaited; boot proceeds without the token. Web onboarding deliberately
  loops on cancel (`js/app.js:199-215`); the interstitial should too.
- **Accepting a group invite via the bot silently broadcasts 2h of availability** (B#6) — and
  silently sets a display name — with only "Joined X." as feedback.

### 1.3 Parity gaps between surfaces and paths (MEDIUM)

> **Status — 2026-07-09:** ❌ **Largely not implemented** — this cluster was never assigned to a wave. Open: J#8, J#9, J#10 (C#3 partial), C#8, B#3, B#4, B#5, J#11, J#12, J#13, J#14. (The C#12 "?" hit-area and the CL#9 name-cap landed in W4/W3, but the parity substance here did not.)

- **/start-first newcomers miss every new-user nicety** (J#8): `/start` bootstraps presence
  server-side, so the later Mini App open sees `created=false` — no first-use pulse, no auto 2h
  availability (the thing that makes a newcomer visible to their inviter), plain "Accept" label.
- **No way to revoke/regenerate any invite from Telegram** (J#9): both invite buttons go straight
  to the share sheet; the manage UI never opens there; a code comment claiming otherwise is stale.
- **"Invite your people" is fire-and-forget** (J#10 + C#3): no busy state, no error toast on
  failure, and an unguarded double-tap can mint two invites.
- **Group display name on join** (C#8): the bot silently applies the Telegram first name; the
  Mini App deep link prompts with an empty field. Prefill `telegramFirstName()` so both agree.
- **Bot conversation dead-ends** (B#3, B#4, B#5): the group-disambiguation prompt asks a question
  free text can't answer (a typed reply hits the unknown-command help dump); duration typos
  (`/status 2 hours`) are misread as group names with no format hint; bare `/who` for a
  zero-follow newcomer says "No one is available right now." instead of "you don't follow anyone
  yet".
- **Graduation** (J#11, J#12): the phrase is a one-shot reveal — "I've saved it" is unverified
  and nothing can ever re-show it in TG; entry is a mystery-meat "?" (~18px touch target, C#12)
  whose copy implies the user has no account yet.
- **Feedback asymmetry** (J#13, J#14): link/unlink end in a bare reload with no confirmation
  while graduation gets a boot toast; the web channel pill has no hint line explaining that
  "Telegram" means the install/push nudges vanished on purpose.

### 1.4 Copy & visual drift (mostly LOW; cheap to sweep)

> **Status — 2026-07-09:** ✅ **All shipped in W4.** Spec 1: C#4/C#9/C#13/C#14 copy sweep, C#10/C#11 CSS bugs (+ C#12 hit-area). C#5 resolved by reframing (behavior change, no label edit); C#7 landed with the Spec 2 bot batch.

- Same action, three labels: "Link your account" / "I have a secret phrase" / "Link account"
  (C#4).
- Share buttons: "Share" / "Share on Telegram" / "Share to Telegram" (C#5).
- Group invite: "Join" (web inbox) vs "Accept" (bot) (C#7).
- Error strings mix "Could not/Couldn't", "Try again./Please try again.", one curly apostrophe
  (C#9).
- Group names quoted on web, bare on Telegram; the Leave confirm passes no explanatory message
  while Delete does (C#13).
- The drawer chip boots as "Share code" then flips to "Levers & knobs" — template default
  disagrees with runtime (C#14).
- Two real visual bugs in the pile: `.drawer-section` references CSS tokens (`--border`,
  `--text-dim`) that don't exist, so it never rethemes (C#10, `css/app.css:320-321`); and the
  graduation info toast is a two-choice dialog wearing a snackbar skin — no backdrop, no Escape,
  no back coverage (C#11).

### 1.5 Delight quick wins (LOW severity, high smile-per-line)

> **Status — 2026-07-09:** ✅ Shipped in **W4** (Spec 2): B#8, B#10, B#11, B#12, B#13, B#14, J#15. ✂️ **B#7 cut** by operator decision (§44).

- "Open in KnockKnock" `web_app` button on invite/follow-request bot messages — the keyboard
  helper already exists in `telegram-shared.js` (B#7).
- Reply to stickers/photos/contacts instead of total silence (B#8).
- Register `setMyCommands` from the same source of truth as `HELP_TEXT` — the BotFather paste in
  the runbook has already drifted (B#11).
- `/who` showing time remaining ("🟢 Ana — 1.5h left"); `/groups` adopting the same status glyph
  (B#14).
- A one-time "You're following Ana — tap her card to knock" beat after the newcomer's first
  accept (J#15).
- Truncation hints on the 8-item inline-keyboard caps (B#13).
- "This button has expired — try /help." instead of the bare "Unknown action." where users can
  legitimately reach it (B#12); prefix raw share codes in actor names ("Your contact K7Q2ZP
  knocked", B#10).
- Already-shipped delight worth protecting (B, positive notes): the `/start` status echo, the
  override-off explanations on `/status`/`/off`, and the three-line stranger funnel.

### 1.6 Code — Cloud Functions (the big wins)

> **Status — 2026-07-09:** ✅ **All shipped in W2** (F#1–F#15; F#5 in the §40 loose-ends pass, callbacks keep `tgApi`). §40 also closed the flagged robustness gaps — graduation split-brain, the `rootUpdate` overlap guard, and mock fidelity.

- **Account-lifecycle functions are chains of sequential RTDB round-trips that collapse to
  `Promise.all` reads + ONE multi-path `update()`** — and the rewrite buys atomicity for free
  (no half-expunged / half-graduated crash states): `expungeDerivedAccount` ~35 → 3 round-trips
  (F#1); the graduation walker ~60 → ~3 (F#2); `linkTelegramHandler` / `graduateTelegramHandler`
  / `ensureTelegramUser` each 3–5 sequential writes → 1 (F#6); the invite-accept callback's 3
  writes → 1 (F#14).
- **N+1 awaited loops on the five hottest webhook commands** (F#3): `matchGroupsByName`, `/who`,
  `/who <group>`, `/groups`, `knockGroupReach`. `/who` over 10 friends: ~12 sequential
  round-trips → 3.
- **`/start` reads the same two paths twice** and writes the chat route as two sequential
  updates — 6 round-trips → 3 (F#4).
- **The whole webhook turn (DB + the outbound Telegram HTTPS call) is awaited before the 200**
  (F#5): Telegram's webhook-reply (respond to the request with the method JSON) removes the
  slowest await per update; at minimum answer callback queries before the DB writes.
- **Dedup:** `handleGroupStatus`/`handleGroupOff` ~80% copy-paste (F#7); the RTDB adapter
  boilerplate defined three times in `index.js` (F#8); "resolve telegram sender → uid" written
  four ways (F#13); the globally-available predicate inlined four times — belongs in
  `presence-core.js` next to `effectiveAvailable` (F#10); `LABEL_MAX`/clamp re-implemented
  against `presence-core.js` (F#11); UID/GID regexes duplicated inside functions/ (F#15); a
  provably dead `default:` branch in `handleCallback` (F#12); folding `pushTokens` into the
  notifier's existing `Promise.all` saves a round-trip on every FCM send (F#9).

### 1.7 Code — client

> **Status — 2026-07-09:** ✅ **All shipped in W3** (W3-A: CL#1–CL#5; W3-B: CL#6–CL#13). CL#7's larger restore-screen factoring was rejected by decision (busy pair only); CL#10 has two documented exclusions.

- **`setListEmpty` does its full ~10-op DOM sync + dispatches `first-run-change` (which re-runs
  the whole install-affordance recompute) on every render tick with no change guard** (CL#1,
  ✓RV: `js/firstRun.js:32-80` stores `_active` but never compares) — and it fires on every
  presence flip, watcher tick, and a 60s interval, forever. One-line early-return fix.
- **`telegram-web-app.js` is a parser-blocking third-party `<head>` script** (CL#2): every
  plain-web first paint waits on telegram.org (`index.template.html:19`). `defer` on it + the
  bundle preserves execution order; needs one on-device webview timing check.
- **Consolidations:** the "is this session linked" predicate spelled out in five modules → one
  `isTelegramLinked()` in `js/telegram.js` (CL#3); the unlink confirm hand-builds a modal the
  same branch already abstracted as `showConfirmModal` — ~35 lines + a permanent document
  keydown listener (CL#4); the t.me share-URL + caption-spacing rule duplicated with subtly
  different conditions (CL#5); the promptModal promise/teardown harness duplicated within its
  own file (CL#6); `setButtonBusy` extracted to utils this branch yet hand-rolled again in
  `telegramSettings` (CL#7); the invite-CTA surface fork duplicated as policy in two modules
  (CL#8); the 40-char name cap re-derived at three sites, once untrimmed (CL#9);
  copy-with-"Copied!" idiom at five sites (CL#10); recoveryModal teardown duplicated across exit
  paths (CL#11); share captions spelled at four sites (CL#12); landing-notice machinery retains
  dead generality (CL#13).
- **Came back clean** (worth knowing): the three-reader notify-channel contract has no fourth
  re-derivation; no listener leaks — every new modal/flow removes listeners on all exit paths;
  no dead landing-notice DOM; confirm-sheet button order consistent; bot notification text reuses
  the exact web-push titles; `watchUserPrefs` attached once with proper change detection;
  `telegramChrome`'s MutationObserver debounced and memoized; injected singletons id-guarded.

### 1.8 Candidate fix waves

> **Status — 2026-07-09:** **All four waves executed and merged into `t1r1jp`** — W1 (§37), W2 (§38 + §40 loose ends), W3 (§42–43), W4 (§45). What the four waves did **not** cover is the §1.2/§1.3 consent-&-parity remainder (J#8–J#14 minus J#4/5/6, plus C#3, C#8, B#3–B#6) — see the rollup at the top of this doc.

- **W1 — the HIGH tier (§1.1, 7 items):** user trust and dead ends. Touches
  `notifyChannel`/`notifier`, the invite gate, boot error path, bot callback handling
  (+`editMessageText` plumbing), `writeKnock` committed-state, `telegramChrome` back checklist,
  unlink error surface.
- **W2 — functions round-trip/atomicity pass (§1.6):** mostly mechanical, test-heavy, high
  payoff; graduation/expunge atomicity is a real robustness gain, not just latency.
- **W3 — client consolidation (§1.7):** `setListEmpty` guard + script `defer` first (measurable),
  then the helper consolidations.
- **W4 — copy/label/CSS sweep + bot delight batch (§1.4 + §1.5):** large count, small individual
  cost; a single sweep commit each for copy, CSS tokens/touch-targets, and bot replies.

---

## §2. Agent report — UX: end-to-end user journeys (J#1–J#15)

FINDINGS (ranked by severity)

> **Status — 2026-07-09:** ✅ **Shipped in W1** (Tasks 8, 10). `resolveInvitePreview` distinguishes an invalid/expired token from a lookup failure; the gate shows the error overlay + retries, with a splash-dismiss follow-up (`85ce049`). On-device verified; the transport-failure path is test-verified only.

**J#1. HIGH — Deep-link invite silently evaporates when the preview fails (Journey 1, arrival).**
A newcomer taps "Ana invited you" in Telegram; the Mini App boots, and if the token is
expired/revoked — or the preview callable merely hits a network blip — they land in a cold empty
app with zero acknowledgment that an invite was ever involved. `telegramInviteGate` returns null
on `!preview` (`js/telegramFirstRun.js:61-62`), and `resolveInvitePreview` swallows all errors
into null (`js/invites.js:232-239`), conflating "invalid invite" with "transient failure" — a
*valid* invite can be dropped silently. The web path shows an explicit failure overlay for the
same cases (`js/app.js:471-496`); Telegram shows nothing. The spec chose silence for invalid
tokens, but the network-error conflation and total absence of "that invite didn't work" feedback
is a dead end: the user thinks the product (or their friend's link) is broken. Fix: distinguish
preview error from invalid; show the existing invite-failure overlay copy (and retry the preview
on error). OBSERVED-IN-CODE.

> **Status — 2026-07-09:** ✅ **Shipped in W1** (Task 12; follow-up `84254ee`). A `#boot-error-overlay` retry surface (reload-on-click) replaces the passive toast, extended via a shared `showBootError()` to cover boot failures at any phase.

**J#2. HIGH — Telegram boot failure is a dead end with a one-line toast.**
If `ensureTelegramIdentity` throws (bot unconfigured, webview network flake — common in Mini
Apps), app.js dismisses the splash, shows "Couldn't start KnockKnock. Please try again in a
moment.", and rethrows so `main()` dies (`js/app.js:109-121`). `#main-ui-direct` is still hidden,
so after tapping the toast's OK the user faces a blank dark screen with no retry affordance —
they must know to kill and reopen the Mini App. Fix: add a "Try again" button that reloads
(`location.reload()` re-runs boot) instead of a passive toast. OBSERVED-IN-CODE.

> **Status — 2026-07-09:** ✅ **Shipped in W1** (Tasks 5–7) + the §39 web-pill honesty guards. Switching to Push with no push-capable device is refused (no write, no flip) on the Mini App, the bot `/notifications push`, and the web pill. Verified on-device across all three surfaces.

**J#3. HIGH — Switching the channel pill to "Push" from inside Telegram can silence all
notifications with no warning.**
The pill's switch-to-push safety net (`ensureNotificationsReady`) early-returns in Telegram
context (`js/notifyChannel.js:66-68`, `js/notifyPrompt.js:113`), and `sendToUser` has no telegram
fallback when channel is `push` and the account has zero `pushTokens` — it just returns false
(`functions/notifier.js:27-42`). A linked user who taps "Push" in the Mini App (curiosity, or
misunderstanding the pill) while never having granted web push anywhere goes completely silent —
no knocks, no calls — with no cue on any surface. The bot `/notifications push` command has the
same hole (`functions/telegram.js:167-175`). Fix direction: when switching to push and no
pushTokens exist, warn ("No device is set up for push yet — open KnockKnock in a browser first")
or fall back to Telegram on token-less sends. OBSERVED-IN-CODE.

> **Status — 2026-07-09:** ✅ **Shipped in W1** (Tasks 9, 11). Per-token outcomes are stamped (`stampInviteOutcome`), so a re-tapped already-accepted link shows nothing instead of re-running the interstitial.

**J#4. MEDIUM — Re-tapping the invite deep link re-shows the interstitial forever (Journey 1,
re-entry).**
The original t.me invite message in chat is the invited user's most natural re-entry point (the
spec added the welcome DM precisely because they lack one). But the gate never checks whether
the invite was already accepted: every reopen via that link re-runs `telegramInviteGate` →
preview → full-screen "Ana invited you to follow them" interstitial with Accept/phrase/Not-now
(`js/telegramFirstRun.js:58-66`), and Accept then resolves to a silent already-following no-op
(`js/app.js:628-632`). The spec's table says re-taps should show nothing. Fix: skip the
interstitial when the preview's target is already in the following/groups list (or persist an
accepted-token marker). OBSERVED-IN-CODE.

> **Status — 2026-07-09:** ✅ **Shipped in W1** (Tasks 9, 10; follow-up `901339b`). Dismissed tokens are remembered: dismissed + linked skips silently (no auto-redeem), dismissed + unlinked re-offers the interstitial (personal invites are one-active-per-user with no reissue UI).

**J#5. MEDIUM — "Not now" isn't remembered; a declined invite auto-redeems later.**
The gate holds no dismissal state. A user who taps "Not now", then later links their phrase
account from the drawer (unrelated action), reloads with `start_param` still in initData → gate
re-runs with `linked=true` → the invite they declined is silently redeemed, with only a "You're
now following Ana" toast to explain it (`js/telegramFirstRun.js:58-63`, `js/app.js:633-637`).
Following someone the user explicitly declined is a consent surprise. Fix: stamp dismissed
tokens (sessionStorage, like `kk-landing`) and have the gate skip them. OBSERVED-IN-CODE.

> **Status — 2026-07-09:** ✅ **Shipped in W1** (Task 10). Cancelling the phrase screen now loops back to the interstitial with the invite still pending, matching the web onboarding loop. (= C#6.)

**J#6. MEDIUM — Interstitial "I have a secret phrase" → Cancel drops the invite.**
Choosing the phrase button resolves the gate to null immediately (`showLinkScreen()` isn't
awaited — `js/telegramFirstRun.js:67-68`); if the user cancels the link screen, boot has already
proceeded without the token — no interstitial returns, no redeem, invite lost until they re-tap
the original chat link (which they aren't told to do). Fix: on cancel, re-show the interstitial
(loop the gate) instead of falling through. OBSERVED-IN-CODE.

> **Status — 2026-07-09:** ✅ **Shipped in W1** (Task 14). Unlink now shows a busy state and, on failure, an inline "Couldn't unlink right now. Try again." (= C#2.)

**J#7. MEDIUM — Unlink failure gives zero feedback.**
`doUnlink` disables the button, and on error just re-enables it (`js/telegramSettings.js:67-76`)
— no error line, no busy label ("Unlinking…"). The user taps the destructive-styled Unlink in
the confirm sheet, nothing visibly happens, and the sheet stays up; they can't tell whether
they're still linked. Fix: busy label + an inline "Couldn't unlink right now. Try again." on
failure. OBSERVED-IN-CODE.

> **Status — 2026-07-09:** ❌ **Not implemented** — assigned to no wave. Verified absent in current source: `created` still derives purely from presence-existence (`functions/telegram-auth.js`, `created` true only when `!presence`), no `firstOpenAt` stamp; a `/start`-first arrival still misses the first-use pulse and the auto-2h availability.

**J#8. MEDIUM — The /start-first newcomer misses every "new user" nicety (Journey 2).**
`/start` bootstraps presence server-side (`functions/telegram.js:107-108`,
`functions/telegram-auth.js:90-96`), so when they then tap "Open KnockKnock", `created` is false
→ `isNew` false → no first-use pulse (`js/app.js:805`), no auto 2-hour availability
(`app.js:811-814`), and a later invite interstitial says plain "Accept" instead of "Accept & get
started". A Mini-App-first arrival gets all three. The two cold-arrival paths are supposed to be
equivalent journeys; the auto-availability especially matters because it's what makes a
brand-new account immediately visible to whoever invites them next. Fix: derive `isNew` from
"presence created during this boot OR bootstrapped by /start with no prior app open" (e.g. a
`firstOpenAt` stamp). OBSERVED-IN-CODE.

> **Status — 2026-07-09:** ❌ **Not implemented** — assigned to no wave. Verified absent: both Telegram invite buttons still go straight to the share sheet (`sharePersonalInvite` → `shareInviteLink`; the group modal shows only the share button); no long-press/secondary control opens a manage (Copy/↻/Revoke) state on the Telegram surface.

**J#9. MEDIUM — No way to manage (revoke/regenerate/rename) any invite from Telegram (Journey 6).**
In TG, the empty-state and drawer invite buttons go straight to the share sheet
(`js/mycode.js:114-118`), and the group invite modal replaces the whole create/manage UI with a
single "Share on Telegram" button (`js/inviteModal.js:104-133`). A Telegram-only user who shares
a personal or group link into the wrong chat has no revoke path at all on their only surface
(web has ↻/Revoke). The comment "editable later in the drawer modal" (`mycode.js:135`) is stale
— that modal never opens in TG. Fix: long-press or secondary affordance on the drawer invite row
opening the manage state (Copy/↻/Revoke) inside TG. OBSERVED-IN-CODE.

> **Status — 2026-07-09:** ❌ **Not implemented** — assigned to no wave. Verified absent: `sharePersonalInvite()` still awaits `createPersonalInvite` fire-and-forget — no try/catch + toast on failure, no busy/disable guard against a double-tap minting two invites. See also C#3.

**J#10. MEDIUM — "Invite your people" tap can fail silently.**
`sharePersonalInvite()` is called fire-and-forget with no catch (`js/app.js:753`,
`js/mycode.js:114-118`); if `createPersonalInvite`/`updateInviteLabel` reject (offline in the
webview), the tap does nothing — no error, no retry cue, on the single most important button of
the guided empty state. Also `openTelegramShare` is a silent no-op on old clients without
`openTelegramLink` (`js/telegram.js:47-49`). Fix: catch and toast "Couldn't create your invite —
check your connection." OBSERVED-IN-CODE.

> **Status — 2026-07-09:** ❌ **Not implemented** — assigned to no wave. Verified absent: the graduation phrase is still a one-shot reveal — "I've saved it" is ungated by a Copy tap, and post-graduation the recovery pill is hidden in Telegram, so nothing can re-show it.

**J#11. MEDIUM — Graduation phrase is a one-shot reveal with no way to ever re-view it
(Journey 4).**
After graduating, the recovery pill stays hidden in TG (`js/telegramSettings.js:14`) and nothing
is persisted client-side (TG boots from initData only; `recoveryCode: null` —
`js/telegram.js:42`). A user who taps "I've saved it" without actually saving (the tap is
unverified) has an account that claims to "work in any browser too" (boot toast) but that they
can never actually take outside Telegram — and no UI ever surfaces this. Web signup has the same
ceremony but the drawer pill lets you re-view the phrase afterward. Fix direction: gate "I've
saved it" behind a Copy tap, or offer a one-time re-reveal in the same session. OBSERVED-IN-CODE
(the storage/UX consequence is by design; the unverified-save risk is the gap).

> **Status — 2026-07-09:** ❌ **Not implemented** (copy/label) — assigned to no wave. Verified absent: entry is still a bare "?" badge, and the copy still reads "With an account you can use KnockKnock outside of Telegram" / "I want an account". Note: the "?" **hit area** was enlarged in W4 (C#12) — that's the tap target only, not the label or the account-denying copy.

**J#12. LOW — Graduation is nearly undiscoverable and its copy denies the account exists.**
The approved entry label "I also want to use the app outside of Telegram" shipped as a bare
mystery-meat "?" badge (`js/telegramSettings.js:23`, template line 302), and the info toast says
"With an account you can use KnockKnock outside of Telegram" / "I want an account"
(`js/graduation.js:11,33`) — but the user already *has* an account; the framing suggests their
current state is account-less. Fix: label the button ("Use outside Telegram") and reword to "get
a secret phrase for this account". OBSERVED-IN-CODE.

> **Status — 2026-07-09:** ❌ **Not implemented** — assigned to no wave. Verified absent: link and unlink both still end in a bare `location.reload()` with no confirmation toast/banner; only graduation stamps a boot toast.

**J#13. LOW — Link and unlink succeed with no confirmation, while graduation gets a toast.**
Both flows end in a bare `location.reload()` (`js/telegramSettings.js:71-72,119-120`); the
post-link/post-unlink banners were deliberately cut, and `LANDING_COPY` now carries only
`graduated` (`js/firstRun.js:93-95`). After linking, the user's only cue is that the list is
suddenly populated; after unlinking, a fresh empty state with no "unlink complete"
acknowledgment. Reusing the shared boot toast (the pattern graduation settled on) for
`linked`/`unlinked` would restore feedback consistently at trivial cost. OBSERVED-IN-CODE.

> **Status — 2026-07-09:** ❌ **Not implemented** — assigned to no wave. Verified absent: the web Notifications section still renders only the bare pill (`#tg-notify-slot`), with no hint line explaining that "Telegram" means this device gets nothing / the bot messages you.

**J#14. LOW — The web Notifications pill has no explanatory copy for the one state it exists to
explain.**
A linked user's web drawer shows a bare "Telegram | Push" pill under "Notifications"
(`js/notifyChannel.js:49-53`, template lines 269-272) — no hint that "Telegram" means "this
device gets nothing; the bot messages you", even though this section is the spec-designated home
for web-side link visibility and the user's install/push nudges have silently vanished
(suppression). One hint line ("Notifications currently arrive via the Telegram bot") would
explain both the pill and the missing nudges. OBSERVED-IN-CODE.

> **Status — 2026-07-09:** ✅ **Shipped in W4.** A one-time first-accept beat was added. Review caught a **CRITICAL**: on the Telegram silent-redeem path the beat was overwritten same-tick and its gate burned (it would never show for TG-linked newcomers, its main audience) — fixed via `reconcileSilentRedeemToast` + call-site regression tests.

**J#15. LOW — Missed delight: an accepted invite gives the newcomer no "what now" beat.**
After the interstitial's Accept, the contact simply appears in the list
(`handleInviteRedemptionResult` deliberately shows nothing on success — `js/app.js:462-467`);
the silent-redeem path for linked users gets a toast ("You're now following Ana") but the
primary newcomer path gets none, and nothing points at the core loop (knock her, set your
availability — the hint engine needs time to rotate in). A one-time toast or hint priming
("You're following Ana — tap her card to knock") would land the aha moment at its peak.
OBSERVED-IN-CODE (absence traced; exact hint-engine timing INFERRED).

---

## §3. Agent report — UX: UI/interaction consistency (C#1–C#14)

Ranked findings. (All line numbers on branch `claude/telegram-app-adaptation-t1r1jp`; base for
"the branch added" claims is 2dc5b8c.)

> **Status — 2026-07-09:** ✅ **Shipped in W1** (Task 13; follow-up `8c34d99`). `resolveBackAction` now dismisses the branch's confirm/prompt overlays first (cancel semantics), including the later-added `#unfollow-confirm` and `#rotate-confirm` sheets.

**C#1. Telegram back button ignores every confirm/prompt surface the branch itself added — HIGH,
OBSERVED-IN-CODE (consequence INFERRED)**
(a) `resolveBackAction` closes modals/drawers but has no entry for any confirm-overlay or the
new prompt primitives, so the hardware back acts on the surface *underneath* an open confirm.
(b) `js/telegramChrome.js:23-41` (checklist covers restore/invite/create-group/inbox/etc. only)
vs the branch's own new overlays: `#text-prompt-modal` and `#confirm-modal`
(`index.template.html:132,145`, used from `js/groupContext.js:901-926`), `#tg-unlink-confirm`
(`js/telegramSettings.js:47`), `#graduation-info-toast` (`js/graduation.js:26`). Worst case:
with "Delete 'X'?" open in group context, back falls through to
`getCurrentContext().context === 'group'` → `navigateToDirect()` (telegramChrome.js:39) while
the destructive sheet stays open over Direct.
(c) The modal treatment should win: back should dismiss the top-most confirm exactly as it
dismisses `#invite-modal`. Add the confirm/prompt overlays at the top of the checklist.
(d) HIGH.

> **Status — 2026-07-09:** ✅ **Shipped in W1** (Task 14) — same fix as J#7: unlink busy state + inline error on failure.

**C#2. Unlink is the only destructive action that fails silently — HIGH, OBSERVED-IN-CODE**
(a) Every sibling async failure in the branch surfaces an error; unlink swallows it and just
re-enables the button inside the still-open confirm.
(b) `js/telegramSettings.js:67-76` (`catch { btn.disabled = false; }` — no message) vs link
failure inline error (`telegramSettings.js:104,116`), graduation inline `userMessage`
(`js/graduation.js:50-53` → recoveryModal error slot), inbox join/approve `showToast`
(`js/inbox.js:286,337`).
(c) The link/graduate pattern should win (inline error or toast); an "Unlink" tap that visibly
does nothing is the worst outcome for a destructive confirm.
(d) HIGH.

> **Status — 2026-07-09:** ◑ **Partial** — no dedicated wave. W3 gave the link-screen submit (CL#7) and the unlink confirm (CL#4) proper busy states, but the invite/share buttons flagged here remain bare: verified absent 2026-07-09 on `#invite-modal-tg-share-btn` (`js/inviteModal.js`, no disable/busy) and `sharePersonalInvite` (`js/mycode.js`, no busy handling).

**C#3. Five different loading/disabled patterns on the branch's new async buttons — MEDIUM,
OBSERVED-IN-CODE**
(a) The branch extracted `setButtonBusy` into utils yet most new buttons don't use it.
(b) Shared util with label swap: `js/app.js:348` ('Signing in…'), `js/recoveryModal.js:89`
('Setting up…'). Hand-rolled disabled+label on the *same physical button* (`#restore-submit-btn`):
`js/telegramSettings.js:109-110` ('Linking…'). Disabled-only, no label: unlink
`telegramSettings.js:69`. Optimistic-flip-with-revert: channel pill `js/notifyChannel.js:59-70`.
Nothing at all: `#invite-modal-tg-share-btn` (`js/inviteModal.js:118-126`) and the Telegram
first-run/drawer "Invite your people" → `sharePersonalInvite` (`js/mycode.js:133-155`) — the
latter awaits `createPersonalInvite` unguarded, so a double-tap can mint two invites (INFERRED).
(c) `setButtonBusy`/`clearButtonBusy` should win everywhere a network round-trip runs behind a
tap; it already exists in `js/utils.js:7-18`.
(d) MEDIUM.

> **Status — 2026-07-09:** ✅ **Shipped in W4** (Spec 1 copy sweep). "I have a secret phrase" is the unified entry label; "Link account" kept only for the submit.

**C#4. Three labels for the one "enter your phrase to link" flow — MEDIUM, OBSERVED-IN-CODE**
(a) The same `showLinkScreen()` is launched under "Link your account", "I have a secret phrase",
and submits as "Link account".
(b) `index.template.html:302` (`Link your account`, first-run panel) vs
`js/telegramSettings.js:22` and `index.template.html:65` (`I have a secret phrase`, drawer +
interstitial) vs `js/telegramSettings.js:94` (submit: `Link account`).
(c) "I have a secret phrase" should win as the entry label — it's the established affordance on
the web welcome and stale screens (`index.template.html:37,56`); keep "Link account" only for
the submit.
(d) MEDIUM.

> **Status — 2026-07-09:** ✅ **Resolved in W4, reframed** (Spec 1). The operator ruled the three labels are **not** drift — each is contextually correct — so **no label edits**. Instead the behavior changed: a TG group modal with no displayable contacts skips straight to the native share sheet (`hasDisplayableInvitees` in `js/invitePicker.js`).

**C#5. "Share" vs "Share on Telegram" vs "Share to Telegram" — MEDIUM, OBSERVED-IN-CODE**
(a) The identical share-this-invite-via-Telegram action carries three labels with a preposition
drift.
(b) `index.template.html:93` (`Share`, Telegram manage state), `index.template.html:102`
(`Share on Telegram`, Telegram group scope), `js/inviteModal.js:189` (`Share to Telegram`, web).
(c) Inside Telegram plain "Share" is right (it's the native sheet, the destination is implicit)
— the group button should also say "Share"; on web pick one preposition, and "Share to Telegram"
(naming the destination from outside) reads better, matching commit 6f2ef29's own title.
(d) MEDIUM.

> **Status — 2026-07-09:** ✅ **Shipped in W1** (Task 10) — same fix as J#6: the phrase-screen Cancel loops back to the interstitial with the invite retained.

**C#6. Cancelling the phrase screen from the invite interstitial loses the invite; web loops
back — MEDIUM, OBSERVED-IN-CODE**
(a) The web onboarding deliberately loops so restore-cancel returns to the choice screen, but
the Telegram interstitial's "I have a secret phrase" → Cancel falls through and the invite is
dropped with no way back to Accept.
(b) `js/app.js:199-215` ("Loop so that cancelling the restore screen returns the user to the
welcome screen") vs `js/telegramFirstRun.js:66-68` (`if (choice === 'phrase') showLinkScreen();
// …cancel falls through` → `return null`).
(c) The web loop should win: cancel on the link screen should re-show the interstitial with the
invite still pending.
(d) MEDIUM.

> **Status — 2026-07-09:** ✅ **Shipped in W4** (Spec 2). The bot's group-invite button now reads "Join" (Decline unchanged).

**C#7. Accepting a group invite: "Join" on web, "Accept" in the bot — MEDIUM, OBSERVED-IN-CODE**
(a) The same pending-group-invite action is "Join" in the app inbox but "Accept"/"Decline" on
the bot's inline keyboard.
(b) `js/inbox.js:215` (`Join`) vs `functions/telegram.js:47-50` (`Accept` / `Decline`); the
interstitial adds a third flavor, "Accept & get started" / "Accept"
(`js/telegramFirstRun.js:29-30`).
(c) The bot should adopt the web's "Join"/"Decline" — "Join" states the outcome, and Decline
already matches. (The interstitial's "Accept" is fine: it covers personal invites too.)
(d) MEDIUM.

> **Status — 2026-07-09:** ❌ **Not implemented** — assigned to no wave. Verified absent: the Mini-App group-join prompt still opens with `input.value = ''` (`js/groupDisplayNamePrompt.js`); the caller passes only the group name, no `telegramFirstName()` prefill. (W3's CL#9 made `telegramFirstName()` trimmed/capped, but nothing wired it into this prompt.)

**C#8. Group-join display name: bot auto-fills, Mini App prompts with an empty field — MEDIUM,
OBSERVED-IN-CODE**
(a) The same Telegram user joining the same group gets their Telegram first name silently
applied via the bot button but a blank full-screen name prompt via the deep link.
(b) `functions/telegram.js:424-427` (`displayName: clampName(cq.from.first_name) || 'Someone'`,
"the bot has no prompt UI") vs `js/app.js:617-627` + `js/groupDisplayNamePrompt.js:17`
(`input.value = ''` — not prefilled), even though the same boot path already uses
`telegramFirstName()` as the redeemer name one line above (app.js:611).
(c) The prompt should stay (editable is better than silent) but prefill `telegramFirstName()` in
Telegram context so both surfaces agree on the default.
(d) MEDIUM.

> **Status — 2026-07-09:** ✅ **Shipped in W4** (Spec 1). Error strings unified to the "Couldn't … Try again." contraction voice with straight apostrophes. One decided exception: the `js/app.js` boot string keeps "…Please try again in a moment."

**C#9. Error-copy tone drift across branch-authored strings — MEDIUM, OBSERVED-IN-CODE**
(a) New failure strings mix "Could not"/"Couldn't", "Try again."/"Please try again.", and
straight/curly apostrophes.
(b) `js/inbox.js:286,337` ("Could not … Please try again."), `js/inviteModal.js:126` ("Could
not create invite. Try again."), `js/telegramSettings.js:116` ("Couldn't link right now. Try
again."), `js/graduation.js:52` ("Couldn't set that up right now. Try again."), `js/app.js:118`
("Couldn't start KnockKnock. Please try again in a moment."), `js/notifyPrompt.js:91` (curly
`Couldn’t` — every other new string uses straight `'`).
(c) The contraction form ("Couldn't … Try again.") should win — it matches the app's informal
voice (bot copy, hints) and is the majority in the new code.
(d) MEDIUM.

> **Status — 2026-07-09:** ✅ **Shipped in W4** (Spec 1). `.drawer-section` now uses the real `--surface2` (border) and `--text-muted` (secondary text) tokens, so it rethemes.

**C#10. New drawer sections invent CSS tokens that don't exist, so they never retheme — MEDIUM,
OBSERVED-IN-CODE**
(a) `.drawer-section` / `.drawer-section-label` reference `--border` and `--text-dim`, which are
defined nowhere, so the fallbacks (static grays) always render and won't follow palette swaps.
(b) `css/app.css:320-321` (`var(--border, rgba(128,128,128,.25))`, `var(--text-dim, #888)`) vs
the token set at `css/app.css:4-25` and the theme-restore script `index.template.html:25`
(neither token included); established equivalents used everywhere else: `--surface2` for borders
(e.g. app.css:504-507 nav border), `--text-muted` for secondary text.
(c) The existing tokens should win: `border-top: 1px solid var(--surface2)` and
`color: var(--text-muted)`.
(d) MEDIUM.

> **Status — 2026-07-09:** ✅ **Shipped in W4** (Spec 1). The graduation info now rides the shared `showConfirmModal` / `#confirm-modal` (an `'affirmative'` variant + "Close"), gaining backdrop/Escape/back coverage; the bespoke snackbar and its orphaned back-branch were retired.

**C#11. Graduation "info toast" is a two-choice dialog wearing a snackbar skin — MEDIUM,
OBSERVED-IN-CODE**
(a) A `role="dialog"` decision UI ("I want an account" / "Close") is presented as a bottom
snackbar with no backdrop, no Escape, no back-button coverage — while every other two-choice
decision on this branch uses `.confirm-overlay` (backdrop-tap + Escape + cancel).
(b) `js/graduation.js:22-40` + `.graduation-toast` at `css/app.css:1474-1483` (which also
near-duplicates `.group-removal-toast` geometry at `css/app.css:1224-1238` —
fixed/bottom/centered/surface2/shadow/z-100) vs `.confirm-overlay` usage in
`js/promptModal.js:61-94` and `js/telegramSettings.js:43-64`.
(c) The confirm-overlay primitive should win (it's exactly "short message + two buttons"), or at
minimum the snackbar should share `.group-removal-toast`'s rules and gain Escape/back dismissal.
(d) MEDIUM.

> **Status — 2026-07-09:** ✅ **Shipped in W4** (Spec 1). The "?" hit area was grown via a transparent `::before { inset: -0.4rem }` pseudo-element (reworked in review so paint/layout stay unchanged, only the tap target expands).

**C#12. The "?" help badge is an ~18px touch target — LOW, OBSERVED-IN-CODE (tap difficulty
INFERRED)**
(a) The new graduation "?" is by far the smallest interactive control in the app, on a
mobile-first surface.
(b) `css/app.css:1461-1469` (`width/height: 1.15rem` ≈ 18px) vs neighboring controls:
`.rotate-btn` ≈ 28px (app.css:335-339), `.chip` ≥ ~28px tall (app.css:663-671), buttons 13px
padding (app.css:290-293). Two placements: `index.template.html:302`,
`js/telegramSettings.js:23`.
(c) Keep the small visual, grow the hit area (padding or a ::before hit-slop) toward the other
controls' sizes.
(d) LOW.

> **Status — 2026-07-09:** ✅ **Shipped in W4** (Spec 1). Group names are bare app-wide now; the Leave confirm gained its explanatory message.

**C#13. Group-name quoting differs per surface — LOW, OBSERVED-IN-CODE**
(a) Web copy wraps group names in straight single quotes; all Telegram-side copy leaves them
bare.
(b) Quoted: `js/inbox.js:206` (`invited you to join 'X'.`), `js/app.js:275` (welcome framing),
`js/groupContext.js:908,925` (`Delete 'X'?`, `Leave 'X'?`). Bare: `js/telegramFirstRun.js:18-19`
("join X."), `js/app.js:634-636` ("You joined X."), bot `Joined X.` (`functions/telegram.js:432`).
Related nit: the Leave confirm passes no explanatory message (groupContext.js:925) while Delete
and the unfollow sheet both do (groupContext.js:908; `js/following.js:119`).
(c) Bare names should win (the Telegram/bot style) — quotes around a user-chosen name read as
scare quotes and the majority of new copy omits them.
(d) LOW.

> **Status — 2026-07-09:** ✅ **Shipped in W4** (Spec 1). The chip boots as its majority-state label "Levers & knobs", so there's no rename flash.

**C#14. Drawer chip boots as "Share code" then flips to "Levers & knobs" — LOW, OBSERVED-IN-CODE
(flash INFERRED)**
(a) The chip's markup default and its steady-state runtime label disagree, so every non-empty
boot renames the chip after the first roster render; the whimsical "Levers & knobs" also applies
to the web drawer, where the drawer is still mostly the share code.
(b) `index.template.html:251` (`Share code` default) vs `js/firstRun.js:70-72` (renames on every
`setListEmpty` tick).
(c) Ship the majority-state label in the markup (or pick one label); if "Levers & knobs" stays,
the template default should match it so the boot flash disappears.
(d) LOW.

**Checked and clean (per the brief's specific questions):** no survivors of the removed
"landing-notice" pattern — no `.landing-notice` CSS or markup remains, only explanatory comments
in `js/firstRun.js:89-95`, and the graduation notice correctly routes through the shared toast
(`js/app.js:757-758`); bot notification text reuses the exact web-push titles
(`functions/index.js:76-85` sends `message.title`), so knock/availability copy doesn't drift;
the confirm-sheet family is internally consistent on button order (Cancel left, red action
right) including the new `#confirm-modal` and `#tg-unlink-confirm`; and the
channel-pill/`notifySuppression`/`notifier` "missing channel = telegram" default agrees across
all three readers.

---

## §4. Agent report — UX: bot conversation (B#1–B#14)

Findings ranked. All quotes are exact strings from code. Files: `functions/telegram.js` (T),
`functions/notifier.js` (N), `functions/telegram-shared.js`, `functions/index.js` (I).

> **Status — 2026-07-09:** ✅ **Shipped in W1** (Tasks 2–4) + §39 refinements. Group-invite and follow-request callbacks are state-checked (fresh / already-handled / cross-path answer honestly) and edit the source message via `resolveSourceMessage`; decline-after-accept no longer lies. Verified on-device.

**B#1. HIGH — Inline notification messages never update after a button tap; later taps give
misleading answers.** OBSERVED-IN-CODE.
(a) User taps "Accept" on a group invite, then later (or on another device) taps "Decline" on
the same still-live message. (b) Accept answers `'Joined ${name}.'` as a transient toast only;
the message keeps its Accept/Decline keyboard forever (no
`editMessageText`/`editMessageReplyMarkup` anywhere — the webhook `tg` deps at I:246-249 expose
only `sendMessage` + `answerCallbackQuery`). A post-accept Decline tap runs `clearPending()` (a
no-op) and answers `'Declined.'` — while the user remains a member. Same for follow requests:
`fr_decline` after `fr_approve` answers `'Declined.'` though the grant already exists
(T:435-438). (c) Stale buttons are the classic Telegram-bot trust-killer; the "Declined." lie is
worse. (d) T:400-453, I:246-249. (e) After handling a callback, edit the source message
("✅ Joined Divers") and strip the keyboard; make decline-after-accept answer honestly.

> **Status — 2026-07-09:** ✅ **Shipped in W1** (Task 1). `writeKnock` returns whether the transaction actually committed; a cap-dropped knock now answers the cap message, not "Knock sent."

**B#2. HIGH — "Knock sent." even when the knock was silently dropped by the 5-cap.**
OBSERVED-IN-CODE.
(a) User taps "Knock back" a 6th time, or runs `/knock ana` when the counter is maxed.
(b) `writeKnock`'s transaction aborts at `if (current.count >= 5) return undefined;` (T:196)
but ignores `committed`; the callback still answers `'Knock sent.'` (T:387) and the command
still replies `'Knocked on ${matches[0].label || matches[0].code}.'` (T:353, also T:324).
(c) The bot confirms an action that did not happen; user believes they pinged someone.
(d) T:189-202, 352-353, 386-387. (e) Return `committed` from `writeKnock` and answer "You've
already knocked a few times — give them a moment." on abort.

> **Status — 2026-07-09:** ❌ **Not implemented** — assigned to no wave (this HIGH did not make the §1.1 synthesis HIGH tier). Verified absent: the disambiguation reply is still "…give me more letters." with no keyboard and no pending-duration state; free text still falls through to the "I don't know that one." + `HELP_TEXT` dump.

**B#3. HIGH — The group-disambiguation prompt dead-ends into the unknown-command dump.**
OBSERVED-IN-CODE (user behavior INFERRED, but near-certain).
(a) `/status fam 2h` matches two groups; bot says `'Which group? ${names} — give me more
letters.'` (T:229). The natural reply is to type just `family` — free text. (b) Free text hits
the default branch: `'I don't know that one.\n\n' + HELP_TEXT` (T:183) — an 8-line help dump,
and the user's duration ("2h") is lost either way; they must reconstruct the whole command.
(c) The bot asks a question it cannot hear the answer to. (d) T:225-233, 182-184. (e) Either say
"try `/status family 2h`" with the full retry command spelled out, or (spec permitting) use an
inline keyboard whose callbacks carry the pending duration.

> **Status — 2026-07-09:** ❌ **Not implemented** — assigned to no wave. Verified absent: a failed group lookup on a numeric/duration-ish query still replies only `No group matching "…".`, with no `/status [group] [30m|2h]` usage hint.

**B#4. MEDIUM — Duration typos are misread as group names, with no format hint.**
OBSERVED-IN-CODE.
(a) User types `/status 2 hours` or `/status for 1h`. (b) `parseDurationMinutes('2 hours')`
fails (regex T:67 rejects "hours"), so the args are treated as a group query and the reply is
`'No group matching "2 hours".'` (T:227). (c) The user learns neither that a duration was
expected nor its format; nothing anywhere teaches `30m|2h` except `/help`. (d) T:141-158, 62-70,
227. (e) When a group lookup fails and the query looks numeric/duration-ish, append the usage
line `/status [group] [30m|2h]`.

> **Status — 2026-07-09:** ❌ **Not implemented** — assigned to no wave. Verified absent: bare `/who` for a zero-follow user still emits "No one is available right now."; no "you're not following anyone yet — invite people" branch.

**B#5. MEDIUM — Bare `/who` for a brand-new user replies with a dead end.** OBSERVED-IN-CODE.
(a) A fresh Telegram-only user (zero follows, zero groups — the exact persona the funnel
creates) tries `/who`. (b) `'No one is available right now.'` (T:339). (c) Technically true,
functionally "nothing works"; the empty state should distinguish "nobody's free" from "you
don't follow anyone yet." (d) T:328-340. (e) When `following` is empty, reply "You're not
following anyone yet — invite people from the app." + Open button.

> **Status — 2026-07-09:** ❌ **Not implemented** — assigned to no wave. Verified absent: the bot join still sets the 2h availability override but reports only "Joined ${name}." — no disclosure of the availability broadcast, no `/off` hint.

**B#6. MEDIUM — Joining a group via "Accept" silently makes you available for 2 hours,
unannounced.** OBSERVED-IN-CODE.
(a) User taps Accept on an invite notification. (b) The join writes `statusOverride: { enabled:
true, status: 'available', availableUntil: now + 2h }` (T:426) but the only feedback is the
toast `'Joined ${name}.'` (T:430). (c) The user is broadcasting availability (and co-members get
fan-out via `onMemberOverride`) without being told; the display name is also silently set to
their Telegram first name. (d) T:420-431. (e) Follow the join with a sendMessage: "Joined Divers
— you're shown available there for 2h. /off divers to change."

> **Status — 2026-07-09:** ✂️ **Cut by decision** (operator, §44). The deep-link "Open in KnockKnock" `web_app` keyboard row on invite/follow-request messages was explicitly dropped from W4's bot-delight scope.

**B#7. MEDIUM — No deep link back into the Mini App on knock / invite / follow-request
notifications.** OBSERVED-IN-CODE.
(a) User gets "Cara wants to follow you" and wants to see who Cara is before approving; or gets
a knock and wants to open the canvas. (b) Only `type: 'call'` gets a `web_app` button (T:45);
knock/availability get knock-only keyboards, invite/followRequest get bare Accept/Decline — the
FCM path deep-links to the Inbox (per notifier comments N:93, N:112) but the Telegram rendering
drops that affordance. (c) Approve/decline-blind is uncomfortable; a second-row "Open KnockKnock"
button is nearly free (`openAppKeyboard` already exists in telegram-shared.js:17).
(d) T:38-58. (e) Add an "Open in KnockKnock" web_app row to invite/followRequest (and optionally
knock) keyboards.

> **Status — 2026-07-09:** ✅ **Shipped in W4** (Spec 2, as an easter egg). Private non-text messages get "Someone else might enjoy that {emoji} — try /help." with `{emoji}` random from an extensible set via `pickPlayfulEmoji`.

**B#8. MEDIUM — Non-text messages are ignored with total silence.** OBSERVED-IN-CODE (user
attempts INFERRED).
(a) User shares a contact ("knock this person"), sends a sticker, a voice note, or a photo.
(b) `if (msg.chat?.type !== 'private' || typeof msg.text !== 'string' || !msg.from) return;`
(T:97) — no reply at all. (c) Silence reads as "bot is broken"; even the unknown-command
fallback would be better. (d) T:96-97. (e) For private non-text messages, reply with a one-liner
pointing at `/help`.

> **Status — 2026-07-09:** ✅ **Shipped in W1** (with B#1). Callback outcomes are now persisted in the chat by editing the source message, so the toast is confirmation garnish rather than the only record.

**B#9. MEDIUM — Callback outcomes exist only as vanishing toasts; the chat history records
nothing.** OBSERVED-IN-CODE.
(a) User taps Approve on a follow request while glancing at their phone; the
`answerCallbackQuery` toast (`'Approved.'`, T:452) disappears in ~4s. (b) Nothing persistent is
written — combined with B#1, the chat permanently shows only the pre-action message. (c) A day
later there is no way to tell from the chat whether the request was handled. (d) T:377, 407,
430, 437, 452; I:248. (e) Same fix as B#1 (edit the message text); toasts then become
confirmation garnish rather than the only record.

> **Status — 2026-07-09:** ✅ **Shipped in W4** (Spec 2, option A). `resolveName` prefixes an unlabeled actor as "Your contact {code}" (scoped to knock/call; web-push titles gain the prefix too). The three-reader notify predicate stayed byte-identical.

**B#10. LOW — Actor identity can render as a raw share code.** OBSERVED-IN-CODE.
(a) Someone you haven't labelled knocks. (b) `resolveName` falls back to the share code
(N:53-59), so the bot message is literally "K7Q2ZP knocked". (c) Acceptable on a lock screen
(matches web push), but in a conversational chat it reads like a glitch; low because it's
pre-existing cross-channel behavior. (d) N:53-59, presence-core.js:40-44. (e) Prefix codes:
"Your contact K7Q2ZP knocked" or prefer a group displayName when any shared group has one.

> **Status — 2026-07-09:** ✅ **Shipped in W4** (Spec 2, option A). A single `COMMANDS` list feeds both `HELP_TEXT` (byte-identical to today) and a new deploy-time `setBotCommands` HTTP fn calling `setMyCommands`; the manual BotFather paste is de-drifted. (Takes effect only after the A5 redeploy + hitting `setBotCommands`.)

**B#11. LOW — Command menu depends on a manual BotFather step whose copy has already drifted.**
OBSERVED-IN-CODE (docs).
(a) User taps the "/" menu to discover argument formats. (b) Registration is the runbook's
`/setcommands` paste (docs/telegram-setup.md:65-73) — `status - Go available (e.g. /status 2h)`
— which predates the group forms (`/status [group] [30m|2h]`) now in `HELP_TEXT` (T:77); the
plan calls setcommands "optional" (plans/2026-07-02:2283). No `setMyCommands` API call exists.
(c) The menu is the primary discoverability surface for "does /who take an argument?", and
manual copy will keep drifting. (d) docs/telegram-setup.md:65-73; T:75-84. (e) Call
`setMyCommands` at webhook-registration time from the same source of truth as `HELP_TEXT`.

> **Status — 2026-07-09:** ✅ **Shipped in W4** (Spec 2). The reachable stale-button case answers "This button has expired — try /help." instead of the bare "Unknown action."

**B#12. LOW — `'Unknown action.'` is a dead-end where users can reach it legitimately.**
OBSERVED-IN-CODE.
(a) A user taps a button on an old notification after a future release renames an action, or
callback data is malformed. (b) `await answer('Unknown action.');` (T:383, 396) — no hint of
what to do. (c) Rare (guard is mostly anti-tamper), but when hit it's pure confusion.
(d) T:381-383, 395-397. (e) "This button has expired — try /help." Note the adjacent guard
`'Open KnockKnock first.'` (T:379) fires for unlinked users tapping any old button and is fine.

> **Status — 2026-07-09:** ✅ **Shipped in W4** (Spec 2). The 8-item inline-keyboard caps now append an "…and N more" truncation hint on overflow.

**B#13. LOW — `/who <group>` and `/knock` "Which one?" keyboards silently cap at 8.**
OBSERVED-IN-CODE.
(b) `found.slice(0, 8)` / `matches.slice(0, 8)` (T:320, 349) with no "and N more — type more
letters". (d) T:319-321, 348-350. (e) Append a truncation hint when the list overflows.

> **Status — 2026-07-09:** ✅ **Shipped in W4** (Spec 2, option B). Each subject's status-color hex is quantized to the nearest Telegram circle emoji (`statusCircle` in `presence-core.js`, fallback 🟢), and remaining time is shown across `/who` `/status` `/start` `/groups` using the app's own formatters (duplicated byte-identical into `functions/presence-core.js`, fixture-guarded).

**B#14. LOW — Formatting is plain-text-only and slightly inconsistent; cheap richness
available.** OBSERVED-IN-CODE.
No `parse_mode` is ever set (I:247, I:203), so everything is unstyled — consistent, at least.
`/who` uses `🟢 name` (T:291, 337) but `/groups` uses plain
`'${name} — ${on ? 'available' : 'unavailable'} (you)'` (T:366) with no dot/emoji and no header;
`/who <group>` shows who's available but not for how long, though `availableUntil` is already
read (T:289-290). (d) T:356-369, 282-297. (e) Unify the status glyph across /who and /groups
and append remaining time ("🟢 Ana — 1.5h left"); optionally adopt HTML parse_mode for bold
names.

**Positive notes (already-shipped delight, no action):** the returning-user `/start` status echo
(`"You're available for another ${fmtMinutes(mins)}. /off to stop."`, T:123) and the state
acknowledgments on `/status`/`/off` (T:150, 164) are exactly the right pattern; the stranger
funnel (3 lines + Open button, no command dump, T:113-117) matches the onboarding spec; the
pre-mapping guard `'First, open the app once so I know who you are:'` (T:132) always carries the
Open button; and every override-off group reply (T:255-257, 276-278) explains *why* nothing was
written and what to do instead — the best copy in the bot.

---

## §5. Agent report — client code efficiency & redundancy (CL#1–CL#13)

Findings, ranked. Scope verified against `git diff 2dc5b8c..HEAD`; the three sanctioned
notify-channel-default readers check out with no fourth re-derivation, and no dead references to
the removed `#empty-list-msg` / `#invite-link-btn` / landing-banner DOM remain.

> **Status — 2026-07-09:** ✅ **Shipped in W3-A.** A module-level `_appliedEmpty` guard early-returns before the DOM churn + `first-run-change` dispatch on unchanged emptiness state.

**CL#1. `setListEmpty` does full DOM churn + event fan-out on every `renderList` tick, with no
change detection — HIGH**
(a) The guided-empty-state sync claims to be "idempotent per state" but never early-returns, so
every list render re-runs ~9 `getElementById`s, class toggles, three `textContent` writes, and
dispatches `first-run-change`, which re-runs `installAffordance.apply()` (lane detection,
`isAppInstalled()`, more DOM writes).
(b) `js/firstRun.js:32-80` (no guard); callers `js/following.js:420` and `:425` — and
`renderList` fires on presence flips (`following.js:899`, `:921`),
follower/following/followerNames watcher ticks (`:85,91,141,155,178`), and a 60s interval;
fan-out listener `js/installAffordance.js:110`.
(c) Track last applied state (`let _applied = null; if (_applied === !!isEmpty) return;
_applied = !!isEmpty;`) at the top of `setListEmpty`.
(d) Eliminates ~10 DOM ops + a CustomEvent + an install-affordance recompute per
presence/watcher tick for the app's whole lifetime; 1-line fix.
(e) HIGH.

> **Status — 2026-07-09:** ✅ **Shipped in W3-A.** `defer` added to both `telegram-web-app.js` and `dist/bundle.js` (document order preserved). Webview timing was the on-device gate, cleared in the W4 acceptance pass.

**CL#2. Parser-blocking third-party `telegram-web-app.js` in `<head>` on every web load — HIGH**
(a) The Telegram bridge script is a synchronous, non-deferred script from `telegram.org` placed
before everything (including the inline theme-restore script), so every plain-web boot's first
paint waits on a third-party fetch — and stalls badly if telegram.org is slow or blocked.
(b) `index.template.html:19` (script), `:387` (bundle, also non-deferred), `:25` (theme script
now parsed after it).
(c) Add `defer` to both the telegram script and `dist/bundle.js` (defer preserves execution
order, so `isTelegramContext()` still sees `window.Telegram` at boot), or move the telegram tag
to directly above the bundle tag at end of body. Keep the inline theme script above it either
way.
(d) Removes one third-party RTT from the web boot critical path / unblocks first paint.
(e) HIGH that it's real; MEDIUM on exact fix shape (verify Telegram webview timing on-device).

> **Status — 2026-07-09:** ✅ **Shipped in W3-A.** One exported `isTelegramLinked()` replaces the five spelled-out checks; `notifyChannel.js`'s web arm and both three-reader-contract comments stayed byte-identical.

**CL#3. "Is this Telegram session linked" predicate re-derived at 5 sites — HIGH**
(a) `telegramLinkState()?.linked === true` (or `!== true`) is spelled out in five modules; the
pattern the prompt warned about.
(b) `js/app.js:544`, `js/firstRun.js:61`, `js/firstRun.js:76`, `js/notifyChannel.js:34`,
`js/telegramSettings.js:16`.
(c) Export `isTelegramLinked()` from `js/telegram.js` (it already owns `_linkState`); all five
call it. In `notifyChannel.js` only the Telegram arm of `isLinked(prefs)` changes — the web arm
(`prefs?.telegram != null`) is part of the documented three-reader contract and stays.
(d) One predicate instead of five; prevents the linked-definition drifting per module.
(e) HIGH.

> **Status — 2026-07-09:** ✅ **Shipped in W3-A.** `showConfirmModal` gained an optional async `onConfirm` (busy label, inert cancel/overlay/Escape in-flight, inline error + stay-open); the unlink confirm rides it, and the bespoke `#tg-unlink-confirm` sheet + its permanent keydown listener were deleted.

**CL#4. `ensureUnlinkConfirmModal` hand-builds a confirm overlay the same branch already
abstracted as `showConfirmModal` — HIGH**
(a) The unlink confirmation injects a bespoke `.confirm-overlay/.confirm-sheet` with its own
overlay-tap/Escape/cancel wiring plus a permanent document-level keydown listener, while this
same branch shipped a reusable promise-based confirm (`showConfirmModal` + `#confirm-modal`
markup) for exactly this pattern.
(b) `js/telegramSettings.js:41-64` (+`doUnlink` at `:66-75`) vs `js/promptModal.js:61-93` and
`index.template.html:212-221`.
(c) Replace with `if (await showConfirmModal({ title: 'Unlink this Telegram?', message: …,
confirmLabel: 'Unlink' })) { … }`; on failure surface a toast (matching groupContext's converted
handlers). If keeping the confirm button busy during the RTT matters, add an optional async
`onConfirm` to `showConfirmModal` rather than a second modal implementation.
(d) ~35 lines removed, one fewer injected DOM tree, one fewer permanent document keydown
listener.
(e) HIGH.

> **Status — 2026-07-09:** ✅ **Shipped in W3-A.** One `buildTelegramShareUrl(url, text, {platform})` in `js/telegram.js` (caption-spacing folded in); `openTelegramShare` is a thin opener and `inviteFlow.js` re-exports it.

**CL#5. t.me share-intent URL construction and the "\n caption" spacing rule duplicated across
`telegram.js` and `inviteFlow.js` — MEDIUM-HIGH**
(a) The `https://t.me/share/url?url=…&text=…` template exists twice, and the
desktop-needs-a-newline-before-caption rule exists twice with subtly different conditions
(platform-aware in one, unconditional in the other).
(b) URL: `js/telegram.js:55` vs `js/inviteFlow.js:27` (`buildTelegramShareUrl`). Caption rule:
`js/telegram.js:54` vs `js/inviteFlow.js:44-46`.
(c) Import direction already runs `inviteFlow → telegram`, so move `buildTelegramShareUrl` (with
the caption-spacing rule folded in, taking a platform arg) into `telegram.js`;
`openTelegramShare` and `shareInviteToTelegramWeb` both call it; `inviteFlow` re-exports if
needed.
(d) ~8 lines, and the two spacing behaviors can't drift apart.
(e) HIGH it's duplication; MEDIUM the platform-conditional difference is intentional — preserve
it in the shared helper.

> **Status — 2026-07-09:** ✅ **Shipped in W3-B.** One internal `runModal` harness under `showTextPrompt`/`showConfirmModal`; `tests/promptModal.test.js` unchanged was the acceptance.

**CL#6. `showTextPrompt` / `showConfirmModal` duplicate their entire
promise/cleanup/overlay/Escape harness — MEDIUM**
(a) The two new modal functions in the same new file repeat identical
`cleanup`/`finish`/`onOverlay`/`onKey`/add-remove-listener scaffolding.
(b) `js/promptModal.js:32-56` vs `:74-93`.
(c) Extract a `modalPromise(overlay, { confirmBtn, cancelBtn, onConfirm })` internal helper;
each public function supplies its confirm semantics and cancel value.
(d) ~25 lines; future modal variants (e.g. CL#4's busy-confirm) get one place to grow.
(e) HIGH it's real; MEDIUM on worth (module is small and stable).

> **Status — 2026-07-09:** ✅ **Shipped in W3-B** (busy pair only, by decision). `showLinkScreen` now uses `setButtonBusy`/`clearButtonBusy` (with a scrub-on-open guard). The larger restore-screen open/teardown factoring was **rejected** — the divergent submit semantics are deliberate.

**CL#7. `showLinkScreen` hand-rolls the busy-button state that `setButtonBusy`/`clearButtonBusy`
were moved to utils (this branch) to share — MEDIUM**
(a) The link-account submit does manual `disabled = true; textContent = 'Linking…'` and manual
revert — exactly the helper this branch extracted from app.js into utils for reuse; it also
re-implements `showRestoreScreen`'s wiring shape (error show/hide, form preventDefault,
teardown) on the same DOM.
(b) `js/telegramSettings.js:94-95`, `:109-110`, `:114-115` vs `js/utils.js:8-18`; parallel
wiring in `js/app.js:292-390` (`showRestoreScreen`).
(c) Use `setButtonBusy(submit, 'Linking…')` / `clearButtonBusy(submit)`; optionally factor a
shared restore-screen open/teardown helper both callers parameterize.
(d) ~6 lines now; the shared restore-screen factoring would save ~20 more but is optional.
(e) HIGH for the busy pair; LOW for the bigger factoring (the divergent submit semantics are
deliberate).

> **Status — 2026-07-09:** ✅ **Shipped in W3-B.** One `startPersonalInviteFlow()` in `js/mycode.js` holds the invite-CTA surface fork; both callers collapse to it.

**CL#8. Surface-dispatch for the personal-invite CTA spelled twice — MEDIUM**
(a) `isTelegramContext() ? sharePersonalInvite() : openPersonalInviteModal()` is duplicated as
policy in two modules.
(b) `js/app.js:753` and `js/mycode.js:117`.
(c) Export one `startPersonalInviteFlow()` from `mycode.js` containing the ternary; both the
first-run `onInvite` and the drawer button call it.
(d) Tiny lines-wise, but it's a behavior fork: a future change to one CTA silently misses the
other.
(e) HIGH.

> **Status — 2026-07-09:** ✅ **Shipped in W3-B.** `telegramFirstName()` returns the trimmed, 40-capped name (`TG_NAME_CAP` beside the DB-rule comment); the three call sites drop their ad-hoc suffixes.

**CL#9. `telegramFirstName().slice(0, 40)` cap re-derived at 3 sites — MEDIUM**
(a) The 40-char label cap (mirroring the DB rule) is re-applied ad hoc, once without `.trim()`.
(b) `js/app.js:611`, `js/mycode.js:136`, `js/mycode.js:147`.
(c) Have `telegramFirstName()` in `js/telegram.js` return the trimmed, 40-capped value (or add
`telegramFirstNameCapped()`), with the 40 named alongside a pointer to the rules cap.
(d) Keeps the cap from drifting against `database.rules.json`/functions validation; 3 call sites
simplified.
(e) MEDIUM-HIGH.

> **Status — 2026-07-09:** ✅ **Shipped in W3-B.** `copyWithFeedback(btn, text, {done, idle})` in `js/utils.js` converges four sites; `initRecoveryPill` and the `copy-code-btn` share-code handler are the documented exclusions.

**CL#10. Copy-to-clipboard-with-"Copied!"-revert idiom at five sites, two touched/added by this
branch in the same file — MEDIUM**
(a) The `writeText → label swap → 1500ms revert` block recurs; this branch added a fifth
instance 20 lines below an existing one in the same function.
(b) New/moved: `js/inviteModal.js:194-201` (share fallback) vs `:173-179` (Copy);
`js/recoveryModal.js:66-74`. Pre-existing: `js/mycode.js:158-170`, `js/phraseReminder.js:19-23`.
(c) Add `copyWithFeedback(btn, text, { done = 'Copied!', idle })` to `js/utils.js`; at minimum,
dedupe the two blocks inside `inviteModal.js`.
(d) ~20 lines; one timeout/label convention.
(e) MEDIUM (pre-existing pattern; the branch grew it rather than introduced it).

> **Status — 2026-07-09:** ✅ **Shipped in W3-B.** `recoveryModal`'s two exit paths share one hoisted `teardown()`.

**CL#11. `recoveryModal` `onSaved`/`onCancel` duplicate the 5-listener teardown block —
LOW-MEDIUM**
(a) The two exit paths repeat identical `removeEventListener` sequences (cancel adds one extra
line).
(b) `js/recoveryModal.js:99-103` vs `:108-113`.
(c) Hoist a shared `teardown()` closure both call before hiding/resolving.
(d) ~8 lines; a future listener can't be forgotten on one path.
(e) HIGH it's real; LOW urgency.

> **Status — 2026-07-09:** ✅ **Shipped in W3-B.** One `shareCaption(scope, groupName)` in `js/inviteFlow.js` feeds every caller; per-function defaults dropped.

**CL#12. Share-caption strings spelled at four sites — LOW**
(a) `'Follow me on KnockKnock'` (×3, incl. two defaults) and
`` `Join ${groupName} on KnockKnock` `` (×2) are scattered.
(b) `js/inviteFlow.js:31`, `:40`; `js/inviteModal.js:129`, `:192`.
(c) One `shareCaption(scope, groupName)` in `inviteFlow.js`; drop the per-function defaults.
(d) Copy-drift-proofing only.
(e) MEDIUM real / LOW worth.

> **Status — 2026-07-09:** ✅ **Shipped in W3-B.** The landing-notice kind map collapsed to `stampGraduationNotice()`/`consumeGraduationNotice()`; the `kk-landing`/`graduated` storage key/value stayed unchanged.

**CL#13. Landing-notice machinery retains dead generality after the banner mechanism was
removed — LOW**
(a) `stampLanding(kind)`/`consumeLandingNotice()` keep a kind-keyed copy map with exactly one
surviving entry ('graduated'); the multi-kind indirection is the residue of the removed
post-link/post-unlink banners (the comments admit this).
(b) `js/firstRun.js:88-111`; sole producer `js/graduation.js:56` (`stampLanding('graduated')`);
sole consumer `js/app.js:757`.
(c) Either leave (documented) or collapse to stamp/consume of the copy string itself, deleting
`LANDING_COPY`.
(d) ~6 lines; removes a map that invites re-growing the removed banner mechanism.
(e) MEDIUM real / LOW worth.

No CRITICAL-side-findings. Notables that passed inspection: `watchUserPrefs` is attached once
with both `syncNotifyChannel` and `syncBotDelivery` doing proper change detection or idempotent
reconciliation; all new modal/interstitial flows (`promptModal`, `recoveryModal`,
`telegramFirstRun`, `showLinkScreen`) remove their listeners on every exit path;
`watchFollowerNames` unsubscribes before re-attach; `telegramChrome`'s MutationObserver is
debounced and memoizes the chrome color; injected singletons (`graduation` toast, unlink
confirm) are id-guarded against double wiring.

---

## §6. Agent report — Cloud Functions efficiency & redundancy (F#1–F#15)

FINDINGS (ranked)

> **Status — 2026-07-09:** ✅ **Shipped in W2** (+ §40). `expungeDerivedAccount` collapsed to parallel reads + one root `update()` (~35 → 3, now atomic); the §40 loose-ends pass added the shared `rootUpdate` overlap guard.

**F#1. `expungeDerivedAccount` issues ~2F+3T+2P+2G+9 sequential RTDB deletes that could be one
multi-path `update()`** — every write in the function is a `set(path, null)`, so after the reads
the whole cleanup can be a single atomic root-level `update('/', {path: null, ...})`.
- Sites: `functions/telegram-auth.js:188-230` (sequential awaited `deps.set(..., null)` loops at
  190-192, 194-196, 198-203, 205-209, 211-220, plus 8 more at 222-230); the per-group `ownerId`
  reads at 212 are also sequential N+1 — batch with `Promise.all` over `Object.keys(groups)`.
- Fix: accumulate `{[path]: null}` into one object; two read phases (existing `Promise.all` at
  180-186 + one `Promise.all` of ownerId reads), then one `deps.update('/', nulls)`.
- Payoff: for a modest account (5 followers, 5 following, 3 groups) ~35 sequential round-trips →
  3; also makes expunge atomic (no half-expunged state on crash). Runs on both
  `linkTelegramHandler` (148) and `unlinkTelegramHandler` (362). Confidence: HIGH.

> **Status — 2026-07-09:** ✅ **Shipped in W2** (+ §40). The graduation walker became one parallel read + one update (~60 → ~3, `moveNode` deleted); the §40 pass **closed the graduation split-brain window** by folding the mapping flip into that single atomic update.

**F#2. `graduateAccountData`'s walker is a chain of `moveNode` calls, each 3 sequential
round-trips (get, set, delete), all awaited in sequence** — ~3×(F + 3T + 2P + 2G + 6)
round-trips for a rename.
- Sites: `functions/telegram-auth.js:240-245` (moveNode), 277-283, 285-289, 292-298 (sequential
  `ownerId` read per group at 293), 301-303.
- Fix: all source paths are known up front from `own.followers`/`prefs.following`/`own.groups` —
  one `Promise.all` reading every backref/canvas/mailbox/ownerId, then a single multi-path
  `update('/', {...})` writing each new path and nulling each old one. The copy+delete pair
  inside moveNode is not atomic today; one update() also fixes that.
- Payoff: same-shaped account: ~60 sequential round-trips → ~3; graduation becomes near-atomic
  before the mapping flip. Confidence: HIGH.

> **Status — 2026-07-09:** ✅ **Shipped in W2.** The five N+1 loops (`matchGroupsByName`, `/who`, `/who <group>`, `/groups`, `/knock` roster reach) became `Promise.all`.

**F#3. Every list-shaped webhook command does N+1 sequential reads inside a for-loop** — worst
latency on the hot webhook path.
- Sites in `functions/telegram.js`:
  - `matchGroupsByName` 215-218: one awaited `groups/{gid}/name` per group (runs for `/status g`,
    `/off g`, `/who g`);
  - `handleWhoGroup` 287-293: one awaited `users/{mid}/presence` per co-member;
  - `/who` 333-338: one awaited presence per followed user;
  - `/groups` 362-365: two awaited reads (`name`, `statusOverride`) per group, sequential;
  - `knockGroupReach` 304-308: per-group `Promise.all` is good, but the outer group loop awaits
    sequentially.
- Fix: `Promise.all(ids.map(...))` in each; e.g. `/who` with 10 friends drops from ~12
  sequential round-trips to 3.
- Payoff: webhook reply latency roughly divided by roster size on the five commands users hit
  most. Confidence: HIGH.

> **Status — 2026-07-09:** ✅ **Shipped in W2.** `ensureTelegramUser` takes an optional pre-read mapping and returns the presence it read; `/start` stops double-reading and writes the chat route once.

**F#4. `/start` reads the same two paths twice and writes the chat route as two sequential
updates** — `telegramUsers/{tgId}` is read at telegram.js:107 and again inside
`ensureTelegramUser` (telegram-auth.js:69); `users/{uid}/presence` is read inside ensure
(telegram-auth.js:90) and again at telegram.js:119; then two sequential updates at
telegram.js:111-112.
- Fix: make `ensureTelegramUser` accept an optional pre-read mapping and return the presence it
  already loaded (it has both: it computes `created` from presence and mapping-existence is
  `known`); merge the two chatId updates into one
  `deps.update('/', {'telegramUsers/X/chatId':…, 'telegramByUid/Y/chatId':…})`.
- Payoff: /start drops from 6 RTDB round-trips to 3. Confidence: HIGH.

> **Status — 2026-07-09:** ✅ **Shipped in the §40 loose-ends pass** (skipped in W2). A command's single terminal reply now rides the webhook HTTP response (`{ method: 'sendMessage', … }`), one fewer round-trip. **Callbacks deliberately keep `tgApi`** (two calls whose text depends on the DB result); notifier sends and the welcome DM untouched.

**F#5. Whole webhook turn — DB reads, DB writes, and the Telegram
sendMessage/answerCallbackQuery HTTPS call — is awaited before the 200** (index.js:229-252
awaits `handleUpdate` fully). Combined with F#3, a `/who` over a real roster can approach
Telegram's retry window.
- Fix (safe in Cloud Functions, no post-response work needed): use Telegram's webhook-reply —
  respond to the webhook request itself with the JSON method payload
  (`res.json({method:'sendMessage', chat_id, text, ...})` /
  `{method:'answerCallbackQuery', ...}`) for the final message of each handler, eliminating one
  outbound `api.telegram.org` round-trip per update; for callbacks, at minimum fire
  `answerCallbackQuery` before the DB writes so the user's spinner stops immediately.
- Payoff: one full external HTTPS round-trip (typically the slowest await in the handler)
  removed per update; callback UX latency cut to one DB read. Confidence: MEDIUM (webhook-reply
  supports one method per update; multi-message flows still need tgApi).

> **Status — 2026-07-09:** ✅ **Shipped in W2.** `linkTelegramHandler` / `graduateTelegramHandler` / `ensureTelegramUser` create-path each collapsed to one atomic multi-path update; independent reads batched.

**F#6. Sequential ordered writes in link/graduate/ensure that should each be one atomic
multi-path `update()`** (`functions/telegram-auth.js`):
- `linkTelegramHandler` 159-165: 3 sequential writes (`telegramUsers`, `telegramByUid`, prefs) →
  1; plus the two independent reads at 137 and 140 (`presence`, `prior`) can be `Promise.all`
  (the relink branch 155-156 is 2 more batchable writes).
- `graduateTelegramHandler` 336-340: 5 sequential writes → 1 (atomicity here is strictly better
  than the comment's load-bearing ordering: mapping flip and old-subtree drop become
  all-or-nothing); reads at 320 and 328 are independent → `Promise.all`.
- `ensureTelegramUser` 72-78: 3 sequential writes on the create path → 1.
- Payoff: 3-5 round-trips saved per callable, and crash-window states eliminated. Confidence:
  HIGH.

> **Status — 2026-07-09:** ✅ **Shipped in W2.** `handleGroupStatus`/`handleGroupOff` merged into one `setGroupPresence` prefetching override + presence.

**F#7. `handleGroupStatus` and `handleGroupOff` are ~80% copy-paste** — same resolve → read
override → merge-or-explain skeleton (`functions/telegram.js:241-258` vs 260-279), including the
identical override/presence read pair and `globallyOn` computation.
- Fix: one `setGroupPresence(deps, uid, query, {status, availableUntil, messages}, reply)`
  helper; also `Promise.all` the override + presence reads (presence is needed in the else
  branch; with a tiny user base prefetching is the right latency trade).
- Payoff: ~30 lines deduped, 1 round-trip saved per group command. Confidence: HIGH.

> **Status — 2026-07-09:** ✅ **Shipped in W2.** One `makeDbDeps()` + one `tgSendMessage` in `index.js` replace the triplicated adapter boilerplate.

**F#8. RTDB adapter boilerplate defined three times in index.js** — `getVal/set/update/
transaction/now` appear in `makeDeps` (`functions/index.js:45-48`), `makeTelegramAuthDeps`
(185-199), and inline in `telegramWebhook` (236-244); the `sendMessage` lambda is duplicated
verbatim at 203 and 247.
- Fix: one `makeDbDeps()` returning the five adapters, spread into all three; one `tgSend` const
  shared by 203/247.
- Payoff: ~20 lines deduped, one place to change the adapter shape. Confidence: HIGH.

> **Status — 2026-07-09:** ✅ **Shipped in W2.** `pushTokens` folded into the channel `Promise.all` — started up front but only *awaited* on the FCM fall-through (review refinement, so a token-read blip can't abort a healthy Telegram send).

**F#9. notifier `sendToUser` now runs three sequential read phases when it falls through to
FCM** — the `Promise.all([notifyChannel, telegramByUid])` at `functions/notifier.js:28-31` is
followed by a separate sequential `pushTokens` read at 40, on every notification for every
push-channel user once the bot is configured.
- Fix: fold `userPrefs/{uid}/pushTokens` into the same `Promise.all` (costs one wasted read only
  when Telegram delivery succeeds — the right trade given latency > throughput).
- Payoff: 1 round-trip off every FCM notification. Confidence: MEDIUM.

> **Status — 2026-07-09:** ✅ **Shipped in W2.** `primaryAvailable(presence, now)` exported from `presence-core.js` and used at all four sites; `overrideAvailable` re-expressed via it.

**F#10. The "globally available now" predicate is re-inlined four times** —
`presence?.status === 'available' && isFutureMs(presence.availableUntil, deps.now())` at
`functions/telegram.js:120, 254, 275, 335`.
- Fix: export `primaryAvailable(presence, now)` from `functions/presence-core.js` (next to
  `effectiveAvailable`, which already encodes the same predicate as its fallback branch at
  presence-core.js:36) and use it at all four sites.
- Payoff: 4 sites → 1 definition; the availability rule can't drift between commands.
  Confidence: MEDIUM.

> **Status — 2026-07-09:** ✅ **Shipped in W2.** `clampName`/`LABEL_MAX` exported from `presence-core.js`; the local copy in `telegram.js` deleted.

**F#11. LABEL_MAX/clamp duplicated inside functions/** — `telegram.js:372-373`
(`LABEL_MAX = 40`, `clampName`) re-implements `presence-core.js:57-58` (`LABEL_MAX`,
`clampLabel`), a module telegram.js already imports from; only delta is a `.trim()`.
- Fix: export `clampLabel` (or a trimming variant) from presence-core.js and delete the local
  copy.
- Payoff: one cap constant; a future change to 40 can't half-apply. Confidence: MEDIUM.

> **Status — 2026-07-09:** ✅ **Shipped in W2.** The unreachable `handleCallback` `default` branch removed.

**F#12. Dead default branch in handleCallback** — `functions/telegram.js:395-396`: the
`CALLBACK_ARG_RE` gate at 382-383 already returns "Unknown action." for any action not in the
table, so every action reaching the `switch` has a case; the `default` is unreachable (and
duplicates the same string).
- Fix: delete the default (or replace with a `throw`/log if you want a tripwire for a
  table/switch drift).
- Payoff: 2 dead lines, removes a misleading "reachable" path. Confidence: HIGH.

> **Status — 2026-07-09:** ✅ **Shipped in W2.** A `resolveTelegramUid` helper serves the three webhook sender-resolve sites (pairs with F#4's pass-through into `ensureTelegramUser`).

**F#13. "Resolve Telegram sender → uid" block duplicated across entry points** —
`deps.getVal(\`telegramUsers/${...from.id}\`)` + not-mapped bail is written out in
`handleMessage` (`functions/telegram.js:130-135`), `handleCallback` (378-380), and again in
`/start` (107); `ensureTelegramUser` does the same read a fourth way (telegram-auth.js:69).
- Fix: `resolveTelegramUid(deps, tgId)` helper returning `{mapping, uid}` used by all three
  webhook sites (pairs with F#4's pass-through into ensure).
- Payoff: ~8 lines deduped; single seam if the mapping shape grows. Confidence: MEDIUM.

> **Status — 2026-07-09:** ✅ **Shipped in W2.** The invite-accept join is one multi-path `update()` (member value, groups entry, two pending nulls) — atomic.

**F#14. `handleInboxCallback` invite-accept join writes are three sequential writes** —
`functions/telegram.js:422-429`: member node `set`, `users/{me}/groups/{gid}` `set`, then
`clearPending()` (itself a `Promise.all` of two deletes) awaited in sequence.
- Fix: one multi-path `update('/', {...4 paths})` (member value, groups entry, two pending
  nulls) — also atomic, so a crash can't leave a member without the pending-invite cleared.
- Payoff: 3 write round-trips → 1 on the invite-accept callback. Confidence: HIGH.

> **Status — 2026-07-09:** ✅ **Shipped in W2.** `GROUP_ID_RE`/`UID_RE` hoisted to `functions/telegram-shared.js` — one copy inside `functions/`.

**F#15. UID/GID format regexes re-declared against the client** — `GROUP_ID_RE`/`UID_RE` at
`functions/telegram.js:13,18` restate formats owned by `js/identity.js` / client
`generateGroupId` / `database.rules.json` (the comments themselves track three
cross-references). The gating is intentional; the *duplication* is the cost — functions/ is a
separate package so a direct import is awkward.
- Fix: at minimum hoist both to `functions/telegram-shared.js` (telegram-auth.js:38
  independently hard-codes the 32-hex truncation that UID_RE checks) so functions/ has one copy.
- Payoff: one definition inside functions/; drift risk halved. Confidence: LOW.

No CRITICAL-SIDE-FINDINGS: the one near-miss checked — `moveNode`'s non-atomic copy-then-delete
during graduation — is re-run-safe given the mapping flips last (and is fixed for free by F#2).
