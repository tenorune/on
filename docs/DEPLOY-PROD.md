# Production deployment guide — first prod deploy (functions + presence schema)

Exhaustive runbook for promoting `dev` to **prod**. This is effectively the
**first-ever Cloud Functions deploy to prod** — `origin/main` has no
`functions/index.js` — so it carries first-time GCP/API/IAM setup on top of a
flag-day RTDB schema migration.

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
  setting the secret; rotate if exposed (see step 26).

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
14. **Watch the Actions run.** `test` runs the full web + functions suites;
    `deploy` builds prod and runs
    `firebase deploy --only hosting,database,functions --project <prodId>`. If the
    **functions** step fails on a first-time API/IAM error (common on the very
    first deploy while service agents finish provisioning), read the error, fix
    the named API/role, and **re-run the job**.
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
    `onCall`, `onAvailability`, `onMemberOverride`, `onInvite`, `onFollowRequest`
    are listed and their region == `<PROD_REGION>`.
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
    PWA, confirm a token lands under `userPrefs/{uid}/pushTokens`, then have a
    second account knock/call → OS notification appears. Watch Functions logs for
    FCM `success`.
21. **Hard-reload / reinstall the PWA** to confirm the new service worker + bundle
    activate. `sw.js` `CACHE` auto-bumps from a content hash of the shell assets —
    no manual edit; just confirm a new cache name shipped (DevTools → Application →
    Cache Storage, or the SW source).

## Part 4 — Rollback

22. **Hosting/client:** Console → Hosting → roll back to the previous release (or
    re-deploy `main` at the prior commit). Instant.
23. **Data (one-way flag-day).** The migration deletes the old top-level presence
    fields — restore from the **Part 1 step 12 backup** if needed. Presence is
    transient and self-rewriting (old clients re-create top-level fields on
    heartbeat), but `groups` / `revocations` rewrites are not automatic, so the
    backup is the safety net for those.
24. **Functions:** since they're net-new to prod, `firebase functions:delete onKnock onCall onAvailability onMemberOverride onInvite onFollowRequest --project <prodId>`
    returns prod to its pre-deploy (no-notifications) behavior.

## Part 5 — Post-deploy

25. Watch Functions logs for `registration-token-not-registered` — expected for
    stale FCM tokens; the sender prunes them, and the client TTL cull (#157) bounds
    `userPrefs/{uid}/pushTokens` over time.
26. Delete the local prod service-account JSON; rotate the key if exposed.
27. Desktop notifications remain under investigation (#156) — not a blocker for
    the mobile-verified deploy.
