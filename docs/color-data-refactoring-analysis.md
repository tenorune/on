# Color Data Architecture — Refactoring Analysis

## The Problem

Three localStorage keys store color information for overlapping but incomplete purposes:

| Key | What it stores | What it's missing |
|---|---|---|
| `statusapp_favorites` | History pills: `statusColor`, `themeBg` (surface2), `paletteKey`, `selectedKey`, `activeSet` | No Pill 1/Pill 2 (live slot combos). No `surface` (card bg). `themeBg` uses `surface2`, not `surface`. |
| `statusapp_palette_state` | Per-set: `selectedKey`, `activePaletteKey`, `selectedColor`. Plus `activeSet`. | No `surface` or theme colors. `selectedColor` is undefined until user acts. |
| `statusapp_theme` | Full theme: `bg`, `surface`, `surface2`, `text`, `textMuted`, `accent`, `errorBg`, `errorText` | Transient — written by `applyThemeVars`, read only on cold start. No `statusColor`. No set/key info. Only reflects the ACTIVE palette. |

### What Call Canvas needs

For a user's pen color palette on the canvas, we need up to 8 `statusColor` values — one from each favorite slot:

- **Slot 1** (Set 1 live combo): `statusColor` from `slotCombo(1)` — computed from `--my-status` CSS var (active) or `selectedColor`/`palette.color` (inactive). NOT in `statusapp_favorites`.
- **Slot 2** (Set 2 live combo): same as above for Set 2. NOT in `statusapp_favorites`.
- **Slots 3–8** (history): `statusColor` IS in `statusapp_favorites`.

For canvas background colors (SHOULD HAVE), we need `surface` from each favorite's palette theme. Currently:
- `statusapp_favorites` stores `themeBg` = `surface2`, not `surface`
- `surface` can only be derived by looking up `paletteKey` → `PALETTE_SETS[n].theme.surface`
- For base-mode combos (`paletteKey: null`), `surface` is the default `#1e293b`

### The gap

There is no single place to get "all 8 favorite combos with their full color context." You need to query `statusapp_palette_state` for slots 1/2, `statusapp_favorites` for slots 3–8, and `PALETTE_SETS` for any derived values like `surface`.

---

## Analysis: Refactor Before or During Call Canvas?

### Option A: Refactor first, then build Call Canvas

**Approach:** Unify the combo data model. Every combo (slots 1–2 and history 3–8) stores the same shape with all needed fields, including `surface`. The Call Canvas (and any future feature) just reads one source.

**Pros:**
- Call Canvas implementation is clean — just import the combos
- Future features (e.g., sharing combos, exporting themes) benefit immediately
- Eliminates the three-key fragmentation
- `surface` is available everywhere without re-derivation

**Cons:**
- Touches favorites.js, store.js, palettes.js, and potentially following.js
- Existing tests need updating
- Risk of introducing bugs in the stable favorites/palette system

### Option B: Build Call Canvas with adapters, refactor later

**Approach:** Write a `getCanvasPalette()` function that assembles the 8 colors from the three sources at call time. Doesn't change existing storage.

**Pros:**
- No risk to existing features
- Faster to start Call Canvas

**Cons:**
- Adapter is fragile and couples canvas to three storage formats
- Defers the tech debt
- Any future feature hits the same gap again

### Recommendation: **Option A — Refactor first**

The user explicitly called this out as a MUST HAVE. The current architecture is already showing strain (three keys, derived values, gaps between slots and history). Call Canvas will be the third consumer of this data (after palette picker and favorites strip). Refactoring now prevents the adapter pattern from becoming permanent tech debt.

---

## Proposed Refactored Architecture

### Principle: One combo shape, one API

A **combo** is the atomic unit of color identity in the app. It represents "what the user looks like" at a point in time. Every combo should carry all the color data needed to:
1. Render a favorites pill (statusColor + surface2)
2. Render a user card (statusColor + surface + paletteKey)
3. Populate a canvas pen palette (statusColor)
4. Set a canvas background (surface)
5. Restore full UI state (paletteKey + selectedKey + activeSet)

### Enriched combo shape

```javascript
{
  statusColor: string,       // hex — the status dot / pen color
  paletteKey: string | null, // active palette theme, or null for base mode
  selectedKey: string,       // which palette swatch is selected
  activeSet: 1 | 2,          // which set this belongs to
  surface: string,           // card bg — palette.theme.surface or DEFAULT_SURFACE
  surface2: string,          // pill right-half — palette.theme.surface2 or DEFAULT_SURFACE2
}
```

