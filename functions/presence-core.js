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

// Time-remaining formatters live in shared/timeFormat.js, consumed here via
// the committed mirror functions/_shared/ (npm run sync-shared — never edit
// the mirror by hand). Re-exported so telegram.js and the tests keep
// importing from presence-core.
export { formatTimeRemaining, formatTimeRemainingFuzzy } from './_shared/timeFormat.js';

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

// Quantizes a status-color hex to a single Telegram circle emoji. Fallback
// for missing/invalid input is 🟢. Operator-reviewed against all 92 status-
// color swatches (B#14b) — thresholds are pinned, do not "improve" them.
export function statusCircle(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '🟢';
  const r = parseInt(m[1].slice(0, 2), 16), g = parseInt(m[1].slice(2, 4), 16), b = parseInt(m[1].slice(4, 6), 16);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2 / 255;
  if (d < 30) return l > 0.82 ? '⚪' : l < 0.18 ? '⚫' : '⚪';
  let h; if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
  h *= 60; if (h < 0) h += 360;
  if (l < 0.28 && h >= 18 && h <= 45) return '🟤';
  if (h < 15 || h >= 340) return '🔴';
  if (h < 45) return '🟠';
  if (h < 68) return '🟡';
  if (h < 170) return '🟢';
  if (h < 250) return '🔵';
  if (h < 292) return '🟣';
  return '🔴'; // magenta folds to red
}
