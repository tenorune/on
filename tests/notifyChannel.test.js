/** @jest-environment jsdom */
// The notification-channel toggle pill, driven reactively from userPrefs so it
// stays live across surfaces/devices (link/unlink and channel switches reflect
// without a reload). Shared by the Telegram drawer and the web drawer.
jest.mock('../js/db.js', () => ({ mergeUserPrefs: jest.fn(async () => {}) }));
jest.mock('../js/telegram.js', () => ({
  isTelegramContext: jest.fn(() => false),
  telegramLinkState: jest.fn(() => null),
}));
jest.mock('../js/notifyPrompt.js', () => ({ ensureNotificationsReady: jest.fn() }));
jest.mock('../js/notifySuppression.js', () => ({ syncBotDelivery: jest.fn() }));
const { mergeUserPrefs } = require('../js/db.js');
const { isTelegramContext, telegramLinkState } = require('../js/telegram.js');
const { ensureNotificationsReady } = require('../js/notifyPrompt.js');
const { syncBotDelivery } = require('../js/notifySuppression.js');
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
