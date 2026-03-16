# Palette Sets Design

> **Status:** Approved — ready for implementation planning.

## Goal

Extend the Palettes feature with two named palette sets (Natural and Electric), a toggle between them, two-tap palette mode that shifts the app's UI theme, and Palette Cards that render each person's list row using their chosen palette's colors.

## Background

Palette Set 1 (Natural) already exists in `js/palettes.js` as eight palettes (Forest through Mint). It is currently feature-flagged off (`PALETTES_ENABLED: false`). This design adds Set 2 (Electric), a toggle, and two new UX behaviors: palette mode and palette cards. The feature flag is enabled as part of Increment 1.

Reference prototypes (all in `docs/prototypes/`):
- `palette-cards.html` — Set 1 palette cards
- `palette-cards-v2.html` — Set 2 high-contrast palettes
- `palette-cards-combined.html` — combined prototype with toggle, two-tap, key swatch, palette cards

---

## Increments

The feature ships in three independent increments, each deployable on its own.

### Increment 1: Two Palette Sets + Toggle
### Increment 2: Two-Tap Palette Mode + Key Swatch + UI Theme Shift
### Increment 3: Palette Cards

---

## Data Model

### localStorage

Replaces the existing single-key `statusapp_palette` string with a structured state object.

**Key:** `statusapp_palette_state`

```json
{
  "activeSet": 1,
  "sets": {
    "1": { "selectedKey": "forest", "activePaletteKey": null },
    "2": { "selectedKey": "volt",   "activePaletteKey": null }
  }
}
```

- `activeSet`: which set's swatches are displayed (1 = Natural, 2 = Electric)
- `selectedKey`: the highlighted swatch in that set; determines status dot color
- `activePaletteKey`: the palette whose theme the app UI is currently showing; `null` means default dark slate theme. Set when entering palette mode (Increment 2), cleared on exit.

**Migration:** On first read, if `statusapp_palette_state` is absent but `statusapp_palette` exists, read the old key as Set 1's `selectedKey`, write the new format, and delete the old key. Handled in `store.js`.

### Firebase user record

Existing fields unchanged through Increment 1. Increment 2 adds one optional field:

| Field | Type | Written by | Read by |
|---|---|---|---|
| `statusColor` | hex string | `tapSwatch`, `switchSet` | followers (dot color) |
| `paletteKey` | string \| null | `enterPaletteMode`, `exitPaletteMode` | followers (card theme, Increment 3) |

`paletteKey` is `null` (or absent) when the user is not in palette mode. Followers who read an absent `paletteKey` render the card with default dark slate styling.

### Palette data structure

`js/palettes.js` changes `PALETTES` (flat array) to `PALETTE_SETS` (object keyed by set number). All palette data fields are present from Increment 1, even though `theme` and `complements` are not consumed until Increments 2 and 3.

```js
export const PALETTE_SETS = {
  1: [
    {
      key: 'forest', label: 'Forest',
      color: '#22c55e', glow: 'rgba(34, 197, 94, 0.4)',
      theme: { bg, surface, surface2, text, textMuted },
      complements: [ /* 7 hex strings */ ],
    },
    // … ocean, iris, ember, coral, sky, gold, mint
  ],
  2: [
    {
      key: 'volt', label: 'Volt',
      color: '#aaff00', glow: 'rgba(170, 255, 0, 0.4)',
      theme: { bg, surface, surface2, text, textMuted },
      complements: [ /* 7 hex strings, color-wheel derived */ ],
    },
    // … plasma, arc, venom, inferno, aurora, solar, ultraviolet
  ],
};
```

Set 1 colors are identical to the existing production `PALETTES` array. Set 2 colors match the `palette-cards-v2.html` prototype exactly.

Set 2 complement swatches follow color-wheel math from the primary hue H:
`[H+180°, H+120°, H+240°, H+150°, H+210°, H+30°, H−30°]`

---

## Increment 1: Two Palette Sets + Toggle

### Changes

**`js/features.js`**
- `PALETTES_ENABLED: true`

**`js/store.js`**
- Add `getPaletteState()`: reads `statusapp_palette_state`; handles migration from old key
- Add `setPaletteState(state)`: writes `statusapp_palette_state`
- Update `getPalette()`: returns `sets[activeSet].selectedKey` from new state (backward-compatible for `app.js`)
- Keep all other exports unchanged

**`js/palettes.js`**
- Replace `PALETTES` with `PALETTE_SETS` (full data with theme + complements)
- Add SVG icon constants `ICON_BOLT` and `ICON_TREE` (inlined strings):
  - Bolt: Heroicons bolt-solid, viewBox 0 0 20 20 (MIT license)
  - Tree: Bootstrap Icons tree, viewBox 0 0 16 16 (MIT license)
- Update `getPaletteByKey(key)`: searches both sets
- Update `getGlowForColor(hex)`: searches both sets
- `applyPaletteVars(key)`: unchanged
- Update `tapSwatch(key, userId)`: updates `selectedKey` for the active set in store (instead of `setPalette`)
- Update `initSwatches(userId)`: prepends toggle button, renders active set's 8 swatches
- Add `switchSet(toSet, userId)`:
  1. Saves current live state back to store
  2. Sets `activeSet = toSet` in store
  3. Applies CSS vars for new set's `selectedKey`
  4. Writes new `statusColor` to Firebase
  5. Clears and re-renders the swatch row

**`css/app.css`**
```css
.set-toggle-btn {
  width: 22px; height: 22px; background: none; border: none;
  cursor: pointer; color: var(--text-muted); padding: 0;
  flex-shrink: 0; display: flex; align-items: center; justify-content: center;
  border-radius: 5px; transition: color 0.15s, background 0.15s;
}
.set-toggle-btn:hover { color: var(--text); background: rgba(255,255,255,0.07); }
```

