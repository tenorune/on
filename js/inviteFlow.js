// js/inviteFlow.js — the single invite entry point (spec §4).
// Layer 1: link construction — pure, build-time-configured, works on web too
// (a future web "Share to Telegram" affordance costs one caller, spec §4).
// Layer 2: per-surface share presentation (TG share sheet; web keeps the modal).
import { openTelegramShare } from './telegram.js';

// esbuild `define` injects this; '' when the env var is unset (never REPLACE_ME).
const TELEGRAM_APP_LINK = process.env.TELEGRAM_APP_LINK || '';

// t.me Mini App deep link carrying the invite token as start_param.
// Null when unconfigured or tokenless — callers fall back to invite.url.
export function buildTelegramInviteLink(token) {
  if (!TELEGRAM_APP_LINK || !token) return null;
  return `${TELEGRAM_APP_LINK}?startapp=${token}`;
}

// Open Telegram's share sheet for an invite, preferring the Mini App deep link.
export function shareInviteLink(invite, text = 'Follow me on KnockKnock') {
  const url = buildTelegramInviteLink(invite.token) || invite.url;
  openTelegramShare(url, text);
}
