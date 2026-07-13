// shared/notifyDelivery.js — THE notify-channel delivery default (W2 C10):
// for a linked/routed account, notifications are Telegram-delivered iff
// notifyChannel !== 'push'. A MISSING or unknown channel reads as telegram;
// only an explicit 'push' opts out. Pinned by
// test-fixtures/notify-channel-vectors.json. Readers: js/notifySuppression.js
// botDelivered, js/notifyChannel.js render default, functions/notifier.js
// sendToUser route gate (via the functions/_shared/ mirror).
//
// NOT covered here (delivery-level extra, W1 J#3): the notifier additionally
// falls back to the bot when the channel IS 'push' but the account has zero
// push tokens.
export function telegramPreferred(notifyChannel) {
  return notifyChannel !== 'push';
}
