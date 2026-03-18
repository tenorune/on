# Call Mode Design

## Goal

When a user right-swipes a mutual's card, their app enters Call mode: the entire UI adopts the mutual's palette and status color, and the mutual's card pulses at the top of the Mutuals list. On the mutual's side, the caller's card silently begins pulsing. Either user can exit by left-swiping the relevant card.

This spec covers the initial scope: both users available, one initiates.

---

## Section 1: Swipe gesture

Right-swipe past ~40% of a mutual's card width enters Call mode instantly. Left-swipe on the same card exits it.

Gesture handling is added to `.person-list li` elements in `following.js` using `pointerdown` / `pointermove` / `pointerup` events (works for both touch and mouse). A minimum horizontal-to-vertical displacement ratio prevents accidental triggers during vertical scrolling. The existing `touch-action: manipulation` CSS on `.person-list li` must be changed to `touch-action: pan-y` so the browser delivers horizontal `pointermove` events on touch devices while still allowing vertical scrolling.

Call mode is only enterable on mutual cards (not follower-only cards).

If already in Call mode with one mutual, right-swiping a different mutual replaces it via a **single atomic write** of the new `callState` (no intermediate delete). The caller's theme switches directly to the new mutual's theme without reverting to their own in between.

---

## Section 2: Firebase data model

Call state is stored as a single field on the caller's user document:

```js
// users/{callerId}
callState: { calleeId: 'user123', since: <timestamp> }
```

When Call mode ends, `callState` is deleted from the caller's doc by setting the field to `null` via `update()` (RTDB removes `null` fields automatically).

This requires no new Firebase subscriptions. The receiver already watches the caller's full user document through the existing mutual followee subscription. When `updateFolloweeRow` receives `userData` containing `callState.calleeId === myUserId`, it applies the pulsing glow. When the field is absent or points to someone else, the glow is removed.

**Firebase Security Rules:** `callState` is a field on the root user document (`users/{callerId}`). Writing it from another user's client requires an explicit RTDB rule. Add a `callState` rule under `users/$userId`:

```json
"users": {
  "$userId": {
    "callState": {
      ".write": "auth != null && (auth.uid === $userId || auth.uid === data.child('calleeId').val())"
    }
  }
}
```

`auth.uid === $userId` covers the caller writing or deleting their own field. `auth.uid === data.child('calleeId').val()` covers the receiver deleting the field (using `data` — the current stored value before the write — which contains `calleeId` even during a delete). `setCallState` / `clearCallState` in `db.js` use `update(ref(db, 'users/'+callerId), { callState: ... })` and `update(ref(db, 'users/'+callerId), { callState: null })` respectively. (`null` removes the field in RTDB; `deleteField()` is a Firestore sentinel and must not be used here.)

The receiver exiting Call mode deletes `callState` on the caller's root document via `clearCallState(callerId)`. The receiver performs this write optimistically — the glow is removed from the UI immediately on left-swipe; if the Firebase delete fails, it is silently ignored and the glow remains absent locally while the caller's subscription eventually clears it.

---

## Section 3: Caller-side behavior

Before entering Call mode, **snapshot the caller's current `statusColor`** in memory. This snapshot is used on exit. It is not persisted (in-memory only); if the app is restarted while in Call mode, the caller's own palette's primary color is used as the revert value instead. The snapshot is taken only at the first Call mode entry in a session. If the caller replaces one Call mode target with another (right-swiping a second mutual while already in Call mode), the existing snapshot is preserved unchanged so exit always reverts to the true original color.

On right-swipe (entering Call mode):

