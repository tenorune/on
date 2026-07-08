# Wave W3-B: client cleanups — design

**Date:** 2026-07-08
**Source:** `docs/superpowers/2026-07-07-telegram-feature-analysis.md` §1.7 + §5 (client code
efficiency & redundancy) — the eight findings NOT covered by the W3-A headliner spec:
CL#6–CL#13. Cross-reference IDs (CL#) refer to the analysis document.
**Companion spec:** `docs/superpowers/specs/2026-07-08-telegram-w3-client-consolidation-design.md`
(W3-A: CL#1–CL#5).
**Branch:** this spec + its plan live on the docs-only branch
`claude/client-consolidation-w3-plan-iz0gbo`. The W3-B *implementation* runs later, on the
Telegram integration line, after both W1 and W3-A execute (see Sequencing below).

## Decisions log (operator-approved)

1. **Scope = all eight remaining findings, CL#6–CL#13**, as a wave separate from the
   W3-A headliners.
2. **CL#7 shape:** the `setButtonBusy`/`clearButtonBusy` pair in `showLinkScreen` only.
   The optional shared restore-screen open/teardown factoring is REJECTED — the two
   flows' submit semantics diverge deliberately (clipboard-on-empty + adaptive label +
   three-way error taxonomy + in-page resolve on restore vs. none of those on link), and
   a shared shell would need ~5 knobs to save ~20 lines.
3. **CL#10 breadth:** the four simple sites (`inviteModal.js` ×2, `recoveryModal.js`,
   `phraseReminder.js`). `mycode.js`'s `initRecoveryPill` is EXCLUDED — its "Copied!" is
   entangled with the reveal/idle state machine (copied-timer chains into `toIdle()`),
   and covering it would add a callback knob the other four don't need.
4. **CL#13 shape:** collapse the dead generality — delete `LANDING_COPY`, drop the
   `kind` parameter — rather than leave it documented.

## Sequencing against W1 and W3-A — UPDATE 2026-07-08: W1 (+W2) has LANDED

W1 executed and is on-device verified on `claude/telegram-app-adaptation-t1r1jp` tip
`97482f0` (HANDOFF §37–§40; web 1446, functions 281). Author order for shared files is
now (landed) → W3-A → W3-B; only the W3-A prerequisites remain pending.

- **Hard prerequisite — W3-A D4** (`showConfirmModal` gains async `onConfirm`/busy/inline
  error): E1 refactors that grown modal's harness. If W3-A is descoped, E1 falls back to
  deduping the two original (pre-D4) harnesses — smaller helper, same shape.
- **E2's baseline is now OBSERVED**: the landed `showLinkScreen` is the promise-returning
  W1 Task 9 shape with the hand-rolled busy lines intact (`js/telegramSettings.js:93-146`
  at the tip) — exactly what E2 patches. No fallback needed.
- **Soft — W3-A D5** (`buildTelegramShareUrl` moves to `telegram.js`): E7 edits the same
  `inviteFlow.js` functions (their `text` defaults); order-only interaction, no design
  interaction.
- Everything else (E3, E4, E5, E6, E8) touches regions no landed wave changed
  (re-verified at the tip).

## E1 — CL#6: one internal modal harness in `promptModal.js`

**File:** `js/promptModal.js`.

`showTextPrompt` and `showConfirmModal` duplicate their entire
promise/cleanup/overlay-tap/Escape scaffolding — and after W3-A D4, the confirm side
also carries busy/inert/inline-error machinery. Extract an internal (NOT exported)
helper owning all of it:

```js
// runModal(overlay, { confirmBtn, cancelBtn, cancelValue, onConfirmTap }) → Promise
//   onConfirmTap(finish) decides per tap: validate-and-finish (text prompt),
//   or run the async onConfirm with busy/inline-error/stay-open (confirm modal).
//   cancel / overlay-tap / Escape → finish(cancelValue), inert while busy.
```

Each public function supplies only its confirm semantics and cancel value
(`null` for the text prompt, `false` for the confirm modal); the harness — listener
add/remove, `finish`, overlay/Escape wiring, D4's busy/inert/error handling — lives
once. Public signatures and behavior are UNCHANGED.

**Acceptance = pure-refactor bar:** every existing `tests/promptModal.test.js` test,
including the D4 additions (onConfirm success/failure/inert-while-busy), passes with no
test edits. A refactor that needs a test change is wrong.

## E2 — CL#7 remainder: `showLinkScreen` uses the shared busy pair

**File:** `js/telegramSettings.js`.

