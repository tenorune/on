# Telegram bot + Mini App setup (experimental)

The Telegram adaptation ships behind `TELEGRAM_ENABLED` in `js/features.js`
(client-side, compile-time), and the server side is inert unless the Telegram
env vars are set at functions-deploy time — deploying unconfigured code is
always safe.

Three parts follow. A and B are independent runbooks, each complete on its
own; the merge-prep section sits between them in time:

- **Part A — Dev: preview channel + test bot.** Test the feature branch
  end-to-end on the dev Firebase project without merging anything.
- **Merge prep — the flag-flip commit.** What to change when the branch
  merges to mainline with the feature dark, and how to undo it at launch.
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

- **Node 20/22 LTS** as the active `node` (`node --version`). Newer Nodes
  break firebase-tools' HTTP stack with misleading errors ("Premature close"
  on login, "Failed to make request to https://auth.firebase.tools/attest",
  failing `projects:list`). Fix: `brew install node@22` and put
  `export PATH="$(brew --prefix node@22)/bin:$PATH"` in `~/.zshrc`.
- Logged in to the Firebase CLI — verify with a real API call, not
  `login:list` (which only reads the local cache):

      npx firebase projects:list

  If it errors, `npx firebase login --no-localhost` is the most reliable
  flow (no localhost callback involved).

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
3. `/setdescription` and `/setabouttext` → choose the test bot → paste
   (draft copy; tune wording in BotFather any time, no code change needed):

       /setdescription  → KnockKnock — see when the people who matter are free, and let them know when you are. Open the app to get started.
       /setabouttext    → Ambient availability for your closest people. No feeds, no messages — just who's free right now.

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
  `npx firebase hosting:channel:list --project "$DEV_PROJECT"`). Substitute
  YOUR real URL from the deploy output — don't run this line with the
  `<placeholders>` still in it, and verify with `pbpaste` that the clipboard
  holds exactly the URL and nothing else:

      printf '%s' 'https://<devProject>--telegram-<hash>.web.app' | pbcopy
      pbpaste

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

1. BotFather → `/setmenubutton` → choose the test bot → paste the preview URL
   from A4 (⌘V). The bot's Mini App button now opens the flagged-on preview
   build.
2. BotFather → `/newapp` → choose the test bot → give it a title, short
   description, and photo, then paste the same preview URL from A4 as the
   Web App URL, and pick a short name when prompted (e.g. `app`). BotFather
   returns a direct link shaped `https://t.me/<bot_username>/<app_short_name>`
   — put that in the **root** `.env.local` (this is a **client build**
   variable — root `.env.*`, **not** `functions/.env`, which never sees
   client-build values) as:

       TELEGRAM_APP_LINK=https://t.me/<bot_username>/<app_short_name>

   `scripts/dev-build.js` bakes it into the bundle as
   `process.env.TELEGRAM_APP_LINK`, which `js/inviteFlow.js` reads to build
   `t.me/...?startapp=<token>` invite links. Left unset, invite shares
   degrade gracefully to plain web URLs — nothing breaks, Telegram recipients
   just get a slightly less native link. Since it's baked in at build time,
   re-run A3 (and redeploy the preview with A4) after setting it for the
   bundle to pick it up — not required to complete the rest of this runbook.

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

### A9. Onboarding & chrome smoke test (dev preview channel + test bot)

 1. Deep-link invite (fresh TG account): create invite in app A → share via
    Telegram → tap in account B → interstitial shows inviter framing →
    Accept & get started → contact present, no empty state.
 2. "I have a secret phrase" from the interstitial: link → reload → silent
    redeem toast → invite contact present in the LINKED account.
 3. Re-tap the same deep link → nothing shown (no failure overlay).
 4. Cold /start from a never-seen account → funnel message (no command list);
    /start again → compact status line.
 5. Fresh account, no invite → guided empty state; Invite your people →
    share sheet carries t.me link; Add by code demoted; link line present.
 6. Unlink: confirm step → landing banner over the empty state; notifications
    chip reads Push after relink.
 7. Link: landing banner "Linked —"; theme correct (no stale vars).
 8. Back button: open card drawer / inbox / invite modal / group context —
    back closes top-most each time; back with nothing open exits the app;
    back hidden during a call.
 9. Vertical swipe: draw on the canvas + overscroll the list — webview must
    not collapse (Bot API ≥7.7 client).
