// tests/telegramSettings.test.js — Telegram drawer settings row.
jest.mock('../js/telegram.js', () => ({
  tgWebApp: () => ({ initData: 'signed-init-data' }),
  telegramLinkState: jest.fn(() => ({ linked: false })),
  isTelegramLinked: jest.fn(() => false),
}));
jest.mock('../js/firebase-config.js', () => ({
  callLinkTelegram: jest.fn(async () => ({ token: 't' })),
  callUnlinkTelegram: jest.fn(async () => ({ token: 't' })),
}));
jest.mock('../js/db.js', () => ({
  getUserPrefs: jest.fn(async () => ({ notifyChannel: 'telegram' })),
  mergeUserPrefs: jest.fn(async () => {}),
}));
jest.mock('../js/identity.js', () => ({
  parseRecoveryCode: (s) => (/^[a-z]+(-[a-z]+){3}$/.test((s || '').trim()) ? s.trim() : null),
}));
jest.mock('../js/graduation.js', () => ({ showGraduationInfo: jest.fn() }));
const { telegramLinkState, isTelegramLinked } = require('../js/telegram.js');
const { callLinkTelegram, callUnlinkTelegram } = require('../js/firebase-config.js');
const { showGraduationInfo } = require('../js/graduation.js');
const { showLinkScreen } = require('../js/telegramSettings.js');

const flush = () => new Promise((r) => setTimeout(r, 0));

function mountDom() {
  document.body.innerHTML = `
    <div id="code-drawer">
      <div class="drawer-inner">
        <div class="drawer-section" id="drawer-section-invite"></div>
        <div class="drawer-section hidden" id="drawer-section-notifications">
          <div id="tg-notify-slot"></div>
        </div>
        <div class="drawer-section hidden" id="drawer-section-account">
          <div id="tg-account-slot"></div>
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
    </div>
    <div id="confirm-modal" class="confirm-overlay hidden">
      <div class="confirm-sheet">
        <h4 id="confirm-modal-title"></h4>
        <p id="confirm-modal-message"></p>
        <p id="confirm-modal-error" class="error-msg hidden"></p>
        <div class="confirm-btns">
          <button id="confirm-modal-cancel-btn"></button>
          <button id="confirm-modal-confirm-btn"></button>
        </div>
      </div>
    </div>`;
}

beforeEach(() => { jest.resetAllMocks(); sessionStorage.clear(); mountDom(); });

