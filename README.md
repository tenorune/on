# KnockKnock

A real-time **ambient-presence** [PWA](https://en.wikipedia.org/wiki/Progressive_web_app). Let the people who matter know when you're free — and reach them with a knock, a call, or a shared drawing.

## Features

- **Availability** — Go available with a timer. Your contacts see your status in real-time, in your personalized color.
- **Knock** — Tap a mutual's card to send a notification pulse.
- **Call mode + shared canvas** — Swipe right to call a mutual; they swipe right to answer. Answering opens a collaborative drawing canvas that persists per user-pair.
- **Palettes & favorites** — 16 palettes across two sets (Natural + Electric), each a full UI theme; up to 8 saved color combos. Long-press a contact's card to **adopt** their color + theme.
- **Groups** — Create groups, invite via link or in-app picker, and set a **per-audience status** (a different availability/color for each group than your primary). An Inbox surfaces pending invites and follow requests.
- **Distance (opt-in)** — Share a rough distance with the people who matter, per context. Reciprocal: it appears only when both sides opt in. A direct mutual pairing shows a precise distance (`120 meters away`), group rosters show a coarse band (`<1 km away`). Location itself is never shown — only distance, and only while the app is open (no background tracking).
- **Push notifications** — Web Push (FCM) for knocks, calls, availability, group invites, and follow requests, with per-contact opt-in. Platform-aware install guidance where the OS requires it (iOS Home Screen, macOS Dock).
- **Telegram Mini App (experimental)** — the same app running inside Telegram: auto sign-in via Telegram's signed identity, a companion bot that covers the core loop from chat (go available, see who's free, knock, `/locoff` to stop sharing distance), a `/status` freshness nudge while a location beacon is on, invite deep links, and notifications as bot messages instead of Web Push. Behind the `TELEGRAM_ENABLED` flag.
- **Phrase-based identity** — A 4-word secret phrase is your account; type it on any device to restore. No email, no social sign-up.
- **PWA** — Installable, standalone, offline shell, auto-updating service worker.

## Author's Note

KnockKnock is a sandbox & playground for me to explore agent-assisted design and development. Many of the affordances are meant to be played with and discovered independently. It rewards presence and curiosity. It's experimental and not for everybody.

## Agents used in development

