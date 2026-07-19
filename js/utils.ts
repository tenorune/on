// js/utils.ts

// Busy/idle feedback for a primary action button while an async round-trip runs
// (restore verification, new-account setup). Disabling it both dims the button
// via the existing `.primary-btn:disabled` opacity rule and blocks double-taps;
// the label swaps to a progress word. The idle label is stashed on first use so
// clearButtonBusy restores whatever the markup shipped, and a re-open starts clean.
export function setButtonBusy(btn: HTMLButtonElement | null | undefined, busyText: string) {
  if (!btn) return;
  // Cast: an element's textContent is never null (only document/doctype's is).
  if (btn.dataset.idleLabel === undefined) btn.dataset.idleLabel = btn.textContent as string;
  btn.textContent = busyText;
  btn.disabled = true;
}
export function clearButtonBusy(btn: HTMLButtonElement | null | undefined) {
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
export async function copyWithFeedback(
  btn: HTMLElement,
  text: string,
  { done = 'Copied!', idle = 'Copy' }: { done?: string; idle?: string } = {},
) {
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
export function resolveDisplayName(
  entry: { label?: string | null; code?: string | null } | null | undefined,
): string {
  return (entry && (entry.label || entry.code)) || '';
}

export function escapeHtml(str: unknown): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function safeCssColor(v: unknown): string {
  if (typeof v === 'string' && (/^#[0-9a-fA-F]{3,8}$/.test(v) || /^rgba?\([\d\s,.%]+\)$/.test(v))) return v;
  return 'transparent';
}

export function hexToRgb(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '0, 0, 0';
  return `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}`;
}

// ── Time / presence formatting (pure; were in db.js) ─────────────────────────
export function isExpired(availableUntil: number | null | undefined): boolean {
  if (availableUntil === null || availableUntil === undefined) return false;
  return availableUntil < Date.now();
}

// Single source of truth for "is this presence effectively available right now":
// status is 'available' AND its window hasn't lapsed (null availableUntil = no
// expiry). Replaces ~10 inline reimplementations that had drifted into two forms.
// NOTE: server functions/presence-core.js primaryAvailable differs on null/absent
// availableUntil (open-ended reads available here, not there). That input is
// UNREACHABLE — no writer emits it, prod audited clean 2026-07-14 — so the two
// agree on every reachable input and are intentionally NOT unified (fail-open in
// the UI here vs fail-closed on notifications there). Tripwire + full rationale:
// tests/presencePredicateParity.test.js.
export function isAvailable(
  status: string | null | undefined,
  availableUntil: number | null | undefined,
): boolean {
  return status === 'available' && !isExpired(availableUntil);
}

export function timeRemainingMs(availableUntil: number | null | undefined): number {
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

export function formatLastSeen(lastSeenMs: number | null | undefined): string | null {
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
export function availableForText(availableUntil: number | null | undefined): string {
  const remaining = availableUntil ? formatTimeRemainingFuzzy(timeRemainingMs(availableUntil)) : '';
  return remaining ? `Available for ${remaining}` : 'Available';
}

// The distance suffix on a status line, as a wrap-as-a-UNIT fragment: the
// ' · ' separator and the distance live in one nowrap span, so a narrow card
// moves the whole thing to the next line — never "<1 km" / "away" split
// mid-fragment. When it does wrap, reconcileDistanceWrap (below) marks it to
// take its own line with the separator hidden (operator call: a wrapped
// distance line carries no dot). Escaped — formatDistanceCoarse emits "<1".
export function distanceFragmentHtml(distanceText: string): string {
  return `<span class="loc-frag"><span class="loc-sep"> · </span><span class="loc-dist">${escapeHtml(distanceText)}</span></span>`;
}

// Post-paint measure for the fragment above: if it landed below its
// container's first line, .loc-wrapped puts it on its own line
// (display:block) and hides the separator. Measured with the class REMOVED
// first so a stale mark from a longer previous paint clears itself; the
// block display then prevents fit oscillation between the with-dot and
// without-dot widths. jsdom rects are all zero, so tests never mark —
// device layout is the arbiter. Call after every innerHTML paint of a
// status line that may carry the fragment (no-op without one).
export function reconcileDistanceWrap(statusEl: HTMLElement): void {
  const frag = statusEl.querySelector('.loc-frag') as HTMLElement | null;
  if (!frag) return;
  frag.classList.remove('loc-wrapped');
  const containerTop = statusEl.getBoundingClientRect().top;
  const rect = frag.getBoundingClientRect();
  if (rect.top - containerTop >= (rect.height || 16) * 0.5) frag.classList.add('loc-wrapped');
}

