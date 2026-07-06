# Telegram Onboarding & UX Polish — Design Spec

**Date:** 2026-07-05
**Status:** Approved (brainstorming session)
**Branch:** `claude/telegram-onboarding-ux-sk15hw` (cut from `claude/telegram-app-adaptation-t1r1jp` tip `2abb56b`)
**Builds on:** `docs/superpowers/specs/2026-07-02-telegram-adaptation-design.md` (the Telegram adaptation), HANDOFF §21 (web onboarding/install redesign), §24–§25 (implementation + testing rundowns).

## Summary

The Telegram adaptation is feature-complete and smoke-tested, but the first-run
experience is unshaped: the bot dumps its full command list on strangers, and a
brand-new Mini App user lands in an empty app with no guidance. This spec designs
the onramp and a UX-polish pass.

**Personas, in priority order:**
1. **Invited person** — an existing user shares an invite inside Telegram; the
   recipient's first contact with KnockKnock is that invite.
2. **Existing web user** — has a phrase account; their onramp is "link, don't
   duplicate".
3. **Cold arrival** — finds the bot with no invite; lands truly empty.

**Architecture (approach B, approved):** dedicated modules with thin boot hooks,
mirroring the §21 `installGuidance`/`installAffordance` pattern — not more
branches in `js/app.js`, not onboarding concerns leaking into `following.js`.

New/changed modules:

| Module | Role |
|---|---|
| `js/firstRun.js` (new) | Surface-agnostic guided empty state + one-time landing banners (post-link / post-unlink / post-graduation). Used by web AND Telegram. |
| `js/telegramFirstRun.js` (new) | Invite interstitial, `start_param` extraction/redemption routing. TG-only. |
| `js/inviteFlow.js` (new) | The single invite entry point: link construction (incl. `t.me` deep links) + per-surface share presentation. |
| `js/telegramChrome.js` (new) | Back button, vertical-swipe disable, closing confirmation, chrome color re-sync (absorbs `initTelegramChrome`). |
| `js/telegramSettings.js` (split) | Link/unlink → drawer Account section; channel toggle → drawer Notifications section. |
| Recovery modal (moved out of `app.js`) | `showRecoveryCodeModal` becomes a shared module with per-context knobs (intro, warning, cancel). |
| `functions/telegram.js` | `/start` branches stranger vs returning. |
| `functions/telegram-auth.js` | `unlinkTelegram` resets `notifyChannel`; `graduateTelegram` (follow-on) + shared account-walker refactor. |

Two embedded decisions:
- **Auto-create-at-boot stays.** The interstitial shows *after* auth; a momentary
  derived account is idempotent and expunge-safe. No forked `validateTelegram`
  semantics.
- **Invites redeem client-side** via the existing `attemptRedeemFromUrl` path,
  token read from signed `start_param` (survives reloads, tamper-proof).

Copy marked **[approved]** is final wording; everything else is draft — shape is
the design, words may be tuned at implementation.

## 1. Telegram-native invite links + first-run interstitial

### Deep link

- Invites shared from inside Telegram use
  `https://t.me/<bot>/<app>?startapp=<token>` instead of the web URL.
- Fits verified: invite tokens are 22 base64url chars (`js/invites.js`);
  `startapp` accepts ≤64 chars of exactly that alphabet. The token arrives inside
  the **signed** `initData` as `start_param` — reload-proof and tamper-proof.
