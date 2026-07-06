// tests/graduation.test.js — the "use the app outside Telegram" flow (spec §7):
// the info toast + the recovery-modal migration ceremony.
jest.mock('../js/telegram.js', () => ({ tgWebApp: () => ({ initData: 'signed-init-data' }) }));
jest.mock('../js/firebase-config.js', () => ({ callGraduateTelegram: jest.fn(async () => ({ ok: true, uid: 'newuid' })) }));
jest.mock('../js/identity.js', () => ({ generateRecoveryCode: jest.fn(() => 'able-baker-charlie-delta') }));
jest.mock('../js/recoveryModal.js', () => ({ showRecoveryCodeModal: jest.fn(async () => 'phrase') }));
jest.mock('../js/firstRun.js', () => ({ stampLanding: jest.fn() }));

const { callGraduateTelegram } = require('../js/firebase-config.js');
const { showRecoveryCodeModal } = require('../js/recoveryModal.js');
const { stampLanding } = require('../js/firstRun.js');
const { generateRecoveryCode } = require('../js/identity.js');

const GRAD_INTRO = 'To use the app outside Telegram you get a secret phrase — it opens this same account in any browser.';
const GRAD_WARNING = "Save this somewhere safe. It's how you sign in outside Telegram, and the only way to restore your account if you lose access to Telegram. We can't recover it for you.";

beforeEach(() => {
  jest.resetAllMocks();
  document.body.innerHTML = '';
  generateRecoveryCode.mockReturnValue('able-baker-charlie-delta');
  showRecoveryCodeModal.mockImplementation(async () => 'phrase');
  callGraduateTelegram.mockResolvedValue({ ok: true, uid: 'newuid' });
});

describe('showGraduationInfo', () => {
  test('renders the two-button info toast with the approved copy', () => {
    const { showGraduationInfo } = require('../js/graduation.js');
    showGraduationInfo();
    const toast = document.getElementById('graduation-info-toast');
    expect(toast).not.toBeNull();
    expect(toast.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('graduation-info-text').textContent)
      .toBe('With an account you can use KnockKnock outside of Telegram.');
    expect(document.getElementById('graduation-info-close').textContent).toBe('Close');
    expect(document.getElementById('graduation-info-go').textContent).toBe('I want an account');
  });

  test('is idempotent — reopening reuses the single toast element', () => {
    const { showGraduationInfo } = require('../js/graduation.js');
    showGraduationInfo();
    document.getElementById('graduation-info-close').click();
    expect(document.getElementById('graduation-info-toast').classList.contains('hidden')).toBe(true);
    showGraduationInfo();
    expect(document.querySelectorAll('#graduation-info-toast').length).toBe(1);
    expect(document.getElementById('graduation-info-toast').classList.contains('hidden')).toBe(false);
  });

  test('Close dismisses without starting graduation', () => {
    const { showGraduationInfo } = require('../js/graduation.js');
    showGraduationInfo();
    document.getElementById('graduation-info-close').click();
    expect(showRecoveryCodeModal).not.toHaveBeenCalled();
  });

  test('"I want an account" hides the toast and opens the recovery modal with the graduation knobs', () => {
    const { showGraduationInfo } = require('../js/graduation.js');
    showGraduationInfo();
    document.getElementById('graduation-info-go').click();
    expect(document.getElementById('graduation-info-toast').classList.contains('hidden')).toBe(true);
    expect(showRecoveryCodeModal).toHaveBeenCalledTimes(1);
    const [initial, onConfirm, opts] = showRecoveryCodeModal.mock.calls[0];
    expect(initial).toBe('able-baker-charlie-delta'); // generateRecoveryCode()
    expect(typeof onConfirm).toBe('function');
    expect(opts).toMatchObject({ intro: GRAD_INTRO, warning: GRAD_WARNING, cancellable: true });
  });
});

describe('startGraduation onConfirm', () => {
  // jsdom's window.location.reload is a non-throwing no-op that can't be spied
  // reliably here, so success is asserted via stampLanding — the observable gate
  // immediately before the reload.
  test('success: graduates then stamps the landing marker', async () => {
    const { startGraduation } = require('../js/graduation.js');
    startGraduation();
    const onConfirm = showRecoveryCodeModal.mock.calls[0][1];
    await onConfirm('gamma-delta-echo-foxtrot');
    expect(callGraduateTelegram).toHaveBeenCalledWith('signed-init-data', 'gamma-delta-echo-foxtrot');
    expect(stampLanding).toHaveBeenCalledWith('graduated');
  });

  test('failure: throws the single generic userMessage for every code, no stamp', async () => {
    callGraduateTelegram.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'functions/already-exists' }));
    const { startGraduation } = require('../js/graduation.js');
    startGraduation();
    const onConfirm = showRecoveryCodeModal.mock.calls[0][1];
    await expect(onConfirm('gamma-delta-echo-foxtrot')).rejects.toMatchObject({
      userMessage: "Couldn't set that up right now. Try again.",
    });
    expect(stampLanding).not.toHaveBeenCalled();
  });
});
