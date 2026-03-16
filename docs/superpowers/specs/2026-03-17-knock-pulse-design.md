# Knock Pulse & Color Fix Design

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan.

**Goal:** Replace the queue-based live knock animation with a frequency-sensitive brightness pulse, and fix the knock color to always reflect the sender's actual status color.

---

## Changes in scope

Two coordinated changes:

1. **Live knock pulse model** — live knocks no longer play sequential flash animations. Instead each knock drives a per-sender brightness pulse that rises instantly and decays over 2 seconds. Rapid follow-up knocks interrupt the decay, snap brighter, and restart the 2s fade — communicating frequency rather than count.

2. **Color fix** — both live and deferred knock animations read the sender's status color from their `person-dot` element at the moment the animation runs, instead of hardcoding `'#22c55e'`.

Deferred knock animations (played on app open) are unchanged in their sequencing and timing, but do receive the color fix (`playNext()` reads the sender's status color instead of hardcoding green).

---

## Live knock pulse model

### Module-level state

Add to `knock.js`:

```js
const INTENSITY_STEP = 0.4;
let pulseMap = new Map(); // senderId → { intensity: number, timerId: number | null }
```

Reset `pulseMap` in `initKnocks` alongside the other module-level state resets.

### `applyLiveKnock(senderId, count)`

Called from the `watchKnocksAdded` callback in place of the previous `count × enqueue` loop.

```
1. li = document.querySelector(`[data-user-id="${senderId}"]`)
   If not found, return silently.

2. color = getSenderColor(li)

3. current = pulseMap.get(senderId) ?? { intensity: 0, timerId: null }
   If current.timerId is set, clearTimeout(current.timerId).

4. newIntensity = Math.min(1, current.intensity + count * INTENSITY_STEP)

5. Instant rise (no transition):
   li.style.transition = 'none'
   li.style.backgroundColor = hexToRgba(color, newIntensity)
   li.offsetHeight  // force reflow — separates instant-set from transition-start

6. Begin 2s decay:
   li.style.transition = 'background-color 2s ease-out'
   li.style.backgroundColor = hexToRgba(color, 0)
   // Use rgba(r,g,b,0) — not 'transparent' — to preserve hue during the CSS transition.
   // Transitioning to 'transparent' (rgba(0,0,0,0)) would shift intermediate frames toward black.

7. timerId = setTimeout(() => {
     li.style.transition = ''
     li.style.backgroundColor = ''
     pulseMap.delete(senderId)
   }, 2100)  // 100ms buffer after 2s transition

8. pulseMap.set(senderId, { intensity: newIntensity, timerId })
```

**Intensity semantics:** `intensity` in `pulseMap` records the value set at the most recent knock — not the current decaying visual. On a follow-up knock, the stored value is used as the base for the next bump. This means three rapid knocks → max brightness (1.0), regardless of how far the previous fade had progressed.

**Reflow note:** `li.offsetHeight` is a standard forced-reflow pattern. In jsdom it returns 0 (no layout engine) but does not throw; tests are unaffected.

### `watchKnocksAdded` callback — before vs after

**Before:**
```js
for (let i = 0; i < count; i++) {
  enqueue({ userId: senderId, animationType: 'live', ts: Date.now() });
}
```

**After:**
```js
applyLiveKnock(senderId, count);
// clearKnock call is retained — only the enqueue loop changes
```

---

## Color fix

### `getSenderColor(li)`

```js
function getSenderColor(li) {
  const dot = li.querySelector('.person-dot');
  return (dot && dot.style.background) || '#22c55e';
}
```

`updateFolloweeRow` sets `dot.style.background` to `userData.statusColor` when available, and clears it when unavailable. An empty string is falsy — the fallback `'#22c55e'` applies when the sender is offline or their color is unknown.

### `hexToRgba(hex, alpha)`

```js
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
```

All `statusColor` values in this app are 6-digit hex strings. No other format handling needed.

### Fix in `playNext()` (deferred knocks)

Replace:
```js
li.style.setProperty('--knock-color', '#22c55e');
```

With:
```js
li.style.setProperty('--knock-color', getSenderColor(li));
```

---

## CSS changes

Remove `@keyframes knock-live` and `.knock-live` — live knocks no longer use a CSS animation class. The pulse runs entirely via inline `background-color` + `transition`.

Keep unchanged: `@keyframes knock-deferred`, `.knock-deferred`, `@keyframes knock-sender`, `.knock-sender`.

---

## Files modified

| File | Change |
|---|---|
| `js/knock.js` | Add `pulseMap`, `INTENSITY_STEP`, `applyLiveKnock()`, `getSenderColor()`, `hexToRgba()`; update `watchKnocksAdded` callback; fix `playNext()` color; reset `pulseMap` in `initKnocks` |
| `css/app.css` | Remove `@keyframes knock-live` and `.knock-live` |
| `tests/knock.test.js` | Replace queue-based live knock tests with pulse model tests |

---

## Tests (`tests/knock.test.js`)

Replace existing live-knock queue tests with:

- `applyLiveKnock`: color read from `person-dot.style.background`
- `applyLiveKnock`: falls back to `'#22c55e'` when dot has no inline background
- `applyLiveKnock`: bumps intensity by `count × INTENSITY_STEP`, capped at 1.0
- `applyLiveKnock`: cancels previous cleanup timer on re-knock
- `applyLiveKnock`: cleans up inline styles and removes from `pulseMap` after 2.1s
- `applyLiveKnock`: skips silently when sender `li` not in DOM
- `playNext()` (deferred): uses `getSenderColor(li)` instead of hardcoded green
