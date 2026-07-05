// tests/telegramSettings.test.js — Telegram drawer settings row.
jest.mock('../js/telegram.js', () => ({
  tgWebApp: () => ({ initData: 'signed-init-data' }),
  telegramLinkState: jest.fn(() => ({ linked: false })),
}));
jest.mock('../js/firebase-config.js', () => ({
  callLinkTelegram: jest.fn(async () => ({ token: 't' })),
  callUnlinkTelegram: jest.fn(async () => ({ token: 't' })),
}));
jest.mock('../js/db.js', () => ({
  getUserPrefs: jest.fn(async () => ({ notifyChannel: 'telegram' })),
  mergeUserPrefs: jest.fn(async () => {}),
}));

const { telegramLinkState } = require('../js/telegram.js');
const { callLinkTelegram, callUnlinkTelegram } = require('../js/firebase-config.js');
const { mergeUserPrefs } = require('../js/db.js');

const flush = () => new Promise((r) => setTimeout(r, 0));

function mountDom() {
  document.body.innerHTML = `
    <div id="code-drawer"><div class="drawer-inner"></div></div>
    <div id="recovery-pill-row"></div>
    <div id="restore-screen" class="hidden">
      <p id="restore-subtext" class="hidden"></p>
      <form id="restore-form"><input id="restore-input" />
        <p id="restore-error" class="hidden"></p>
        <button id="restore-submit-btn" type="submit"></button>
        <button id="restore-cancel-btn" type="button"></button>
      </form>
    </div>`;
}

beforeEach(() => { jest.resetAllMocks(); mountDom(); });

test('renders row, hides phrase pill, shows link button when unlinked', async () => {
  const { initTelegramSettings } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  expect(document.getElementById('recovery-pill-row').classList.contains('hidden')).toBe(true);
  expect(document.getElementById('tg-link-btn').classList.contains('hidden')).toBe(false);
  expect(document.getElementById('tg-unlink-btn').classList.contains('hidden')).toBe(true);
  expect(document.getElementById('tg-channel-btn').textContent).toMatch(/Telegram/);
});

test('linked state shows unlink instead; confirmed unlink calls the callable', async () => {
  telegramLinkState.mockReturnValue({ linked: true });
  const { initTelegramSettings } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  expect(document.getElementById('tg-link-btn').classList.contains('hidden')).toBe(true);
  const unlinkBtn = document.getElementById('tg-unlink-btn');
  expect(unlinkBtn.classList.contains('hidden')).toBe(false);
  unlinkBtn.click();
  document.getElementById('tg-unlink-confirm-btn').click();
  await flush();
  expect(callUnlinkTelegram).toHaveBeenCalledWith('signed-init-data');
});

test('channel toggle flips telegram → push and persists', async () => {
  const { initTelegramSettings } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  const btn = document.getElementById('tg-channel-btn');
  btn.click();
  await flush();
  expect(mergeUserPrefs).toHaveBeenCalledWith('u1', { notifyChannel: 'push' });
  expect(btn.textContent).toMatch(/Push/);
});

test('link flow: opens restore screen, validates phrase, calls linkTelegram', async () => {
  const { initTelegramSettings } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  document.getElementById('tg-link-btn').click();
  const screen = document.getElementById('restore-screen');
  expect(screen.classList.contains('hidden')).toBe(false);
  const subtext = document.getElementById('restore-subtext');
  expect(subtext.classList.contains('hidden')).toBe(false);
  expect(subtext.textContent).toMatch(/will be removed/);
  // Invalid phrase → inline error, no call.
  document.getElementById('restore-input').value = 'not a phrase';
  document.getElementById('restore-submit-btn').click();
  await flush();
  expect(callLinkTelegram).not.toHaveBeenCalled();
  expect(document.getElementById('restore-error').classList.contains('hidden')).toBe(false);
  // Valid phrase → callable hit. (Words are from the EFF list — parseRecoveryCode checks WORDSET.)
  document.getElementById('restore-input').value = 'abacus-abdomen-abdominal-abide';
  document.getElementById('restore-submit-btn').click();
  await flush();
  expect(callLinkTelegram).toHaveBeenCalledWith('signed-init-data', 'abacus-abdomen-abdominal-abide');
});

test('unlink: first tap expands confirm, does not call unlinkTelegram', async () => {
  telegramLinkState.mockReturnValue({ linked: true });
  const { initTelegramSettings } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  document.getElementById('tg-unlink-btn').click();
  expect(document.getElementById('tg-unlink-confirm').classList.contains('hidden')).toBe(false);
  expect(callUnlinkTelegram).not.toHaveBeenCalled();
});

test('unlink: cancel collapses confirm', async () => {
  telegramLinkState.mockReturnValue({ linked: true });
  const { initTelegramSettings } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  document.getElementById('tg-unlink-btn').click();
  document.getElementById('tg-unlink-cancel-btn').click();
  expect(document.getElementById('tg-unlink-confirm').classList.contains('hidden')).toBe(true);
});

test('unlink: confirm stamps kk-landing and calls unlinkTelegram', async () => {
  telegramLinkState.mockReturnValue({ linked: true });
  const { initTelegramSettings } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  document.getElementById('tg-unlink-btn').click();
  document.getElementById('tg-unlink-confirm-btn').click();
  await Promise.resolve(); await Promise.resolve();
  expect(callUnlinkTelegram).toHaveBeenCalled();
  expect(sessionStorage.getItem('kk-landing')).toBe('unlinked');
});

test('link success stamps kk-landing=linked before reload', async () => {
  const { initTelegramSettings } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  document.getElementById('tg-link-btn').click();
  document.getElementById('restore-input').value = 'abacus-abdomen-abdominal-abide';
  document.getElementById('restore-submit-btn').click();
  await flush();
  expect(callLinkTelegram).toHaveBeenCalledWith('signed-init-data', 'abacus-abdomen-abdominal-abide');
  expect(sessionStorage.getItem('kk-landing')).toBe('linked');
});