- The client learns the `t.me` prefix via a new build-time substitution
  **`__TELEGRAM_APP_LINK__`** (from `TELEGRAM_APP_LINK` in `.env.local` /
  `.env.production`), same pattern as `__INVITE_PREVIEW_URL__`. Empty/unset →
  share falls back to the web URL (today's behavior). Applies to personal AND
  group invites — tokens are tokens; the interstitial already gets scope from
  `resolveInvitePreview`.
- Web-created invites unchanged (same tokens, same records; only the URL wrapper
  differs per surface).

### Arrival flow (`js/telegramFirstRun.js`)

Boot auths as today; before the main UI is revealed:

| Boot state | Behavior |
|---|---|
| Unlinked derived account + valid `start_param` token | **Interstitial** (below). |
| Linked account + token | No interstitial; silent redeem + toast ("You're now following Ana"). |
| Token invalid / expired / revoked (preview null) | No interstitial; normal first-run (§3 empty state catches them). |
| Token re-tap / already following | Redeem no-ops; nothing shown. |

**Interstitial** (TG-only, new markup styled like the restore screen — NOT the
phrase-flavored `#welcome-screen`):
- Inviter framing via the existing unauthenticated `resolveInvitePreview`
  callable: "**Ana** invited you to follow them" / group variant.
- One line of what-KnockKnock-is.
- **[Accept & get started]** → `attemptRedeemFromUrl` → app opens with the
  contact present.
- **[I have a secret phrase]** [approved] (matches the drawer's existing link
  button wording) → existing link screen → `linkTelegram` →
  reload → boot re-sees `start_param`, account now linked → silent redeem +
  toast. No second interstitial.
- Quiet "Not now" dismiss → proceed without redeeming.

## 2. Bot first contact

`/start` branches on whether `telegramUsers/{tgId}` exists — checked **before**
`ensureTelegramUser` (which stays: idempotent, and still stores `chatId` for
notification routing).

- **Stranger (no mapping)** — three short lines + button, no command list (draft):
  > Welcome to KnockKnock — see when the people who matter are free, and let
  > them know when you are.
  > Everything starts in the app:
  > **[Open KnockKnock]**
  > Once you're set up, you can also knock and set your status right from this
  > chat — /help shows how.
- **Returning (mapping exists)** — compact live reply: current status ("You're
  available until 15:00" / "You're unavailable right now") + Open button. No
  re-welcome, no command dump.
- **`/help`** — full command list, unchanged.
- The pre-mapping guard for other commands ("First, open the app once so I know
  who you are" + Open button) stays as-is. It fires when the first-ever
  interaction is a typed command, or after an unlink removed the mapping. The
  bot cannot distinguish those two cases (no mapping is no mapping), so one
  message serves both.
- The `/start` teaser line **replaces** any first-notification "commands exist"
  nudge — no additional machinery.
- **First-open welcome DM (added 2026-07-05, on-device feedback).** An invited
  user can accept via a `t.me/…?startapp=` deep link and live entirely in the
  Mini App without ever opening the bot chat — so they have no persistent
  re-entry point (Menu Button / bot chat) until a notification happens to arrive.
  `validateTelegramHandler` now sends the **same** `WELCOME_STRANGER_TEXT` + Open
  button as a one-time DM when it *creates* the account (`created === true`),
  giving them a bot chat immediately. It fires only on the Mini-App-first path:
  a `/start`-first user already has the account bootstrapped, so `created` is
  false and they get no duplicate. Non-fatal if the DM can't send. (Opening the
  bot's Mini App grants the bot PM write access, so no `/start` or
  `requestWriteAccess()` is needed for delivery.)
- **Operator step** (added to `docs/telegram-setup.md`): set the BotFather
  *short description* + *description* with matching copy — the bot profile is
  the true first impression and the runbook currently leaves it unset.

## 3. Guided empty state (Telegram + web)

**Ownership.** `js/firstRun.js` owns the empty-state DOM; `following.js`'s
existing `isEmpty` branch only signals show/hide (mirroring the hint-engine
ownership pattern). The never-populated `#empty-list-msg` `<p>` is retired.
Direct context only. Self-dismisses when the first contact renders.
**Not** gated on `isNew` — an account emptied by unlink sees it too (half of the
§5 post-unlink story).

**Content** (copy draft; structure is the design):
- Two quiet lines: "KnockKnock shows your people when you're free — and shows
  you when they are." / "No one's here yet."
- **Primary: Invite your people** → `inviteFlow` (§4). TG: share sheet with the
  deep link; web: existing invite modal.
- **Secondary:** the existing Add-a-person button/form, unchanged in behavior,
  ids, and position — while the empty state is mounted it gets a demoted visual
  (ghost styling, label "Add by code") so it reads as the "my friend already
  gave me their code" alternative. Presentation-only, driven by a class from
  `firstRun.js`; reverts to normal standalone styling when the empty state
  unmounts. No changes to form logic, validation, or the `has-list` toggle.
- **TG-only, unlinked accounts:** tertiary line "Already use KnockKnock? Link
  your account" → opens the link screen directly. (Web sessions already chose
  new-vs-restore at the welcome screen.)

**Install-toast coordination (web).** One teaching surface at a time: while the
empty state is visible, the install **toast** lead-in is deferred —
`firstRun.js` exposes `isFirstRunActive()`, consulted by `installAffordance`.
The quiet corner **icon** stays allowed (in-flow, non-modal). Toast eligibility
resumes untouched once a contact exists. Rationale: a zero-contact user gains
nothing from installing yet; inviting is that screen's single job.

**FTU hints:** no interaction, no engine changes — longpress/swipe rotation
needs contact cards (none exist); header hints (swatch wave, dot) coexist fine.

**Invited arrivals who accept never see the empty state** — web invite links
and TG `start_param` invites both redeem before the first list render. An
interstitial "Not now" dismisser lands in the empty state like any cold
arrival.

## 4. Unified invite flow + drawer regroup

### `js/inviteFlow.js`

Two deliberately separated layers (making future surface changes cheap):
1. **Link construction:** pure `buildTelegramInviteLink(token)` driven by
   `__TELEGRAM_APP_LINK__`. A plain template substitution — available to web
   builds too.
2. **Surface presentation:** `shareInvite(invite)` — TG: share sheet with the
   deep link (fallback web URL when unconfigured); web: existing invite modal
   presentation.

Callers: empty-state primary button, drawer Invite section, and
`inviteModal.js`'s share affordance (stops hardcoding the web URL). Group
invites shared from group context get the deep link for free.

**Built (follow-on):** the *web* invite modal now surfaces a "Share to
Telegram" affordance — the manage-state share button (`#invite-modal-share-btn`)
un-gates from Telegram-only to `isTelegramContext() || telegramSharingEnabled()`.
On web it opens the `t.me/share/url` intent in a new tab carrying the
`buildTelegramInviteLink` deep link (falling back to copying that link when the
popup is blocked). `telegramSharingEnabled()` renders it only when
`__TELEGRAM_APP_LINK__` is non-empty and `TELEGRAM_ENABLED` is true (pre-launch
`main` would otherwise emit links to a not-yet-live bot).

### Drawer regroup (`#code-drawer`)

Markup regroup only — no interaction redesign. Three labeled sections:

1. **Invite** — primary "Invite your people" button (→ `inviteFlow`), then the
   existing share-code row (code display / rotate / copy) reframed as the "or
   share your code" alternative, keeping its hint.
2. **Account** —
   - Web: recovery-phrase pill row, unchanged.
   - TG unlinked: link-state line + "I have a secret phrase" +
     **"I also want to use the app outside of Telegram"** [approved] (secondary
     styling — the graduation entry point, §7).
   - TG linked: linked-state line + "Unlink" (with §5 confirm).
3. **Notifications** — TG: channel toggle chip moves here. Web: no content
   today → section doesn't render. (This is the future home of web-side link
   visibility — see Known gaps.)

