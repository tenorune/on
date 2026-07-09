// js/telegramSettings.js — Telegram-context drawer row: account linking and
// the notification-channel toggle. Only mounted when isTelegramContext().
// The phrase pill is hidden for a plain Telegram-derived account (no phrase),
// but a GRADUATED account has one stashed locally (J#11) — surface the same web
// reveal pill for it; a linked account's phrase lives with the user already.
import { tgWebApp, isTelegramLinked } from './telegram.js';
import { callLinkTelegram, callUnlinkTelegram } from './firebase-config.js';
import { parseRecoveryCode, deriveUserIdFromRecoveryCode } from './identity.js';
import { showGraduationInfo } from './graduation.js';
import { loadGraduatedPhrase, clearGraduatedPhrases, storeGraduatedPhrase } from './graduationPhrase.js';
import { initRecoveryPill } from './mycode.js';
import { showConfirmModal } from './promptModal.js';
import { setButtonBusy, clearButtonBusy } from './utils.js';

export function initTelegramSettings(userId) {
  const accountSlot = document.getElementById('tg-account-slot');
  const notifySlot = document.getElementById('tg-notify-slot');
  if (!accountSlot || !notifySlot) return;
  const linked = isTelegramLinked();
  // J#11: a graduated (or manual-linked) account stashed its phrase locally and
  // can re-reveal it. A web-onramp-linked account never carried the phrase into
  // Telegram, so there's nothing to reveal here — but the account DOES have a
  // phrase (it's a web account) and that phrase is its only recovery credential.
  // Point the user to where they can see it rather than hide the row silently.
  const gradPhrase = loadGraduatedPhrase(userId);
  const pillRow = document.getElementById('recovery-pill-row');
  const pill = document.getElementById('recovery-show-pill');
  const copyBtn = document.getElementById('drawer-recovery-copy-btn');
  const elsewhereNote = document.getElementById('recovery-elsewhere-note');
  if (gradPhrase) {
    pillRow?.classList.remove('hidden');
    pill?.classList.remove('hidden');
    copyBtn?.classList.remove('hidden');
    elsewhereNote?.classList.add('hidden');
    initRecoveryPill(gradPhrase);
  } else if (linked) {
    pillRow?.classList.remove('hidden');
    pill?.classList.add('hidden');
    copyBtn?.classList.add('hidden');
    elsewhereNote?.classList.remove('hidden');
  } else {
    pillRow?.classList.add('hidden');
  }
  accountSlot.innerHTML = `
    <p id="tg-link-state" class="hint">${linked
      ? 'This Telegram is linked to your KnockKnock account.'
      : 'Using your Telegram identity. Have an account already?'}</p>
    <div class="tg-settings-btns">
      <button id="tg-link-btn" class="ghost-btn${linked ? ' hidden' : ''}" type="button">I have a secret phrase</button>
      <button id="tg-graduate-help" class="help-badge${linked ? ' hidden' : ''}" type="button" aria-label="Use the app outside Telegram">?</button>
      <button id="tg-unlink-btn" class="ghost-btn${linked ? '' : ' hidden'}" type="button">Unlink account</button>
    </div>`;

  document.getElementById('drawer-section-account')?.classList.remove('hidden');

  // The notification-channel pill lives in its own section and is reconciled
  // reactively from userPrefs (see syncNotifyChannel on the watchUserPrefs tick),
  // so it isn't wired here.
  accountSlot.querySelector('#tg-link-btn').addEventListener('click', showLinkScreen);
  accountSlot.querySelector('#tg-unlink-btn').addEventListener('click', async () => {
    // Confirm + round-trip in the shared modal (W3-A CL#4): busy label on the
    // confirm button, inline error + stay-open on failure — the behaviors the
    // bespoke sheet carried (W1 J#7), now without a second modal implementation
    // or a permanent document keydown listener.
    const ok = await showConfirmModal({
      title: 'Unlink this Telegram?',
      message: 'Your account stays yours — sign in with your secret phrase in any browser. This Telegram will start over with a fresh, empty account.',
      confirmLabel: 'Unlink',
      busyLabel: 'Unlinking…',
      onConfirm: async () => {
        try {
          await callUnlinkTelegram(tgWebApp().initData);
          // This Telegram now belongs to a fresh, empty account (the reboot
          // below bootstraps it) — the prior account's stashed graduation
          // phrase must not linger into it (F5 #287).
          clearGraduatedPhrases();
        } catch (e) {
          throw Object.assign(e instanceof Error ? e : new Error('unlink failed'), {
            userMessage: "Couldn't unlink right now. Try again.",
          });
        }
      },
    });
    if (ok) window.location.reload(); // reboot as a fresh derived account
  });
  // "?" beside the link entry opens the graduation info dialog (spec §7).
  accountSlot.querySelector('#tg-graduate-help')?.addEventListener('click', showGraduationInfo);
}

