# KnockKnock

A real-time availability-sharing [PWA](https://en.wikipedia.org/wiki/Progressive_web_app). Let the people who matter know when you're free.

## Features

- **Availability** — Go available with a timer. Your contacts see your status in real-time.
- **Knock** — Tap a mutual's card to send a notification pulse.
- **Palettes** — 16 palettes across two sets (Natural + Electric), each with a full UI theme.
- **Favorites** — Up to 8 saved color combos. 
- **Call mode** — Swipe right to call a mutual. They swipe right to answer.
- **Shared canvas** — Answering a call opens a collaborative drawing canvas. Canvas persists between sessions per user pair.
- **Theme adoption** — Long-press a contact's card to adopt their color + theme combo.
- **PWA** — Installable, standalone display.

## Author's Note

KnockKnock is a sandbox & playground for me to explore agent-assisted design and development. Many of the affordances are meant to be played with and discovered independently. It rewards presence and curiosity. It's experimental and not for everybody.

## Agents used in development 

- Claude Code
- [Superpowers](https://github.com/obra/superpowers)
- [VibeSec-Skill](https://github.com/BehiSecc/VibeSec-Skill)

## Tech Stack

- Vanilla JS (ES modules, bundled with esbuild)
- Firebase Realtime Database (no auth — anonymous identity via localStorage)
- Firebase Hosting
- HTML Canvas API (drawing engine)
- CSS custom properties (theming)
- Jest + jsdom (testing)

## Setup

### Prerequisites

- Node.js 18+
- A Firebase project with Realtime Database enabled

### Install

```bash
git clone https://github.com/tenorune/on.git
cd on
npm install
```

### Configure Firebase

Create `.env.local` with your Firebase project config:

```
FIREBASE_API_KEY=your-api-key
FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
FIREBASE_DATABASE_URL=https://your-project-default-rtdb.region.firebasedatabase.app
FIREBASE_PROJECT_ID=your-project
FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
FIREBASE_MESSAGING_SENDER_ID=123456
FIREBASE_APP_ID=1:123456:web:abc
```

For production deployment, create `.env.production` with the production project config (same format).

### Database Rules

For development, use permissive rules:

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

### Run locally

```bash
npm run dev
```

Starts esbuild in watch mode + serves on `http://localhost:8080`. Prints the LAN URL for testing on mobile devices.

### Run tests

```bash
npm test
```

## Deployment

### One-time setup

1. Install Firebase CLI: `npm install -g firebase-tools` (or use `npx`)
2. Login: `firebase login`
3. Create `.firebaserc` pointing to your production project:

```json
{
  "projects": {
    "default": "your-production-project-id"
  }
}
```

### Deploy

```bash
npm run deploy
```

Builds with `.env.production` config and deploys to Firebase Hosting.

## Firebase Schema

```
codeIndex/{code} → userId

users/{userId}/
  code, status, availableUntil, lastSeen
  statusColor, paletteKey
  callState: { calleeId, since }
  followers/{followerId} → code
  revokedFollowers/{followerId} → true
  knocks/{senderId} → { count, ts }

canvases/{sortedPairId}/
  bg → hex color
  presence/{userId} → boolean
  drawing/{userId} → { color, thickness, points }
  strokes/{strokeId}/
    userId, color, thickness, tool, points, timestamp
```