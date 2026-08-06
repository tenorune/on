# Production deployment guide

Exhaustive runbook for promoting `dev` to **prod**.

> ## ⚠️ DATED-STATUS BANNER — read before following any part of this file
>
> **This file was written for the FIRST prod deploy and its title said so. That
> deploy has happened.** Prod exists, `main` reached v2.0.0, and
> `origin/main` **does** have `functions/index.js`. Several parts are therefore
> about a world that no longer exists. Verified 2026-08-06 against
> `origin/main` = `731eed9`:
>
> | part | status now |
> |---|---|
> | **Part 0** (one-time GCP/API/IAM setup) | **DONE.** `functions/.env.knock-knock-bf4fe` is committed and prod functions are live. **Confirm, do not re-run.** |
> | **Part 1 step 10** (land the functions region file) | **DONE** — the file is on both `main` and `dev`. |
> | **Part 1 step 12** (prod RTDB backup) | **STILL DO IT** — but for the reason in Part 4 step 25, not the migration. |
> | **Part 2 step 14's "expected on the very first deploy"** | Applies **only when a deploy CREATES a new trigger.** A release that changes existing functions creates no Eventarc trigger and cannot hit it. |
> | **Part 2 steps 15–16** (presence migration + group repair) | **DONE, one-way, do not re-run.** `main` already ships the `presence/` schema. |
> | **Part 3** (verification) | Written for a first deploy. Steps 17 and 20 assume functions and push have never existed on prod. Adapt. |
> | **Part 4** (rollback) | **CORRECTED 2026-08-06 — it contained an outage.** Read its banner. |
>
> **The generalisation, since this file is now the third place in the repo to
> record it:** a runbook step written against a precondition does not announce
> when that precondition expires. Step 24 was correct the day it was written and
> became destructive without a word changing. Re-derive against the project you
> actually have, not against the file.

Related: `docs/deploy-reference.md` (command/config table),
`functions/README-migrate-presence.md` (the migration + repair scripts),
`functions/.env.example` (per-project functions region config).

> Prod deploys on push to **`main`** via `.github/workflows/deploy-prod.yml`
> (build with `scripts/prod.js`, then `firebase deploy --only hosting,database,functions`).
> The job runs in the `production` GitHub environment, so it may pause for a
> required-reviewer approval. It reads two secrets: `FIREBASE_CONFIG_PROD`
> (written to `.env.production`) and `FIREBASE_SERVICE_ACCOUNT_PROD` (the deploy
> service account).

**Conventions in this doc:** `<prodId>` = prod Firebase project id (e.g.
`knock-knock`); `<PROD_REGION>` = prod RTDB region; `$PROJECT_NUMBER` = the
numeric project number. Run the `gcloud` commands with the CLI authenticated as
an Owner/Editor of the prod project (`gcloud auth login`,
`gcloud config set project <prodId>`).

---

## Part 0 — One-time prod setup (do all of this BEFORE merging to `main`)

Nothing from the dev project carries over. Work top-to-bottom.

### 0.1 — Identify the project + RTDB region

1. **Project id.** Read `FIREBASE_PROJECT_ID` from the `FIREBASE_CONFIG_PROD`
   secret, or Firebase Console → ⚙ Project settings → General → Project ID. Call it `<prodId>`.
2. **RTDB region.** Firebase Console → Realtime Database → copy the URL host:
   - `https://<id>-default-rtdb.firebaseio.com` → region is **`us-central1`**
   - `https://<id>-default-rtdb.<region>.firebasedatabase.app` → region is `<region>`

   Call it `<PROD_REGION>`. You need it in three places below (functions env file,
   `FIREBASE_DATABASE_URL`, and the migration `--region`).
3. **Capture the project number** (used by several IAM bindings):
   ```bash
   gcloud config set project <prodId>
   export PROJECT_NUMBER=$(gcloud projects describe <prodId> --format='value(projectNumber)')
   echo "$PROJECT_NUMBER"
   ```

### 0.2 — Commit the functions region file (REQUIRED)

Create and **commit** `functions/.env.<prodId>` (NOT secret — the Firebase CLI
auto-loads `functions/.env.<project>` at deploy by `--project`):
```
FUNCTIONS_REGION=<PROD_REGION>
```
Without it the functions deploy defaults to `europe-west1`, and a 2nd-gen RTDB
trigger created in a region other than the database's **fails**. (Dev relies on
the `europe-west1` default, so no dev file exists.)

