// tests/installGuidance.test.js
const { detectNotifyCapability, isFirefoxDesktop, isStandalone, shouldPrimeRestore } = require('../js/installGuidance.js');

function setUA(ua) {
  Object.defineProperty(global.navigator, 'userAgent', { value: ua, configurable: true });
}
function setStandalone(matches) {
  global.window.matchMedia = () => ({ matches });
}
beforeEach(() => {
  setStandalone(false);
  global.window.PushManager = function () {};
  global.window.Notification = { permission: 'default' };
  global.navigator.serviceWorker = {};
  delete global.navigator.standalone;
});

test('desktop Chrome with Push API → supported', () => {
  setUA('Mozilla/5.0 (Windows NT 10.0) Chrome/120');
  expect(detectNotifyCapability().state).toBe('supported');
});

test('permission already denied → denied', () => {
  setUA('Mozilla/5.0 (Windows NT 10.0) Chrome/120');
  global.window.Notification = { permission: 'denied' };
  expect(detectNotifyCapability().state).toBe('denied');
});

test('iOS Safari tab (no Push API, not standalone) → needs-install-ios', () => {
  setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Safari');
  delete global.window.PushManager;
  expect(detectNotifyCapability().state).toBe('needs-install-ios');
});

test('iOS Chrome (CriOS) → ios-use-safari', () => {
  setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) CriOS/120 Mobile');
  delete global.window.PushManager;
  expect(detectNotifyCapability().state).toBe('ios-use-safari');
});

test('iOS Safari installed (standalone, Push API present) → supported', () => {
  setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Safari');
  setStandalone(true);
  expect(detectNotifyCapability().state).toBe('supported');
});

test('in-browser macOS Safari (not installed) → needs-install-macos', () => {
  // In-browser macOS Safari has the Push API, but delivery is unreliable there;
  // the working path is an installed Dock app. Treat it like iOS needs-install.
  setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15');
  setStandalone(false);
  expect(detectNotifyCapability().state).toBe('needs-install-macos');
});

test('installed (Dock) macOS Safari web app → supported', () => {
  setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15');
  setStandalone(true);
  expect(detectNotifyCapability().state).toBe('supported');
});

test('desktop Chrome on macOS is NOT treated as needs-install-macos', () => {
  setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36');
  setStandalone(false);
  expect(detectNotifyCapability().state).toBe('supported');
});

describe('isFirefoxDesktop', () => {
  test('true for desktop Firefox', () => {
    setUA('Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0');
    expect(isFirefoxDesktop()).toBe(true);
  });
  test('false for Firefox on Android', () => {
    setUA('Mozilla/5.0 (Android 14; Mobile; rv:125.0) Gecko/125.0 Firefox/125.0');
    expect(isFirefoxDesktop()).toBe(false);
  });
  test('false for Firefox on iOS (FxiOS)', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) FxiOS/125.0 Mobile/15E148 Safari/605');
    expect(isFirefoxDesktop()).toBe(false);
  });
  test('false for Chrome', () => {
    setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36');
    expect(isFirefoxDesktop()).toBe(false);
  });
});

describe('isStandalone (exported)', () => {
  test('true when display-mode standalone matches', () => {
    setStandalone(true);
    expect(isStandalone()).toBe(true);
  });
  test('false otherwise', () => {
    setStandalone(false);
    delete global.navigator.standalone;
    expect(isStandalone()).toBe(false);
  });
});

const { guidanceCopyFor } = require('../js/installGuidance.js');

test('guidanceCopyFor maps each state to a non-empty message', () => {
  expect(guidanceCopyFor('needs-install-ios').body).toMatch(/Home Screen/i);
  expect(guidanceCopyFor('ios-use-safari').body).toMatch(/Safari/i);
  expect(guidanceCopyFor('denied').body).toMatch(/settings/i);
});

test('denied copy gives the Safari-specific re-enable path on macOS Safari', () => {
  setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15');
  const body = guidanceCopyFor('denied').body;
  expect(body).toMatch(/Safari/);
  expect(body).toMatch(/Websites/i); // Safari → Settings → Websites → Notifications
});

test('denied copy points to the address-bar site settings on non-Safari', () => {
  setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36');
  const body = guidanceCopyFor('denied').body;
  expect(body).toMatch(/address bar|site settings|site info/i);
  expect(body).not.toMatch(/Websites/); // not the Safari menu path
});

test('iOS install copy includes the secret-phrase reminder flag', () => {
  expect(guidanceCopyFor('needs-install-ios').remindPhrase).toBe(true);
  expect(guidanceCopyFor('denied').remindPhrase).toBe(false);
});

