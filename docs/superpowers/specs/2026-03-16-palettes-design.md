# Palettes — Design Spec

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each user choose a status color from a fixed palette; that color is reflected in their own dot and in the dot shown to users who follow them.

**Architecture:** A feature-flagged module (`js/palettes.js`) owns the palette definitions and localStorage persistence. The chosen color is written to Firebase as `statusColor` so followers can read it. CSS custom properties `--my-status` and `--my-glow` replace the hardcoded green throughout the own-status UI. Follower dots and Available text are set inline per-person by `following.js` using each followee's `statusColor` from Firebase.

**Tech Stack:** Vanilla JS ES modules, Firebase RTDB, CSS custom properties, Jest + jsdom.

---

## Feature Flag

A new file `js/features.js` exports boolean flags using `module.exports` to match the existing Jest/Babel setup (same pattern as `store.js`, `identity.js`).

```js
// js/features.js
module.exports = {
  PALETTES_ENABLED: false,
};
```

All palette-specific behaviour is gated on this flag at runtime. When `false`, the app behaves identically to today. Tests mock this module with `jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true }))`.

Consuming modules (`app.js`, `me.js`, `following.js`) import the flag with `import { PALETTES_ENABLED } from './features.js'` — the same syntax used for `store.js` and other CJS modules (Babel handles interop).

---

## Palette Definitions

Eight fixed palettes defined in `js/palettes.js`. Each has a `key`, `color` (hex), and `glow` (rgba string).

| Key    | Color  | Hex       | Glow                        |
|--------|--------|-----------|-----------------------------|
| forest | Green  | `#22c55e` | `rgba(34, 197, 94, 0.4)`    |
| ocean  | Cyan   | `#06b6d4` | `rgba(6, 182, 212, 0.4)`    |
| iris   | Purple | `#a855f7` | `rgba(168, 85, 247, 0.4)`   |
| ember  | Orange | `#f97316` | `rgba(249, 115, 22, 0.4)`   |
| coral  | Rose   | `#f43f5e` | `rgba(244, 63, 94, 0.4)`    |
| sky    | Blue   | `#60a5fa` | `rgba(96, 165, 250, 0.4)`   |
| gold   | Yellow | `#eab308` | `rgba(234, 179, 8, 0.4)`    |
| mint   | Teal   | `#2dd4bf` | `rgba(45, 212, 191, 0.4)`   |

`forest` is the default — identical to the existing green, so users who never touch palettes see no change.

---

## `js/palettes.js` — Public API

```js
// Palette data
export const PALETTES;            // array of { key, color, glow }
export function getPaletteByKey(key); // returns palette object, falls back to forest

// CSS vars
export function applyPaletteVars(key);
// Reads palette by key, sets on document.documentElement:
//   --my-status  →  palette.color
//   --my-glow    →  palette.glow

// Swatch DOM
export function initSwatches(userId);
// Injects one <div class="swatch" data-key="<key>"> per palette into #swatch-row.
// Each swatch has style.background set to palette.color.
// Reads saved key via getPalette() from store.js, adds .selected to the matching swatch.
// Attaches click handler on each swatch: tapSwatch(swatch.dataset.key, userId).
// Does NOT add .visible to #swatch-row — visibility is owned exclusively by setAvailable/setUnavailable.
//
// palettes.js imports: import { getPalette, setPalette } from './store.js'
//                      import { setStatusColor } from './db.js'

// Glow lookup
export function getGlowForColor(hex);
// Returns the glow string for the palette entry matching hex.
// Falls back to rgba(34,197,94,0.4) if hex is not found.

// Tap handler (also exported for tests)
export function tapSwatch(key, userId);  // synchronous — NOT async
// Steps 1–4 run synchronously. setStatusColor is fire-and-forget (no await).
// 1. setPalette(key)                                         — store.js localStorage write
// 2. setStatusColor(userId, palette.color).catch(() => {})  — Firebase write, fire-and-forget
// 3. applyPaletteVars(key)                                  — CSS var update
// 4. In document.getElementById('swatch-row'), remove .selected from all swatches,
//    add .selected to the swatch with data-key === key
```

---

## Data Model

### localStorage (`store.js`)

Add to `module.exports`:

```js
function getPalette() {
  return localStorage.getItem('statusapp_palette') || 'forest';
}
function setPalette(key) {
  localStorage.setItem('statusapp_palette', key);
}
```

### Firebase (`db.js`)

New export:

