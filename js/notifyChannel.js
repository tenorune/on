// js/notifyChannel.js — the notification-channel toggle pill, shared by the
// Telegram drawer (telegramSettings.js) and the web drawer (app.js boot).
//
// Only shown for a LINKED account: a Telegram-derived (unlinked) account can only
// receive via Telegram, and a web account with no Telegram link has nothing to
// choose. "Linked" is decided by the caller — telegramLinkState() in Telegram,
// userPrefs.telegram on the web — and passed in. Renders a two-segment pill
// [Telegram | Push] into #tg-notify-slot and reveals #drawer-section-notifications.
import { getUserPrefs, mergeUserPrefs } from './db.js';

export async function initNotifyChannel(userId, { linked } = {}) {
  const slot = document.getElementById('tg-notify-slot');
  const section = document.getElementById('drawer-section-notifications');
  if (!slot || !section) return;
  if (!linked) { section.classList.add('hidden'); return; }

  // Default is 'telegram' (set server-side when the mapping is created/linked).
  let channel = 'telegram';
  try {
    if ((await getUserPrefs(userId))?.notifyChannel === 'push') channel = 'push';
  } catch { /* offline — assume the default */ }

  slot.innerHTML = `
    <div class="toggle-pill" id="notify-channel-pill" role="group" aria-label="Notifications">
      <button class="toggle-pill-option" type="button" data-channel="telegram">Telegram</button>
      <button class="toggle-pill-option" type="button" data-channel="push">Push</button>
    </div>`;
  const options = [...slot.querySelectorAll('.toggle-pill-option')];
  const render = () => options.forEach((b) => {
    const on = b.dataset.channel === channel;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  render();

  options.forEach((b) => b.addEventListener('click', async () => {
    const next = b.dataset.channel;
    if (next === channel) return;
    const prev = channel;
    channel = next;
    render();
    try {
      await mergeUserPrefs(userId, { notifyChannel: channel });
    } catch {
      channel = prev; // revert on write failure
      render();
    }
  }));

  section.classList.remove('hidden');
}
