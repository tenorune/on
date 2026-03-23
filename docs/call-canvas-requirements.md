# Call Canvas — Requirements & Edge Cases

## MUST HAVE

- Receiver swipe-right on caller's card enters canvas; both users transition to canvas screen
- `< End` (top-left) with confirmation dialog
- Shared canvas: both users see each other's strokes, shapes, or lines when they are completed
- Each user starts with their current statusColor as pen color
- Floating toolbox (bottom-right): Pen, 3 thickness grades
- Color palette: up to 8 status colors from user's own favorites
- Strokes render in the color of the drawing user's selected pen
- Peer indicator (top-right): name + color dot; dot updates with peer's current pen color
- Either user can end at any time; other sees "X left" + Done
- Swipe-left on card (existing) cancels call before canvas opens (already implemented)
- Canvas starts with caller's `surface` as background
- Stroke data persisted for reconnection (if user loses connection briefly)
- Refactor the color data model to import all 8 favorites:
  - `statusapp_favorites` stores status colors for history pills but does not include values for Pill 1 and Pill 2, nor the `surface` variable used in `statusapp_theme` (the background color used in User Cards and the appropriate value for canvas background)
  - Status colors for Pill 1 and Pill 2 are stored in `statusapp_palette_state`, but that also does not include the `surface` variable
  - LocalStorage has three keys that store color information for various purposes and this should be refactored to cover all cases, including Call Canvas, in as elegant a way as possible
  - The Firebase schema of `statusColor` and `paletteKey` should interoperate with a refactored color data model

## SHOULD HAVE

- Floating toolbox expanded: Line, Shape (circle/rect/triangle), 6 thickness grades
- Collapsed toolbox: color/thickness ring; tap to expand, tap-outside to close (if only a pen, tool icon is not necessary)
- Color palette expanded: up to 8 theme bg (`surface`) colors from user's own favorites
- Canvas background changeable (pick from `surface` colors)
- Background change visible to both users
- Real-time stroke visibility (see other user's strokes as they draw, not only on completion)

## NICE TO HAVE

- Clear canvas with mutual agreement (request → approve/deny), triggered with a gesture
- Undo (bottom-left, persistent) — my strokes only, capped at 8
- Shape drag-to-size with dashed preview + corner handles

## EDGE CASES — RESOLVED

**What happens if both users are unavailable?** Can a call still be active? Or does going unavailable auto-end the session?
> Unavailable does not affect the call.

**Caller goes unavailable while on canvas** — end session automatically, or keep it open?
> Same as above — unavailable does not affect the call.

**App backgrounded / locked** — timeout? Keep session alive for how long?
> Indicate in the UI that the other user is "absent" and give an option to exit the call. Keep the session alive as long as the user has not exited.

**Undo scope** — undo only my strokes, or any stroke (including peer's)?
> Undo only my strokes.

**Undo depth** — unlimited? Or capped (e.g., last 20 actions)?
> Cap it at 8.

**Shape sub-tool memory** — when switching back to Shape, remember last sub-shape (circle/rect/triangle)?
> Yes.

**Canvas size** — fixed viewport, or infinite scroll?
> Fixed.

**Stroke storage** — Firebase Realtime DB paths? Or a separate canvas channel?
> Dedicated canvas path: `canvases/{canvasId}/strokes` where `canvasId` is derived from the sorted pair of user IDs. Both users read/write to the same path. Canvas persists between sessions. Strokes stored as ordered objects: `{ userId, color, thickness, tool, points[], timestamp }`.

**Max concurrent sessions** — one canvas per user at a time?
> A user may be in only one ACTIVE call at a time. But persist the canvas between each unique pair of users. They can pick up where they left off in an earlier call.

**What if the user receives a knock while on canvas?** Show it? Ignore?
> Show knocks when the user returns to the people list, and use the same logic and animation used as if the app has been closed.

## STROKE STORAGE — DECIDED

**Dedicated canvas path** in Firebase Realtime DB:

```text
canvases/
  {canvasId}/                        // sorted pair: e.g. "uid1_uid2"
    bg: string                       // current canvas background (surface color)
    strokes/
      {strokeId}/
        userId: string
        color: string                // hex
        thickness: number
        tool: "pen" | "line" | "shape"
        points: [[x,y], ...]         // or shape-specific data
        timestamp: number
```

- `canvasId` derived from sorted user IDs ensures both users reference the same canvas regardless of who initiated
- Canvas persists between sessions — users pick up where they left off
- Both users read/write to the same path
- For reconnection: client replays all strokes from the path on rejoin