1. Call `setCallState(callerId, calleeId)`. The function writes `{ callState: { calleeId, since: Date.now() } }` to `users/{callerId}` — `since` is generated inside `setCallState` and is not a parameter.
2. Apply the callee's full theme: `applyThemeVars(calleePalette.theme)` using the palette object for `callee.paletteKey`. If `paletteKey` is null, skip this step — no theme change.
3. Apply the callee's status color: call `document.documentElement.style.setProperty('--my-status', color)` and `document.documentElement.style.setProperty('--my-glow', 'rgba(' + hexToRgb(color) + ', 0.4)')` directly, where `color` is `callee.statusColor` if set, or `'#22c55e'` as fallback (matching the existing `updateFolloweeRow` fallback). Do not use `getGlowForColor` here — it only matches palette primary colors and returns the wrong value for complement swatches. Do not call `applyPaletteVars` for `--my-status`/`--my-glow` — always use the raw `statusColor` value.
4. Update the caller's own `statusColor` in Firebase (via `setStatusColor`) to `callee.statusColor` (or the fallback `'#22c55e'`). This ensures all other mutuals see the caller's dot in the adopted color.
5. Note: `applyThemeVars` internally writes to `localStorage` (`statusapp_theme`). This means the callee's theme is cached to localStorage while in Call mode. On exit, `applyThemeVars` is called again with the caller's own theme, overwriting the cache — so a clean exit is safe. If the app is force-closed during Call mode, the cached theme may be the callee's; the restart logic in Section 6 handles this correctly by re-entering Call mode anyway.
6. Move the callee's card to the top of the Mutuals list. This must be reflected in `sortFollowees` / `renderList`: when Call mode is active, `renderList` places the callee's card first in the Mutuals section. DOM manipulation outside `renderList` is not used, as `renderList` can be re-triggered by follower changes and would clobber any external DOM sort.
7. Apply the pulsing glow CSS class to the callee's card (color: `callee.statusColor` or fallback `'#22c55e'`). Before adding `.call-mode`: (a) clear any in-progress knock animation by resetting `li.style.boxShadow = ''` and `li.style.transition = ''`; (b) set `li.style.setProperty('--call-color-rgb', hexToRgb(color))` so the animation has the correct color. Then add `.call-mode` to the element's class list.

---

## Section 4: Receiver-side behavior

`subscribeToFollowee` in `following.js` has a change-detection guard that skips `updateFolloweeRow` when only unrelated fields change. **`callState` must be added to this guard** so that a `callState` write triggers `updateFolloweeRow` even when `status`, `availableUntil`, `statusColor`, `paletteKey`, and `code` are unchanged.

When `updateFolloweeRow` receives `userData.callState?.calleeId === myUserId`:

1. Apply the pulsing glow CSS class to the caller's card. The glow color is `userData.statusColor` (the caller's adopted color at the time of the update) or fallback `'#22c55e'`. Set `li.style.setProperty('--call-color-rgb', hexToRgb(color))` on the card's `<li>` element before adding `.call-mode` to the class list.
2. The card remains in its natural position in the Mutuals list — no reordering on the receiver's side.

No notification, sound, or badge. The glow appears silently.

When `callState` is absent or `callState.calleeId !== myUserId`, remove the pulsing glow class from the caller's card.

The receiver can:

- **Left-swipe** the glowing card → deletes `callState` on the caller's doc (see Section 2 for path), removing Call mode for both users
- **Right-swipe** the glowing card → reserved for future Canvas feature; no-op in this implementation
- **Ignore it** → glow persists until the caller exits manually

---

## Section 5: Exit and revert

Call mode ends when either user left-swipes the relevant card. The caller's `callState` field is deleted from Firebase. Both users' subscriptions see the cleared field on their next data update.

**Caller's side on exit:**

- Revert theme: call `applyThemeVars` with own palette's theme (from `getPaletteState()`) if an active palette exists, or `resetThemeVars()` if not
- Revert status color: restore the snapshotted pre-call `statusColor` value to both CSS vars and Firebase. Specifically: call `document.documentElement.style.setProperty('--my-status', revertColor)` and `document.documentElement.style.setProperty('--my-glow', 'rgba(' + hexToRgb(revertColor) + ', 0.4)')` directly, then call `setStatusColor(revertColor)`. Use `hexToRgb` (not `getGlowForColor`) since the snapshot may be a complement swatch that `getGlowForColor` does not handle. `revertColor` is the in-memory snapshot; if no snapshot is available, use the active palette's primary color (`getPaletteState()`). Do not call `applyPaletteVars` — it unconditionally overwrites `--my-status`/`--my-glow` and would clobber the restored snapshot value if the pre-call color was a complement swatch.
- Remove pulsing glow from callee's card: remove `.call-mode` from the class list and call `li.style.removeProperty('--call-color-rgb')` to clean up the inline CSS variable.
- `renderList` will return callee's card to its natural sort position on the next rebuild; if a rebuild does not occur naturally, trigger one

