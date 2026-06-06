# Presence Notifications — Design (Sub-project ① of the `messaging-api` program)

**Date:** 2026-06-05
**Branch:** `messaging-api`
**Status:** Design approved, pre-plan

---

## 0. Program context (the `messaging-api` umbrella)

KnockKnock has **no backend today**: the PWA talks directly to Firebase RTDB, the
trust model is honor-system (`.read/.write: true`), and identity is a client-derived
secret phrase (`userId = sha256(phrase)`) with no auth. The `messaging-api` program
introduces the app's **first server-side component** and a notification capability,
decomposed into independent sub-projects:

```
                 inbound (pull)            outbound (push)
   Telegram cmds ──►┐                          ┌──► Web Push (PWA)
   (future: HTTP) ──►│   PRESENCE CORE         │──► Telegram messages
   (future: CLI) ───►│  set status / read      │
                     └─ followees & group ──────┘
                        statuses / link acct
```

**Cross-cutting decisions (apply to every sub-project):**

- **Backend:** Firebase Cloud Functions. Push is **event-driven** via RTDB triggers
  (no always-on watcher / polling). Inbound interfaces (Telegram webhook later) are HTTPS.
- **Shape:** ports-and-adapters around a channel-agnostic **`presence-core`**. Channels
  (Web Push, Telegram) are adapters, not special cases.
- **Identity:** companion-only. A channel links to an **existing** `userId`; the server
  never mints identities. Honor-system model preserved.
- **Abstraction level:** Rung 1 — an **internal** `presence-core` boundary, **not** a
  public network API. HTTP is exposed only where forced (e.g. the Telegram webhook).
  Promotable to a network API later if a concrete consumer appears (none today).
- **Order:** **① presence-notifications backend + PWA Web Push** (this spec) →
  ② Telegram (account-link + pull commands + push adapter). Each gets its own spec → plan.

**This spec covers sub-project ① only.**

---

## 1. Goal & scope

Deliver server-driven push notifications to the **PWA** for three event classes, with
fine-grained per-person control, fully opt-in.

**In scope:**
- Cloud Functions backend + `presence-core` (read/decision side).
- Web Push delivery to the PWA via FCM.
- Per-person × per-type notification preferences.
- Notifications promo + permission flow (platform-aware).
- A **decoupled, non-gated** `installGuidance` module (only the notifications trigger
  wired this round).

**Out of scope (explicit):**
- Telegram (sub-project ②).
- Standalone, un-gated, durability-motivated **install nudge** (follow-up; the
  `installGuidance` module is built reusable so the follow-up needs no rework).
- Context-aware availability — option **(c)** "available in any shared context"
  (follow-up; v1 is primary-status only, option **(a)**).
- Any public/network API (Rung 2/3).
- The PWA becoming a client of `presence-core` (large refactor; out of scope).

---

## 2. Triggers & the per-person matrix

Three event classes, each independently controllable **per person**:

| | Knock | Call | Availability |
|---|---|---|---|
| **Bea** | on/off | on/off | on/off |
| **Alex K.** | on/off | on/off | on/off |

- **All default OFF** — the feature is fully opt-in; nothing notifies until the user
  deliberately switches it on per person.
- Knocks and calls are *directed* events (aimed at the recipient); availability is
  *ambient* and the per-person filter is what keeps it from becoming noise.
- The matrix is uniform: one mental model ("per person, pick what reaches me"), covering
  both Direct contacts and group members (a person is a person regardless of context).

---

## 3. Data model

All under the private `userPrefs` subtree, except server-only bookkeeping:

```
userPrefs/{uid}/
  notify/{targetUid}: { knock: bool, call: bool, availability: bool }   // absent = off
  pushTokens/{fcmToken}: { createdAt, ua? }                             // one per device
  hints/notifyPromo: true                                              // "don't prompt again"

notifierState/availability/{targetUid}: <lastFiredTs>                   // server-only debounce
```

- `notify/*` and `pushTokens/*` are written by the PWA through **`prefs.js`**
  (localStorage cache + `mergeUserPrefs` + CustomEvent — the established pattern) and
  read **server-side** by the functions.
- New `prefs.js` API: `getNotifyPrefs(targetUid)`, `setNotifyPref(targetUid, type, on)`,
  `addPushToken(token, meta)`, `removePushToken(token)`. **These route through the
  existing `mergeUserPrefs` so no new `db.js` export is required** (see §9).
- `notifyPromo` extends the existing `HINT_KEYS`.
- `notifierState/*` is server scratch space; clients have no reason to touch it (§8).

