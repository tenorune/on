// js/phraseReminder.js
// Shared "save your secret phrase" reminder block + one-tap clipboard copy.
// Reused by the notification guidance banner, the onboarding install step, and the
// install toast. Kept in its own module with NO Firebase dependency so any of
// those can import it without dragging in firebase-config.
import { loadIdentity } from './identity.js';
import { copyWithFeedback } from './utils.js';

export function phraseReminderHtml() {
  return '<span class="notify-promo-reminder">Make sure you’ve saved your secret phrase — you’ll need it to restore your account after installing.</span>'
    + '<span class="notify-promo-phrase"><span class="notify-promo-phrase-label">Secret phrase:</span> <button type="button" class="notify-promo-copy">Copy to clipboard</button></span>';
}

export function wirePhraseCopyButton(container) {
  const copyBtn = container.querySelector('.notify-promo-copy');
  if (!copyBtn) return;
  copyBtn.onclick = async () => {
    const phrase = loadIdentity()?.recoveryCode;
    if (!phrase) return;
    await copyWithFeedback(copyBtn, phrase, { idle: 'Copy to clipboard' });
  };
}
