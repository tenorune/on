// functions/ops/format.js — presentation helpers for the panel. Pure, and
// deliberately NOT inside panel.html.
//
// panel.html is served as one static file with no bundler, so nothing in it can
// be imported by a test — it is the one part of the panel with no unit
// coverage, which is why the smoke test exists. Anything with a rule in it
// therefore lives out here and reaches the page as a preformatted string; the
// page renders, it does not decide.

// Duration formatting has ONE home — shared/timeFormat.js, consumed here via
// the committed mirror functions/_shared/ (npm run sync-shared; never edit the
// mirror by hand) and pinned on both sides by
// test-fixtures/time-format-vectors.json. Re-exported so the panel's callers
// import their formatting from one place.
import { humanDuration } from '../_shared/timeFormat.js';

export { humanDuration };

/**
 * A timestamp as an age relative to `now`.
 *
 * A FUTURE timestamp is rendered as "in …" rather than clamped to zero. A
 * createdAt or lastSeen ahead of the clock is a data problem, and this panel
 * exists to surface data problems — flattening it into "<1m ago" would hide
 * the one reading worth looking at twice.
 *
 * @param {unknown} ts epoch milliseconds, or anything else
 * @param {number} now
 * @returns {string}
 */
export function agoLabel(ts, now) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return '—';
  return ts > now ? `in ${humanDuration(ts - now)}` : `${humanDuration(now - ts)} ago`;
}

/**
 * What the status column prints, and the title that explains it.
 *
 * The stored `status` string is not the answer to "is this account available".
 * Availability is timed: the app writes 'available' together with an
 * availableUntil and never rewrites the string when that moment passes, so an
 * account dormant for a fortnight keeps reading 'available' forever. Printing
 * it raw is what made the panel claim a table full of live accounts.
 *
 * Three cases are kept distinct rather than collapsed, because an operator
 * about to purge an account needs to tell them apart:
 *   - available          — a window that is open right now
 *   - expired            — stored 'available', window closed; title says when
 *   - available (no window) — stored 'available' with no availableUntil at all.
 *     Neither of the above is true. integrity.js reports this as an
 *     `available-without-until` error, and the row must not disguise it.
 *
 * @param {string | null} status the stored presence status
 * @param {number | null} availableUntil
 * @param {boolean} available the pinned predicate's answer
 * @param {number} now
 * @returns {{ statusLabel: string, statusTitle: string | null }}
 */
export function statusLabelling(status, availableUntil, available, now) {
  if (available) return { statusLabel: 'available', statusTitle: null };
  if (status !== 'available') return { statusLabel: status || '—', statusTitle: null };
  if (availableUntil === null) {
    return {
      statusLabel: 'available (no window)',
      statusTitle: 'stored status is "available" with no availableUntil — see the integrity report',
    };
  }
  return {
    statusLabel: 'expired',
    statusTitle: `stored status is "available"; the window ended ${agoLabel(availableUntil, now)}`,
  };
}