### 0.3 — Enable billing (Blaze)

2nd-gen functions require the Blaze (pay-as-you-go) plan.

- Console: Firebase Console → ⚙ → **Usage and billing → Details & settings →
  Modify plan → Blaze**, and attach a Cloud Billing account.
- Verify billing is active and enable the Billing API:
  ```bash
  gcloud services enable cloudbilling.googleapis.com --project <prodId>
  gcloud billing projects describe <prodId> --format='value(billingEnabled)'   # expect: True
  ```

### 0.4 — Enable the GCP APIs

```bash
gcloud services enable \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  run.googleapis.com \
  eventarc.googleapis.com \
  pubsub.googleapis.com \
  fcm.googleapis.com \
  firebasedatabase.googleapis.com \
  --project <prodId>
```
- `fcm.googleapis.com` = Cloud Messaging (push send). The others are the 2nd-gen
  functions toolchain (build → Artifact Registry image → Cloud Run → Eventarc
  trigger fed by Pub/Sub).
- API enablement + service-agent creation can take a few minutes to propagate.
  Verify:
  ```bash
  gcloud services list --enabled --project <prodId> \
    --filter="config.name:(cloudfunctions OR run OR eventarc OR pubsub OR fcm)"
  ```

### 0.5 — IAM bindings

2nd-gen RTDB triggers run on Cloud Run, invoked via Eventarc + Pub/Sub. The
service agents and the functions runtime SA need explicit roles. (These mirror
the bindings that made dev work; if the first deploy still complains, its error
output names the exact missing role — grant that and re-run.)

**0) Provision the service agents.** GCP creates per-service "service agents"
**lazily** — `gcloud services enable` (0.4) only *starts* their async
provisioning, so a binding below can fail with `INVALID_ARGUMENT: Service
account service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com does not
exist` (the "binding with condition" line in that error is a red herring). Force
them into existence first — safe + idempotent (returns the existing agent if it
already exists):
```bash
gcloud beta services identity create --service=pubsub.googleapis.com   --project=<prodId>
gcloud beta services identity create --service=eventarc.googleapis.com --project=<prodId>
```
(If your `gcloud` rejects `beta`, drop it — `gcloud services identity create …`
is GA in recent versions. If a binding *still* reports "does not exist" right
after, it's IAM propagation — wait ~1 min and retry.)

**a) Pub/Sub service agent → Service Account Token Creator** (lets Eventarc mint
auth tokens for trigger delivery):
```bash
gcloud projects add-iam-policy-binding <prodId> \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"
```

**b) Functions runtime SA (default compute SA) → Run Invoker + Eventarc Event
Receiver** (lets the trigger invoke the function):
```bash
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding <prodId> \
  --member="serviceAccount:${RUNTIME_SA}" --role="roles/run.invoker"
gcloud projects add-iam-policy-binding <prodId> \
  --member="serviceAccount:${RUNTIME_SA}" --role="roles/eventarc.eventReceiver"
```

**c) Functions runtime SA → Firebase Admin** (so the function code can read/write
RTDB and send FCM via the Admin SDK):
```bash
gcloud projects add-iam-policy-binding <prodId> \
  --member="serviceAccount:${RUNTIME_SA}" --role="roles/firebase.admin"
```

**Create the deploy service account + key first** (the source of both
`FIREBASE_SERVICE_ACCOUNT_PROD` and `DEPLOY_SA` below). Either reuse the
Firebase-managed Admin SDK SA (Console → ⚙ Project settings → **Service
accounts → Generate new private key**) or make a dedicated one:
```bash
gcloud iam service-accounts create github-deploy-prod \
  --project=<prodId> --display-name="GitHub Actions prod deploy"
gcloud iam service-accounts keys create prod-deploy-key.json \
  --iam-account="github-deploy-prod@<prodId>.iam.gserviceaccount.com"
```
- The **full JSON** (`prod-deploy-key.json`, or the Console download) is the value
  of the GitHub repo secret **`FIREBASE_SERVICE_ACCOUNT_PROD`** (GitHub → repo →
  Settings → Secrets and variables → Actions → New repository secret). It also
  serves 0.7's local migration/repair scripts.
