/** @jest-environment jsdom */
// The notification-channel toggle pill, driven reactively from userPrefs so it
// stays live across surfaces/devices (link/unlink and channel switches reflect
// without a reload). Shared by the Telegram drawer and the web drawer.
jest.mock('../js/db.js', () => ({ mergeUserPrefs: jest.fn(async () => {}) }));
jest.mock('../js/telegram.js', () => ({
  isTelegramContext: jest.fn(() => false),
  telegramLinkState: jest.fn(() => null),
}));
jest.mock('../js/notifyPrompt.js', () => ({ ensureNotificationsReady: jest.fn(async () => {}) }));
jest.mock('../js/notifySuppression.js', () => ({ syncBotDelivery: jest.fn() }));
jest.mock('../js/groups.js', () => ({ showToast: jest.fn() }));
const { mergeUserPrefs } = require('../js/db.js');
const { isTelegramContext, telegramLinkState } = require('../js/telegram.js');
const { ensureNotificationsReady } = require('../js/notifyPrompt.js');
const { syncBotDelivery } = require('../js/notifySuppression.js');
const { showToast } = require('../js/groups.js');
const { syncNotifyChannel } = require('../js/notifyChannel.js');

const flush = () => new Promise((r) => setTimeout(r, 0));
const LINKED = (channel) => ({ telegram: { linkedAt: 1 }, notifyChannel: channel });
const UNLINKED = (channel) => ({ notifyChannel: channel }); // no telegram marker

function mountDom() {
  document.body.innerHTML = `
    <div class="drawer-section hidden" id="drawer-section-notifications">
      <p class="drawer-section-label">Notifications</p>
      <div id="tg-notify-slot"></div>
    </div>`;
}
beforeEach(() => {
  jest.clearAllMocks();
  mergeUserPrefs.mockResolvedValue(undefined);
  isTelegramContext.mockReturnValue(false); // web by default
  telegramLinkState.mockReturnValue(null);
  // jsdom has no Notification; the pill's honesty guards read its permission.
  // Baseline: a normal grantable/granted browser (per-test overrides below).
  global.Notification = { permission: 'granted' };
  mountDom();
});

const active = () => document.querySelector('.toggle-pill-option.active')?.dataset.channel;
const section = () => document.getElementById('drawer-section-notifications');

test('unlinked prefs: section stays hidden, no pill', () => {
  syncNotifyChannel('u1', UNLINKED('telegram'));
  expect(section().classList.contains('hidden')).toBe(true);
  expect(document.getElementById('tg-notify-slot').children.length).toBe(0);
});

test('null prefs: treated as unlinked, hidden', () => {
  syncNotifyChannel('u1', null);
  expect(section().classList.contains('hidden')).toBe(true);
});

test('linked: reveals the section and renders a two-segment pill, active reflects the stored channel', () => {
  syncNotifyChannel('u1', LINKED('telegram'));
  expect(section().classList.contains('hidden')).toBe(false);
  expect([...document.querySelectorAll('.toggle-pill-option')].map((o) => o.dataset.channel)).toEqual(['telegram', 'push']);
  expect(active()).toBe('telegram');
});

test('linked with push stored: Push active', () => {
  syncNotifyChannel('u1', LINKED('push'));
  expect(active()).toBe('push');
});

test('reactive: a later prefs tick flips the active segment without remounting or duplicating handlers', async () => {
  syncNotifyChannel('u1', LINKED('telegram'));
  const firstPill = document.querySelector('.toggle-pill');
  syncNotifyChannel('u1', LINKED('push')); // external change (other device)
  expect(active()).toBe('push');
  expect(document.querySelector('.toggle-pill')).toBe(firstPill); // same node, not rebuilt
  // handlers weren't stacked: one click → one write
  document.querySelector('[data-channel="telegram"]').click();
  await flush();
  expect(mergeUserPrefs).toHaveBeenCalledTimes(1);
});

test('link transition: hidden → shown when the telegram marker appears', () => {
  syncNotifyChannel('u1', UNLINKED('telegram'));
  expect(section().classList.contains('hidden')).toBe(true);
  syncNotifyChannel('u1', LINKED('telegram'));
  expect(section().classList.contains('hidden')).toBe(false);
});

