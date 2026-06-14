// tests/installGuidance.test.js
const { detectNotifyCapability } = require('../js/installGuidance.js');

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