10. Call close-confirm: start a call, swipe down → Telegram asks to confirm.
11. Change theme/palette → Telegram header/background follows without reboot.
12. Web (browser): empty account shows the guided empty state; install toast
    stays away until the first contact exists, then appears; corner icon
    visible throughout.

### A10. Renew, reset, clean up

- **Renew:** re-run A3 + A4 — same URL, expiry reset.
- **Reset the first-open (FTU) flow:** the derived uid is deterministic
  (`sha256("telegram:" + tgId)`), so deleting only the mapping produces a
  RETURNING user (old presence found → no first-use mode). For true FTU,
  delete all four in the dev RTDB console — `telegramUsers/<tgId>`,
  `telegramByUid/<uid>`, `users/<uid>`, `userPrefs/<uid>` (optionally the
  orphaned `codeIndex/<CODE>`; note the code before deleting `users/<uid>`).
  The mapping is keyed by your Telegram user id per PROJECT (not per bot), so
  it survives channel deletion. Easier still: test FTU from a second Telegram
  account — fresh tgId, zero cleanup, and webview localStorage (hint flags)
  starts clean too.
- **Tear down:**

      npx firebase hosting:channel:delete telegram --project "$DEV_PROJECT"

  The test bot can keep its webhook — it only ever talks to dev.

### Part A caveats

- The preview build talks to the dev database end-to-end (accounts, knocks,
  groups, notifications) — disposable by design.
- If the dev web API key has HTTP-referrer restrictions (Google Cloud console
  → Credentials), add the preview domain, or sign-in calls will 403.
- **Any push to `dev` silently tears down this setup** (bit us 2026-07-05).
  The dev CI workflow deploys `--only hosting,database,functions --force`
  from `dev`, whose source has no Telegram functions — `--force` therefore
  DELETES `validateTelegram`/`linkTelegram`/`unlinkTelegram`/`telegramWebhook`
  from the dev project and reverts the database rules to `dev`'s version.
  The preview channel keeps serving (CI doesn't touch channels), so the Mini
  App loads and then dies at boot with the "Couldn't start KnockKnock" alert.
  Recovery: re-run the A5 deploy from the feature branch (same URLs come
  back; webhook registration and menu button survive untouched).

---

## Merge prep — the flag-flip commit (feature dark on mainline)

**Decision (2026-07-04): revert the ungated hosting artifacts at flag-flip.**
`TELEGRAM_ENABLED = false` silences all the JavaScript, but two artifacts are
static hosting config the flag cannot reach — the Telegram bridge `<script>`
tag and the relaxed security headers. Left in place, every visitor of a
dark-flag deploy would still load third-party JS from telegram.org and the
app would still be embeddable by telegram.org sites. So the flag-flip commit
removes them too: a dark mainline serves a hosting surface identical to the
pre-Telegram one.

When the branch is ready to merge, make **one commit** on the feature branch
containing exactly these three changes:

1. **`js/features.js`** — turn the flag off:

       export const TELEGRAM_ENABLED = false;

2. **`index.template.html`** — delete the Telegram bridge script tag *and*
   its comment (in `<head>`, right after `<title>`):

       <!-- Telegram Mini App bridge. Inert outside Telegram (defines window.Telegram
            with empty initData). Must load before the bundle so isTelegramContext()
            can detect the webview at boot. -->
       <script src="https://telegram.org/js/telegram-web-app.js"></script>

   Delete ONLY that — the branch's other `index.template.html` additions
   (e.g. the hidden `#invite-modal-share-btn`) are flag-gated markup and must
   stay.

3. **`firebase.json`** — restore the two pre-branch headers in the
   `"headers"` array:
   - In the `Content-Security-Policy` value: remove `https://telegram.org`
     from `script-src`, and change

         frame-ancestors https://web.telegram.org https://*.telegram.org;

     back to

         frame-ancestors 'none';

   - Re-add the header the branch deleted (between `X-Content-Type-Options`
     and `Referrer-Policy`):

         { "key": "X-Frame-Options", "value": "DENY" },

Verify before committing:

    # no telegram reference left in either file's diff vs mainline — expect empty
    git diff origin/dev -- firebase.json index.template.html | grep -i telegram
    # the restored headers — expect one match each
    grep -c "X-Frame-Options" firebase.json
    grep -c "frame-ancestors 'none'" firebase.json

Then run the test suites (`npx jest`; `cd functions && npm test`) — they do
not depend on the flag's value — commit, and **record the sha in the line
below** (it is the launch key for Part B):

    Flag-flip commit: ____________________  <- fill in at merge time

After this merges, mainline deploys are Telegram-free for users: no
telegram.org script, `frame-ancestors 'none'`, `X-Frame-Options: DENY`. The
Telegram code still ships inside the JS bundle but is unreachable behind the
flag, and the functions stay inert while `functions/.env` lacks the Telegram
vars.

### Turning the feature ON later (launch prep for Part B)

Flipping the flag alone is **not** enough anymore — the script tag and the
relaxed headers have to come back with it. Because all three changes live in
the single flag-flip commit, launching is one command on the launch branch:

    git revert <flag-flip commit sha>

If the revert conflicts (someone edited the CSP line since), re-apply the
three changes of the flag-flip commit in reverse by hand: flag `true`,
script tag back into `index.template.html`, `script-src` gains
`https://telegram.org`, `frame-ancestors` lists
`https://web.telegram.org https://*.telegram.org`, and the
`X-Frame-Options: DENY` line is deleted.

Part B below assumes this reverted state.

**Launch checklist — root `.env.production`:** before building for launch,
repeat A6's `/newapp` step with the prod bot (BotFather → `/newapp` → prod
bot → production hosting URL as the Web App URL) and add the resulting link
to the **root** `.env.production` — not `functions/.env`:

    TELEGRAM_APP_LINK=https://t.me/<prod_bot_username>/<app_short_name>

