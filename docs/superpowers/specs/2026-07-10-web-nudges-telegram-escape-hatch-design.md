# Web Nudges: Telegram Escape Hatch — Design Spec

**Date:** 2026-07-10
**Status:** Approved
**Motivation:** Every pre-t1r1jp install/notification nudge sells *install* as the
only road to notifications. The Telegram adaptation added a second road — link
Telegram: no install, no browser permission — but the nudges only know how to
*hide from* it (suppression, spec 2026-07-07-web-nudge-suppression), never *offer*
it. Users stuck on a dead-end web-push lane (iOS tab, macOS Safari tab, in-app
browser, denied permission, unsupported browser, Firefox desktop) are told to
install / switch browsers / dig into settings, when one tap on the onramp would
deliver their notifications today.

## Decisions (operator-confirmed)

1. **Posture: escape hatch.** Web-push/install stays the headline path everywhere.
   Telegram is offered only where web-push is painful or dead. The `installable`
   lane, the supported-state banner, and the onboarding install step are untouched.
2. **Form: actionable CTA.** The dead-end surfaces gain one shared line plus a real
   **Link Telegram** button firing the existing onramp — not a passive pointer at
   the drawer card. Gated on onramp availability AND unlinked.
3. **Precedence: reprompt outranks the onramp promo.** The reprompt (concrete unmet
   intent: enabled bells this device can't deliver) hides the passive promo while
   visible. Completes the chain: first-run → reprompt → onramp promo → install
   toast → FAB. (Previously the two banners could stack — adjacent siblings with no
   mutual awareness.)

## Non-goals

- No change to the `installable` toast lane, its Install button, or the
  supported-state reprompt banner (web push is one tap away there).
- No change to the onboarding install step (`app.js showInstallStep`): a
  just-created account isn't linkable-relevant yet, and the user meets the onramp
  promo immediately after landing.
- No change to the pre-account in-app-browser redirect (`showInAppBrowserRedirect`):
  no account exists yet, so there is nothing to mint. (The *post*-account
  `in-app-browser` guidance state DOES get the hatch.)
- No change for linked accounts with `notifyChannel: 'push'`: they explicitly chose
  push; the gate excludes them.
- No change to the bot-delivered suppression predicate or the three-reader contract.

## Components

### 1. `js/telegramEscapeHatch.js` (new — the `phraseReminder.js` idiom)

Shared HTML block + wiring, consumed by notifyPrompt and installAffordance:

- `escapeHatchAvailable()` → `telegramOnrampEnabled() && !isTelegramLinkedWeb()`.
- `escapeHatchHtml()` → the line + button markup:
  copy: **"Or link Telegram to get notified there — no install or browser
  permission needed."** button: **"Link Telegram"**. Returns `''` when unavailable,
  so callers can append unconditionally.
- `wireEscapeHatch(container)` → binds the button (if present) to
  `startTelegramOnrampFromNudge(btn)`.

Imports: `telegramOnramp.js` (starter + enabled), `notifySuppression.js` (linked
flag). No cycles: telegramOnramp does not import notifyPrompt or this module.

### 2. `js/telegramOnramp.js` — exported nudge starter

`startTelegramOnrampFromNudge(btn)`: wraps `startTelegramOnramp()` with the same
semantics the promo/drawer `go()` has — disable the button in flight, arm the
`_ctaTapped` success beat on success (so the web-side "Linked — …" toast fires when
the prefs echo lands). Mint-failure toast is already inside the starter.

Promo gate gains the reprompt term:
`promoActive = show && !bannerDismissed() && !isFirstRunActive() && !isRepromptActive()`,
plus a once-bound document listener on `reprompt-change` → `refresh()` (mirrors
`_firstRunBound`).

### 3. `js/notifySuppression.js` — coordination flags (existing pattern)

Already receives full prefs each tick; additionally records:

- `isTelegramLinkedWeb()` — `prefs?.telegram != null`, web only. This is the linked
  marker's **5th reader**; the cross-ref comment block (W2 C10) is extended.
- `setRepromptActive(v)` / `isRepromptActive()` + a `reprompt-change` document
  CustomEvent fired only on value change (mirrors `bot-delivery-change`).
- `__reset…ForTests` extended accordingly.

Consumers read flags at decision time and re-run on events (the established
`isFirstRunActive` pattern) — boot order (initNotifyPrompt before initTelegramOnramp)
is therefore safe: the onramp's initial `refresh()` reads the flag directly.

### 4. `js/notifyPrompt.js` — feed + hatch on dead-end surfaces

- `refreshPromoVisibility()` calls `setRepromptActive(visible)` on every evaluation
  (hidden paths included).
- `renderBanner` guidance branch (states `needs-install-ios`, `needs-install-macos`,
  `in-app-browser`, `denied`, `unsupported`): append `escapeHatchHtml()` after the
  phrase reminder, then `wireEscapeHatch(textEl)`.
- `showRegistrationFailed`: same append + wire (a genuine dead end — permission
  granted but token setup failed).
- Supported-state banner: untouched.

### 5. `js/installAffordance.js` — hatch on hard toast lanes

`fillToast` lanes `ios-install`, `macos-install` (after the phrase reminder) and
`push-in-tab` (the copy becomes HTML there): append `escapeHatchHtml()` +
`wireEscapeHatch(textEl)`. The `installable` lane is untouched. (The toast already
hides entirely when bot-delivered or while the onramp promo is up, so hatch-in-toast
only ever shows to unlinked users with the promo dismissed — exactly the audience
that declined the banner but is now on a dead-end lane.)

## Copy

One shared string, used verbatim on every surface (single source in
telegramEscapeHatch.js):

> Or link Telegram to get notified there — no install or browser permission needed.
> [Link Telegram]

## Error handling

- Mint failure: existing toast ("Couldn't reach Telegram right now. Try again."),
  button re-enabled.
- Storage/config absent: `escapeHatchAvailable()` false → block renders empty;
  surfaces degrade to today's behavior exactly.

## Testing (TDD, web suite)

- `tests/telegramEscapeHatch.test.js` (new): availability × {config on/off, linked/
  unlinked}; html empty when unavailable; click → starter called, disabled in
  flight, re-enabled after.
- `tests/notifyPrompt.test.js`: each guidance state × available/unavailable renders/
  omits the hatch; registration-failed includes it; supported state never does;
  `setRepromptActive` fed on show AND hide paths.
- `tests/installAffordance.test.js`: hatch present on ios/macos/push-in-tab lanes,
  absent on installable; absent when linked.
- `tests/telegramOnramp.test.js`: promo hidden while reprompt active, resumes on
  `reprompt-change`; `startTelegramOnrampFromNudge` arms the success beat and
  disables the button.
- `tests/notifySuppression.test.js`: new flags + event-only-on-change.
- Existing notify-channel vectors + name-cap invariant suites stay green (no
  predicate changes).

## Files touched

`js/telegramEscapeHatch.js` (new), `js/telegramOnramp.js`, `js/notifySuppression.js`,
`js/notifyPrompt.js`, `js/installAffordance.js`, `css/app.css` (hatch button spacing
if needed), tests as above. No functions/, no rules, and no index.template.html
changes — the hatch renders inside existing banner/toast text elements.