test('macOS install copy points to the Dock and includes the secret-phrase reminder', () => {
  const copy = guidanceCopyFor('needs-install-macos');
  expect(copy.body).toMatch(/Dock/i);
  expect(copy.remindPhrase).toBe(true);
});

test('iOS install copy embeds the Share and Add-to-Home step icons inline', () => {
  const body = guidanceCopyFor('needs-install-ios').body;
  expect((body.match(/class="step-icon"/g) || []).length).toBe(2);
});

test('macOS install copy embeds the Add-to-Dock step icon inline', () => {
  expect(guidanceCopyFor('needs-install-macos').body).toContain('class="step-icon"');
});

test('macOS install copy scopes the requirement to Safari ("In Safari on a Mac")', () => {
  expect(guidanceCopyFor('needs-install-macos').body).toMatch(/In Safari on a Mac/i);
});

test('iOS "use Safari" copy embeds the Share and Add-to-Home step icons inline', () => {
  const body = guidanceCopyFor('ios-use-safari').body;
  expect((body.match(/class="step-icon"/g) || []).length).toBe(2);
});

const { onboardingLane } = require('../js/installGuidance.js');

describe('onboardingLane', () => {
  const IOS_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
  const IOS_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605 CriOS/120 Mobile/15E148 Safari/604.1';
  const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
  const WIN_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
  const LINUX_FF = 'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0';

  test('standalone → ready regardless of UA', () => {
    setUA(IOS_SAFARI); setStandalone(true);
    expect(onboardingLane({ installPromptAvailable: false })).toBe('ready');
  });
  test('iOS third-party browser → ios-use-safari', () => {
    setUA(IOS_CHROME); setStandalone(false);
    expect(onboardingLane({ installPromptAvailable: false })).toBe('ios-use-safari');
  });
  test('iOS Safari tab → ios-install', () => {
    setUA(IOS_SAFARI); setStandalone(false);
    expect(onboardingLane({ installPromptAvailable: false })).toBe('ios-install');
  });
  test('macOS Safari tab → macos-install', () => {
    setUA(MAC_SAFARI); setStandalone(false); global.navigator.maxTouchPoints = 0;
    expect(onboardingLane({ installPromptAvailable: false })).toBe('macos-install');
  });
  test('Chrome desktop with prompt available → installable', () => {
    setUA(WIN_CHROME); setStandalone(false);
    expect(onboardingLane({ installPromptAvailable: true })).toBe('installable');
  });
  test('Chrome desktop without prompt yet → ready', () => {
    setUA(WIN_CHROME); setStandalone(false);
    expect(onboardingLane({ installPromptAvailable: false })).toBe('ready');
  });
  test('desktop Firefox → push-in-tab', () => {
    setUA(LINUX_FF); setStandalone(false);
    expect(onboardingLane({ installPromptAvailable: false })).toBe('push-in-tab');
  });

  // Regression: desktop Chrome on macOS exposes 'ontouchend' without a touchscreen.
  // isIos() must key off maxTouchPoints (Macs report 0), not 'ontouchend', or
  // Chrome-macOS is misrouted into the iOS install lane (issue: install step shown
  // after account creation instead of landing in the app with the install toast).
  test('Chrome on macOS (exposes ontouchend, no touch) is NOT iOS → installable/ready', () => {
    const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    setUA(MAC_CHROME); setStandalone(false);
    global.navigator.maxTouchPoints = 0;
    document.ontouchend = null; // desktop Chrome exposes touch event handlers
    expect(onboardingLane({ installPromptAvailable: true })).toBe('installable');
    expect(onboardingLane({ installPromptAvailable: false })).toBe('ready');
    delete document.ontouchend;
  });

  test('iPadOS Safari (Macintosh + touch points) → ios-install', () => {
    setUA(MAC_SAFARI); setStandalone(false);
    global.navigator.maxTouchPoints = 5;
    expect(onboardingLane({ installPromptAvailable: false })).toBe('ios-install');
    global.navigator.maxTouchPoints = 0;
  });
});

describe('shouldPrimeRestore', () => {
  test('standalone + no identity → true', () => {
    expect(shouldPrimeRestore({ standalone: true, hasIdentity: false })).toBe(true);
  });
  test('standalone + has identity → false', () => {
    expect(shouldPrimeRestore({ standalone: true, hasIdentity: true })).toBe(false);
  });
  test('not standalone → false', () => {
    expect(shouldPrimeRestore({ standalone: false, hasIdentity: false })).toBe(false);
  });
});
