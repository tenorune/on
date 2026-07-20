// js/canvasDelta.ts — delta protocol for the live-drawing broadcast.
// The old protocol re-sent the ENTIRE stroke every throttle tick (O(n²) bytes
// over a long stroke, full clear-and-redraw per tick on the receiver). Now each
// tick sends only the points appended since the last send, plus `base` = how
// many points the receiver should already hold.
// Wire compat: a payload with no `base` (legacy sender) is a full replace; a
// legacy RECEIVER shown a delta payload renders just the tail mid-stroke — a
// transient preview artifact only, since the final stroke lands via pushStroke.
export type DrawingPayload = { color: string; thickness: number; points: number[][]; base: number };

export function buildDrawingPayload(
  allPoints: number[][], lastSentIndex: number, color: string, thickness: number,
): DrawingPayload {
  return { color, thickness, points: allPoints.slice(lastSentIndex), base: lastSentIndex };
}

export function applyDrawingPayload(
  buffer: number[][] | null,
  p: { points?: number[][]; base?: number },
): number[][] {
  const points = p.points ?? [];
  const base = p.base;
  if (base === undefined || base === 0 || !buffer) return points.slice();
  // In-place append: truncate to base (coalesced-write gap joins as before)
  // and push the tail — the old slice().concat() copied the whole stroke
  // every 80ms tick. Callers hold the same array identity across ticks.
  // `base` comes from peer-written RTDB data — clamp defensively so a malformed
  // (negative/NaN) base degrades gracefully instead of throwing RangeError on
  // the length assignment. Valid in-app base is always _currentPoints.length.
  const truncateTo = Number.isFinite(base) ? Math.max(0, Math.min(base as number, buffer.length)) : 0;
  buffer.length = truncateTo;
  for (const pt of points) buffer.push(pt);
  return buffer;
}
