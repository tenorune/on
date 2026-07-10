# Invite arrivals & in-app browsers: holistic design (fix #283, fold in #265)

**Date:** 2026-07-10 (v1 — supersedes the same-day draft previously at this path)
**Issues:** #283 (Telegram in-app browser mints a duplicate account), #265 (/invite route — URL idea folded in)
**Canonical visual spec:** `2026-07-10-invite-arrival-flows-design.html` (this directory) — the flow
diagrams, boot decision tree, and wireframes there are normative parts of this spec, not
illustrations. This file mirrors the rules in greppable form.
**Related:** `2026-07-05-telegram-onboarding-ux-design.md` §9 (gap recorded there);
`2026-07-07-telegram-invite-interstitial-context-design.md` (as-built; N8 adds one element).

## 1. Problem

A web invite (`/?i=TOKEN`) tapped inside Telegram opens the in-app browser, not the Mini App.
`isTelegramContext()` is false, the recipient's Telegram-derived account (Mini-App-only,
phrase-less, not in localStorage) is unreachable, and boot treats them as new: one "New" tap
mints a duplicate account and the invite redeems onto it. iOS Telegram's webview UA is
byte-identical to Safari, so no detection-gated fix can cover it. The same shape recurs for
**any** in-app browser (Instagram, WhatsApp, …) and for **installed-PWA** users, whose identity
lives in a storage partition no webview or (on iOS) even Safari can reach.

## 2. Decisions (operator-locked, 2026-07-10 brainstorm)

| Ref | Decision |
|---|---|
| Q1=A | The #283 user must end up in the Mini App with the invite on their Telegram identity. Scope is holistic: all in-app browser arrivals. |
| Q2=C | Landing serves invite and bare arrivals; invite-triggered redirect ships first (phase 1), bare-link trigger after the walkthrough (phase 2). |
| Q3=C | iOS collateral accepted; the two landing CTAs are equal peers — no steering. |
| Q4=A | Telegram-Android detected + token + deep link → boot auto-hops to `t.me/<bot>/app?startapp=TOKEN`, zero taps. |
| Q5=B | Bare in-app arrivals (phase 2) redirect to plain `/about`, which offers both doors. |
| Q6=A | `stay=1` boots skip the old in-app-browser panel (phase 1); panel retires in phase 2. |
| Q7=C+A | Installed-PWA recipients: platform link-capturing where it exists + universal in-app fallback (dual-mode "Add a person" paste) + a tertiary landing door. |
| A1 | `buildInviteUrl` → `/invite?i=TOKEN`; the `/?i=` boot gate remains as the net for legacy/copied links. |
| A2 | `/invite?i=` renders config #1 (invite-first); `/about?i=` renders config #2 (full page + invite block). Pages never redirect or auto-hop. |
| A3 | Browser-opened `/about` always shows a standing bare "Open in Telegram" CTA (fail-closed on the build substitution). |
| A4 | Mini App interstitial gains a "What is KnockKnock?" link → `/invite?i=TOKEN`, shown only in the `isNew` ("Accept & get started") context. |

Flows F0–F9 and the boot decision tree: see the HTML spec. Tested during brainstorm:
a `t.me/…?startapp=…` link tapped in an Instagram DM opens the Mini App.

## 3. Normative rules

### N1 — Shared link change
`buildInviteUrl(token)` (`js/invites.js:51`) returns `${APP_URL_BASE}/invite?i=${token}`.
Single construction point; callers build the URL from the token at display time, nothing
persists it — no migration. Legacy `/?i=` links are handled by N3.

### N2 — Routing
`firebase.json`: additive rewrite above the `**` catch-all —
`{ "source": "/invite", "destination": "/about.html" }`. Query strings pass through
(standard Firebase behavior; walkthrough-verify). `/invite` is root-level, so the page's
relative asset URLs resolve unchanged.

