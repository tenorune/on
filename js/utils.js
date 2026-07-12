// js/utils.js

// Busy/idle feedback for a primary action button while an async round-trip runs
// (restore verification, new-account setup). Disabling it both dims the button
// via the existing `.primary-btn:disabled` opacity rule and blocks double-taps;
// the label swaps to a progress word. The idle label is stashed on first use so
// clearButtonBusy restores whatever the markup shipped, and a re-open starts clean.
export function setButtonBusy(btn, busyText) {
  if (!btn) return;
  if (btn.dataset.idleLabel === undefined) btn.dataset.idleLabel = btn.textContent;
  btn.textContent = busyText;
  btn.disabled = true;
}
export function clearButtonBusy(btn) {
  if (!btn) return;
  if (btn.dataset.idleLabel !== undefined) btn.textContent = btn.dataset.idleLabel;
  btn.disabled = false;
}

// Copy-to-clipboard with transient button feedback (W3-B CL#10): label → `done`,
// reverted to `idle` after 1.5s. A denied/failed/missing clipboard changes
// nothing — silent, like every call site before consolidation. No timer dedup:
// rapid re-taps queue reverts, same as the inlined blocks did. (mycode.js's
// recovery pill keeps its bespoke block — its copied-timer chains into the
// reveal panel's idle state machine.)
export async function copyWithFeedback(btn, text, { done = 'Copied!', idle = 'Copy' } = {}) {
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    return; // clipboard denied/blocked — no feedback, matching prior behavior
  }
  if (!navigator.clipboard) return; // no API at all: writeText never ran
  btn.textContent = done;
  setTimeout(() => { btn.textContent = idle; }, 1500);
}

// Display name for a following entry ({ label, code }): the user's chosen label,
// else the share code. Returns '' (not undefined) for a missing/empty entry so
// it never renders "undefined" in a template.
export function resolveDisplayName(entry) {
  return (entry && (entry.label || entry.code)) || '';
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function safeCssColor(v) {
  if (typeof v === 'string' && (/^#[0-9a-fA-F]{3,8}$/.test(v) || /^rgba?\([\d\s,.%]+\)$/.test(v))) return v;
  return 'transparent';
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '0, 0, 0';
  return `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}`;
}

// ── Time / presence formatting (pure; were in db.js) ─────────────────────────
export function isExpired(availableUntil) {
  if (availableUntil === null || availableUntil === undefined) return false;
  return availableUntil < Date.now();
}

// Single source of truth for "is this presence effectively available right now":
// status is 'available' AND its window hasn't lapsed (null availableUntil = no
// expiry). Replaces ~10 inline reimplementations that had drifted into two forms.
export function isAvailable(status, availableUntil) {
  return status === 'available' && !isExpired(availableUntil);
}

export function timeRemainingMs(availableUntil) {
  if (!availableUntil) return 0;
  return Math.max(0, availableUntil - Date.now());
}

// DUPLICATED in functions/presence-core.js — keep byte-identical (shared fixture: test-fixtures/time-format-vectors.json).
// Both time-remaining formatters return a bare duration PHRASE with no trailing
// " left" — the caller owns that suffix (e.g. `formatTimeRemaining(ms) + ' left'`
// for a precise countdown, or `Available for ${formatTimeRemainingFuzzy(ms)}` for
// the fuzzy roster text). Keeping the suffix out of the helpers means no call site
// has to strip it back off.
export function formatTimeRemaining(ms) {
  if (ms <= 0) return '';
  if (ms < 60000) return '< 1m';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

const HOUR_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
function hourWord(n) { return HOUR_WORDS[n] ?? String(n); }

export function formatTimeRemainingFuzzy(ms) {
  if (ms <= 0) return '';
  const minutes = ms / 60000;
  const hours = ms / 3600000;
  if (minutes < 5) return 'just a few minutes';
  if (minutes < 20) return 'about 15 minutes';
  if (minutes < 45) return 'about half an hour';
  if (minutes < 75) return 'about an hour';
  if (minutes < 120) return 'one to two hours';
  const floor = Math.floor(hours);
  const frac = hours - floor;
  if (frac < 0.25) return `just over ${hourWord(floor)} hours`;
  if (frac >= 0.75) return `nearly ${hourWord(floor + 1)} hours`;
  return `about ${hourWord(Math.round(hours))} hours`;
}

export function formatLastSeen(lastSeenMs) {
  if (lastSeenMs == null) return null;
  const elapsed = Date.now() - lastSeenMs;
  const days = elapsed / (24 * 60 * 60 * 1000);
  if (days < 7) return null;
  if (days < 14) return 'over a week ago';
  if (days < 28) return 'over two weeks ago';
  return 'over a month ago';
}

// Shared "Available for …" label for the Direct list + group roster. Open-ended
// availability (null availableUntil) reads just "Available"; a timed window reads
// "Available for <fuzzy time>". Callers own the surrounding span/color.
export function availableForText(availableUntil) {
  const remaining = availableUntil ? formatTimeRemainingFuzzy(timeRemainingMs(availableUntil)) : '';
  return remaining ? `Available for ${remaining}` : 'Available';
}

