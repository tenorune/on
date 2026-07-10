// js/telegramEscapeHatch.js — the "link Telegram instead" block appended to
// dead-end web-push nudges (spec 2026-07-10-web-nudges-telegram-escape-hatch):
// the notify guidance banner's hard lanes and the install toast's hard lanes.
// Same idiom as phraseReminder.js: an html string + wiring, so notifyPrompt and
// installAffordance share one copy source and one gate. All app-controlled
// markup — no user input.
import { telegramOnrampEnabled, startTelegramOnrampFromNudge } from './telegramOnramp.js';
import { isTelegramLinkedWeb } from './notifySuppression.js';

// Escape-hatch posture: offered only to accounts that could link and haven't.
// Linked accounts on channel 'push' chose push explicitly — excluded.
export function escapeHatchAvailable() {
  return telegramOnrampEnabled() && !isTelegramLinkedWeb();
}

export function escapeHatchHtml() {
  if (!escapeHatchAvailable()) return '';
  return '<span class="tg-escape-hatch">Or link Telegram to get notified there — no install or browser permission needed.'
    + ' <button type="button" class="ghost-btn tg-escape-hatch-btn">Link Telegram</button></span>';
}

export function wireEscapeHatch(container) {
  const btn = container?.querySelector?.('.tg-escape-hatch-btn');
  if (!btn) return;
  btn.addEventListener('click', () => { startTelegramOnrampFromNudge(btn); });
}
