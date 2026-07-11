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
| Q7=C+A | Installed-PWA recipients: platform link-capturing where it exists + the "Redeem an invite" form (N6 — a universal affordance for all users, not PWA-only) + a tertiary landing door. |
| A1 | `buildInviteUrl` → `/invite?i=TOKEN`; the `/?i=` boot gate remains as the net for legacy/copied links. |
| A2 | `/invite?i=` renders config #1 (invite-first); `/about?i=` renders config #2 (full page + invite block). Pages never redirect or auto-hop. |
| A3 | Browser-opened `/about` always shows a standing bare "Open in Telegram" CTA (fail-closed on the build substitution). |
| A4 | Mini App interstitial gains a "What is KnockKnock?" link → `/invite?i=TOKEN`, shown only in the `isNew` ("Accept & get started") context. |

Flows F0–F9 and the boot decision tree: see the HTML spec.

### Challenge round (2026-07-10, post-v1)

| Ref | Disposition |
|---|---|
| C1 | Adopted: **identity-aware pass-through** on config #1 (N4). Desktop-Telegram routing evidence covers `/?i=` only; routing is scope-based so `/invite?i=` should follow — walkthrough item. |
| C2 | Adopted: `stay=1` appended unconditionally (was: token-only) — closes a phase-2 redirect loop via the `intent://` `browser_fallback_url`. |
| C3 | Accepted limit: a stored identity outranks the Telegram-Android auto-hop, so a pre-existing #283 duplicate in that webview would keep receiving invites. No distinguishing signal exists; no such case reported; revisit if one appears. |
| C4 | Adopted: config #1 keeps the intro's first sentence visible above the expander. |
| C5 | Adopted, implement-and-evaluate: on iOS the installed-app door is visually promoted. |
| C6 | Adopted: the redeem input also accepts `t.me/…?startapp=TOKEN` links. |
| C7 | Adopted: copy-invite failure falls back to the URL as selectable text. |
| C8 | Withdrawn — operator-verified (see below). |
| C9 | Adopted; shape revised twice — tab pair considered, then superseded by a **unified single form** with content-detected mode + invite preview (U1+preview, N6). |
| C10 | Accepted limit (a copied `/?i=…&stay=1` address-bar URL neutralizes the net for its recipient — small window) + N4 wording tightened. |
| Q8=C | Bare-`/` blind spot (undetectable iOS webviews; no token → no net): closed by a **phase 3** — every fresh tokenless boot redirects to `/about` (exemptions: `stay=1`, `setup=install`); signed-in users pass through as today. Own evaluation gate after the phase-2 walkthrough, because it lengthens the primary new-user funnel (one hop + the iOS "Open in Safari?" prompt) for everyone. |

Operator-verified during brainstorm: a `t.me/…?startapp=…` link tapped in an Instagram DM
opens the Mini App; t.me group invites accepted in Telegram work; web group invites work,
including via `/about?i=`; desktop Telegram routes `/?i=` links into the installed app,
plain browsers do not.

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
iOS-undetected tokenless boots do not yet redirect. Phase 3 (Q8=C) widens that branch to
**all** fresh tokenless boots — the `isInAppBrowser()` condition drops, and the exemption set
becomes `stay=1` OR `setup=install` (the Safari install-hop, `app.js:191-203`, is deliberately
a fresh identity-less boot and must keep showing install guidance). SW cold-start intents
(`?inbox`/`?direct`/`?group`) need no exemption — identity always exists there (gate row 3).
`cleanInviteParamFromUrl` (`app.js:555`) also deletes `stay`. Phase 2 removes
`showInAppBrowserRedirect` and its call site.