- Its `client_email` is the `DEPLOY_SA` used in (d).
- **It's a live prod credential** — never commit it; delete the local file after
  setting the secret; rotate if exposed (see step 27).

**d) Deploy service account roles** (the SA whose JSON is in
`FIREBASE_SERVICE_ACCOUNT_PROD`). Set its email and grant the deploy roles:
```bash
DEPLOY_SA="<deploy-sa-email>"   # the client_email from FIREBASE_SERVICE_ACCOUNT_PROD
for ROLE in \
  roles/firebase.admin \
  roles/cloudfunctions.admin \
  roles/run.admin \
  roles/cloudbuild.builds.editor \
  roles/artifactregistry.admin \
  roles/eventarc.admin \
  roles/pubsub.admin \
  roles/serviceusage.serviceUsageConsumer \
  roles/iam.serviceAccountUser ; do
  gcloud projects add-iam-policy-binding <prodId> \
    --member="serviceAccount:${DEPLOY_SA}" --role="$ROLE"
done
```
This is a deliberately generous superset that lets the CI deploy hosting +
database rules + 2nd-gen functions end-to-end; tighten later if desired.
(`iam.serviceAccountUser` is required so the deploy SA can act as the runtime SA.)

### 0.5b — Auth for R1 (custom-token minting)

- Enable **Firebase Authentication** on the project (Console → Authentication →
  Get started). No sign-in providers are needed — custom tokens don't require one.
- Grant the functions runtime SA permission to mint custom tokens:
  ```bash
  gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_SA}" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/iam.serviceAccountTokenCreator" --project <prodId>
  ```
  Without this, `createCustomToken()` fails at runtime with a signBlob permission error.

### 0.6 — Prod Firebase web config + VAPID key → `FIREBASE_CONFIG_PROD` secret

CI writes `FIREBASE_CONFIG_PROD` verbatim to `.env.production`, and the build
(`scripts/build.js`) reads these **exact** keys. Push has never run on prod, so
the VAPID key in particular is easy to miss.

1. **Web app config.** Console → ⚙ Project settings → **General** → *Your apps* →
   the Web app → **SDK setup and configuration → Config**. Map it:

   | Firebase config field | `.env.production` key |
   |---|---|
   | `apiKey` | `FIREBASE_API_KEY` |
   | `authDomain` | `FIREBASE_AUTH_DOMAIN` |
   | `databaseURL` | `FIREBASE_DATABASE_URL` ← **must be the regional host from 0.1** |
   | `projectId` | `FIREBASE_PROJECT_ID` |
   | `storageBucket` | `FIREBASE_STORAGE_BUCKET` |
   | `messagingSenderId` | `FIREBASE_MESSAGING_SENDER_ID` |
   | `appId` | `FIREBASE_APP_ID` |

   (No Web app yet? Project settings → *Your apps* → **Add app → Web**.)
2. **VAPID key (Web Push).** Console → ⚙ Project settings → **Cloud Messaging** →
   *Web configuration* → **Web Push certificates** → **Generate key pair** (if
   none), then copy the key string → `FIREBASE_VAPID_KEY`.
3. **Write the secret.** GitHub → repo **Settings → Secrets and variables →
   Actions** (or the **production** environment if that's where the workflow's
   secrets live) → set `FIREBASE_CONFIG_PROD` to all eight lines:
   ```
   FIREBASE_API_KEY=...
   FIREBASE_AUTH_DOMAIN=<prodId>.firebaseapp.com
   FIREBASE_DATABASE_URL=https://<prodId>-default-rtdb.<PROD_REGION>.firebasedatabase.app
   FIREBASE_PROJECT_ID=<prodId>
   FIREBASE_STORAGE_BUCKET=<prodId>.appspot.com
   FIREBASE_MESSAGING_SENDER_ID=...
   FIREBASE_APP_ID=...
   FIREBASE_VAPID_KEY=...
   ```
   (Optional `APP_TITLE=KnockKnock`; the build defaults the title to `KnockKnock`.)
4. **Deploy SA secret.** Ensure `FIREBASE_SERVICE_ACCOUNT_PROD` holds the full
   JSON of the deploy SA from 0.5(d).

