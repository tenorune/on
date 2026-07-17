/** @jest-environment jsdom */
jest.mock('../js/regenFlash.js', () => ({ flashRegenerated: jest.fn() }));
jest.mock('../js/identity.js', () => ({ generateRecoveryCode: jest.fn(() => 'new-phrase-goes-here') }));
const { showRecoveryCodeModal } = require('../js/recoveryModal.js');

const DEFAULT_WARNING = "Save this somewhere safe. It's the only way to restore your account if you lose this browser. We can't recover it for you.";
const GRAD_INTRO = 'To use the app outside Telegram you get a secret phrase — it opens this same account in any browser.';
const GRAD_WARNING = "Save this somewhere safe. It's how you sign in outside Telegram, and the only way to restore your account if you lose access to Telegram. We can't recover it for you.";

beforeEach(() => {
  document.body.innerHTML = `
    <div id="recovery-modal" class="welcome-screen hidden">
      <div class="modal-card">
        <h3>This is your secret phrase</h3>
        <p id="recovery-modal-intro" class="modal-subtitle hidden"></p>
        <div class="recovery-display">
          <span id="recovery-code-text" class="recovery-code-text"></span>
          <span class="regen-slot"><button id="recovery-rotate-btn" class="rotate-btn" title="Generate new secret phrase" aria-label="Generate new secret phrase">↻</button></span>
          <button id="recovery-copy-btn" class="ghost-btn">Copy</button>
        </div>
        <p id="recovery-modal-warning" class="recovery-warning">Save this somewhere safe. It's the only way to restore your account if you lose this browser. We can't recover it for you.</p>
        <form id="recovery-keychain-form" autocomplete="on">
          <input id="recovery-keychain-username" class="visually-hidden" type="text"
                 autocomplete="username" tabindex="-1" readonly aria-hidden="true" />
          <input id="recovery-keychain-phrase" class="visually-hidden" type="password"
                 autocomplete="new-password" tabindex="-1" readonly aria-hidden="true" />
          <button id="recovery-saved-btn" class="primary-btn" type="submit">I've saved it</button>
        </form>
        <p id="recovery-modal-error" class="error-msg hidden"></p>
        <button id="recovery-cancel-btn" class="ghost-btn hidden" type="button">Cancel</button>
      </div>
    </div>`;
});

test('defaults render byte-identical to web signup: no intro, stock warning, no cancel', () => {
  showRecoveryCodeModal('a-b-c-d', null);
  expect(document.getElementById('recovery-modal-intro').classList.contains('hidden')).toBe(true);
  expect(document.getElementById('recovery-modal-warning').textContent).toBe(DEFAULT_WARNING);
  expect(document.getElementById('recovery-cancel-btn').classList.contains('hidden')).toBe(true);
});

test('graduation knobs: intro + warning + cancel visible', () => {
  showRecoveryCodeModal('a-b-c-d', null, { intro: GRAD_INTRO, warning: GRAD_WARNING, cancellable: true });
  expect(document.getElementById('recovery-modal-intro').textContent).toBe(GRAD_INTRO);
  expect(document.getElementById('recovery-modal-warning').textContent).toBe(GRAD_WARNING);
  expect(document.getElementById('recovery-cancel-btn').classList.contains('hidden')).toBe(false);
});

test('cancel resolves null and hides the modal', async () => {
  const p = showRecoveryCodeModal('a-b-c-d', null, { cancellable: true });
  document.getElementById('recovery-cancel-btn').click();
  await expect(p).resolves.toBeNull();
  expect(document.getElementById('recovery-modal').classList.contains('hidden')).toBe(true);
});

test('cancel tears everything down: a later saved-btn click is dead (W3-B CL#11)', async () => {
  const onConfirm = jest.fn(async () => {});
  const p = showRecoveryCodeModal('a-b-c-d', onConfirm, { cancellable: true });
  document.getElementById('recovery-cancel-btn').click();
  await expect(p).resolves.toBeNull();
  document.getElementById('recovery-saved-btn').click();
  await Promise.resolve();
  expect(onConfirm).not.toHaveBeenCalled(); // saved listener was removed
});

test('onConfirm error with userMessage shows inline; a regen clears it', async () => {
  const err = Object.assign(new Error('collision'), { userMessage: 'That phrase is taken.' });
  const onConfirm = jest.fn().mockRejectedValueOnce(err).mockResolvedValueOnce(undefined);
  showRecoveryCodeModal('a-b-c-d', onConfirm, { cancellable: true });
  document.getElementById('recovery-saved-btn').click();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  const errEl = document.getElementById('recovery-modal-error');
  expect(errEl.classList.contains('hidden')).toBe(false);
  expect(errEl.textContent).toBe('That phrase is taken.');
  // Regenerating a new candidate phrase clears the collision error. onRotate
  // is async (it awaits the lazy-loaded generateRecoveryCode), so clearErr()
  // lands a microtask after the click, not synchronously.
  document.getElementById('recovery-rotate-btn').click();
  await Promise.resolve(); await Promise.resolve();
  expect(errEl.classList.contains('hidden')).toBe(true);
});

test('a plain onConfirm error (no userMessage) shows nothing inline — web signup unchanged', async () => {
  const onConfirm = jest.fn().mockRejectedValueOnce(new Error('network'));
  showRecoveryCodeModal('a-b-c-d', onConfirm);
  document.getElementById('recovery-saved-btn').click();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(document.getElementById('recovery-modal-error').classList.contains('hidden')).toBe(true);
});

test('onConfirm failure keeps the modal up; success resolves the phrase', async () => {
  const onConfirm = jest.fn()
    .mockRejectedValueOnce(new Error('collision'))
    .mockResolvedValueOnce(undefined);
  const p = showRecoveryCodeModal('a-b-c-d', onConfirm);
  document.getElementById('recovery-saved-btn').click();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(document.getElementById('recovery-modal').classList.contains('hidden')).toBe(false); // stayed up
  document.getElementById('recovery-saved-btn').click();
  await expect(p).resolves.toBe('a-b-c-d');
});
