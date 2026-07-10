# Telegram invite → framed /invite landing (fix #283, fold in #265)

**Date:** 2026-07-10
**Issues:** #283 (web invite opened in Telegram's in-app browser mints a duplicate account), #265 (dedicated /invite landing URL — folded in as the route only)
**Predecessor spec:** `2026-07-05-telegram-onboarding-ux-design.md` §9 (known gaps — in-app-browser gap recorded there)

## 1. Problem

A web invite URL (`${origin}/?i=TOKEN`, built at `js/invites.js:51`) pasted into a Telegram
chat opens in Telegram's **in-app browser** — a plain webview, not the Mini App. There
`isTelegramContext()` is false, so a recipient whose account is Telegram-derived
(Mini-App-only, never in localStorage, phrase-less) is unreachable. Boot treats them as a
brand-new visitor; tapping "New" mints a duplicate web account
(`createNewAccount`, `js/app.js:232`) and `attemptRedeemFromUrl` redeems the invite onto
it. The inviter gains a follower on a wrong, nameless identity.

The existing mitigation never fires where it matters most: on iOS, Telegram's webview UA
is **byte-identical to Safari**, so both `isInAppBrowser()` (`js/installGuidance.js:35`)
and any narrower check are false there. On Android the UA does contain `Telegram`, but
the boot panel (`showInAppBrowserRedirect`, `js/app.js:468`) is informational and
dismissible — the mint still happens one tap later.

## 2. Approach (decisions carried from the brainstorm)

