// @ts-check
// js/inviteFlow.js — the single invite entry point (spec §4).
// Layer 1: link construction — pure, build-time-configured, works on web too.
// Layer 2: per-surface share presentation (TG share sheet; web new-tab intent).
import { openTelegramShare, buildTelegramShareUrl } from './telegram.js';
import { TELEGRAM_ENABLED } from './features.js';

// esbuild `define` injects this; '' when the env var is unset (never REPLACE_ME).
const TELEGRAM_APP_LINK = process.env.TELEGRAM_APP_LINK || '';

// The one place a t.me Mini App deep link is assembled (C4): any start_param —
// a bare invite token, or the onramp's `lk_`-prefixed link token. Null when
// unconfigured or paramless so callers can fall back. telegramOnramp.js builds
// on this rather than re-reading TELEGRAM_APP_LINK itself.
/**
 * @param {string | null | undefined} param
 * @returns {string | null}
 */
export function buildStartAppLink(param) {
  if (!TELEGRAM_APP_LINK || !param) return null;
  return `${TELEGRAM_APP_LINK}?startapp=${param}`;
}

// t.me Mini App deep link carrying the invite token as start_param.
// Null when unconfigured or tokenless — callers fall back to invite.url.
/**
 * @param {string | null | undefined} token
 * @returns {string | null}
 */
export function buildTelegramInviteLink(token) {
  return buildStartAppLink(token);
}

// Whether web builds may surface Telegram share affordances (spec §4 gate): the
// flag is on AND a Mini App deep link is configured — otherwise a pre-launch
// `main` would emit links to a not-yet-live bot.
export function telegramSharingEnabled() {
  return TELEGRAM_ENABLED && !!TELEGRAM_APP_LINK;
}

// The ONLY place share captions are spelled (W3-B CL#12) — W4's copy sweep has
// one string per caption to touch. A scopeless invite (e.g. a freshly minted
// { token, url }) reads as personal, matching the old per-function defaults.
/**
 * @param {string | undefined} scope
 * @param {string | undefined} [groupName]
 * @returns {string}
 */
export function shareCaption(scope, groupName) {
  return scope === 'group' ? `Join ${groupName} on KnockKnock` : 'Follow me on KnockKnock';
}

// Open Telegram's share sheet for an invite, preferring the Mini App deep link.
/**
 * @typedef {{ token?: string, url?: string, scope?: string, groupName?: string }} InviteLike
 */
/**
 * @param {InviteLike} invite
 * @param {string} [text]
 */
export function shareInviteLink(invite, text = shareCaption(invite.scope, invite.groupName)) {
  const url = buildTelegramInviteLink(invite.token) || invite.url;
  openTelegramShare(url, text);
}

// Web "Share to Telegram": open the t.me share intent in a new tab carrying the
// Mini App deep link, so the recipient lands straight in the Mini App. Returns
// false when unconfigured (no deep link) or the popup is blocked — the caller
// can then fall back to copying the link.
/**
 * @param {InviteLike} invite
 * @param {string} [text]
 * @returns {boolean}
 */
export function shareInviteToTelegramWeb(invite, text = shareCaption(invite.scope, invite.groupName)) {
  const deepLink = buildTelegramInviteLink(invite.token);
  if (!deepLink || typeof window === 'undefined' || !window.open) return false;
  // No platform arg: the recipient's client is unknown from the web, so the
  // builder uses the separated (non-iOS) form — same output as before.
  return !!window.open(buildTelegramShareUrl(deepLink, text), '_blank', 'noopener');
}
