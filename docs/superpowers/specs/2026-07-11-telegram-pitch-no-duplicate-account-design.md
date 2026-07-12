# Telegram invite pitch — closing the "What is KnockKnock?" duplicate-account hole

Date: 2026-07-11
Status: Approved (design)
Relates to: #283 invite-arrival flows; spec N8 (the "What is KnockKnock?" link);
the telegram-duplicate-account effort this reopened.

## Problem

The N8 "What is KnockKnock?" button on the Telegram invite interstitial
(`js/telegramFirstRun.js`, `onAbout`) opens the invite in a browser **carrying
the token, to a transactional surface**:

```js
const url = window.location.origin + '/invite?i=' + token;
wa.openLink(url);
```

`/invite?i=` is config #1 — an *actionable* landing that runs the C1 pass-through.
From inside Telegram this reopens the exact duplicate-account path the effort was
meant to close:

- **Silent:** an existing web identity → the pre-paint C1 pass-through bounces to
  the app and **auto-redeems the invite on the web account** (no user action).
- **Deliberate:** no web identity → "Continue in browser" spins up a **device
  (web) account** separate from the Telegram-derived one.

Either way the invite lands on the wrong account and the user ends up with two.

## The invariant

The pitch surface **must never auto-redeem**. That property is *structural*, not
cosmetic: it comes from **which page** we open, not from hiding buttons.

- `/invite?i=` runs the C1 pass-through → can auto-redeem. **Never use it here.**
- `/about?i=` is the *reading* page (config #2). It shows the "You've been invited
  to follow X" framing and **never passes through**, even with a stored web
  identity. The token sits inert.

So the pitch opens `/about?i=`, and we additionally strip every web-facing exit so
the *only* way forward is back into Telegram (redeeming on the correct account).

## Design

Reuse the one About page — no duplicated pitch content, still out-of-app. Add a
single **pitch context** to it, signalled by a query flag.

### 1. `js/telegramFirstRun.js` — where the button points

`onAbout` opens the reading page with the pitch flag instead of the actionable
landing:

```js
const url = window.location.origin + '/about?i=' + token + '&pitch=1';
```

Everything else in the interstitial flow is unchanged. `onAbout` still does NOT
resolve the interstitial promise — the user reads and comes back to Accept.

### 2. About page — `pitch` mode

When `about.html` is opened with `pitch=1` **and** a valid `?i=TOKEN`, it renders
a **read-plus-return** surface: the invite framing and the "Open in Telegram"
door only. Every web-facing exit is hidden:

Keep:
- `#about-invite-framing` — "You've been invited to follow X."
- `#invite-telegram-cta` — "Open in Telegram", carrying `?startapp=TOKEN`. This
  deep-links back to the mini-app and redeems on the **Telegram** account. It is
  already fail-closed (hidden when no real deep link is configured).

Hide (the web-facing exits):
- the invite-landing "Continue in browser" door (`.invite-landing .cta[data-open-app]`);
- the "Copy invite" block (`.invite-installed-hint`) — its copy target is
  `/invite?i=`, which *would* pass through if pasted into a web app;
- the copy fallback (`#invite-copy-fallback`).

Mechanism: the inline pre-paint `<head>` script (which already parses the URL and
tags `<html>` with `cfg-invite`) also adds a **`cfg-pitch`** class when `pitch=1`.
CSS keyed off `html.cfg-pitch` hides the web-facing exits, so the pitch surface
paints correct from the first frame (consistent with the no-flash config work).
Because this changes the inline script's bytes, its **sha256 in
`firebase.json`'s `script-src` is recomputed** and the hash-guard test updated.

`pitch=1` only takes effect on the About reading page; it does nothing on
`/invite`. Normal `/about?i=` links shared on the web are unaffected — they keep
their "Continue in browser" door.

### 3. Fail-closed degradation

If the Telegram deep link isn't configured, `#invite-telegram-cta` stays hidden
(existing behaviour). The pitch surface then has **no door at all** — just the
framing and pitch — and the user returns to Telegram manually. Safe by
construction: with no web exits and no auto-redeem, there is no path to a web
account regardless.

## Why this is safe (defense in depth)

- **Structural (suspenders):** `/about` never runs the pass-through, so the invite
  cannot be auto-redeemed on a web account — even if the CSS below fails to load.
- **Presentational (belt):** `cfg-pitch` hides the web door + copy block, so the
  user isn't offered a deliberate "enter on web" path either.

The residual threat model (a user hand-editing the DOM to un-hide a door) is out
of scope — the goal is preventing the *accidental / silent* duplicate, which both
layers close.

## Non-goals

- No new in-app pitch screen (rejected: duplicates About's content).
- No change to normal `/about` / `/invite` behaviour for web-originated visits.
- No change to the redemption logic itself (still app.js / boot gate).
- Not touching the interstitial's Accept / phrase / Not-now paths.

## Testing

- `tests/telegramFirstRun.test.js`: `onAbout` opens `/about?i=<token>&pitch=1`
  (was `/invite?i=`); still does not resolve the interstitial.
- `tests/about-page.test.js`:
  - the pre-paint head script tags `cfg-pitch` when `pitch=1` (+ `cfg-invite`),
    and does NOT when `pitch` is absent;
  - CSP hash guard: the inline script's sha256 is whitelisted in `firebase.json`
    (recomputed);
  - CSS presence: `html.cfg-pitch` hides the web door, `.invite-installed-hint`,
    and `#invite-copy-fallback`, and does NOT hide `#invite-telegram-cta`.
- Browser verification (Chromium, harness): on `/about?i=TOKEN&pitch=1` the
  "Open in Telegram" door and framing are visible; the "Continue in browser"
  door and copy block are `display:none`; on `/about?i=TOKEN` (no pitch) the web
  door is visible (unaffected).
- On-device: the maintainer's Telegram walkthrough is the acceptance gate.

## Landmines

- `about.html` / `sw.js` / `dist/bundle.js` are gitignored build artifacts — the
  deploy needs the build re-run to reflect this.
- The inline `<head>` script's CSP sha256 must be recomputed whenever its bytes
  change; the hash-guard test fails loudly if it drifts.
