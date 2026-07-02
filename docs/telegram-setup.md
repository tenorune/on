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
In `functions/.env` (gitignored in this repo; loaded on every functions deploy):

    TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
    TELEGRAM_WEBHOOK_SECRET=<long random string>
    TELEGRAM_APP_URL=https://<project>.web.app

(For a preview-channel test of the feature branch, `TELEGRAM_APP_URL` is the
preview URL instead — see §4.)

**Warning:** do NOT put the bot token or webhook secret in
`functions/.env.<projectId>` — that file is tracked in this repo (it carries
the non-secret `FUNCTIONS_REGION`); committing a bot token there would leak
it. `TELEGRAM_APP_URL` isn't secret and can live wherever convenient, but the
simplest setup is all three vars in `functions/.env`.

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

## 4. Preview channel from the feature branch (test without merging)

Test the flagged-on branch build end-to-end while `dev`/`main` and the live
site stay untouched. Preview channels cover **Hosting only** — Functions and
database rules have no preview equivalent, so those deploy to the live
project. That's safe here by design: the branch's functions/rules changes are
additive and fully inert until the §2 env vars are set, and the live site
keeps serving its own (flag-off) build.

Commands assume macOS (zsh in iTerm) at the repo root.

1. **Build from the branch** (the bundle bakes in `TELEGRAM_ENABLED=true`):

       git fetch origin claude/telegram-app-adaptation-t1r1jp
       git switch claude/telegram-app-adaptation-t1r1jp
       npm install && (cd functions && npm install)
       npm run build        # uses .env.production for the Firebase web config

2. **Deploy Hosting to a preview channel** (30d is the max lifetime):

       npx firebase hosting:channel:deploy telegram --expires 30d --project <projectId>

   The output prints the channel URL, shaped like
   `https://<projectId>--telegram-<hash>.web.app`. It stays stable for the
   channel's lifetime (redeploys reuse it). Grab it onto the clipboard for the
   BotFather step:

       npx firebase hosting:channel:list --project <projectId>
       printf '%s' 'https://<projectId>--telegram-<hash>.web.app' | pbcopy

   The branch's `firebase.json` headers (CSP `script-src https://telegram.org`,
   `frame-ancestors` for telegram.org) apply to the channel automatically —
   Telegram Web can frame the preview, and the live site's headers are
   unchanged.

3. **Configure env, then deploy functions + rules to the live project.** Set
   the three §2 vars in `functions/.env` with `TELEGRAM_APP_URL` = the preview
   URL from step 2 (env is baked in at deploy time, so set it first):

       npx firebase deploy --only functions,database --project <projectId>

4. **Point the bot at the preview URL:** BotFather → `/setmenubutton` → your
   bot → paste the preview URL (⌘V from step 2). The Mini App button now opens
   the flagged-on preview build; the production URL is not involved.

5. **Register the webhook** exactly as in §3 — it targets
   `cloudfunctions.net`, which is independent of hosting channels, so nothing
   changes for a preview test.

Renewing / cleaning up:

- Re-running step 2 redeploys to the **same** URL and resets the expiry.
- When done: `npx firebase hosting:channel:delete telegram --project <projectId>`,
  then point BotFather's menu button back (and update `TELEGRAM_APP_URL` +
  redeploy functions if the bot should keep working against the live site).

Caveats:

- The preview build talks to the **live** Firebase project — accounts created
  from Telegram are real RTDB records (fine for the experiment; production web
  users still run the flag-off build and notice nothing).
- The `sendToUser` Telegram channel switch goes live for any account that
  links Telegram, since Functions aren't channel-scoped — that's the point of
  the test, but remember unlinking/`/notifications push` restores Web Push.
- If the Firebase web API key has HTTP-referrer restrictions (Google Cloud
  console → Credentials), add the preview domain, or sign-in calls will 403.

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
