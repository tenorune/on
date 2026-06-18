# Onboarding & PWA Install Redesign — Design Spec

Date: 2026-06-16
Status: approved design, pre-implementation
Companion reference: `docs/onboarding-platform-matrix.md` (capability matrix this builds on)

## Goal

Make it very simple for a new user to (a) create an account and (b) install the
PWA where installing is the right call — tailored per platform. Installing is
surfaced proactively in first-run (today it only appears on the 2nd session or a
bell tap), sequenced so the iOS storage-partition data-loss trap is handled, and
never forced where it adds nothing.

## Scope

Three areas:

1. **Account creation** — keep the existing 4-word-phrase flow; add (invisible)
   iOS/macOS Keychain-save semantics.
2. **Install** — bring it into first-run, platform-tailored via a capability-driven
   lane selector; add a real in-app Install button (`beforeinstallprompt`) and a
   persistent, re-accessible install affordance.
3. **Notifications** — **unchanged.** Verified (see below) that the native
   permission prompt only fires from an explicit user gesture (bell toggle or the
   Enable button); the app never asks cold. No notification onboarding step is
   added. Install becomes the proactive thing; notifications stay reactive /
   bell-gated.

**No backend changes.** Restore reuses the existing
`validateRecovery` → `signInWithCustomToken` path. No new Cloud Function, no
schema change. `functions/` tests untouched.

### Notification-gating verification (why notifications are out of scope)

- Bell toggle calls `onNeedPermission()` **only when toggling a pref ON** —
  single-type bell `js/notifyBell.js:80`, multi-type switch `js/notifyBell.js:104`
  (both guarded by `if (next && …)`).
- That calls `ensureNotificationsReady()` (`js/notifyPrompt.js:117`), which fires
  the native `Notification.requestPermission()` **only** when capability is
  `supported` (`:119-120`); otherwise it shows install guidance.
- `Notification.requestPermission()` exists in exactly one place,
  `requestPermissionAndRegister()` (`js/notifyPrompt.js:55`), reachable only from
  (a) the bell toggle and (b) the Enable button. Even the passive 2nd-session
  promo is a soft banner — it never prompts cold.

## Architecture

A single capability-driven **lane selector** decides the onboarding path.

### Lane selector — `onboardingLane()`

New helper in `js/installGuidance.js`, building on the existing
`detectNotifyCapability()`. Returns one of:

| Lane | Condition | Behavior |
|---|---|---|
| `ios-use-safari` | iOS, non-Safari browser (`CriOS\|FxiOS\|EdgiOS\|OPiOS`) | Early (pre-create) "open in Safari" redirect at the welcome screen |
| `ios-install` | iOS Safari, not standalone | Inline install step after account creation; opt-out allowed |
| `macos-install` | macOS Safari tab, not standalone | Inline install step (Add to Dock); opt-out allowed |
| `installable` | `beforeinstallprompt` has fired (Chromium desktop/Android) | Land in app; bottom-left install icon → toast with real Install button |
| `push-in-tab` | Desktop Firefox (push works, can't install) | Land in app; bottom-left icon → toast with "install via another browser" copy, no button |
| `ready` | Already standalone/installed, or nothing to offer | Land in app; nothing — no icon, no nudge |

`installable` vs `push-in-tab` is distinguished by whether `beforeinstallprompt`
has fired (with a short grace window / Firefox-desktop UA check, since the event
is async and "hasn't fired yet" ≠ "won't fire").

### Flow shape (new user)

```
splash → welcome ("I'm new" / "I have a phrase")
  │
  │  [if ios-use-safari detected at welcome:] early "open in Safari" redirect
  │   surfaced BEFORE account creation, so the account is created in Safari
  │   directly (avoids create-here-then-restore-there shuffle). The phrase
  │   bridges browsers, so this is a convenience, not a hard gate.
  │
  ├─ "I'm new" → recovery-phrase screen (generate + Keychain-save form) → "I've saved it"
  │                                                              │
  │                                  ┌──────── lane selector ────┘
  │                                  ▼
  │   ios-install / macos-install:  inline install step (instructions + verbatim
  │       phrase reminder + "Maybe later") → [user installs, leaves tab]
  │                                  │
  │                                  ▼ (relaunch in standalone, empty storage)
  │       standalone + no identity → RESTORE-PRIMED screen (AutoFill / Paste /
  │       manual) → main UI
  │
  │       "Maybe later" → land in main UI un-installed (no push until installed;
  │       install stays reachable via the corner icon + bell-tap guidance)
  │
  │   installable:   land in main UI + bottom-left install icon → toast (Install)
  │   push-in-tab:   land in main UI + bottom-left icon → toast (install-elsewhere copy)
  │   ready:         land in main UI (nothing)
  │
  └─ "I have a phrase" → restore screen (Keychain AutoFill) → [same lane logic]
```

### Standalone-launch routing

On boot (`js/app.js` `ensureIdentity`): if `display-mode: standalone` **and** no
stored identity → render the **restore-primed** screen instead of the
new/restore chooser. Rationale: our flow only prompts install *after* account
creation, so a standalone launch with empty storage is almost certainly a
just-installed user who must restore — not a brand-new user. Showing the chooser
risks them tapping "I'm new" and creating a duplicate account. Decision is a
small pure function `(standalone, hasIdentity) → screen`, testable in jsdom.

The restore-primed screen never relies on AutoFill succeeding — it always offers
three paths:
1. Input with `autocomplete="current-password"` (one-tap if Keychain has it).
2. A **Paste** button (reads clipboard on the gesture — the phrase the install
   step copied).
3. Plain manual entry.

Plus a quiet **"I don't have a phrase yet"** escape hatch → the normal create
flow, for the rare genuine-new-in-standalone case.

## Components & behavior

### Account-creation screen (all lanes)

Keep the existing recovery-phrase screen (generate / copy / rotate / "I've saved
it"). Add Keychain semantics: render the phrase inside a real `<form>` with a
hidden/readonly username input (value = the account's share `code` — a stable
AutoFill label, never surfaced or promised to the user) + the phrase field
marked `autocomplete="new-password"`. On "I've saved it," iOS/macOS may offer
"Save Password." **We never inspect or assert whether the save happened** — there
is no web API to confirm it, so no copy ever claims the phrase is saved. The
existing iOS phrase-save reminder copy is unchanged.

### Phrase-reminder block (single shared component)

Exactly one phrase-reminder component, reused verbatim everywhere it appears
(install step, iOS guidance). Strings and behavior are the existing ones from
`js/notifyPrompt.js:202-218`:

- Reminder: *"First, make sure you've saved your secret phrase — you'll need it
  to restore your account after installing."*
- *"Secret phrase: [Copy to clipboard]"* — copies `loadIdentity().recoveryCode`
  to the clipboard **without displaying it**, flips to "Copied!" for 1.5s.

The current else-branch renderer (`renderBanner` body + this reminder block) is
extracted into a small reusable piece that both the bell-tap guidance and the
onboarding install step call — no duplicated copy, no second clipboard
implementation.

### `ios-install` / `macos-install` step

- **Body** (context-appropriate, differs from the bell-tap nudge — exact lead-in
  is an implementation detail; recorded direction below): lead with the
  *notification* value (knocks, calls, people coming online), **not** the icon,
  then the platform install instructions, reusing the existing Share/➕/Dock step
  icons (`js/installGuidance.js:56-58`). See **Copy conventions** below.
  - iOS direction: *"To get notified about knocks, calls, and people coming online,
    add KnockKnock to your Home Screen."* + Share→➕ steps.
  - macOS direction: *"To get notified about knocks, calls, and people coming
    online, add KnockKnock to your Dock."* + File→Add to Dock steps.
- **Phrase-reminder block** (verbatim shared component, above).
- **Primary action:** the instructions themselves (user performs the OS install).
- **Secondary action:** **"Maybe later"** → lands in the app un-installed. No
  push until they install; install stays discoverable via the bottom-left corner
  icon and the existing bell-tap guidance path. Install is never lost.

### `ios-use-safari` (early redirect)

Detected at the welcome screen; surfaced **before** account creation: "for
notifications, open this in Safari." Reuses the shared phrase-reminder block
(single source of truth). Once in Safari, the user hits `ios-install`. The phrase
bridges browsers either way, so this is convenience, not a gate.

### Install affordance — bottom-left corner icon + toast

A small fixed-position icon at the **bottom-left corner** of the screen, theme-
colored (inherits `currentColor` from a muted theme token, consistent with the
bell). Glyph (Feather "download"):

```html
<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
     stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
  <polyline points="7 10 12 15 17 10"/>
  <line x1="12" y1="15" x2="12" y2="3"/>
</svg>
```

- Clicking opens the install **toast** (card).
- **Dismissing the toast hides the toast only — the corner icon stays.** No
  permanent `markHintSeen`-style dismissal; install remains re-accessible.
- Icon appears **only** when install is relevant: `installable` or `push-in-tab`,
  and not yet installed. It naturally disappears once `appinstalled` fires or in
  the `ready` lane.

**Toast content by lane:**
- `installable`: real **Install** button calling the captured
  `beforeinstallprompt` (single-use; hide after `.prompt()`).
- `push-in-tab` (Firefox), **no button**, platform-aware copy, no bookmark line:
  - macOS: *"To get notified about knocks, calls, and people coming online even
    when your browser is closed, open the app in Safari, Chrome, or Edge and
    install it."*
  - Windows/Linux: *"To get notified about knocks, calls, and people coming online
    even when your browser is closed, open the app in Chrome or Edge and install
    it."*

### `beforeinstallprompt` capture

Module-level listener at app init: `preventDefault()` and stash the event; expose
a getter and an `appinstalled` listener that clears it. The corner icon/toast for
`installable` appears only once the event has fired. The stash is also the signal
that distinguishes `installable` from `push-in-tab`.

### Notifications

Unchanged. Bell-gated, soft, contextual (verified above). Firefox included — a
Firefox user tapping a bell still gets the existing Enable path (notifications
while Firefox is open). The corner nudge is purely the *additional* path to the
more-reliable installed experience; it gates/replaces nothing.

## Copy conventions

Any new copytext introduced by this work must, before being written, **survey the
app for related existing copy and match its tone and content.** Notable anchors:

- The notification value is consistently phrased around the events, not the
  mechanics: *"Get notified about knocks, calls, and people coming online."*
  (`js/notifyPrompt.js:178`). New copy frames value the same way.
- **The value is being notified — knocks, calls, someone becoming available — and
  (on desktop) getting those even when the browser is closed. It is NOT the
  home-screen/dock icon or "quick access."** Do not lead with the icon.
- Reuse exact existing strings where the meaning is identical (e.g. the shared
  phrase-reminder block) rather than paraphrasing — avoid multiple wordings of the
  same thing.

This applies during implementation to every new string, including the install-step
body lead-ins recorded above (which are directions, not final copy).

## Edge cases & known limitations

- **iOS < 16.4:** web push is unavailable even after install. Not special-cased.
  Pre-install we can't cheaply/reliably know the iOS version, and install still
  has value (icon/quick access), so we offer it. Post-install, `<16.4` lacks
  `PushManager`, so capability detection already returns `unsupported` and the
  bell path shows the existing "doesn't support web notifications" copy. Recorded
  as a known limitation.
- **Keychain AutoFill in a standalone iOS PWA** *should* work (QuickType offers
  saved passwords there), but iOS has quirks — **must be verified on a real
  device** before relying on it as the primary restore path. The restore-primed
  screen degrades gracefully (Paste / manual) regardless, so this is an upside,
  not a dependency.
- **`ios-use-safari` cannot use Keychain usefully** (different browser); it relies
  on the clipboard copy + the phrase bridging to Safari.

## Testing

- **Unit (`npx jest`, jsdom):**
  - `onboardingLane()` mapping across UA / standalone / permission combinations
    (extends existing `installGuidance` tests).
  - The extracted phrase-reminder renderer (copy + clipboard interaction).
  - The `beforeinstallprompt` capture state machine (stash, button enable,
    single-use, `appinstalled` clear).
  - The standalone-routing pure function `(standalone, hasIdentity) → screen`.
- **Manual (`docs/SMOKE-TEST.md` gains an onboarding section):** device matrix —
  iOS Safari, iOS Chrome (→ Safari redirect), macOS Safari, desktop Chrome
  (install card), desktop Firefox (upsell toast), Android Chrome. Must-verify on
  a real device: **Keychain save on create + AutoFill on restore inside the
  installed iOS PWA.**
- **`functions/` tests untouched** — no server changes.

## Files expected to change

- `js/installGuidance.js` — add `onboardingLane()`; extract the guidance/phrase-
  reminder renderer for reuse.
- `js/notifyPrompt.js` — extract the phrase-reminder block; share it with the
  onboarding install step.
- `js/app.js` — welcome / recovery / restore screens; standalone-launch routing;
  the inline install step; early `ios-use-safari` redirect; restore-primed screen.
- New small module for the install affordance (`beforeinstallprompt` capture +
  corner icon + toast).
- `index.template.html` + `css/app.css` — corner install icon, restore-primed
  screen, Keychain form fields/attributes.
- `docs/SMOKE-TEST.md` — onboarding device-matrix section.
- `docs/HANDOFF.md` — note the new onboarding behavior once shipped.

## Open items to confirm during implementation

- Exact install-step body lead-in copy (direction recorded above).
- The precise codebase location to anchor the bottom-left corner icon (and any
  persistent settings/menu entry, if warranted).
- Real-device confirmation of iOS standalone Keychain AutoFill.
