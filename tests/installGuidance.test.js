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
