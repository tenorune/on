// js/telegramFirstRun.js — Telegram start_param invite gate (spec §1).
// Decides whether a deep-linked invite token enters app.js's existing
// pendingInviteToken redemption flow, showing the first-run interstitial
// to unlinked arrivals first. Redemption itself stays in app.js.
import { isTelegramContext, tgWebApp } from './telegram.js';
import { resolveInvitePreview } from './invites.js';
import { showLinkScreen } from './telegramSettings.js';
import { showToast } from './groups.js';

// start_param rides the SIGNED initData (tamper-proof, reload-proof). Invite
// tokens are 22 base64url chars; accept a lenient 10..64 of that alphabet.
export function extractStartParamToken() {
  if (!isTelegramContext()) return null;
  const p = tgWebApp()?.initDataUnsafe?.start_param;
  return (typeof p === 'string' && /^[A-Za-z0-9_-]{10,64}$/.test(p)) ? p : null;
}

// Account-stamped record of invite-token outcomes (W1 J#4/J#5): a redeemed
// token never re-shows the interstitial on a re-tapped chat link; a dismissed
// ("Not now") token never auto-redeems later — following someone the user
// declined would be a consent surprise. Keyed per account via cacheOwner's
// wipe-on-switch (the key is in its ACCOUNT_SCOPED_KEYS). Pruned to the 8 most
// recent tokens: one entry per tapped invite link, not unbounded growth.
const OUTCOME_KEY = 'statusapp_invite_outcomes';
const OUTCOME_MAX = 8;

function readOutcomes() {
  try { return JSON.parse(localStorage.getItem(OUTCOME_KEY)) || {}; }
  catch { return {}; }
}

export function stampInviteOutcome(token, outcome) {
  if (!token) return;
  const map = readOutcomes();
  const key = 't:' + token; // prefix prevents numeric-string keys from sorting first
  delete map[key]; // re-stamp moves it to newest position
  map[key] = outcome;
  const keys = Object.keys(map);
  for (let i = 0; i < keys.length - OUTCOME_MAX; i++) delete map[keys[i]];
  try { localStorage.setItem(OUTCOME_KEY, JSON.stringify(map)); }
  catch { /* private mode / quota — stamping is best-effort */ }
}

export function stampedInviteOutcome(token) {
  return (token && readOutcomes()['t:' + token]) || null;
}

// Which redemption results consume the token (W1 J#4): success, or the
// server telling us it was already consumed.
export function redemptionConsumedToken(result) {
  return !!result && (result.ok === true
    || result.reason === 'already-following'
    || result.reason === 'already-member');
}

function framingText(preview) {
  return preview.scope === 'group'
    ? `You've been invited to join ${preview.groupName}.`
    : `${preview.label || 'Someone'} invited you to follow them.`;
}

function showInterstitial(preview, isNew) {
  const el = document.getElementById('tg-invite-screen');
  if (!el) return Promise.resolve('dismiss');
  document.getElementById('tg-invite-framing').textContent = framingText(preview);
  // "& get started" only on a first-ever open — a returning Mini App user
  // started long ago, so they get a plain "Accept" (spec 2026-07-07).
  document.getElementById('tg-invite-accept-btn').textContent =
    isNew ? 'Accept & get started' : 'Accept';
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

// One-shot error overlay for a failed preview lookup (W1 J#1): a transient
// webview blip must not silently eat a VALID invite. Resolves true (retry) or
// false (Not now).
function showInviteError() {
  const el = document.getElementById('tg-invite-error');
  if (!el) return Promise.resolve(false);
  el.classList.remove('hidden');
  return new Promise((resolve) => {
    const retry = document.getElementById('tg-invite-error-retry');
    const dismiss = document.getElementById('tg-invite-error-dismiss');
    function pick(v) {
      retry.removeEventListener('click', onRetry);
      dismiss.removeEventListener('click', onDismiss);
      el.classList.add('hidden');
      resolve(v);
    }
    function onRetry() { pick(true); }
    function onDismiss() { pick(false); }
    retry.addEventListener('click', onRetry);
    dismiss.addEventListener('click', onDismiss);
  });
}

// Returns { token, preview, silent } to feed pendingInviteToken, or null.
//  - stamped token (redeemed or dismissed): show nothing — a re-tapped chat
//    link must not re-run the ceremony, and a declined invite must never
//    auto-redeem (W1 J#4/J#5).
//  - preview unavailable: error overlay with retry (W1 J#1).
//  - invalid/expired: one-line toast (was: total silence).
//  - linked account: silent redeem (caller toasts on success) — no interstitial.
//  - unlinked: interstitial; Accept → redeem; phrase → link flow (success
//    reloads and re-runs this gate with linked=true; CANCEL loops back to the
//    interstitial with the invite intact, W1 J#6); Not now → stamp dismissed.
export async function telegramInviteGate({ linked, isNew, dismissSplash }) {
  const token = extractStartParamToken();
  if (!token) return null;
  const outcome = stampedInviteOutcome(token);
  // Redeemed → silent forever (J#4): the contact is already in the list, a
  // re-tapped chat link shows nothing. Dismissed + linked → skip WITHOUT
  // resolving the preview (J#5: a declined invite must never auto-redeem when
  // the user later links an account). Dismissed + UNLINKED falls through and
  // RE-OFFERS the interstitial: personal invites are one-active-per-user with no
  // reissue UI, so the dismissed link is the only link the inviter can share —
  // a mis-tap must not lock the invitee out permanently.
  if (outcome === 'redeemed') return null;
  if (outcome === 'dismissed' && linked) return null;
  while (true) {
    let preview;
    try {
      preview = await resolveInvitePreview(token);
    } catch {
      dismissSplash();
      if (await showInviteError()) continue; // retry the lookup
      return null;
    }
    if (!preview) { dismissSplash(); showToast('That invite link has expired.'); return null; }
    if (linked) return { token, preview, silent: true };
    dismissSplash();
    while (true) {
      const choice = await showInterstitial(preview, isNew);
      if (choice === 'accept') return { token, preview, silent: false };
      if (choice === 'dismiss') { stampInviteOutcome(token, 'dismissed'); return null; }
      // choice === 'phrase': success reloads (never returns); false = cancelled.
      await showLinkScreen();
    }
  }
}