---

## 4. Trigger logic (Cloud Functions, `presence-core` read side)

Decision logic (classify → compute audience → gate on prefs → debounce) lives in **pure
`presence-core` functions** (Jest-unit-testable); RTDB-trigger wrappers and the FCM send
are thin adapters.

**① Knock** — trigger on `knocks/{recipientUid}/{senderUid}` (onCreate). Recipient +
sender from the path. Gate on `userPrefs/{recipientUid}/notify/{senderUid}.knock`.
Payload: *"Bea knocked"*, carries `senderUid` + the knock's optional `contextGroupId`
for deep-linking.

**② Call** — trigger on the call-signaling write marking an **incoming** call for the
callee (`users/{calleeUid}/callState` entering a ringing state — exact field shape
confirmed in planning against `following.js`/`canvas.js`). Gate on the callee's
`notify/{callerUid}.call`. Payload: *"Alex K. is calling"*, high-priority FCM,
deep-links to the call.

**③ Availability** — trigger scoped to the availability-bearing field(s) under
`users/{uid}` (likely `availableUntil`; narrowed so the function isn't invoked on every
code/callState write — confirmed in planning).
- Compute `available = status === 'available' && availableUntil > now`, **before vs
  after**. Fire **only on a genuine `false → true` transition** (re-ups are true→true and
  never notify; going offline never notifies).
- **Debounce flapping:** check `notifierState/availability/{uid}`; if it fired within a
  short cooldown (~3–5 min), skip without re-stamping. Otherwise stamp and proceed.
- **Audience:** read `users/{uid}/followers`; for each follower F, check
  `userPrefs/{F}/notify/{uid}.availability`; send to opted-in F's.
- v1 = **primary status only** (option a). The (c) follow-up additionally walks shared
  group membership and labels the context in the message.

**Cross-cutting delivery:**
- **Foreground de-dupe:** knocks/calls already render live in-app. On `push`, the SW runs
  `clients.matchAll()`; if a focused client exists, it suppresses the OS toast.
- **Token hygiene:** FCM send returns per-token status; invalid/expired tokens are pruned
  from `pushTokens`.

**Transport:** **FCM** (Firebase-native; manages Web Push protocol + VAPID + tokens; plugs
into Cloud Functions via Admin SDK). **Acceptance check:** verify FCM delivers to **Safari**
(macOS 16+, and installed iOS PWA); if FCM's Safari path is unreliable, fall back to raw
VAPID Web Push (`web-push`). Because transport sits behind the Web Push adapter, swapping it
is localized and doesn't touch triggers, prefs, or UI.

---

## 5. Platform matrix (Web Push support & install gate)

| Platform | Push without install? |
|---|---|
| Desktop Chrome / Edge / Firefox (Win/Mac/Linux) | ✅ Yes |
| macOS Safari 16+ | ✅ Yes |
| Android Chrome / Firefox / etc. | ✅ Yes |
| iOS/iPadOS Safari | ⚠️ Only if Added to Home Screen (standalone) |
| iOS/iPadOS Chrome / Firefox (CriOS/FxiOS) | ❌ No — must switch to Safari |

The WebKit-only mandate is **iOS/iPadOS-specific**; desktop (incl. macOS) browsers run
their own engines. The install gate is therefore a **single-cell problem: iPhone/iPad only.**

---

## 6. PWA client

### 6a. Notifications promo & permission flow — `js/notifyPrompt.js` (new)

A state machine over capability detection (`'PushManager' in window` + standalone check,
with a light `CriOS`/`FxiOS` UA sniff only to choose between the two iOS "can't here"
messages). Two entry points, one flow:

1. **Passive banner** — dismissible, *not* on first-ever load; shown after some
   engagement. Copy per state:
   - push-supported → **"Enable notifications"** → tap requests OS permission → on grant,
     FCM `getToken` → write `pushTokens`.
   - iOS Safari tab → **"Add to Home Screen to enable"** (delegates to `installGuidance`).
   - iOS Chrome/Firefox → **"Open in Safari, then Add to Home Screen"** (delegates to
     `installGuidance`).
   - permission `denied` → suppress (no nagging; reachable from settings).
   - **"Don't prompt me again"** → `markHintSeen('notifyPromo')` (kills the *banner* only).
2. **Just-in-time** — flipping any per-person toggle **on** while permission isn't granted
   triggers the permission/registration flow right there (highest-intent moment).

A permanent **"Notifications"** entry in the drawer/settings is the always-available home,
so dismissing the promo never buries the feature.

