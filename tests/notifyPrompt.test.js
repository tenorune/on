// tests/notifyPrompt.test.js
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
  detectNotifyCapability: jest.fn(),
  guidanceCopyFor: jest.fn((s) => ({ body: `copy-for-${s}` })),
}));
jest.mock('../js/identity.js', () => ({ loadIdentity: jest.fn() }));

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
const { getRegisteredPushToken, removePushToken, touchPushToken, cullStalePushTokens } = require('../js/prefs.js');

describe('refreshPushToken', () => {
  beforeEach(() => {
    addPushToken.mockClear(); removePushToken.mockClear(); getRegisteredPushToken.mockReset();
    touchPushToken.mockClear(); cullStalePushTokens.mockClear();
    getToken.mockReset(); getMessagingIfSupported.mockReset();
    global.Notification = { permission: 'granted' };
    global.navigator.serviceWorker = { ready: Promise.resolve({ id: 'reg' }) };
    getMessagingIfSupported.mockResolvedValue({});
  });

  test('unchanged token → touches lastSeen (not a full re-register)', async () => {
    getRegisteredPushToken.mockReturnValue('tok-A');
    getToken.mockResolvedValue('tok-A'); // unchanged
    await refreshPushToken();
    expect(touchPushToken).toHaveBeenCalledWith('tok-A');
    expect(addPushToken).not.toHaveBeenCalled();
    expect(removePushToken).not.toHaveBeenCalled();
  });

  test('swaps a rotated token: removes old, adds new', async () => {
    getRegisteredPushToken.mockReturnValue('tok-OLD');
    getToken.mockResolvedValue('tok-NEW');
    await refreshPushToken();
    expect(removePushToken).toHaveBeenCalledWith('tok-OLD');
    expect(addPushToken).toHaveBeenCalledWith('tok-NEW');
  });

  test('registers the current token when none was registered locally', async () => {
    getRegisteredPushToken.mockReturnValue(null);
    getToken.mockResolvedValue('tok-NEW');
    await refreshPushToken();
    expect(addPushToken).toHaveBeenCalledWith('tok-NEW');
    expect(removePushToken).not.toHaveBeenCalled();
  });

  test('prunes stale sibling tokens on every refresh', async () => {
    getRegisteredPushToken.mockReturnValue('tok-A');
    getToken.mockResolvedValue('tok-A');
    await refreshPushToken();
    expect(cullStalePushTokens).toHaveBeenCalled();
  });

  test('no-op when permission is not granted', async () => {
    global.Notification = { permission: 'default' };
    await refreshPushToken();
    expect(getToken).not.toHaveBeenCalled();
    expect(addPushToken).not.toHaveBeenCalled();
    expect(cullStalePushTokens).not.toHaveBeenCalled();
  });
});

const { ensureNotificationsReady } = require('../js/notifyPrompt.js');
const { detectNotifyCapability, guidanceCopyFor } = require('../js/installGuidance.js');

function mountBanner() {
  document.body.innerHTML =
    '<div id="notify-promo" class="notify-promo hidden">' +
    '<span id="notify-promo-text"></span>' +
    '<button id="notify-promo-action" class="primary-btn hidden"></button>' +
    '<button id="notify-promo-dismiss"></button></div>';
}

describe('ensureNotificationsReady', () => {
  beforeEach(() => {
    addPushToken.mockClear(); getToken.mockReset(); getMessagingIfSupported.mockReset();
    detectNotifyCapability.mockReset();
    mountBanner();
    global.Notification = { permission: 'default', requestPermission: jest.fn().mockResolvedValue('granted') };
    global.navigator.serviceWorker = { ready: Promise.resolve({ id: 'reg' }) };
    getMessagingIfSupported.mockResolvedValue({});
    getToken.mockResolvedValue('tok-1');
  });

  test('supported → runs the permission/register flow, no banner', async () => {
    detectNotifyCapability.mockReturnValue({ state: 'supported', supported: true });
    await ensureNotificationsReady();
    expect(addPushToken).toHaveBeenCalledWith('tok-1');
    expect(document.getElementById('notify-promo').classList.contains('hidden')).toBe(true);
  });

  test('already denied → shows blocked banner, no permission request, no token', async () => {
    detectNotifyCapability.mockReturnValue({ state: 'denied', supported: false });
    await ensureNotificationsReady();
    expect(global.Notification.requestPermission).not.toHaveBeenCalled();
    expect(addPushToken).not.toHaveBeenCalled();
    const banner = document.getElementById('notify-promo');
    expect(banner.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('notify-promo-text').textContent).toBe('copy-for-denied');
  });

  test('needs-install (iOS) → shows install-guidance banner', async () => {
    detectNotifyCapability.mockReturnValue({ state: 'needs-install-ios', supported: false });
    await ensureNotificationsReady();
    expect(addPushToken).not.toHaveBeenCalled();
    const banner = document.getElementById('notify-promo');
    expect(banner.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('notify-promo-text').textContent).toBe('copy-for-needs-install-ios');
  });

  test('an install-guidance state with remindPhrase appends the save-your-phrase reminder (data-loss guard)', async () => {
    detectNotifyCapability.mockReturnValue({ state: 'needs-install-ios', supported: false });
    guidanceCopyFor.mockReturnValueOnce({ body: 'install copy', remindPhrase: true });
    await ensureNotificationsReady();
    const text = document.getElementById('notify-promo-text').textContent;
    expect(text).toContain('install copy');
    expect(text).toMatch(/secret phrase/i);
  });

  test('supported but the user denies the prompt → shows blocked banner', async () => {
    detectNotifyCapability
      .mockReturnValueOnce({ state: 'supported', supported: true })
      .mockReturnValueOnce({ state: 'denied', supported: false });
    global.Notification.requestPermission = jest.fn().mockResolvedValue('denied');
    await ensureNotificationsReady();
    expect(addPushToken).not.toHaveBeenCalled();
    expect(document.getElementById('notify-promo').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('notify-promo-text').textContent).toBe('copy-for-denied');
  });
});

