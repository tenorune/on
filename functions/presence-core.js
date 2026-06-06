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

const TITLES = {
  knock: (name) => `${name} knocked`,
  call: (name) => `${name} is calling`,
  availability: (name) => `${name} is available`,
};

export function buildMessage(type, name) {
  return { title: TITLES[type](name), body: '' };
}
