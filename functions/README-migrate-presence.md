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

   The dev RTDB lives in `europe-west1`, so the script targets
   `https://<project>-default-rtdb.europe-west1.firebasedatabase.app` by
   default. For an instance in another region pass `--region <region>` (or
   `--database-url <url>` to point at it explicitly).

2. **Repair group nav entries** (also before deploying the new code):
   ```
   cd functions
   export GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat path/to/dev-service-account.json)"
   node repair-user-groups.js --project <dev-project-id>
   ```
   Rebuilds any missing `users/{uid}/groups/{gid}` enumeration markers from the
   surviving membership in `groups/{gid}/members/{uid}`, seeding `lastVisited`
   from each member's `joinedAt`. Idempotent — only adds missing entries, never
   overwrites an existing record. (Same `--region` / `--database-url` options.)

   > Needed because an earlier cut of `migrate-presence.js` nulled
   > `users/{uid}/groups/{gid}/lastVisited` — the record's only field — which
   > deletes the whole node and drops the group from the nav row. The migration
   > no longer does this, but any environment migrated with the old script needs
   > this repair. On a fresh environment it's a harmless no-op (reports 0).

3. **Deploy** functions + hosting + rules together (the `dev` merge does this via
   CI; or `npm run deploy:dev`).

4. **CRITICAL — recreate the three trigger-path-changed functions.** `onKnock`,
   `onCall`, and `onAvailability` all changed their RTDB trigger *resource* in
   this branch. Firebase often leaves a 2nd-gen function pointed at its OLD
   trigger path on a plain redeploy, so their pushes go silent. After the deploy:
   ```
   npx firebase functions:delete onKnock onCall onAvailability --project <project-id>
   npx firebase deploy --only functions --project <project-id>
   ```
   Verify in the Functions logs that each fires (send a knock, a call, and toggle
   availability) before considering the deploy done.

5. **`sw.js` `CACHE`** auto-bumps — its value is a content hash over
   `dist/bundle.js` + the shell assets, so the build emits a new cache name
   whenever the client JS changes. No manual edit needed.

## What the migration does (per user)
- Copies `status`/`availableUntil`/`statusColor`/`paletteKey`/`code`/`lastSeen`
  into `users/{uid}/presence/`.
- Rewrites `users/{uid}/revokedFollowers/{r}` → `revocations/{r}/{uid}`.
- Deletes the moved-away/legacy/transient top-level fields (`knocks`,
  `callState`, `revokedFollowers`, `favorites`, `lastTimeoutMinutes`,
  `currentContext`, and the now-duplicated presence fields).
- Leaves `users/{uid}/groups/{gid}` untouched — `lastVisited` stays there as the
  nav-sort key (see issue #148 for the userPrefs alternative).

Old transient knocks are dropped (they expire unread anyway). Active calls are
not migrated (the symmetric `calls/` mailboxes are session-transient).
