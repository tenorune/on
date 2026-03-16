# Knock Feature Design

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan.

**Goal:** Mutual followers can tap each other's card to send a "knock" — a pulsing animation on the recipient's card that signals presence without any words.

**Feature flag:** `KNOCK_ENABLED` in `js/features.js` (default `false`). `features.js` uses `module.exports` (CommonJS); add `KNOCK_ENABLED` to that same object.

**Feature flag guard sites:**

- `app.js`: wrap `initKnocks(myUserId)` in `if (KNOCK_ENABLED)`.
- `following.js`: wrap the knock `click` listener attachment in `if (KNOCK_ENABLED)`.
- `knock.js` imports the flag using the same `import { KNOCK_ENABLED } from './features.js'` pattern used by all other modules.

---

## Interaction Model

### Tap target

- A `click` listener is attached to the `li` element of each mutual row.
- At the top of the handler, apply two guards — skip if either returns true:
  - `labelEl.contains(e.target)` — lets the existing `.person-label click` rename handler fire normally.
  - `unfollowBtnEl.contains(e.target)` — lets the unfollow button click fire normally.
- Using `click` coexists without conflict with the separate `.person-label click` and `.unfollow-btn click` handlers already wired in `createFolloweeRow`.
- The knock `click` listener is only attached to rows in the **Mutuals section** — not following-only or follower-only rows.

### Rename fix

- `.person-label` gets `width: fit-content` in CSS so it only spans its text width, not the full card width.
- The existing `height: 1.4rem` on `.person-label` is **kept**. The rename `<input>` uses `height: 100%` to fill that locked height; removing it would break the input's height resolution. The width change alone is sufficient to scope the tap target.

### Double-tap zoom prevention

- `touch-action: manipulation` on `.person-list li`.

### Sender feedback

- Feedback fires **only after the debounce check passes** — no flash for debounced taps.
- Flash applies the CSS class `knock-sender` to the tapped mutual `li`. `@keyframes knock-sender` is a short bright flash (~200ms); the class is removed when the animation ends (`animationend` event).
- Color is driven by `statusColor`. The caller (`following.js`) reads `lastUserData.get(entry.userId)?.statusColor` at tap time and passes it to `sendKnock`. `sendKnock` applies the fallback `'#22c55e'` internally if the argument is absent or nullish. The color is set as a CSS custom property `--knock-color` on the `li` before adding the class, so `@keyframes knock-sender` can reference `var(--knock-color)`.
- The cap-abort case (count already 5, transaction aborts) produces a false-positive flash. Accepted.

### Client-side debounce

- A module-level `Map<userId, timestamp>` in `knock.js` tracks the last knock time per recipient.
- Minimum 300ms between knocks per recipient. Persists across `renderList()` re-renders because it lives in the module, not the DOM.
- The `click` listener closure captures `userId` as a string (not a DOM reference) for map lookup.

---

## Animations

### Animation 1 — Live knock

- Card background flashes **bright** and fades over **~400ms**.
- Up to 5 play sequentially per delivery, with a **300ms gap** between each.

### Animation 2 — Deferred knock

- Card background flashes **softer** and fades over **~800ms**.
- **One animation per sender** regardless of knock count — communicates who knocked, not how urgently.

### Global animation queue

- All knocks (live and deferred, across all senders) feed into a single sequential timeline.
- Queue entries are `{ userId, animationType, ts }` — never direct DOM references. Live knocks use `Date.now()` as `ts` at enqueue time.
- **Sorting:** the initial deferred batch is sorted by `ts` ascending before playback begins. Live knocks are always appended to the end; no re-sorting after playback starts.
- **Sequence:** a sequence is a contiguous run of queue entries sharing the same `userId`. The 500ms inter-sequence gap is inserted between sequences, starting after the last animation in a sequence completes.
- When an animation slot runs, look up `document.querySelector('[data-user-id="${userId}"]')` at that moment. If not found, skip silently and advance.
- Natural queue length cap: 5 deferred senders × 1 animation each + N live senders × up to 5 each. No explicit cap needed.

---

## Database Schema

```text
users/{recipientId}/knocks/{senderId}: { count: 1–5, ts: epoch_ms }
```

One node per sender→recipient pair. `count` is the number of pending animations (capped at 5). `ts` is the timestamp of the most recent knock from that sender.

**Timestamp:** `ts` uses `Date.now()` (client clock), consistent with all other timestamps in `db.js`. Client-clock tampering accepted as a known limitation for trusted mutuals.

