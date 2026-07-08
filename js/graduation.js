// js/graduation.js — the "use the app outside Telegram" graduation flow (spec §7).
// Reached from a small "?" affordance in the guided empty state AND the drawer
// Account section: it opens a two-button info toast; "I want an account" starts
// the reveal-and-migrate ceremony (recovery modal → graduateTelegram).
import { tgWebApp } from './telegram.js';
import { callGraduateTelegram } from './firebase-config.js';
import { generateRecoveryCode } from './identity.js';
import { showRecoveryCodeModal } from './recoveryModal.js';
import { stampGraduationNotice } from './firstRun.js';

const INFO_TEXT = 'With an account you can use KnockKnock outside of Telegram.';
// Approved copy (spec §7): the recovery-modal knobs for the graduation variant.
const GRADUATE_INTRO = 'To use the app outside Telegram you get a secret phrase — it opens this same account in any browser.';
const GRADUATE_WARNING = "Save this somewhere safe. It's how you sign in outside Telegram, and the only way to restore your account if you lose access to Telegram. We can't recover it for you.";

// Two-button info toast, built once and reused (idempotent across opens). "I
// want an account" → startGraduation; "Close" dismisses.
export function showGraduationInfo() {
  ensureInfoToast().classList.remove('hidden');
}

function ensureInfoToast() {
  const existing = document.getElementById('graduation-info-toast');
  if (existing) return existing;
  const el = document.createElement('div');
  el.id = 'graduation-info-toast';
  el.className = 'graduation-toast';
  el.setAttribute('role', 'dialog');
  el.innerHTML = `
    <span id="graduation-info-text">${INFO_TEXT}</span>
    <div class="graduation-toast-btns">
      <button id="graduation-info-close" class="ghost-btn" type="button">Close</button>
      <button id="graduation-info-go" class="primary-btn" type="button">I want an account</button>
    </div>`;
  document.body.appendChild(el);
  const hide = () => el.classList.add('hidden');
  el.querySelector('#graduation-info-close').addEventListener('click', hide);
  el.querySelector('#graduation-info-go').addEventListener('click', () => { hide(); startGraduation(); });
  return el;
}

// Reveal a fresh phrase and migrate this unlinked Telegram-derived account to
// its phrase-derived uid (a rename — see functions/telegram-auth.js). The modal
// stays up on failure so ↻-regen + re-tap is the retry; success reloads and
// boot re-auths straight into the now-"linked" account.
export async function startGraduation() {
  await showRecoveryCodeModal(generateRecoveryCode(), async (rc) => {
    try {
      await callGraduateTelegram(tgWebApp().initData, rc);
    } catch (e) {
      throw Object.assign(new Error('graduation failed'), {
        userMessage: "Couldn't set that up right now. Try again.",
      });
    }
    stampGraduationNotice(); // boot reads this and toasts the confirmation
    window.location.reload();
  }, { intro: GRADUATE_INTRO, warning: GRADUATE_WARNING, cancellable: true });
}
