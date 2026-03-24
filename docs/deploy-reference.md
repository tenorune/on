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