The four hand-rolled lines in `showLinkScreen`'s submit path
(`submit.disabled = true; submit.textContent = 'Linking…'` and the manual revert)
become `setButtonBusy(submit, 'Linking…')` / `clearButtonBusy(submit)` from
`js/utils.js` — the helper this branch extracted for exactly this. The unlink half of
CL#7 was already absorbed by W1 Task 14 and then superseded by W3-A D4; only the link
screen remains.

**Landmine (OBSERVED, `js/utils.js:10-16`):** `#restore-submit-btn` is SHARED with
`app.js`'s `showRestoreScreen`, and `setButtonBusy` stashes `dataset.idleLabel` only
once — `clearButtonBusy` restores from it but never deletes it. If the restore screen
busied the button first, its stashed label ("Sign in" / "Paste & Sign in") would
resurface after a failed *link* attempt. Fix in the same change: `showLinkScreen`'s
open sequence deletes `submit.dataset.idleLabel` before setting the "Link account"
label (the mirror of `showRestoreScreen`'s own `clearButtonBusy`-on-open scrub, which
protects the other direction). The E2 test covers exactly this cross-flow case:
pre-seed a stale `idleLabel`, fail a link attempt, assert the button reads
"Link account".

## E3 — CL#8: one `startPersonalInviteFlow()`

**Files:** `js/mycode.js`, `js/app.js`.

The surface-dispatch policy
`isTelegramContext() ? sharePersonalInvite() : openPersonalInviteModal()` is spelled in
two modules (the drawer button handler in `mycode.js`; the first-run `onInvite` in
`app.js`). Export one `startPersonalInviteFlow()` from `mycode.js` containing the
ternary; both call sites use it. `app.js`'s imports from `./mycode.js` shrink to the one
function (verify at plan time what else it still imports from there). Closes the
behavior fork: a future change to the personal-invite CTA can't silently miss one
surface.

## E4 — CL#9: `telegramFirstName()` returns the trimmed, capped name

**Files:** `js/telegram.js` + the three call sites.

`telegramFirstName()` itself returns the display-ready value:

```js
// Mirrors the 40-char creatorLabel cap in database.rules.json / functions
// validation — keep the three in step.
const TG_NAME_CAP = 40;
export function telegramFirstName() {
  return (tgWebApp()?.initDataUnsafe?.user?.first_name || '').trim().slice(0, TG_NAME_CAP);
}
```

The three ad hoc suffixes drop: `app.js` (redeemerName, currently uncapped-untrimmed
`.slice(0, 40)` with no trim), `mycode.js` ×2 (currently `.slice(0, 40).trim()` — cap
then trim). The `|| 'Someone'` fallback stays at its `mycode.js` call site. Deliberate
micro-change, both directions an improvement: trim-before-cap stops leading/trailing
whitespace eating cap budget, and the `app.js` site gains the trim it was missing.
OBSERVED: `telegramFirstName` has exactly these three consumers plus tests — no caller
wants the raw form.

## E5 — CL#10: `copyWithFeedback` in utils

**Files:** `js/utils.js` + four call sites.

```js
// Copy-to-clipboard with transient button feedback: label → `done`, reverted to
// `idle` after 1.5s. A denied/failed clipboard write changes nothing (matching
// every current site). No timer dedup — rapid re-taps behave as they do today.
export async function copyWithFeedback(btn, text, { done = 'Copied!', idle = 'Copy' } = {}) { … }
```

Converted sites (explicit labels, current behavior preserved):

| Site | `done` | `idle` |
|---|---|---|
| `inviteModal.js` Copy button | `Copied!` | `Copy` |
| `inviteModal.js` share fallback (blocked popup → copy deep link) | `Link copied!` | `Share to Telegram` |
| `recoveryModal.js` `onCopy` | `Copied!` | `Copy` |
| `phraseReminder.js` copy button | `Copied!` | `Copy to clipboard` |

EXCLUDED (decision 3): `mycode.js` `initRecoveryPill` — its copied-timer chains into the
reveal panel's `toIdle()`. It keeps its bespoke block plus a one-line comment naming
`copyWithFeedback` and why it doesn't fit.

## E6 — CL#11: `recoveryModal` shared teardown

**File:** `js/recoveryModal.js`.

The `onSaved`/`onCancel` exit paths repeat the same `removeEventListener` sequence
(cancel adds one line). Hoist one `teardown()` closure removing all six listeners —
rotate, copy, saved, cancel, popstate, keychain-form submit — and have both paths call
it before hiding/resolving. Removing a never-added listener is a spec'd no-op, so the
cancel removal needs no `cancellable` guard. A future listener can't be forgotten on
one exit path.

