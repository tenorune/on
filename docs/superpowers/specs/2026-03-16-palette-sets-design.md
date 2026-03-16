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

The feature ships in three increments. Increments 1 and 2 are each independently deployable. Increment 3 is deployable independently but produces no visible card-styling behavior until Increment 2 is also live (because `paletteKey` is only written to Firebase in Increment 2; until then `userData.paletteKey` is always absent and the card-styling branch never executes).

### Increment 1: Two Palette Sets + Toggle

### Increment 2: Two-Tap Palette Mode + Key Swatch + UI Theme Shift

### Increment 3: Palette Cards (requires Increment 2 for observable behavior)

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
- `activePaletteKey`: stored per-set. The palette whose theme the app UI is currently showing for that set; `null` means default dark slate. Set when entering palette mode (Increment 2), cleared on exit.

**Per-set `activePaletteKey` behavior on `switchSet`:** When switching to a set whose `activePaletteKey` is non-null, the UI immediately enters palette mode for that palette (theme vars applied, swatch row rendered in palette mode). When switching to a set whose `activePaletteKey` is null, the UI reverts to default slate theme and swatch row renders in base mode. This means each set independently remembers whether it was in palette mode.

**Migration:** On first read, if `statusapp_palette_state` is absent, write the default state first, then check if `statusapp_palette` exists. If it does, copy its value as Set 1's `selectedKey`, update the written state, and delete the old key. The old key is deleted only after the new format is successfully written, so the migration is safe if interrupted.

### Firebase user record

Existing fields unchanged through Increment 1. Increment 2 adds one optional field:

| Field | Type | Written by | Read by |
|---|---|---|---|
| `statusColor` | hex string | `tapSwatch`, `switchSet` | followers (dot color) |
| `paletteKey` | string \| null | `enterPaletteMode`, `exitPaletteMode` | followers (card theme, Increment 3) |

`paletteKey` is written as `null` (not deleted) when the user exits palette mode. Followers treat both absent and `null` values as "no palette active — use default card styling." Over time, users who enter then exit palette mode will have a `null` field rather than an absent one; this is harmless.

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

- Add `getPaletteState()`: writes default state first, then migrates from old key if present (see migration above)
- Add `setPaletteState(state)`: writes `statusapp_palette_state`
- Update `getPalette()`: returns `sets[activeSet].selectedKey` from new state (backward-compatible for `app.js`)
- Keep all other exports unchanged

**`js/palettes.js`**
- Replace `PALETTES` with `PALETTE_SETS` (full data with theme + complements)
- Add SVG icon constants `ICON_BOLT` and `ICON_TREE` (inlined strings):
  - Bolt: Heroicons bolt-solid, viewBox 0 0 20 20 (MIT license)
  - Tree: Bootstrap Icons tree, viewBox 0 0 16 16 (MIT license)
- Update `getPaletteByKey(key)`: searches both sets; returns `PALETTE_SETS[1][0]` (forest) if not found
- Update `getGlowForColor(hex)`: searches both sets; returns forest glow if not found
- `applyPaletteVars(key)`: unchanged — sets `--my-status` and `--my-glow` only. Does not touch `--bg`, `--surface`, `--surface2`, `--text`, or `--text-muted`. Those five vars are managed exclusively by `applyThemeVars` / `resetThemeVars` in Increment 2.
- Update `tapSwatch(key, userId)`: updates `selectedKey` for the active set in store (instead of `setPalette`)
- Update `initSwatches(userId)`: prepends toggle button, renders active set's 8 swatches
- Add `switchSet(toSet, userId)`:
  1. Saves current live state back to store
  2. Sets `activeSet = toSet` in store
  3. Gets `selectedKey` from the target set's stored state; applies `applyPaletteVars(selectedKey)` — this writes the `color` field of that palette as `statusColor` CSS var
  4. Writes that palette's `color` field to Firebase as `statusColor`
  5. Clears and re-renders the swatch row (Increment 2: if target set has `activePaletteKey`, also calls `applyThemeVars`; otherwise calls `resetThemeVars`)

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
- Clicking toggle button calls `switchSet` with correct target set (1→2 and 2→1)
- `switchSet` re-renders the correct set's 8 swatches
- `switchSet` applies CSS vars for the new set's `selectedKey` palette's `color` field
- `switchSet` writes that palette's `color` field to Firebase as `statusColor`
- `getPaletteState` migrates from old `statusapp_palette` format: old value becomes Set 1 `selectedKey`, old key deleted
- `getPaletteState` returns default state when no stored state exists at all
- All existing palette tests updated for `PALETTE_SETS` structure

---

## Increment 2: Two-Tap Palette Mode + Key Swatch + UI Theme Shift

### Behavior

- **First tap on an unselected swatch**: status color change only (Increment 1 behavior)
- **Second tap on the already-selected swatch**: enters palette mode
- **In palette mode**: UI theme shifts to the palette's colors; swatch row shows Key Swatch at original index + 7 complement swatches
- **Tap Key Swatch**: exits palette mode, reverts UI theme, keeps status color

### CSS variable responsibilities (clarified)

| Function | Variables written |
| --- | --- |
| `applyPaletteVars(key)` | `--my-status`, `--my-glow` |
| `applyThemeVars(theme)` | `--bg`, `--surface`, `--surface2`, `--text`, `--text-muted` |
| `resetThemeVars()` | `--bg`, `--surface`, `--surface2`, `--text`, `--text-muted` (to defaults) |

