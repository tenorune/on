// js/hintRotation.js
//
// Single owner of the FTU longpress/swipe hint animations. Row-paint code in
// following.js (Direct) and groupContext.js (group) stamps eligibility
// data-attributes (data-hint-longpress / data-hint-swipe / data-hint-avail) on
// each row; this module reads them from the active context's list and animates
// exactly ONE hint at a time, alternating type and rotating cards. See
// docs/superpowers/specs/2026-06-19-hint-rotation-design.md.

import { getCurrentContext } from './groupNav.js';
import { isCardDrawerOpen } from './cardDrawer.js';
import { isNotifyPopoverOpen } from './notifyBell.js';
import { getCallModeCalleeId, getIncomingCallFrom } from './following.js';

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

// ── Engine state ─────────────────────────────────────────────────────────────
const STEP_MS = 6850;
const CONTAINER_BY_CONTEXT = { direct: '#people-list', group: '#group-roster' };

let _state = { lastType: null, lastIds: { longpress: null, swipe: null } };
let _active = null;        // { li, type } | null
let _timer = null;
let _scrolling = false;
let _scrollEndTimer = null;
let _started = false;

function _stopTimer() { if (_timer) { clearInterval(_timer); _timer = null; } }

function _container() {
  const { context } = getCurrentContext();
  return document.querySelector(CONTAINER_BY_CONTEXT[context] || '#people-list');
}

// Read eligibility attributes the row-paint code stamps. container may be passed
// (tests) or resolved from the active context.
export function _collectCandidates(container = _container()) {
  const pools = { longpress: [], swipe: [] };
  if (!container) return pools;
  for (const li of container.querySelectorAll('[data-user-id]')) {
    const available = li.dataset.hintAvail === '1';
    // id is the row <li> element itself — selectNextHint treats it as an opaque identity token.
    if (li.dataset.hintLongpress === '1') pools.longpress.push({ id: li, available });
    if (li.dataset.hintSwipe === '1') pools.swipe.push({ id: li, available });
  }
  return pools;
}

export function _clearActive() {
  // Engine is the sole owner — sweep ALL hint elements so exactly zero remain.
  document.querySelectorAll('.longpress-hint, .swipe-hint').forEach((el) => el.remove());
  _active = null;
}

// Public: drop the current hint immediately and reset rotation ownership.
// Used by gesture handlers that retire a hint on first use.
export function clearActiveHint() { _clearActive(); }

export function _placeHint(li, type) {
  if (_active && _active.li === li && _active.type === type && document.contains(li)) return;
  _clearActive();
  const hint = document.createElement('div');
  hint.className = type === 'swipe' ? 'swipe-hint' : 'longpress-hint';
  li.style.position = 'relative';
  li.appendChild(hint);
  _active = { li, type };
}

// Test-only reset so suites start from a clean engine.
export function _resetEngineForTest() {
  _stopTimer();
  _clearActive();
  _state = { lastType: null, lastIds: { longpress: null, swipe: null } };
  _scrolling = false;
  _started = false;
}

// ── Pause-flag collection ────────────────────────────────────────────────────
function _modalOpen(id) {
  const el = document.getElementById(id);
  return !!el && !el.classList.contains('hidden');
}

export function _collectPauseFlags() {
  const recovery = document.getElementById('recovery-revealed');
  const overlayOpen =
    isCardDrawerOpen() ||
    !!document.getElementById('add-person-form')?.classList.contains('open') ||
    !!document.getElementById('code-drawer')?.classList.contains('open') ||
    _modalOpen('create-group-modal') ||
    _modalOpen('invite-modal') ||
    document.getElementById('group-context-actions')?.open === true ||
    isNotifyPopoverOpen() ||
    (!!recovery && !recovery.classList.contains('hidden'));
  const callActive = getCallModeCalleeId() !== null || getIncomingCallFrom() !== null;
  const hidden = document.visibilityState === 'hidden';
  return { overlayOpen, callActive, hidden, scrolling: _scrolling };
}

// ── Timer / visibility / refresh / init wiring ───────────────────────────────
// Visible region: top edge = bottom of the lowest CURRENTLY-PINNED header in the
// active context (measured live, so it's correct whether or not the group header
// is ever made sticky — see #274). Bottom edge = viewport bottom.
function _regionTop() {
  // Known pinnable headers; filtered to those actually sticky/fixed right now.
  const headers = [
    document.getElementById('nav-row'),
    document.getElementById('app-header'),
    document.querySelector('.group-context-header'),
  ];
  let top = 0;
  for (const el of headers) {
    if (!el || el.classList.contains('hidden')) continue;
    const pos = getComputedStyle(el).position;
    if (pos !== 'sticky' && pos !== 'fixed') continue;
    const b = el.getBoundingClientRect().bottom;
    if (b > top) top = b;
  }
  return top;
}

function _isFullyVisible(li) {
  const r = li.getBoundingClientRect();
  const top = _regionTop();
  const bottom = window.innerHeight || document.documentElement.clientHeight;
  return r.height > 0 && r.top >= top && r.bottom <= bottom;
}

export function _step() {
  if (isPaused(_collectPauseFlags())) { _clearActive(); return; }
  const cand = _collectCandidates();
  const pools = {
    longpress: resolvePool(cand.longpress, _isFullyVisible),
    swipe: resolvePool(cand.swipe, _isFullyVisible),
  };
  const next = selectNextHint(_state, pools);
  _state = next.state;
  if (!next.id) { _clearActive(); return; }
  _placeHint(next.id, next.type);
}

function _ensureTimer() {
  if (_timer) return;
  _step();                       // immediate first pulse on (re)start
  _timer = setInterval(_step, STEP_MS);
}

export function refreshHints() {
  if (!_started) return;
  if (isPaused(_collectPauseFlags())) { _clearActive(); _stopTimer(); return; }
  if (_active && !document.contains(_active.li)) _clearActive(); // DOM-removal clears now
  _ensureTimer();
}

function _onScroll() {
  _scrolling = true;
  _clearActive();
  _stopTimer();
  clearTimeout(_scrollEndTimer);
  _scrollEndTimer = setTimeout(() => { _scrolling = false; refreshHints(); }, 150);
}

let _mo = null;
let _refreshTimer = null;
function _scheduleRefresh() {
  if (_refreshTimer) return;
  _refreshTimer = setTimeout(() => { _refreshTimer = null; refreshHints(); }, 50);
}

export function initHintRotation() {
  if (_started) return;
  _started = true;
  document.addEventListener('visibilitychange', refreshHints);
  window.addEventListener('scroll', _onScroll, { passive: true });
  // Catch overlays opening/closing (class/`open`/popover-node changes) without
  // wiring every call site. Debounced; refreshHints never mutates hint DOM except
  // to clear, so this can't loop.
  _mo = new MutationObserver(_scheduleRefresh);
  _mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'open'], childList: true });
  refreshHints();
}

export function stopHintRotation() {
  document.removeEventListener('visibilitychange', refreshHints);
  window.removeEventListener('scroll', _onScroll);
  if (_mo) { _mo.disconnect(); _mo = null; }
  clearTimeout(_scrollEndTimer); _scrollEndTimer = null;
  clearTimeout(_refreshTimer); _refreshTimer = null;
  _resetEngineForTest();
}
