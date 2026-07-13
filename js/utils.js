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
// NOTE: the server's functions/presence-core.js primaryAvailable deliberately
// differs on null availableUntil (open-ended reads available here, not there)
// — parity pinned in tests/presencePredicateParity.test.js; don't unify blind.
export function isAvailable(status, availableUntil) {
  return status === 'available' && !isExpired(availableUntil);
}

export function timeRemainingMs(availableUntil) {
  if (!availableUntil) return 0;
  return Math.max(0, availableUntil - Date.now());
}

// Time-remaining formatters live in shared/timeFormat.js — one copy for web +
// functions (mirrored into functions/_shared/; see scripts/sync-shared.js).
// Imported (not just re-exported) because availableForText below uses the
// fuzzy formatter locally; exported so call sites and tests keep importing
// from utils.
import { formatTimeRemaining, formatTimeRemainingFuzzy } from '../shared/timeFormat.js';
export { formatTimeRemaining, formatTimeRemainingFuzzy };

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

