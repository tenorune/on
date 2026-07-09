// js/telegramOnramp.js — web-only "Use in Telegram" onramp: mint a single-use
// link token for THIS (authed) account and open the Mini App deep link so it
// auto-links. The phrase never travels. Suppressed once the account is linked.
import { TELEGRAM_ENABLED } from './features.js';
import { isTelegramContext } from './telegram.js';
import { callMintTelegramLinkToken } from './firebase-config.js';

const TELEGRAM_APP_LINK = process.env.TELEGRAM_APP_LINK || '';

export function telegramOnrampEnabled() {
  return TELEGRAM_ENABLED && !!TELEGRAM_APP_LINK && !isTelegramContext();
}

export function buildLinkDeepLink(token) {
  if (!TELEGRAM_APP_LINK || !token) return null;
  return `${TELEGRAM_APP_LINK}?startapp=lk_${token}`;
}

// Fresh token every call (no caching): if the user backs out, it just expires.
export async function startTelegramOnramp() {
  const { token } = await callMintTelegramLinkToken();
  const url = buildLinkDeepLink(token);
  if (!url) return false;
  const win = window.open(url, '_blank');
  return !!win;
}