**Module boundaries:** `telegramSettings.js` splits along these seams; sections
are mounted by the drawer, not self-appending. The header "Share code" chip
keeps its current behavior (opens the drawer) — no per-surface fork.

## 5. Link/unlink confirmation + landings

- **Unlink confirmation** (today it fires on first tap): tapping Unlink expands
  an inline confirm block in the Account section — same expand pattern as the
  add-person form, no new modal. Consequences copy (draft): "Your account stays
  yours — sign in with your secret phrase in any browser. This Telegram will
  start over with a fresh, empty account." Destructive-styled confirm + Cancel.
  The link screen's existing warning + explicit button are unchanged.
- **Server hygiene (verified already present):** `unlinkTelegram` already
  resets the unlinked phrase account's prefs to
  `{ telegram: null, notifyChannel: 'push' }`
  (`functions/telegram-auth.js:223`). No new work — the existing behavior is
  pinned by tests and relied on by the §4 Notifications section.
- **Landings — one mechanism, two messages.** Link and unlink both end in
  `location.reload()`, and the uid change makes `cacheOwner` wipe
  account-scoped localStorage. The handoff marker is therefore a
  **sessionStorage** key `kk-landing ∈ {linked, unlinked, graduated}` written
  just before reload, read-and-cleared at boot by `firstRun.js`.
  **Deliberately NOT account-scoped and NOT in the cacheOwner wipe list** — it
  is a transient cross-account handoff marker; do not "fix" it into the wipe
  list. If the webview drops sessionStorage across reload, the banner silently
  doesn't show (acceptable degradation).
  - Post-link banner (dismissible, over the populated list): "Linked — this
    Telegram now opens your KnockKnock account." A pending `start_param`
    invite's silent-redeem toast follows.
  - Post-unlink banner (same slot, above the guided empty state — designed as a
    pair): "Telegram unlinked. Your account is still yours — sign in with your
    secret phrase in a browser. This is a fresh Telegram-only account."

