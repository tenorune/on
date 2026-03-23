# Call Canvas — Design Spec

## Overview

When a receiver swipe-right-answers a caller's card, both users transition to a shared drawing canvas. Each user draws with their statusColor as the default pen. The canvas persists between sessions for each unique pair of users.

**Scope:** MUST HAVE items only. Line/Shape tools, canvas background changing, real-time mid-stroke visibility, undo, and clear canvas are deferred to future iterations.

**Baseline:** v0.7.1 (color arch refactor and cleanup)

---

## Architecture

The canvas is a full-screen overlay that replaces the main list UI. It uses an HTML `<canvas>` element for drawing and Firebase RTDB for stroke sync. Two new files: `js/canvas.js` (screen + drawing engine) and `js/canvas-sync.js` (Firebase read/write). New CSS in `css/canvas.css`. Hooks into the existing call mode flow in `following.js`.

---

## UI Layout

Reference mockup: `docs/prototypes/call-canvas-v6.html`

Four floating elements on a full-screen canvas:

| Position | Element | Behavior |
|---|---|---|
| Top-left | `< End` button | Tap shows confirmation dialog ("End session?" Cancel/End) |
| Top-right | Peer indicator | Name + color dot (dot = peer's current pen color) |
| Bottom-right | Toolbox (collapsed) | Tool icon + color/thickness ring. Tap to expand. |
| Bottom-right | Toolbox (expanded) | 8 status color dots (one row) + 3 thickness dots. Tap outside to close. |
| Bottom-left | Reserved | Empty for now (undo in future) |

Canvas background: caller's `surface` color (from `getCanvasColors().bgColors` or Firebase `canvases/{id}/bg`).

---

## Components

### 1. Canvas Screen (`js/canvas.js`)

**Responsibilities:**
- Render the full-screen `<canvas>` element and floating UI
- Handle pointer/touch events for drawing (pen tool)
- Manage local drawing state (current color, thickness)
- Render strokes (own + peer's) on the canvas
- Enter/exit canvas transitions

**Exports:**
- `enterCanvas(peerId, peerName, myUserId)` — show canvas, load existing strokes, start listening
- `exitCanvas()` — tear down listeners, return to main UI

**Drawing behavior:**
- `pointerdown` → begin stroke, record points
- `pointermove` → draw locally, append points
- `pointerup` → commit stroke to Firebase via canvas-sync
- Touch events: use `touch-action: none` on canvas to prevent scroll/zoom

**Stroke format (local):**
```javascript
{
  userId: string,
  color: string,       // hex
  thickness: number,   // 1, 2, or 3 (mapped to pixel widths)
  tool: 'pen',
  points: [[x, y], ...],  // normalized 0–1 (x/canvas.width, y/canvas.height)
  timestamp: number,
}
```

Points are normalized to 0–1 range so strokes render correctly on any screen size.

**Thickness mapping:**
| Grade | Normalized | Approx pixels (375px wide screen) |
|---|---|---|
| 1 (thin) | 0.005 | ~2px |
| 2 (medium) | 0.012 | ~4.5px |
| 3 (thick) | 0.025 | ~9px |

Stored as the normalized value. Rendered as `thickness * canvas.width`.

### 2. Canvas Sync (`js/canvas-sync.js`)

**Responsibilities:**
- Generate `canvasId` from sorted user pair
- Read existing strokes + bg on canvas enter
- Listen for new strokes via `onChildAdded`
- Write completed strokes via `push()`
- Read/write canvas `bg` field

**Firebase schema:**
```text
canvases/
  {canvasId}/
    bg: string                     // hex surface color
    strokes/
      {strokeId}/
        userId: string
        color: string
        thickness: number
        tool: "pen"
        points: [[x,y], ...]
        timestamp: number
```

**Exports:**
- `initCanvasSync(canvasId, myUserId, onStroke, onBgChange)` — load existing, start listening
- `writeStroke(canvasId, stroke)` — push a completed stroke
- `setCanvasBg(canvasId, color)` — set background color
- `stopCanvasSync()` — unsubscribe listeners

**canvasId derivation:**
```javascript
function getCanvasId(uid1, uid2) {
  return [uid1, uid2].sort().join('_');
}
```

**Firebase operations:**
- `initCanvasSync`: `get()` on `canvases/{id}` for initial state, then `onChildAdded` on `canvases/{id}/strokes` for new strokes (with `startAfter` the last loaded key to avoid replaying existing)
- `writeStroke`: `push()` to `canvases/{id}/strokes`
- `setCanvasBg`: `update()` on `canvases/{id}` with `{ bg }`

### 3. Call Flow Integration (`js/following.js` modifications)

**Current flow:**
1. Caller swipes right → `enterCallMode()` → writes `callState` to Firebase → card glows
2. Receiver sees glow via `watchStatus` → card glows on their side
3. Receiver swipes right → `enterCallMode()` (currently just sets their own callState)
4. Swipe left → `exitCallMode()` → clears callState

**New flow (receiver answers):**
1. Caller swipes right → `enterCallMode()` → card glows (unchanged)
2. Receiver swipes right on glowing card → instead of `enterCallMode()`:
   - Import and call `enterCanvas(callerId, callerName, myUserId)`
   - Write `callState` indicating "answered" (so caller detects it)
3. Caller detects receiver's `callState` via `watchStatus` → enters canvas too
4. Both are now on the canvas screen

**Detection mechanism:** When the caller's `watchStatus` callback sees the receiver has also set `callState.calleeId === callerId` (mutual call state), the caller auto-enters the canvas.

**End flow:**
1. User taps `< End` → confirmation dialog
2. On confirm: `exitCanvas()` → `exitCallMode()` (clears own `callState`)
3. Other user: `watchStatus` detects `callState: null` → shows "X left" dialog → taps Done → `exitCanvas()`

### 4. Canvas CSS (`css/canvas.css`)

**Layout:**
- `#canvas-screen`: fixed, inset 0, z-index above main content, background from caller's surface
- `#draw-canvas`: full width/height, `touch-action: none`
- `.canvas-end-btn`: absolute top-left
- `.canvas-peer`: absolute top-right
- `.canvas-toolbox`: absolute bottom-right
- `.canvas-toolbox-expanded`: color dots row + thickness dots row + separator
- All floating elements: glass-morphism style (semi-transparent dark bg, backdrop-filter blur, subtle border)

### 5. HTML additions (`index.html`)

Add a hidden canvas screen container:
```html
<div id="canvas-screen" class="hidden">
  <canvas id="draw-canvas"></canvas>
  <!-- Floating UI injected by canvas.js -->
</div>
```

---

## Data Flow Diagrams

### Enter Canvas (Receiver)

```text
Receiver swipes right on caller's glowing card
  → enterCanvas(callerId, callerName, myUserId)
  → getCanvasId(myUserId, callerId)
  → initCanvasSync(canvasId, myUserId, onStroke, onBgChange)
     → get() canvases/{id} → render existing strokes + bg
     → onChildAdded(strokes/) → listen for new
  → Show canvas screen, hide main UI
  → Write callState to Firebase (answered)
```

### Enter Canvas (Caller — auto-detect)

```text
Caller's watchStatus sees receiver's callState
  → Detects mutual call (both have callState pointing at each other)
  → enterCanvas(receiverId, receiverName, myUserId)
  → Same sync flow as receiver
```

### Drawing + Sync

```text
User draws stroke (pointerdown → pointermove → pointerup)
  → Local: render on canvas immediately
  → pointerup: writeStroke(canvasId, stroke)
     → push() to canvases/{id}/strokes

Peer's onChildAdded fires
  → onStroke callback
  → Render stroke on canvas
  → Update peer indicator dot color
```

### End Call

```text
User taps < End → confirmation dialog
  → Confirm: exitCanvas() + exitCallMode()
     → stopCanvasSync()
     → Hide canvas screen, show main UI
     → clearCallState(myUserId) → Firebase

Other user's watchStatus detects callState: null
  → Show "X left" overlay on canvas
  → User taps Done → exitCanvas()
```

---

## Pen Color Palette

Colors come from `getCanvasColors().penColors` (up to 8 unique statusColors from the user's favorites). The user's current `statusColor` is the default selected pen.

Peer indicator dot color: updated to the color of the peer's most recently received stroke.

---

## Edge Cases

| Case | Behavior |
|---|---|
| User goes unavailable while on canvas | No effect — canvas stays open |
| App backgrounded | Session stays alive; peer indicator can show "absent" if no activity |
| User receives knock while on canvas | Queued; shown when returning to list |
| Both users end simultaneously | Each sees the other's disconnect; both return to list |
| Canvas has existing strokes from prior session | Loaded on enter, drawing continues where they left off |
| Network disconnect during draw | Stroke write fails silently; local rendering persists; reconnect replays |
| User has no favorites (first use) | penColors falls back to current statusColor only (1 color) |

---

## Files

| File | Action | Purpose |
|---|---|---|
| `js/canvas.js` | Create | Canvas screen, drawing engine, floating UI |
| `js/canvas-sync.js` | Create | Firebase sync for strokes and bg |
| `css/canvas.css` | Create | Canvas screen and floating UI styles |
| `index.html` | Modify | Add `#canvas-screen` container |
| `js/following.js` | Modify | Hook canvas entry into call answer flow |
| `js/db.js` | Modify | Add canvas Firebase operations |
| `tests/canvas.test.js` | Create | Canvas logic tests |
| `tests/canvas-sync.test.js` | Create | Sync logic tests |

---

## Testing Strategy

- **canvas.js**: Test stroke normalization, thickness mapping, color selection, enter/exit state
- **canvas-sync.js**: Test canvasId generation, mock Firebase get/push/onChildAdded
- **following.js**: Test that swipe-right on glowing card calls enterCanvas, test mutual call detection
- **Integration**: Manual testing of two-user drawing flow on separate devices

---

## Not in Scope

- Line tool, Shape tool
- 6 thickness grades (3 only)
- Canvas background picker
- Surface colors in toolbox
- Real-time mid-stroke visibility (strokes appear on completion only)
- Clear canvas mutual agreement
- Undo
- Canvas pan/zoom
