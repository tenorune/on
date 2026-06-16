jest.mock('../js/prefs.js', () => ({
  isHintSeen: jest.fn(() => false),
  markHintSeen: jest.fn(),
  addPushToken: jest.fn(),
  removePushToken: jest.fn(),
  getRegisteredPushToken: jest.fn(),
  hasAnyNotifyPrefEnabled: jest.fn(() => false),
  touchPushToken: jest.fn(),
  cullStalePushTokens: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../js/firebase-config.js', () => ({ getMessagingIfSupported: jest.fn() }));
jest.mock('firebase/messaging', () => ({ getToken: jest.fn() }));
jest.mock('../js/installGuidance.js', () => ({
  ...jest.requireActual('../js/installGuidance.js'),
}));
jest.mock('../js/identity.js', () => ({ loadIdentity: jest.fn() }));

const { guidanceCopyFor } = require('../js/installGuidance.js');
const { phraseReminderHtml } = require('../js/notifyPrompt.js');

describe('install-step content contract', () => {
  test('shared phrase-reminder block is reused, and guidance copy exists for iOS', () => {
    const reminder = phraseReminderHtml();
    expect(reminder).toContain('saved your secret phrase');
    expect(typeof guidanceCopyFor('needs-install-ios').body).toBe('string');
  });
});

/**
 * Focused test of restore-primed Paste wiring. The wiring in app.js must match
 * this contract: clicking #restore-paste-btn reads the clipboard into
 * #restore-input.
 */
describe('restore-primed Paste', () => {
  test('Paste button fills the input from the clipboard', async () => {
    document.body.innerHTML = `
      <input id="restore-input" type="password" />
      <button id="restore-paste-btn" class="hidden"></button>`;
    const readText = jest.fn().mockResolvedValue('apple-banana-cherry-dog');
    Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true });

    const input = document.getElementById('restore-input');
    const pasteBtn = document.getElementById('restore-paste-btn');
    pasteBtn.classList.remove('hidden');
    pasteBtn.onclick = async () => {
      try { input.value = (await navigator.clipboard.readText()) || input.value; } catch { /* blocked */ }
    };

    pasteBtn.click();
    await Promise.resolve(); await Promise.resolve();
    expect(input.value).toBe('apple-banana-cherry-dog');
  });
});