test('unlink transition: shown → hidden when the telegram marker clears', () => {
  syncNotifyChannel('u1', LINKED('telegram'));
  expect(section().classList.contains('hidden')).toBe(false);
  syncNotifyChannel('u1', UNLINKED('push'));
  expect(section().classList.contains('hidden')).toBe(true);
});

test('clicking a segment persists the channel and optimistically moves the active state', async () => {
  syncNotifyChannel('u1', LINKED('telegram'));
  document.querySelector('[data-channel="push"]').click();
  expect(active()).toBe('push'); // optimistic, before the round-trip resolves
  await flush();
  expect(mergeUserPrefs).toHaveBeenCalledWith('u1', { notifyChannel: 'push' });
});

test('clicking the already-active segment is a no-op', async () => {
  syncNotifyChannel('u1', LINKED('telegram'));
  document.querySelector('[data-channel="telegram"]').click();
  await flush();
  expect(mergeUserPrefs).not.toHaveBeenCalled();
});

test('write failure reverts the optimistic active state', async () => {
  mergeUserPrefs.mockRejectedValue(new Error('offline'));
  syncNotifyChannel('u1', LINKED('telegram'));
  document.querySelector('[data-channel="push"]').click();
  await flush();
  expect(active()).toBe('telegram');
});

describe('Telegram context: link state, not the userPrefs marker, decides visibility', () => {
  // A derived (never-linked) Telegram account ALSO carries userPrefs.telegram
  // (stamped at creation for bot routing), so the marker can't distinguish it
  // from a linked account — the section must key off telegramLinkState instead.
  test('derived account (telegram marker present, but not linked) → section hidden', () => {
    isTelegramContext.mockReturnValue(true);
    telegramLinkState.mockReturnValue({ linked: false });
    syncNotifyChannel('u1', LINKED('telegram')); // prefs.telegram present (derived stamp)
    expect(section().classList.contains('hidden')).toBe(true);
  });

  test('unlink transition (reboots to a derived account) → section hidden', () => {
    isTelegramContext.mockReturnValue(true);
    telegramLinkState.mockReturnValue({ linked: false });
    syncNotifyChannel('u1', { telegram: { linkedAt: 1 }, notifyChannel: 'push' });
    expect(section().classList.contains('hidden')).toBe(true);
  });

  test('linked account → section shown, active reflects the stored channel', () => {
    isTelegramContext.mockReturnValue(true);
    telegramLinkState.mockReturnValue({ linked: true });
    syncNotifyChannel('u1', LINKED('push'));
    expect(section().classList.contains('hidden')).toBe(false);
    expect(active()).toBe('push');
  });
});

describe('channel switch feeds suppression and prompts on push', () => {
  test('switch to push: optimistic syncBotDelivery with the merged prefs, then the permission flow', async () => {
    syncNotifyChannel('u1', LINKED('telegram'));
    document.querySelector('[data-channel="push"]').click();
    await flush();
    expect(syncBotDelivery).toHaveBeenCalledWith({ telegram: { linkedAt: 1 }, notifyChannel: 'push' });
    expect(ensureNotificationsReady).toHaveBeenCalledTimes(1);
    // The guarded call must not trip the catch's revert — Push stays active.
    // (Guards against a non-promise mock silently exercising the failure path.)
    expect(active()).toBe('push');
  });

  test('switch to telegram: optimistic suppression, no permission flow', async () => {
    syncNotifyChannel('u1', LINKED('push'));
    document.querySelector('[data-channel="telegram"]').click();
    await flush();
    expect(syncBotDelivery).toHaveBeenCalledWith({ telegram: { linkedAt: 1 }, notifyChannel: 'telegram' });
    expect(ensureNotificationsReady).not.toHaveBeenCalled();
  });

  test('merge failure: no suppression change, no permission flow (matches the visual revert)', async () => {
    mergeUserPrefs.mockRejectedValue(new Error('offline'));
    syncNotifyChannel('u1', LINKED('telegram'));
    document.querySelector('[data-channel="push"]').click();
    await flush();
    expect(syncBotDelivery).not.toHaveBeenCalled();
    expect(ensureNotificationsReady).not.toHaveBeenCalled();
  });
});