### 6b. Per-person toggle UI

On each **Direct contact** (`following.js`) and **group-roster member**
(`groupContext.js`): a **bell** opening a popover with three switches — **Knock / Call /
Availability**.
- Reads `getNotifyPrefs(targetUid)`; writes `setNotifyPref(targetUid, type, on)`.
- Bell outline when all-off, filled when any-on.
- **a11y:** focusable `<button>` + real switch controls — explicitly **not** the
  non-focusable `<div>` pattern (cf. issue #116).
- Auto-dismiss on outside-tap (mirrors the group Settings chip).
- Flipping on with push not yet enabled → kicks the JIT flow (6a).
- Cross-device: notify prefs ride `watchUserPrefs`; a new `notify-prefs-synced`
  CustomEvent in `prefs.syncFromServer` re-renders the bells (no UI imports into
  `prefs.js`, per the rule).

### 6c. Install guidance — `js/installGuidance.js` (new, **not feature-gated**)

A standalone, reusable module: detection + A2HS steps + a **secret-phrase reminder**
(installing lands in a **fresh storage partition**, so existing tab-users must re-enter
their phrase). **`NOTIFICATIONS_ENABLED` does not gate this module.** This round its only
*wired* caller is the (gated) notifications flow; the standalone, un-gated,
durability-motivated install nudge is a follow-up that calls the same module unchanged.

> Rationale: installing the PWA is valuable independent of notifications — most importantly,
> iOS Safari evicts script-writable storage (incl. `statusapp_identity` in `localStorage`)
> after ~7 days of non-use; installed standalone web apps are exempt. Engagement (home-screen
> icon) and full-screen display are secondary wins. Hence install promotion must not be owned
> by, or gated behind, notifications.

### 6d. Service worker — extend the existing `sw.js` (single SW)

A second SW can't share root scope, so rather than a separate `firebase-messaging-sw.js`,
register FCM against the existing `sw.js` (`getToken(messaging, { serviceWorkerRegistration })`)
and add:
- **`push`** → parse `{ type, title, body, targetUid, contextGroupId }`; `clients.matchAll()`
  foreground de-dupe; else `showNotification`.
- **`notificationclick`** → focus/open the PWA, `postMessage` the deep-link target; `app.js`
  routes it (`navigateToGroup` when `contextGroupId`, else Direct/contact focus). v1
  deep-linking is coarse (right context, not pixel-precise).

Touching `sw.js` (a shell asset) → **recommend** a `CACHE` bump at deploy (currently
`knockknock-v2`) — recommend, not auto.

---

## 7. Feature flag & gate boundary

`NOTIFICATIONS_ENABLED` added to `js/features.js` (matching the existing five flags).

- **Gates:** per-person bells, the notifications promo (`notifyPrompt`), SW push
  registration, FCM token writes.
- **Does NOT gate:** `installGuidance` (§6c).
- Merge **dark**; deploy functions (they no-op with zero registered tokens); flip on when
  ready. Render-gates must match handler-gates (the §5 features lesson in HANDOFF).
- Test suites mock `js/features.js` per-suite, so the flag value doesn't affect tests.

---

## 8. Security / RTDB rules

- `userPrefs/{uid}/notify`, `pushTokens`, `hints/notifyPromo` inherit the **same posture
  as the rest of `userPrefs`** (honor-system today; `auth.uid === $uid` at Phase B).
  No new client-facing rule for v1.
- `notifierState/*` is **server-only** — deny client read/write (the Admin SDK bypasses
  rules, so the notifier still works). Confirm in planning whether it falls to an existing
  `$other:false` catch-all or needs an explicit deny.
- `pushTokens` are device tokens — acceptable under the private-`userPrefs` posture;
  flagged for Phase B tightening.

---

## 9. Repo, build & CI impact

- **New `/functions` directory** (own `package.json`, Admin SDK, FCM). Deploy needs
  `firebase deploy --only functions` — the CI currently does `--only hosting,database`, so
  the deploy workflows gain a **`functions`** target (must keep hosting,database — the
  HANDOFF §2 gotcha).
- **CSP** (`firebase.json`): add FCM endpoints (`fcm.googleapis.com`,
  `fcmregistrations.googleapis.com`) to `connect-src`. Generate a **VAPID web-push key**
  for the client config.
- **`db.js` mock discipline:** notify-pref + token writes route through the existing
  `mergeUserPrefs` to **avoid new `db.js` exports**. Every new export costs a `jest.fn()`
  stub across all **17** db-mocking test files (live count verified 2026-06-05). If a new
  export proves unavoidable, that tax is called out in the plan.

---

## 10. Testing strategy

**Client (Jest + jsdom, existing harness):**
- `notifyPrompt` state machine across the full platform matrix (mock UA / standalone /
  `PushManager`).
- Per-person toggle UI in `following.js` / `groupContext.js`.
- New `prefs.js` API + `notify-prefs-synced` event in `syncFromServer`.
- SW `push` / `notificationclick` **logic extracted into pure functions** (jsdom can't host
  a real SW).
- `installGuidance` detection + copy selection.

**Cloud Functions (new test surface — none today):**
- All decision logic in **pure `presence-core` functions** with heavy Jest coverage.
- Thin trigger wrappers + FCM send covered by a lighter **Firebase-emulator** integration
  test. Introduces a new toolchain (`firebase-functions-test` + emulator) — flagged as
  setup work in the plan.

---

## 11. Open items to resolve during planning

- Exact `callState` ringing-state shape (`following.js` / `canvas.js`).
- Exact availability trigger path under `users/{uid}` (narrow scope to minimize invocations).
- `database.rules.json` structure: confirm `notifierState` deny + `userPrefs` posture.
- FCM-on-Safari delivery verification (else raw VAPID fallback).
- CI workflow edits for the `functions` deploy target.
- Deploying `functions` requires the CI service accounts (`FIREBASE_SERVICE_ACCOUNT_{DEV,PROD}`) to have **Cloud Functions Admin**, **Service Account User**, and **Cloud Build / Artifact Registry** IAM roles, plus the **FIREBASE_VAPID_KEY** present in `FIREBASE_CONFIG_{DEV,PROD}`. One-time setup outside this repo.

---

## 12. Follow-ups (deliberately deferred, designed-for)

- **Sub-project ②:** Telegram (account-link + pull commands + Telegram push adapter).
- Standalone, un-gated **install nudge** (durability + engagement) reusing `installGuidance`.
- Availability option **(c)** — notify on availability in any shared context, with a
  context label.
- Promotion of `presence-core` to a network API (Rung 2/3) if a concrete consumer appears.

---

## 13. Final-review outcome & pre-flag-on checklist

Implemented across two plans (client + server). The final holistic review confirmed strong
spec fidelity and that the feature is **safe to merge dark** (functions no-op with zero
registered tokens; all UI + token writes gated behind `NOTIFICATIONS_ENABLED = false`).
The following were raised; status noted.

**Fixed during review:**
- Server now sends a **data-only** FCM message (no `notification` block) so the SW controls
  display and foreground de-dupe works, with flat keys matching the SW's read (`functions/index.js`).
- `notificationclick` deep-link routing is wired: the SW postMessages the focused client and
  `app.js` routes group notifications via `navigateToGroup` (`js/app.js`, gated).
- Two latent test-mock breakages (recovery + invites loading `app.js`, which now imports
  `firebase-config.js` directly) fixed; root/functions Jest toolchains isolated.

**RESOLVED — verified live on dev (`NOTIFICATIONS_ENABLED = true`):**
- **Live FCM web delivery works against the raw `sw.js` `push` listener** — no `onBackgroundMessage`
  SDK or VAPID-direct fallback needed. Confirmed on an installed iOS PWA: knocks, calls, and
  availability all deliver. **One fix was required:** FCM wraps data messages, so the SW must read
  the fields from `payload.data` (not the top level) — without it iOS showed a generic
  "KnockKnock" title. Fixed in `sw.js` (reads `payload.data`, falls back to top level for raw
  Web Push); titles now render correctly.
- Availability gating (off→on transition + ~5-min per-target cooldown) confirmed working and
  intentionally kept as-is (anti-spam).

**Should-fix before any real traffic (non-blocking for dark merge):**
- **Narrow the availability trigger.** `onValueUpdated('/users/{uid}')` fires on every
  descendant write (knocks, callState, lastSeen, …) and only then no-ops via `becameAvailable`.
  Functionally correct, but it's the invocation-cost blow-up §4/§11 anticipated. Trigger on a
  narrower path (e.g. `/users/{uid}/availableUntil`) and read sibling `status` in the handler.
- **First-ever go-available won't notify** (`onValueUpdated` doesn't fire on node creation).
  Edge case; new users have no followers yet. Use `onValueWritten` if it matters.
- **Cooldown stamp is consumed even if all sends fail** (`notifier.js` stamps before fan-out).
  Low impact at the 5-min window.
