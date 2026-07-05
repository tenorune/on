// js/telegramFirstRun.js — Telegram start_param invite gate (spec §1).
// Decides whether a deep-linked invite token enters app.js's existing
// pendingInviteToken redemption flow, showing the first-run interstitial
// to unlinked arrivals first. Redemption itself stays in app.js.
import { isTelegramContext, tgWebApp } from './telegram.js';
import { resolveInvitePreview } from './invites.js';
import { showLinkScreen } from './telegramSettings.js';

// start_param rides the SIGNED initData (tamper-proof, reload-proof). Invite
// tokens are 22 base64url chars; accept a lenient 10..64 of that alphabet.
export function extractStartParamToken() {
  if (!isTelegramContext()) return null;
  const p = tgWebApp()?.initDataUnsafe?.start_param;
  return (typeof p === 'string' && /^[A-Za-z0-9_-]{10,64}$/.test(p)) ? p : null;
}

function framingText(preview) {
  return preview.scope === 'group'
    ? `You've been invited to join ${preview.groupName}.`
    : `${preview.label || 'Someone'} invited you to follow them.`;
}

function showInterstitial(preview) {
  const el = document.getElementById('tg-invite-screen');
  if (!el) return Promise.resolve('dismiss');
  document.getElementById('tg-invite-framing').textContent = framingText(preview);
  el.classList.remove('hidden');
  return new Promise((resolve) => {
    const accept = document.getElementById('tg-invite-accept-btn');
    const phrase = document.getElementById('tg-invite-phrase-btn');
    const dismiss = document.getElementById('tg-invite-dismiss-btn');
    function pick(choice) {
      accept.removeEventListener('click', onAccept);
      phrase.removeEventListener('click', onPhrase);
      dismiss.removeEventListener('click', onDismiss);
      el.classList.add('hidden');
      resolve(choice);
    }
    function onAccept() { pick('accept'); }
    function onPhrase() { pick('phrase'); }
    function onDismiss() { pick('dismiss'); }
    accept.addEventListener('click', onAccept);
    phrase.addEventListener('click', onPhrase);
    dismiss.addEventListener('click', onDismiss);
  });
}

// Returns { token, preview, silent } to feed pendingInviteToken, or null.
//  - linked account: silent redeem (caller toasts on success) — no interstitial
//  - unlinked: interstitial; Accept → redeem; phrase → link flow (its reload
//    re-runs this gate with linked=true → silent redeem into the right
//    account); Not now → proceed unredeemed (the empty state catches them).
export async function telegramInviteGate({ linked, dismissSplash }) {
  const token = extractStartParamToken();
  if (!token) return null;
  const preview = await resolveInvitePreview(token); // null → invalid/revoked/expired
  if (!preview) return null;
  if (linked) return { token, preview, silent: true };
  dismissSplash();
  const choice = await showInterstitial(preview);
  if (choice === 'accept') return { token, preview, silent: false };
  if (choice === 'phrase') showLinkScreen(); // reloads on success; cancel falls through
  return null;
}
