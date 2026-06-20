// js/hintRotation.js
//
// Single owner of the FTU longpress/swipe hint animations. Row-paint code in
// following.js (Direct) and groupContext.js (group) stamps eligibility
// data-attributes (data-hint-longpress / data-hint-swipe / data-hint-avail) on
// each row; this module reads them from the active context's list and animates
// exactly ONE hint at a time, alternating type and rotating cards. See
// docs/superpowers/specs/2026-06-19-hint-rotation-design.md.

// ── Pure core ────────────────────────────────────────────────────────────────

// Given candidates [{ id, available }] (already eligibility-filtered, in order)
// and an isVisible(id) predicate, return the ordered list of ids that may show:
// visible-only (B4); within visible, prefer available, else fall back to visible
// unavailable (B5 / Interpretation Y).
export function resolvePool(candidates, isVisible) {
  const visible = (candidates || []).filter((c) => c && isVisible(c.id));
  if (visible.length === 0) return [];
  const available = visible.filter((c) => c.available);
  const pool = available.length ? available : visible;
  return pool.map((c) => c.id);
}

// Pick the next single hint. state = { lastType, lastIds: { longpress, swipe } }.
// pools = { longpress: [id...], swipe: [id...] } (already resolved/ordered).
// Alternate type between the types that currently have a pool; advance that
// type's own round-robin pointer. When lastType is null the initial type
// defaults to 'longpress'. Returns { type, id, state } (type/id null when
// nothing is showable).
export function selectNextHint(state, pools) {
  const types = [];
  if (pools.longpress && pools.longpress.length) types.push('longpress');
  if (pools.swipe && pools.swipe.length) types.push('swipe');
  if (types.length === 0) return { type: null, id: null, state: { ...state } };

  const type = types.length === 1
    ? types[0]
    : (state.lastType === 'longpress' ? 'swipe' : 'longpress');

  // Identity-based pointer: advance to the card AFTER the last-shown one in the
  // current (re-sorted) pool — B3 recomputes order each step, so an absent or
  // null last id (indexOf === -1) restarts at index 0.
  const pool = pools[type];
  const prevId = state.lastIds ? state.lastIds[type] : null;
  const prevIdx = pool.indexOf(prevId);
  const idx = (prevIdx + 1) % pool.length;
  const id = pool[idx];
  return {
    type,
    id,
    state: { lastType: type, lastIds: { ...state.lastIds, [type]: id } },
  };
}

// Pure pause predicate (B6). Engine computes the flags from the DOM/app state.
export function isPaused({ overlayOpen, callActive, hidden, scrolling }) {
  return !!(overlayOpen || callActive || hidden || scrolling);
}
