# Deploy Reference

| Command | Config | Project | URL |
|---|---|---|---|
| `npm run dev` | `.env.local` | Dev (local only) | `localhost:8080` |
| `npm run deploy:dev` | `.env.local` | Dev (from .env.local) | Dev hosting URL |
| `npm run deploy` | `.env.production` | Prod (from .firebaserc) | Prod hosting URL |

- `.env.local`, `.env.production`, and `.firebaserc` are all gitignored
- Project IDs never appear in committed code
- `npm run dev` watches for changes and rebuilds automatically
- `npm run deploy` is for tagged milestones on `main` only
- `npm run deploy:dev` is for testing on a public URL from any branch

## Dev project one-time setup (R1 server auth)

These are GCP/Firebase Console steps — the CI deploy cannot perform them, so a
fresh dev project needs them once or sign-in/Console access silently breaks.
They mirror `DEPLOY-PROD.md` §0.5; apply the same to the **dev** project.

1. **Enable Firebase Authentication** (Console → Authentication → *Get started*).
   No sign-in providers are needed — custom tokens don't require one. Without
   this, the client's `signInWithCustomToken` fails.
2. **Grant the functions runtime SA permission to mint custom tokens** — without
   it, `validateRecovery`'s `createCustomToken()` returns `500 INTERNAL`
   (signBlob permission denied):
   ```bash
   RUNTIME_SA="<projectNumber>-compute@developer.gserviceaccount.com"
   gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
     --member="serviceAccount:$RUNTIME_SA" \
     --role="roles/iam.serviceAccountTokenCreator" --project <devId>
   ```
3. **Console RTDB access for your own account.** Reading the database in the
   Firebase Console is an **IAM** check, *not* a rules check — the Console
   bypasses security rules with admin access, so no `database.rules.json` change
   affects it. If you see *"To manage Realtime Database, ask a project owner for
   the necessary permissions"*, grant your Google account a role on the project:
   ```bash
   gcloud projects add-iam-policy-binding <devId> \
     --member="user:<you>@gmail.com" --role="roles/firebasedatabase.admin"
   ```
   (`roles/firebasedatabase.viewer` for read-only.) First check you're signed
   into the Console with the account that owns the project — a different browser
   account is the most common cause of that message.