This is a client build variable; unset, invite shares just fall back to web
URLs (no build failure).

---

## Part B — Production

Everything here targets the **prod Firebase project**, with a **fresh
production bot**. Do not reuse the test bot or any of its values.

### B1. Prerequisites

- The feature branch merged to `main` via the normal `dev` → `main` flow,
  dark, with the flag-flip commit as its tip (see "Merge prep" above).
- **The flag-flip commit reverted in the build you deploy** (`git revert
  <flag-flip sha>` — restores `TELEGRAM_ENABLED = true`, the telegram.org
  script tag, and the relaxed headers). That revert is the launch switch;
  flipping the flag alone is not enough.
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

3. `/setdescription` and `/setabouttext` → choose the prod bot → paste
   (draft copy; tune wording in BotFather any time, no code change needed):

       /setdescription  → KnockKnock — see when the people who matter are free, and let them know when you are. Open the app to get started.
       /setabouttext    → Ambient availability for your closest people. No feeds, no messages — just who's free right now.

4. Optional polish while you're there: `/setuserpic`.

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
  browser with phrase onboarding; nothing Telegram-specific renders. (This
  quick flip leaves the telegram.org script tag and relaxed headers serving;
  fine for an emergency. To fully restore the pre-Telegram hosting surface,
  re-apply the flag-flip commit — the three changes in "Merge prep" — and
  redeploy hosting.)

### Part B caveats

- Existing users are unaffected until they open the app inside Telegram:
  Web Push keeps working as-is, and `notifyChannel` only flips to `telegram`
  for accounts that link.
- In a launched (flag-on) build, the Telegram script tag and the relaxed CSP
  (`frame-ancestors` for telegram.org, `script-src https://telegram.org`)
  necessarily ship to every visitor, Telegram or not — that's what lets
  Telegram embed the app. Retiring or pausing the feature means re-applying
  the flag-flip commit (see "Merge prep"), which removes them again.

---

## How it fits together

- Mini App boot: client sends `Telegram.WebApp.initData` → `validateTelegram`
  callable verifies the signature, bootstraps/loads the account, mints a
  Firebase custom token. Mapping lives in server-only `telegramUsers/{tgId}`
  (+ reverse index `telegramByUid/{uid}` for notification routing).
- Linking: drawer → "I have a secret phrase" → `linkTelegram` (same rate
  limiter as validateRecovery) repoints the mapping to the phrase account;
  the temporary Telegram-derived account is expunged (after an in-app
  warning) — its contacts/groups don't carry over.
- Unlink: drawer → "Unlink account" expunges the Telegram identity from the RTDB
  (mapping + derived shadow account + its social residue); reopening the Mini App
  afterwards starts a fresh Telegram-derived account.
- Notifications: `sendToUser` sends via the bot when
  `userPrefs/{uid}/notifyChannel === 'telegram'`, falling back to FCM on any
  failure. Toggle: drawer button or `/notifications push|telegram`.
- Env-file storage (not Secret Manager) matches this repo's existing config
  pattern; acceptable for the experiment, revisit before a broad rollout
  (see B3).