### 0.7 — Get a prod service-account JSON for the scripts

The migration/repair scripts run locally and need admin credentials. Use the
same SA as `FIREBASE_SERVICE_ACCOUNT_PROD`, or Console → ⚙ Project settings →
**Service accounts → Generate new private key**. Treat as a secret — keep it out
of the repo, delete the local copy after use, rotate if it may have leaked.

### 0.8 — Pick a low-traffic cutover window

This is a flag-day migration (no dual-write); expect a short window where
presence looks stale for users still on the old cached PWA.

---

## Part 1 — Pre-merge prep (land on `dev` first)

10. Land `functions/.env.<prodId>` (0.2) on `dev` so it flows into `main`. It
    won't affect dev (dev keeps its `europe-west1` default).
11. Make `dev` exactly what you want in prod and verify it's green. Because prod
    is far behind (no functions ever deployed), `dev → main` is a **large
    promotion** — do a full manual regression pass on dev first (knocks, calls,
    availability, groups, nav, notifications on iOS + desktop).
12. **Take a prod RTDB backup** right before you start Part 2: Console → Realtime
    Database → ⋮ → **Export JSON** (your one-way-migration safety net; see Part 4).

## Part 2 — Deploy

> **R1 flag-day:** the rules require auth. CI deploys `hosting,database,functions`
> together, so the new client and new rules land in the same deploy — correct. The
> `validateRecovery` function is part of `functions` and deploys with them. Any
> client tab open on the *old* build (not signed in) is locked out until it
> reloads. Cached Firebase sessions mean only never-signed-in clients are affected.

13. **Merge `dev` → `main`.** Triggers `deploy-prod.yml`. Approve the `production`
    environment if a reviewer gate prompts.

    🛑 **In a fresh session container this merge is IMPOSSIBLE until you deepen
    the clone.** The clone is shallow with grafted history, so `dev` and `main`
    have no reachable common ancestor and `git merge` aborts with
    **`fatal: refusing to merge unrelated histories`**. Do not reach for
    `--allow-unrelated-histories`; it would treat every file as added on both
    sides and produce a garbage merge.

    `git fetch --unshallow origin` fails on proxy auth — but a **targeted deepen
    succeeds**, which is the part nothing else in this repo recorded:
    ```bash
    git fetch --deepen=200 origin main dev
    git merge-base refs/remotes/origin/main refs/remotes/origin/dev   # must print a sha
    ```
    Only after that does the merge behave. Use the temp-branch shape — never
    check out local `dev`, which is itself a shallow artifact:
    ```bash
    git checkout -b tmp refs/remotes/origin/main
    git merge --no-ff refs/remotes/origin/dev
    git diff --stat HEAD refs/remotes/origin/dev   # EMPTY ⇒ a pure promotion
    git push origin HEAD:main
    ```
    ⚠️ **Commit counts computed before deepening are wrong in both directions**
    and cannot be trusted. Use `git diff --name-only` between the two refs
    instead — a tree comparison is graft-independent and is what tells you which
    deploy surfaces are actually moving.
14. **Watch the Actions run.** `test` runs the full web + functions suites;
    `deploy` builds prod and runs
    `firebase deploy --only hosting,database,functions --project <prodId>`. If the
    **functions** step fails on a first-time API/IAM error (common on the very
    first deploy while service agents finish provisioning), read the error, fix
    the named API/role, and **re-run the job**.

    **Expected when a deploy CREATES a trigger** (the first prod deploy did;
    a release that only changes existing functions does **not** and cannot hit
    this): the RTDB-triggered functions
    (`onKnock`, `onCall`, `onAvailability`, `onInvite`, `onFollowRequest`,
    `onMemberWritten`) can fail with *"Permission denied while using the Eventarc
    Service Agent … Retry the deployment in a few minutes"* even though `0.5`'s
    bindings are correct — the Eventarc service-agent IAM grant just hasn't
    propagated yet. `validateRecovery` (a callable, no Eventarc trigger) succeeds
    in the same run. **Fix: wait a few minutes and re-run** — the create succeeds
    once IAM propagates; no config change needed.

    The deploy passes `--force` so the Artifact Registry image **cleanup policy**
    is auto-accepted. Without it, a `--non-interactive` deploy exits 1 on the
    *"No cleanup policy detected"* prompt **even when every function deployed** —
    a misleading red that looks like a deploy failure but isn't.
