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
    <div id="code-drawer">
      <div class="drawer-inner">
        <div class="drawer-section" id="drawer-section-invite"></div>
        <div class="drawer-section hidden" id="drawer-section-account">
          <div id="tg-account-slot"></div>
        </div>
        <div class="drawer-section hidden" id="drawer-section-notifications">
          <div id="tg-notify-slot"></div>
        </div>
      </div>
    </div>
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

beforeEach(() => { jest.resetAllMocks(); sessionStorage.clear(); mountDom(); });

test('renders row, hides phrase pill, shows link button when unlinked', async () => {
  const { initTelegramSettings } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  expect(document.getElementById('recovery-pill-row').classList.contains('hidden')).toBe(true);
  expect(document.getElementById('drawer-section-account').classList.contains('hidden')).toBe(false);
  // Unlinked: the notification-channel toggle has no meaning (a Telegram-derived
  // account can only receive via Telegram), so its section stays hidden.
  expect(document.getElementById('drawer-section-notifications').classList.contains('hidden')).toBe(true);
  expect(document.getElementById('tg-account-slot').contains(document.getElementById('tg-link-btn'))).toBe(true);
  expect(document.getElementById('tg-account-slot').contains(document.getElementById('tg-unlink-btn'))).toBe(true);
  expect(document.getElementById('tg-notify-slot').contains(document.getElementById('tg-channel-btn'))).toBe(true);
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
  // Linked: the notification-channel toggle is now meaningful (the account can
  // also live on the web with push), so its section is revealed.
  expect(document.getElementById('drawer-section-notifications').classList.contains('hidden')).toBe(false);
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

test('unlink confirm is a modal overlay on the body, not inline in the account section', async () => {
  telegramLinkState.mockReturnValue({ linked: true });
  const { initTelegramSettings } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  const confirm = document.getElementById('tg-unlink-confirm');
  expect(confirm.classList.contains('confirm-overlay')).toBe(true);
  expect(confirm.parentElement).toBe(document.body);
  expect(document.getElementById('tg-account-slot').contains(confirm)).toBe(false);
});

test('unlink: first tap opens the confirm modal, does not call unlinkTelegram', async () => {
  telegramLinkState.mockReturnValue({ linked: true });
  const { initTelegramSettings } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  document.getElementById('tg-unlink-btn').click();
  expect(document.getElementById('tg-unlink-confirm').classList.contains('hidden')).toBe(false);
  expect(callUnlinkTelegram).not.toHaveBeenCalled();
});

test('unlink: cancel closes the confirm modal', async () => {
  telegramLinkState.mockReturnValue({ linked: true });
  const { initTelegramSettings } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  document.getElementById('tg-unlink-btn').click();
  document.getElementById('tg-unlink-cancel-btn').click();
  expect(document.getElementById('tg-unlink-confirm').classList.contains('hidden')).toBe(true);
});

test('unlink: confirm calls unlinkTelegram and does NOT stamp a landing banner', async () => {
  telegramLinkState.mockReturnValue({ linked: true });
  const { initTelegramSettings } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  document.getElementById('tg-unlink-btn').click();
  document.getElementById('tg-unlink-confirm-btn').click();
  await Promise.resolve(); await Promise.resolve();
  expect(callUnlinkTelegram).toHaveBeenCalled();
  expect(sessionStorage.getItem('kk-landing')).toBeNull();
});

test('link success calls linkTelegram and does NOT stamp a landing banner', async () => {
  const { initTelegramSettings } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  document.getElementById('tg-link-btn').click();
  document.getElementById('restore-input').value = 'abacus-abdomen-abdominal-abide';
  document.getElementById('restore-submit-btn').click();
  await flush();
  expect(callLinkTelegram).toHaveBeenCalledWith('signed-init-data', 'abacus-abdomen-abdominal-abide');
  expect(sessionStorage.getItem('kk-landing')).toBeNull();
});
