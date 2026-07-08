// js/inviteFlow.js — the single invite entry point (spec §4).
// Layer 1: link construction — pure, build-time-configured, works on web too.
// Layer 2: per-surface share presentation (TG share sheet; web new-tab intent).
import { openTelegramShare, buildTelegramShareUrl } from './telegram.js';
import { TELEGRAM_ENABLED } from './features.js';

// esbuild `define` injects this; '' when the env var is unset (never REPLACE_ME).
const TELEGRAM_APP_LINK = process.env.TELEGRAM_APP_LINK || '';

// t.me Mini App deep link carrying the invite token as start_param.
// Null when unconfigured or tokenless — callers fall back to invite.url.
export function buildTelegramInviteLink(token) {
  if (!TELEGRAM_APP_LINK || !token) return null;
  return `${TELEGRAM_APP_LINK}?startapp=${token}`;
}

// Whether web builds may surface Telegram share affordances (spec §4 gate): the
// flag is on AND a Mini App deep link is configured — otherwise a pre-launch
// `main` would emit links to a not-yet-live bot.
export function telegramSharingEnabled() {
  return TELEGRAM_ENABLED && !!TELEGRAM_APP_LINK;
}

// The builder lives with the platform knowledge in telegram.js (W3-A CL#5);
// re-exported here for existing importers.
export { buildTelegramShareUrl } from './telegram.js';

// Open Telegram's share sheet for an invite, preferring the Mini App deep link.
export function shareInviteLink(invite, text = 'Follow me on KnockKnock') {
  const url = buildTelegramInviteLink(invite.token) || invite.url;
  openTelegramShare(url, text);
}

// Web "Share to Telegram": open the t.me share intent in a new tab carrying the
// Mini App deep link, so the recipient lands straight in the Mini App. Returns
// false when unconfigured (no deep link) or the popup is blocked — the caller
// can then fall back to copying the link.
export function shareInviteToTelegramWeb(invite, text = 'Follow me on KnockKnock') {
  const deepLink = buildTelegramInviteLink(invite.token);
  if (!deepLink || typeof window === 'undefined' || !window.open) return false;
  // No platform arg: the recipient's client is unknown from the web, so the
  // builder uses the separated (non-iOS) form — same output as before.
  return !!window.open(buildTelegramShareUrl(deepLink, text), '_blank', 'noopener');
}