🛑 **STEPS 15 AND 16 ARE DONE AND MUST NOT BE RE-RUN.** They are the flag-day
presence migration, which ran with the first prod deploy — `main` already ships
the `presence/` schema, so there are no legacy top-level presence fields left to
move. Step 15 is **one-way**: it deletes the old fields after copying them, so
re-running it against already-migrated data is at best a no-op and is not worth
finding out. Kept below as a record of what prod went through, and for the
shapes step 18 spot-checks.

15. **Run the data migration against prod, immediately after the deploy lands:**
    ```bash
    cd functions
    export GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat path/to/prod-service-account.json)"
    node migrate-presence.js --project <prodId> --region <PROD_REGION>
    ```
    Confirm the printed `using databaseURL …` host matches the prod RTDB host
    from 0.1. Reports `migrated N of M`.

    **Why after, not before:** presence fields (status / lastSeen / availableUntil)
    are continuously re-written by live clients. Migrating while old clients are
    still served is futile — they'd re-create the old top-level fields on their
    next heartbeat. Deploying first makes the new client (which writes to
    `presence/`) the served version; the migration then backfills `presence/` and
    cleans up the old top-level fields.
16. **(Safety net) Run the group-nav repair against prod:**
    ```bash
    node repair-user-groups.js --project <prodId> --region <PROD_REGION>
    ```
    Expect **`restored 0`** on prod (the buggy first cut of the migration never
    ran here). Harmless; confirms integrity.

**No `functions:delete` step for prod.** `onKnock` / `onCall` / `onAvailability`
have never existed there, so the first deploy creates them on the correct paths
directly. (That delete-and-recreate dance is only for environments where those
functions already exist on an *old* trigger path — i.e. dev.)

## Part 3 — Verification

17. **Functions exist & region is right:** Console → Functions: confirm `onKnock`,
    `onCall`, `onAvailability`, `onMemberWritten`, `onInvite`, `onFollowRequest`
    are listed and their region == `<PROD_REGION>`.
    ⚠️ **`onMemberWritten` was written here as `onMemberOverride`, which has never
    existed** — check the name against `functions/index.js`'s exports rather than
    against this list, which has been wrong once. On a release that adds no
    entry points, this step confirms nothing was *lost*; it is not evidence the
    release deployed.
18. **Data shape:** spot-check a few prod users — `users/{uid}/presence/{status,…}`
    present, legacy top-level presence fields gone, `users/{uid}/groups/{gid}`
    still carries its `lastVisited`.
19. **Live smoke test on a real device against prod:**
    - Presence/availability shows correctly (not everyone offline).
    - Knock and call between two accounts → in-app works **and** push arrives
      (check Functions logs for each trigger firing).
    - Toggle availability → notification fires.
    - Groups: group appears in the Direct topnav; navigate in/out and confirm the
      card persists and sorts.
20. **Push end-to-end** (first time on prod): grant notifications on an installed
    PWA, confirm a token lands under `pushTokens/{uid}`, then have a
    second account knock/call → OS notification appears. Watch Functions logs for
    FCM `success`.
21. **Hard-reload / reinstall the PWA** to confirm the new service worker + bundle
    activate. `sw.js` `CACHE` auto-bumps from a content hash of the shell assets —
    no manual edit; just confirm a new cache name shipped (DevTools → Application →
    Cache Storage, or the SW source).

## Part 4 — Rollback

🛑 **READ THIS BEFORE ACTING ON ANYTHING BELOW.** Steps 22–24 were written for
the *first-ever* prod deploy, when every function was net-new and no rules had
ever shipped. **Prod has since had a release**, so one of those steps is now an
outage rather than a rollback and another surface has no step at all. Corrected
2026-08-06; the original wording is preserved as 24-HISTORICAL because *why it
went stale* is the reusable part.

**The default rollback for any deploy after the first: redeploy `main` at the
previous commit.** That restores hosting, rules and functions together, which is
also how they shipped. Everything below is for when you need one surface alone.