```js
export async function setStatusColor(userId, color) {
  await update(ref(db, `users/${userId}`), { statusColor: color });
}
```

`statusColor` is an optional string field on the user record. Absent means green (`#22c55e`). Written when a swatch is tapped. Firebase write failures are silently ignored (`.catch(() => {})`).

Followers already read all user fields via `watchStatus` / `onValue`. No change to the subscription — `userData.statusColor` is simply available on the object when present.

---

## UI Changes

### CSS custom properties (`app.css`)

Add to `:root`:

```css
:root {
  --my-status: #22c55e;
  --my-glow:   rgba(34, 197, 94, 0.4);
}
```

The following own-status rules reference `var(--green)` / `var(--green-glow)` and must be updated to `var(--my-status)` / `var(--my-glow)`:

- `.dot.available` — own status dot (background, border-color, box-shadow)
- `.status-label.available` — own "Available" label text color

The `--green` and `--green-glow` variables are kept as-is for `.rename-input` border and `.person-dot.available` / `.status-available` (follower rows, handled via inline styles when palettes enabled — see below). `.rename-input` is UI chrome and intentionally stays on `--green`.

### Swatch row (`index.html`)

Add inside `#header-text`, after `#header-chips`:

```html
<div id="swatch-row" style="display:none"></div>
```

Hidden by default via inline `display:none`. When `PALETTES_ENABLED` is true, `app.js` removes the inline override at startup (`element.style.display = ''`) so the CSS `display:flex` rule takes over. Use `style.display = ''` — not `removeAttribute('style')` — to preserve any other inline styles that may exist on the element.

### Swatch row CSS (`app.css`)

```css
#swatch-row {
  display: flex;
  gap: 6px;
  margin-top: 0.5rem;
  align-items: center;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s ease;
}
#swatch-row.visible {
  opacity: 1;
  pointer-events: auto;
}
.swatch {
  width: 22px; height: 22px; border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.12);
  cursor: pointer; flex-shrink: 0;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.swatch.selected {
  border-color: rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.2);
}
```

Once the feature is enabled, `#swatch-row` uses opacity-only toggling via the `.visible` CSS class — **not** direct inline style (unlike `#header-chips`, which uses `chips.style.opacity` in `me.js`). The class approach is preferred here because the CSS rule for `.visible` handles both `opacity` and `pointer-events` atomically, preventing swatches from being accidentally tappable when hidden.

`display: flex` is permanent once `app.js` clears the inline style, so `#swatch-row` always occupies layout space (22px + 0.5rem margin) — it is invisible (`opacity: 0`) but present in flow. Because both rows use opacity-only toggling and are always present in the layout simultaneously, the header height is stable across Available and Unavailable states. No fixed-height wrapper is needed.

The feature-disabled case is handled by the `display:none` inline style in HTML (which `app.js` removes only when `PALETTES_ENABLED` is true), so the swatch row never occupies space when the feature is off.

### `.status-available` CSS rule

Keep `color: var(--green)` in this rule — it serves as the feature-disabled fallback. When `PALETTES_ENABLED` is true, `following.js` adds `style="color:${color}"` inline on the span, which overrides the class rule via CSS specificity.

### `.person-dot.available` CSS class

Keep the rule as the feature-disabled fallback (green dot via CSS). When `PALETTES_ENABLED` is true, `updateFolloweeRow` additionally sets `dot.style.background`, `dot.style.borderColor`, and `dot.style.boxShadow` inline — inline styles take precedence over the class, so the person's custom color wins.

---

## Behaviour

### Swatch tap

1. `setPalette(key)` — localStorage
2. `setStatusColor(userId, palette.color)` — Firebase, `.catch(() => {})`
3. `applyPaletteVars(key)` — CSS vars on `:root`
4. Refresh `.selected` class on swatches in `#swatch-row`

If the user is currently Available, the dot updates immediately because it reads `var(--my-status)`.

### App startup (`app.js`)

```js
if (isNew) enterFirstUseMode();  // must come before watchStatus subscription

if (PALETTES_ENABLED) {
  document.getElementById('swatch-row').style.display = '';  // unhide from inline style
  applyPaletteVars(getPalette());   // apply before render — no green flash
  initSwatches(userId);
}

watchStatus(userId, (userData) => { /* ... applyOwnStatus ... */ });

if (isNew) {
  const availableUntil = Date.now() + 120 * 60000;
  setStatus(userId, 'available', availableUntil).catch(() => {});
}
```

