// js/notifyChannel.js — the notification-channel toggle pill, shared by the
// Telegram drawer and the web drawer.
//
// Driven reactively from userPrefs (call it from the watchUserPrefs tick) so it
// stays live across surfaces and devices: linking/unlinking and channel switches
// reflect without a reload. Only shown for a LINKED account — decided uniformly by
// the server-side marker userPrefs.telegram (set on link, cleared on unlink); a
// Telegram-derived (unlinked) account can only receive via Telegram, and a web
// account with no link has nothing to choose.
import { mergeUserPrefs } from './db.js';

const OTHER = { telegram: 'push', push: 'telegram' };

function setActive(pill, channel) {
  pill.querySelectorAll('.toggle-pill-option').forEach((b) => {
    const on = b.dataset.channel === channel;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

// Mount the pill once and wire clicks. The DOM (.active class) is the source of
// truth for the current channel, so no per-instance state survives across syncs.
function mountPill(slot, userId) {
  slot.innerHTML = `
    <div class="toggle-pill" role="group" aria-label="Notifications">
      <button class="toggle-pill-option" type="button" data-channel="telegram">Telegram</button>
      <button class="toggle-pill-option" type="button" data-channel="push">Push</button>
    </div>`;
  const pill = slot.querySelector('.toggle-pill');
  pill.querySelectorAll('.toggle-pill-option').forEach((b) => {
    b.addEventListener('click', async () => {
      if (b.classList.contains('active')) return;
      const next = b.dataset.channel;
      setActive(pill, next); // optimistic — instant feedback before the round-trip
      try {
        await mergeUserPrefs(userId, { notifyChannel: next });
      } catch {
        setActive(pill, OTHER[next]); // revert; no echo will arrive to correct it
      }
    });
  });
  return pill;
}

// Reconcile the section + pill against the latest userPrefs. Idempotent: safe to
// call on every prefs tick.
export function syncNotifyChannel(userId, prefs) {
  const slot = document.getElementById('tg-notify-slot');
  const section = document.getElementById('drawer-section-notifications');
  if (!slot || !section) return;
  if (prefs?.telegram == null) { section.classList.add('hidden'); return; }

  const pill = slot.querySelector('.toggle-pill') || mountPill(slot, userId);
  setActive(pill, prefs.notifyChannel === 'push' ? 'push' : 'telegram');
  section.classList.remove('hidden');
}
