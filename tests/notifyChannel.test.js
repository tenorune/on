/** @jest-environment jsdom */
// The notification-channel toggle pill, shared by the Telegram drawer and the
// web drawer. Only present for a linked account.
jest.mock('../js/db.js', () => ({
  getUserPrefs: jest.fn(async () => ({ notifyChannel: 'telegram' })),
  mergeUserPrefs: jest.fn(async () => {}),
}));
const { getUserPrefs, mergeUserPrefs } = require('../js/db.js');
const { initNotifyChannel } = require('../js/notifyChannel.js');

const flush = () => new Promise((r) => setTimeout(r, 0));

function mountDom() {
  document.body.innerHTML = `
    <div class="drawer-section hidden" id="drawer-section-notifications">
      <p class="drawer-section-label">Notifications</p>
      <div id="tg-notify-slot"></div>
    </div>`;
}
beforeEach(() => {
  jest.clearAllMocks();
  getUserPrefs.mockResolvedValue({ notifyChannel: 'telegram' });
  mergeUserPrefs.mockResolvedValue(undefined);
  mountDom();
});

test('unlinked: section stays hidden, no pill, and prefs are not read', async () => {
  await initNotifyChannel('u1', { linked: false });
  expect(document.getElementById('drawer-section-notifications').classList.contains('hidden')).toBe(true);
  expect(document.getElementById('tg-notify-slot').children.length).toBe(0);
  expect(getUserPrefs).not.toHaveBeenCalled();
});

test('linked: reveals the section and renders a two-segment pill, Telegram active by default', async () => {
  await initNotifyChannel('u1', { linked: true });
  expect(document.getElementById('drawer-section-notifications').classList.contains('hidden')).toBe(false);
  const opts = [...document.querySelectorAll('.toggle-pill-option')];
  expect(opts.map((o) => o.dataset.channel)).toEqual(['telegram', 'push']);
  expect(document.querySelector('.toggle-pill-option.active').dataset.channel).toBe('telegram');
});

test('linked with a stored push preference: Push segment active', async () => {
  getUserPrefs.mockResolvedValue({ notifyChannel: 'push' });
  await initNotifyChannel('u1', { linked: true });
  expect(document.querySelector('.toggle-pill-option.active').dataset.channel).toBe('push');
});

test('clicking a segment persists the channel and moves the active state', async () => {
  await initNotifyChannel('u1', { linked: true });
  document.querySelector('[data-channel="push"]').click();
  await flush();
  expect(mergeUserPrefs).toHaveBeenCalledWith('u1', { notifyChannel: 'push' });
  expect(document.querySelector('.toggle-pill-option.active').dataset.channel).toBe('push');
});

test('clicking the already-active segment is a no-op', async () => {
  await initNotifyChannel('u1', { linked: true });
  document.querySelector('[data-channel="telegram"]').click();
  await flush();
  expect(mergeUserPrefs).not.toHaveBeenCalled();
});

test('write failure reverts the active segment', async () => {
  mergeUserPrefs.mockRejectedValue(new Error('offline'));
  await initNotifyChannel('u1', { linked: true });
  document.querySelector('[data-channel="push"]').click();
  await flush();
  expect(document.querySelector('.toggle-pill-option.active').dataset.channel).toBe('telegram');
});
