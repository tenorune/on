// functions/presence-core.js — pure, dependency-free decision logic.

export function isExpired(availableUntil, now) {
  return availableUntil != null && availableUntil < now;
}

export function isAvailable(node, now) {
  return !!node && node.status === 'available' && !isExpired(node.availableUntil, now);
}

export function becameAvailable(before, after, now) {
  return !isAvailable(before, now) && isAvailable(after, now);
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