`surface` and `surface2` are computed from `paletteKey` at save time and stored in each combo. This makes combos self-contained and portable — no `PALETTE_SETS` lookup needed when reading.

### Storage: unchanged structure, enriched fields

**`statusapp_favorites`** stays a flat array of history combos (max 6). No structural change. Each combo gains `surface` and `surface2`. The existing `themeBg` field is renamed to `surface2`.

**`statusapp_palette_state`** stays as-is — picker UI state (selectedKey, activePaletteKey, selectedColor, activeSet).

**`statusapp_theme`** stays as-is — cold-start CSS cache.

### The key insight: one API, not one key

Rather than merging live slots into the favorites array (which adds complexity to every saveFavorite/dedup/renderStrip code path), we add a **single API function** that assembles all 8 combos from the two sources:

```javascript
function getAllCombos() {
  return [slotCombo(1), slotCombo(2), ...getFavorites()];
}
```

This gives every consumer — favorites strip, Call Canvas, future features — one call to get all 8 combos as a flat array. Internally it reads palette_state for live slots and favorites for history, but that's an implementation detail no consumer sees.

### Why NOT persist live slots in the array

Persisting slots 0/1 was considered and rejected after cross-referencing with the architecture doc:

1. **10+ write points**: Every swatch tap, complement click, enterPaletteMode, exitPaletteMode, switchSet, adoption, and history restore would need to update indices 0–1. Currently these just update palette_state and CSS vars.

2. **Timing fragility**: `buildCombo()` reads `--my-status` from the CSS DOM. During state transitions (e.g., inside `switchSet`), CSS vars may not be set yet when `palette-state-changed` fires. A stored slot could capture stale values.

3. **Index offset complexity**: `saveFavorite`, `pillsLookSame` scans, `removeHistoryDuplicatesOfSlots`, `handleHistoryTap` — all would need to skip indices 0–1 when operating on history. Every array operation gains an offset.

4. **Unnecessary**: `slotCombo()` already computes the live slot on demand. It reads palette_state (always current) and `--my-status` (always current). There's no stale-data risk with the computed approach.

### Canvas API

```javascript
function getCanvasColors() {
  const combos = getAllCombos();
  const penColors = [...new Set(combos.map(c => c.statusColor))];
  const bgColors  = [...new Set(combos.map(c => c.surface))];
  return { penColors, bgColors };
}
```

### Firebase interop

No Firebase schema changes needed. Firebase stores `statusColor` and `paletteKey` — the two fields peers need. The enriched local combo carries `surface` and `surface2` additionally, but those are local-only. The existing `setStatusColor` / `setPaletteKey` / `watchStatus` pipeline is unaffected.

For Call Canvas, the `canvases/{canvasId}/strokes` path stores stroke data independently. The pen color in each stroke is a hex string — it doesn't reference the combo structure.

### What this unlocks

| Consumer | Before | After |
|---|---|---|
| **Favorites strip** | `slotCombo()` computes live; history from `getFavorites()`. | Same — but `getAllCombos()` available if strip ever needs the full picture. |
| **Call Canvas** | Would need adapter across 3 stores. | `getCanvasColors()` — one call, deduped colors. |
| **Pill rendering** | `themeBg` (surface2) available. `surface` requires PALETTE_SETS lookup. | Both `surface` and `surface2` in every combo. |
| **Future features** | Must know which keys to read and how to combine them. | `getAllCombos()` — self-contained combos, flat array. |

---

## Implementation Order

1. **Enrich combo shape**: Add `surface` and `surface2` to `buildCombo()` and `slotCombo()` — computed from `paletteKey` at call time
2. **Rename `themeBg` → `surface2`** in combo shape, `renderPill`, `pillsLookSame`, tests (atomic with step 1)
3. **Add `getAllCombos()`**: `[slotCombo(1), slotCombo(2), ...getFavorites()]`
4. **Add `getCanvasColors()`**: Extract unique `statusColor` and `surface` from `getAllCombos()`
5. **Update tests**
6. **Update architecture doc**

No migration of old stored favorites is needed — existing data will be naturally replaced as users interact with the palette picker.

Steps 1–2 are the refactoring. Steps 3–4 add the canvas API. Steps 5–6 are verification and documentation. The Call Canvas implementation starts after this is stable.