- **P2 — redirect, don't patch the panel.** On the `/?i=` boot path, redirect fresh
  invite arrivals to a framed, **mint-free** landing page before any account can be
  created. `/about` loads no Firebase SDK, so no duplicate can form while the user
  decides. (Rejected: widening the boot panel — still one tap from a mint; changing only
  shared links — can't catch a copied `/?i=` URL.)
- **A′ — detection-free correctness.** The landing offers "Open in Telegram" as a
  universal affordance, gated only on a pending token + a configured deep link — never
  on detecting Telegram, because iOS can't be detected. It is correct for a
  Telegram-identity holder (→ Mini App → real account), correct for a Telegram-having
  stranger (→ proper Mini App onboarding), and harmless for a non-Telegram user
  (secondary "Continue in browser" resumes today's flow).
- **Fold in #265 as the route.** The landing URL is `/invite?i=TOKEN`, served by an
  additive `firebase.json` rewrite to the existing `about.html`. Only #265's URL idea is
  taken; its modal-toggle framing is dropped.
- **S3 scope** (chosen fork): the boot redirect fires for **Android-Telegram and all
  iOS** arrivals. Android non-Telegram in-app browsers (Instagram, WhatsApp, …) keep
  today's flow — those are genuine web users, a web account is correct, and there is
  nothing to rescue. Minimal blast radius; catches every #283 case.
  (Alternative S1 — redirect on the generic `isInAppBrowser()` too — recorded in §10.)

## 3. Boot redirect gate (`js/app.js`)

In `main()`, immediately after `extractInviteTokenFromUrl` (`js/app.js:564`) and before
`ensureIdentity` — i.e. before any Firebase work — redirect when **all** of:

1. `pendingInviteToken` is present (fresh invite arrival);
2. `!isTelegramContext()` — the Mini App handles identity itself and must never bounce;
3. `!isStandalone()` — an installed app is definitionally not a Telegram webview, and
   its no-identity path (restore-priming, `shouldPrimeRestore`) is already correct;
4. no stored identity (`loadIdentity()` returns null) — a returning web user should
   redeem onto their real account as today;
5. `telegramSharingEnabled()` (`js/inviteFlow.js:28`) — no landing push when the Mini
   App isn't live;
6. **UA condition (S3):** `isTelegramInAppBrowser() || isIos()`;
7. no `stay=1` param (loop guard, §6).

Action: `location.replace('/invite?i=' + pendingInviteToken)` and halt boot (return from
`main()`). `location.replace` keeps the webview's back button from bouncing through the
redirecting page.

The gate fires **only** from the app boot path. A hand-opened `/about?i=` or
`/invite?i=` never redirects (those pages run no boot code).

Consequences on the boot path: iOS invite arrivals no longer reach the welcome screen
directly; Android-Telegram fresh arrivals no longer see `showInAppBrowserRedirect` (they
land on `/invite` instead). Arrivals with `stay=1` and all non-matching contexts proceed
exactly as today.

## 4. Detection helper (`js/installGuidance.js`)

- New `export function isTelegramInAppBrowser()` — `/Telegram/.test(ua())`. This is an
  **Android-only** signal (already a substring of `isInAppBrowser()`'s pattern,
  `js/installGuidance.js:36`); on iOS Telegram's webview UA carries no marker. The
  helper exists to *increase* specificity where possible, never to gate correctness.
- Export the existing module-private `isIos()` (`js/installGuidance.js:20`) so `app.js`
  can use it (it already handles the iPadOS-reports-as-Macintosh case; `about-cta.js`
  keeps its own inline copy — it is a no-build classic script).

## 5. `/invite` route (`firebase.json`)

Additive rewrite above the `**` catch-all:

```json
{ "source": "/invite", "destination": "/about.html" }
```

Same physical page as `/about`; Firebase rewrites preserve the query string, and both
`about-invite.js` and `about-cta.js` key off `?i=` only (path-agnostic), so
`/about?i=` keeps working identically and picks up the new CTA for free (explicit
operator constraint). `/invite` is a root-level path, so the page's relative asset URLs
(`css/about.css`, `js/*.js`) resolve unchanged.

## 6. Loop guard — `&stay=1`

"Continue in browser" reuses the existing `data-open-app` per-platform rewrite
(`js/about-cta.js`): iOS gets `x-safari-https://…`, which opens a **fresh real-Safari
context** where sessionStorage cannot guard — boot there would re-redirect
`/?i=` → `/invite` forever. So the guard rides the URL:

- `about-cta.js` appends `&stay=1` to every link it rewrites **when a token is
  present** (iOS `x-safari-https`, Android `intent://` + its
  `browser_fallback_url`, desktop plain). No token → no redirect risk → no param.
- The boot gate (§3) skips when `stay=1` is present.
- `cleanInviteParamFromUrl` (`js/app.js:555`) additionally deletes `stay` so the
  param doesn't linger in the address bar after redemption.

## 7. Landing page shape (`about.template.html` + scripts)

New section at the top of `<main>`, above the existing `.intro`, hidden by default:

```html
<section id="invite-landing" class="invite-landing hidden">
  <h2>You're invited to __APP_TITLE__</h2>
  <!-- existing element, moved here from .intro; about-invite.js is untouched
       and upgrades it to "You've been invited to follow Ana." on preview success -->
  <p id="about-invite-framing" class="invite-framing hidden" data-preview-url="__INVITE_PREVIEW_URL__"></p>
  <p class="invite-hint">Use Telegram? Open the invite there — it works with your
     Telegram account, no separate sign-up.</p>
  <a id="invite-telegram-cta" class="cta hidden" data-telegram-link="__TELEGRAM_APP_LINK__">Open in Telegram</a>
  <a class="cta cta-secondary" href="/" target="_blank" rel="noopener" data-open-app>Continue in browser</a>
</section>
```

- **Visibility:** a new small classic script, `js/about-telegram.js` (mirroring
  `about-invite.js`'s single-purpose pattern), unhides `#invite-landing` when the URL
  carries a valid token (`/^[A-Za-z0-9_-]{1,64}$/`, same shape both about-page scripts
  already use). No token, or invalid → section stays hidden and the page is today's
  `/about`, unchanged.
- **Telegram CTA (fail-closed):** the same script reads `data-telegram-link`; only when
  it is non-empty and not an unsubstituted placeholder (`indexOf('__') === 0`, mirroring
  `about-invite.js:15`) does it set `href = link + '?startapp=' + token` and unhide the
  CTA. `?i=` and `startapp=` carry the same token (`buildTelegramInviteLink`,
  `js/inviteFlow.js:21`). Unconfigured builds show only "Continue in browser" — and the
  boot redirect can't send anyone there anyway (§3 cond. 5).
- **Continue in browser:** carries `data-open-app`, so `about-cta.js` gives it the
  existing per-platform break-out (x-safari / intent / plain) plus `&stay=1` (§6).
  Keeping the x-safari break-out is deliberate: it is existing `/about` behavior, and the
  "Open in Safari?" system prompt is a pre-existing, accepted wrinkle.
- **Marketing content:** unchanged, remains below the landing section as context on
  what the invite is for — nothing collapses. The `.intro` section keeps its own "Open …" CTA;
  it also gains `&stay=1` via the shared rewrite, which is harmless.
- **Framing race:** the `h2` is static so the section is never headline-less; the
  personalized `#about-invite-framing` line appears if/when the preview fetch succeeds
  (non-critical, exactly as today).
- **Styling:** `css/about.css` gets `.invite-landing`, `.invite-hint`, `.cta-secondary`
  — visual details are the operator's on-device call.

## 8. Build substitution (`scripts/build.js`)

`renderAbout()` gains `__TELEGRAM_APP_LINK__`:

```
.replaceAll('__TELEGRAM_APP_LINK__', vars.TELEGRAM_APP_LINK || '')
```

with `writeAboutHtml` passing `TELEGRAM_APP_LINK` **only when the feature is on**:
`TELEGRAM_ENABLED && (env.TELEGRAM_APP_LINK || '')`. Wrinkle: `TELEGRAM_ENABLED` is a
hardcoded const in `js/features.js` (ESM), not an env var, and `build.js` is CJS — so
`build.js` reads it from the source text
(`/export const TELEGRAM_ENABLED = (true|false)/`). Fragile-looking but honest: it keeps
`js/features.js` the single source of truth, so a post-merge `main` built with the flag
flipped to `false` cannot advertise a dead bot link on `/about` even if
`TELEGRAM_APP_LINK` is still set in `.env.production`. This matches the app-side gate
(`telegramSharingEnabled()` requires both), so page and boot can never disagree.

## 9. End-to-end flows after the change

| Arrival | Today | After |
|---|---|---|
| iOS Telegram webview, fresh, `/?i=` | mints duplicate | → `/invite?i=` → "Open in Telegram" → Mini App, real account |
| iOS Safari, fresh, `/?i=` | welcome → new account | → `/invite?i=` (accepted collateral, §10) → "Continue in browser" → `x-safari` hop with `stay=1` → today's flow |
| Android Telegram webview, fresh | dismissible panel → mints duplicate | → `/invite?i=` → either CTA |
| Android Chrome / desktop, fresh | welcome → new account | unchanged (UA condition false) |
| Android Instagram/WhatsApp/etc., fresh | panel → web account | unchanged (S3) |
| Any browser, stored identity | redeems onto real account | unchanged (gate cond. 4) |
| Telegram Mini App | Telegram identity boot | unchanged (gate cond. 2) |
| Hand-opened `/about?i=` | framing + open-app CTA | same + invite landing section (never redirects) |

## 10. Accepted limits & recorded alternative

- **iOS-Safari collateral:** catching undetectable iOS Telegram means *all* fresh iOS
  invite arrivals (including plain Safari) hop through `/invite`. The framed landing is
  arguably a better first touch than a bare welcome screen; the "Open in Safari?" prompt
  on continue is pre-existing `/about` behavior.
- **S1 alternative (not chosen):** gate on `isInAppBrowser() || isIos()` instead, also
  routing Android non-Telegram in-app browsers through `/invite` for the stronger
  `intent://` break-out. Broader change, more on-device walking; can be adopted later by
  widening one condition (§3 cond. 6).
- **Multi-invite links** are out of scope — `start_param` carries exactly one token
  (predecessor spec §9).
- **Android Telegram users who choose "Continue in browser"** land back in the webview
  flow with `stay=1` and can still create a web account deliberately — that is the
  informed-choice path, not a bug.

## 11. Touch points

| File | Change |
|---|---|
| `firebase.json` | `/invite` rewrite above `**` |
| `js/app.js` | boot redirect gate in `main()`; `cleanInviteParamFromUrl` also deletes `stay` |
| `js/installGuidance.js` | new `isTelegramInAppBrowser()`; export `isIos` |
| `about.template.html` | `#invite-landing` section; move `#about-invite-framing` into it |
| `js/about-telegram.js` (new) | unhide landing on valid token; compose + unhide Telegram CTA (fail-closed) |
| `js/about-cta.js` | append `&stay=1` when token present |
| `scripts/build.js` | `__TELEGRAM_APP_LINK__` substitution gated on `TELEGRAM_ENABLED` (read from `js/features.js`) |
| `css/about.css` | landing/CTA styles |

## 12. Testing

- `tests/installGuidance.test.js`: `isTelegramInAppBrowser()` — Telegram-Android UA
  true; iOS-Safari-identical UA false; plain Chrome false.
- `tests/about-page.test.js`: landing hidden without token / with invalid token; shown
  with valid token; Telegram CTA composed from substituted link + token; CTA stays
  hidden on placeholder/empty link; `data-open-app` rewrites carry `&stay=1` (all three
  platforms); plain `/about` unchanged.
- App boot suite: gate fires (fresh + token + enabled + UA) → `location.replace`
  called with `/invite?i=TOKEN`; each negative condition (identity present, `stay=1`,
  Mini App context, standalone, sharing disabled, non-matching UA) → no redirect.
- `scripts/build.js` unit: substitution present when flag true + link set; empty
  otherwise.
- **Definition of done:** the operator's on-device walkthrough (iOS Telegram, iOS
  Safari, Android Telegram, Android Chrome, desktop), not green suites.
