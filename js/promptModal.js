// js/promptModal.js
import { setButtonBusy, clearButtonBusy } from './utils.js';
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

// showConfirmModal({ title, message?, confirmLabel?, busyLabel?, onConfirm? })
//   → Promise<boolean>
// Resolves true on confirm, false on cancel / overlay-tap / Escape.
// With an async `onConfirm` (W3-A CL#4): the confirm tap runs it with the
// button busy (`busyLabel`, else the confirm label) and the modal stays up;
// cancel/overlay/Escape are inert while it runs — a destructive action must
// not be dismissible mid-round-trip. Resolve → true + close. Throw → inline
// error (e.userMessage or a generic) and the modal stays open for retry or
// cancel. Same onConfirm/userMessage convention as recoveryModal.
export function showConfirmModal({ title, message = '', confirmLabel = 'Confirm', busyLabel = null, onConfirm = null }) {
  const overlay = document.getElementById('confirm-modal');
  const titleEl = document.getElementById('confirm-modal-title');
  const messageEl = document.getElementById('confirm-modal-message');
  const confirmBtn = document.getElementById('confirm-modal-confirm-btn');
  const cancelBtn = document.getElementById('confirm-modal-cancel-btn');
  const errEl = document.getElementById('confirm-modal-error');

  titleEl.textContent = title;
  messageEl.textContent = message;
  // Scrub prior-modal residue: the error line, and the busy pair's stashed
  // idle label (setButtonBusy stashes once per element — a stale stash from a
  // different confirmLabel would resurface on this modal's busy revert).
  if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }
  delete confirmBtn.dataset.idleLabel;
  confirmBtn.textContent = confirmLabel;
  overlay.classList.remove('hidden');

  let busy = false;
  return new Promise((resolve) => {
    function cleanup() {
      confirmBtn.removeEventListener('click', onConfirmTap);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlay);
      document.removeEventListener('keydown', onKey);
    }
    function finish(result) {
      cleanup();
      overlay.classList.add('hidden');
      resolve(result);
    }
    async function onConfirmTap() {
      if (busy) return;
      if (!onConfirm) { finish(true); return; }
      if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }
      busy = true;
      setButtonBusy(confirmBtn, busyLabel || confirmLabel);
      try {
        await onConfirm();
      } catch (e) {
        busy = false;
        clearButtonBusy(confirmBtn);
        if (errEl) {
          errEl.textContent = e?.userMessage || "Couldn't finish that right now. Try again.";
          errEl.classList.remove('hidden');
        }
        return; // stays open for retry or cancel
      }
      busy = false;
      clearButtonBusy(confirmBtn);
      finish(true);
    }
    function onCancel() { if (!busy) finish(false); }
    function onOverlay(e) { if (!busy && e.target === overlay) finish(false); }
    function onKey(e) { if (!busy && e.key === 'Escape') finish(false); }
    confirmBtn.addEventListener('click', onConfirmTap);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKey);
  });
}
