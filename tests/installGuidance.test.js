// tests/installGuidance.test.js
const { detectNotifyCapability, isFirefoxDesktop, isStandalone, shouldPrimeRestore, isInAppBrowser } = require('../js/installGuidance.js');

function setUA(ua) {
  Object.defineProperty(global.navigator, 'userAgent', { value: ua, configurable: true });
}
function setStandalone(matches) {
  global.window.matchMedia = () => ({ matches });
}
// Simulate a Chromium browser exposing the beforeinstallprompt capability. jsdom
// doesn't define `onbeforeinstallprompt`, so `'onbeforeinstallprompt' in window`
// is false by default; assigning null makes the feature-detect read true.
function setInstallPromptSupport(on) {
  if (on) global.window.onbeforeinstallprompt = null;
  else delete global.window.onbeforeinstallprompt;
}
beforeEach(() => {
  setStandalone(false);
  global.window.PushManager = function () {};
  global.window.Notification = { permission: 'default' };
  global.navigator.serviceWorker = {};
  delete global.navigator.standalone;
  delete global.window.onbeforeinstallprompt;
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

test('iOS Chrome (CriOS) → needs-install-ios (real browser, not in-app)', () => {
  setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) CriOS/120 Mobile');
  delete global.window.PushManager;
  expect(detectNotifyCapability().state).toBe('needs-install-ios');
});

test('in-app browser (Instagram) → in-app-browser', () => {
  setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0');
  delete global.window.PushManager;
  expect(detectNotifyCapability().state).toBe('in-app-browser');
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
  expect(guidanceCopyFor('in-app-browser').body).toMatch(/browser/i);
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

test('in-app-browser copy includes the secret-phrase reminder flag', () => {
  expect(guidanceCopyFor('in-app-browser').remindPhrase).toBe(true);
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
  test('iOS Chrome/Firefox (real browser) → ios-install', () => {
    setUA(IOS_CHROME); setStandalone(false);
    expect(onboardingLane({ installPromptAvailable: false })).toBe('ios-install');
  });
  test('in-app browser (Instagram) → in-app-browser', () => {
    const INSTAGRAM = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0';
    setUA(INSTAGRAM); setStandalone(false);
    expect(onboardingLane({ installPromptAvailable: false })).toBe('in-app-browser');
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
  test('Chromium without captured event but feature-detected → installable', () => {
    setUA(WIN_CHROME); setStandalone(false); setInstallPromptSupport(true);
    // Capability is present from page load, so we surface the lane before the
    // browser fires beforeinstallprompt.
    expect(onboardingLane({ installPromptAvailable: false })).toBe('installable');
  });
  test('no install-prompt support and no captured event → ready', () => {
    setUA(WIN_CHROME); setStandalone(false); setInstallPromptSupport(false);
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

describe('installPromptStepHtml', () => {
  const { installPromptStepHtml } = require('../js/installGuidance.js');
  test('desktop Chromium → address-bar install glyph + menu', () => {
    setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36');
    const html = installPromptStepHtml();
    expect(html).toContain('address bar');
    expect(html).toContain('Install KnockKnock');
    expect(html).not.toContain('To get notified'); // step only, no duplicate lead
  });
  test('Android Chromium → Add to Home screen via menu', () => {
    setUA('Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36');
    const html = installPromptStepHtml();
    expect(html).toContain('Add to Home screen');
    expect(html).not.toContain('address bar');
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

describe('isInAppBrowser', () => {
  test('true for Instagram UA', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0');
    expect(isInAppBrowser()).toBe(true);
  });
  test('true for Android WebView UA', () => {
    setUA('Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120 Mobile Safari/537.36');
    expect(isInAppBrowser()).toBe(true);
  });
  test('true for Telegram iOS in-app browser (appends "Telegram <version>")', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1 Telegram 10.9');
    expect(isInAppBrowser()).toBe(true);
  });
  test('false for plain desktop Chrome', () => {
    setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36');
    expect(isInAppBrowser()).toBe(false);
  });
  test('false for iOS Safari', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1');
    expect(isInAppBrowser()).toBe(false);
  });
});

describe('isTelegramInAppBrowser + isIos exports (spec N7)', () => {
  const { isTelegramInAppBrowser, isIos } = require('../js/installGuidance.js');
  const setNav = (ua, touch = 0) => {
    Object.defineProperty(global.navigator, 'userAgent', { value: ua, configurable: true });
    Object.defineProperty(global.navigator, 'maxTouchPoints', { value: touch, configurable: true });
  };

  test('Telegram-Android webview → true', () => {
    setNav('Mozilla/5.0 (Linux; Android 14; Pixel) Telegram-Android/11.5 Chrome/120 Mobile Safari/537.36');
    expect(isTelegramInAppBrowser()).toBe(true);
  });

  test('iOS Telegram is UA-identical to Safari → false (the documented blindness)', () => {
    setNav('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Version/17.4 Mobile/15E148 Safari/604.1');
    expect(isTelegramInAppBrowser()).toBe(false);
  });

  test('plain Android Chrome → false', () => {
    setNav('Mozilla/5.0 (Linux; Android 14; Pixel) Chrome/120 Mobile Safari/537.36');
    expect(isTelegramInAppBrowser()).toBe(false);
  });

  test('isIos: iPhone true; iPadOS-as-Macintosh (touch) true; desktop Mac false', () => {
    setNav('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Safari/604.1');
    expect(isIos()).toBe(true);
    setNav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 5);
    expect(isIos()).toBe(true);
    setNav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 0);
    expect(isIos()).toBe(false);
  });
});
