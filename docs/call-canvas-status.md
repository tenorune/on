# Call Canvas — Status

*Last updated: 2026-03-23*
*Baseline: v0.7.1 (`bc892c7`)*
*Latest committed: `cff6606`*

## Implemented

### Core flow

- Receiver swipe-right on glowing card → both users enter shared canvas — `1d4efba`, `6897210`
- Caller auto-detects answer via mutual callState → enters canvas — `1d4efba`
- Combined `‹ Name ●` header widget (top-right) — tap to end with confirmation — `749fb65`, `f565aad`
- Canvas persists between sessions per user pair (`canvases/{sortedPairId}/`) — `e48101f`
- Canvas re-entry: swipe-right on glowing card re-enters canvas (one swipe) — `6ecff4a`, `5597e28`

### Exit flow

- Exit clears own callState only (not peer's) — `5597e28`
- Peer on canvas sees "partner left" dialog via presence watcher — `5597e28`
- Peer's card keeps glowing on the exiter's side (indicating peer is still on canvas) — `5597e28`
- If peer exits before re-entry, glow removed — `5597e28`
- Peer can rejoin → dialog auto-dismisses, header undims — `5597e28`
- Second leave triggers dialog again correctly — `5597e28`

### Drawing engine

- Pen tool with pointer/touch events — `5d90640`
- 3 thickness grades (6px, 14px, 24px visual indicators) — `5d90640`, `2ce2c37`
- Strokes normalized to 0–1 coordinates (viewport-independent) — `5d90640`
- Local rendering on draw + tap (single-point dots visible to sender) — `6ecff4a`
- Peer strokes render on completion via `onChildAdded` — `5d90640`

### Floating toolbox (bottom-right)

- Collapsed: pen icon + color ring with thickness indicator (matching expanded sizes) — `5d90640`, `5597e28`
- Expanded: up to 8 status color dots with white ring on selection + 3 thickness dots — `5d90640`, `6ecff4a`
- Tap outside to close — `5d90640`

### Header widget (top-right)

- `‹ Name ●` — red arrow + peer name + peer's pen color dot — `749fb65`, `d3dbb46`
- Dims when peer leaves canvas (name + dot fade, arrow stays) — `fe810d8`, `5597e28`
- Undims when peer returns — `5597e28`
- Tap shows end confirmation dialog — `749fb65`
- Height matches status UI chips — `5597e28`

### Canvas background

- Starts with caller's `surface` color — `5d90640`

### Infrastructure

- Firebase sync: `getCanvasId`, `loadCanvas`, `pushStroke`, `setCanvasBg`, `watchStrokes` — `e48101f`
- Canvas presence: `setCanvasPresence`, `watchCanvasPresence` for leave/rejoin detection — `fe810d8`, `5597e28`
- Pinch-zoom prevention on iOS Safari — `2ce2c37`
- `.env.local` build injection + dev server with LAN URL on port 8080 — `9f8478b`
- CSP moved to Firebase hosting headers — `090e1e7`
- Safe-area-inset margins on all widgets — `2ce2c37`, `dcf7af0`, `6ecff4a`

## Remaining from Plan

### Task 5 (in progress)

- [x] Commit accumulated changes — `5597e28`
- [ ] Manual testing checklist verification
- [x] Architecture doc update with Call Canvas section + changelog — `cff6606`
- [ ] Tag milestone

## Deferred (SHOULD HAVE / NICE TO HAVE)

| Priority | Feature |
|---|---|
| SHOULD | Line tool |
| SHOULD | Shape tool (circle/rect/triangle) with sub-menu |
| SHOULD | 6 thickness grades (currently 3) |
| SHOULD | Canvas background picker (surface colors) |
| SHOULD | Background change visible to both users |
| SHOULD | Real-time mid-stroke visibility |
| NICE | Clear canvas with mutual agreement (gesture) |
| NICE | Undo (my strokes only, capped at 8) |
| NICE | Shape drag-to-size with dashed preview |
