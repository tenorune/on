# Notifications — testing runbook (#156)

How to test web push without confusing yourself. Push behaviour differs a lot by
platform, and stale install/token/permission state from previous tests corrupts
results far more than any app bug. Read the platform matrix first, then use the
clean-test workflow.

## Platform matrix — what actually works

| Platform | Browser | In-browser push? | Install needed? | Identity after install |
|---|---|---|---|---|
| **iOS** | Safari | ❌ | ✅ Add to Home Screen | **lost** (separate storage → re-enter phrase) |
| **iOS** | Chrome/Firefox/Edge | ❌ | must switch to Safari | n/a |
| **macOS** | Safari | ❌ (accepts the push, never displays it) | ✅ Add to Dock (Sonoma+) | **lost** (separate storage → re-enter phrase) |
| **macOS** | Chrome/Firefox | ✅ | ❌ | kept (same origin) |
| **Android** | Chrome/Firefox/Edge | ✅ | ❌ | kept |
| **Windows** | Chrome/Firefox/Edge | ✅ | ❌ | kept |

Key consequences:
- **macOS Safari and iOS Safari require the installed app** (Add to Dock / Add to
  Home Screen). The app detects this and shows install guidance instead of an
  Enable button (`needs-install-macos` / `needs-install-ios`).
- **Installed Safari apps use a separate storage partition**, so the identity is
  gone in the installed app until you re-enter your secret phrase. (Chrome/Android
  installs share storage — identity carries over.)
- **The SW presents a notification for *every* push** (no foreground de-dupe): you
  get a banner even with the app focused. This is mandatory — Safari revokes a
  site's push permission if it ever receives a push without showing one.

## Hard gotchas that look like bugs

- **macOS lists each web-push source separately.** An in-browser site and its
  installed Dock app are **two different entries** in System Settings →
  Notifications. Configure the one you're testing (Allow + Banners).
- **Deleting a Chrome/Safari PWA leaves residue.** macOS keeps the per-app
  notification entry (no per-app delete); Chrome still considers the PWA installed
  (retains SW, caches, permission). A "reinstall" reattaches to the old state.
- **Each fresh install mints a new FCM token** under `userPrefs/{uid}/pushTokens`.
  Dead tokens are dropped automatically (server drops `registration-token-not-
  registered` on a failed send; client TTL-culls tokens unseen >90 days, #157),
  but mid-test you can briefly see several tokens.
- **Safari only prompts for permission from a user gesture** — no auto-prompt on
  load like Chrome. Trigger it by toggling a contact's notification bell (or the
  promo's Enable button).

## The #156 debug readout

Enable the in-app diagnostic on any build (no rebuild needed):
- Append **`?notifydebug=1`** to the URL (persists; `?notifydebug=0` turns it off).
- In an installed app (no address bar) run in its console:
  `localStorage.setItem('statusapp_notify_debug','1'); location.reload();`

It shows: `Notification.permission`, the capability state, the **local push token**
(tail), the **server token count** and whether the local token is among them, the
**controlling SW cache version**, and the **last push the SW received** (with
whether the app was visible). The last-push line is the key signal — it tells
"delivery reached the SW" apart from "never arrived".

## Clean-test workflow

Stale state is the #1 source of false results. Prefer a genuinely clean slate:

1. **Best: a fresh browser profile per clean test** — no install record, SW, cache,
   or permission grant. Most reliable.
2. **Reset in place** (DevTools → Application): *Unregister* the service worker,
   *Clear site data*, and reset the notification permission (site settings → set
   Notifications back to "Ask").
3. **Wipe an installed PWA's storage** (to sign in as another user / start fresh) —
   run in its console, then reload:
   ```js
   (async () => {
     try { localStorage.clear(); sessionStorage.clear(); } catch {}
     if (self.indexedDB?.databases) { for (const d of await indexedDB.databases()) indexedDB.deleteDatabase(d.name); }
     if (self.caches) { for (const k of await caches.keys()) await caches.delete(k); }
     const regs = (navigator.serviceWorker && await navigator.serviceWorker.getRegistrations()) || [];
     for (const r of regs) await r.unregister();
     location.reload();
   })();
   ```
4. **macOS leftovers:** remove stale app shims in `~/Applications/Chrome Apps.localized/`
   and the duplicate entries in System Settings → Notifications when they pile up.

### Re-enabling after a revoked permission (Safari)
If Safari revoked the permission (or you denied it), the in-app re-enable does
nothing until you reset it: **Safari → Settings → Websites → Notifications →** find
the site → **Allow** (or remove it so it asks again), then reload and re-grant.

## A clean end-to-end test (macOS Safari example)

1. Fresh profile (or reset in place). Open the app, restore your account.
2. **File → Add to Dock**; open the installed app; re-enter your secret phrase.
3. In the installed app, enable a contact's notification bell → grant permission.
4. Open the readout (`localStorage.setItem('statusapp_notify_debug','1');
   location.reload();`). Confirm: a **local token**, **local on server? yes**, the
   **new SW cache** hash.
5. **Hide the app**, have a second account knock/call you, watch the **last push**
   line update — and the banner appear.

## Manual `showNotification` sanity check

Bypasses the whole push path to test display in isolation:
```js
navigator.serviceWorker.ready
  .then(r => r.showNotification('Test', { body: 'manual' }))
  .then(() => console.log('✅ resolved'))
  .catch(e => console.error('❌ threw:', e));
```
- Banner appears → display works; any "no notification" is in the push/delivery path.
- "✅ resolved" but no banner → the OS is dropping it (in-browser macOS Safari does
  this — use the installed app).
- "❌ threw" → the error is the cause.

## Related
- #156 (this issue), #157 (token TTL cull), #128 (notifications program),
  #161 (install nudge), #145 (restored-device permission/token).
