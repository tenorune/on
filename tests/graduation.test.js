// tests/graduation.test.js — the "use the app outside Telegram" flow (spec §7):
// the shared confirm-overlay primitive (js/promptModal.js showConfirmModal) +
// the recovery-modal migration ceremony.
//
// showConfirmModal (js/promptModal.js) is NOT mocked here — it drives the real
// #confirm-modal markup (backdrop-tap / Escape / Cancel wired by runModal), so
// the fixture below mirrors the exact DOM shape used by
// tests/promptModal.test.js and tests/telegramSettings.test.js.
jest.mock('../js/telegram.js', () => ({ tgWebApp: () => ({ initData: 'signed-init-data' }) }));
jest.mock('../js/firebase-config.js', () => ({ callGraduateTelegram: jest.fn(async () => ({ ok: true, uid: 'newuid' })) }));
jest.mock('../js/identity.js', () => ({
  generateRecoveryCode: jest.fn(() => 'able-baker-charlie-delta'),
  deriveUserIdFromRecoveryCode: jest.fn(async (rc) => `uid-${rc}`),
}));
jest.mock('../js/recoveryModal.js', () => ({ showRecoveryCodeModal: jest.fn(async () => 'phrase') }));
jest.mock('../js/firstRun.js', () => ({ stampGraduationNotice: jest.fn() }));
jest.mock('../js/graduationPhrase.js', () => ({ storeGraduatedPhrase: jest.fn() }));

const { callGraduateTelegram } = require('../js/firebase-config.js');
const { showRecoveryCodeModal } = require('../js/recoveryModal.js');
const { stampGraduationNotice } = require('../js/firstRun.js');
const { generateRecoveryCode, deriveUserIdFromRecoveryCode } = require('../js/identity.js');

const flush = () => new Promise((r) => setTimeout(r, 0));

const GRAD_INTRO = 'To use the app outside Telegram you get a secret phrase — it opens this same account in any browser.';
const GRAD_WARNING = "Save this somewhere safe. It's how you sign in outside Telegram, and the only way to restore your account if you lose access to Telegram. We can't recover it for you.";

function mountConfirmModalDom() {
  document.body.innerHTML = `
    <div id="confirm-modal" class="confirm-overlay hidden">
      <div class="confirm-sheet">
        <h4 id="confirm-modal-title"></h4>
        <p id="confirm-modal-message"></p>
        <p id="confirm-modal-error" class="error-msg hidden"></p>
        <div class="confirm-btns">
          <button id="confirm-modal-cancel-btn" class="confirm-btn-cancel">Cancel</button>
          <button id="confirm-modal-confirm-btn" class="confirm-btn-remove"></button>
        </div>
      </div>
    </div>`;
}

beforeEach(() => {
  jest.resetAllMocks();
  mountConfirmModalDom();
  generateRecoveryCode.mockReturnValue('able-baker-charlie-delta');
  deriveUserIdFromRecoveryCode.mockImplementation(async (rc) => `uid-${rc}`);
  showRecoveryCodeModal.mockImplementation(async () => 'phrase');
  callGraduateTelegram.mockResolvedValue({ ok: true, uid: 'newuid' });
});

