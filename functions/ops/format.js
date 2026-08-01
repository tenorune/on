// functions/ops/format.js — presentation helpers for the panel. Pure, and
// deliberately NOT inside panel.html.
//
// panel.html is served as one static file with no bundler, so nothing in it can
// be imported by a test — it is the one part of the panel with no unit
// coverage, which is why the smoke test exists. Anything with a rule in it
// therefore lives out here and reaches the page as a preformatted string; the
// page renders, it does not decide.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A span of milliseconds as something an operator can read at a glance.
 *
 * Raw minutes stop being useful within a few hours, and the accounts table is
 * scanned to judge whether an account is live or dead — "22145m" is arithmetic
 * homework, "15d 8h" is an answer. Sub-minute reads `<1m` rather than `0m`,
 * which would claim more precision than "just now" deserves.
 *
 * @param {number} ms a non-negative span
 * @returns {string}
 */
export function humanDuration(ms) {
  const span = Math.max(0, ms);
  if (span < MINUTE) return '<1m';
  if (span < HOUR) return `${Math.floor(span / MINUTE)}m`;
  if (span < DAY) return `${Math.floor(span / HOUR)}h ${Math.floor((span % HOUR) / MINUTE)}m`;
  return `${Math.floor(span / DAY)}d ${Math.floor((span % DAY) / HOUR)}h`;
}

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
