// js/graduation.js — the "use the app outside Telegram" graduation flow (spec §7).
// Reached from a small "?" affordance in the guided empty state AND the drawer
// Account section: it opens the shared confirm-overlay primitive as an info
// dialog; "I want an account" starts the reveal-and-migrate ceremony (recovery
// modal → graduateTelegram).
import { tgWebApp } from './telegram.js';
import { callGraduateTelegram } from './firebase-config.js';
import { generateRecoveryCode, deriveUserIdFromRecoveryCode } from './identity.js';
import { showRecoveryCodeModal } from './recoveryModal.js';
import { stampGraduationNotice } from './firstRun.js';
import { storeGraduatedPhrase } from './graduationPhrase.js';
import { showConfirmModal } from './promptModal.js';

const INFO_TEXT = 'With an account you can use KnockKnock outside of Telegram.';
// Approved copy (spec §7): the recovery-modal knobs for the graduation variant.
const GRADUATE_INTRO = 'To use the app outside Telegram you get a secret phrase — it opens this same account in any browser.';
const GRADUATE_WARNING = "Save this somewhere safe. It's how you sign in outside Telegram, and the only way to restore your account if you lose access to Telegram. We can't recover it for you.";

// Info dialog on the shared confirm-overlay primitive (js/promptModal.js):
// gets backdrop-tap / Escape / Cancel dismissal for free (same #confirm-modal
// markup as the unlink confirm in telegramSettings.js). "I want an account" →
// startGraduation; Close (or backdrop/Escape) just closes it. Unlike the
// destructive confirms elsewhere (unlink/delete/leave), this CTA is positive,
// so it opts into the affirmative button variant + a "Close" cancel label
// instead of the shared default "Cancel".
export function showGraduationInfo() {
  showConfirmModal({
    title: '',
    message: INFO_TEXT,
    confirmLabel: 'I want an account',
    confirmVariant: 'affirmative',
    cancelLabel: 'Close',
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
    // J#11: stash the phrase locally (keyed by its derived uid) so the drawer
    // can re-reveal it after the reload — the client won't hold it again.
    storeGraduatedPhrase(await deriveUserIdFromRecoveryCode(rc), rc);
    stampGraduationNotice(); // boot reads this and toasts the confirmation
    window.location.reload();
  }, { intro: GRADUATE_INTRO, warning: GRADUATE_WARNING, cancellable: true });
}
