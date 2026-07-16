// shared/limits.js — the 40-char display-name / label cap, ONE copy for web +
// functions. database.rules.json spells the same cap and cannot import JS —
// tests/name-cap-invariant.test.js pins the two to each other. Cap rationale
// (#164 R3b): comfortably exceeds what a notification shows; a longer client
// cap than the rules would make cosmetic followerNames writes silently fail.
export const NAME_CAP = 40;

// Cap for labels used in transient output (FCM titles): hard slice.
/** @type {(s: unknown) => string} */
export const clampLabel = (s) => String(s ?? '').slice(0, NAME_CAP);

// Trimming variant for labels that get STORED (group display names, redeemer
// names): slice then trim, so a cut mid-whitespace doesn't keep a dangling
// space. NOTE js/telegram.js telegramFirstName deliberately does NOT use this
// (it trims before slicing — per-surface behavior, same cap).
/** @type {(s: unknown) => string} */
export const clampName = (s) => clampLabel(s).trim();
