// js/telegramOnramp.js — web-only "Use in Telegram" onramp: mint a single-use
// link token for THIS (authed) account and open the Mini App deep link so it
// auto-links. The phrase never travels. Suppressed once the account is linked.
import { isTelegramContext } from './telegram.js';
import { callMintTelegramLinkToken } from './firebase-config.js';
import { buildStartAppLink, telegramSharingEnabled } from './inviteFlow.js';
import { showToast } from './groups.js';
import { isFirstRunActive } from './firstRun.js';

// Same gate as web invite sharing, plus: never on the Telegram surface itself
// (there the account is already inside Telegram). Single source for the config
// read now lives in inviteFlow.js (C4).
export function telegramOnrampEnabled() {
  return telegramSharingEnabled() && !isTelegramContext();
}

export function buildLinkDeepLink(token) {
  return token ? buildStartAppLink(`lk_${token}`) : null;
}

// Fresh token every call (no caching): if the user backs out, it just expires.
// A mint failure is not silent (U1.4): it toasts. On success the deep link
// always opens — a new tab when the browser allows it (keeps the web app open
// for the return "success beat"), else same-context navigation, which installed
// PWAs don't block the way they block '_blank' popups (finding: PWA tap used to
// dead-end). Returns true once the link is on its way to Telegram.
export async function startTelegramOnramp() {
  let url;
  try {
    const { token } = await callMintTelegramLinkToken();
    url = buildLinkDeepLink(token);
  } catch {
    showToast("Couldn't reach Telegram right now. Try again.");
    return false;
  }
  if (!url) return false;
  if (window.open(url, '_blank')) return true;
  window.open(url, '_self'); // navigation, not a popup — not blocked in PWAs
  return true;
}

const DISMISS_KEY = 'statusapp_tg_onramp_dismissed';
function bannerDismissed() {
  try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
}
function dismissBanner() {
  try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* quota */ }
}

let _linked = false;
let _ctaTapped = false;
let _firstRunBound = false;
let _promoActive = false;

// Whether the "Use in Telegram" promo banner is currently shown. The install/
// notify nudge (js/installAffordance.js) reads this to defer while it's up — the
// two teaching surfaces must not co-show (finding: cluttered). Changes fire an
// 'onramp-change' document event so that reader re-evaluates reactively.
export function isOnrampPromoActive() { return _promoActive; }
function setPromoActive(active) {
  if (active === _promoActive) return;
  _promoActive = active;
  document.dispatchEvent(new CustomEvent('onramp-change'));
}

function refresh() {
  const promo = document.getElementById('tg-onramp-promo');
  const onrampWrap = document.getElementById('tg-onramp-drawer');
  const acctSection = document.getElementById('drawer-section-account');
  if (!telegramOnrampEnabled()) {
    // Not our context (inside Telegram, or unconfigured): telegramSettings owns
    // the Account section there — never touch it. Just keep our own bits hidden.
    promo?.classList.add('hidden');
    onrampWrap?.classList.add('hidden');
    setPromoActive(false);
    return;
  }
  const show = !_linked;
  onrampWrap?.classList.toggle('hidden', !show);
  // On web the Account section holds only the onramp, so its visibility tracks it.
  acctSection?.classList.toggle('hidden', !show);
  // The PROMO — but not the drawer card — defers during the guided empty state
  // (U2.2): one teaching surface at a time (spec §3), same rule installAffordance
  // follows. The drawer card is opt-in and stays reachable throughout.
  const promoActive = show && !bannerDismissed() && !isFirstRunActive();
  promo?.classList.toggle('hidden', !promoActive);
  setPromoActive(promoActive);
}

export function initTelegramOnramp() {
  const promo = document.getElementById('tg-onramp-promo');
  const onrampWrap = document.getElementById('tg-onramp-drawer');
  if (!promo && !onrampWrap) return;
  const go = async (btn) => {
    if (btn) btn.disabled = true;
    try {
      // Arm the success beat only when the deep link actually opened (U1.7).
      if (await startTelegramOnramp()) _ctaTapped = true;
    } finally { if (btn) btn.disabled = false; }
  };
  document.getElementById('tg-onramp-action')?.addEventListener('click', (e) => go(e.currentTarget));
  document.getElementById('tg-onramp-drawer-btn')?.addEventListener('click', (e) => go(e.currentTarget));
  document.getElementById('tg-onramp-dismiss')?.addEventListener('click', () => {
    dismissBanner();
    refresh(); // hides the promo AND fires onramp-change so the install nudge resumes
  });
  // Re-evaluate the promo gate when the empty state mounts/clears (U2.2). Bound
  // once at document level so it survives DOM rebuilds and repeated init.
  if (!_firstRunBound) {
    document.addEventListener('first-run-change', refresh);
    _firstRunBound = true;
  }
  refresh();
}

// Suppress once this account is linked to Telegram (prefs.telegram set). Rides
// the watchUserPrefs tick. Fourth reader of the `prefs.telegram != null` linked
// marker (the linked half of the notify-channel contract) — see the cross-ref
// in js/notifySuppression.js botDelivered (W2 C10); consumes only the marker,
// not the channel default.
export function syncTelegramOnramp(serverPrefs) {
  const nowLinked = serverPrefs?.telegram != null;
  const justLinked = nowLinked && !_linked;
  _linked = nowLinked;
  // A web-side success beat (U1.7), but only when THIS session started the
  // onramp — never for an account that was already linked at boot.
  if (justLinked && _ctaTapped) {
    _ctaTapped = false;
    showToast('Linked — KnockKnock now works in your Telegram too.');
  }
  refresh();
}
