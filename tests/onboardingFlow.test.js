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
