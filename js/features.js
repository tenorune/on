// @ts-check
// js/features.js
export const PALETTES_ENABLED = true;
export const PALETTE_INTERACTIONS_ENABLED = true;
export const KNOCK_ENABLED = true;
export const CALL_ENABLED = true;
export const GROUPS_ENABLED = true; // Phase 1 gates group-scope UI behind this; flip to true at deploy time.
export const NOTIFICATIONS_ENABLED = true; // Plan 1/2 gate; live — see spec §13 pre-flag-on items (FCM delivery verification).
export const FOLLOW_REQUESTS_ENABLED = true; // Groups §11: request-to-follow a co-member.
export const NOTIFY_DEBUG = false; // #156 push-debug readout. Off by default; also opt-in at runtime via ?notifydebug=1.
export const TELEGRAM_ENABLED = true; // Experimental Telegram Mini App + bot. TRUE on the feature branch only; flip to false at merge. Spec: docs/superpowers/specs/2026-07-02-telegram-adaptation-design.md