## E7 — CL#12: one `shareCaption(scope, groupName)`

**Files:** `js/inviteFlow.js`, `js/inviteModal.js`.

```js
// js/inviteFlow.js — the ONLY place share captions are spelled (W4's copy
// sweep then has one string per caption to touch).
export function shareCaption(scope, groupName) {
  return scope === 'group' ? `Join ${groupName} on KnockKnock` : 'Follow me on KnockKnock';
}
```

- `shareInviteLink(invite, text = shareCaption(invite.scope, invite.groupName))` and
  `shareInviteToTelegramWeb(invite, …same…)` — the per-function string defaults drop.
  (Default-parameter evaluation is per call; `invite.scope` is `'personal'` or
  `'group'` on every caller-constructed invite, and `undefined` scope falls into the
  personal caption — same as today's default.)
- `inviteModal.js`'s two explicit sites call `shareCaption(scope, groupName)` /
  `shareCaption('group', groupName)` instead of spelling the strings (the group-share
  button's minted `{ token, url }` carries no scope, so it passes explicitly).

## E8 — CL#13: landing-notice collapse

**Files:** `js/firstRun.js`, `js/graduation.js`, `js/app.js`.

`LANDING_COPY` (a kind-keyed map with one surviving entry) is deleted; the pair is
renamed to what it now is:

- `stampGraduationNotice()` — no parameter; still writes `kk-landing` = `'graduated'`
  to sessionStorage (key and value unchanged, so a stamp written before a deploy still
  reads after it).
- `consumeGraduationNotice()` — read-and-clear; returns the graduated copy string
  (`'This account now works in any browser too.'`) or `null`.

Sole producer (`graduation.js`) and sole consumer (`app.js` boot toast) each change one
line. The surviving comments — cross-account reload handoff, deliberately not in
`cacheOwner`'s wipe list, accepted sessionStorage degradation — carry over verbatim.

## Ordering

Independents first: E3 → E4 → E5 → E6 → E8; then the prerequisite-coupled tail:
E7 (after W3-A D5 reshapes `inviteFlow.js`) → E2 (after W1 Task 9 reshapes
`showLinkScreen`) → E1 last (after W3-A D4 grows `showConfirmModal`). Each is an
independent commit; nothing else blocks.

## Testing

TDD per task (red before green), in the existing test files:

- **E1** `tests/promptModal.test.js`: NO test changes — the full existing file (incl.
  D4's additions) green on the refactored module is the acceptance.
- **E2** `tests/telegramSettings.test.js`: busy label during the link RTT, revert on
  failure, and the cross-flow stale-`idleLabel` case described in E2.
- **E3** `tests/mycode.test.js` (+ app-boot suite stays green): `startPersonalInviteFlow`
  dispatches by `isTelegramContext()`.
- **E4** `tests/telegram.test.js`: trim + cap behavior (long name, padded name, absent
  name → `''`); `tests/mycode.test.js` / `tests/app-boot-cacheOwner.test.js` mocks keep
  working (they mock `telegramFirstName` wholesale — contract change is invisible to
  them; re-run to confirm).
- **E5** `tests/utils.test.js`: `copyWithFeedback` label swap + revert + failure-no-op
  (jest fake timers); the four converted sites' existing tests stay green.
- **E6** `tests/recoveryModal.test.js`: both exit paths still remove everything
  (existing listener-hygiene tests keep passing; add one if none pins the cancel path).
- **E7** `tests/inviteFlow.test.js` + `tests/inviteModal.test.js`: caption for
  personal/group/default paths unchanged, now sourced from `shareCaption`.
- **E8** `tests/firstRun.test.js`: stamp→consume round-trip returns the copy;
  consume-twice returns `null`; renamed exports.

Green suites are necessary, not sufficient: **acceptance is the operator's on-device
walkthrough**, per the manual-visual-gate convention. E2 (link-screen failure path) and
E5's Telegram-webview copy buttons are the walkthrough's focus.

## Out of scope

- CL#1–CL#5 (wave W3-A, companion spec).
- CL#7's shared restore-screen open/teardown factoring (decision 2).
- `mycode.js` `initRecoveryPill` conversion (decision 3).
- All W2 findings (functions), all W4 findings (copy/CSS/bot-delight sweeps), anything
  under `functions/`, and any `css/app.css` change (none of E1–E8 needs one).
- Issue #283.
