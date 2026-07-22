# Canvas screenshot mode — design

**Date:** 2026-07-17
**Scope:** Web call canvas (`js/canvas.ts`, `js/db/canvas.ts`, `css/canvas.css`)

## Summary

A "Screenshot" action in the canvas toolbox, next to "Clear". Tapping it starts a
consent handshake (mirroring the clear-canvas flow): the peer must agree. On
consent, on **both** devices, the three floating chrome elements — toolbox,
undo button, and the name/end-call header — fade out over 200ms, stay hidden
for 5 seconds, then fade back in over 200ms, so either user can take a clean
native OS screenshot.

No image capture is performed by the app. Drawing stays fully interactive
during the hidden window.

## DB signaling

One key on the shared canvas node, `canvases/$canvasId/screenshotRequest`,
with a small state machine:

| Value                        | Meaning                              |
| ---------------------------- | ------------------------------------ |
| `null`                       | idle / cancelled / declined / done   |
| `{ by: <uid> }`              | request pending peer consent         |
| `{ by: <uid>, approved: true }` | consent given — both clients run the hide sequence |

RTDB rules already grant both participants read/write on the whole
`canvases/$canvasId` subtree (`database.rules.json:171-175`) — **no rules
change**.

New functions in `js/db/canvas.ts`, mirroring the clear trio:

- `setScreenshotRequest(canvasId, requesterId)` — write `{ by }`
- `approveScreenshotRequest(canvasId, requesterId)` — write `{ by, approved: true }`
- `removeScreenshotRequest(canvasId)` — write `null`
- `watchScreenshotRequest(canvasId, onChange)` — `onValue`, passes the raw value

## UI

**Toolbox button.** `Screenshot` appended after `Clear` in the expanded
toolbox, reusing the `canvas-clear-btn` styling family (neutral, not danger).
Tap → close toolbox → `requestScreenshot()`.

**Requester waiting dialog.** Overlay-guarded like clear's. Copy:
"Screenshot / Waiting for {peer} to agree..." with **Cancel** → removes the key.

**Approver consent dialog.** "{peer} wants a screenshot / The controls will
hide for 5 seconds" with **Not now** (→ remove key) / **Allow**
(→ `approveScreenshotRequest`).

**Watcher dispatch** (single watcher registered in `enterCanvas`):

- `{ by: peer }`, not approved → show consent dialog (never to self).
- `{ by, approved: true }` → dismiss any dialog; run the hide sequence. The
  value round-trips to the approver too, so both clients fire from the same
  watcher — no local special-casing.
- `null` → dismiss dialogs (cancel / decline / cleanup), same as clear's.

## Hide sequence

**CSS** (`css/canvas.css`): floats get a 200ms opacity transition; one class
on the screen container drives all three:

```css
.canvas-float { transition: opacity 0.2s ease; }
#canvas-screen.screenshot-mode .canvas-float { opacity: 0; pointer-events: none; }
```

Opacity + `pointer-events: none` composes with the undo button's
overlap-`display:none` logic and its `.disabled` opacity: class removal
restores prior state untouched.

**JS** (`js/canvas.ts`): `runScreenshotSequence()`:

1. Add `screenshot-mode` to `#canvas-screen` (fade-out 200ms, then hidden).
2. One timeout at **5200ms** removes the class (200 fade-out + 5000 hold);
   fade-in runs 5200–5400ms.
3. At **5400ms** (second timeout), **both clients** remove the DB key — null
   writes are idempotent, and the approver's write self-heals a requester
   that crashed mid-sequence (whose orphaned `{approved: true}` would
   otherwise replay the hide on every canvas re-entry).
4. Timer handles live in session singletons; `exitCanvas` clears them and
   removes the class so an exit mid-sequence can't leak state into the next
   session.

Drawing handlers are untouched — canvas input stays live throughout.

## Error handling

- All DB writes `.catch(() => {})`, matching the file's convention.
- The existing "one `.canvas-dialog-overlay` at a time" guard serializes
  screenshot vs. clear dialogs; a request arriving while another overlay is up
  shows nothing, and the requester's waiting dialog resolves when the key
  clears or they cancel.
- A `screenshotRequest` left orphaned (e.g. crash mid-flow) is removed by the
  next `null`-dispatch or overwritten by the next request; no TTL needed.

## Tests (TDD — red first)

In the `tests/canvas.test.js` / `tests/canvas-sync.test.js` style (jsdom +
mocked `./db.js`, fake timers):

- **DB shapes:** the three setters write the documented values;
  `watchScreenshotRequest` passes raw values through.
- **Dispatch:** `{by: peer}` shows the consent dialog; `{by: me}` never shows
  it to the requester; `approved: true` starts the sequence in both roles;
  `null` dismisses open dialogs.
- **Sequence:** class present after start; removed after 5200ms; both sides
  remove the key at 5400ms; `exitCanvas` mid-sequence clears timers and the class.
- **Button:** Screenshot button renders next to Clear and triggers the
  request write + waiting dialog.

## Out of scope

- App-side image capture / share sheet.
- Input freezing during the hidden window.
- Telegram-surface parity work.
