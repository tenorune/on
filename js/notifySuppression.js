// @ts-check
// js/notifySuppression.js — "notifications are bot-delivered" state for web
// sessions. When a linked account's channel is telegram, the bot delivers every
// notification, so web install/web-push nudges have a void premise and hide
// (spec 2026-07-07-web-nudge-suppression). Fed from the watchUserPrefs tick
// (server truth: link/unlink/channel switches from any device) and
// optimistically from the channel pill; consumers read isBotDelivered() at
// decision time and re-run on the 'bot-delivery-change' document event.
import { isTelegramContext } from './telegram.js';
import { telegramPreferred } from '../shared/notifyDelivery.js';

let suppressed = false;

// Pure. Mirrors the pill's isLinked + default-channel semantics
// (js/notifyChannel.js): on web the telegram marker means linked, and a linked
// account with no stored channel reads as telegram. The channel default
// itself lives in shared/notifyDelivery.js telegramPreferred (one copy for
// all three readers, pinned by test-fixtures/notify-channel-vectors.json —
// W2 C10). A FOURTH reader consumes only the `prefs.telegram != null` linked
// half (not the channel): js/telegramOnramp.js syncTelegramOnramp, which
// suppresses the onramp once linked — keep it in step if the marker changes.
// A FIFTH reader, js/telegramEscapeHatch.js, consumes the linked half via
// isTelegramLinkedWeb() below (recorded from the same prefs tick).
/** @param {UserPrefs | null | undefined} prefs */
export function botDelivered(prefs) {
  return prefs?.telegram != null && telegramPreferred(prefs?.notifyChannel);
}
// Note: the notifier additionally falls back to the bot when channel IS 'push'
// but the account has zero push tokens (W1 J#3) — delivery-level only; it does
// not change this predicate.

export function isBotDelivered() { return suppressed; }

let linkedWeb = false;
let repromptActive = false;

// Web-only "this account is linked" (prefs.telegram != null) — the linked
// marker's 5th reader, recorded on the same tick as botDelivered so
// telegramEscapeHatch can gate without importing prefs. See the reader list
// in the botDelivered comment above.
export function isTelegramLinkedWeb() { return linkedWeb; }

// Reprompt-banner visibility, fed by notifyPrompt refreshPromoVisibility.
// telegramOnramp reads it at decision time (promo defers to the reprompt —
// concrete unmet intent beats a passive promo) and re-runs on 'reprompt-change'.
/** @param {boolean} active */
export function setRepromptActive(active) {
  const next = !!active;
  if (next === repromptActive) return;
  repromptActive = next;
  document.dispatchEvent(new CustomEvent('reprompt-change'));
}
export function isRepromptActive() { return repromptActive; }

/** @param {UserPrefs | null | undefined} prefs */
export function syncBotDelivery(prefs) {
  // Web-only concern: in Telegram the whole install/web-push machinery is
  // already gated off at init (app.js) and inside notifyPrompt.
  if (isTelegramContext()) return;
  const prevLinked = linkedWeb;
  linkedWeb = prefs?.telegram != null;
  const next = botDelivered(prefs);
  const suppressionChanged = next !== suppressed;
  suppressed = next;
  // Fires on EITHER a suppression flip OR a linked-marker-only change (e.g.
  // linking on notifyChannel:'push', where botDelivered stays false) — the
  // escape-hatch gate (telegramEscapeHatch, via isTelegramLinkedWeb) must
  // re-evaluate even when botDelivered itself doesn't move, otherwise a
  // stale "Link Telegram" affordance can persist for an already-linked
  // account.
  if (suppressionChanged || linkedWeb !== prevLinked) {
    document.dispatchEvent(new CustomEvent('bot-delivery-change'));
  }
}

export function __resetBotDeliveryForTests() {
  suppressed = false; linkedWeb = false; repromptActive = false;
}
