# Notifications Permission Feedback — Design

**Date:** 2026-06-07
**Branch:** `messaging-api`
**Status:** Design approved, pre-plan
**Tracks:** #128 "Permission-status UX" · follow-on to the presence-notifications work (spec `2026-06-05-presence-notifications-design.md`)

## Problem

Two gaps in the notifications opt-in flow let it fail silently:

1. **Silent failure at the point of intent.** Toggling a per-person bell on calls
   `onNeedPermission → requestPermissionAndRegister()`, which prompts when OS permission
   is `default` but **no-ops silently** when it's `denied`/blocked or push needs an iOS
   install. The bell still shows "active" (it reflects the saved *pref*, not delivery), so
   the user enables a bell and gets nothing, with zero feedback.
2. **No persistent re-enable path.** The only status surface — the `#notify-promo` banner —
   is engagement-gated and dismissable-forever. After "Don't show again," there's nowhere
   to see or fix notification status.

## Design

Replace the bell's silent permission call with an **`ensureNotificationsReady()`** flow in
`js/notifyPrompt.js` that *always* gives feedback, branching on `detectNotifyCapability()`:

| Capability state | Behavior |
|---|---|
| supported, permission `default` | Request OS permission. Granted → register token (live). Denied → show **blocked** banner. |
| supported, permission `granted` | Register/refresh token (idempotent) — silent; already works. |
| supported, permission `denied` | Show **"Notifications are blocked — re-enable in your browser settings"** banner. |
| `needs-install-ios` / `ios-use-safari` | Show the **install-guidance** banner (Add to Home Screen / Open in Safari). |
| `unsupported` | Show the "not supported here" banner. |

### Key behaviors
- **The per-person pref is always saved** (intent), even when delivery can't work yet. Once
  permission/install is fixed, the saved pref + the existing token self-heal mean it "just
  works" with no re-toggle. The banner only signals that delivery isn't *active* yet.
  Reverting the toggle would be hostile and is rejected.
- **This banner show bypasses the "dismissed-forever" hint.** The user explicitly asked for
  notifications, so we show guidance regardless of an earlier dismissal — which also makes
  the promo re-triggerable (gap #2 solved without a new surface).
- **Bell visual is unchanged** — it reflects pref/intent; the banner carries the "not
  enabled" message. No new "blocked bell" state.

### Reused, not new
- Surface: the existing `#notify-promo` banner + `guidanceCopyFor()` copy. No new markup.
- `notifyPrompt` gains an **explicit "show banner for state X"** entry point that skips the
  engagement/hint gating used by the passive promo.
- Detection: existing `detectNotifyCapability()` (states: `supported` / `denied` /
  `needs-install-ios` / `ios-use-safari` / `unsupported`).

### Out of scope
- No persistent "Notifications" settings panel/entry (option (b) was declined — YAGNI for
  this user base; the bell-toggle path is the re-enable route).
- No change to the passive engagement-gated promo banner behavior.
- No new `db.js` / `prefs.js` exports.

## Testing
`ensureNotificationsReady()` branch-by-branch in `tests/notifyPrompt.test.js` (mock
`detectNotifyCapability` result + `Notification.permission`):
- supported + `default` → calls `requestPermission`; on grant registers a token.
- supported + `granted` → registers/refreshes the token, no banner.
- `denied` → shows the banner with blocked copy, no token call.
- `needs-install-ios` → shows the banner with install copy.

Gated behind `NOTIFICATIONS_ENABLED` via its caller (the bell), unchanged.
