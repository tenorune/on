// tests/notifyPrompt.test.js
jest.mock('../js/prefs.js', () => ({
  isHintSeen: jest.fn(() => false),
  markHintSeen: jest.fn(),
  addPushToken: jest.fn(),
}));
jest.mock('../js/firebase-config.js', () => ({ getMessagingIfSupported: jest.fn() }));
jest.mock('firebase/messaging', () => ({ getToken: jest.fn() }));

const { shouldShowPromo } = require('../js/notifyPrompt.js');

test('hidden when feature flag off', () => {
  expect(shouldShowPromo({ enabled: false, hintSeen: false, engaged: true, capState: 'supported', permission: 'default' })).toBe(false);
});
test('hidden when hint already dismissed forever', () => {
  expect(shouldShowPromo({ enabled: true, hintSeen: true, engaged: true, capState: 'supported', permission: 'default' })).toBe(false);
});
test('hidden until the user is engaged', () => {
  expect(shouldShowPromo({ enabled: true, hintSeen: false, engaged: false, capState: 'supported', permission: 'default' })).toBe(false);
});
test('hidden when permission already granted', () => {
  expect(shouldShowPromo({ enabled: true, hintSeen: false, engaged: true, capState: 'supported', permission: 'granted' })).toBe(false);
});
test('hidden when permission is denied (no nagging)', () => {
  expect(shouldShowPromo({ enabled: true, hintSeen: false, engaged: true, capState: 'denied', permission: 'denied' })).toBe(false);
});
test('shown for an engaged, unseen, supported, ungranted user', () => {
  expect(shouldShowPromo({ enabled: true, hintSeen: false, engaged: true, capState: 'supported', permission: 'default' })).toBe(true);
});
test('shown for iOS-install state (install nudge counts)', () => {
  expect(shouldShowPromo({ enabled: true, hintSeen: false, engaged: true, capState: 'needs-install-ios', permission: 'default' })).toBe(true);
});
