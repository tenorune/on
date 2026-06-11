# Production deployment guide — presence-schema-split

Exhaustive runbook for promoting the presence-schema-split (and the rest of `dev`)
to **prod**. This is effectively the **first-ever Cloud Functions deploy to prod**
— `origin/main` has no `functions/index.js` — so it carries first-time
region/API caveats on top of a flag-day RTDB schema migration.

Related: `docs/deploy-reference.md` (command/config table),
`functions/README-migrate-presence.md` (the migration + repair scripts),
`functions/.env.example` (per-project functions region config).

> Prod deploys on push to **`main`** via `.github/workflows/deploy-prod.yml`
> (build with `scripts/prod.js`, then `firebase deploy --only hosting,database,functions`).
> The job uses the `production` GitHub environment, so it may pause for a
> required-reviewer approval.

---

## Part 0 — Confirm BEFORE you start (blockers)

1. **Prod project ID.** Read `FIREBASE_PROJECT_ID` from the `FIREBASE_CONFIG_PROD`
   GitHub secret (Settings → Secrets → Actions) or the Firebase console.
   Referenced as `knock-knock` in `functions/.env.example`; verify. Call it `<prodId>`.

2. **Prod RTDB region.** Open the prod project's Realtime Database and read the URL host:
   - `https://<id>-default-rtdb.firebaseio.com` → region is **us-central1**
   - `https://<id>-default-rtdb.<region>.firebasedatabase.app` → region is `<region>`

   Write it down — call it `<PROD_REGION>`.

3. **Prod functions region env file (REQUIRED).** Create and **commit**
   `functions/.env.<prodId>` containing:
   ```
   FUNCTIONS_REGION=<PROD_REGION>
   ```
   This is NOT secret and MUST be committed — the Firebase CLI auto-loads it by
   `--project` at deploy. Without it the functions deploy defaults to
   `europe-west1`, and a 2nd-gen RTDB trigger created in a region other than the
   database's will fail. (Dev relies on the europe-west1 default, so no dev env
   file exists today.)

4. **GCP APIs for the first functions deploy.** 2nd-gen functions need these
   enabled on the prod project: Cloud Functions, Cloud Run, Cloud Build,
   Artifact Registry, Eventarc, Pub/Sub, and Cloud Messaging (FCM). The first
   deploy often fails once while these enable / IAM propagates — a re-run usually
   succeeds.

5. **FCM config in the prod build.** Confirm `FIREBASE_CONFIG_PROD` carries the
   messaging fields (messagingSenderId, appId, VAPID key). Push has never run on
   prod end-to-end.

6. **Prod service-account JSON** for running the migration/repair scripts locally
   (same SA as `FIREBASE_SERVICE_ACCOUNT_PROD`, or a console-downloaded admin SA).
   Treat as a secret — keep it out of the repo, delete the local copy after use,
   rotate the key if it may have been exposed.

7. **Pick a low-traffic cutover window.** This is a flag-day migration (no
   dual-write); expect a short window where presence looks stale for users still
   on the old cached PWA.

## Part 1 — Pre-merge prep (land on `dev` first)

8. Land `functions/.env.<prodId>` (step 3) on `dev` so it flows into `main` with
   everything else. It won't affect dev (dev keeps its europe-west1 default).

9. Make `dev` exactly what you want in prod and verify it's green. Because prod is
   far behind (no functions ever deployed), the `dev` → `main` merge is a **large
   promotion**, not just this branch — do a full manual regression pass on dev
   first (knocks, calls, availability, groups, nav, notifications on iOS + desktop).

## Part 2 — Deploy

10. **Merge `dev` → `main`.** Triggers `deploy-prod.yml`. Approve the `production`
    environment if a reviewer gate prompts.

11. **Watch the Actions run.** `test` runs the full web + functions suites;
    `deploy` builds prod and runs
    `firebase deploy --only hosting,database,functions --project <prodId>`. If the
    **functions** step fails on a first-time API/IAM error, re-run the job once.

12. **Run the data migration against prod, immediately after the deploy lands:**
    ```
    cd functions
    export GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat path/to/prod-service-account.json)"
    node migrate-presence.js --project <prodId> --region <PROD_REGION>
    ```
    Confirm the printed `using databaseURL …` host matches the prod RTDB host from
    step 2. Reports `migrated N of M`.

    **Why after, not before:** presence fields (status / lastSeen / availableUntil)
    are continuously re-written by live clients. Migrating while old clients are
    still the served version is futile — they'd re-create the old top-level fields
    on their next heartbeat. Deploying first makes the new client (which writes to
    `presence/`) the served version; the migration then backfills `presence/` for
    users who haven't loaded it yet and cleans up the old top-level fields.

13. **(Safety net) Run the group-nav repair against prod:**
    ```
    node repair-user-groups.js --project <prodId> --region <PROD_REGION>
    ```
    On prod this should report **`restored 0`** — the buggy first cut of the
    migration never ran here, so no group entries were deleted. Harmless; confirms
    integrity.

**No `functions:delete` step for prod.** `onKnock` / `onCall` / `onAvailability`
have never existed there, so the first deploy creates them on the correct new
paths directly. (That delete-and-recreate dance is only needed where those
functions already exist on an *old* trigger path — i.e. dev.)

## Part 3 — Verification

14. **Functions exist & region is right:** console → Functions: confirm `onKnock`,
    `onCall`, `onAvailability`, `onMemberOverride`, `onInvite`, `onFollowRequest`
    are listed and their region == `<PROD_REGION>`.

15. **Data shape:** spot-check a few prod users — `users/{uid}/presence/{status,…}`
    present, legacy top-level presence fields gone, `users/{uid}/groups/{gid}`
    still carries its `lastVisited`.

16. **Live smoke test on a real device against prod:**
    - Presence/availability shows correctly (not everyone offline).
    - Knock and call between two accounts → in-app works **and** push arrives
      (check Functions logs for each trigger firing).
    - Toggle availability → notification fires.
    - Groups: group appears in the Direct topnav; navigate in/out and confirm the
      card persists and sorts.

17. **Hard-reload / reinstall the PWA** to confirm the new service worker + bundle
    activate (`sw.js` CACHE auto-bumps from the content hash).

## Part 4 — Rollback

18. **Hosting/client:** Firebase console → Hosting → roll back to the previous
    release (or re-deploy `main` at the prior commit). Easy and instant.

19. **Data (the hard part — one-way flag-day).** The migration deletes the old
    top-level presence fields. **Take a prod RTDB backup/export immediately before
    step 12** so you can restore. Presence is transient and self-rewriting (old
    clients re-create top-level fields on heartbeat), but `groups` / `revocations`
    rewrites are not automatic — the backup is your safety net for those.

20. **Functions:** since they're net-new to prod, `firebase functions:delete …`
    returns prod to its pre-deploy (no-notifications) behavior.

## Part 5 — Post-deploy

21. Watch Functions logs for `registration-token-not-registered` — expected for
    stale FCM tokens; the sender prunes them.
22. Delete the local prod service-account JSON; rotate the key if exposed.
23. Open follow-ups: **#148** (lastVisited→userPrefs), **#144 / #145 / #146**
    (notification surfacing, restore-device token, canvas jank).
