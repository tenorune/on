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

const DISMISS_KEY = 'statusapp_tg_onramp_dismissed';
function bannerDismissed() {
  try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
}
function dismissBanner() {
  try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* quota */ }
}

let _linked = false;
function refresh() {
  const promo = document.getElementById('tg-onramp-promo');
  const card = document.getElementById('drawer-section-tg-onramp');
  const show = telegramOnrampEnabled() && !_linked;
  card?.classList.toggle('hidden', !show);
  promo?.classList.toggle('hidden', !(show && !bannerDismissed()));
}

export function initTelegramOnramp() {
  const promo = document.getElementById('tg-onramp-promo');
  const card = document.getElementById('drawer-section-tg-onramp');
  if (!promo && !card) return;
  const go = async (btn) => {
    if (btn) btn.disabled = true;
    try { await startTelegramOnramp(); } finally { if (btn) btn.disabled = false; }
  };
  document.getElementById('tg-onramp-action')?.addEventListener('click', (e) => go(e.currentTarget));
  document.getElementById('tg-onramp-drawer-btn')?.addEventListener('click', (e) => go(e.currentTarget));
  document.getElementById('tg-onramp-dismiss')?.addEventListener('click', () => {
    dismissBanner();
    promo?.classList.add('hidden');
  });
  refresh();
}

// Suppress once this account is linked to Telegram (prefs.telegram set). Rides
// the watchUserPrefs tick — mirrors notifySuppression's `prefs.telegram != null`.
export function syncTelegramOnramp(serverPrefs) {
  _linked = serverPrefs?.telegram != null;
  refresh();
}
