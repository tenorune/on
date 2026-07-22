// js/recoveryModal.js — the secret-phrase reveal ceremony, shared by web
// signup (defaults) and the Telegram graduation flow (knobs). Spec §7.
import { generateRecoveryCode } from './identity.js';
import { flashRegenerated } from './regenFlash.js';
import { setButtonBusy, clearButtonBusy, copyWithFeedback } from './utils.js';

const DEFAULT_WARNING = "Save this somewhere safe. It's the only way to restore your account if you lose this browser. We can't recover it for you.";

// `onConfirm` (optional) is an async hook run when the user taps "I've saved it",
// WHILE the modal stays up with the button in a "Setting up…" busy state. The
// modal only hides + resolves once it completes; if it throws, the modal stays
// open and the button reverts so the user can retry. New-account setup
// (sign-in + share-code claim) runs here so the screen doesn't go blank during
// those round-trips (the FTU equivalent of restore's post-submit splash).
//
// `intro`/`warning`/`cancellable` are graduation knobs (Telegram flow): the web
// signup path calls this with no third arg, so the defaults (no intro, stock
// warning, no cancel) must reproduce today's rendering exactly.
export function showRecoveryCodeModal(initialCode: string, onConfirm?: ((code: string) => void | Promise<void>) | null, { intro = null, warning = null, cancellable = false }: { intro?: string | null; warning?: string | null; cancellable?: boolean } = {}): Promise<string | null> {
  const el = document.getElementById('recovery-modal');
  const text = document.getElementById('recovery-code-text')!;
  const rotateBtn = document.getElementById('recovery-rotate-btn')!;
  const copyBtn = document.getElementById('recovery-copy-btn');
  const savedBtn = document.getElementById('recovery-saved-btn') as HTMLButtonElement;
  if (!el) return new Promise<string | null>(() => {}); // not mounted (e.g. partial DOM under test) — stay inert

  const introEl = document.getElementById('recovery-modal-intro');
  if (introEl) {
    introEl.textContent = intro || '';
    introEl.classList.toggle('hidden', !intro);
  }
  const warnEl = document.getElementById('recovery-modal-warning');
  if (warnEl) warnEl.textContent = warning || DEFAULT_WARNING;
  const cancelBtn = document.getElementById('recovery-cancel-btn');
  if (cancelBtn) cancelBtn.classList.toggle('hidden', !cancellable);
  // Inline error surface (graduation): an onConfirm that throws with a
  // `userMessage` shows it here so the modal stays up WITH the error and ↻ is
  // the retry. Cleared on open and on regen. Web signup errors carry no
  // userMessage, so this stays hidden — its rendering is unchanged.
  const errEl = document.getElementById('recovery-modal-error');
  const clearErr = () => { if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); } };
  clearErr();

  let current = initialCode;
  text.textContent = current;
  if (copyBtn) copyBtn.textContent = 'Copy';
  el.classList.remove('hidden');

  const kcPhrase = document.getElementById('recovery-keychain-phrase') as HTMLInputElement | null;
  const kcForm = document.getElementById('recovery-keychain-form');
  if (kcPhrase) kcPhrase.value = current;
  const onKcSubmit = (e: Event) => e.preventDefault();
  if (kcForm) kcForm.addEventListener('submit', onKcSubmit);

  return new Promise<string | null>((resolve) => {
    async function onRotate() {
      current = await generateRecoveryCode();
      text.textContent = current;
      if (kcPhrase) kcPhrase.value = current;
      if (copyBtn) copyBtn.textContent = 'Copy';
      clearErr(); // a new candidate phrase clears the last collision error
      // Same visible-change cue as the invite modal: fade-in + a NEW badge that
      // replaces the ↻ while it shows (which also drops the button's focus, so
      // it never looks "stuck selected").
      flashRegenerated(text, rotateBtn);
    }
    async function onCopy() {
      await copyWithFeedback(copyBtn!, current);
    }
    // Trap the browser/PWA back-gesture so it can't dismiss the modal and discard
    // the un-saved phrase: push a history entry on open, and re-push if a back
    // pops it while the modal is still showing. Net history depth stays +1 (each
    // back pops our entry and we push it again). Removed once the user saves.
    function onPopState() {
      if (!el!.classList.contains('hidden') && typeof history !== 'undefined' && history.pushState) {
        history.pushState({ recoveryModal: true }, '');
      }
    }
    // One teardown for every exit path (W3-B CL#11): a future listener can't
    // be forgotten on one of them.
    function teardown() {
      rotateBtn.removeEventListener('click', onRotate);
      copyBtn!.removeEventListener('click', onCopy);
      savedBtn.removeEventListener('click', onSaved);
      if (cancelBtn) cancelBtn.removeEventListener('click', onCancel);
      window.removeEventListener('popstate', onPopState);
      if (kcForm) kcForm.removeEventListener('submit', onKcSubmit);
      el!.classList.add('hidden');
    }
    async function onSaved() {
      // Run any setup hook first, keeping the modal up with feedback. On failure
      // leave everything mounted so the user can tap again to retry.
      if (onConfirm) {
        setButtonBusy(savedBtn, 'Setting up…');
        try {
          await onConfirm(current);
        } catch (e) {
          console.error('account setup failed:', e);
          const userMessage = (e as { userMessage?: string })?.userMessage;
          if (errEl && userMessage) { errEl.textContent = userMessage; errEl.classList.remove('hidden'); }
          clearButtonBusy(savedBtn);
          return;
        }
      }
      teardown();
      resolve(current);
    }
    function onCancel() {
      teardown();
      resolve(null);
    }
    if (typeof history !== 'undefined' && history.pushState) {
      history.pushState({ recoveryModal: true }, '');
      window.addEventListener('popstate', onPopState);
    }
    rotateBtn.addEventListener('click', onRotate);
    copyBtn!.addEventListener('click', onCopy);
    savedBtn.addEventListener('click', onSaved);
    if (cancellable && cancelBtn) cancelBtn.addEventListener('click', onCancel);
  });
}
