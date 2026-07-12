# Web Nudge Suppression for Bot-Delivered Accounts — Design Spec

**Date:** 2026-07-07
**Status:** Approved
**Motivation:** Web/PWA sessions of a Telegram-linked account still push install and
web-push nudges whose stated purpose — getting notified — is already served by the
bot. Recorded as the first known gap in the onboarding spec
(2026-07-05-telegram-onboarding-ux-design.md §9, "Web/PWA sessions of a linked
account are blind to the Telegram link").

## Summary

When a **web** session belongs to a **linked** account whose notification channel is
**Telegram**, hide the install toast/FAB and the notify-promo banner, and make bell
toggles set prefs without demanding web-push permission. The state is derived live
from `userPrefs` on every prefs tick, so link, unlink, and channel switches from any
device flip the suppression without a reload. Switching the channel pill to **Push**
immediately runs the permission/enable flow — the one moment a suppressed user
re-enters the web-push world, and the moment silence would be worst.

## The suppression condition

```
botDelivered(prefs) := prefs?.telegram != null && prefs?.notifyChannel !== 'push'
```

- `userPrefs.telegram` is the server-maintained link marker: set on link, cleared on
  unlink (functions/telegram-auth.js). On web it is exactly "this account is
  linked" — derived (unlinked) Telegram accounts never reach the web
  (js/notifyChannel.js `isLinked`).
- `notifyChannel !== 'push'` mirrors the pill's default-to-telegram semantics
  (js/notifyChannel.js:70): the server stamps `'telegram'` on link, but a missing
  value on a linked account must read as telegram in both places. The two predicates
  must never disagree; a comment in each file binds them.
- Web-only: in Telegram context the entire install/web-push machinery is already
  gated off at init (app.js:732) and inside notifyPrompt (spec
  2026-07-05 §9 as-built), so suppression state is not tracked there.

## Components

### 1. `js/notifySuppression.js` (new)

Owns the state. Exports:

- `botDelivered(prefs)` — the pure predicate above.
- `syncBotDelivery(prefs)` — no-op in Telegram context; recomputes the flag and
  dispatches a `bot-delivery-change` document CustomEvent **only when the value
  changes**.
- `isBotDelivered()` — current flag, read by consumers at decision time.

No imports beyond `./telegram.js` (`isTelegramContext`). No DOM knowledge beyond
dispatching the event.

### 2. Feed points

- **app.js prefs tick** (app.js:722): `syncBotDelivery(serverPrefs)` added beside
  `syncNotifyChannel(userId, serverPrefs)`. This is the sole server-truth feed:
  link/unlink and cross-device channel switches all arrive here.
- **notifyChannel.js pill click** (optimistic): `syncNotifyChannel` keeps the last
  prefs it was called with in a module-level variable. On a successful
  `mergeUserPrefs` the click handler calls
  `syncBotDelivery({ ...lastPrefs, notifyChannel: next })` so the flag flips without
  waiting for the watchUserPrefs echo. A failed merge (the existing revert path)
  never calls it.

Init ordering is safe in both directions: the tick may fire before or after
`initInstallAffordance`/`initPushNotifications` (app.js:732-735); consumers read the
flag at apply time and re-run on the event.

### 3. Consumers

- **installAffordance.js**: `apply()` gains an `isBotDelivered()` branch that hides
  both the toast and the corner FAB (same effect as the `ready` lane). A
  `bot-delivery-change` listener re-runs `apply()` — the existing
  `first-run-change` pattern (installAffordance.js:106). Install copy for
  non-suppressed users is unchanged.
- **notifyPrompt.js**:
  - `refreshPromoVisibility()`: hide the banner and return when `isBotDelivered()`,
    checked beside the existing `isTelegramContext()` check. The reprompt's premise
    ("your on-bells deliver nothing on this device") is false for these users — the
    bot delivers them.
  - `ensureNotificationsReady()`: early-return when `isBotDelivered()`, beside the
    existing Telegram return. Bell toggles then just write prefs — correct, since
    the notifier routes by channel (functions/notifier.js:25).
  - A `bot-delivery-change` listener re-runs `refreshPromoVisibility()`. This is
    what revives the reprompt when suppression lifts (unlink, or switch to Push,
    from any device).

### 4. Switch-to-Push moment

In the pill click handler (notifyChannel.js), after a successful merge **to
`push`**: optimistic `syncBotDelivery` (flag now false), then
`ensureNotificationsReady()` — capability detection, the OS permission prompt, or
the right guidance banner, immediately. The user just expressed intent to receive
web push; without this, a device with no permission would go silent until some
later prefs event.

- Import direction `notifyChannel.js → notifyPrompt.js` is new and cycle-free
  (notifyPrompt does not import notifyChannel).
- In Telegram context the call is inert (`ensureNotificationsReady`'s existing
  early return): inside the Mini App there is no web-push to set up — the switch
  affects the user's other (web) devices, which will reprompt via their own prefs
  echo.
- Switching **to `telegram`** needs no prompt; the optimistic sync suppresses the
  nudges instantly (a visible reprompt banner disappears on the spot).

## What stays untouched, deliberately

- **Per-person bells** (notifyBell.js): they choose *what* to be notified about,
  channel-independent — the bot notifier respects the same prefs.
- **The channel pill** (notifyChannel.js UI): it is the control for this state and
  the spec-designated home for link visibility on web.
- **`refreshPushToken` self-heal** (notifyPrompt.js:64): keeps running for
  suppressed users. The server routes by `notifyChannel`, so a fresh token is
  harmless — and it makes a later switch to Push land instantly.
- **Onboarding install modal + in-app-browser redirect** (app.js:414, :448):
  boot-time surfaces that fire before prefs exist; a freshly created web account
  cannot be linked. Out of scope.

## Failure / edge handling

- `prefs` null or missing → `botDelivered` false → no suppression (fail open to
  today's behavior).
- Unlink from another device: server clears `telegram` and sets
  `notifyChannel:'push'` (telegram-auth.js:156) → prefs echo → flag false → event →
  nudges revive live.
- Event dispatched only on change: no re-render churn on every prefs tick.
- Pill merge failure: optimistic UI reverts (existing behavior) and the flag is
  never flipped — no prompt fires for a switch that didn't happen.

## Testing (TDD, web suite — `npx jest` at repo root)

- **notifySuppression.test.js** (new): predicate truth table — linked+telegram
  true; linked+push false; linked+missing-channel true; unlinked false; null/empty
  prefs false. `syncBotDelivery`: event fires on change only (0→1→1→0 dispatches
  twice); Telegram-context no-op leaves the flag false.
- **notifyPrompt.test.js** (extend): banner hidden when suppressed even when
  `shouldReprompt` conditions all hold; `ensureNotificationsReady` requests no
  permission and shows no banner when suppressed; banner revives after the flag
  flips and `bot-delivery-change` fires.
- **installAffordance.test.js** (extend): toast and FAB hidden when suppressed in
  an otherwise-showing lane; reappear on `bot-delivery-change` after the flag
  clears.
- **notifyChannel.test.js** (extend): push-click → optimistic flag flip +
  `ensureNotificationsReady` called once; telegram-click → suppresses immediately,
  no prompt call; merge rejection → flag unchanged, no prompt call.

## Accepted trade-offs

- A suppressed user loses the install nudge entirely (Q1 decision A): install's
  only in-product framing is notification delivery, which the bot already serves.
  If install-for-its-own-sake becomes a goal, that is copy + a new lane decision,
  not this mechanism.
- The optimistic pill sync trusts the merge promise; a server-side rules rejection
  after a resolved write is not a case RTDB produces (rules reject before resolve).
- Suppression state is per-session-computed, never persisted: a stale flag cannot
  outlive its inputs.
