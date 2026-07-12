# Release polish — README Telegram bullet + about-page Telegram card

**Date:** 2026-07-12
**Status:** Approved (brainstorming session)
**Branch:** `claude/release-polish-readme-about-9ggxip` (cut from the Telegram branch tip `c5f0152`)

## Summary

Two copy-only release-polish items for the Telegram adaptation wrap-up. Scope
was confirmed with the operator: **light touch** on the README (one feature
bullet, no docs link, no new section, no broader accuracy pass) and an
**ungated** Telegram mention on the about page (visible on every build, even
where `TELEGRAM_ENABLED` is off — the operator accepted that trade-off
explicitly).

## 1. README — one feature bullet

Insert exactly one bullet into the **Features** list of `README.md`,
immediately after the "Push notifications" bullet:

> - **Telegram Mini App (experimental)** — the same app running inside
>   Telegram: auto sign-in via Telegram's signed identity, a companion bot
>   that covers the core loop from chat (go available, see who's free,
>   knock), invite deep links, and notifications as bot messages instead of
>   Web Push. Behind the `TELEGRAM_ENABLED` flag.

Nothing else in the README changes.

## 2. About page — a "Telegram" feature card

Add one feature card to the **"What you can do"** section of
`about.template.html`, after the "Notifications" card (last in the list),
matching the established card rhythm (one-line blurb + `<details>`
disclosure):

- **Heading:** `Telegram`
- **Blurb:** `KnockKnock also lives inside Telegram.`
- **Details summary:** `How Telegram works`
- **Details body:** `Open the bot and you're in — your Telegram identity
  signs you in, no phrase to type. The bot handles the basics right from
  chat (go available, see who's free, knock), and notifications can arrive
  as bot messages instead of push. Already have an account here? Link it
  once and Telegram becomes another door to the same you.`

The card is static (ungated): no `hidden` class, no unhide hook in
`js/about-telegram.js`.

## Mechanics & verification

- Edit `about.template.html` only — `about.html` is a gitignored build
  artifact; `npm run build` regenerates it.
- Body-only changes: the CSP-hashed inline `<head>` script is untouched, so
  no `firebase.json` sha256 recompute is expected. The guard in
  `tests/about-page.test.js` confirms.
- Verification: web suite green via `node_modules/.bin/jest` from the repo
  root (1690 at branch tip), `npm run build` clean. Functions untouched.
- Done = the operator's review of the rendered copy; suites green are
  necessary, not sufficient.

## Out of scope

- Any other README section (tech stack, setup, data model, docs list).
- Any other about-page copy (lede, privacy sections, footer).
- Gating the new card on the build's Telegram link.
