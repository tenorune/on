// js/promptModal.js
// Promise-based in-app text-prompt + confirm modals. These replace
// window.prompt / window.confirm, which are unsupported in some webviews
// (notably Telegram's macOS Desktop client — they return null / no-op, so a
// rename or delete silently did nothing there). Reuses the existing modal
// styles: the invite/create-group `.modal-overlay` for the text prompt and the
// rotate/unfollow `.confirm-overlay` for the confirm.

// showTextPrompt({ title, value?, confirmLabel?, maxLength?, placeholder? })
//   → Promise<string | null>
// Resolves the trimmed input on confirm (rejects empty / over-length inline,
// keeping the modal open), or null on cancel / overlay-tap / Escape.
export function showTextPrompt({ title, value = '', confirmLabel = 'Save', maxLength = 40, placeholder = '' }) {
  const overlay = document.getElementById('text-prompt-modal');
  const titleEl = document.getElementById('text-prompt-title');
  const input = document.getElementById('text-prompt-input');
  const errEl = document.getElementById('text-prompt-error');
  const confirmBtn = document.getElementById('text-prompt-confirm-btn');
  const cancelBtn = document.getElementById('text-prompt-cancel-btn');

  titleEl.textContent = title;
  confirmBtn.textContent = confirmLabel;
  input.value = value;
  input.maxLength = maxLength;
  input.placeholder = placeholder;
  errEl.textContent = '';
  errEl.classList.add('hidden');
  overlay.classList.remove('hidden');
  if (input.focus) input.focus();

  return new Promise((resolve) => {
    function cleanup() {
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlay);
      document.removeEventListener('keydown', onKey);
    }
    function finish(result) {
      cleanup();
      overlay.classList.add('hidden');
      resolve(result);
    }
    function onConfirm() {
      const trimmed = (input.value || '').trim();
      if (!trimmed) { errEl.textContent = 'Please enter a value.'; errEl.classList.remove('hidden'); return; }
      if (trimmed.length > maxLength) { errEl.textContent = `Must be at most ${maxLength} characters.`; errEl.classList.remove('hidden'); return; }
      finish(trimmed);
    }
    function onCancel() { finish(null); }
    function onOverlay(e) { if (e.target === overlay) finish(null); }
    function onKey(e) { if (e.key === 'Escape') finish(null); }
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKey);
  });
}

// showConfirmModal({ title, message?, confirmLabel? }) → Promise<boolean>
// Resolves true on confirm, false on cancel / overlay-tap / Escape.
export function showConfirmModal({ title, message = '', confirmLabel = 'Confirm' }) {
  const overlay = document.getElementById('confirm-modal');
  const titleEl = document.getElementById('confirm-modal-title');
  const messageEl = document.getElementById('confirm-modal-message');
  const confirmBtn = document.getElementById('confirm-modal-confirm-btn');
  const cancelBtn = document.getElementById('confirm-modal-cancel-btn');

  titleEl.textContent = title;
  messageEl.textContent = message;
  confirmBtn.textContent = confirmLabel;
  overlay.classList.remove('hidden');

  return new Promise((resolve) => {
    function cleanup() {
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlay);
      document.removeEventListener('keydown', onKey);
    }
    function finish(result) {
      cleanup();
      overlay.classList.add('hidden');
      resolve(result);
    }
    function onConfirm() { finish(true); }
    function onCancel() { finish(false); }
    function onOverlay(e) { if (e.target === overlay) finish(false); }
    function onKey(e) { if (e.key === 'Escape') finish(false); }
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKey);
  });
}
