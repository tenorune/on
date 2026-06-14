// js/featureOverrides.js
// Dependency-free localStorage store for per-user feature toggle overrides.
// Read at module-eval by js/features.js (must stay import-light) and at write
// time by js/prefs.js. Shape: { [featureKey]: boolean } where the value is the
// user's desired ENABLED state. A missing key means "use the build default".
// Only the literal false disables. The key is NOT uid-scoped — consistent with
// the other prefs.js localStorage caches; syncFromServer overwrites it for the
// current account.
const KEY = 'statusapp_feature_overrides';

export function readOverrides() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
  catch { return {}; }
}

export function writeOverride(key, enabled) {
  const ov = readOverrides();
  ov[key] = !!enabled;
  try { localStorage.setItem(KEY, JSON.stringify(ov)); }
  catch { /* quota — best effort */ }
}
