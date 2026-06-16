# Onboarding & PWA Platform Matrix

Reference for the onboarding-simplification work. Maps each browser/platform's
real PWA + web-push capabilities against **what the app does today**, and states
whether installing the PWA is the right call for that setup.

Status: research / orientation doc (2026-06-16). Behavior described is current
`dev`. Update when onboarding behavior changes.

---

## 1. The decision engine (how the app decides today)

Everything routes through one pure function: **`detectNotifyCapability()`** in
`js/installGuidance.js:38-51`. It returns one of six **states**, and both the
install nudge and the notification toast are just rendered views of that state
(`js/notifyPrompt.js:174-224`, copy in `js/installGuidance.js:60-99`).

| State | Meaning | What the user sees |
|---|---|---|
| `supported` | Push API present, delivery expected | "Enable" button → `Notification.requestPermission()` → FCM token |
| `needs-install-ios` | iOS Safari, not installed | "Add to Home Screen" + Share/➕ icons + save-your-phrase reminder |
| `needs-install-macos` | macOS Safari tab, not installed | "Add to Dock" + save-your-phrase reminder |
| `ios-use-safari` | iOS Chrome/FF/Edge/Opera | "Open in Safari" + save-your-phrase reminder |
| `denied` | Permission blocked | Browser-specific re-enable instructions |
| `unsupported` | No Push API | Banner hidden (silent no-op) |

**Detection signals** (`js/installGuidance.js:5-34`):

- `isStandalone()` — `navigator.standalone === true` **or** `matchMedia('(display-mode: standalone)')`.
- `isPushApiAvailable()` — `PushManager` + `Notification` + `serviceWorker` all present.
- `isIos()` — UA `iPhone|iPad|iPod`, or `Macintosh` + touch (iPadOS).
- `isIosThirdParty()` — iOS + `CriOS|FxiOS|EdgiOS|OPiOS`.
- `isMacSafari()` — `Macintosh` + `Safari`, excludes Chromium/FF, `maxTouchPoints === 0`.

**No `beforeinstallprompt` is used anywhere.** Install is always "point the user
at the OS's own menu," never a programmatic prompt. (Capturing
`beforeinstallprompt` on Chrome/Edge/Android is an available improvement — it
would let us drive a real in-app install button instead of instructions.)

---

## 2. Does web push need a tab open? No.

This app uses **web push** (Push API + service worker + FCM), not in-page
notifications. The distinction matters for the onboarding pitch:

- Push is delivered to the **service worker by the OS/browser push service even
  with zero tabs open** — and on mobile, even with the browser fully closed. A
  knock arrives whether or not the app is open.
- Therefore **a pinned tab or bookmark does nothing for push delivery.** Do not
  frame onboarding around "keep a tab open."

What the various "keep it handy" actions actually buy:

| Concern | Pin/bookmark | Install PWA |
|---|---|---|
| Receiving a knock (push delivery) | ❌ no effect | ✅ most reliable — OS-level, survives browser quit |
| Getting back in (set status, answer call, draw) | ✅ a way back | ✅ home-screen/dock icon |
| Broadcasting "available" | n/a (server-side once set) | n/a |

**Desktop delivery caveat:** push needs the browser's *background process* alive.
Chrome/Edge/Firefox deliver push with no tab open, but if the user **fully quits
the browser**, desktop push pauses until reopen. **Installing decouples delivery
from "is the browser running"; a bookmark does not.**

**Implication for the nudge:**

- Where install is available → nudge **install**, not bookmark. Strictly better:
  icon for re-entry *and* better delivery.
- Firefox desktop (no PWA install) → a bookmark/pin is the best available, but
  sell it as "so you can get back in," and be honest that delivery depends on
  Firefox running. Don't oversell it as making notifications work.

---

## 3. The matrix

