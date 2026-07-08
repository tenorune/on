// js/promptModal.js
import { setButtonBusy, clearButtonBusy } from './utils.js';
// Promise-based in-app text-prompt + confirm modals. These replace
// window.prompt / window.confirm, which are unsupported in some webviews
// (notably Telegram's macOS Desktop client — they return null / no-op, so a
// rename or delete silently did nothing there). Reuses the existing modal
// styles: the invite/create-group `.modal-overlay` for the text prompt and the
// rotate/unfollow `.confirm-overlay` for the confirm.

// runModal(overlay, { confirmBtn, cancelBtn, cancelValue, onConfirmTap }) — the
// one promise/cleanup/overlay-tap/Escape harness both modals ride (W3-B CL#6).
// onConfirmTap({ finish, setBusy, clearBusy }) decides per tap whether to
// finish; cancel / overlay-tap / Escape → finish(cancelValue), inert while a
// busy round-trip runs.
function runModal(overlay, { confirmBtn, cancelBtn, cancelValue, onConfirmTap }) {
  let busy = false;
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
      if (busy) return;
      onConfirmTap({
        finish,
        setBusy(label) { busy = true; setButtonBusy(confirmBtn, label); },
        clearBusy() { busy = false; clearButtonBusy(confirmBtn); },
      });
    }
    function onCancel() { if (!busy) finish(cancelValue); }
    function onOverlay(e) { if (!busy && e.target === overlay) finish(cancelValue); }
    function onKey(e) { if (!busy && e.key === 'Escape') finish(cancelValue); }
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKey);
  });
}

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

  return runModal(overlay, {
    confirmBtn,
    cancelBtn,
    cancelValue: null,
    onConfirmTap({ finish }) {
      const trimmed = (input.value || '').trim();
      if (!trimmed) { errEl.textContent = 'Please enter a value.'; errEl.classList.remove('hidden'); return; }
      if (trimmed.length > maxLength) { errEl.textContent = `Must be at most ${maxLength} characters.`; errEl.classList.remove('hidden'); return; }
      finish(trimmed);
    },
  });
}

// showConfirmModal({ title, message?, confirmLabel?, confirmVariant?,
//   cancelLabel?, busyLabel?, onConfirm? }) → Promise<boolean>
// Resolves true on confirm, false on cancel / overlay-tap / Escape.
// `confirmVariant` ('destructive' default | 'affirmative') selects the
// confirm button's styling — the reused #confirm-modal singleton gets its
// variant class (re)applied every call so a prior caller's variant can't
// leak into the next one. `cancelLabel` (default 'Cancel') overrides the
// cancel button's text the same way.
// With an async `onConfirm` (W3-A CL#4): the confirm tap runs it with the
// button busy (`busyLabel`, else the confirm label) and the modal stays up;
// cancel/overlay/Escape are inert while it runs — a destructive action must
// not be dismissible mid-round-trip. Resolve → true + close. Throw → inline
// error (e.userMessage or a generic) and the modal stays open for retry or
// cancel. Same onConfirm/userMessage convention as recoveryModal.
export function showConfirmModal({ title, message = '', confirmLabel = 'Confirm', confirmVariant = 'destructive', cancelLabel = 'Cancel', busyLabel = null, onConfirm = null }) {
  const overlay = document.getElementById('confirm-modal');
  const titleEl = document.getElementById('confirm-modal-title');
  const messageEl = document.getElementById('confirm-modal-message');
  const confirmBtn = document.getElementById('confirm-modal-confirm-btn');
  const cancelBtn = document.getElementById('confirm-modal-cancel-btn');
  const errEl = document.getElementById('confirm-modal-error');

  titleEl.textContent = title;
  messageEl.textContent = message;
  if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }
  delete confirmBtn.dataset.idleLabel; // scrub a prior modal's busy stash
  confirmBtn.textContent = confirmLabel;
  cancelBtn.textContent = cancelLabel;
  confirmBtn.classList.remove('confirm-btn-remove', 'confirm-btn-generate');
  confirmBtn.classList.add(confirmVariant === 'affirmative' ? 'confirm-btn-generate' : 'confirm-btn-remove');
  overlay.classList.remove('hidden');

  return runModal(overlay, {
    confirmBtn,
    cancelBtn,
    cancelValue: false,
    async onConfirmTap({ finish, setBusy, clearBusy }) {
      if (!onConfirm) { finish(true); return; }
      if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }
      setBusy(busyLabel || confirmLabel);
      try {
        await onConfirm();
      } catch (e) {
        clearBusy();
        if (errEl) {
          errEl.textContent = e?.userMessage || "Couldn't finish that right now. Try again.";
          errEl.classList.remove('hidden');
        }
        return; // stays open for retry or cancel
      }
      clearBusy();
      finish(true);
    },
  });
}
