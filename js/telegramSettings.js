// js/telegramSettings.js — Telegram-context drawer row: account linking and
// the notification-channel toggle. Only mounted when isTelegramContext().
// The phrase pill is hidden here: a Telegram-derived account has no phrase,
// and a linked account's phrase lives with the user already.
import { tgWebApp, telegramLinkState } from './telegram.js';
import { callLinkTelegram, callUnlinkTelegram } from './firebase-config.js';
import { getUserPrefs, mergeUserPrefs } from './db.js';
import { parseRecoveryCode } from './identity.js';
import { stampLanding } from './firstRun.js';

export function initTelegramSettings(userId) {
  const drawer = document.querySelector('#code-drawer .drawer-inner');
  if (!drawer) return;
  document.getElementById('recovery-pill-row')?.classList.add('hidden');

  const linked = telegramLinkState()?.linked === true;
  const row = document.createElement('div');
  row.id = 'tg-settings-row';
  row.className = 'tg-settings-row';
  row.innerHTML = `
    <p id="tg-link-state" class="hint">${linked
      ? 'This Telegram is linked to your KnockKnock account.'
      : 'Using your Telegram identity. Have an account already?'}</p>
    <div class="tg-settings-btns">
      <button id="tg-link-btn" class="ghost-btn${linked ? ' hidden' : ''}" type="button">I have a secret phrase</button>
      <button id="tg-unlink-btn" class="ghost-btn${linked ? '' : ' hidden'}" type="button">Unlink account</button>
      <button id="tg-channel-btn" class="chip" type="button">Notifications: Telegram</button>
    </div>
    <div id="tg-unlink-confirm" class="hidden">
      <p class="hint">Your account stays yours — sign in with your secret phrase in any browser. This Telegram will start over with a fresh, empty account.</p>
      <div class="tg-settings-btns">
        <button id="tg-unlink-confirm-btn" class="danger-btn" type="button">Unlink</button>
        <button id="tg-unlink-cancel-btn" class="ghost-btn" type="button">Cancel</button>
      </div>
    </div>`;
  drawer.appendChild(row);

  wireChannelToggle(userId, row.querySelector('#tg-channel-btn'));
  row.querySelector('#tg-link-btn').addEventListener('click', showLinkScreen);
  row.querySelector('#tg-unlink-btn').addEventListener('click', () => {
    row.querySelector('#tg-unlink-confirm').classList.remove('hidden');
  });
  row.querySelector('#tg-unlink-cancel-btn').addEventListener('click', () => {
    row.querySelector('#tg-unlink-confirm').classList.add('hidden');
  });
  row.querySelector('#tg-unlink-confirm-btn').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await callUnlinkTelegram(tgWebApp().initData);
      stampLanding('unlinked');
      window.location.reload(); // reboot as a fresh derived account
    } catch {
      e.target.disabled = false;
    }
  });
}

async function wireChannelToggle(userId, btn) {
  // Default is 'telegram' in this context (set server-side on mapping creation).
  let channel = 'telegram';
  try {
    if ((await getUserPrefs(userId))?.notifyChannel === 'push') channel = 'push';
  } catch { /* offline — assume default */ }
  const render = () => { btn.textContent = channel === 'telegram' ? 'Notifications: Telegram' : 'Notifications: Push'; };
  render();
  btn.addEventListener('click', async () => {
    const prev = channel;
    channel = channel === 'telegram' ? 'push' : 'telegram';
    render();
    try {
      await mergeUserPrefs(userId, { notifyChannel: channel });
    } catch {
      channel = prev; // revert on write failure
      render();
    }
  });
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
    stampLanding('linked');
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
