// js/db.js — barrel for the Firebase data layer.
// The implementation lives in focused modules; this file re-exports them so the
// public API ('./db.js') stays stable for every importer and test mock. The
// pure time/presence helpers (isExpired/isAvailable/formatters) moved to
// utils.js — re-exported here for back-compat with existing `from './db.js'`
// imports.
export {
  isExpired, isAvailable, timeRemainingMs,
  formatTimeRemaining, formatTimeRemainingFuzzy, formatLastSeen,
} from './utils.js';

export * from './db/social.js';
export * from './db/groups.js';
export * from './db/canvas.js';
