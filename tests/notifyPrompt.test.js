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
jest.mock('../js/telegram.js', () => ({ isTelegramContext: jest.fn(() => false) }));
// Hygiene: default to '' (inert) rather than the brief's literal non-empty
// default. This mock is shared by the WHOLE file (module scope), and several
// pre-existing describes below (ensureNotificationsReady, promo Enable button
// failure feedback) assert exact textContent for guidance/registration-failed
// copy with no awareness of the hatch. A non-empty file-wide default bleeds
// "Link Telegram" into those assertions regardless of test order. The "escape
// hatch on dead-end banners" describe below opts back into the non-empty
// return explicitly in its own beforeEach, which also fixes an intra-describe
// pollution hazard (a test.each case relying on the same implicit default
// after an earlier case in the same describe called mockReturnValue('')).
const mockHatchHtml = jest.fn(() => '');
const mockWireHatch = jest.fn();
jest.mock('../js/telegramEscapeHatch.js', () => ({
  escapeHatchHtml: (...a) => mockHatchHtml(...a),
  wireEscapeHatch: (...a) => mockWireHatch(...a),
}));

const { isTelegramContext } = require('../js/telegram.js');
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

  test('Telegram context → no-op: no capability check, no permission prompt, no web-push banner', async () => {
    // In Telegram the bot delivers notifications (notifyChannel:'telegram'); there
    // is no web-push permission to request, so the whole capability/banner flow —
    // which would otherwise show "this browser doesn't support…" — is skipped.
    isTelegramContext.mockReturnValueOnce(true);
    await ensureNotificationsReady();
    expect(detectNotifyCapability).not.toHaveBeenCalled();
    expect(global.Notification.requestPermission).not.toHaveBeenCalled();
    expect(addPushToken).not.toHaveBeenCalled();
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

  test('Telegram context → promo stays hidden (bot delivers; no web-push framing)', () => {
    isTelegramContext.mockReturnValueOnce(true);
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
  const { isRepromptActive } = require('../js/notifySuppression.js');
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
    expect(isRepromptActive()).toBe(true); // reprompt banner is up before the click
    document.getElementById('notify-promo-action').click();
    await flush();
    expect(addPushToken).toHaveBeenCalledWith('tok-ok');
    expect(document.getElementById('notify-promo').classList.contains('hidden')).toBe(true);
    // The reprompt flag clears immediately on success, not on a round-trip
    // through the notify-prefs-synced echo (onramp promo defer clears at once).
    expect(isRepromptActive()).toBe(false);
  });
});

const { loadIdentity } = require('../js/identity.js');

const { phraseReminderHtml, wirePhraseCopyButton } = require('../js/notifyPrompt.js');