`enterFirstUseMode()` must be called before `watchStatus` subscribes. The first Firebase callback (Unavailable) will arrive while `firstUseActive` is true, routing to `setKnockKnock()` instead of `setUnavailable()`. The second callback (Available, from the `setStatus` write) clears the flag and transitions normally to `setAvailable`.

`applyPaletteVars` is called before `watchStatus` resolves so the correct color is in place from the first paint.

`#swatch-row` starts with no `.visible` class (hidden via `opacity: 0`). Visibility is set when `watchStatus` fires its first callback and calls `applyOwnStatus`. For new users, the first-use holding state never adds `.visible` to the swatch row — it remains hidden until `setAvailable` fires.

Once `app.js` clears the inline `display:none`, the swatch row permanently occupies layout space even when Available and `opacity: 0`. This is intentional — do not add `display:none` toggling in `setAvailable`. The row is invisible to users but present in the DOM height, matching the chip row model.

### First Time Use State (`me.js`)

`me.js` owns a module-level boolean `firstUseActive = false`. `app.js` sets it via a new export before subscribing:

```js
export function enterFirstUseMode() {
  firstUseActive = true;
}
```

`applyOwnStatus` is updated to route through `setKnockKnock` while the flag is set:

```js
export function applyOwnStatus(status, availableUntil) {
  if (firstUseActive) {
    if (status === 'available' && !isExpired(availableUntil)) {
      firstUseActive = false;
      setAvailable(availableUntil);
    } else {
      setKnockKnock();
    }
    return;
  }
  if (status === 'available' && !isExpired(availableUntil)) {
    setAvailable(availableUntil);
  } else {
    setUnavailable();
  }
}
```

`setKnockKnock()` renders the holding state — green dot, blank label, chips hidden:

```js
function setKnockKnock() {
  const dot   = document.getElementById('my-dot');
  const label = document.getElementById('my-status-label');
  const chips = document.getElementById('header-chips');

  dot.classList.add('available');      // green dot — first-use color is always forest green
  chips.style.opacity = '0';
  chips.style.pointerEvents = 'none';
  label.classList.remove('available');
  label.textContent = '';
  label.style.opacity = '1';
}
```

The green dot is correct because a first-time user has never changed their palette — `forest` (green) is the default. `setAvailable` requires no changes; it adds `.available` to the dot (already present, no-op) and then proceeds with the normal fade-in sequence.

No swatch row changes occur in `setKnockKnock` — the `.visible` class is never added, so the swatch row stays hidden.

### `setUnavailable` / `setAvailable` (`me.js`)

Both toggles belong inside the existing 200ms `setTimeout` to match the chip row animation timing. Note they toggle in opposite directions — chip row shows on Available, swatch row shows on Unavailable:

- `setUnavailable` (inside `setTimeout`): if `PALETTES_ENABLED`, add `.visible` to `#swatch-row`
- `setAvailable` (inside `setTimeout`): if `PALETTES_ENABLED`, remove `.visible` from `#swatch-row` — place this **before** the `requestAnimationFrame` call so it fires in the same paint cycle as the chip/label fade-in

The chip row show/hide logic is unchanged.

### Follower display (`following.js`)

In `updateFolloweeRow(entry, userData, myUserId)`:

```js
const color = userData.statusColor || '#22c55e';
const glow  = getGlowForColor(color);
```

`following.js` imports `getGlowForColor` from `palettes.js`. `getGlowForColor(hex)` looks up the matching palette entry and returns its glow, falling back to `rgba(34,197,94,0.4)`. `db.js` writes only `statusColor` (hex); glow is always derived client-side.

#### Dot

`dot.className` must be assigned **unconditionally** (covering both available and unavailable states) **before** the inline style assignments below — the existing code already does `dot.className = 'person-dot available'` or `'person-dot'` depending on `isAvail`. The existing code also null-guards `dot` with `if (dot)` — wrap the `PALETTES_ENABLED` block inside that same guard. This ensures the CSS class is in place as the feature-disabled fallback and the inline styles override it when `PALETTES_ENABLED` is true.

```js
if (PALETTES_ENABLED) {
  if (isAvail) {
    dot.style.background  = color;
    dot.style.borderColor = color;
    dot.style.boxShadow   = `0 0 10px ${glow}`;
  } else {
    dot.style.background  = '';
    dot.style.borderColor = '';
    dot.style.boxShadow   = '';
  }
}
```

#### Available text

