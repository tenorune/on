// js/telegramLinkArrival.js — Mini App boot path for the web onramp deep link
// (t.me/<bot>?startapp=lk_<token>). Redeems the token → links this Telegram to
// the web account, with a confirm-before-replace when this Telegram already has
// its own account. Returns true when it handled the lk_ path (caller then skips
// the normal invite flow).
import { isTelegramContext, tgWebApp, isTelegramLinked } from './telegram.js';
import { callRedeemTelegramLinkToken } from './firebase-config.js';
import { showConfirmModal } from './promptModal.js';
import { showToast } from './groups.js';
import { stampLinkedNotice } from './firstRun.js';

export function extractLinkToken() {
  if (!isTelegramContext()) return null;
  const p = tgWebApp()?.initDataUnsafe?.start_param;
  if (typeof p !== 'string' || !p.startsWith('lk_')) return null;
  const tok = p.slice(3);
  return /^[A-Za-z0-9_-]{16,64}$/.test(tok) ? tok : null;
}

export async function runLinkArrival({ dismissSplash } = {}) {
  const token = extractLinkToken();
  if (!token) return false;
  // The post-success reload re-presents the same start_param, but the token
  // is already consumed and this Telegram is already linked — don't
  // re-attempt (would toast a spurious "expired").
  if (isTelegramLinked()) return false;
  const initData = tgWebApp()?.initData;
  try {
    const res = await callRedeemTelegramLinkToken(initData, token, false);
    if (res?.needsConfirm) {
      dismissSplash?.();
      const ok = await showConfirmModal({
        title: 'Use this account in Telegram?',
        message: 'Linking replaces this temporary Telegram account — its contacts and groups will be removed.',
        confirmLabel: 'Link account',
        busyLabel: 'Linking…',
        onConfirm: async () => { await callRedeemTelegramLinkToken(initData, token, true); },
      });
      if (!ok) return false; // cancelled — let boot render the derived account
    }
    stampLinkedNotice();
    window.location.reload(); // reboot via initData into the linked account
    return true;
  } catch {
    dismissSplash?.();
    showToast('That link expired — tap Use in Telegram again on the web.');
    return false; // keep the toast; let boot render the derived account
  }
}
