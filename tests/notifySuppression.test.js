// tests/notifySuppression.test.js
// "Notifications are bot-delivered" state for web sessions of linked accounts —
// the predicate, the change-only event, and the Telegram-context no-op.
jest.mock('../js/telegram.js', () => ({ isTelegramContext: jest.fn(() => false) }));
const { isTelegramContext } = require('../js/telegram.js');
const {
  botDelivered, isBotDelivered, syncBotDelivery, __resetBotDeliveryForTests,
  isTelegramLinkedWeb, setRepromptActive, isRepromptActive,
} = require('../js/notifySuppression.js');

const LINKED_TG = { telegram: { linkedAt: 1 }, notifyChannel: 'telegram' };
const LINKED_PUSH = { telegram: { linkedAt: 1 }, notifyChannel: 'push' };

beforeEach(() => {
  isTelegramContext.mockReturnValue(false);
  __resetBotDeliveryForTests();
});

describe('botDelivered (pure predicate)', () => {
  test('linked + telegram channel → true', () => {
    expect(botDelivered(LINKED_TG)).toBe(true);
  });
  test('linked + push channel → false', () => {
    expect(botDelivered(LINKED_PUSH)).toBe(false);
  });
  test('linked + missing channel → true (defaults to telegram, mirroring the pill)', () => {
    expect(botDelivered({ telegram: { linkedAt: 1 } })).toBe(true);
  });
  test('unlinked → false regardless of channel', () => {
    expect(botDelivered({ notifyChannel: 'telegram' })).toBe(false);
  });
  test('null/undefined/empty prefs → false (fail open to current behavior)', () => {
    expect(botDelivered(null)).toBe(false);
    expect(botDelivered(undefined)).toBe(false);
    expect(botDelivered({})).toBe(false);
  });
});

// Shared cross-reader guard (W2 C10): botDelivered must agree with the pill's
// render default (js/notifyChannel.js) and the server notifier
// (functions/notifier.js) on the channel!=='push' truth table for a linked
// account. All three consume test-fixtures/notify-channel-vectors.json.
const channelVectors = require('../test-fixtures/notify-channel-vectors.json').vectors;
describe('botDelivered agrees with the shared notify-channel default (C10)', () => {
  test.each(channelVectors)('linked, channel=$notifyChannel → botDelivered=$telegramDelivered', (v) => {
    expect(botDelivered({ telegram: { linkedAt: 1 }, notifyChannel: v.notifyChannel })).toBe(v.telegramDelivered);
  });
});

describe('syncBotDelivery / isBotDelivered', () => {
  test('starts false', () => {
    expect(isBotDelivered()).toBe(false);
  });

  test('flips the flag and dispatches bot-delivery-change only on change', () => {
    const seen = jest.fn();
    document.addEventListener('bot-delivery-change', seen);
    syncBotDelivery(LINKED_TG);
    expect(isBotDelivered()).toBe(true);
    syncBotDelivery(LINKED_TG);       // same value — no second dispatch
    syncBotDelivery(LINKED_PUSH);     // change back
    expect(isBotDelivered()).toBe(false);
    expect(seen).toHaveBeenCalledTimes(2);
    document.removeEventListener('bot-delivery-change', seen);
  });

  test('Telegram context → no-op: flag stays false, no event', () => {
    isTelegramContext.mockReturnValue(true);
    const seen = jest.fn();
    document.addEventListener('bot-delivery-change', seen);
    syncBotDelivery(LINKED_TG);
    expect(isBotDelivered()).toBe(false);
    expect(seen).not.toHaveBeenCalled();
    document.removeEventListener('bot-delivery-change', seen);
  });
});

describe('isTelegramLinkedWeb (5th reader of the linked marker)', () => {
  test('starts false; follows prefs.telegram across syncBotDelivery ticks', () => {
    expect(isTelegramLinkedWeb()).toBe(false);
    syncBotDelivery(LINKED_PUSH);            // linked but channel push
    expect(isTelegramLinkedWeb()).toBe(true); // linked ≠ botDelivered
    expect(isBotDelivered()).toBe(false);
    syncBotDelivery({ notifyChannel: 'push' }); // unlinked
    expect(isTelegramLinkedWeb()).toBe(false);
  });

  test('Telegram context → not recorded (web-only concern)', () => {
    isTelegramContext.mockReturnValue(true);
    syncBotDelivery(LINKED_TG);
    expect(isTelegramLinkedWeb()).toBe(false);
  });
});

describe('setRepromptActive / isRepromptActive', () => {
  test('starts false; flips and dispatches reprompt-change only on change', () => {
    const seen = jest.fn();
    document.addEventListener('reprompt-change', seen);
    expect(isRepromptActive()).toBe(false);
    setRepromptActive(true);
    expect(isRepromptActive()).toBe(true);
    setRepromptActive(true);   // same value — no second dispatch
    setRepromptActive(false);
    expect(isRepromptActive()).toBe(false);
    expect(seen).toHaveBeenCalledTimes(2);
    document.removeEventListener('reprompt-change', seen);
  });
});