| Platform / Browser | PWA install | Web push needs install? | Current install nudge | Current notification toast | Install the right call? |
|---|---|---|---|---|---|
| **iOS Safari (tab)** | ✅ Home Screen | ✅ **Required** (iOS 16.4+) | "Add to Home Screen" + phrase reminder (`needs-install-ios`) | Same banner; no "Enable" until installed | **Yes — mandatory.** No install = no push. |
| **iOS Chrome/FF/Edge/Opera** | ⚠️ via Safari only | ✅ Required, Safari-only | "Open in Safari" + phrase reminder (`ios-use-safari`) | Same | **Yes — but must switch to Safari first.** Biggest friction cliff. |
| **iPadOS Safari** | ✅ Home Screen | ✅ Required | Same as iOS (touch-detected) | Same | **Yes — mandatory.** |
| **macOS Safari (tab)** | ✅ Add to Dock | ✅ **Required** (in-tab push confirmed non-working) | "Add to Dock" + phrase reminder (`needs-install-macos`) | Same | **Yes — required.** |
| **macOS Safari (installed/Dock)** | (installed) | — | none → `supported` | "Enable" button | Already done. |
| **macOS Chrome/Edge** | ✅ optional | ❌ No | none → `supported` | "Enable" button | **Optional.** Push works in-tab; install = nicety + reliability. |
| **Windows/Linux Chrome/Edge** | ✅ optional | ❌ No | none → `supported` | "Enable" button | **Optional.** Same as above. |
| **Desktop Firefox** | ❌ no PWA install | ❌ No | none → `supported` | "Enable" button | **No install path here.** Soft nudge to Chrome/Edge for the full (installable) experience — see §3a. Else bookmark/pin for re-entry. |
| **Chrome/Edge Android** | ✅ optional (`beforeinstallprompt` available) | ❌ No | none → `supported` | "Enable" button | **Optional, recommended.** Push works either way; install adds home-screen presence + reliability. |
| **Samsung Internet / FF Android** | ✅ / ⚠️ | ❌ No (if Push API present) | `supported` or `unsupported` | "Enable" or hidden | Optional. |
| **In-app browsers** (IG/FB/etc.) | ❌ | ❌ | falls to `unsupported` → hidden | hidden | **No** — can't install or push. Should tell user to open in a real browser. |
| **Any browser, permission denied** | — | — | "blocked, re-enable here" (Safari path vs address-bar) | same | N/A |

> **macOS Safari-in-tab:** confirmed non-working in hands-on testing (a prior
> session tried exhaustively and could not get in-tab push to display). Treated
> as a hard install-to-Dock requirement, matching `js/installGuidance.js:42-46`.

---

## 3a. "Use a different browser for the full experience" nudge

We already redirect iOS non-Safari users to Safari (`ios-use-safari`). We want a
**parallel nudge for browsers where install isn't available** — primarily
**desktop Firefox** — pointing at Chrome/Edge.

**Critical difference in framing — do not copy the iOS tone verbatim:**

- **iOS Chrome → Safari is a _fix_.** Web push is *impossible* in iOS non-Safari
  browsers, so the redirect is the only path to notifications at all. Firm nudge
  is warranted.
- **Firefox desktop → Chrome/Edge is an _upgrade_.** Push *already works* in
  Firefox (it returns `supported`; the "Enable" button functions). Firefox just
  can't **install** the PWA. Switching buys the app icon + reliable background
  delivery (alerts even when the browser is closed) — **not** notifications from
  zero. Copy must not imply notifications are broken, or Firefox users will think
  a working feature is broken.

**Recommended behavior for the "push works but not installable" bucket** (really
just desktop Firefox; in-app browsers fall to `unsupported` and can't push
either):

1. **Soft, optional** upsell: "Notifications work here. For the full experience —
   an app icon and alerts even when your browser is closed — open this in Chrome
   or Edge and install it." Ranked **below** the iOS redirect in urgency; never a
   gate.
2. Otherwise let them proceed with in-tab push **plus** the bookmark/pin
   suggestion framed as "so you can find your way back" (§2).