**Security:** Mirrors the `registerAsFollower` pattern. Any authenticated user who knows a target's `userId` can write a knock; mutual enforcement is client-side only. RTDB security rules should allow write to `users/{uid}/knocks/{senderId}` when the sender is authenticated.

**`watchStatus` / `subscribeToFollowee` side-effect:** Knock writes to `users/{recipientId}/knocks/{senderId}` will trigger the `onValue` listener in `subscribeToFollowee` (in `following.js`) for any user who is subscribed to that path — i.e., every follower of the recipient who has the app open. This causes `updateFolloweeRow` to re-run for the recipient's card, which sets `li.style.background` and would interrupt a knock animation. To prevent this, `subscribeToFollowee` must compare the five relevant fields individually (`status`, `availableUntil`, `statusColor`, `paletteKey`, `code`) against their prior cached values before calling `updateFolloweeRow`. Do not use a shallow equality check on the full `userData` object (which now includes a `knocks` key), as that would always differ. If none of the five named fields changed, skip `updateFolloweeRow`.

The `lastStatus`/`lastAvailableUntil` guard in `app.js`'s own `watchStatus` subscription prevents spurious re-renders of the owner's own UI.

---

## Sending a Knock

1. User taps a mutual's `li`. Check `labelEl.contains(e.target)` or `unfollowBtnEl.contains(e.target)` — if either true, skip.
2. Check debounce map: if last knock to this recipient was < 300ms ago, stop (no flash, no write).
3. Update debounce map entry with `Date.now()`.
4. Play sender feedback flash (~200ms).
5. Call `writeKnock(recipientId, senderId)` in `db.js` — a `runTransaction` on `users/{recipientId}/knocks/{senderId}`:
   - null → write `{ count: 1, ts: Date.now() }`.
   - `count < 5` → write `{ count: current.count + 1, ts: Date.now() }`.
   - `count >= 5` → abort. Flash already played; accepted.

`writeKnock` in `db.js` is the DB layer. `sendKnock` in `knock.js` is the behavior wrapper.

---

## Receiving Knocks

### Deferred (on app open)

1. Record `appOpenTime = Date.now()`.
2. `await getKnocks(myUserId)` — a one-time `get()` returning `Promise<DataSnapshot>`. Check `snapshot.exists()`; if false, proceed to step 3 with no entries. Otherwise iterate via `Object.entries(snapshot.val())` to get `[senderId, { count, ts }]` pairs. Capture all returned `senderId` values synchronously in `deferredKeys` Set.
3. Attach the live listener immediately, passing a reference to `deferredKeys`. Because `onChildAdded` fires asynchronously (in a subsequent microtask/macrotask after listener attach), `deferredKeys` is guaranteed to be populated before any callback fires.
4. For each snapshot entry:
   - If `ts < appOpenTime - 24h`: mark for silent deletion.
   - Otherwise: enqueue one animation 2 entry `{ userId: senderId, animationType: 'deferred', ts }`.
5. Delete only the keys in `deferredKeys` via targeted per-key `remove()` calls (not a blanket subtree remove), so knocks arriving after the `get()` are not deleted.
6. After `Promise.all` deletions resolve, clear `deferredKeys`. From this point, the live listener processes all senders normally.
7. Sort the deferred queue by `ts` ascending and begin playing.

**Known limitation:** A live knock from a sender in `deferredKeys` arriving during the deletion window (steps 5–6) is skipped and processed as deferred on the next app open. Accepted.

### Live listener

- `watchKnocksAdded(myUserId, callback)` — attaches `onChildAdded` on `users/{myId}/knocks`. Returns an unsubscribe function. Callback signature: `callback(senderId, { count, ts })`.
- Firebase `onChildAdded` fires for all children existing at attach time and for new children added afterward. To prevent double-processing of deferred entries: if `deferredKeys` is non-empty and contains `senderId`, skip. After `deferredKeys` is cleared, all fires are treated as live.
- On live fire: enqueue `count` × animation 1 entries `{ userId: senderId, animationType: 'live', ts: Date.now() }`. `count` may be > 1. Call `clearKnock(myUserId, senderId)`.
- **Known limitation:** knock data is cleared on receipt, before animations play. Unplayed live animations lost on app-close. Intentional.
- **Known limitation:** if `clearKnock` fails, the knock remains in Firebase and is treated as deferred on the next app open. Accepted. Call `clearKnock(...).catch(() => {})` — silent swallow, consistent with the `remove(...).catch(() => {})` pattern used elsewhere in `db.js`.

