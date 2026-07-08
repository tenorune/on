# Wave W3: client consolidation — design

**Date:** 2026-07-08
**Source:** `docs/superpowers/2026-07-07-telegram-feature-analysis.md` §1.7 + §5 (client code
efficiency & redundancy, CL#1–CL#13). Cross-reference IDs (CL#) refer to that document.
**Branch:** this spec + its plan live on the docs-only branch
`claude/client-consolidation-w3-plan-iz0gbo`. The W3 *implementation* runs later, on the
Telegram integration line, **after wave W1 executes** (see Sequencing below).

## Decisions log (operator-approved)

1. **Scope = the headliners only: CL#1–CL#5.** CL#6–CL#13 are explicitly out of scope
   (each with a reason in §Out of scope below).
2. **CL#2 shape:** `defer` on both `<script>` tags (the telegram bridge and the bundle),
   not an end-of-body move. On-device webview timing check is the acceptance gate.
3. **CL#4 shape:** extend `showConfirmModal` with an optional async `onConfirm` hook
   (busy label + inline error + stay-open-retry), carrying over the behaviors W1 Task 14
   gives the bespoke sheet. No second modal implementation.

## Sequencing against wave W1 (planned, not executed)

`docs/superpowers/plans/2026-07-07-telegram-w1-high-tier-ux.md` will modify
`js/notifyChannel.js`, `js/telegramSettings.js`, `js/telegramFirstRun.js`,
`js/telegramChrome.js`, `js/app.js`, `js/invites.js`, `js/cacheOwner.js`, and
`index.template.html` before W3 runs. W3's plan is therefore authored against the
**post-W1 state**: no reliance on current line numbers in shared files, and W1 tasks are
named as prerequisites where the code interacts.

- **Hard prerequisite — W1 Task 14** (unlink busy + inline error on the bespoke sheet)
  and **W1 Task 13** (back-button checklist gains `#tg-unlink-confirm`): D4 consolidates
  the very sheet Task 14 reshapes and deletes the checklist entry Task 13 adds.
- **Soft overlap — W1 Task 7** (`notifyChannel.js` click-handler guard) and **Task 10**
  (`telegramFirstRun.js` gate rewrite): D3's five call sites survive W1 verbatim — Task 7
  touches the click handler, not `isLinked`; the Task 10 gate takes `linked` as an
  argument computed at the `app.js` call site, which W1 does not touch.
- **Fallback** (recorded for completeness): if W1 is descoped before W3 runs, D4 instead
  consolidates the *pre-W1* bespoke sheet onto the same target shape — the `onConfirm`
  extension is unchanged; only "carry over busy/error" becomes "introduce busy/error via
  the shared modal," and the Task 13 checklist deletion drops out.

## D1 — CL#1: `setListEmpty` change guard

**File:** `js/firstRun.js`.

Module-level `let _appliedEmpty = null;`. At the top of `setListEmpty`, normalize
`const empty = !!isEmpty`; early-return when `_appliedEmpty === empty`; otherwise record
and proceed. The first call always runs (`null` matches neither boolean); after that the
~10 DOM operations and the `first-run-change` dispatch fire only on genuine
empty↔non-empty transitions — not on every presence flip, watcher tick, and 60s interval
for the app's whole lifetime.

**Why the guard is safe:** every other input to the function (`isTelegramContext()`,
`telegramLinkState()`) is static within a session — link, unlink, and graduation all
`location.reload()`. A same-state re-run is therefore genuinely a no-op.
**Sole fan-out consumer** (OBSERVED, re-verify at plan time): `js/installAffordance.js`
(`document.addEventListener('first-run-change', apply)`) — it treats the event as a
change signal, so fewer dispatches is the intended behavior, not a semantic change.

**Contract change, test impact:** `setListEmpty` moves from "idempotent re-sync on every
call" to "no-op on same state." `tests/firstRun.test.js` currently asserts per-call
behavior in two places — the link-line test re-calls `setListEmpty(true)` with changed
link-state mocks and expects a re-sync, and 'every flip dispatches first-run-change'
counts one dispatch per call. Both are reworked in the plan (flip emptiness between
assertions; assert the guard explicitly: same-state re-call dispatches nothing).

## D2 — CL#2: `defer` the telegram bridge + bundle

**File:** `index.template.html`.

Add `defer` to the `telegram-web-app.js` `<script>` in `<head>` and to the
`dist/bundle.js` `<script>` at end of body. `defer` preserves document execution order,
so `window.Telegram` still exists before the bundle's `isTelegramContext()` runs at boot.
The inline theme-restore script is untouched (inline scripts can't defer) and now runs
before any network script — first paint no longer waits on a telegram.org round-trip.
The head comment gains one line stating the ordering guarantee so a future edit doesn't
drop one attribute and break the pair.

**UNKNOWN until on-device:** Telegram-webview boot timing with a deferred bridge. The
plan's acceptance step is the operator's walkthrough (Telegram webview boot + plain-web
boot); worst-case rollback is deleting two attributes. No unit-test surface.

## D3 — CL#3: one `isTelegramLinked()` predicate

**Files:** `js/telegram.js` + five call sites.

```js
// js/telegram.js (owns _linkState)
export function isTelegramLinked() {
  return _linkState?.linked === true;
}
```

The five spelled-out `telegramLinkState()?.linked === true` / `!== true` sites switch to
it: `js/app.js` (the invite-gate `linked:` argument), `js/firstRun.js` (two sites: the
account-section gate and the link-line gate), `js/notifyChannel.js` (`isLinked`'s
Telegram arm), `js/telegramSettings.js` (`initTelegramSettings`).

**Contract landmine (explicit):** in `js/notifyChannel.js`, ONLY the Telegram arm of
`isLinked(prefs)` changes. The web arm — `prefs?.telegram != null` — is one of the THREE
cross-referenced readers of the notify-channel default (with `js/notifySuppression.js`
and `functions/notifier.js`) and **stays byte-for-byte**, its cross-reference comment
intact. `isTelegramLinked()` replaces only the session-link-state spelling; it does not
touch, wrap, or re-derive the prefs-marker reading.

## D4 — CL#4: unlink confirm → `showConfirmModal` + async `onConfirm`

**Files:** `js/promptModal.js`, `js/telegramSettings.js`, `js/telegramChrome.js`,
`index.template.html`.

### `showConfirmModal` extension

Signature grows two optional fields:
`showConfirmModal({ title, message, confirmLabel, busyLabel, onConfirm })`.

- **Without `onConfirm`:** behavior byte-identical to today — every existing web caller
  (rotate, unfollow, remove-follower, group delete/leave) is untouched.
- **With `onConfirm`:** the confirm tap runs
  `setButtonBusy(confirmBtn, busyLabel || confirmLabel)` (shared helper from
  `js/utils.js`; an omitted `busyLabel` keeps the label and just disables — callers with
  an RTT are expected to pass one), then awaits `onConfirm()`.
  - **While in flight**, cancel / overlay-tap / Escape are inert — a destructive action
    must not be dismissible mid-RTT (the Telegram back button consequently also does
    nothing: it routes through the cancel button, D4's `telegramChrome` note below).
  - **Resolve** → `clearButtonBusy`, `finish(true)` (modal closes).
  - **Throw** → `clearButtonBusy`, show `e.userMessage ||
    "Couldn't finish that right now. Try again."` in a new inline error element, and the
    modal **stays open** for retry or cancel (re-enabled). Follows `recoveryModal`'s
    proven `onConfirm`/`userMessage` pattern.
  - The error clears on modal open and on each confirm tap.

Markup: `#confirm-modal` in `index.template.html` gains
`<p id="confirm-modal-error" class="error-msg hidden"></p>` between the message and the
buttons (same `error-msg` class as `#restore-error`).

### `telegramSettings.js` consolidation

`ensureUnlinkConfirmModal` and `doUnlink` are deleted (~35 lines, one injected DOM tree,
and the permanent document-level keydown listener). The unlink button's click handler
becomes:

```js
const ok = await showConfirmModal({
  title: 'Unlink this Telegram?',
  message: 'Your account stays yours — sign in with your secret phrase in any browser. This Telegram will start over with a fresh, empty account.',
  confirmLabel: 'Unlink',
  busyLabel: 'Unlinking…',
  onConfirm: async () => {
    try { await callUnlinkTelegram(tgWebApp().initData); }
    catch (e) { throw Object.assign(e ?? new Error('unlink failed'), { userMessage: "Couldn't unlink right now. Try again." }); }
  },
});
if (ok) window.location.reload(); // reboot as a fresh derived account
```

All three W1-Task-14 behaviors carry over exactly: busy label `Unlinking…`, inline error
with W1's exact copy `Couldn't unlink right now. Try again.`, sheet-stays-open-for-retry.
Copy for title/message/labels is unchanged from the bespoke sheet.

### `telegramChrome.js` follow-up

The `#tg-unlink-confirm` entry that W1 Task 13 adds to `resolveBackAction`'s checklist is
deleted — the sheet no longer exists, and `#confirm-modal` is already the first entry.
Its test row in `tests/telegramChrome.test.js` is retargeted/removed. Back during an
in-flight `onConfirm` correctly does nothing (it clicks a cancel button that is inert
while busy).

## D5 — CL#5: one t.me share-URL builder

**Files:** `js/telegram.js`, `js/inviteFlow.js`.

`buildTelegramShareUrl` moves from `inviteFlow.js` into `telegram.js` with the
caption-spacing rule folded in:

```js
// js/telegram.js
export function buildTelegramShareUrl(url, text = '', { platform } = {}) {
  // Desktop clients concatenate url+caption with no separator; iOS inserts one.
  // Unknown/absent platform gets the separated form (never worse).
  const caption = text && platform !== 'ios' ? `\n${text}` : text;
  return `https://t.me/share/url?url=${encodeURIComponent(url)}${caption ? `&text=${encodeURIComponent(caption)}` : ''}`;
}
```

- `openTelegramShare` calls it with `{ platform: wa.platform }` — its platform-aware
  behavior is preserved.
- `shareInviteToTelegramWeb` calls it with no platform — its current unconditional `\n`
  IS the non-iOS default branch, so behavior is preserved while the subtly-different
  duplicate condition disappears. The platform-conditional difference between the two
  callers is **intentional** and now lives in one commented place.
- `inviteFlow.js` re-exports `buildTelegramShareUrl` (`export { buildTelegramShareUrl }
  from './telegram.js';`) so its existing importer surface — including
  `tests/inviteFlow.test.js` — keeps working. Import direction stays
  `inviteFlow → telegram` (already the case; no cycle).

## Ordering

D1 → D2 (the measurable pair first) → D3 → D5 → D4 (the W1-coupled consolidation last).
Each is an independent commit; nothing blocks on anything except D4's W1 prerequisite.

## Testing

TDD per task (red before green), in the existing test files:

- **D1** `tests/firstRun.test.js`: same-state re-call performs no DOM writes and no
  dispatch; transition still syncs + dispatches; the two per-call-contract tests reworked
  as described in D1.
- **D2**: no unit surface — acceptance is the operator's on-device walkthrough (Telegram
  webview boot AND plain-web boot; check `isTelegramContext()` detection and first paint).
- **D3** `tests/telegram.test.js` (+ the call-site suites stay green unchanged):
  `isTelegramLinked()` true/false/null-state; `tests/notifyChannel.test.js` re-run to
  prove the web arm is untouched.
- **D4** `tests/promptModal.test.js`: `onConfirm` success (busy label while pending,
  resolves true, closes), failure (inline error, stays open, retry works, cancel works
  after failure), in-flight dismissal inert, and a no-`onConfirm` regression test that
  the classic path is unchanged. `tests/telegramSettings.test.js`: unlink now routes
  through `showConfirmModal` (W1 Task 14's busy/error test is superseded — rewritten
  against the shared modal). `tests/telegramChrome.test.js`: checklist row update.
- **D5** `tests/telegram.test.js`: URL encoding, iOS vs non-iOS vs absent platform
  spacing; `tests/inviteFlow.test.js`: existing tests keep passing via the re-export.

Green suites (web baseline 1408 at handoff + W1's additions) are necessary, not
sufficient: **acceptance is the operator's on-device walkthrough**, per the
manual-visual-gate convention. D2 and D4 are the walkthrough's focus.

## Out of scope

- **CL#6** (`promptModal` internal `modalPromise` harness dedup): module is small and
  stable; D4 grows `showConfirmModal` only. If a later wave adds more modal variants,
  CL#6 is the first refactor to reach for.
- **CL#7** (`showLinkScreen` hand-rolled busy state + optional restore-screen factoring):
  the unlink half is absorbed by W1 Task 14; the rest is deferred with the analysis's own
  "divergent submit semantics are deliberate" caveat.
- **CL#8** (invite-CTA surface fork), **CL#9** (40-char name cap), **CL#10**
  (copy-with-"Copied!" idiom), **CL#11** (recoveryModal teardown dedup), **CL#12**
  (share-caption strings), **CL#13** (landing-notice generality): operator scope decision
  — headliners only. CL#6–CL#13 are specced separately as wave **W3-B**
  (`docs/superpowers/specs/2026-07-08-telegram-w3b-client-cleanups-design.md`), which
  runs after this wave.
- All W2 findings (functions), all W4 findings (copy/CSS/bot-delight sweeps), anything
  under `functions/`, and any `css/app.css` change (none of D1–D5 needs one).
- Issue #283.