test('renders row, hides phrase pill, shows link button when unlinked', async () => {
  const { initTelegramSettings } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  expect(document.getElementById('recovery-pill-row').classList.contains('hidden')).toBe(true);
  expect(document.getElementById('drawer-section-account').classList.contains('hidden')).toBe(false);
  expect(document.getElementById('tg-account-slot').contains(document.getElementById('tg-link-btn'))).toBe(true);
  expect(document.getElementById('tg-account-slot').contains(document.getElementById('tg-unlink-btn'))).toBe(true);
  expect(document.getElementById('tg-link-btn').classList.contains('hidden')).toBe(false);
  expect(document.getElementById('tg-unlink-btn').classList.contains('hidden')).toBe(true);
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

test('unlink: first tap opens the shared confirm modal with the unlink copy, no callable yet', async () => {
  isTelegramLinked.mockReturnValue(true);
  const { initTelegramSettings } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  document.getElementById('tg-unlink-btn').click();
  expect(document.getElementById('confirm-modal').classList.contains('hidden')).toBe(false);
  expect(document.getElementById('confirm-modal-title').textContent).toBe('Unlink this Telegram?');
  expect(document.getElementById('confirm-modal-message').textContent)
    .toBe('Your account stays yours — sign in with your secret phrase in any browser. This Telegram will start over with a fresh, empty account.');
  expect(document.getElementById('confirm-modal-confirm-btn').textContent).toBe('Unlink');
  expect(callUnlinkTelegram).not.toHaveBeenCalled();
  // No bespoke sheet is injected any more (W3-A CL#4).
  expect(document.getElementById('tg-unlink-confirm')).toBeNull();
});

test('unlink: cancel closes without calling the callable', async () => {
  isTelegramLinked.mockReturnValue(true);
  const { initTelegramSettings } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  document.getElementById('tg-unlink-btn').click();
  document.getElementById('confirm-modal-cancel-btn').click();
  await flush();
  expect(document.getElementById('confirm-modal').classList.contains('hidden')).toBe(true);
  expect(callUnlinkTelegram).not.toHaveBeenCalled();
});

test('unlink: confirm goes busy, calls the callable, does NOT stamp a landing banner', async () => {
  isTelegramLinked.mockReturnValue(true);
  let release;
  callUnlinkTelegram.mockImplementation(() => new Promise((r) => { release = r; }));
  const { initTelegramSettings } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  document.getElementById('tg-unlink-btn').click();
  const confirmBtn = document.getElementById('confirm-modal-confirm-btn');
  confirmBtn.click();
  await flush();
  expect(callUnlinkTelegram).toHaveBeenCalledWith('signed-init-data');
  expect(confirmBtn.disabled).toBe(true);
  expect(confirmBtn.textContent).toBe('Unlinking…');
  release();
  await flush();
  expect(sessionStorage.getItem('kk-landing')).toBeNull();
});

test('unlink failure: inline error in the shared modal, stays open for retry (carries W1 J#7 over)', async () => {
  isTelegramLinked.mockReturnValue(true);
  callUnlinkTelegram.mockRejectedValue(new Error('network'));
  const { initTelegramSettings } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  document.getElementById('tg-unlink-btn').click();
  const confirmBtn = document.getElementById('confirm-modal-confirm-btn');
  confirmBtn.click();
  await flush();
  const err = document.getElementById('confirm-modal-error');
  expect(err.classList.contains('hidden')).toBe(false);
  expect(err.textContent).toBe("Couldn't unlink right now. Try again.");
  expect(document.getElementById('confirm-modal').classList.contains('hidden')).toBe(false);
  expect(confirmBtn.disabled).toBe(false);
  expect(confirmBtn.textContent).toBe('Unlink');
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

test('showLinkScreen resolves false on cancel (W1 J#6)', async () => {
  const p = showLinkScreen();
  document.getElementById('restore-cancel-btn').click();
  await expect(p).resolves.toBe(false);
  expect(document.getElementById('restore-screen').classList.contains('hidden')).toBe(true);
});

test('link submit: shared busy pair + stale idleLabel from the restore flow cannot leak (W3-B CL#7)', async () => {
  const { initTelegramSettings, showLinkScreen } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  const submit = document.getElementById('restore-submit-btn');
  // A prior showRestoreScreen busy cycle leaves its stashed idle label behind.
  submit.dataset.idleLabel = 'Paste & Sign in';
  callLinkTelegram.mockRejectedValue(new Error('network'));
  showLinkScreen();
  document.getElementById('restore-input').value = 'abacus-abdomen-abdominal-abide';
  submit.click();
  expect(submit.disabled).toBe(true);
  expect(submit.textContent).toBe('Linking…');
  await flush();
  // Failure reverts to THIS screen's label, not the restore flow's stash.
  expect(submit.disabled).toBe(false);
  expect(submit.textContent).toBe('Link account');
  expect(document.getElementById('restore-error').classList.contains('hidden')).toBe(false);
});

describe('graduation "?" affordance', () => {
  test('unlinked account shows the "?" badge next to the link entry', async () => {
    const { initTelegramSettings } = require('../js/telegramSettings.js');
    initTelegramSettings('u1');
    await flush();
    const badge = document.getElementById('tg-graduate-help');
    expect(badge).not.toBeNull();
    expect(badge.classList.contains('hidden')).toBe(false);
    expect(badge.textContent).toBe('?');
  });

  test('linked account hides the "?" badge', async () => {
    isTelegramLinked.mockReturnValue(true);
    const { initTelegramSettings } = require('../js/telegramSettings.js');
    initTelegramSettings('u1');
    await flush();
    const badge = document.getElementById('tg-graduate-help');
    expect(badge === null || badge.classList.contains('hidden')).toBe(true);
  });

  test('clicking "?" opens the graduation info toast', async () => {
    const { initTelegramSettings } = require('../js/telegramSettings.js');
    initTelegramSettings('u1');
    await flush();
    document.getElementById('tg-graduate-help').click();
    expect(showGraduationInfo).toHaveBeenCalledTimes(1);
  });
});
