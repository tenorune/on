# Project conventions

## Branching
- `dev` is the integration branch. Cut feature branches from `dev`.
- Do feature work on the feature branch and push it; the maintainer merges to `dev` (and `dev` → `main`).
- Do not merge to `dev` or `main` yourself, and do not create PRs unless asked.

## Tests
- Web app: `npx jest` (repo root).
- Cloud Functions: `cd functions && npm test`.