const { shouldReprompt } = require('../js/notifyPrompt.js');

describe('shouldReprompt (enabled prefs but no permission on this device)', () => {
  const base = { enabled: true, hasEnabledPrefs: true, permission: 'default', capState: 'supported', deviceDismissed: false };

  test('shown when prefs are enabled but permission is not granted (supported)', () => {
    expect(shouldReprompt(base)).toBe(true);
  });
  test('shown on the iOS-install state (the Enable path is install guidance)', () => {
    expect(shouldReprompt({ ...base, capState: 'needs-install-ios' })).toBe(true);
  });
  test('hidden when the feature flag is off', () => {
    expect(shouldReprompt({ ...base, enabled: false })).toBe(false);
  });
  test('hidden when permission is already granted', () => {
    expect(shouldReprompt({ ...base, permission: 'granted' })).toBe(false);
  });
  test('hidden when there are no enabled prefs (nothing unmet)', () => {
    expect(shouldReprompt({ ...base, hasEnabledPrefs: false })).toBe(false);
  });
  test('hidden once dismissed on this device', () => {
    expect(shouldReprompt({ ...base, deviceDismissed: true })).toBe(false);
  });
  test('hidden when capability is denied or unsupported (no actionable path)', () => {
    expect(shouldReprompt({ ...base, capState: 'denied' })).toBe(false);
    expect(shouldReprompt({ ...base, capState: 'unsupported' })).toBe(false);
  });
});

const { maybeRepromptForMissingPermission } = require('../js/notifyPrompt.js');
const { hasAnyNotifyPrefEnabled, isHintSeen, markHintSeen } = require('../js/prefs.js');

describe('maybeRepromptForMissingPermission', () => {
  beforeEach(() => {
    mountBanner();
    localStorage.clear();
    detectNotifyCapability.mockReset();
    detectNotifyCapability.mockReturnValue({ state: 'supported', supported: true });
    hasAnyNotifyPrefEnabled.mockReset();
    hasAnyNotifyPrefEnabled.mockReturnValue(true);
    markHintSeen.mockClear();
    // The restore scenario: the user dismissed the promo on their OLD device, so
    // the synced hint reads "seen". The reprompt must surface the banner anyway.
    isHintSeen.mockReturnValue(true);
    global.Notification = { permission: 'default', requestPermission: jest.fn().mockResolvedValue('granted') };
    global.navigator.serviceWorker = { ready: Promise.resolve({ id: 'reg' }) };
  });

  test('surfaces the promo when enabled prefs exist but permission is absent — despite the synced "dismissed" hint', () => {
    maybeRepromptForMissingPermission();
    const banner = document.getElementById('notify-promo');
    expect(banner.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('notify-promo-text').textContent).toContain('notified');
  });

  test('stays hidden when permission is already granted', () => {
    global.Notification = { permission: 'granted' };
    maybeRepromptForMissingPermission();
    expect(document.getElementById('notify-promo').classList.contains('hidden')).toBe(true);
  });

  test('stays hidden when there are no enabled prefs', () => {
    hasAnyNotifyPrefEnabled.mockReturnValue(false);
    maybeRepromptForMissingPermission();
    expect(document.getElementById('notify-promo').classList.contains('hidden')).toBe(true);
  });

  test('Close dismisses for THIS device only (not the synced forever-dismiss) and stays hidden next load', () => {
    maybeRepromptForMissingPermission();
    document.getElementById('notify-promo-dismiss').click();
    expect(document.getElementById('notify-promo').classList.contains('hidden')).toBe(true);
    expect(markHintSeen).not.toHaveBeenCalled(); // device-local, not the synced hint
    maybeRepromptForMissingPermission();
    expect(document.getElementById('notify-promo').classList.contains('hidden')).toBe(true);
  });
});

