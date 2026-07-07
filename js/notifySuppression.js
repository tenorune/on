// js/notifySuppression.js — "notifications are bot-delivered" state for web
// sessions. When a linked account's channel is telegram, the bot delivers every
// notification, so web install/web-push nudges have a void premise and hide
// (spec 2026-07-07-web-nudge-suppression). Fed from the watchUserPrefs tick
// (server truth: link/unlink/channel switches from any device) and
// optimistically from the channel pill; consumers read isBotDelivered() at
// decision time and re-run on the 'bot-delivery-change' document event.
import { isTelegramContext } from './telegram.js';

let suppressed = false;

// Pure. Mirrors the pill's isLinked + default-channel semantics
// (js/notifyChannel.js): on web the telegram marker means linked, and a linked
// account with no stored channel reads as telegram. The two must never disagree.
export function botDelivered(prefs) {
  return prefs?.telegram != null && prefs?.notifyChannel !== 'push';
}

export function isBotDelivered() { return suppressed; }

export function syncBotDelivery(prefs) {
  // Web-only concern: in Telegram the whole install/web-push machinery is
  // already gated off at init (app.js) and inside notifyPrompt.
  if (isTelegramContext()) return;
  const next = botDelivered(prefs);
  if (next === suppressed) return;
  suppressed = next;
  document.dispatchEvent(new CustomEvent('bot-delivery-change'));
}

export function __resetBotDeliveryForTests() { suppressed = false; }
