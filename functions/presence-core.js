// functions/presence-core.js — pure, dependency-free decision logic.

// A valid (numeric, future) availableUntil. null/absent/expired are all "not future".
export function isFutureMs(v, now) {
  return typeof v === 'number' && v > now;
}

// Availability "turned on" — the narrowed trigger watches users/{uid}/availableUntil,
// so we reason from its before/after value plus the current status. Fires only when
// availableUntil goes from not-future (null/absent/expired) to future AND status is
// 'available'. (Going unavailable always clears availableUntil to null, so a real
// off→on always changes availableUntil.) Assumes available state always carries a
// future availableUntil — true for the app's timed-availability model.
export function availabilityTurnedOn(beforeAU, afterAU, status, now) {
  return status === 'available' && isFutureMs(afterAU, now) && !isFutureMs(beforeAU, now);
}

export function withinCooldown(lastTs, now, cooldownMs) {
  return lastTs != null && (now - lastTs) < cooldownMs;
}

export function wantsKnock(prefs) { return !!(prefs && prefs.knock); }
export function wantsCall(prefs) { return !!(prefs && prefs.call); }
export function wantsAvailability(prefs) { return !!(prefs && prefs.availability); }

// Is the group override itself an "available" signal right now? Same
// status/availableUntil predicate as primaryAvailable, gated on enabled.
export function overrideAvailable(override, now) {
  return !!(override && override.enabled === true && primaryAvailable(override, now));
}

// A member's EFFECTIVE in-group availability: their override when enabled,
// otherwise their primary status. Mirrors what the group roster shows.
export function effectiveAvailable(override, primaryStatus, primaryAU, now) {
  if (override && override.enabled === true) return overrideAvailable(override, now);
  return primaryAvailable({ status: primaryStatus, availableUntil: primaryAU }, now);
}

// "Globally available right now" over a whole presence (or override) node —
// the same predicate as effectiveAvailable's no-override fallback, taken as
// the object so callers holding users/{uid}/presence don't re-inline it.
export function primaryAvailable(presence, now) {
  return presence?.status === 'available' && isFutureMs(presence.availableUntil, now);
}

// DUPLICATED in js/utils.js — keep byte-identical (shared fixture: test-fixtures/time-format-vectors.json).
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

const TITLES = {
  knock: (name) => `${name} knocked`,
  call: (name) => `${name} is calling`,
  availability: (name) => `${name} is available`,
  invite: (name) => `${name} invited you to a group`,
  followRequest: (name) => `${name} wants to follow you`,
};

const GROUP_TITLES = {
  knock: (name, group) => `${name} knocked in ${group}`,
  call: (name, group) => `${name} is calling in ${group}`,
  availability: (name, group) => `${name} is available in ${group}`,
  invite: (name, group) => `${name} invited you to ${group}`,
};

// Cap user-controlled labels so a 500-char display name / group name can't
// produce an oversized FCM title (lock-screen truncation / payload bloat). 40
// chars comfortably exceeds what's visible on a notification (#164 R3b).
const LABEL_MAX = 40;
const clampLabel = (s) => String(s ?? '').slice(0, LABEL_MAX);

// Trimming variant for labels that get STORED (group display names, etc.), so
// a name that is cut mid-whitespace doesn't keep a dangling space. Same cap as
// buildMessage's clampLabel — one constant, can't half-apply (telegram.js used
// to re-implement this).
export const clampName = (s) => clampLabel(s).trim();

export function buildMessage(type, name, opts = {}) {
  const n = clampLabel(name);
  const title = opts.group ? GROUP_TITLES[type](n, clampLabel(opts.group)) : TITLES[type](n);
  return { title, body: '' };
}