// The web pill must not leave the account SHOWING "Push" when push is
// undeliverable: channel 'push' + zero account tokens delivers via the bot
// (the notifier's token-less fallback), so every surface would display a
// channel that doesn't describe delivery. Two guards: a blocked browser is
// refused up front; a prompt that ends without a grant reverts the write.
describe('web: Push switch stays honest when no device can receive push', () => {
  test('permission already denied + no tokens anywhere: refused up front — toast, no write, no prompt', async () => {
    global.Notification = { permission: 'denied' };
    syncNotifyChannel('u1', LINKED('telegram')); // no pushTokens
    document.querySelector('[data-channel="push"]').click();
    await flush();
    expect(showToast).toHaveBeenCalledWith(
      'Notifications are blocked in this browser — allow them in your browser settings first. Messages keep arriving via Telegram.');
    expect(mergeUserPrefs).not.toHaveBeenCalled();
    expect(ensureNotificationsReady).not.toHaveBeenCalled();
    expect(active()).toBe('telegram');
  });

  test('prompt dismissed/denied (permission not granted after the flow) + no tokens: the write is reverted', async () => {
    global.Notification = { permission: 'default' };
    ensureNotificationsReady.mockImplementation(async () => {}); // flow ran, no grant
    syncNotifyChannel('u1', LINKED('telegram')); // no pushTokens
    document.querySelector('[data-channel="push"]').click();
    await flush();
    expect(mergeUserPrefs).toHaveBeenNthCalledWith(1, 'u1', { notifyChannel: 'push' });
    expect(mergeUserPrefs).toHaveBeenNthCalledWith(2, 'u1', { notifyChannel: 'telegram' });
    expect(active()).toBe('telegram'); // pill reverted with the write
    expect(syncBotDelivery).toHaveBeenLastCalledWith(
      { telegram: { linkedAt: 1 }, notifyChannel: 'telegram' });
    expect(showToast).toHaveBeenCalledWith(
      'Push needs notification permission — messages keep arriving via Telegram.');
  });

  test('prompt granted during the flow: single write, Push stays, no toast', async () => {
    global.Notification = { permission: 'default' };
    ensureNotificationsReady.mockImplementation(async () => {
      global.Notification.permission = 'granted'; // user accepted the prompt
    });
    syncNotifyChannel('u1', LINKED('telegram')); // no pushTokens yet (echo pending)
    document.querySelector('[data-channel="push"]').click();
    await flush();
    expect(mergeUserPrefs).toHaveBeenCalledTimes(1);
    expect(mergeUserPrefs).toHaveBeenCalledWith('u1', { notifyChannel: 'push' });
    expect(active()).toBe('push');
    expect(showToast).not.toHaveBeenCalled();
  });

  test('another device holds a token: denied here is fine — no refusal, no revert', async () => {
    global.Notification = { permission: 'denied' };
    syncNotifyChannel('u1', { ...LINKED('telegram'), pushTokens: { t1: true } });
    document.querySelector('[data-channel="push"]').click();
    await flush();
    expect(mergeUserPrefs).toHaveBeenCalledTimes(1);
    expect(mergeUserPrefs).toHaveBeenCalledWith('u1', { notifyChannel: 'push' });
    expect(active()).toBe('push');
    expect(showToast).not.toHaveBeenCalled();
  });
});

describe('Telegram context: Push switch refused with no registered device', () => {
  test('Telegram context + no pushTokens: Push tap refuses — toast, no write, pill stays', async () => {
    isTelegramContext.mockReturnValue(true);
    telegramLinkState.mockReturnValue({ linked: true });
    syncNotifyChannel('u1', LINKED('telegram')); // no pushTokens
    const pushBtn = document.querySelector('[data-channel="push"]');
    pushBtn.click();
    await flush();
    expect(showToast).toHaveBeenCalledWith(
      "Push isn't set up on any device yet — open KnockKnock in a browser first. Messages keep arriving via Telegram.");
    expect(mergeUserPrefs).not.toHaveBeenCalled();
    expect(pushBtn.classList.contains('active')).toBe(false); // no optimistic flip
  });

  test('Telegram context WITH pushTokens: Push tap proceeds', async () => {
    isTelegramContext.mockReturnValue(true);
    telegramLinkState.mockReturnValue({ linked: true });
    syncNotifyChannel('u1', { ...LINKED('telegram'), pushTokens: { t1: true } });
    document.querySelector('[data-channel="push"]').click();
    await flush();
    expect(mergeUserPrefs).toHaveBeenCalledWith('u1', { notifyChannel: 'push' });
  });
});
