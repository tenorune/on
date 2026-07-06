// js/telegramSettings.js — Telegram-context drawer row: account linking and
// the notification-channel toggle. Only mounted when isTelegramContext().
// The phrase pill is hidden here: a Telegram-derived account has no phrase,
// and a linked account's phrase lives with the user already.
import { tgWebApp, telegramLinkState } from './telegram.js';
import { callLinkTelegram, callUnlinkTelegram, callGraduateTelegram } from './firebase-config.js';
import { parseRecoveryCode, generateRecoveryCode } from './identity.js';
import { showRecoveryCodeModal } from './recoveryModal.js';
import { stampLanding } from './firstRun.js';

// Approved copy (spec §7): the graduation entry point + recovery-modal knobs.
const GRADUATE_LABEL = 'I also want to use the app outside of Telegram';
const GRADUATE_INTRO = 'To use the app outside Telegram you get a secret phrase — it opens this same account in any browser.';
const GRADUATE_WARNING = "Save this somewhere safe. It's how you sign in outside Telegram, and the only way to restore your account if you lose access to Telegram. We can't recover it for you.";

export function initTelegramSettings(userId) {
  const accountSlot = document.getElementById('tg-account-slot');
  const notifySlot = document.getElementById('tg-notify-slot');
  if (!accountSlot || !notifySlot) return;
  document.getElementById('recovery-pill-row')?.classList.add('hidden');

  const linked = telegramLinkState()?.linked === true;
  accountSlot.innerHTML = `
    <p id="tg-link-state" class="hint">${linked
      ? 'This Telegram is linked to your KnockKnock account.'
      : 'Using your Telegram identity. Have an account already?'}</p>
    <div class="tg-settings-btns">
      <button id="tg-link-btn" class="ghost-btn${linked ? ' hidden' : ''}" type="button">I have a secret phrase</button>
      <button id="tg-unlink-btn" class="ghost-btn${linked ? '' : ' hidden'}" type="button">Unlink account</button>
    </div>
    <button id="tg-graduate-btn" class="ghost-btn tg-graduate-btn${linked ? ' hidden' : ''}" type="button">${GRADUATE_LABEL}</button>`;

  document.getElementById('drawer-section-account')?.classList.remove('hidden');

  ensureUnlinkConfirmModal();
  // The notification-channel pill lives in its own section and is reconciled
  // reactively from userPrefs (see syncNotifyChannel on the watchUserPrefs tick),
  // so it isn't wired here.
  accountSlot.querySelector('#tg-link-btn').addEventListener('click', showLinkScreen);
  accountSlot.querySelector('#tg-unlink-btn').addEventListener('click', () => {
    document.getElementById('tg-unlink-confirm').classList.remove('hidden');
  });
  accountSlot.querySelector('#tg-graduate-btn')?.addEventListener('click', startGraduation);
}

// Graduation (spec §7): give this unlinked Telegram-derived account a secret
// phrase, migrating it to the phrase-derived uid so it becomes a first-class
// phrase account usable in any browser. Reuses the recovery modal with the
// graduation knobs; the phrase the user lands on is the account's new uid.
// A target-uid collision keeps the modal up (↻ regen is the retry); success
// reloads — boot re-auths straight into the now-"linked" account.
async function startGraduation() {
  await showRecoveryCodeModal(generateRecoveryCode(), async (rc) => {
    try {
      await callGraduateTelegram(tgWebApp().initData, rc);
    } catch (e) {
      // Surface the reason inline (the modal stays up). already-exists means the
      // phrase's uid is taken — a fresh one (↻) is the retry.
      const collision = /already-exists|already in use|exists/i.test(e?.code || e?.message || '');
      throw Object.assign(new Error('graduation failed'), {
        userMessage: collision
          ? 'That phrase is already taken — tap ↻ for a new one, then try again.'
          : "Couldn't set that up right now. Try again.",
      });
    }
    stampLanding('graduated'); // boot reads this and toasts the confirmation
    window.location.reload();
  }, { intro: GRADUATE_INTRO, warning: GRADUATE_WARNING, cancellable: true });
}

// Unlink confirmation as a modal overlay (the same .confirm-overlay pattern as
// Unfollow / Remove-follower), injected once on body — not an inline drawer block.
function ensureUnlinkConfirmModal() {
  if (document.getElementById('tg-unlink-confirm')) return;
  const el = document.createElement('div');
  el.id = 'tg-unlink-confirm';
  el.className = 'confirm-overlay hidden';
  el.innerHTML = `
    <div class="confirm-sheet">
      <h4>Unlink this Telegram?</h4>
      <p>Your account stays yours — sign in with your secret phrase in any browser. This Telegram will start over with a fresh, empty account.</p>
      <div class="confirm-btns">
        <button class="confirm-btn-cancel" id="tg-unlink-cancel-btn" type="button">Cancel</button>
        <button class="confirm-btn-remove" id="tg-unlink-confirm-btn" type="button">Unlink</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  const hide = () => el.classList.add('hidden');
  el.addEventListener('click', (e) => { if (e.target === el) hide(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.classList.contains('hidden')) hide();
  });
  document.getElementById('tg-unlink-cancel-btn').addEventListener('click', hide);
  document.getElementById('tg-unlink-confirm-btn').addEventListener('click', doUnlink);
}

async function doUnlink(e) {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    await callUnlinkTelegram(tgWebApp().initData);
    window.location.reload(); // reboot as a fresh derived account
  } catch {
    btn.disabled = false;
  }
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
  if (!el) return;
  input.value = '';
  error.textContent = '';
  error.classList.add('hidden');
  submit.textContent = 'Link account';
  submit.disabled = false;
  el.classList.remove('hidden');

  const subtext = document.getElementById('restore-subtext');
  if (subtext) {
    subtext.textContent = 'Linking replaces this temporary Telegram account — its contacts and groups will be removed.';
    subtext.classList.remove('hidden');
  }

  const showError = (msg) => { error.textContent = msg; error.classList.remove('hidden'); };
  const onFormSubmit = (e) => e.preventDefault();
  async function onSubmit() {
    const normalized = parseRecoveryCode(input.value);
    if (!normalized) { showError("That doesn't look like a secret phrase."); return; }
    submit.disabled = true;
    submit.textContent = 'Linking…';
    try {
      await callLinkTelegram(tgWebApp().initData, normalized);
    } catch (e) {
      submit.disabled = false;
      submit.textContent = 'Link account';
      showError(/not-found/.test(e?.code || '') ? 'No account found with that phrase.' : "Couldn't link right now. Try again.");
      return;
    }
    teardown();
    window.location.reload(); // reboot via initData into the linked account
  }
  function onCancel() { teardown(); }
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
}