### Expiry

- Knocks older than 24 hours are silently deleted on app open without animating.
- Enforced client-side; no Cloud Functions required.

---

## Architecture

### New file: `js/knock.js`

- `initKnocks(myUserId)` — resets module-level state (debounce map, animation queue, `deferredKeys`) on each call, consistent with `initList`'s reset pattern. Then runs deferred processing and attaches the live listener.
- Called in `app.js` **after `initList`** so mutual card DOM nodes exist before animations may play.
- `sendKnock(recipientId, senderId, statusColor?)` — `statusColor` is optional, defaults to `'#22c55e'`. Runs: debounce check → flash → `writeKnock`.
- Module-level debounce `Map`, animation queue array, and `deferredKeys` Set; DOM lookup at play-time.

### Modified files

| File | Change |
| --- | --- |
| `js/features.js` | Add `KNOCK_ENABLED: false` to `module.exports` |
| `js/db.js` | Add `writeKnock`, `getKnocks`, `watchKnocksAdded`, `clearKnock`; add `onChildAdded` to `firebase/database` import |
| `js/following.js` | Attach `click` listener on mutual row `li` with `labelEl` and `unfollowBtnEl` guards; read `lastUserData.get(entry.userId)?.statusColor` at click time and pass to `sendKnock`; import `sendKnock` from `knock.js`; add field-change guard to `subscribeToFollowee` to skip `updateFolloweeRow` when only `knocks` changed |
| `js/app.js` | Call `initKnocks(myUserId)` after `initList` on startup |
| `css/app.css` | `@keyframes knock-live`, `@keyframes knock-deferred`, `@keyframes knock-sender`; `.knock-live`, `.knock-deferred`, `.knock-sender` animation classes using `var(--knock-color)`; `touch-action: manipulation` on `.person-list li`; `width: fit-content` on `.person-label` (keep existing `height: 1.4rem`) |

### DB function signatures (`js/db.js`)

```js
writeKnock(recipientId, senderId)
// runTransaction on users/{recipientId}/knocks/{senderId}

getKnocks(myUserId)
// get() on users/{myUserId}/knocks; returns Promise<DataSnapshot>
// caller: snapshot.exists() guard, Object.entries(snapshot.val())

watchKnocksAdded(myUserId, callback)
// onChildAdded on users/{myUserId}/knocks
// callback(senderId, { count, ts }); returns unsubscribe fn

clearKnock(myUserId, senderId)
// remove(ref(db, `users/${myUserId}/knocks/${senderId}`))
```

### New test file: `tests/knock.test.js`

**Mock setup:** `knock.js` imports from `features.js` (CommonJS). The test file must mock it with the full shape to avoid undefined reads:

```js
jest.mock('../js/features.js', () => ({ KNOCK_ENABLED: true, PALETTES_ENABLED: false }));
```

Also mock `'../js/db.js'` (all four new functions) and `'../js/store.js'` following the pattern in `following.test.js`.

The `subscribeToFollowee` field-change guard (new to `following.js`) must be inserted **after** `lastUserData.set(entry.userId, userData)` and after the `editingSet` check — as the final guard before `updateFolloweeRow` — so the existing code-rotation early-return path is unaffected.

- `sendKnock`: debounce suppresses flash and write within 300ms
- `sendKnock`: debounce map persists across re-renders (module-level, userId string key)
- `sendKnock`: flash fires after debounce passes
- `sendKnock`: `statusColor` defaults to `'#22c55e'` when absent
- `sendKnock`: transaction increments count, caps at 5, aborts at cap
- `sendKnock`: skip when `labelEl.contains(e.target)`
- `sendKnock`: skip when `unfollowBtnEl.contains(e.target)`
- Deferred: null snapshot → no animations, no errors
- Deferred: within-24h entries → one animation 2 per sender
- Deferred: older-than-24h entries → deleted without animating
- Deferred: only snapshot keys deleted
- Deferred: `deferredKeys` skip set prevents double-processing by live listener
- Live: enqueues correct `count` × animation 1 (including count > 1)
- Live: `deferredKeys` cleared → previously-deferred sender fires are processed
- Queue: sequence = contiguous same-userId run; 500ms gap between sequences
- Queue: deferred sorted ascending before playback; live knocks appended to end
- Queue: skips silently when `[data-user-id]` element not found in DOM
- `initKnocks`: resets debounce map, queue, and `deferredKeys` on re-call
