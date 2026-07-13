// js/notifyChannel.js — the notification-channel toggle pill, shared by the
// Telegram drawer and the web drawer.
//
// Driven reactively from userPrefs (call it from the watchUserPrefs tick) so it
// stays live across surfaces and devices: linking/unlinking and channel switches
// reflect without a reload. Only shown for a LINKED account — decided uniformly by
// the server-side marker userPrefs.telegram (set on link, cleared on unlink); a
// Telegram-derived (unlinked) account can only receive via Telegram, and a web
// account with no link has nothing to choose.
import { mergeUserPrefs } from './db.js';
import { isTelegramContext, isTelegramLinked } from './telegram.js';
import { syncBotDelivery } from './notifySuppression.js';
import { ensureNotificationsReady } from './notifyPrompt.js';
import { showToast } from './groups.js';
import { telegramPreferred } from '../shared/notifyDelivery.js';

const OTHER = { telegram: 'push', push: 'telegram' };

// Latest prefs this pill was synced with — the click handler needs them to
// feed suppression optimistically without waiting for the watchUserPrefs echo.
let lastPrefs = null;

// "Linked" = the account has a separate phrase identity that a Telegram points
// at, vs a bare Telegram-derived account. The signal differs by surface:
//  - Telegram: a DERIVED account also carries userPrefs.telegram (stamped at
//    creation for bot routing), so the marker can't tell linked from derived —
//    key off the session link state (mapping.uid !== derivedUid). It's static
//    within a session (link/unlink both reload), which is fine here.
//  - Web: only a linked phrase account carries userPrefs.telegram (cleared on
//    unlink) and derived accounts never reach the web, so the marker is the
//    correct, live signal there.
// The web branch (with the pill's non-'push'-defaults-to-telegram rendering)
// routes through shared/notifyDelivery.js telegramPreferred, the one copy of
// the channel default for all three readers.
function isLinked(prefs) {
  if (isTelegramContext()) return isTelegramLinked();
  return prefs?.telegram != null;
}
// Note: the notifier additionally falls back to the bot when channel IS 'push'
// but the account has zero push tokens (W1 J#3) — delivery-level only; it does
// not change this predicate.

function setActive(pill, channel) {
  pill.querySelectorAll('.toggle-pill-option').forEach((b) => {
    const on = b.dataset.channel === channel;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

// Mount the pill once and wire clicks. The DOM (.active class) is the source of
// truth for the current channel, so no per-instance state survives across syncs.
function mountPill(slot, userId) {
  slot.innerHTML = `
    <div class="toggle-pill" role="group" aria-label="Notifications">
      <button class="toggle-pill-option" type="button" data-channel="telegram">Telegram</button>
      <button class="toggle-pill-option" type="button" data-channel="push">Push</button>
    </div>`;
  const pill = slot.querySelector('.toggle-pill');
  // Any device on the ACCOUNT can receive push — deciding deliverability on
  // this browser's permission alone would wrongly block/revert a user whose
  // other device is registered.
  const accountHasPushTokens = () =>
    Object.keys(lastPrefs?.pushTokens || {}).length > 0;
  const permissionGranted = () =>
    typeof Notification !== 'undefined' && Notification.permission === 'granted';
  pill.querySelectorAll('.toggle-pill-option').forEach((b) => {
    b.addEventListener('click', async () => {
      if (b.classList.contains('active')) return;
      const next = b.dataset.channel;
      // W1 J#3: a channel of 'push' with zero registered devices still DELIVERS
      // (the notifier's token-less fallback routes to the bot) but every pill
      // would then SHOW a channel that doesn't describe delivery. Refuse the
      // switch wherever the permission flow can't fix that:
      //  - inside Telegram the flow can't run at all;
      //  - on web with permission already denied, the prompt can't be shown.
      if (next === 'push' && !accountHasPushTokens()) {
        if (isTelegramContext()) {
          showToast("Push isn't set up on any device yet — open KnockKnock in a browser first. Messages keep arriving via Telegram.");
          return;
        }
        if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
          showToast('Notifications are blocked in this browser — allow them in your browser settings first. Messages keep arriving via Telegram.');
          return;
        }
      }
      setActive(pill, next); // optimistic — instant feedback before the round-trip
      try {
        await mergeUserPrefs(userId, { notifyChannel: next });
        // Optimistic: flip web nudge suppression now (the echo confirms later).
        // For a switch TO push, run the permission flow immediately — the user
        // just asked for web push; a permissionless device would otherwise go
        // silent until some later prefs event. Inert in Telegram context
        // (ensureNotificationsReady early-returns there).
        syncBotDelivery({ ...(lastPrefs || {}), notifyChannel: next });
        if (next === 'push') {
          await ensureNotificationsReady().catch(() => {});
          // Honesty check (web): the prompt ended without a grant and no other
          // device holds a token — 'push' is undeliverable, so leaving it
          // written would make every surface display a lie (delivery quietly
          // rides the bot fallback). Revert the write and say why.
          if (!isTelegramContext() && !permissionGranted() && !accountHasPushTokens()) {
            await mergeUserPrefs(userId, { notifyChannel: 'telegram' });
            setActive(pill, 'telegram');
            syncBotDelivery({ ...(lastPrefs || {}), notifyChannel: 'telegram' });
            showToast('Push needs notification permission — messages keep arriving via Telegram.');
          }
        }
      } catch {
        setActive(pill, OTHER[next]); // revert; no echo will arrive to correct it
      }
    });
  });
  return pill;
}

// Reconcile the section + pill against the latest userPrefs. Idempotent: safe to
// call on every prefs tick.
export function syncNotifyChannel(userId, prefs) {
  lastPrefs = prefs;
  const slot = document.getElementById('tg-notify-slot');
  const section = document.getElementById('drawer-section-notifications');
  if (!slot || !section) return;
  if (!isLinked(prefs)) { section.classList.add('hidden'); return; }

  const pill = slot.querySelector('.toggle-pill') || mountPill(slot, userId);
  setActive(pill, telegramPreferred(prefs.notifyChannel) ? 'telegram' : 'push');
  section.classList.remove('hidden');
}