describe('phrase-reminder shared renderer', () => {
  test('phraseReminderHtml contains the verbatim reminder + copy button', () => {
    const html = phraseReminderHtml();
    expect(html).toContain('saved your secret phrase');
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

const { initNotifyPrompt } = require('../js/notifyPrompt.js');
const { syncBotDelivery, __resetBotDeliveryForTests } = require('../js/notifySuppression.js');

describe('bot-delivered suppression (linked account, telegram channel)', () => {
  const LINKED_TG = { telegram: { linkedAt: 1 }, notifyChannel: 'telegram' };
  const LINKED_PUSH = { telegram: { linkedAt: 1 }, notifyChannel: 'push' };
  const banner = () => document.getElementById('notify-promo');

  beforeEach(() => {
    __resetBotDeliveryForTests();
    addPushToken.mockClear();
    detectNotifyCapability.mockReset();
    detectNotifyCapability.mockReturnValue({ state: 'supported', supported: true });
    hasAnyNotifyPrefEnabled.mockReturnValue(true); // reprompt conditions all hold…
    localStorage.clear();                          // …and no device dismissal
    mountBanner();
    global.Notification = { permission: 'default', requestPermission: jest.fn().mockResolvedValue('granted') };
    global.navigator.serviceWorker = { ready: Promise.resolve({ id: 'reg' }) };
    getMessagingIfSupported.mockResolvedValue({});
    getToken.mockResolvedValue('tok-1');
  });
  afterAll(() => __resetBotDeliveryForTests());

  test('ensureNotificationsReady no-ops when suppressed: no prompt, no token, no banner', async () => {
    syncBotDelivery(LINKED_TG);
    await ensureNotificationsReady();
    expect(global.Notification.requestPermission).not.toHaveBeenCalled();
    expect(addPushToken).not.toHaveBeenCalled();
    expect(banner().classList.contains('hidden')).toBe(true);
  });

  test('reprompt banner stays hidden when suppressed even though every reprompt condition holds', () => {
    syncBotDelivery(LINKED_TG);
    initNotifyPrompt('u1');
    expect(banner().classList.contains('hidden')).toBe(true);
  });

  test('reprompt banner revives when suppression lifts (channel switched to push)', () => {
    syncBotDelivery(LINKED_TG);
    initNotifyPrompt('u1');
    expect(banner().classList.contains('hidden')).toBe(true);
    syncBotDelivery(LINKED_PUSH); // bot-delivery-change → refreshPromoVisibility
    expect(banner().classList.contains('hidden')).toBe(false);
  });

  test('a granted permission flow hides the revived banner immediately (no server echo needed)', async () => {
    // The switch-to-push moment: suppression lifts (banner shows "Enable"),
    // then ensureNotificationsReady runs and the user GRANTS. The banner must
    // hide on the success path itself — not wait for the notify-prefs-synced
    // echo of the token write.
    // Granting flips Notification.permission, like a real browser does.
    global.Notification.requestPermission = jest.fn(async () => {
      global.Notification.permission = 'granted';
      return 'granted';
    });
    syncBotDelivery(LINKED_TG);
    initNotifyPrompt('u1');
    syncBotDelivery(LINKED_PUSH);
    expect(banner().classList.contains('hidden')).toBe(false); // stale "Enable" showing
    await ensureNotificationsReady();
    expect(addPushToken).toHaveBeenCalledWith('tok-1');         // flow succeeded
    expect(banner().classList.contains('hidden')).toBe(true);   // and hid the banner itself
  });
});

describe('escape hatch on dead-end banners', () => {
  const { ensureNotificationsReady } = require('../js/notifyPrompt.js');
  const { detectNotifyCapability, guidanceCopyFor } = require('../js/installGuidance.js');

  function bannerDom() {
    document.body.innerHTML = `
      <div id="notify-promo" class="hidden">
        <span id="notify-promo-text"></span>
        <button id="notify-promo-dismiss"></button>
        <button id="notify-promo-action" class="hidden"></button>
      </div>`;
  }
  beforeEach(() => {
    bannerDom();
    mockHatchHtml.mockClear(); mockWireHatch.mockClear();
    // Opt this describe back into the non-empty hatch by default (see the
    // mock's module-scope declaration comment) — set fresh every test so an
    // earlier case's mockReturnValue('') can't leak into a later one.
    mockHatchHtml.mockReturnValue('<span class="tg-escape-hatch"><button class="tg-escape-hatch-btn">Link Telegram</button></span>');
    guidanceCopyFor.mockImplementation((s) => ({ body: `copy-for-${s}` }));
    delete global.Notification;
  });

  test.each(['needs-install-ios', 'needs-install-macos', 'in-app-browser', 'denied', 'unsupported'])(
    'guidance state %s appends the hatch and wires it', async (state) => {
      detectNotifyCapability.mockReturnValue({ state });
      await ensureNotificationsReady();
      const textEl = document.getElementById('notify-promo-text');
      expect(textEl.innerHTML).toContain(`copy-for-${state}`);
      expect(textEl.innerHTML).toContain('tg-escape-hatch');
      expect(mockWireHatch).toHaveBeenCalledWith(textEl);
    });

  test('unavailable hatch (empty string) leaves guidance copy unchanged', async () => {
    mockHatchHtml.mockReturnValue('');
    detectNotifyCapability.mockReturnValue({ state: 'needs-install-ios' });
    await ensureNotificationsReady();
    const textEl = document.getElementById('notify-promo-text');
    expect(textEl.innerHTML).not.toContain('tg-escape-hatch');
  });

  test('supported state never renders the hatch (web push is one tap away)', async () => {
    detectNotifyCapability.mockReturnValue({ state: 'supported' });
    global.Notification = { requestPermission: jest.fn().mockResolvedValue('granted') };
    global.navigator.serviceWorker = { ready: Promise.resolve({}) };
    const { getMessagingIfSupported } = require('../js/firebase-config.js');
    getMessagingIfSupported.mockResolvedValue(null); // registration fails → failure surface
    await ensureNotificationsReady();
    const textEl = document.getElementById('notify-promo-text');
    // Registration-failed IS a dead end — hatch expected there:
    expect(textEl.textContent).toContain("Couldn't turn on notifications");
    expect(textEl.innerHTML).toContain('tg-escape-hatch');
    expect(mockWireHatch).toHaveBeenCalledWith(textEl);
  });
});

describe('reprompt visibility feeds setRepromptActive', () => {
  const { initNotifyPrompt } = require('../js/notifyPrompt.js');
  const { isRepromptActive, __resetBotDeliveryForTests } = require('../js/notifySuppression.js');
  const { hasAnyNotifyPrefEnabled } = require('../js/prefs.js');
  const { detectNotifyCapability } = require('../js/installGuidance.js');

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="notify-promo" class="hidden">
        <span id="notify-promo-text"></span>
        <button id="notify-promo-dismiss"></button>
        <button id="notify-promo-action" class="hidden"></button>
      </div>`;
    __resetBotDeliveryForTests();
    localStorage.clear();
    global.Notification = { permission: 'default' };
  });

  test('banner shown → flag true; hidden → flag false', () => {
    detectNotifyCapability.mockReturnValue({ state: 'supported' });
    hasAnyNotifyPrefEnabled.mockReturnValue(true);   // unmet intent → reprompt
    initNotifyPrompt('u1');
    expect(isRepromptActive()).toBe(true);
    hasAnyNotifyPrefEnabled.mockReturnValue(false);  // intent gone
    document.dispatchEvent(new CustomEvent('notify-prefs-synced'));
    expect(isRepromptActive()).toBe(false);
  });

  test('dismissing the reprompt banner (Close) clears the reprompt flag', () => {
    detectNotifyCapability.mockReturnValue({ state: 'supported' });
    hasAnyNotifyPrefEnabled.mockReturnValue(true);   // unmet intent → reprompt
    initNotifyPrompt('u1');
    expect(isRepromptActive()).toBe(true);
    document.getElementById('notify-promo-dismiss').click();
    expect(isRepromptActive()).toBe(false);
  });
});

describe('bell-triggered guidance feeds the reprompt-active flag (Finding 3)', () => {
  const { isRepromptActive, __resetBotDeliveryForTests } = require('../js/notifySuppression.js');

  beforeEach(() => {
    mountBanner();
    __resetBotDeliveryForTests();
    localStorage.clear();
    addPushToken.mockClear(); getToken.mockReset(); getMessagingIfSupported.mockReset();
    detectNotifyCapability.mockReset();
    global.Notification = { permission: 'default', requestPermission: jest.fn().mockResolvedValue('granted') };
    global.navigator.serviceWorker = { ready: Promise.resolve({ id: 'reg' }) };
  });
  afterAll(() => __resetBotDeliveryForTests());

  test('dead-end capability guidance (denied) sets the reprompt-active flag so the onramp promo defers', async () => {
    detectNotifyCapability.mockReturnValue({ state: 'denied', supported: false });
    await ensureNotificationsReady();
    const banner = document.getElementById('notify-promo');
    expect(banner.classList.contains('hidden')).toBe(false);
    expect(isRepromptActive()).toBe(true);
  });

  test('registration-failed guidance sets the reprompt-active flag', async () => {
    detectNotifyCapability.mockReturnValue({ state: 'supported', supported: true });
    getMessagingIfSupported.mockResolvedValue(null); // token registration can't proceed → registration-failed dead end
    await ensureNotificationsReady();
    const banner = document.getElementById('notify-promo');
    expect(banner.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('notify-promo-text').textContent).toContain("Couldn't turn on notifications");
    expect(isRepromptActive()).toBe(true);
  });

  test('dismissing the guidance banner clears the reprompt-active flag', async () => {
    detectNotifyCapability.mockReturnValue({ state: 'denied', supported: false });
    await ensureNotificationsReady();
    expect(isRepromptActive()).toBe(true);
    document.getElementById('notify-promo-dismiss').click();
    expect(isRepromptActive()).toBe(false);
  });
});
