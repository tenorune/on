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

## 4. Preview channel from the feature branch (dev project, test bot)

Test the flagged-on branch build end-to-end on the **dev Firebase project**,
without merging — `dev`/`main` and the production project stay untouched.
Preview channels cover **Hosting only**; Functions and database rules have no
preview equivalent, so those deploy to the dev project itself (they're
additive and inert until the §2 env vars are set, and everything on dev is
disposable anyway).

Use a **test bot**, not the eventual production bot. A bot's webhook and menu
button are global singletons you'll be repointing during testing, and
`initData` validation is keyed by the bot token, so bot ↔ project is
effectively 1:1: test bot ↔ dev project now, a fresh prod bot ↔ prod project
at launch. Create it per §1 (e.g. `KnockKnockDevBot`) and use ITS token in the
§2 env vars.

Commands assume macOS (zsh in iTerm) at the repo root. The dev project id
lives in `.env.local`; put it in a shell variable once:

    DEV_PROJECT=$(grep '^FIREBASE_PROJECT_ID=' .env.local | cut -d= -f2)
    echo "$DEV_PROJECT"

1. **Build from the branch with the dev web config** (the bundle bakes in
   `TELEGRAM_ENABLED=true`; `dev-build.js` reads `.env.local`, same as
   `npm run deploy:dev`):

       git fetch origin claude/telegram-app-adaptation-t1r1jp
       git switch claude/telegram-app-adaptation-t1r1jp
       npm install && (cd functions && npm install)
       node scripts/dev-build.js

2. **Deploy Hosting to a preview channel on the dev project** (30d is the max
   lifetime):

       npx firebase hosting:channel:deploy telegram --expires 30d --project "$DEV_PROJECT"

   The output prints the channel URL, shaped like
   `https://<devProject>--telegram-<hash>.web.app`. It stays stable for the
   channel's lifetime (redeploys reuse it). Grab it onto the clipboard for the
   BotFather step:

       npx firebase hosting:channel:list --project "$DEV_PROJECT"
       printf '%s' 'https://<devProject>--telegram-<hash>.web.app' | pbcopy

   The branch's `firebase.json` headers (CSP `script-src https://telegram.org`,
   `frame-ancestors` for telegram.org) apply to the channel automatically, so
   Telegram Web can frame the preview.

3. **Configure env, then deploy functions + rules to the dev project.** Set
   the three §2 vars in `functions/.env` — the TEST bot's token/secret, and
   `TELEGRAM_APP_URL` = the preview URL from step 2 (env is baked in at deploy
   time, so set it first):

       npx firebase deploy --only functions,database --project "$DEV_PROJECT"

4. **Point the test bot at the preview URL:** BotFather → `/setmenubutton` →
   the test bot → paste the preview URL (⌘V from step 2).

5. **Register the webhook** as in §3, against the dev project's function URL
   (the region is the dev RTDB's region — check the deploy output or
   `functions/.env.<devProject>`):

       curl -sS "https://api.telegram.org/bot<TEST_BOT_TOKEN>/setWebhook" \
         -d "url=https://<region>-$DEV_PROJECT.cloudfunctions.net/telegramWebhook" \
         -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
         -d "allowed_updates=[\"message\",\"callback_query\"]"

Renewing / cleaning up:

- Re-running step 2 redeploys to the **same** URL and resets the expiry.
- When done: `npx firebase hosting:channel:delete telegram --project "$DEV_PROJECT"`.
  The test bot can keep its webhook — it only talks to dev.
- To re-test the first-open flow from scratch, delete your mapping in the dev
  RTDB: `telegramUsers/<yourTgId>` (+ `telegramByUid/<uid>`). The mapping is
  keyed by your Telegram user id per PROJECT, not per bot, so it survives
  channel deletion.

Caveats:

- The preview build talks to the dev database end-to-end (accounts, knocks,
  groups, notifications) — disposable by design.
- `functions/.env` is loaded on EVERY functions deploy regardless of
  `--project`. It holds the TEST bot's values during this experiment — swap in
  the prod bot's values (or move to Secret Manager) before ever deploying
  functions to the prod project.
- If the dev web API key has HTTP-referrer restrictions (Google Cloud console
  → Credentials), add the preview domain, or sign-in calls will 403.

Prod cutover later is pure config: create the prod bot fresh (§1), set its
values in the prod deploy's env, deploy, re-run §3 against the prod project,
set its menu button to the production URL.

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
