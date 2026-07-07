# Telegram invite interstitial: contextual buttons — design

Date: 2026-07-07
Status: approved (linked stays silent — option A; work directly on
`claude/telegram-app-adaptation-t1r1jp`)
Scope: `js/telegramFirstRun.js`, `js/app.js` (one argument),
`tests/telegramFirstRun.test.js`. No template or server changes.

## Problem

The deep-link invite interstitial (onboarding spec 2026-07-05 §1) shows the
same three buttons to every unlinked arrival: **Accept & get started** /
**I have a secret phrase** / **Not now**. "& get started" is wrong for a
user who has already been using the Mini App — they started long ago.
(A linked arrival never sees the interstitial at all: the gate redeems
silently and toasts — `js/telegramFirstRun.js:58`. Decision: that stays.)

## Behavior matrix

| Arrival state | Interstitial | Accept label | Other buttons |
|---|---|---|---|
| Linked | none — silent redeem + toast (unchanged) | — | — |
| Unlinked + first-ever open (`isNew`) | shown | `Accept & get started` | phrase, Not now (unchanged) |
| Unlinked + returning | shown | `Accept` | phrase, Not now (unchanged) |

The phrase button stays for BOTH unlinked states: a returning-unlinked user
may hold a phrase account they should link before accepting, so the invite
lands in the right identity (the existing reload-and-re-gate loop,
`telegramFirstRun.js:50-52`).

## Design

- `telegramInviteGate({ linked, isNew, dismissSplash })` — new `isNew`
  input. The caller (`js/app.js` ~:542) already holds it: `isNew` is the
  server's `created` flag from `ensureTelegramIdentity()` (account
  bootstrapped this very boot = truly first open). No new state or reads.
- `showInterstitial(preview, isNew)` sets the accept button's
  `textContent` to `'Accept & get started'` when `isNew`, else `'Accept'`
  — JS is the single source of truth for the label; the template's static
  `Accept &amp; get started` stays as the pre-boot default.
- Everything else — framing text, choice semantics (`accept` / `phrase` →
  `showLinkScreen()` / `dismiss`), the linked silent path, splash handling
  — is untouched.

## Testing (web jest, existing tests/telegramFirstRun.test.js idioms)

- Fresh (`isNew: true`) → accept button text is `Accept & get started`.
- Returning (`isNew: false`) → accept button text is `Accept`.
- Regression: linked still bypasses the interstitial (silent result).
- Regression: all three choice resolutions unchanged (existing tests keep
  passing with the new argument supplied).

## Docs

One-line as-built note in the 2026-07-05 onboarding spec's "As-built
deltas" section recording the contextual accept label.
