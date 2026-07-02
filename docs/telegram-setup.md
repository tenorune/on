# Telegram bot + Mini App setup (experimental)

Feature flag: `TELEGRAM_ENABLED` in `js/features.js` (client). Server side is
inert unless the env vars below are set — safe to deploy unconfigured.

## 1. Create the bot
1. Talk to @BotFather → `/newbot` → name it (e.g. "KnockKnock") → get the bot token.
2. `/setmenubutton` → choose the bot → set the menu button to the web app URL
   (your hosting URL, e.g. `https://<project>.web.app`).
3. Optionally `/setcommands`:
   start - Open KnockKnock
   status - Go available (e.g. /status 2h)
   off - Go unavailable
   who - Who's available now
   knock - Knock someone (/knock name)
   groups - Your groups
   notifications - Delivery channel (push|telegram)
   help - Commands

## 2. Configure functions env
In `functions/.env.<projectId>` (gitignored, like FUNCTIONS_REGION):

    TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
    TELEGRAM_WEBHOOK_SECRET=<long random string>
    TELEGRAM_APP_URL=https://<project>.web.app

Note: env-file storage (not Secret Manager) matches this repo's existing
config pattern; acceptable for the experiment, revisit before a broad rollout.

## 3. Deploy + register the webhook
1. Deploy functions: `npx firebase deploy --only functions --project <projectId>`
2. Register the webhook (region + project in the URL — check the deploy output):

    curl -sS "https://api.telegram.org/bot<TOKEN>/setWebhook" \
      -d "url=https://<region>-<projectId>.cloudfunctions.net/telegramWebhook" \
      -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
      -d "allowed_updates=[\"message\",\"callback_query\"]"

3. Verify: `curl -sS "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"`

## How it fits together
- Mini App boot: client sends `Telegram.WebApp.initData` → `validateTelegram`
  callable verifies the signature, bootstraps/loads the account, mints a
  Firebase custom token. Mapping lives in server-only `telegramUsers/{tgId}`
  (+ reverse index `telegramByUid/{uid}` for notification routing).
- Linking: drawer → "I have a secret phrase" → `linkTelegram` (same rate
  limiter as validateRecovery) repoints the mapping to the phrase account.
- Notifications: `sendToUser` sends via the bot when
  `userPrefs/{uid}/notifyChannel === 'telegram'`, falling back to FCM on any
  failure. Toggle: drawer button or `/notifications push|telegram`.