22. **Hosting/client:** Console → Hosting → roll back to the previous release (or
    re-deploy `main` at the prior commit). Instant.

23. **RULES — the surface with the widest blast radius, and the one this file
    used to omit entirely.** Rules bind **every client immediately**, including
    ones nobody can update, so a bad rules deploy is felt before anything else
    and is not fixed by a hosting rollback. Roll back by redeploying the prior
    `database.rules.json`:
    ```bash
    git checkout <previous-main-sha> -- database.rules.json
    npx firebase deploy --only database --project <prodId>
    ```
    Rules deploy independently of hosting and functions and take effect at once.
    ⚠️ Rolling the rules back **re-opens whatever they closed** — if the
    deploy that shipped them closed a security item, the rollback un-closes it.
    Prefer rolling forward with a corrected rule when the fault is in one
    predicate rather than in the whole file.

24. **FUNCTIONS — do NOT use `functions:delete`.** The functions listed in
    24-HISTORICAL are **live in prod today**; deleting them removes working
    notification delivery and does not return prod to any prior state. Roll back
    by redeploying the previous revision:
    ```bash
    git checkout <previous-main-sha> -- functions/
    npx firebase deploy --only functions --project <prodId>
    ```
    Or roll back individually with
    `npx firebase deploy --only functions:<name> --project <prodId>`.

25. **Data.** Restore from the **Part 1 step 12 backup**. ⚠️ Note this is
    *unrelated* to the flag-day presence migration, which has already run — see
    the dated-status banner at the top. The reason a pre-deploy backup still
    matters is the `performLink` → `expungeDerivedAccount` path: those are
    destructive multi-path writes triggered by ordinary user actions
    (`unlinkTelegram`, `graduateTelegram`), and no code rollback un-deletes what
    they removed while the bad build was live.

**24-HISTORICAL — the original step 24, kept as a record, DO NOT RUN:**

> **Functions:** since they're net-new to prod,
> `firebase functions:delete onKnock onCall onAvailability onMemberOverride onInvite onFollowRequest --project <prodId>`
> returns prod to its pre-deploy (no-notifications) behavior.

Two things were wrong with it by 2026-08-06, and they failed differently:

- **"since they're net-new to prod" stopped being true** the moment prod had its
  first functions deploy. The sentence was correct when written and silently
  became destructive — nothing in the text signals that its precondition expired.
- **`onMemberOverride` has never existed.** `functions/index.js` exports
  `onMemberWritten`. The name was wrong on the day it was written, and the same
  wrong name is in Part 3 step 17. A `functions:delete` naming a function that
  does not exist fails on that argument, which is the only reason the wrong name
  is harmless rather than a second outage.

## Part 5 — Post-deploy