### N4 — Page behavior (`about.html` = `/about` + `/invite`)
- Pages never redirect and never auto-hop for *fresh* visitors. One exception, C1's
  **identity-aware pass-through**: on config #1 only (`/invite` + valid token), when
  `localStorage.statusapp_identity` exists in this context (`js/identity.js:4`; same-origin —
  the template's theme script already reads app localStorage), immediately continue to
  `/?i=TOKEN&stay=1` in the same window. With an identity there is no mint risk, and this
  repairs the F5 extra-tap, group-invites-to-members, and the desktop app-window capture case.
  Hand-shared `/about?i=` (config #2) deliberately does not pass through — it is a reading page.
- Config by `location.pathname` (first path-sensitive behavior in the about scripts; applies
  to the about page only): `/invite` + valid token → config #1; `/about` + valid token →
  config #2; no/invalid token → plain page (tokenless `/invite` behaves as plain `/about`).
- Token shape: `/^[A-Za-z0-9_-]{1,64}$/` (as `about-invite.js:11`, `about-cta.js:22`).
- Invite block (both configs): static headline; existing `#about-invite-framing` moves inside
  unchanged (`about-invite.js` untouched); equal CTA pair — "Open in Telegram"
  (`data-telegram-link + '?startapp=' + token`) and "Continue in browser" (`data-open-app`
  break-out); tertiary installed-app line with one-tap "Copy invite" (copies the canonical
  `/invite?i=TOKEN` URL). Clipboard write failure (common in webviews) falls back to showing
  the URL as selectable text (C7). On iOS (`isIos`-equivalent inline check, as `about-cta.js`
  already does) the installed-app door is visually promoted — implement-and-evaluate (C5).
- One set of doors: while the invite block shows, the intro hides both of its CTAs.
- Config #1 collapse (v1): everything below the logo folds behind one expander
  ("More about KnockKnock"), except the intro's first sentence, which stays visible so a
  stranger has minimum context to choose a door (C4). Script-off fallback = fully expanded.
  Finer split: followup.
- Standing bare Telegram CTA (A3): token-less pages show "Open in Telegram" → bare
  `t.me/<bot>/app` beside "Open KnockKnock →".
- Fail-closed: every Telegram CTA renders hidden; unhide only when `data-telegram-link` is
  non-empty and not an unsubstituted `__…__` placeholder (mirrors `about-invite.js:15`).
- Loop guard: `about-cta.js` appends `stay=1` to **every** link it rewrites, token or not
  (x-safari, `intent://` incl. `browser_fallback_url`, desktop plain) — a tokenless
  `browser_fallback_url` re-entering the webview would otherwise loop through the phase-2
  bare-arrival redirect (C2). The x-safari break-out itself is unchanged pre-existing behavior.
- New logic in a new single-purpose classic script `js/about-telegram.js`;
  `about-cta.js` changes only for `stay`.

### N5 — Build substitution (`scripts/build.js`)
`renderAbout()` gains `__TELEGRAM_APP_LINK__` = `TELEGRAM_ENABLED && env.TELEGRAM_APP_LINK || ''`.
`TELEGRAM_ENABLED` is a hardcoded const in `js/features.js` (ESM) — `build.js` (CJS) reads it
from the source text via `/export const TELEGRAM_ENABLED = (true|false)/`, keeping
`features.js` the single source of truth so the page can never disagree with
`telegramSharingEnabled()` (a post-merge flag-off build cannot advertise a dead bot link).

### N6 — In-app invite redemption: the unified "Redeem an invite" form (U1 + preview)
A universal affordance for **every** signed-in user on every platform — paste any invite
you were handed and redeem it in place. The installed-PWA recipient (Q7=C+A) is its most
load-bearing consumer (no other path reaches their identity on iOS), not its only one.
- **One form, content-detected mode.** Today's single button and form stay
  (`index.template.html #add-person-form`, `js/following.js`); no tabs. Copy changes
  (operator-set): the button reads **"Redeem an invite"** (was "Add a person"); the field
  label reads **"Code or invite link"** (was "Code"); the placeholder is updated to cover
  both shapes (e.g. `XK7P2M or an invite link` — final wording on device). The input accepts
  anything (`maxlength="6"` lifts). The form watches the trimmed input:
  - 6-char code (today's shape) → **code mode**: today's behavior — Name field, "Follow"
    button, same validation and errors. The first-run demoted *relabel* (`js/firstRun.js:62`,
    "Add by code") is **removed** — the button reads "Redeem an invite" in every state
    (operator: with the rename it makes sense always); the demoted styling toggle stays.
  - Recognized invite — a URL with an `i=` param, a `t.me/…?startapp=TOKEN` link (C6), or a
    raw 22-char base64url token (`/^[A-Za-z0-9_-]{22}$/`, the token length from
    `js/invites.js`) → **invite mode**: the Name field hides, the button reads "Redeem
    invite", and a status line under the input announces the detection. The unauthenticated
    `resolveInvitePreview` fires and upgrades that line to "You'll follow **Ana**" /
    "You'll join **'Hikers'**" when it resolves (fail-soft: line stays at "Invite link
    detected" on any preview failure; redemption still proceeds on submit).
  - Anything else on submit → inline error: "That doesn't look like a code or an invite link."
- Redemption reuses the existing pipeline (`attemptRedeemFromUrl` +
  `handleInviteRedemptionResult`), so personal and group invites both work.
- Followup (not v1): keep the Name field in invite mode as a local-label override (U3) —
  needs a post-redeem rename step; label plumbing exists in `following.js`.
- C-side: desktop Telegram routes `/?i=` into the installed app (operator-observed; `/invite?i=`
  expected to follow — walkthrough). Android `intent://`→WebAPK hand-off: walkthrough item.
  Manifest `launch_handler` tuning: possible followup, out of scope.

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
- **Phase 2** (after the phase-1 walkthrough): tokenless bare-arrival redirect for detected
  in-app browsers (F8) + panel retirement.
- **Phase 3** (Q8=C; own evaluation gate after the phase-2 walkthrough): the tokenless
  redirect widens to all fresh boots — root `/` becomes signed-out-landing / signed-in-app.
  Evaluate the funnel cost on device before keeping it.
- **Followups:** config #1 fine-grained content split; interstitial-opened page variant
  (loop-back CTA); copy tuning; manifest link-capturing.
- **Done =** the operator's on-device walkthrough, not green suites.

Accepted limits: C3 (stored identity outranks the Telegram-Android auto-hop — a pre-existing
#283 duplicate in that webview keeps receiving invites; revisit on first real report); C10
(a copied `/?i=…&stay=1` address-bar URL neutralizes the boot net for its one recipient);
`start_param` carries exactly one token — multi-invite links out of scope (spec 2026-07-05 §9);
interim (until phase 3 ships): a bare `/` link in an undetectable iOS webview still boots the
welcome flow and can mint a stray web account — no token, no UA signal, nothing to gate on.

## 5. Testing

Unit (jest, `node_modules/.bin/jest` from repo root):
- `installGuidance`: `isTelegramInAppBrowser()` true on Telegram-Android UA, false on
  Safari-identical iOS UA and plain Chrome; `isIos` export intact.
- `invites`: `buildInviteUrl` shape.
- `about-page`: config selection by path + token; invite block visibility; both intro CTAs
  hidden with the block; Telegram CTA fail-closed (placeholder/empty), composed
  `?startapp=` href; `stay=1` on all three rewrite platforms, with and without a token (C2);
  identity-aware pass-through fires on config #1 with `statusapp_identity` present and never
  on config #2 or without identity (C1); copy-invite affordance + selectable-text fallback
  (C7); iOS door promotion (C5); tokenless `/invite` = plain page; plain `/about` shows the
  standing CTA only when substituted.
- App-boot suite: each gate row fires/doesn't (order-sensitive: identity beats detection,
  `stay` beats everything but Mini App); `location.replace` targets; `stay` stripped.
- `following`: button/label/placeholder copy ("Redeem an invite" / "Code or invite link");
  mode detection — 6-char codes keep today's behavior; `firstRun` relabel removed (button
  label constant; demote styling intact); `i=` URLs, `startapp=` URLs, and raw 22-char
  tokens switch to invite
  mode (Name hidden, button "Redeem invite", status line shown); preview upgrade on resolve
  and fail-soft on preview error; garbage on submit → inline error; redemption pipeline
  reuse; mode switches back cleanly when the input changes.
- `telegramFirstRun`: info link present iff `isNew`; choice resolutions unchanged.
- `build.js`: substitution on/off with the features-flag read.

Walkthrough matrix (operator, on device): iOS Telegram · iOS Safari · Android Telegram ·
Android Chrome · Android Instagram-class webview · desktop · installed-PWA on each platform.
UNKNOWNs to resolve there: Telegram-Android interception of the auto-hop `location.replace`;
Android `intent://` + `stay=1` round-trip; Android `intent://`→WebAPK hand-off; Firebase
rewrite query preservation; desktop-Telegram routing of `/invite?i=` (C1 — evidence covers
`/?i=` only) and that the pass-through inside a captured app window boots and redeems;
clipboard-write success inside Telegram/Instagram webviews (C7); whether the iOS-promoted
installed-app door gets found (C5). Phase-3 gate additionally walks: new-user first touch on
every platform (the extra hop + iOS prompt), `setup=install` exemption regression, and
fresh-device restore reachability via `/about`.

## 6. Touch points

`js/invites.js` (N1) · `firebase.json` (N2) · `js/app.js` (N3) · `about.template.html` +
`css/about.css` + `js/about-telegram.js` (new) + `js/about-cta.js` (N4) · `scripts/build.js`
(N5) · `js/following.js` + `index.template.html` (N6) · `js/installGuidance.js` (N7) ·
`js/telegramFirstRun.js` + Mini App template (N8) · tests per §5.
