// shared/timeFormat.js — the time-remaining formatters, ONE copy for web +
// functions. Consumed by js/ directly (../shared/…) and by functions/ via the
// committed byte-identical mirror functions/_shared/ (npm run sync-shared —
// never edit the mirror by hand). Behavior pinned by
// test-fixtures/time-format-vectors.json in both suites.
//
// Both formatters return a bare duration PHRASE with no trailing " left" —
// the caller owns that suffix (e.g. `formatTimeRemaining(ms) + ' left'` for a
// precise countdown, or `Available for ${formatTimeRemainingFuzzy(ms)}` for
// the fuzzy roster text). Keeping the suffix out of the helpers means no call
// site has to strip it back off.
/** @param {number} ms @returns {string} */
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
/** @param {number} n @returns {string} */
function hourWord(n) { return HOUR_WORDS[n] ?? String(n); }

// Fuzzy AGE phrase for "last updated X ago" copy (Telegram bot beacon nudge).
// Bare phrase like the two above — the caller owns the " ago" suffix. Floors
// on purpose ("1 hour ago" at 1h59m): an age nudge should understate, never
// claim more staleness than has elapsed. <1 min (incl. 0/negative clock skew)
// reads "moments".
/** @param {number} ms @returns {string} */
export function formatAgeFuzzy(ms) {
  if (ms < 60000) return 'moments';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  const hours = Math.floor(ms / 3600000);
  if (hours < 48) return hours === 1 ? '1 hour' : `${hours} hours`;
  return `${Math.floor(ms / 86400000)} days`;
}

/** @param {number} ms @returns {string} */
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
