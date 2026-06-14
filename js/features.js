// js/features.js
//
// Build-time defaults, narrowed by per-user runtime overrides read at
// module-eval from js/featureOverrides.js. A user can only DISABLE a
// build-enabled feature (the buildDefault && ... short-circuit), never enable
// a build-disabled one. Overrides are evaluated once per page load — toggling
// applies on reload (see docs/superpowers/specs/2026-06-14-user-feature-toggles-design.md).
//
// Only 'palettes' and 'groups' are currently user-controllable; the rest are
// pure build constants. Keep this file import-light: featureOverrides.js is
// dependency-free on purpose.
import { readOverrides } from './featureOverrides.js';

const ov = readOverrides();
const eff = (buildDefault, key) => buildDefault && ov[key] !== false;

export const PALETTES_ENABLED             = eff(true, 'palettes');
export const PALETTE_INTERACTIONS_ENABLED = eff(true, 'palettes');
export const KNOCK_ENABLED                = true;
export const CALL_ENABLED                 = true;
export const GROUPS_ENABLED               = eff(true, 'groups');
export const NOTIFICATIONS_ENABLED        = true;
export const FOLLOW_REQUESTS_ENABLED      = true;
export const NOTIFY_DEBUG                 = false; // #156 — also opt-in via ?notifydebug=1
