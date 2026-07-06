// tests/promptModal.test.js
const { showTextPrompt, showConfirmModal } = require('../js/promptModal.js');

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
});