describe('showGraduationInfo', () => {
  test('mounts the shared confirm-overlay (not the old #graduation-info-toast) with the approved copy', () => {
    const { showGraduationInfo } = require('../js/graduation.js');
    showGraduationInfo();
    expect(document.getElementById('graduation-info-toast')).toBeNull();
    const overlay = document.querySelector('.confirm-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('confirm-modal-message').textContent)
      .toBe('An account gives you a secret phrase — it opens this same account in any browser, and it’s your only way back in if you ever lose access to Telegram.');
    expect(document.getElementById('confirm-modal-confirm-btn').textContent).toBe('I want an account');
    const confirmBtn = document.getElementById('confirm-modal-confirm-btn');
    expect(confirmBtn.classList.contains('confirm-btn-generate')).toBe(true);
    expect(confirmBtn.classList.contains('confirm-btn-remove')).toBe(false);
    expect(document.getElementById('confirm-modal-cancel-btn').textContent).toBe('Close');
  });

  test('confirming "I want an account" closes the overlay and starts graduation (recovery modal opens with the graduation knobs)', async () => {
    const { showGraduationInfo } = require('../js/graduation.js');
    showGraduationInfo();
    document.getElementById('confirm-modal-confirm-btn').click();
    expect(document.querySelector('.confirm-overlay').classList.contains('hidden')).toBe(true);
    await flush(); // let the confirm promise's .then(startGraduation) run
    expect(showRecoveryCodeModal).toHaveBeenCalledTimes(1);
    const [initial, onConfirm, opts] = showRecoveryCodeModal.mock.calls[0];
    expect(initial).toBe('able-baker-charlie-delta'); // generateRecoveryCode()
    expect(typeof onConfirm).toBe('function');
    expect(opts).toMatchObject({ intro: GRAD_INTRO, warning: GRAD_WARNING, cancellable: true });
  });

  test('Cancel dismisses without starting graduation', async () => {
    const { showGraduationInfo } = require('../js/graduation.js');
    showGraduationInfo();
    document.getElementById('confirm-modal-cancel-btn').click();
    expect(document.querySelector('.confirm-overlay').classList.contains('hidden')).toBe(true);
    await flush();
    expect(showRecoveryCodeModal).not.toHaveBeenCalled();
  });

  test('backdrop tap dismisses without starting graduation', async () => {
    const { showGraduationInfo } = require('../js/graduation.js');
    showGraduationInfo();
    document.querySelector('.confirm-overlay').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.confirm-overlay').classList.contains('hidden')).toBe(true);
    await flush();
    expect(showRecoveryCodeModal).not.toHaveBeenCalled();
  });

  test('Escape dismisses without starting graduation', async () => {
    const { showGraduationInfo } = require('../js/graduation.js');
    showGraduationInfo();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.confirm-overlay').classList.contains('hidden')).toBe(true);
    await flush();
    expect(showRecoveryCodeModal).not.toHaveBeenCalled();
  });
});

describe('startGraduation onConfirm', () => {
  // jsdom's window.location.reload is a non-throwing no-op that can't be spied
  // reliably here, so success is asserted via stampGraduationNotice — the
  // observable gate immediately before the reload.
  test('success: graduates then stamps the landing marker', async () => {
    const { startGraduation } = require('../js/graduation.js');
    startGraduation();
    // startGraduation now awaits generateRecoveryCode (the lazy-load call
    // site) before calling showRecoveryCodeModal, so that call lands a tick
    // after the synchronous call above.
    await flush();
    const onConfirm = showRecoveryCodeModal.mock.calls[0][1];
    await onConfirm('gamma-delta-echo-foxtrot');
    expect(callGraduateTelegram).toHaveBeenCalledWith('signed-init-data', 'gamma-delta-echo-foxtrot');
    expect(stampGraduationNotice).toHaveBeenCalled();
  });

  // J#11 (#285): the phrase is stashed locally (keyed by the phrase-derived uid)
  // so the drawer can re-reveal it after the reload.
  test('success: stores the graduated phrase for the derived uid (J#11)', async () => {
    const { storeGraduatedPhrase } = require('../js/graduationPhrase.js');
    const { startGraduation } = require('../js/graduation.js');
    startGraduation();
    // startGraduation now awaits generateRecoveryCode (the lazy-load call
    // site) before calling showRecoveryCodeModal, so that call lands a tick
    // after the synchronous call above.
    await flush();
    const onConfirm = showRecoveryCodeModal.mock.calls[0][1];
    await onConfirm('gamma-delta-echo-foxtrot');
    expect(storeGraduatedPhrase).toHaveBeenCalledWith('uid-gamma-delta-echo-foxtrot', 'gamma-delta-echo-foxtrot');
  });

  test('failure: throws the single generic userMessage for every code, no stamp', async () => {
    callGraduateTelegram.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'functions/already-exists' }));
    const { startGraduation } = require('../js/graduation.js');
    startGraduation();
    // startGraduation now awaits generateRecoveryCode (the lazy-load call
    // site) before calling showRecoveryCodeModal, so that call lands a tick
    // after the synchronous call above.
    await flush();
    const onConfirm = showRecoveryCodeModal.mock.calls[0][1];
    await expect(onConfirm('gamma-delta-echo-foxtrot')).rejects.toMatchObject({
      userMessage: "Couldn't set that up right now. Try again.",
    });
    expect(stampGraduationNotice).not.toHaveBeenCalled();
  });
});