- Claude Code
- [Superpowers](https://github.com/obra/superpowers)
- [VibeSec-Skill](https://github.com/BehiSecc/VibeSec-Skill)

## Tech Stack

- **Vanilla JS + gradual TypeScript** (ES modules, bundled with esbuild — no framework; `tsc --noEmit` typecheck in CI)
- **Firebase Realtime Database** — security rules scoped to `auth.uid` (a user can only touch their own data), with field-level validation
- **Firebase Authentication** (custom tokens) — minted by the `validateRecovery` Cloud Function; the secret phrase is exchanged for a token so `auth.uid === userId`
- **Firebase Cloud Functions** (`functions/`) — push-notification triggers (knock/call/availability/invite/follow-request → FCM) **and** the `validateRecovery` token-minting callable
- **`shared/`** — pure modules used by both the web client and Cloud Functions (time formatting, notify-channel default, name caps, id formats); functions consume a committed mirror (`functions/_shared/`, `npm run sync-shared`) since deploys archive only `functions/`
- **Firebase Cloud Messaging** + Web Push (notifications)
- **Firebase Hosting** (deploys via GitHub Actions)
- **HTML Canvas API** (drawing engine)
- **CSS custom properties** (theming)
- **Jest + jsdom** (web tests); a separate Jest suite for the Cloud Functions

## Identity model

There is **no email/password or social sign-up** — a user's identity is a **4-word secret phrase** (e.g. `swift-river-amber-dust`) drawn from the EFF wordlist; `userId = sha256(phrase)`. Typing the same phrase on any device restores the same account.

Authentication is **Firebase Auth via custom tokens**: the client calls the rate-limited **`validateRecovery` Cloud Function** with the phrase, which mints a Firebase custom token for that `userId`; the client then signs in with `signInWithCustomToken`, so `auth.uid === userId`. The RTDB security rules are scoped to **`auth.uid === $uid`** with field-level `.validate` — a user can only read/write their own data (the broadcast `presence` subtree is readable by any authenticated user; everything else is owner-scoped). The phrase is the only credential — treat it like a password; anyone who has it can claim the account.

## Setup

### Prerequisites

- Node.js 18+
- A Firebase project with Realtime Database, **Authentication** (for custom tokens), Hosting, Cloud Functions, and Cloud Messaging enabled, on the Blaze plan (2nd-gen functions)

### Install

```bash
git clone https://github.com/tenorune/on.git
cd on
npm install
cd functions && npm install && cd ..   # Cloud Functions deps
```

### Configure

Create `.env.local` (dev) and `.env.production` (prod) with your Firebase web config:

```
FIREBASE_API_KEY=…
FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
FIREBASE_DATABASE_URL=https://your-project-default-rtdb.region.firebasedatabase.app
FIREBASE_PROJECT_ID=your-project
FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
FIREBASE_MESSAGING_SENDER_ID=123456
FIREBASE_APP_ID=1:123456:web:abc
FIREBASE_VAPID_KEY=…           # Web Push certificate key pair (for FCM web)
```

Both files are gitignored. `index.html` is generated from `index.template.html` at build time.

### Run locally

```bash
npm run dev     # esbuild watch + local server (uses .env.local), prints the LAN URL
npm test        # web test suite (jest)
cd functions && npm test   # Cloud Functions test suite
```

## Deployment

Deploys run through **GitHub Actions**: push to `dev` → dev project; merge `dev` → `main` → prod (gated by a required reviewer). Workflows live in `.github/workflows/deploy-{dev,prod}.yml`; the prod workflow runs `firebase deploy --only hosting,database,functions` (database rules ship alongside hosting).

Local deploys are also available — `npm run deploy:dev` (dev: build + hosting + database) and `npm run deploy` (prod build + `firebase deploy --only hosting,database,functions`). The **first-ever prod functions deploy** also needs the GCP/API/IAM setup in [`docs/DEPLOY-PROD.md`](docs/DEPLOY-PROD.md).

**See [`docs/DEPLOY-PROD.md`](docs/DEPLOY-PROD.md) for the full production release runbook.**

## Data model (high level)

```
users/{uid}/
  presence/        # the broadcast subtree every follower watches
    status, availableUntil, statusColor, paletteKey, code
  followers/{followerId}, revokedFollowers/{followerId}
  groups/{groupId}            # group enumeration
  invites/{inviteId}          # personal invite links

userPrefs/{uid}/              # private per-user state (only the owner reads)
  following/{followeeId}, favorites, paletteState, perGroup/{groupId}/…
  hints/…, notify/{contactId}/…, location/…   # per-context opt-in state

groups/{groupId}/
  name, ownerId, createdAt
  members/{uid}: { role, displayName, statusOverride? }
  invites/{inviteId}

calls/{calleeId}              # call signaling mailbox (start/answer/end)
knocks/{recipientId}/{senderId}
pendingInvites/{inviteeUid}/{groupId}     # in-app group invites
followRequests/{targetUid}/…, followGrants/{requesterUid}/…
inviteIndex/{token}, groupIdIndex/{groupId}
canvases/{sortedPairId}/{bg, presence, strokes}
locations/{uid}                           # precise point (lat/lng) — readable only by a mutual who also shares (Direct tier)
locationCells/{gid}/{uid}                 # coarse grid cell per group — readable by fellow group members
pushTokens/{uid}/{token}                  # Web Push / FCM registration tokens (top-level; relocated off userPrefs, audit F6c)
notifierState/…              # server-only push cooldowns/dedup
```

## Documentation

- **[`docs/HANDOFF.md`](docs/HANDOFF.md)** — the authoritative engineering orientation: architecture, load-bearing context, gotchas, open work.
- **[`docs/notifications-testing.md`](docs/notifications-testing.md)** — runbook for testing web push (platform matrix + clean-test workflow).
- **[`docs/DEPLOY-PROD.md`](docs/DEPLOY-PROD.md)** — production deployment guide.
- **`docs/superpowers/specs/` & `plans/`** — design specs and implementation plans.
