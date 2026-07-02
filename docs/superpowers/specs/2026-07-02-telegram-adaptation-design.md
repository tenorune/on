# Telegram Adaptation — Design Spec

**Date:** 2026-07-02
**Status:** Approved (brainstorming session)
**Branch:** `claude/telegram-app-adaptation-t1r1jp`
**Flag:** `TELEGRAM_ENABLED` in `js/features.js` — `true` on this branch, `false` when merged to `dev`/`main`.

## Summary

An experimental, full-featured adaptation of KnockKnock on Telegram:

- **Telegram Mini App** — the existing web app, adapted, running inside Telegram's
  webview. Near-total feature parity (availability, knocks, calls + shared canvas,
  palettes, favorites, groups, inbox) because it IS the app.
- **Companion bot** with a **full command interface** — the core loop (go available,
  see who's free, knock) works from chat without opening the Mini App.
- **Auto sign-in** via Telegram's signed identity, with optional **linking** of an
  existing phrase account.
- **Notifications switch to Telegram** bot messages when linked (replacing Web Push),
  with a user toggle to switch back to push.
- Everything lives in the existing repo and Firebase project (no new infrastructure).

Features that cannot work inside the webview (PWA install, OS push permission) direct
the user to open the app in a browser instead.

## 1. Identity & account linking

- New callable Cloud Function **`validateTelegram({ initData })`**:
  - Verifies Telegram's signed `initData` per the Web App spec: HMAC-SHA256 where the
    secret key is `HMAC_SHA256(bot_token, "WebAppData")`, plus an `auth_date`
    freshness check.
  - Resolves the Telegram user id to an app uid and mints a Firebase custom token —
    the same mechanism as `validateRecovery`, so security rules
    (`auth.uid === $uid`) and everything downstream are untouched.
- **Uid resolution** via a server-only mapping **`telegramUsers/{tgId}` →
  `{ uid, chatId, linkedAt }`**:
  - First open: no mapping → derive a fresh uid = `sha256("telegram:" + tgId)`,
    first 32 hex chars (same format as phrase uids), write the mapping. The user
    lands in a working new account with zero typing.
  - Subsequent opens: mapping exists → mint token for the mapped uid.
- **Linking an existing phrase account:** Mini App settings → "I already have an
  account" → type the 4-word phrase once → callable **`linkTelegram({ initData,
  code })`** verifies both (phrase goes through the same rate limiter as
  `validateRecovery`), repoints `telegramUsers/{tgId}.uid` to the phrase-derived uid,
  and re-signs in. From then on the Telegram entry point lands in the linked account.
- **Unlink:** reverts the mapping to the Telegram-derived uid.
- The auto-created starter account is **orphaned** if the user later links a phrase
  account. Accepted for an experiment; documented here.
- Inside Telegram the client **always auths from `initData` on boot** — never the
  locally stored session. Zero friction, always fresh, immune to webview-storage
  quirks.

## 2. Bot: webhook, commands, notification channel

### Webhook

- **`telegramWebhook`** HTTPS Cloud Function (v2 `onRequest`), registered via the Bot
  API `setWebhook`. Requests validated by the `X-Telegram-Bot-Api-Secret-Token`
  header against a configured webhook secret.
- Bot token and webhook secret are **env vars** (`TELEGRAM_BOT_TOKEN`,
  `TELEGRAM_WEBHOOK_SECRET`) from `functions/.env` — see §5.
- Raw Bot API via `fetch` — **no bot framework**, matching the repo's no-dependency
  ethos.
- Command router in a new **`functions/telegram.js`**, dependency-injected like
  `notifier.js` so it tests without network.

### Commands

| Command | Behavior |
|---|---|
| `/start` | Welcome + Mini App launch button; stores `chatId` in `telegramUsers/{tgId}` |
| `/status [30m\|2h\|...]` | Go available with a timer (default 1h when no duration given), using the user's saved color/status |
| `/off` | Go unavailable |
| `/who` | List contacts currently available |
| `/knock <name>` | Knock a contact, matched against the user's following labels; inline keyboard when ambiguous |
| `/groups` | List groups + per-group status |
| `/notifications push\|telegram` | Switch the notification delivery channel |
| `/help` | Command reference |

Command handlers resolve the Telegram sender through `telegramUsers` and write the
**same RTDB nodes the app writes** (via the Admin SDK, mirroring client write shapes).

### Notifications as bot messages

- Bot messages carry **inline action buttons**:
  - knock → "Knock back"
  - availability → "Knock"
  - invite → "Accept / Decline"
  - follow request → "Approve / Decline"
  - call → deep-link button into the Mini App to answer (the canvas needs the app)
- Callback-query handlers resolve the sender via `telegramUsers` and perform the same
  writes the app would.

### Channel switch

- In the single existing delivery choke point, **`sendToUser()`** (`functions/notifier.js`):
  - If `userPrefs/{uid}/notifyChannel === 'telegram'` and a `chatId` exists →
    Telegram `sendMessage`.
  - On Telegram send failure (user blocked the bot, etc.) → **fall back to FCM**
    tokens.
  - Otherwise → FCM as today.
- **Linking sets the channel to `telegram`.** The user can flip it back to `push` in
  Mini App settings or via `/notifications push`.

## 3. Mini App client adaptation

- Add Telegram's `telegram-web-app.js` script to `index.template.html` (tiny, inert
  outside Telegram).
- New **`js/telegram.js`** adapter; `isTelegram()` = `TELEGRAM_ENABLED &&
  Telegram.WebApp.initData` non-empty.
- In Telegram context:
  - Skip phrase onboarding; auth via `initData` (`validateTelegram` →
    `signInWithCustomToken`).
  - **Hide** PWA-install affordances and Web-Push permission prompts (meaningless in
    the webview); show a "Notifications via Telegram" state in their place.
  - Settings gain **"Link my account"** and the **notification channel toggle**.
  - `Telegram.WebApp.expand()` + safe-area handling; Telegram chrome
    (header/background color) set to match the app background. App theming otherwise
    stays the app's own — palettes are core to the product.
  - Invite links shared via Telegram's share sheet.
- Everything else runs as-is inside the webview. The only "go to the app" cases are
  OS-level: installing the PWA and OS push permission — those show a pointer to open
  the app in a browser.

## 4. Data model & security rules

| Node | Access | Content |
|---|---|---|
| `telegramUsers/{tgId}` | server-only (deny client read/write, like `notifierState`) | `{ uid, chatId, linkedAt }` |
| `telegramByUid/{uid}` | server-only, deny-all client read/write | `{ tgId, chatId }` — reverse index for notification sends — kept server-only so a client can't redirect notifications |
| `userPrefs/{uid}/telegram` | owner-visible link state (display only; routing uses telegramByUid) | `{ tgId, linkedAt }` — lets the app show link state |
| `userPrefs/{uid}/notifyChannel` | owner read/write, `.validate` ∈ `push\|telegram` | delivery channel |

Rules added to `database.rules.json` with rules tests.

## 5. Feature flag & deploy posture

- **`TELEGRAM_ENABLED`** in `js/features.js`, following the existing compile-time
  flag convention. `true` on this feature branch; `false` at merge.
- Server side is **inert without the bot-token secret configured** — merging the
  functions code is safe regardless of the flag.
- Server config (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
  `TELEGRAM_APP_URL`) comes from `functions/.env.*` env vars, not Functions
  secrets — matching the repo's existing config pattern (see
  `functions/.env.example`).
- Docs: a setup page under `docs/` covering BotFather bot creation, secrets,
  `setWebhook` registration, and the bot menu button.

## 6. Testing

- **Functions Jest** (`cd functions && npm test`): initData verification vectors,
  command router, callback actions, `sendToUser` channel switch + FCM fallback.
- **Web Jest** (`npx jest`): adapter detection, Telegram boot/auth path, UI gating
  (install/push affordances hidden, Telegram settings shown).
- **Rules tests** (`npm run test:rules`): new nodes' access constraints.

## Accepted trade-offs

- Starter (Telegram-derived) account is orphaned when a phrase account is linked.
- Users active on both surfaces get a single channel (no dual delivery); switching is
  manual.
- Bot command writes mirror client write logic in the Admin SDK (bypassing rules);
  invariants are maintained by shared/mirrored code, verified by tests.
