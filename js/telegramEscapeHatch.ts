// js/telegramEscapeHatch.ts — the "link Telegram instead" affordance appended to
// dead-end web-push nudges (spec 2026-07-10-web-nudges-telegram-escape-hatch):
// the notify guidance banner's hard lanes and the install toast's hard lanes.
// The message text goes into the banner's text area; the "Use in Telegram" CTA
// mounts into the banner's action row (beside Close), matching the onramp promo.
// notifyPrompt and installAffordance share this one copy source and one gate.
// All app-controlled markup — no user input.
import { telegramOnrampEnabled, startTelegramOnrampFromNudge } from './telegramOnramp.js';
import { isTelegramLinkedWeb } from './notifySuppression.js';

// Escape-hatch posture: offered only to accounts that could link and haven't.
// Linked accounts on channel 'push' chose push explicitly — excluded.
export function escapeHatchAvailable() {
  return telegramOnrampEnabled() && !isTelegramLinkedWeb();
}

// Message-area text only — the button lives in the action row (see
// syncEscapeHatchButton). '' when unavailable so callers can append
// unconditionally.
export function escapeHatchTextHtml() {
  if (!escapeHatchAvailable()) return '';
  return '<span class="tg-escape-hatch">You can also link Telegram to get notified there — no install or browser permission needed.</span>';
}

// Mount (or remove) the "Use in Telegram" CTA at the right of the banner's action
// row, beside Close. Idempotent: the action row persists across re-renders (only
// the text area is rewritten), so callers pass `wanted` = whether this surface
// offers the hatch on every render. wanted=false (or unavailable) removes any
// previously-mounted button, so a lane flip (e.g. back to the installable lane or
// the supported Enable banner) can't leave a stale CTA behind.
export function syncEscapeHatchButton(actionsEl: HTMLElement | null | undefined, wanted: boolean) {
  if (!actionsEl) return;
  const existing = actionsEl.querySelector('.tg-escape-hatch-btn');
  if (!wanted || !escapeHatchAvailable()) { if (existing) existing.remove(); return; }
  if (existing) return; // already mounted
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'primary-btn tg-escape-hatch-btn';
  btn.textContent = 'Use in Telegram';
  btn.addEventListener('click', () => { startTelegramOnrampFromNudge(btn); });
  actionsEl.appendChild(btn); // last child → rightmost
}