```js
if (PALETTES_ENABLED) {
  statusText = `<span class="status-available" style="color:${color}">Available for ${...}</span>`;
} else {
  statusText = `<span class="status-available">Available for ${...}</span>`;
}
```

`following.js` always imports `getGlowForColor` from `palettes.js` (static ES imports cannot be conditional). When `PALETTES_ENABLED` is false, the `.status-available` CSS class provides green via `var(--green)` — unchanged from today. The guard is required (not just cosmetic) because `userData.statusColor` may be present from a prior enabled session.

`.status-available` CSS rule is **not changed** — `color: var(--green)` stays. When `PALETTES_ENABLED` is true the inline `style="color:${color}"` on the span overrides the class rule via specificity.

### Feature disabled path summary

When `PALETTES_ENABLED = false`:

- `#swatch-row` has `display:none` (inline style from HTML) and is never unhidden
- `--my-status` and `--my-glow` are never set; own dot uses `var(--green)` via CSS (see note below)
- Follower dots use `.person-dot.available` CSS class (green)
- Available text uses `.status-available` CSS class (green via `var(--green)`)
- No Firebase `statusColor` writes

**Note on own-dot CSS:** After the migration, `.dot.available` and `.status-label.available` reference `var(--my-status)` and `var(--my-glow)`. When `PALETTES_ENABLED` is false and `applyPaletteVars` is never called, these resolve to the `:root` defaults (`#22c55e` / `rgba(34,197,94,0.4)`) — visually identical to the old `var(--green)`. No conditional needed.

---

## `js/palettes.js` — Full Export List

```js
export const PALETTES;             // array of { key, color, glow }
export function getPaletteByKey(key);
export function applyPaletteVars(key);
export function getGlowForColor(hex);
export function initSwatches(userId);
export function tapSwatch(key, userId);  // exported for tests
```

---

## Files Changed

| File | Change |
| ---- | ------ |
| `js/features.js` | **New.** `module.exports = { PALETTES_ENABLED: false }` |
| `js/palettes.js` | **New.** Palette definitions and full export list above |
| `js/store.js` | Add `getPalette`, `setPalette` to `module.exports` |
| `js/db.js` | Add `export async function setStatusColor(userId, color)` |
| `js/app.js` | Import `PALETTES_ENABLED` from `features.js`, `applyPaletteVars`/`initSwatches` from `palettes.js`, `getPalette` from `store.js`; unhide swatch row, apply palette vars and init swatches on startup if enabled |
| `js/me.js` | Import flag; add `enterFirstUseMode`, `setKnockKnock`; update `applyOwnStatus` for first-use routing; add swatch-row show/hide logic inside `setAvailable`/`setUnavailable` |
| `js/following.js` | Import `getGlowForColor` from palettes.js; inline-style dots and available text when enabled |
| `index.html` | Add `<div id="swatch-row">` inside `#header-text` |
| `css/app.css` | Add `--my-status`/`--my-glow` root vars; swatch + selected styles; update `.dot.available` and `.status-label.available` from `var(--green)` to `var(--my-status)`/`var(--my-glow)` |

---

## Testing

- `tests/palettes.test.js` — `getPaletteByKey`, `applyPaletteVars` (checks CSS vars on documentElement), `getGlowForColor`, `initSwatches` (checks DOM injection + selected class), `tapSwatch` (checks store, db, CSS vars, swatch ring)
- `tests/me.test.js` — add `<div id="swatch-row"></div>` to `makeFixture()`; add: swatch row gets `.visible` after `applyOwnStatus('unavailable', …)`; swatch row loses `.visible` after `applyOwnStatus('available', …)`; both gated on `PALETTES_ENABLED: true` mock; add first-use tests: after `enterFirstUseMode()`, `applyOwnStatus('unavailable', …)` renders dot with `.available` class, blank label text, and no `.visible` on swatch row; subsequent `applyOwnStatus('available', …)` clears `firstUseActive` and transitions to Available
- `tests/following.test.js` — `palettes.js` imports from `db.js` but `db.js` is already mocked in this test file, so no additional mock is needed; add: follower dot uses inline `statusColor` when present; falls back to green class when absent; Available text has inline color matching `statusColor`
- `tests/db.test.js` — add: `setStatusColor` writes `statusColor` field to Firebase path

---

## Out of Scope

- Full UI theme switching (CSS variable swapping beyond dot color) — deferred
- Custom colour picker — fixed palettes only
- Swatches visible in Available state — Unavailable state only
