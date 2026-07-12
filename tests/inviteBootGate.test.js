/** @jest-environment jsdom */
jest.mock('../js/telegram.js', () => ({ isTelegramContext: jest.fn(() => false) }));
jest.mock('../js/identity.js', () => ({ loadIdentity: jest.fn(() => null) }));
jest.mock('../js/installGuidance.js', () => ({
  isStandalone: jest.fn(() => false),
  isInAppBrowser: jest.fn(() => false),
  isIos: jest.fn(() => false),
  isTelegramInAppBrowser: jest.fn(() => false),
}));
jest.mock('../js/inviteFlow.js', () => ({
  telegramSharingEnabled: jest.fn(() => true),
  buildTelegramInviteLink: jest.fn((t) => `https://t.me/bot/app?startapp=${t}`),
}));

const { decideBootRedirect, readBootRedirectContext, hasStayParam } = require('../js/inviteBootGate.js');
const { loadIdentity } = require('../js/identity.js');
const { isTelegramInAppBrowser, isInAppBrowser, isIos } = require('../js/installGuidance.js');
const { telegramSharingEnabled } = require('../js/inviteFlow.js');

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';
// Fresh in-app arrival baseline; each test overrides one dimension.
const fresh = (over = {}) => ({
  token: TOKEN, telegramContext: false, stay: false, hasIdentity: false,
  standalone: false, telegramAndroid: false, setupInstall: false,
  deepLink: `https://t.me/bot/app?startapp=${TOKEN}`,
  inAppBrowser: false, ios: false, sharingEnabled: true, ...over,
});

describe('decideBootRedirect — ordered rules (spec N3)', () => {
  test('rule 1: Mini App context never redirects', () => {
    expect(decideBootRedirect(fresh({ telegramContext: true, telegramAndroid: true }))).toBeNull();
  });
  test('rule 2: stay=1 beats everything but the Mini App', () => {
    expect(decideBootRedirect(fresh({ stay: true, telegramAndroid: true, inAppBrowser: true, ios: true }))).toBeNull();
  });
  test('rule 3: identity beats detection (C3, accepted); standalone too', () => {
    expect(decideBootRedirect(fresh({ hasIdentity: true, telegramAndroid: true, inAppBrowser: true }))).toBeNull();
    expect(decideBootRedirect(fresh({ standalone: true, ios: true }))).toBeNull();
  });
  test('rule 4: Telegram-Android + deep link → auto-hop (Q4=A)', () => {
    expect(decideBootRedirect(fresh({ telegramAndroid: true, inAppBrowser: true })))
      .toEqual({ kind: 'hop', url: `https://t.me/bot/app?startapp=${TOKEN}` });
  });
  test('rule 4→5: Telegram-Android WITHOUT a deep link falls through to the landing', () => {
    expect(decideBootRedirect(fresh({ telegramAndroid: true, inAppBrowser: true, deepLink: null })))
      .toEqual({ kind: 'landing', url: `/invite?i=${TOKEN}` });
  });
  test('rule 5: any other detected in-app browser → landing, EVEN with Telegram off (holistic)', () => {
    expect(decideBootRedirect(fresh({ inAppBrowser: true, sharingEnabled: false })))
      .toEqual({ kind: 'landing', url: `/invite?i=${TOKEN}` });
  });
  test('rule 6: iOS-undetected net requires telegramSharingEnabled', () => {
    expect(decideBootRedirect(fresh({ ios: true })))
      .toEqual({ kind: 'landing', url: `/invite?i=${TOKEN}` });
    expect(decideBootRedirect(fresh({ ios: true, sharingEnabled: false }))).toBeNull();
  });
  test('rule 7: desktop / real Android browser → null', () => {
    expect(decideBootRedirect(fresh())).toBeNull();
  });
});

describe('tokenless boots (phase 3, Q8=C: root = signed-out landing)', () => {
  test('EVERY fresh tokenless boot redirects to /about — no detection condition', () => {
    expect(decideBootRedirect(fresh({ token: null, deepLink: null })))
      .toEqual({ kind: 'landing', url: '/about' });                    // desktop / real browser
    expect(decideBootRedirect(fresh({ token: null, deepLink: null, ios: true })))
      .toEqual({ kind: 'landing', url: '/about' });                    // iOS — the blind spot, closed
    expect(decideBootRedirect(fresh({ token: null, deepLink: null, inAppBrowser: true })))
      .toEqual({ kind: 'landing', url: '/about' });                    // webviews as in phase 2
  });
  test('signed-in / standalone / stay / Mini App pass through unchanged', () => {
    expect(decideBootRedirect(fresh({ token: null, deepLink: null, hasIdentity: true }))).toBeNull();
    expect(decideBootRedirect(fresh({ token: null, deepLink: null, standalone: true }))).toBeNull();
    expect(decideBootRedirect(fresh({ token: null, deepLink: null, stay: true }))).toBeNull();
    expect(decideBootRedirect(fresh({ token: null, deepLink: null, telegramContext: true }))).toBeNull();
  });
});

describe('setup=install exemption (Q8=C: the Safari install-hop is deliberately fresh)', () => {
  test('gate-wide: exempts tokenless AND token boots', () => {
    expect(decideBootRedirect(fresh({ token: null, deepLink: null, setupInstall: true }))).toBeNull();
    expect(decideBootRedirect(fresh({ setupInstall: true, ios: true }))).toBeNull();
    expect(decideBootRedirect(fresh({ setupInstall: true, telegramAndroid: true, inAppBrowser: true }))).toBeNull();
  });
  test('readBootRedirectContext reads it from the URL', () => {
    window.history.replaceState(null, '', '/?setup=install');
    expect(readBootRedirectContext(null).setupInstall).toBe(true);
    window.history.replaceState(null, '', '/');
    expect(readBootRedirectContext(null).setupInstall).toBe(false);
  });
});

describe('readBootRedirectContext + hasStayParam', () => {
  test('gathers the env into the ctx shape', () => {
    loadIdentity.mockReturnValueOnce({ userId: 'u' });
    isTelegramInAppBrowser.mockReturnValueOnce(true);
    const ctx = readBootRedirectContext(TOKEN);
    expect(ctx).toMatchObject({
      token: TOKEN, hasIdentity: true, telegramAndroid: true,
      deepLink: `https://t.me/bot/app?startapp=${TOKEN}`,
    });
  });
  test('no token → deepLink null, token null', () => {
    const ctx = readBootRedirectContext(null);
    expect(ctx.token).toBeNull();
    expect(ctx.deepLink).toBeNull();
  });
  test('hasStayParam reads ?stay=1 from the URL', () => {
    window.history.replaceState(null, '', '/?stay=1');
    expect(hasStayParam()).toBe(true);
    window.history.replaceState(null, '', '/?i=x');
    expect(hasStayParam()).toBe(false);
  });
});
