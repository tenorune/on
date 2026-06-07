// tests/notifyPrompt.test.js
jest.mock('../js/prefs.js', () => ({
  isHintSeen: jest.fn(() => false),
  markHintSeen: jest.fn(),
  addPushToken: jest.fn(),
  removePushToken: jest.fn(),
  getRegisteredPushToken: jest.fn(),
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

const { requestPermissionAndRegister } = require('../js/notifyPrompt.js');
const { addPushToken } = require('../js/prefs.js');
const { getMessagingIfSupported } = require('../js/firebase-config.js');
const { getToken } = require('firebase/messaging');

describe('requestPermissionAndRegister', () => {
  beforeEach(() => {
    addPushToken.mockClear(); getToken.mockReset(); getMessagingIfSupported.mockReset();
    global.Notification = { requestPermission: jest.fn().mockResolvedValue('granted') };
    global.navigator.serviceWorker = { ready: Promise.resolve({ id: 'reg' }) };
  });

  test('grants, fetches a token, and registers it', async () => {
    getMessagingIfSupported.mockResolvedValue({});
    getToken.mockResolvedValue('tok-xyz');
    const ok = await requestPermissionAndRegister();
    expect(ok).toBe(true);
    expect(addPushToken).toHaveBeenCalledWith('tok-xyz');
  });

  test('returns false and registers nothing when permission denied', async () => {
    global.Notification.requestPermission.mockResolvedValue('denied');
    const ok = await requestPermissionAndRegister();
    expect(ok).toBe(false);
    expect(addPushToken).not.toHaveBeenCalled();
  });
});

const { refreshPushToken } = require('../js/notifyPrompt.js');
const { getRegisteredPushToken, removePushToken } = require('../js/prefs.js');

describe('refreshPushToken', () => {
  beforeEach(() => {
    addPushToken.mockClear(); removePushToken.mockClear(); getRegisteredPushToken.mockReset();
    getToken.mockReset(); getMessagingIfSupported.mockReset();
    global.Notification = { permission: 'granted' };
    global.navigator.serviceWorker = { ready: Promise.resolve({ id: 'reg' }) };
    getMessagingIfSupported.mockResolvedValue({});
  });

  test('re-registers the current token (self-heal) when permission granted', async () => {
    getRegisteredPushToken.mockReturnValue('tok-A');
    getToken.mockResolvedValue('tok-A'); // unchanged
    await refreshPushToken();
    expect(addPushToken).toHaveBeenCalledWith('tok-A');
    expect(removePushToken).not.toHaveBeenCalled();
  });

  test('swaps a rotated token: removes old, adds new', async () => {
    getRegisteredPushToken.mockReturnValue('tok-OLD');
    getToken.mockResolvedValue('tok-NEW');
    await refreshPushToken();
    expect(removePushToken).toHaveBeenCalledWith('tok-OLD');
    expect(addPushToken).toHaveBeenCalledWith('tok-NEW');
  });

  test('no-op when permission is not granted', async () => {
    global.Notification = { permission: 'default' };
    await refreshPushToken();
    expect(getToken).not.toHaveBeenCalled();
    expect(addPushToken).not.toHaveBeenCalled();
  });
});
