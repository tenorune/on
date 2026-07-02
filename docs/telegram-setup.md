# Telegram bot + Mini App setup (experimental)

The Telegram adaptation ships behind `TELEGRAM_ENABLED` in `js/features.js`
(client-side, compile-time), and the server side is inert unless the Telegram
env vars are set at functions-deploy time — deploying unconfigured code is
always safe.

Two independent runbooks follow. Each is complete on its own:

- **Part A — Dev: preview channel + test bot.** Test the feature branch
  end-to-end on the dev Firebase project without merging anything.
- **Part B — Production.** Launch for real users on the prod Firebase
  project, with a fresh production bot.

Never share a bot between the two: a bot's webhook and menu button are global
singletons, and `initData` validation is keyed by the bot token, so each bot
belongs to exactly one Firebase project.

All commands assume macOS (zsh in iTerm) at the repo root.

---

## Part A — Dev: preview channel + test bot

Everything here targets the **dev Firebase project**. Hosting goes to a
preview channel (the dev site's main URL is untouched); Functions and
database rules have no preview equivalent, so they deploy to the dev project
itself — additive, inert without env config, and disposable by nature on dev.

### A1. Prerequisites

- The feature branch checked out and building:

      git fetch origin claude/telegram-app-adaptation-t1r1jp
      git switch claude/telegram-app-adaptation-t1r1jp
      npm install && (cd functions && npm install)

- `.env.local` present (it holds the dev project's web config). Capture the
  dev project id once for the commands below:

      DEV_PROJECT=$(grep '^FIREBASE_PROJECT_ID=' .env.local | cut -d= -f2)
      echo "$DEV_PROJECT"

- Logged in to the Firebase CLI (`npx firebase login:list` to check).

### A2. Create the TEST bot

1. In Telegram, talk to **@BotFather** → `/newbot` → pick a throwaway name
   and username (e.g. `KnockKnockDevBot`). Save the token it prints — this is
   the TEST bot token, used only with the dev project.
2. `/setcommands` → choose the test bot → paste:

       start - Open KnockKnock
       status - Go available (e.g. /status 2h)
       off - Go unavailable
       who - Who's available now
       knock - Knock someone (/knock name)
       groups - Your groups
       notifications - Delivery channel (push|telegram)
       help - Commands

   (The menu button comes later, in A6 — the preview URL doesn't exist yet.)

### A3. Build the branch with the dev web config

    node scripts/dev-build.js

This is the same builder `npm run deploy:dev` uses: it reads `.env.local`, so
the bundle carries the dev project's Firebase config and the branch's
`TELEGRAM_ENABLED=true`.

### A4. Deploy Hosting to a preview channel

    npx firebase hosting:channel:deploy telegram --expires 30d --project "$DEV_PROJECT"

- 30 days is the maximum lifetime; re-deploying later resets the clock.
- The output prints the channel URL, shaped like
  `https://<devProject>--telegram-<hash>.web.app`. It stays **stable** for
  the channel's lifetime — redeploys reuse it.
- Copy it to the clipboard for the next steps (or re-find it any time with
  `npx firebase hosting:channel:list --project "$DEV_PROJECT"`):

      printf '%s' 'https://<devProject>--telegram-<hash>.web.app' | pbcopy

- The branch's `firebase.json` headers (CSP `script-src https://telegram.org`,
  `frame-ancestors` for telegram.org) ride along with the channel
  automatically, so Telegram's clients can embed the preview.

### A5. Configure functions env and deploy Functions + rules to dev

1. Edit `functions/.env` (gitignored) to hold the TEST bot's values and the
   preview URL from A4:

       TELEGRAM_BOT_TOKEN=<TEST bot token from A2>
       TELEGRAM_WEBHOOK_SECRET=<long random string, e.g. `openssl rand -hex 32`>
       TELEGRAM_APP_URL=https://<devProject>--telegram-<hash>.web.app

   **Warning:** never put these in `functions/.env.<projectId>` — that file
   is tracked in git (it carries only the non-secret `FUNCTIONS_REGION`);
   committing a bot token there would leak it.

2. Deploy (env is baked in at deploy time, so the edit must come first):

       npx firebase deploy --only functions,database --project "$DEV_PROJECT"

3. Note the webhook function's URL in the deploy output
   (`telegramWebhook`, shaped like
   `https://<region>-<devProject>.cloudfunctions.net/telegramWebhook`).

### A6. Point the test bot's menu button at the preview URL

BotFather → `/setmenubutton` → choose the test bot → paste the preview URL
from A4 (⌘V). The bot's Mini App button now opens the flagged-on preview
build.

### A7. Register the webhook (test bot → dev function)

    curl -sS "https://api.telegram.org/bot<TEST_BOT_TOKEN>/setWebhook" \
      -d "url=https://<region>-$DEV_PROJECT.cloudfunctions.net/telegramWebhook" \
      -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
      -d "allowed_updates=[\"message\",\"callback_query\"]"

Use the exact URL from A5.3 and the same secret you put in `functions/.env`.

### A8. Verify + smoke test

1. Webhook registered, no pending errors:

       curl -sS "https://api.telegram.org/bot<TEST_BOT_TOKEN>/getWebhookInfo"

   Expect your URL, `"pending_update_count": 0`, and no `last_error_message`.
2. In Telegram: `/start` to the test bot → expect the welcome + "Open
   KnockKnock" button.
3. Tap the button → the Mini App opens the preview build and lands in a
   working account with no phrase typing (check the code drawer: "Using your
   Telegram identity", notifications toggle, no install/push prompts).
4. `/status 30m` → `/who` from a second (web) dev account that follows the
   bot account → knock it from the web → the knock should arrive as a bot
   message with a "Knock back" button.
5. Function logs if anything is off:

       npx firebase functions:log --project "$DEV_PROJECT" --only telegramWebhook,validateTelegram

### A9. Renew, reset, clean up

- **Renew:** re-run A3 + A4 — same URL, expiry reset.
- **Reset the first-open flow:** delete `telegramUsers/<yourTgId>` (and the
  `telegramByUid/<uid>` it points to) in the dev RTDB console. The mapping is
  keyed by your Telegram user id per PROJECT (not per bot), so it survives
  channel deletion.
- **Tear down:**

      npx firebase hosting:channel:delete telegram --project "$DEV_PROJECT"

  The test bot can keep its webhook — it only ever talks to dev.

### Part A caveats

- The preview build talks to the dev database end-to-end (accounts, knocks,
  groups, notifications) — disposable by design.
- If the dev web API key has HTTP-referrer restrictions (Google Cloud console
  → Credentials), add the preview domain, or sign-in calls will 403.

---

## Part B — Production

Everything here targets the **prod Firebase project**, with a **fresh
production bot**. Do not reuse the test bot or any of its values.

### B1. Prerequisites

- The feature branch merged to `main` via the normal `dev` → `main` flow.
- **`TELEGRAM_ENABLED = true` in `js/features.js` in the build you deploy** —
  the flag is the launch switch. (The merge itself may land with the flag
  `false`; flipping it true in a prod deploy is what turns the feature on for
  users.)
- `.env.production` present (prod web config). Capture the prod project id:

      PROD_PROJECT=$(grep '^FIREBASE_PROJECT_ID=' .env.production | cut -d= -f2)
      echo "$PROD_PROJECT"

### B2. Create the PRODUCTION bot

1. **@BotFather** → `/newbot` → the real name and username (e.g.
   `KnockKnockBot`). Save the token — this is the PROD bot token; treat it
   like a production credential.
2. `/setcommands` → choose the prod bot → paste:

       start - Open KnockKnock
       status - Go available (e.g. /status 2h)
       off - Go unavailable
       who - Who's available now
       knock - Knock someone (/knock name)
       groups - Your groups
       notifications - Delivery channel (push|telegram)
       help - Commands

3. Optional polish while you're there: `/setdescription`, `/setabouttext`,
   `/setuserpic`.

### B3. Configure functions env for the prod deploy

`functions/.env` is loaded on **every** functions deploy regardless of
`--project`. During dev testing it holds the TEST bot's values — you MUST
replace them before deploying functions to prod, or the prod functions will
validate against (and send from) the test bot.

1. Edit `functions/.env` to the production values:

       TELEGRAM_BOT_TOKEN=<PROD bot token from B2>
       TELEGRAM_WEBHOOK_SECRET=<a NEW long random string — do not reuse dev's>
       TELEGRAM_APP_URL=https://<prodProject>.web.app

   (`TELEGRAM_APP_URL` is the production hosting URL — your custom domain if
   you serve one.)

   **Warning:** as in dev, never put these in the tracked
   `functions/.env.<projectId>`.

2. Consequence to accept for now: while `functions/.env` holds prod values, a
   dev functions deploy would push the PROD bot's token to dev. Swap the file
   back before any dev deploy, or keep two copies
   (`functions/.env.telegram-dev` / `functions/.env.telegram-prod`, both
   gitignored by a local pattern) and `cp` the right one into place. The
   durable fix is moving these to Secret Manager (`defineSecret`) — already
   noted in the spec as a pre-broad-rollout item.

### B4. Build + deploy everything to prod

The repo's standard prod deploy does build (with `.env.production`) +
hosting + database rules + functions in one step:

    npm run deploy

If you prefer explicit steps, that is equivalent to:

    npm run build
    npx firebase deploy --only hosting,database,functions --project "$PROD_PROJECT"

Note the `telegramWebhook` URL in the deploy output
(`https://<region>-<prodProject>.cloudfunctions.net/telegramWebhook`).

### B5. Point the prod bot's menu button at the production URL

BotFather → `/setmenubutton` → choose the prod bot → paste the production
hosting URL (same value as `TELEGRAM_APP_URL` in B3).

### B6. Register the webhook (prod bot → prod function)

    curl -sS "https://api.telegram.org/bot<PROD_BOT_TOKEN>/setWebhook" \
      -d "url=https://<region>-$PROD_PROJECT.cloudfunctions.net/telegramWebhook" \
      -d "secret_token=<PROD TELEGRAM_WEBHOOK_SECRET>" \
      -d "allowed_updates=[\"message\",\"callback_query\"]"

### B7. Verify + smoke test

1. `curl -sS "https://api.telegram.org/bot<PROD_BOT_TOKEN>/getWebhookInfo"` —
   expect your URL, `"pending_update_count": 0`, no `last_error_message`.
2. `/start` the prod bot from your own Telegram → welcome + Mini App button →
   the Mini App opens the production site signed in with a fresh
   Telegram-derived account.
3. In the Mini App's code drawer, link your real account ("I have a secret
   phrase") → after the reload you should land in your own account, and the
   channel toggle should read "Notifications: Telegram".
4. Have another account knock you from the web → bot message with "Knock
   back" arrives; tap it → the knock lands back in the web app.
5. `/notifications push` → the same test should arrive as Web Push again;
   `/notifications telegram` to switch back.
6. Logs if needed:

       npx firebase functions:log --project "$PROD_PROJECT" --only telegramWebhook,validateTelegram

### B8. Rolling back / turning it off

In order of increasing severity:

- **Stop bot traffic only:**
  `curl -sS "https://api.telegram.org/bot<PROD_BOT_TOKEN>/deleteWebhook"` —
  commands stop; Mini App sign-in and Telegram notification delivery still
  work.
- **Disable the whole server side:** remove the three vars from
  `functions/.env` and redeploy functions — callables refuse
  (`failed-precondition`), webhook 403s, notifications fall back to Web Push
  automatically (`sendToUser`'s FCM fallback).
- **Hide the client surface:** set `TELEGRAM_ENABLED = false` in
  `js/features.js` and redeploy hosting — Telegram opens the app like a plain
  browser with phrase onboarding; nothing Telegram-specific renders.

### Part B caveats

- Existing users are unaffected until they open the app inside Telegram:
  Web Push keeps working as-is, and `notifyChannel` only flips to `telegram`
  for accounts that link.
- The Telegram script tag and the relaxed CSP (`frame-ancestors` for
  telegram.org, `script-src https://telegram.org`) ship with the hosting
  deploy regardless of the flag — that's what lets Telegram embed the app. If
  you ever retire the feature entirely, remove those from
  `index.template.html` / `firebase.json` too.

---

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
- Env-file storage (not Secret Manager) matches this repo's existing config
  pattern; acceptable for the experiment, revisit before a broad rollout
  (see B3).