// Reuse the #restore-screen markup for phrase entry, with our own handlers:
// instead of validateRecovery sign-in (js/app.js showRestoreScreen), the phrase
// goes to linkTelegram, which repoints the Telegram mapping and rate-limits
// attempts server-side. On success we reload — boot re-auths via initData
// straight into the linked account.
export function showLinkScreen() {
  const el = document.getElementById('restore-screen');
  const input = document.getElementById('restore-input');
  const error = document.getElementById('restore-error');
  const submit = document.getElementById('restore-submit-btn');
  const cancel = document.getElementById('restore-cancel-btn');
  const form = document.getElementById('restore-form');
  if (!el) return Promise.resolve(false);
  input.value = '';
  error.textContent = '';
  error.classList.add('hidden');
  // Scrub the busy pair's stash: #restore-submit-btn is shared with
  // showRestoreScreen, and setButtonBusy stashes idleLabel only once — a stale
  // stash from the restore flow would resurface on a failed link (W3-B CL#7).
  delete submit.dataset.idleLabel;
  submit.textContent = 'Link account';
  submit.disabled = false;
  el.classList.remove('hidden');

  const subtext = document.getElementById('restore-subtext');
  if (subtext) {
    subtext.textContent = 'Linking replaces this temporary Telegram account — its contacts and groups will be removed.';
    subtext.classList.remove('hidden');
  }

  return new Promise((resolve) => {
    const showError = (msg) => { error.textContent = msg; error.classList.remove('hidden'); };
    const onFormSubmit = (e) => e.preventDefault();
    async function onSubmit() {
      const normalized = parseRecoveryCode(input.value);
      if (!normalized) { showError("That doesn't look like a secret phrase."); return; }
      setButtonBusy(submit, 'Linking…');
      try {
        await callLinkTelegram(tgWebApp().initData, normalized);
      } catch (e) {
        clearButtonBusy(submit);
        showError(/not-found/.test(e?.code || '') ? 'No account found with that phrase.' : "Couldn't link right now. Try again.");
        return;
      }
      // A linked account is a phrase account — stash the phrase in the local
      // vault (keyed by its derived uid) so the drawer can re-show it after the
      // reboot, just like a graduated account (#287 A). This is the only moment
      // the client holds it; its lifetime is bounded by clearGraduatedPhrases()
      // on unlink/sign-out (F5).
      storeGraduatedPhrase(await deriveUserIdFromRecoveryCode(normalized), normalized);
      teardown();
      resolve(true); // observable in tests; the reload ends the session
      window.location.reload(); // reboot via initData into the linked account
    }
    function onCancel() { teardown(); resolve(false); }
    function teardown() {
      submit.removeEventListener('click', onSubmit);
      cancel.removeEventListener('click', onCancel);
      if (form) form.removeEventListener('submit', onFormSubmit);
      if (subtext) subtext.classList.add('hidden');
      el.classList.add('hidden');
    }
    submit.addEventListener('click', onSubmit);
    cancel.addEventListener('click', onCancel);
    if (form) form.addEventListener('submit', onFormSubmit);
  });
}