**Implementation note:** today every push-capable browser collapses to a single
`supported` state, so we can't distinguish "supported **and** installable"
(Chrome/Edge desktop, Android) from "supported but **not** installable" (Firefox
desktop). The redesign needs a new detection branch — UA-sniff Firefox desktop,
or capture `beforeinstallprompt` (fires on installable browsers) to know install
is genuinely on offer before showing the upsell.

---

## 4. The iOS data-loss trap (load-bearing)

Installing a PWA on iOS (and macOS Safari → Dock) lands the app in a **fresh
storage partition** — localStorage is empty, so the user's identity is gone
**unless they re-enter their secret phrase.** The app mitigates this by appending
a "save your phrase first" reminder + clipboard-copy button *inside* the install
nudge (`js/notifyPrompt.js:195-219`, `remindPhrase: true` on the iOS/macOS
states).

But today that reminder fires **too late and out of band** — see §5.

---

## 5. Where install/notify nudges sit in onboarding today (the gap)

Account creation and install/notification nudging are **separate flows**.

**Onboarding sequence today** (`js/app.js`): splash → welcome ("I'm new" /
"I have a secret phrase") → recovery-code modal (generate 4-word phrase, "I've
saved it") → main UI. **Nothing about install or notifications appears here.**

The install/notification banner only appears:

- on the **2nd session onward** (`_engaged` gate, `js/notifyPrompt.js`), **or**
- when the user toggles a per-contact notification bell
  (`js/notifyBell.js` → `ensureNotificationsReady()`).

**Consequence on iOS:** a brand-new user creates their account in a throwaway
Safari tab, sees nothing about installing, and — because iOS install wipes the
storage partition — would lose their identity if they hadn't kept the phrase.
The save-phrase reminder exists, but it's buried in a banner that shows up later,
not during the create-account moment when it matters.

This is the core thing the redesign should fix: **bring the
install/notification step into onboarding, sequenced per platform, with the
phrase-save guaranteed before any install on iOS/macOS.**

---

## 6. Implied onboarding lanes

The redesign splits into three lanes, keyed off the existing capability state:

1. **iOS / iPadOS lane** — install is step zero. Phrase-save must complete
   *before* install. Handle the non-Safari "open in Safari" detour explicitly
   (it's a two-step cliff: switch browser → then install).
2. **Installable desktop + Android lane** — notifications are the goal; install
   is an optional "add for quick access + reliable alerts" upsell, not a gate.
   Good place to adopt `beforeinstallprompt` for a real in-app install button.
3. **Push-in-tab lane** (desktop Chrome/Edge; Firefox) — no install gate. Soft
   notification ask at a meaningful moment. **Firefox desktop** additionally gets
   the soft "open in Chrome/Edge for the full experience" upsell (§3a), then a
   bookmark/pin suggestion framed as "so you can find your way back." (Note
   Chrome/Edge desktop belong to lane 2 — they *are* installable.)

Assets to lean on: `detectNotifyCapability()` already encodes nearly the whole
matrix — the redesign should consume it rather than re-detect platforms.

---

## 7. Open questions / things to verify before building

- iOS minimum version: web push requires iOS/iPadOS **16.4+**. Confirm whether we
  surface anything for older iOS (currently they fall into `needs-install-ios`
  but push still won't work post-install on < 16.4).
- Whether to adopt `beforeinstallprompt` (Chrome/Edge/Android) for a real
  in-app install button vs. keeping instruction-only.
- Exact placement of the phrase-save gate relative to the iOS install step.

---

## File reference

- `js/installGuidance.js` — capability detection + guidance copy (`detectNotifyCapability`, `guidanceCopyFor`).
- `js/notifyPrompt.js` — banner rendering, promo/reprompt gating, permission request, phrase reminder.
- `js/notifyBell.js` — per-contact bell; entry point that triggers `ensureNotificationsReady()`.
- `js/app.js` — onboarding sequence (splash, welcome, recovery-code modal, restore).
- `js/identity.js` — phrase generation, userId derivation, localStorage.
- `sw.template.js` — push handler (always shows notification; Safari permission-revoke workaround), click routing.