**`js/app.js`**
- `applyPaletteVars(getPalette())` call unchanged — `getPalette()` now reads from new state format

### Swatch row DOM

```
[toggle btn: ⚡ or 🌳]  [swatch×8]
```

Toggle icon represents the *other* set: bolt when in Natural (tap → go Electric), tree when in Electric (tap → go Natural).

### Tests

- Toggle button appears as first child of swatch row
- Clicking toggle button calls `switchSet` with correct target set
- `switchSet` re-renders the correct set's swatches
- `switchSet` applies the new set's selected palette's CSS vars
- `switchSet` writes `statusColor` to Firebase
- `getPaletteState` migrates from old `statusapp_palette` format correctly
- All existing palette tests updated for `PALETTE_SETS` structure

---

## Increment 2: Two-Tap Palette Mode + Key Swatch + UI Theme Shift

### Behavior

- **First tap on an unselected swatch**: status color change only (Increment 1 behavior)
- **Second tap on the already-selected swatch**: enters palette mode
- **In palette mode**: swatch row shows Key Swatch at original index + 7 complement swatches
- **Tap Key Swatch**: exits palette mode, reverts UI theme, keeps status color

### Changes

**`js/db.js`**
```js
export async function setPaletteKey(userId, paletteKey) {
  await update(ref(db, `users/${userId}`), { paletteKey: paletteKey ?? null });
}
```

**`js/palettes.js`**
- `tapSwatch(key, userId)`: if `key === currentlySelectedKey && !paletteMode` → call `enterPaletteMode`; otherwise existing behavior
- Add `enterPaletteMode(key, userId)`:
  1. Sets `activePaletteKey = key` in store
  2. Calls `applyThemeVars(palette.theme)`
  3. Writes `paletteKey` to Firebase via `setPaletteKey`
  4. Re-renders swatch row in palette mode
- Add `exitPaletteMode(userId)`:
  1. Clears `activePaletteKey` in store
  2. Calls `resetThemeVars()`
  3. Writes `paletteKey: null` to Firebase
  4. Status color and `selectedKey` unchanged
  5. Re-renders swatch row in base mode
- Add `applyThemeVars(theme)`: sets `--bg`, `--surface`, `--surface2`, `--text`, `--text-muted`
- Add `resetThemeVars()`: restores the five vars to the hardcoded default slate values

**Palette mode swatch row layout**

The 8 positions correspond to the 8 palettes in the active set. The Key Swatch occupies the index of `activePaletteKey`. The 7 remaining positions fill with `palette.complements` in order.

```
Position 0: complement[0]
Position 1: complement[1]
Position K: KEY SWATCH (spinning dashed ring)
Position K+1: complement[2]
...
```

**CSS additions**
```css
.swatch.key-swatch {
  border-color: white;
  box-shadow: 0 0 0 2px rgba(255,255,255,0.25);
}
.swatch.key-swatch::after {
  content: ''; position: absolute; inset: -6px; border-radius: 50%;
  border: 1.5px dashed rgba(255,255,255,0.65);
  animation: key-spin 4s linear infinite; pointer-events: none;
}
@keyframes key-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
```

**`js/app.js`**
- On startup, if `activePaletteKey` is set in stored state, call `applyThemeVars` before first paint to avoid theme flash

### Tests

- Second tap on selected swatch enters palette mode
- Palette mode renders Key Swatch at correct index
- Palette mode renders 7 complement swatches
- Tap Key Swatch exits palette mode
- `exitPaletteMode` reverts CSS theme vars but preserves status color
- `setPaletteKey` writes to Firebase on enter and clears on exit
- `app.js` startup restores palette mode theme if stored

---

## Increment 3: Palette Cards

### Behavior

Each person's list row background, name color, and status text color reflect their active `paletteKey`. If `paletteKey` is absent or `PALETTES_ENABLED` is false, the card renders exactly as today.

### Changes

**`js/following.js`** — `updateFolloweeRow(entry, userData, myUserId)`:

```
if PALETTES_ENABLED and userData.paletteKey:
  palette = getPaletteByKey(userData.paletteKey)   // searches both sets
  li.style.background      = palette.theme.surface
  li.style.borderLeftColor = isAvailable ? palette.color : 'transparent'
  nameEl.style.color       = palette.theme.text
  statusEl.style.color     = palette.theme.textMuted
  availableSpan.style.color = palette.color
else:
  // existing CSS class behavior, no inline styles
```

No new Firebase reads. `userData.paletteKey` arrives through the existing `watchStatus` subscriptions.

### Tests

- Card with `paletteKey` renders palette theme surface as background
- Card without `paletteKey` renders with default CSS classes (no regression)
- `getPaletteByKey` correctly resolves keys from both Set 1 and Set 2

---

## File Change Matrix

| File | Inc 1 | Inc 2 | Inc 3 |
|---|---|---|---|
| `js/features.js` | ✓ enable flag | — | — |
| `js/store.js` | ✓ new state format | — | — |
| `js/palettes.js` | ✓ PALETTE_SETS, toggle, switchSet | ✓ two-tap, mode fns, theme vars | — |
| `js/db.js` | — | ✓ setPaletteKey | — |
| `js/app.js` | — | ✓ restore theme on startup | — |
| `js/following.js` | — | — | ✓ card styling |
| `css/app.css` | ✓ toggle btn styles | ✓ key-swatch styles | — |
| `tests/palettes.test.js` | ✓ update + new tests | ✓ new tests | — |
| `tests/following.test.js` | — | — | ✓ new tests |
