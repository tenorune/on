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

// Is the group override itself an "available" signal right now?
export function overrideAvailable(override, now) {
  return !!(override && override.enabled === true
    && override.status === 'available' && isFutureMs(override.availableUntil, now));
}

// A member's EFFECTIVE in-group availability: their override when enabled,
// otherwise their primary status. Mirrors what the group roster shows.
export function effectiveAvailable(override, primaryStatus, primaryAU, now) {
  if (override && override.enabled === true) return overrideAvailable(override, now);
  return primaryStatus === 'available' && isFutureMs(primaryAU, now);
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

export function buildMessage(type, name, opts = {}) {
  const n = clampLabel(name);
  const title = opts.group ? GROUP_TITLES[type](n, clampLabel(opts.group)) : TITLES[type](n);
  return { title, body: '' };
}