The two groups never overlap. `applyPaletteVars` and `applyThemeVars` can both be called without conflict.

**`resetThemeVars()` default values** (matching the existing `:root` in `css/app.css`):

```
--bg:         #0f172a
--surface:    #1e293b
--surface2:   #334155
--text:       #f1f5f9
--text-muted: #94a3b8
```

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
  1. Sets `activePaletteKey = key` in store (under the active set)
  2. Calls `applyThemeVars(palette.theme)`
  3. Writes `paletteKey` to Firebase via `setPaletteKey`
  4. Re-renders swatch row in palette mode
- Add `exitPaletteMode(userId)`:
  1. Clears `activePaletteKey` (sets to `null`) in store (under the active set)
  2. Calls `resetThemeVars()`
  3. Writes `paletteKey: null` to Firebase
  4. Status color and `selectedKey` unchanged
  5. Re-renders swatch row in base mode
- Add `applyThemeVars(theme)`: sets the five theme CSS vars listed above
- Add `resetThemeVars()`: restores the five vars to the hardcoded default slate values listed above

**Palette mode swatch row layout**

The active set has 8 palettes at indices 0–7. Let K = index of `activePaletteKey` in the active set's palette array. Positions 0…K-1 fill with `complements[0]…complements[K-1]`. Position K is the Key Swatch. Positions K+1…7 fill with `complements[K]…complements[6]`.

Example for K=3 (Ember in Set 1):

```
Position 0: complements[0]
Position 1: complements[1]
Position 2: complements[2]
Position 3: KEY SWATCH (Ember)
Position 4: complements[3]
Position 5: complements[4]
Position 6: complements[5]
Position 7: complements[6]
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

- On startup, if `activePaletteKey` is set in stored state for the active set, call `applyThemeVars` before first paint to avoid theme flash, and re-render the swatch row in palette mode after `initSwatches` runs.

### Tests

- Second tap on selected swatch enters palette mode
- First tap on a different swatch while in palette mode exits palette mode and changes color (note: tapping a different swatch while in palette mode is handled as a normal first-tap — exits palette mode implicitly via `exitPaletteMode` then sets new color. Spec this behavior: tapping any non-Key swatch in palette mode calls `exitPaletteMode` then `tapSwatch` normally.)
- Palette mode renders Key Swatch at correct index for K=0, K=3, K=7 (edge cases)
- Palette mode renders 7 complement swatches filling positions around K correctly
- Tap Key Swatch calls `exitPaletteMode`
- `exitPaletteMode` reverts CSS theme vars to default slate values but preserves `--my-status` and status color
- `setPaletteKey` is called with the key on enter and with null on exit
- `app.js` startup applies theme vars and re-renders swatch row in palette mode when stored `activePaletteKey` is non-null

---

## Increment 3: Palette Cards

### Behavior

Each person's list row background and status text color reflect their active `paletteKey`. Name color is unchanged. If `paletteKey` is absent, null, unknown (not found in either palette set), or `PALETTES_ENABLED` is false, the card renders exactly as today with no inline styles.

### Changes

**`js/following.js`** — `updateFolloweeRow(entry, userData, myUserId)`:

```
if PALETTES_ENABLED and userData.paletteKey:
  palette = getPaletteByKey(userData.paletteKey)   // searches both sets
  if palette is not the fallback (i.e., key was actually found):
    li.style.background       = palette.theme.surface
    li.style.borderLeftColor  = isAvailable ? palette.color : 'transparent'
    statusEl.style.color      = palette.theme.textMuted
    availableSpan.style.color = palette.color
  else:
    // unknown key — fall back to default CSS class behavior, clear any inline styles
else:
  // existing CSS class behavior, no inline styles
```

To distinguish a found vs. fallback result from `getPaletteByKey`, the function should return `null` when the key is not found (instead of the current forest fallback). The forest fallback is preserved by callers that explicitly need a non-null default (e.g., `applyPaletteVars`).

No new Firebase reads. `userData.paletteKey` arrives through the existing `watchStatus` subscriptions.

### Tests

- Card with known `paletteKey` (Set 1 key) renders palette theme surface as background
- Card with known `paletteKey` (Set 2 key) renders palette theme surface as background
- Card with `paletteKey: null` renders with default CSS classes, no inline styles
- Card with unknown `paletteKey` string falls back to default CSS class behavior
- Card without `paletteKey` field renders with default CSS classes (no regression)

---

## File Change Matrix

| File | Inc 1 | Inc 2 | Inc 3 |
|---|---|---|---|
| `js/features.js` | ✓ enable flag | — | — |
| `js/store.js` | ✓ new state format | — | — |
| `js/palettes.js` | ✓ PALETTE_SETS, toggle, switchSet | ✓ two-tap, mode fns, theme vars | — |
| `js/db.js` | — | ✓ setPaletteKey | — |
| `js/app.js` | — | ✓ restore theme + swatch row on startup | — |
| `js/following.js` | — | — | ✓ card styling |
| `css/app.css` | ✓ toggle btn styles | ✓ key-swatch styles | — |
| `tests/palettes.test.js` | ✓ update + new tests | ✓ new tests | — |
| `tests/following.test.js` | — | — | ✓ new tests |
