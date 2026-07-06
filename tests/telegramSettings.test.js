// tests/telegramSettings.test.js — Telegram drawer settings row.
jest.mock('../js/telegram.js', () => ({
  tgWebApp: () => ({ initData: 'signed-init-data' }),
  telegramLinkState: jest.fn(() => ({ linked: false })),
}));
jest.mock('../js/firebase-config.js', () => ({
  callLinkTelegram: jest.fn(async () => ({ token: 't' })),
  callUnlinkTelegram: jest.fn(async () => ({ token: 't' })),
  callGraduateTelegram: jest.fn(async () => ({ ok: true, uid: 'newuid' })),
}));
jest.mock('../js/db.js', () => ({
  getUserPrefs: jest.fn(async () => ({ notifyChannel: 'telegram' })),
  mergeUserPrefs: jest.fn(async () => {}),
}));
jest.mock('../js/recoveryModal.js', () => ({ showRecoveryCodeModal: jest.fn(async () => 'phrase') }));
jest.mock('../js/identity.js', () => ({
  parseRecoveryCode: (s) => (/^[a-z]+(-[a-z]+){3}$/.test((s || '').trim()) ? s.trim() : null),
  generateRecoveryCode: jest.fn(() => 'able-baker-charlie-delta'),
}));
jest.mock('../js/firstRun.js', () => ({ stampLanding: jest.fn() }));
const { telegramLinkState } = require('../js/telegram.js');
const { callLinkTelegram, callUnlinkTelegram, callGraduateTelegram } = require('../js/firebase-config.js');
const { showRecoveryCodeModal } = require('../js/recoveryModal.js');
const { stampLanding } = require('../js/firstRun.js');
const { generateRecoveryCode } = require('../js/identity.js');

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
  expect(document.getElementById('tg-account-slot').contains(document.getElementById('tg-link-btn'))).toBe(true);
  expect(document.getElementById('tg-account-slot').contains(document.getElementById('tg-unlink-btn'))).toBe(true);
  expect(document.getElementById('tg-link-btn').classList.contains('hidden')).toBe(false);
  expect(document.getElementById('tg-unlink-btn').classList.contains('hidden')).toBe(true);
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

describe('graduation ("use the app outside Telegram")', () => {
  const GRAD_INTRO = 'To use the app outside Telegram you get a secret phrase — it opens this same account in any browser.';
  const GRAD_WARNING = "Save this somewhere safe. It's how you sign in outside Telegram, and the only way to restore your account if you lose access to Telegram. We can't recover it for you.";
  beforeEach(() => {
    // resetAllMocks (outer beforeEach) wipes mock implementations — re-establish
    // the ones this flow drives.
    generateRecoveryCode.mockReturnValue('able-baker-charlie-delta');
    showRecoveryCodeModal.mockImplementation(async () => 'phrase');
    callGraduateTelegram.mockResolvedValue({ ok: true, uid: 'newuid' });
  });

  test('unlinked account shows the graduation entry with the approved copy', async () => {
    const { initTelegramSettings } = require('../js/telegramSettings.js');
    initTelegramSettings('u1');
    await flush();
    const btn = document.getElementById('tg-graduate-btn');
    expect(btn).not.toBeNull();
    expect(btn.classList.contains('hidden')).toBe(false);
    expect(btn.textContent).toBe('I also want to use the app outside of Telegram');
  });

  test('linked account does NOT show the graduation entry', async () => {
    telegramLinkState.mockReturnValue({ linked: true });
    const { initTelegramSettings } = require('../js/telegramSettings.js');
    initTelegramSettings('u1');
    await flush();
    const btn = document.getElementById('tg-graduate-btn');
    expect(btn === null || btn.classList.contains('hidden')).toBe(true);
  });

  test('clicking opens the recovery modal with the graduation knobs', async () => {
    const { initTelegramSettings } = require('../js/telegramSettings.js');
    initTelegramSettings('u1');
    await flush();
    document.getElementById('tg-graduate-btn').click();
    expect(showRecoveryCodeModal).toHaveBeenCalledTimes(1);
    const [initial, onConfirm, opts] = showRecoveryCodeModal.mock.calls[0];
    expect(initial).toBe('able-baker-charlie-delta'); // generateRecoveryCode()
    expect(typeof onConfirm).toBe('function');
    expect(opts).toMatchObject({ intro: GRAD_INTRO, warning: GRAD_WARNING, cancellable: true });
  });

  // jsdom's window.location.reload is a non-throwing no-op that can't be spied
  // reliably here, so these assert stampLanding('graduated') — the observable
  // gate immediately before the reload — rather than the reload itself.
  test('onConfirm success: graduates then stamps the landing marker', async () => {
    const { initTelegramSettings } = require('../js/telegramSettings.js');
    initTelegramSettings('u1');
    await flush();
    document.getElementById('tg-graduate-btn').click();
    const onConfirm = showRecoveryCodeModal.mock.calls[0][1];
    await onConfirm('gamma-delta-echo-foxtrot');
    expect(callGraduateTelegram).toHaveBeenCalledWith('signed-init-data', 'gamma-delta-echo-foxtrot');
    expect(stampLanding).toHaveBeenCalledWith('graduated');
  });

  test('onConfirm collision: throws a userMessage, does NOT stamp the landing', async () => {
    callGraduateTelegram.mockRejectedValueOnce(Object.assign(new Error('taken'), { code: 'functions/already-exists' }));
    const { initTelegramSettings } = require('../js/telegramSettings.js');
    initTelegramSettings('u1');
    await flush();
    document.getElementById('tg-graduate-btn').click();
    const onConfirm = showRecoveryCodeModal.mock.calls[0][1];
    await expect(onConfirm('gamma-delta-echo-foxtrot')).rejects.toMatchObject({
      userMessage: expect.stringMatching(/taken|already|↻/i),
    });
    expect(stampLanding).not.toHaveBeenCalled();
  });
});
