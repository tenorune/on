# Presence schema migration — deploy runbook

One-shot, idempotent migration for the presence-schema-split. Run **once per
environment**, in this order.

> The script lives in `functions/` (not the repo root) because `firebase-admin`
> is a `functions/` dependency and `functions/package.json` sets
> `"type":"module"`. Run it from the `functions/` directory.

1. **Migrate live data** (before deploying the new code):
   ```
   cd functions
   export GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat path/to/dev-service-account.json)"
   node migrate-presence.js --project <dev-project-id>
   ```
   (Idempotent — safe to re-run. Reports how many users were migrated.)

2. **Deploy** functions + hosting + rules together (the `dev` merge does this via
   CI; or `npm run deploy:dev`).

3. **CRITICAL — recreate the three trigger-path-changed functions.** `onKnock`,
   `onCall`, and `onAvailability` all changed their RTDB trigger *resource* in
   this branch. Firebase often leaves a 2nd-gen function pointed at its OLD
   trigger path on a plain redeploy, so their pushes go silent. After the deploy:
   ```
   npx firebase functions:delete onKnock onCall onAvailability --project <project-id>
   npx firebase deploy --only functions --project <project-id>
   ```
   Verify in the Functions logs that each fires (send a knock, a call, and toggle
   availability) before considering the deploy done.

4. **`sw.js` `CACHE`** auto-bumps — its value is a content hash over
   `dist/bundle.js` + the shell assets, so the build emits a new cache name
   whenever the client JS changes. No manual edit needed.

## What the migration does (per user)
- Copies `status`/`availableUntil`/`statusColor`/`paletteKey`/`code`/`lastSeen`
  into `users/{uid}/presence/`.
- Rewrites `users/{uid}/revokedFollowers/{r}` → `revocations/{r}/{uid}`.
- Deletes the moved-away/legacy/transient top-level fields (`knocks`,
  `callState`, `revokedFollowers`, `favorites`, `lastTimeoutMinutes`,
  `currentContext`, and the now-duplicated presence fields).
- Drops `groups/{gid}/lastVisited` (rebuilds on next navigation).

Old transient knocks are dropped (they expire unread anyway). Active calls are
not migrated (the symmetric `calls/` mailboxes are session-transient).