26. Watch Functions logs for `registration-token-not-registered` — expected for
    stale FCM tokens; the sender prunes them, and the client TTL cull (#157) bounds
    `pushTokens/{uid}` over time.
27. Delete the local prod service-account JSON; rotate the key if exposed.
28. Desktop notifications remain under investigation (#156) — not a blocker for
    the mobile-verified deploy.

---

## Addendum — `resolveInvitePreview` callable (invite-preview framing)

The welcome-screen invite framing ("You've been invited to follow/join …") is
resolved by an **unauthenticated** callable, `resolveInvitePreview`. It exists
because that screen renders *before* a brand-new user has any Firebase auth
session, while every invite node is gated by `auth != null` in the rules — so a
direct client read is permission-denied for exactly the new users the framing
targets. The callable reads via the Admin SDK (bypassing rules) and returns only
preview-safe fields (`scope` + `label`/`groupName`). It mirrors the pre-auth
`validateRecovery` pattern (`functions/index.js`, handler in `functions/invites.js`).

### Deploy

No special steps and **no rules change** — the Admin SDK bypasses rules. The
callable ships with the normal release, since both pipelines deploy
`--only hosting,database,functions`:

- **Dev:** merge the branch into `dev` → `.github/workflows/deploy-dev.yml`
  builds with `scripts/dev-build.js` and deploys to `on-on-22cb4`.
- **Prod:** merge `dev` → `main` → `.github/workflows/deploy-prod.yml` builds
  with `scripts/prod.js` and deploys to `<prodId>` (`knock-knock-bf4fe`).

The fix needs **both** the function (the new callable) and the client bundle
(which now calls it) — the CI deploy carries both. The client tolerates the
callable being absent (it catches the error → no framing, same as before), so
the function-first vs hosting-first ordering within a single deploy is harmless.

**Manual / out-of-band deploy** (from repo root, authenticated via
`npx firebase login`), if shipping just this function without a full release:

```bash
# Dev
npx firebase deploy --only functions:resolveInvitePreview --project on-on-22cb4
# Prod
npx firebase deploy --only functions:resolveInvitePreview --project <prodId>
```

Deploy the function before the client bundle so there's no gap (not dangerous
either way — see above). The callable runs in `europe-west1` for both projects,
matching the client's hardcoded `getFunctions(app, 'europe-west1')`.

### Verify

Open an invite link — one **personal** and one **group** — in a fresh
**incognito** window (no cached auth session). The "You've been invited to …"
line should appear on the "I'm new / I have a secret phrase" screen. Group
invites then prompt *"What name would you like to use in '{group}'?"*.

### Notes

- **Public invoker:** 2nd-gen callables run on Cloud Run and need public invoke
  access. The Firebase CLI sets this automatically for callable functions
  (`validateRecovery` is the same type and works). If the browser ever gets
  `unauthenticated`/403 from it, grant `roles/run.invoker` to `allUsers` on the
  `resolveinvitepreview` Cloud Run service, then retry.
- **No rate limit:** invite tokens are 128-bit, so enumeration is infeasible and
  this read-only endpoint is left unthrottled (unlike `validateRecovery`, which
  guards low-entropy recovery codes). Add a global fixed-window limiter later if
  a DoS backstop is wanted.
- **Rollback:** `firebase functions:delete resolveInvitePreview --project <id>`
  returns to the prior behavior (no framing for unauthenticated users); the
  client handles its absence gracefully.

---

## Addendum — pushTokens relocation (audit F6c)

FCM push-token records moved from `userPrefs/{uid}/pushTokens` to a top-level,
owner-only `pushTokens/{uid}/{token}` node (keeps them out of the wholesale
userPrefs watch). Every reader dual-reads (new path, then legacy fallback), so
each step is safe on its own — but the deploy ORDER below is load-bearing.
Deploy in exactly this sequence:

1. **Rules first** — deploy RTDB rules:
   ```bash
   npx firebase deploy --only database --project <prodId>
   ```
   Makes `pushTokens/{uid}` writable. Must precede any client/function that
   writes the new path, or those writes get PERMISSION_DENIED.
2. **Functions** — deploy functions:
   ```bash
   npx firebase deploy --only functions --project <prodId>
   ```
   The notifier (`sendToUser`) and the Telegram `/notifications` gate now
   dual-read new-then-legacy. Safe before hosting: a read of the
   not-yet-populated new node falls back to legacy.
3. **Hosting** — deploy the web build:
   ```bash
   npx firebase deploy --only hosting --project <prodId>
   ```
   Clients now WRITE tokens to the new path and the channel pill dual-reads.
   Existing tokens remain only in legacy until step 4.
4. **Migrate** — dry-run first (prints what it WOULD move, changes nothing):
   ```bash
   cd functions
   export GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat path/to/prod-service-account.json)"
   node migrate-push-tokens.js --project <prodId>
   ```
   Review, then apply:
   ```bash
   node migrate-push-tokens.js --project <prodId> --apply
   ```
   It copies every existing `userPrefs/{uid}/pushTokens` record to
   `pushTokens/{uid}/{token}` and nulls the legacy copy in ONE atomic
   multi-path update — idempotent and re-runnable. Needs the prod
   service-account JSON (see §0.7).
5. **Cleanup (LATER, separate follow-up commit — only after you confirm
   migration)** — drop the legacy fallback in all THREE dual-readers:
   `sendToUser` (functions/notifier.js), the bot gate (functions/telegram.js),
   and the pill (js/notifyChannel.ts accountHasPushTokens). This is NOT part
   of this deploy.

**Verify:** after step 3, register a device and confirm the token lands under
`pushTokens/{uid}` (not `userPrefs/{uid}/pushTokens`). After step 4, confirm
`userPrefs/{uid}/pushTokens` is empty for migrated users.