### N3 — Boot gate (`js/app.js main()`, `/?i=` only)
Placed immediately after `extractInviteTokenFromUrl` (`app.js:564`), before `ensureIdentity`
and any Firebase work. Ordered checks; first match wins; redirect/auto-hop outcomes call
`location.replace(…)` and return from `main()`:

1. `isTelegramContext()` → normal Telegram boot (never redirected).
2. `stay=1` in URL → today's web flow; `showInAppBrowserRedirect` skipped (Q6).
3. `loadIdentity()` or `isStandalone()` → today's flow (redeems onto the existing identity).
4. `isTelegramInAppBrowser()` and `buildTelegramInviteLink(token)` non-null → auto-hop to the
   deep link (Q4=A). Unconfigured link falls through to 5.
5. `isInAppBrowser()` → `location.replace('/invite?i=' + token)`.
6. `isIos() && telegramSharingEnabled()` → same redirect. (The undetectable-iOS-Telegram rescue
   is the only justification for the iOS collateral, so Telegram-off spares iOS Safari.)
7. Else → today's welcome flow.

Phase 2 adds the tokenless branch: fresh + `isInAppBrowser()` → `location.replace('/about')`;
iOS-undetected tokenless boots never redirect. `cleanInviteParamFromUrl` (`app.js:555`) also
deletes `stay`. Phase 2 removes `showInAppBrowserRedirect` and its call site.

### N4 — Page behavior (`about.html` = `/about` + `/invite`)
- Pages never redirect and never auto-hop.
- Config by `location.pathname` (first path-sensitive behavior in the about scripts):
  `/invite` + valid token → config #1; other path + valid token → config #2; no/invalid token
  → plain page (tokenless `/invite` behaves as plain `/about`).
- Token shape: `/^[A-Za-z0-9_-]{1,64}$/` (as `about-invite.js:11`, `about-cta.js:22`).
- Invite block (both configs): static headline; existing `#about-invite-framing` moves inside
  unchanged (`about-invite.js` untouched); equal CTA pair — "Open in Telegram"
  (`data-telegram-link + '?startapp=' + token`) and "Continue in browser" (`data-open-app`
  break-out); tertiary installed-app line with one-tap "Copy invite" (copies the canonical
  `/invite?i=TOKEN` URL).
- One set of doors: while the invite block shows, the intro hides both of its CTAs.
- Config #1 collapse (v1): everything below the logo folds behind one expander
  ("More about KnockKnock"). Script-off fallback = fully expanded. Finer split: followup.
- Standing bare Telegram CTA (A3): token-less pages show "Open in Telegram" → bare
  `t.me/<bot>/app` beside "Open KnockKnock →".
- Fail-closed: every Telegram CTA renders hidden; unhide only when `data-telegram-link` is
  non-empty and not an unsubstituted `__…__` placeholder (mirrors `about-invite.js:15`).
- Loop guard: `about-cta.js` appends `&stay=1` to every link it rewrites when a token is
  present (x-safari, `intent://` incl. `browser_fallback_url`, desktop plain). The x-safari
  break-out itself is unchanged pre-existing behavior.
- New logic in a new single-purpose classic script `js/about-telegram.js`;
  `about-cta.js` changes only for `stay`.

### N5 — Build substitution (`scripts/build.js`)
`renderAbout()` gains `__TELEGRAM_APP_LINK__` = `TELEGRAM_ENABLED && env.TELEGRAM_APP_LINK || ''`.
`TELEGRAM_ENABLED` is a hardcoded const in `js/features.js` (ESM) — `build.js` (CJS) reads it
from the source text via `/export const TELEGRAM_ENABLED = (true|false)/`, keeping
`features.js` the single source of truth so the page can never disagree with
`telegramSharingEnabled()` (a post-merge flag-off build cannot advertise a dead bot link).