**Receiver's side on exit:**

- `updateFolloweeRow` fires with `callState` absent → remove pulsing glow from caller's card (handled automatically if Section 4's change-detection guard includes `callState`)

No confirmation dialog. Left-swipe is immediate.

---

## Section 6: Persistence on app restart

Call mode state is detected during app initialisation via the **first event of the existing `watchStatus(myUserId, callback)` subscription** in `app.js`. When the first event fires and `userData.callState` exists:

- Look up the callee in the local following list (`getFollowing()`)
- If not found (unfollowed while app was closed): delete `callState` from Firebase silently, do not apply any theme
- If found and it is a mutual: perform a one-time `get(ref(db, 'users/' + calleeId))` to fetch the callee's current `paletteKey` and `statusColor`. If the get fails (offline or error), skip Call mode re-entry and delete `callState` from Firebase silently. If it succeeds, re-enter Call mode (apply theme, sort card, pulsing glow) without re-writing `callState` to Firebase.

The restart path does not rely on the `statusapp_theme` localStorage cache for correctness — it re-derives the theme from the freshly fetched `callee.paletteKey`. At cold start, followee subscription data has not yet arrived, so relying on cached `lastUserData` is not safe; the one-time `get()` is the authoritative source.

The receiver side needs no special restart handling — the existing followee subscription picks up `callState` on its first data event.

---

## CSS

Add to `css/app.css`:

```css
@keyframes call-pulse {
  0%, 100% { box-shadow: 0 0 0 1.5px rgba(var(--call-color-rgb), 0.5), 0 0 14px rgba(var(--call-color-rgb), 0.25); }
  50%       { box-shadow: 0 0 0 1.5px rgba(var(--call-color-rgb), 0.9), 0 0 24px rgba(var(--call-color-rgb), 0.55); }
}
.call-mode { animation: call-pulse 2s ease-in-out infinite; }
```

The `--call-color-rgb` CSS variable is set inline on the `<li>` element to the RGB components of the status color before the class is applied. A `hexToRgb(hex)` helper is added to `js/utils.js` and exported; it accepts a 6-digit hex string (with leading `#`, e.g. `'#3b82f6'`) and returns an `'r, g, b'` string suitable for use in CSS `rgba()`. Example: `hexToRgb('#3b82f6')` → `'59, 130, 246'`. Callers must only pass valid 6-digit hex; 3-digit shorthand and other formats are not supported (all `statusColor` values in the codebase are 6-digit hex).

---

## Files to change

| File | Change |
| --- | --- |
| `js/following.js` | (1) Swipe gesture handling on `.person-list li`; (2) `updateFolloweeRow` checks `callState` and applies/removes `.call-mode` class; (3) Change-detection guard in `subscribeToFollowee` includes `callState`; (4) `renderList`/`sortFollowees` is Call-mode-aware (callee pinned to top of Mutuals when active); (5) Receiver exit write via `clearCallState` |
| `js/app.js` | In `watchStatus(myUserId, ...)` first-event handler: check `callState`, re-enter Call mode on restart if callee is still a mutual (one-time `get()`) |
| `js/db.js` | `setCallState(callerId, calleeId)`, `clearCallState(callerId)` — update `callState` field on `users/{callerId}` root document; `clearCallState` sets the field to `null` (RTDB removes null fields); no `deleteField` import needed |
| `js/utils.js` | `hexToRgb(hex)` helper |
| `css/app.css` | `@keyframes call-pulse`, `.call-mode` class, and `touch-action: pan-y` on `.person-list li` |
| Firebase Security Rules | Allow authenticated users to write `callState` on another user's root document |
