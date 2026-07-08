// js/graduation.js — the "use the app outside Telegram" graduation flow (spec §7).
// Reached from a small "?" affordance in the guided empty state AND the drawer
// Account section: it opens the shared confirm-overlay primitive as an info
// dialog; "I want an account" starts the reveal-and-migrate ceremony (recovery
// modal → graduateTelegram).
import { tgWebApp } from './telegram.js';
import { callGraduateTelegram } from './firebase-config.js';
import { generateRecoveryCode } from './identity.js';
import { showRecoveryCodeModal } from './recoveryModal.js';
import { stampGraduationNotice } from './firstRun.js';
import { showConfirmModal } from './promptModal.js';

const INFO_TEXT = 'With an account you can use KnockKnock outside of Telegram.';
// Approved copy (spec §7): the recovery-modal knobs for the graduation variant.
const GRADUATE_INTRO = 'To use the app outside Telegram you get a secret phrase — it opens this same account in any browser.';
const GRADUATE_WARNING = "Save this somewhere safe. It's how you sign in outside Telegram, and the only way to restore your account if you lose access to Telegram. We can't recover it for you.";

// Info dialog on the shared confirm-overlay primitive (js/promptModal.js):
// gets backdrop-tap / Escape / Cancel dismissal for free (same #confirm-modal
// markup as the unlink confirm in telegramSettings.js). "I want an account" →
// startGraduation; Cancel (or backdrop/Escape) just closes it. The primitive
// has no cancelLabel knob, so the button reads the shared "Cancel" — same as
// every other confirm-overlay use in the app.
export function showGraduationInfo() {
  showConfirmModal({
    title: '',
    message: INFO_TEXT,
    confirmLabel: 'I want an account',
  }).then((ok) => { if (ok) startGraduation(); });
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
