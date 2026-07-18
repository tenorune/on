// shared/geo.js — distance math + formatters, ONE copy for web + functions.
// Consumed by js/ directly (../shared/…) and by functions/ via the committed
// byte-identical mirror functions/_shared/ (npm run sync-shared — never edit
// the mirror by hand). Behavior pinned by test-fixtures/geo-vectors.json in
// both suites.
//
// snapToCell quantizes to a 0.01° grid (~1.1 km lat, ≤1.1 km lng) BEFORE a
// coarse-tier write, so locationCells/ data is structurally incapable of
// sub-kilometer precision — the "<1 km" floor is enforced by what's stored,
// not by what's displayed.

const EARTH_RADIUS_M = 6371000;
const SNAP_DEG = 0.01;

/** @param {number} deg @returns {number} */
function toRad(deg) { return (deg * Math.PI) / 180; }

/** Great-circle distance in meters.
 * @param {number} lat1 @param {number} lng1 @param {number} lat2 @param {number} lng2
 * @returns {number} */
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/** Quantize a point to the coarse grid.
 * @param {number} lat @param {number} lng @returns {{ lat: number, lng: number }} */
export function snapToCell(lat, lng) {
  return {
    lat: Math.round(lat / SNAP_DEG) * SNAP_DEG,
    lng: Math.round(lng / SNAP_DEG) * SNAP_DEG,
  };
}

/** Precise-tier text: "120 m" / "2.3 km" / "23 km".
 * @param {number} m @returns {string} */
export function formatDistancePrecise(m) {
  if (m < 1000) return `${Math.round(m)} m`;
  const km = m / 1000;
  if (km < 9.95) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

/** Coarse-tier text: "<1 km away" / "~3 km".
 * @param {number} m @returns {string} */
export function formatDistanceCoarse(m) {
  if (m < 1000) return '<1 km away';
  return `~${Math.round(m / 1000)} km`;
}