describe('promo Enable button failure feedback (Defect 2 — no more silent no-op)', () => {
  const flush = () => new Promise((r) => setImmediate(r));
  beforeEach(() => {
    mountBanner();
    localStorage.clear();
    addPushToken.mockClear(); getToken.mockReset(); getMessagingIfSupported.mockReset();
    detectNotifyCapability.mockReset();
    hasAnyNotifyPrefEnabled.mockReturnValue(true);
    isHintSeen.mockReturnValue(false);
    getMessagingIfSupported.mockResolvedValue({});
    global.navigator.serviceWorker = { ready: Promise.resolve({ id: 'reg' }) };
  });

  test('denying the OS prompt surfaces the blocked guidance', async () => {
    detectNotifyCapability.mockReturnValue({ state: 'supported', supported: true });
    global.Notification = { permission: 'default', requestPermission: jest.fn().mockResolvedValue('granted') };
    maybeRepromptForMissingPermission(); // renders the "Enable" banner
    // The click denies, and the post-denial capability flips to 'denied'.
    global.Notification.requestPermission = jest.fn().mockResolvedValue('denied');
    detectNotifyCapability.mockReturnValue({ state: 'denied', supported: false });
    document.getElementById('notify-promo-action').click();
    await flush();
    expect(document.getElementById('notify-promo-text').textContent).toBe('copy-for-denied');
    expect(document.getElementById('notify-promo').classList.contains('hidden')).toBe(false);
  });

  test('permission granted but token registration fails → a "could not enable" message, not silence', async () => {
    detectNotifyCapability.mockReturnValue({ state: 'supported', supported: true });
    global.Notification = { permission: 'default', requestPermission: jest.fn().mockResolvedValue('granted') };
    getToken.mockResolvedValue(null); // registration fails despite a granted prompt
    maybeRepromptForMissingPermission();
    document.getElementById('notify-promo-action').click();
    await flush();
    const text = document.getElementById('notify-promo-text').textContent;
    expect(text).toMatch(/could ?n.?t|try again|web push/i);
    expect(text).not.toBe('Get notified about knocks, calls, and people coming online.');
    expect(document.getElementById('notify-promo').classList.contains('hidden')).toBe(false);
  });

  test('a successful Enable still hides the banner', async () => {
    detectNotifyCapability.mockReturnValue({ state: 'supported', supported: true });
    global.Notification = { permission: 'default', requestPermission: jest.fn().mockResolvedValue('granted') };
    getToken.mockResolvedValue('tok-ok');
    maybeRepromptForMissingPermission();
    document.getElementById('notify-promo-action').click();
    await flush();
    expect(addPushToken).toHaveBeenCalledWith('tok-ok');
    expect(document.getElementById('notify-promo').classList.contains('hidden')).toBe(true);
  });
});

const { loadIdentity } = require('../js/identity.js');

const { phraseReminderHtml, wirePhraseCopyButton } = require('../js/notifyPrompt.js');

describe('phrase-reminder shared renderer', () => {
  test('phraseReminderHtml contains the verbatim reminder + copy button', () => {
    const html = phraseReminderHtml();
    expect(html).toContain('make sure you’ve saved your secret phrase');
    expect(html).toContain('class="notify-promo-copy"');
  });

  test('wirePhraseCopyButton copies the recovery phrase and flips label', async () => {
    jest.useFakeTimers();
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    loadIdentity.mockReturnValue({ recoveryCode: 'apple-banana-cherry-dog' });

    const container = document.createElement('div');
    container.innerHTML = phraseReminderHtml();
    wirePhraseCopyButton(container);
    const btn = container.querySelector('.notify-promo-copy');
    btn.click();
    await Promise.resolve(); await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith('apple-banana-cherry-dog');
    expect(btn.textContent).toBe('Copied!');
    jest.advanceTimersByTime(1500);
    expect(btn.textContent).toBe('Copy to clipboard');
    jest.useRealTimers();
  });
});

describe('install-nudge secret-phrase copy button', () => {
  const flush = () => new Promise((r) => setImmediate(r));
  beforeEach(() => {
    mountBanner();
    localStorage.clear();
    detectNotifyCapability.mockReset();
    detectNotifyCapability.mockReturnValue({ state: 'needs-install-ios', supported: false });
    guidanceCopyFor.mockReset();
    guidanceCopyFor.mockReturnValue({ body: 'install copy', remindPhrase: true });
    hasAnyNotifyPrefEnabled.mockReturnValue(true);
    isHintSeen.mockReturnValue(false);
    loadIdentity.mockReset();
    loadIdentity.mockReturnValue({ recoveryCode: 'swift-river-amber-dust' });
    global.Notification = { permission: 'default' };
  });

  test('a remindPhrase nudge shows a copy button that writes the recovery code to the clipboard', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    maybeRepromptForMissingPermission(); // renders the install-guidance banner
    const btn = document.querySelector('.notify-promo-copy');
    expect(btn).not.toBeNull();
    btn.click();
    await flush();
    expect(writeText).toHaveBeenCalledWith('swift-river-amber-dust');
    expect(btn.textContent).toMatch(/copied/i);
  });

  test('no copy button when the guidance carries no phrase reminder', () => {
    guidanceCopyFor.mockReturnValue({ body: 'plain guidance', remindPhrase: false });
    maybeRepromptForMissingPermission();
    expect(document.querySelector('.notify-promo-copy')).toBeNull();
  });
});
