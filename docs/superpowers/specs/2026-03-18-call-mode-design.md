# Call Mode Design

## Goal

When a user right-swipes a mutual's card, their app enters Call mode: the entire UI adopts the mutual's palette and status color, and the mutual's card pulses at the top of the Mutuals list. On the mutual's side, the caller's card silently begins pulsing. Either user can exit by left-swiping the relevant card.

This spec covers the initial scope: both users available, one initiates.

---

## Section 1: Swipe gesture

Right-swipe past ~40% of a mutual's card width enters Call mode instantly. Left-swipe on the same card exits it.

Gesture handling is added to `.person-list li` elements in `following.js` using `pointerdown` / `pointermove` / `pointerup` events (works for both touch and mouse). A minimum horizontal-to-vertical displacement ratio prevents accidental triggers during vertical scrolling.

Call mode is only enterable on mutual cards (not follower-only cards). If already in Call mode with one mutual, right-swiping a different mutual replaces it — the previous call state is cleared first.

---

## Section 2: Firebase data model

Call state is stored as a single field on the caller's user document:

```js
// users/{callerId}
callState: { calleeId: 'user123', since: <timestamp> }
```

When Call mode ends, `callState` is deleted from the caller's doc (set to `null` via `deleteField()`).

This requires no new Firebase subscriptions. The receiver already watches the caller's full user document through the existing mutual followee subscription. When `updateFolloweeRow` receives `userData` containing `callState.calleeId === myUserId`, it applies the pulsing glow. When the field is absent or points to someone else, the glow is removed.

The receiver exiting Call mode writes `deleteField()` to `callState` on the caller's document — the same pattern used by knocks, where a user writes to another user's document.

---

## Section 3: Caller-side behavior

On right-swipe (entering Call mode):

1. Write `callState: { calleeId, since: Date.now() }` to the caller's Firebase user doc
2. Apply the callee's full theme: `applyThemeVars(calleePalette.theme)` and `applyPaletteVars(callee.statusColor)` — using the callee's `paletteKey` (looked up from `PALETTE_SETS`) and `statusColor` from their Firebase doc
3. Update the caller's own `statusColor` in Firebase to the callee's status color (so all other mutuals see the adopted color on the caller's dot)
4. Move the callee's card to the top of the Mutuals list in the DOM
5. Apply the pulsing glow CSS animation to the callee's card (color: callee's status color)

If the callee has no palette (`paletteKey` is null), only the status color is adopted — no theme change.

---

## Section 4: Receiver-side behavior

The receiver's existing followee subscription fires `updateFolloweeRow` whenever the caller's document changes. When `userData.callState?.calleeId === myUserId`:

1. Apply the pulsing glow CSS animation to the caller's card (color: caller's adopted status color, i.e. the receiver's own status color)
2. Card remains in its natural position in the Mutuals list — no reordering on the receiver's side

No notification, sound, or badge. The glow appears silently on the next data update.

The receiver can:
- **Left-swipe** the glowing card → writes `deleteField()` to `callState` on the caller's doc, removing Call mode for both users
- **Right-swipe** the glowing card → reserved for future Canvas feature; no-op in this implementation
- **Ignore it** → glow persists until the caller exits manually

---

## Section 5: Exit and revert

Call mode ends when either user left-swipes the relevant card. The caller's `callState` field is deleted from Firebase. Both users' subscriptions see the cleared field on their next data update.

**Caller's side on exit:**
- Revert theme: `applyThemeVars` and `applyPaletteVars` using own `getPaletteState()` values
- Restore own `statusColor` in Firebase to own palette's color
- Remove pulsing glow from callee's card
- Return callee's card to its natural sort position in Mutuals

**Receiver's side on exit:**
- `updateFolloweeRow` fires with `callState` absent → remove pulsing glow from caller's card

No confirmation dialog. Left-swipe is immediate.

---

## Section 6: Persistence on app restart

On load, after `ensureIdentity` succeeds, `app.js` reads the caller's own Firebase user document once to check for an existing `callState`. If found and `calleeId` refers to a current mutual:

- Re-enter Call mode silently (apply theme, sort card, pulsing glow)
- Do not re-write `callState` to Firebase (already present)

If `calleeId` is no longer a mutual (unfollowed while app was closed):
- Delete `callState` from Firebase silently
- Do not apply any theme

The receiver side needs no special restart handling — the existing followee subscription picks up `callState` on its first data event.

---

## Files to change

| File | Change |
|---|---|
| `js/following.js` | Swipe gesture handling; `updateFolloweeRow` checks `callState`; pulsing glow CSS class; receiver exit write |
| `js/app.js` | On load: read own doc for `callState`, re-enter Call mode if found |
| `js/db.js` | `setCallState(userId, calleeId)`, `clearCallState(userId)`, `readOwnDoc(userId)` |
| `js/palettes.js` | No changes — `applyThemeVars` and `applyPaletteVars` already exist |
| `css/app.css` | `@keyframes call-pulse` and `.call-mode` CSS class for the pulsing glow |