## 6. Telegram chrome integration (`js/telegramChrome.js`)

Absorbs `initTelegramChrome()`. Everything version-guarded
(`isVersionAtLeast`), no-op outside Telegram. Haptics explicitly out of scope.

- **Vertical swipes:** `disableVerticalSwipes()` globally at boot (Bot API
  ≥7.7; older clients keep current behavior). Scoped-to-canvas rejected: list
  overscroll also triggers collapse, and the header remains the platform-normal
  minimize affordance.
- **Back button:** one pure `resolveBackAction()` — ordered checklist over
  existing close functions: link/restore screen → cancel; inbox / invite /
  create-group modal → close; card drawer → `closeCardDrawer()`; add-person
  form → collapse; notify popover → dismiss; group context → back to Direct;
  else `null`. Chrome shows Telegram's BackButton iff the resolver returns an
  action (detection via the debounced MutationObserver pattern proven by the
  hint engine's pause logic — no per-module registration API). **Hidden during
  an active call** — accidental hangup is worse than no back button; leaving a
  call stays an explicit in-app action.
- **Closing confirmation:** `enableClosingConfirmation()` while a call is
  active or ringing, disabled otherwise — driven by the same call-state signals
  the hint engine consumes (`getCallModeCalleeId` / incoming-call state).
- **Chrome color re-sync:** header/background sync moves from boot-once to
  firing on `--bg` changes. Prefer hooking the theme-var write choke point if a
  single one exists; else a small observer on `documentElement`'s style
  attribute. Covers palette changes, the cache-wipe theme reset (`1de4b4e`),
  and group overrides.

## 7. Graduation — "use the app outside Telegram" (designed now, implemented as the first follow-on)

Gives an unlinked Telegram-derived account a secret phrase, making it a
first-class phrase account usable in any browser. **Design locked here;
implementation is the next session's project.** This session lands the
enablers only: the recovery modal's move out of `app.js` with its per-context
knobs, and the Account section's layout. The graduation button itself ships
with the follow-on (no dead buttons); nothing this session builds may
contradict this design.

**Chosen mechanism — migration, not indirection.** `uid = sha256(phrase)` is
load-bearing on both sides (`functions/auth.js deriveUid`; client local
derivation in `js/auth.js` / `js/app.js`). A phrase→uid indirection table was
rejected: it breaks that invariant permanently, everywhere. Instead graduation
**moves** the account to the phrase-derived uid. This is a rename, not a merge
— the "no merge" product boundary stays uncrossed. End state is exactly
"linked": web sign-in just works; unlink then behaves identically to any linked
account (phrase account survives; next Mini App open bootstraps a fresh derived
account).

**UI** — reuses the existing recovery modal (`#recovery-modal` +
`showRecoveryCodeModal`), which already has the phrase display, ↻ regen, Copy,
the hidden iCloud-Keychain credential form, and the confirm-with-busy-state
`onConfirm` hook. It moves out of `app.js` into a shared module and gains three
per-context knobs (web signup renders byte-identical to today):
1. **Intro line** [approved]: "To use the app outside Telegram you get a secret
   phrase — it opens this same account in any browser."
2. **Warning text** [approved, graduation variant]: "Save this somewhere safe.
   It's how you sign in outside Telegram, and the only way to restore your
   account if you lose access to Telegram. We can't recover it for you."
   (Web default stays the current "…if you lose this browser…" text.)
3. **Cancel button** — shown only when invoked cancellably (graduation);
   the web signup flow remains mandatory, no cancel.

Entry point: Account section, **"I also want to use the app outside of
Telegram"** [approved]. `onConfirm` = `graduateTelegram(initData, rc)`;
on target-uid-collision error the modal stays up with the error and ↻ regen is
the retry (each regen = new candidate uid; nothing happens server-side until
confirm). After success: `kk-landing = graduated` → reload → banner (draft):
"This account now works in any browser too."

> **⚠️ Revisit before building (2026-07-05, on-device feedback):** the post-link
> and post-unlink landing banners this reused were **removed** — the
> `landing-notice` inline-toast is a **bespoke pattern used nowhere else** in the
> app and read as unnecessary. Do **not** reach for it for the graduation
> landing without reconsidering. The `showLandingNotice`/`stampLanding`
> mechanism + the `graduated` copy still exist as the sole caller-less enabler,
> but the standing preference is to **reuse an existing pattern** (e.g. the
> shared toast/confirm surfaces already used elsewhere) rather than keep this
> one-off. Decide graduation's success feedback at build time; if this mechanism
> isn't chosen, delete it.

The phrase is never stored
server-side (uid IS its hash) — the reveal ceremony is the only time it exists;
the recovery pill stays hidden in TG after graduation, same as linked accounts.

**Server** — new callable `graduateTelegram({ initData, code })`:
- Verify `initData`; require an **unlinked** mapping (mapping uid == derived
  uid); `newUid = deriveUid(code)`; require target account non-existent.
- Gated by the same rate limiter as `validateRecovery`.
- Refactor `expungeDerivedAccount`'s enumeration into a shared **account
  walker** with two actions — *delete* (expunge, as today) and *rewrite
  old→new* (graduation) — covering: own subtree, follower/following backrefs,
  canvases, group memberships, owned groups, invite records + index,
  share-code index, `telegramUsers`/`telegramByUid`.
- **Write ordering is load-bearing:** copy subtree → rewrite refs → repoint
  `telegramUsers`/`telegramByUid` → delete old subtree. A crash mid-sequence
  leaves the old account authoritative until the repoint; re-running heals.
- `notifyChannel` untouched (stays `telegram`); `linkedAt` set — the account is
  now "linked".

## 8. Config, data model, testing

**Config / build:**
- New `TELEGRAM_APP_LINK` env → `__TELEGRAM_APP_LINK__` substitution (dev value
  = the test bot's Mini App link; sandbox builds emit empty → graceful
  fallback).
- BotFather short/full description steps → `docs/telegram-setup.md`.
- **No new RTDB nodes, no rules changes, in any part of this session**
  (`start_param` rides signed initData; graduation only moves existing data).

**Server deltas:** `/start` branching; synthetic Auth identifier at bootstrap
(below); `graduateTelegram` + walker refactor (follow-on). (`unlinkTelegram`'s
`notifyChannel: 'push'` reset already exists — no delta.)

**Synthetic Auth identifier (console differentiation).** Telegram-derived and
phrase accounts are indistinguishable in Firebase console → Authentication →
Users (both are custom-token users: blank Identifier, bare 32-hex uid). At
first derived-account bootstrap (`ensureTelegramUser` creation path), the
server also stamps the Auth user record with an **anonymous synthetic email**
derived from the app uid — e.g. `tg-<uid>@telegram.invalid` — so derived
accounts are identifiable at a glance in the console's Identifier column.
Deliberately anonymous: it carries **no Telegram identifiers** (neither the
user handle nor the numeric tgId — the uid is already the row's own key, so
the marker adds zero new information to Auth records). No cleanup pass needed:
expunge leaves Auth records in place, and a derived uid slot is *permanently*
the Telegram-derived slot for that identity, so the marker stays truthful
across link/unlink/graduation cycles (a graduated account's new phrase-uid
record is created unmarked, correctly reading as a phrase account).
Implementation note: the record may not exist before the client's first
`signInWithCustomToken`, so this is a create-or-update Admin SDK call, injected
via deps like everything else in `telegram-auth.js`.

**Testing:**
- Web Jest: `firstRun` (empty-state lifecycle, landing banners from
  `kk-landing`, install-toast deferral predicate, add-button demotion class);
  `telegramFirstRun` branch matrix (unlinked+token / linked+token / invalid /
  none; redeem routing; interstitial actions); `inviteFlow`
  (`buildTelegramInviteLink`, fallback on empty substitution, per-surface
  routing); `telegramChrome` (`resolveBackAction` pure tests, version guards,
  call-state closing-confirmation transitions); drawer sections mount per
  surface; recovery-modal knobs (web signup byte-identical, graduation variant
  renders intro/warning/cancel).
- Functions Jest: `/start` stranger-vs-returning; bootstrap stamps the
  synthetic Auth email (and only on creation); unlink notifyChannel reset
  stays pinned; (follow-on: graduation — walker rewrite vs delete parity with expunge, write
  ordering, collision/linked-mapping rejections, rate limiting).
- Rules suite: unchanged.
- **A9 on-device checklist** added to `docs/telegram-setup.md`: deep-link
  invite accept; "I have a secret phrase" path end-to-end (link → auto
  redeem); cold /start; returning /start; back button across overlays + group
  context; vertical-swipe behavior on canvas + list; close-confirm during a
  call; post-link and post-unlink landings; chrome color after theme change.

**Layout note:** the jsdom suites can't verify empty-state/banner layout
against the `--nav-h` flex column (no layout engine) — same caveat as the hint
engine; covered by A9 on-device.

## 9. Known gaps (recorded, deliberately not fixed here)

- **Web/PWA sessions of a linked account are blind to the Telegram link** —
  everything behaves as if Telegram doesn't exist; e.g. notification prompts /
  toasts push web-push framing while `notifyChannel === 'telegram'`. To fix
  later; the drawer's Notifications section (§4) is the designated home for
  link visibility on web.
- Unset `TELEGRAM_APP_LINK` degrades TG shares to web URLs (status quo, by
  design).
- Telegram's in-app-Safari mode remains undetectable (unchanged from §21).
- `start_param` carries exactly one token — multi-invite links out of scope.

## Accepted trade-offs

- A momentary derived account is created even for arrivals who immediately
  link (idempotent, expunged on link; avoids forking `validateTelegram`).
- The invite interstitial adds one tap for invited newcomers (framing +
  correct-account routing outweigh zero-friction).
- Landing banners depend on sessionStorage surviving the reload; if it
  doesn't, they silently don't show.
- The pre-mapping bot guard can't distinguish "never opened the app" from
  "just unlinked" — one message serves both.
- Back button is hidden (not intercepted) during calls.
