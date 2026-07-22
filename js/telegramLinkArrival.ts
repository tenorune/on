// js/telegramLinkArrival.ts — Mini App boot path for the web onramp deep link
// (t.me/<bot>?startapp=lk_<token>). Redeems the token → links this Telegram to
// the web account, with a confirm-before-replace when this Telegram already has
// its own account. Returns true when it handled the lk_ path (caller then skips
// the normal invite flow).
import { isTelegramContext, tgWebApp } from './telegram.js';
import { callRedeemTelegramLinkToken } from './firebase-config.js';
import { showConfirmModal } from './promptModal.js';
import { showToast } from './groups.js';
import { stampLinkedNotice } from './firstRun.js';
import { linkReplaceWarning } from './telegramLinkCopy.js';

// One-shot marker for the token just consumed on the pre-reload pass. The
// post-success reload re-presents the same start_param, but the token is now
// single-use-deleted server-side; without this, the re-fire would redeem →
// not-found → a spurious "expired" toast over the success toast. localStorage
// (not sessionStorage) so it survives the reload robustly even in webviews.
// NOT gated on isTelegramLinked: a Telegram linked to a DIFFERENT account is a
// legitimate relink, not a re-fire — that path must still redeem.
const CONSUMED_KEY = 'statusapp_onramp_consumed';

// The redeem callable's result shape (only the fields this flow reads).
interface RedeemLinkResult {
  needsConfirm?: boolean;
  reason?: string;
  counts?: { contacts?: number; groups?: number } | null;
}

export function extractLinkToken() {
  if (!isTelegramContext()) return null;
  const p = tgWebApp()?.initDataUnsafe?.start_param;
  if (typeof p !== 'string' || !p.startsWith('lk_')) return null;
  const tok = p.slice(3);
  return /^[A-Za-z0-9_-]{16,64}$/.test(tok) ? tok : null;
}

export async function runLinkArrival({ dismissSplash }: { dismissSplash?: () => void } = {}) {
  const token = extractLinkToken();
  if (!token) return false;
  try {
    if (localStorage.getItem(CONSUMED_KEY) === token) {
      localStorage.removeItem(CONSUMED_KEY); // one-shot: only the immediate post-link reload
      return false;
    }
  } catch { /* private mode */ }
  const initData = tgWebApp()?.initData;
  try {
    const res = await callRedeemTelegramLinkToken(initData, token, false) as RedeemLinkResult;
    if (res?.needsConfirm) {
      dismissSplash?.();
      const relink = res.reason === 'relink';
      const ok = await showConfirmModal({
        title: relink ? 'Switch this Telegram to this account?' : 'Use this account in Telegram?',
        message: relink
          ? 'This Telegram is linked to another KnockKnock account. Switch it to this one? The other account stays yours — sign in with its secret phrase on the web.'
          : linkReplaceWarning(res.counts),
        confirmLabel: relink ? 'Switch account' : 'Link account',
        busyLabel: relink ? 'Switching…' : 'Linking…',
        onConfirm: async () => { await callRedeemTelegramLinkToken(initData, token, true); },
      });
      if (!ok) return false; // cancelled — let boot render the current account
    }
    try { localStorage.setItem(CONSUMED_KEY, token); } catch { /* private mode */ }
    stampLinkedNotice();
    window.location.reload(); // reboot via initData into the linked account
    return true;
  } catch (e) {
    dismissSplash?.();
    // Only a genuinely consumed/expired token is 'not-found' (telegram-auth.js
    // redeem). Offline, unconfigured, or bad-signature failures get the generic
    // voice instead of a misleading "expired" (U1.8).
    const expired = (e as { code?: string })?.code === 'functions/not-found';
    showToast(expired
      ? 'That link expired — tap Use in Telegram again on the web.'
      : "Couldn't finish that right now — check your connection and try again.");
    return false; // keep the toast; let boot render the current account
  }
}
