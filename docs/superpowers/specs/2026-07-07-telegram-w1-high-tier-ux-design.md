# Wave W1: HIGH-tier UX fixes — design

**Date:** 2026-07-07
**Source:** `docs/superpowers/2026-07-07-telegram-feature-analysis.md` — the seven §1.1 HIGH-tier
findings plus the three invite-gate MEDIUMs that live in the same code (J#4, J#5, J#6; operator
scope decision). Cross-reference IDs (J#/C#/B#) refer to that document.
**Branch:** `claude/telegram-app-adaptation-t1r1jp` (this session). Wave W2 (functions
efficiency) runs in a PARALLEL session on its own branch and also touches
`functions/telegram.js`/`functions/notifier.js` — W1 changes there must stay strictly scoped to
the behaviors below so the maintainer's merge is tractable.

## Decisions log (operator-approved)

1. **J#3 policy:** server delivery fallback + client refusal. The client does NOT write a
   `push` channel it can't honor (no toggle flip); the server never lets a token-less push
   account go silent. (Fail-closed: a failure costs availability of the *preferred* channel,
   never delivery itself.)
2. **B#1 shape:** rewrite + strip. One-shot decision messages are edited in place to the
   resolved outcome and lose their keyboard; handlers are state-checked so late/duplicate taps
   answer honestly. Knock keyboards stay live (repeatable by design).
3. **Scope:** the 7 HIGHs + the invite-gate cluster (J#4, J#5, J#6). Ten findings, one spec.
   All other analysis findings stay in waves W2–W4.

## S1 — Invite-gate hardening (J#1, J#4, J#5, J#6)

**Files:** `js/telegramFirstRun.js`, `js/invites.js` (+ `js/app.js` boot call sites,
`js/cacheOwner.js` consumers as-is).

### Error vs invalid (J#1)

`resolveInvitePreview` stops conflating outcomes. New contract:

- **Resolved preview** → returns the preview object (unchanged shape).
- **Invalid/expired/revoked token** → returns `null` (the callable succeeded and said no).
- **Transport/server error** → retries once internally, then **throws**.

Callers must not blanket-catch back into `null`. The Telegram gate maps the three outcomes:

- Preview → interstitial (existing behavior, plus S1 stamping rules below).
- `null` (invalid) → one-line toast **"That invite link has expired."** — no interstitial, but
  no more total silence.
- Throw (error) → the invite-failure overlay (reuse the web overlay pattern/copy) with a
  **"Try again"** button that re-runs the gate; dismissing it proceeds to a normal boot.

The web `?i=` path keeps its existing overlay behavior; if it currently relies on
`resolveInvitePreview` returning `null` on error, its call site is updated to catch and route to
its overlay — behavior preserved, sourced from the new contract.

### Token stamping (J#4, J#5)

A small module-level helper in `js/telegramFirstRun.js` records invite-token outcomes in
**account-stamped localStorage** (same `cacheOwner` discipline as other cached state):
`kk-invite-token-outcomes` = `{ [token]: 'redeemed' | 'dismissed' }`, pruned to the last few
tokens.

- **Redeemed** is stamped on interstitial Accept success AND on the linked silent-redeem path.
  A re-tapped chat link with a stamped-redeemed token shows nothing (J#4). Belt-and-braces: if
  the preview's target is already followed / already a member, skip the interstitial and stamp
  `redeemed` (covers cleared storage).
- **Dismissed** is stamped on "Not now". A dismissed token never auto-redeems — including the
  J#5 path (user later links an account, reload re-runs the gate with `start_param` still in
  initData: the gate sees the stamp and skips). A *fresh* invite token from the same person is a
  different token and shows normally.

### Phrase-cancel loop (J#6)

The interstitial's "I have a secret phrase" choice awaits `showLinkScreen()`:

- Link **succeeds** → reload (existing behavior); the token survives in initData and follows the
  linked-redeem rules (which now honor dismissal stamps).
- Link **cancelled** → re-show the interstitial with the invite intact (mirror of the web
  welcome↔restore loop, `js/app.js:199-215`). "Not now" remains the only way to decline.

## S2 — Boot-failure retry (J#2)

**File:** `js/app.js` (Telegram boot catch only; web boot untouched).

Replace the passive "Couldn't start KnockKnock…" toast + dead rethrow with a minimal error
surface using the existing overlay pattern: copy **"Couldn't start KnockKnock."** and a
**"Try again"** button → `location.reload()` (boot is idempotent server-side —
`ensureTelegramIdentity` is an upsert). The error is still logged/rethrown for the console. No
new DOM subsystem: the same overlay style S1's failure state uses.

## S3 — Channel-switch safety (J#3)

**Files:** `js/notifyChannel.js`, `functions/notifier.js`, `functions/telegram.js`.

- **Client (pill):** on a tap selecting `push` **in Telegram context** with no `pushTokens` in
  the last-seen prefs (`lastPrefs`), show toast **"Push isn't set up on any device yet — open
  KnockKnock in a browser first. Messages keep arriving via Telegram."** and do **not** call
  `mergeUserPrefs`; the pill stays on Telegram (no optimistic flip). The web pill is unchanged —
  its switch already runs the permission flow that mints a token.
- **Server (`sendToUser`):** delivery-level fallback — when `channel === 'push'` but the account
  is linked (`telegramByUid` mapping exists) and has **zero** push tokens, route to the bot
  instead of returning false. This is a *delivery* decision: the three-reader channel-default
  contract ("missing = telegram on a linked account") is untouched; the cross-reference comments
  in all three readers gain a line noting the token-less-push fallback lives ONLY in the
  notifier.
- **Bot channel command:** switching to push with zero tokens is refused with the same
  explanation ("Push isn't set up on any device yet — open KnockKnock in a browser first.
  You'll keep getting messages here."), mirroring the pill.

Suppression interplay: because the pill refuses rather than writes, `botDelivered` stays true
and web nudge suppression stays consistent; `js/notifySuppression.js` changes by comment only
(the cross-reference line above).

## S4 — Honest bot callbacks (B#1, B#9, B#2)

**Files:** `functions/telegram.js`, `functions/index.js` (tg deps), `functions/telegram-shared.js`
if keyboard helpers move.

- **Deps:** the webhook `tg` deps gain `editMessageText` (with `reply_markup` support; covers
  strip-keyboard via empty markup). `answerCallbackQuery` stays for transient feedback.
- **One-shot callbacks** (`invite_accept`, `invite_decline`, `fr_approve`, `fr_decline`) become
  state-checked and self-recording:
  1. Read current state first (pending invite exists? follow request exists? already
     following/member?).
  2. **Already handled** (in the app, or by a prior tap): answer **"Already handled."**, edit
     the message to the known outcome if determinable (else append "— handled"), strip the
     keyboard, write nothing.
  3. **Success:** perform the writes (unchanged shapes), then edit the message text to the
     outcome — **"✅ Joined ⟨name⟩."**, **"Invite declined."**, **"Follow request from ⟨name⟩ —
     approved."** / **"— declined."** — and strip the keyboard. The toast remains garnish.
  4. Edit failures (deleted message, >48h edit window) are caught and ignored — the action
     already succeeded; the toast still fired.
- **Knock honesty (B#2):** `writeKnock` returns the transaction's `committed` flag. The `knock`
  callback and both `/knock` reply paths answer **"You've already knocked a few times — give
  them a moment."** when the 5-cap aborts the write; "Knock sent." / "Knocked on ⟨label⟩." only
  on a committed write. Knock/availability keyboards are **not** stripped — knock-back is
  legitimately repeatable up to the cap.

## S5 — Back-button coverage (C#1)

**File:** `js/telegramChrome.js`.

`resolveBackAction`'s checklist gains the branch's own overlays **at the top**, before every
existing entry: `#confirm-modal`, `#text-prompt-modal`, `#tg-unlink-confirm`,
`#graduation-info-toast`. Back dismisses the top-most visible one with **cancel semantics**
(same code path as its Cancel button / backdrop tap — resolve false / dismiss, never confirm).
Only then do the existing drawer/modal/navigation entries apply.

## S6 — Unlink feedback (J#7, C#2)

**File:** `js/telegramSettings.js`.

`doUnlink` uses the shared `setButtonBusy(btn, 'Unlinking…')` / `clearButtonBusy(btn)` from
`js/utils.js`; on failure it clears busy and shows an inline error line inside the existing
confirm sheet: **"Couldn't unlink right now. Try again."** (same pattern as the link screen's
inline error). The sheet stays open so the user can retry or cancel. The CL#4 consolidation onto
`showConfirmModal` is deliberately **out of scope** (wave W3) — this is the minimal UX fix.

## Copy inventory (new/changed strings)

| Where | String |
|---|---|
| S1 invalid invite (toast) | That invite link has expired. |
| S1/S2 failure overlay button | Try again |
| S2 boot failure (overlay) | Couldn't start KnockKnock. |
| S3 pill refusal (toast) | Push isn't set up on any device yet — open KnockKnock in a browser first. Messages keep arriving via Telegram. |
| S3 bot command refusal | Push isn't set up on any device yet — open KnockKnock in a browser first. You'll keep getting messages here. |
| S4 knock cap | You've already knocked a few times — give them a moment. |
| S4 resolved messages | ✅ Joined ⟨name⟩. / Invite declined. / Follow request from ⟨name⟩ — approved. / — declined. |
| S4 late tap | Already handled. |
| S6 unlink failure (inline) | Couldn't unlink right now. Try again. |

All strings use the branch's majority voice: contraction form, straight apostrophes, "Try
again." (C#9 is a W4 sweep; new W1 strings simply conform now).

## Testing

TDD throughout (red before green). New/extended jest coverage:

- **Web** (`tests/telegramFirstRun.test.js`, `tests/notifyChannel.test.js`,
  `tests/telegramChrome.test.js`, `tests/telegramSettings.test.js`, invites tests): gate
  outcome mapping (preview/invalid/error), retry button, token stamping across
  redeem/dismiss/re-tap/linked-reload, phrase-cancel loop, pill refusal (no write, no flip,
  toast), back-button dismissal order + cancel semantics, unlink busy/error path.
- **Functions** (`functions/test/telegram.test.js`, `functions/test/notifier.test.js`):
  state-checked callbacks (fresh, already-handled, cross-path), message edit + keyboard strip
  calls, edit-failure tolerance, `writeKnock` committed propagation to all three reply sites,
  notifier token-less-push fallback (linked → bot; unlinked → unchanged false), bot channel
  command refusal.
- Async mocks return promises (HANDOFF §35 test-hygiene note).

Green suites are necessary, not sufficient: **acceptance is the operator's on-device
walkthrough** (Telegram webview + web), per the manual-visual-gate convention.

## Out of scope

Everything else in the analysis: W2 (functions efficiency — parallel session, own branch; do
not "fix in passing" any F# finding here), W3 (client consolidation, incl. CL#4), W4
(copy/CSS/bot-delight sweeps). Also out: FCM-side dead-token self-heal, web-pill permission
edge cases (pre-existing), issue #283.
