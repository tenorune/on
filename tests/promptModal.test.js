// tests/promptModal.test.js
const { showTextPrompt, showConfirmModal } = require('../js/promptModal.js');

const flush = () => new Promise((r) => setTimeout(r, 0));

function setupDom() {
  document.body.innerHTML = `
    <div id="text-prompt-modal" class="modal-overlay hidden">
      <div class="modal-card">
        <h2 id="text-prompt-title"></h2>
        <input id="text-prompt-input" class="text-input" type="text" maxlength="40" />
        <p id="text-prompt-error" class="error-msg hidden"></p>
        <div class="modal-actions">
          <button id="text-prompt-confirm-btn"></button>
          <button id="text-prompt-cancel-btn"></button>
        </div>
      </div>
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

beforeEach(setupDom);

describe('showTextPrompt', () => {
  test('shows the modal with the title + prefilled value; confirm resolves the trimmed value', async () => {
    const p = showTextPrompt({ title: 'New group name', value: 'Family', confirmLabel: 'Save' });
    const modal = document.getElementById('text-prompt-modal');
    expect(modal.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('text-prompt-title').textContent).toBe('New group name');
    expect(document.getElementById('text-prompt-confirm-btn').textContent).toBe('Save');
    const input = document.getElementById('text-prompt-input');
    expect(input.value).toBe('Family');
    input.value = '  Squad  ';
    document.getElementById('text-prompt-confirm-btn').click();
    await expect(p).resolves.toBe('Squad');
    expect(modal.classList.contains('hidden')).toBe(true);
  });

  test('cancel resolves null and closes', async () => {
    const p = showTextPrompt({ title: 'Your name', value: 'Al' });
    document.getElementById('text-prompt-cancel-btn').click();
    await expect(p).resolves.toBeNull();
    expect(document.getElementById('text-prompt-modal').classList.contains('hidden')).toBe(true);
  });

  test('empty input shows an error and keeps the modal open (does not resolve)', async () => {
    const p = showTextPrompt({ title: 'New group name', value: 'Family' });
    const input = document.getElementById('text-prompt-input');
    input.value = '   ';
    document.getElementById('text-prompt-confirm-btn').click();
    expect(document.getElementById('text-prompt-error').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('text-prompt-modal').classList.contains('hidden')).toBe(false);
    // Recover: a valid value still resolves the same promise.
    input.value = 'Squad';
    document.getElementById('text-prompt-confirm-btn').click();
    await expect(p).resolves.toBe('Squad');
  });

  test('overlay click resolves null', async () => {
    const p = showTextPrompt({ title: 'x', value: '' });
    const overlay = document.getElementById('text-prompt-modal');
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // target === overlay via dispatching on the overlay itself
    await expect(p).resolves.toBeNull();
  });
});

describe('showConfirmModal', () => {
  test('confirm resolves true; label + message rendered', async () => {
    const p = showConfirmModal({ title: "Delete 'Family'?", message: 'This cannot be undone.', confirmLabel: 'Delete' });
    expect(document.getElementById('confirm-modal').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('confirm-modal-title').textContent).toBe("Delete 'Family'?");
    expect(document.getElementById('confirm-modal-message').textContent).toBe('This cannot be undone.');
    expect(document.getElementById('confirm-modal-confirm-btn').textContent).toBe('Delete');
    document.getElementById('confirm-modal-confirm-btn').click();
    await expect(p).resolves.toBe(true);
    expect(document.getElementById('confirm-modal').classList.contains('hidden')).toBe(true);
  });

  test('cancel resolves false', async () => {
    const p = showConfirmModal({ title: 'Sure?', confirmLabel: 'Yes' });
    document.getElementById('confirm-modal-cancel-btn').click();
    await expect(p).resolves.toBe(false);
  });

  test('default variant: confirm button is confirm-btn-remove (not confirm-btn-generate); cancel label is "Cancel"', () => {
    showConfirmModal({ title: 'Sure?', confirmLabel: 'Yes' });
    const confirmBtn = document.getElementById('confirm-modal-confirm-btn');
    expect(confirmBtn.classList.contains('confirm-btn-remove')).toBe(true);
    expect(confirmBtn.classList.contains('confirm-btn-generate')).toBe(false);
    expect(document.getElementById('confirm-modal-cancel-btn').textContent).toBe('Cancel');
  });

  test('confirmVariant: "affirmative" renders confirm-btn-generate (not confirm-btn-remove)', () => {
    showConfirmModal({ title: 'Graduate?', confirmLabel: 'I want an account', confirmVariant: 'affirmative' });
    const confirmBtn = document.getElementById('confirm-modal-confirm-btn');
    expect(confirmBtn.classList.contains('confirm-btn-generate')).toBe(true);
    expect(confirmBtn.classList.contains('confirm-btn-remove')).toBe(false);
  });

  test('cancelLabel overrides the cancel button text', () => {
    showConfirmModal({ title: 'Info', confirmLabel: 'I want an account', cancelLabel: 'Close' });
    expect(document.getElementById('confirm-modal-cancel-btn').textContent).toBe('Close');
  });

  test('no-leak: an affirmative call does not stick — a later default call is confirm-btn-remove again', async () => {
    const p1 = showConfirmModal({ title: 'Graduate?', confirmLabel: 'I want an account', confirmVariant: 'affirmative' });
    document.getElementById('confirm-modal-cancel-btn').click();
    await expect(p1).resolves.toBe(false);

    showConfirmModal({ title: 'Delete?', confirmLabel: 'Delete' });
    const confirmBtn = document.getElementById('confirm-modal-confirm-btn');
    expect(confirmBtn.classList.contains('confirm-btn-remove')).toBe(true);
    expect(confirmBtn.classList.contains('confirm-btn-generate')).toBe(false);
  });
});

describe('showConfirmModal with async onConfirm (W3-A CL#4)', () => {
  test('busy label while pending; resolves true and closes on success', async () => {
    let release;
    const onConfirm = jest.fn(() => new Promise((r) => { release = r; }));
    const p = showConfirmModal({ title: 'Unlink?', confirmLabel: 'Unlink', busyLabel: 'Unlinking…', onConfirm });
    const btn = document.getElementById('confirm-modal-confirm-btn');
    btn.click();
    await Promise.resolve();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('Unlinking…');
    release();
    await expect(p).resolves.toBe(true);
    expect(btn.disabled).toBe(false);
    expect(document.getElementById('confirm-modal').classList.contains('hidden')).toBe(true);
  });

  test('failure shows the inline userMessage, stays open, retry resolves', async () => {
    const onConfirm = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('x'), { userMessage: "Couldn't unlink right now. Try again." }))
      .mockResolvedValueOnce(undefined);
    const p = showConfirmModal({ title: 'Unlink?', confirmLabel: 'Unlink', busyLabel: 'Unlinking…', onConfirm });
    const btn = document.getElementById('confirm-modal-confirm-btn');
    btn.click();
    await flush();
    const err = document.getElementById('confirm-modal-error');
    expect(err.classList.contains('hidden')).toBe(false);
    expect(err.textContent).toBe("Couldn't unlink right now. Try again.");
    expect(document.getElementById('confirm-modal').classList.contains('hidden')).toBe(false);
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Unlink');
    btn.click(); // retry
    await expect(p).resolves.toBe(true);
  });

  test('failure without userMessage shows the generic copy; cancel afterwards resolves false', async () => {
    const onConfirm = jest.fn().mockRejectedValue(new Error('network'));
    const p = showConfirmModal({ title: 'x', confirmLabel: 'Go', onConfirm });
    document.getElementById('confirm-modal-confirm-btn').click();
    await flush();
    expect(document.getElementById('confirm-modal-error').textContent)
      .toBe("Couldn't finish that right now. Try again.");
    document.getElementById('confirm-modal-cancel-btn').click();
    await expect(p).resolves.toBe(false);
  });

  test('cancel / overlay / Escape are inert while onConfirm is in flight', async () => {
    let release;
    const onConfirm = () => new Promise((r) => { release = r; });
    const p = showConfirmModal({ title: 'x', busyLabel: 'Working…', onConfirm });
    document.getElementById('confirm-modal-confirm-btn').click();
    await Promise.resolve();
    document.getElementById('confirm-modal-cancel-btn').click();
    document.getElementById('confirm-modal').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('confirm-modal').classList.contains('hidden')).toBe(false);
    release();
    await expect(p).resolves.toBe(true);
  });

  test('error and stale idleLabel are scrubbed on open', async () => {
    // Prior modal leaves an error + a stashed idle label behind.
    const failing = showConfirmModal({ title: 'a', confirmLabel: 'Del', busyLabel: 'Deleting…', onConfirm: jest.fn().mockRejectedValue(new Error('x')) });
    const btn = document.getElementById('confirm-modal-confirm-btn');
    btn.click();
    await flush();
    document.getElementById('confirm-modal-cancel-btn').click();
    await failing;
    // Next modal with a DIFFERENT confirm label: no leftover error, and a
    // failed busy cycle reverts to THIS modal's label, not the prior one's.
    const p = showConfirmModal({ title: 'b', confirmLabel: 'Unlink', busyLabel: 'Unlinking…', onConfirm: jest.fn().mockRejectedValue(new Error('y')) });
    expect(document.getElementById('confirm-modal-error').classList.contains('hidden')).toBe(true);
    btn.click();
    await flush();
    expect(btn.textContent).toBe('Unlink');
    document.getElementById('confirm-modal-cancel-btn').click();
    await expect(p).resolves.toBe(false);
  });
});