### N6 — Installed-PWA treatment (Q7=C+A)
- Dual-mode "Add a person" input (`index.template.html #add-person-form`, `js/following.js`):
  dispatch on the trimmed input — a parseable URL with an `i=` param → invite token; an exact
  22-char base64url string (`/^[A-Za-z0-9_-]{22}$/`, the token length from `js/invites.js`) →
  invite token; otherwise the existing follow-by-code path. Redemption reuses the existing
  pipeline (`attemptRedeemFromUrl`-equivalent + `handleInviteRedemptionResult`), so personal
  and group invites both work. `maxlength="6"` lifts; the name field applies to code mode only.
- C-side: desktop Chromium link capturing already opens `/invite?i=` in the installed app
  (operator-observed). Android `intent://`→WebAPK hand-off: walkthrough item. Manifest
  `launch_handler` tuning: possible followup, out of scope.

### N7 — Detection helpers (`js/installGuidance.js`)
- New `export function isTelegramInAppBrowser()` = `/Telegram/.test(ua())` — Android-only
  positive signal (substring of `isInAppBrowser()`'s pattern, line 36); correctness never
  depends on it (iOS Telegram is indistinguishable from Safari).
- Export the module-private `isIos()` (line 20).

### N8 — Mini App interstitial (on top of spec 2026-07-07 as-built)
"What is KnockKnock?" link → `/invite?i=TOKEN`, shown only when `isNew` (flag already passed
to `showInterstitial`, `js/telegramFirstRun.js:63`). Opens within Telegram so the user returns
to the interstitial. The page's loop-back "Open in Telegram" CTA is accepted for v1.

## 4. Phasing

- **Phase 1:** N1–N8 except the tokenless boot branch and panel removal.
- **Phase 2** (after the phase-1 walkthrough): tokenless bare-arrival redirect (F8) + panel
  retirement.
- **Followups:** config #1 fine-grained content split; interstitial-opened page variant
  (loop-back CTA); copy tuning; manifest link-capturing.
- **Done =** the operator's on-device walkthrough, not green suites.

## 5. Testing

Unit (jest, `node_modules/.bin/jest` from repo root):
- `installGuidance`: `isTelegramInAppBrowser()` true on Telegram-Android UA, false on
  Safari-identical iOS UA and plain Chrome; `isIos` export intact.
- `invites`: `buildInviteUrl` shape.
- `about-page`: config selection by path + token; invite block visibility; both intro CTAs
  hidden with the block; Telegram CTA fail-closed (placeholder/empty), composed
  `?startapp=` href; `stay=1` on all three rewrite platforms; copy-invite affordance;
  tokenless `/invite` = plain page; plain `/about` shows the standing CTA only when substituted.
- App-boot suite: each gate row fires/doesn't (order-sensitive: identity beats detection,
  `stay` beats everything but Mini App); `location.replace` targets; `stay` stripped.
- `following`: dual-mode dispatch (URL, 22-char token, 6-char code, garbage); redemption
  pipeline reuse; maxlength lift.
- `telegramFirstRun`: info link present iff `isNew`; choice resolutions unchanged.
- `build.js`: substitution on/off with the features-flag read.

Walkthrough matrix (operator, on device): iOS Telegram · iOS Safari · Android Telegram ·
Android Chrome · Android Instagram-class webview · desktop · installed-PWA on each platform.
UNKNOWNs to resolve there: Telegram-Android interception of the auto-hop `location.replace`;
Android `intent://` + `stay=1` round-trip; Android `intent://`→WebAPK hand-off; Firebase
rewrite query preservation.

## 6. Touch points

`js/invites.js` (N1) · `firebase.json` (N2) · `js/app.js` (N3) · `about.template.html` +
`css/about.css` + `js/about-telegram.js` (new) + `js/about-cta.js` (N4) · `scripts/build.js`
(N5) · `js/following.js` + `index.template.html` (N6) · `js/installGuidance.js` (N7) ·
`js/telegramFirstRun.js` + Mini App template (N8) · tests per §5.
