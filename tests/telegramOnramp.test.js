/** @jest-environment jsdom */
// TELEGRAM_ENABLED is already true in js/features.js on this branch, so the
// enabled=true cases need no features.js mock (matches inviteFlow.test.js's
// approach of relying on the real flag rather than mocking it).
const mockMint = jest.fn(async () => ({ token: 'tok_xyz' }));
const mockToast = jest.fn();
const mockFirstRunActive = jest.fn(() => false);
jest.mock('../js/telegram.js', () => ({
  isTelegramContext: jest.fn(() => false),
}));
jest.mock('../js/firebase-config.js', () => ({
  callMintTelegramLinkToken: (...a) => mockMint(...a),
}));
jest.mock('../js/groups.js', () => ({ showToast: (...a) => mockToast(...a) }));
jest.mock('../js/firstRun.js', () => ({ isFirstRunActive: (...a) => mockFirstRunActive(...a) }));

describe('telegramOnramp', () => {
  beforeEach(() => {
    jest.resetModules();
    mockMint.mockClear(); mockMint.mockResolvedValue({ token: 'tok_xyz' });
    mockToast.mockClear();
    mockFirstRunActive.mockReset(); mockFirstRunActive.mockReturnValue(false);
  });

  test('enabled on web with a configured app link', () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/knockbot/app';
    const { telegramOnrampEnabled } = require('../js/telegramOnramp.js');
    expect(telegramOnrampEnabled()).toBe(true);
  });

  test('disabled when no app link is configured', () => {
    process.env.TELEGRAM_APP_LINK = '';
    const { telegramOnrampEnabled } = require('../js/telegramOnramp.js');
    expect(telegramOnrampEnabled()).toBe(false);
  });

  test('disabled inside Telegram (isTelegramContext true)', () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/knockbot/app';
    jest.resetModules();
    jest.doMock('../js/telegram.js', () => ({ isTelegramContext: jest.fn(() => true) }));
    const { telegramOnrampEnabled } = require('../js/telegramOnramp.js');
    expect(telegramOnrampEnabled()).toBe(false);
  });

  test('builds the lk_ deep link', () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/knockbot/app';
    const { buildLinkDeepLink } = require('../js/telegramOnramp.js');
    expect(buildLinkDeepLink('tok_xyz')).toBe('https://t.me/knockbot/app?startapp=lk_tok_xyz');
    expect(buildLinkDeepLink('')).toBeNull();
  });

  test('buildLinkDeepLink: null when unconfigured', () => {
    process.env.TELEGRAM_APP_LINK = '';
    const { buildLinkDeepLink } = require('../js/telegramOnramp.js');
    expect(buildLinkDeepLink('tok_xyz')).toBeNull();
  });

  test('startTelegramOnramp mints then opens the deep link', async () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/knockbot/app';
    const { startTelegramOnramp } = require('../js/telegramOnramp.js');
    const open = jest.spyOn(window, 'open').mockReturnValue({});
    const ok = await startTelegramOnramp();
    expect(ok).toBe(true);
    expect(mockMint).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://t.me/knockbot/app?startapp=lk_tok_xyz', '_blank');
    open.mockRestore();
  });

  test('startTelegramOnramp mints a fresh token every call (no caching)', async () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/knockbot/app';
    const { startTelegramOnramp } = require('../js/telegramOnramp.js');
    const open = jest.spyOn(window, 'open').mockReturnValue({});
    await startTelegramOnramp();
    await startTelegramOnramp();
    expect(mockMint).toHaveBeenCalledTimes(2);
    open.mockRestore();
  });

  test('startTelegramOnramp: returns false when the popup is blocked', async () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/knockbot/app';
    const { startTelegramOnramp } = require('../js/telegramOnramp.js');
    const open = jest.spyOn(window, 'open').mockReturnValue(null);
    expect(await startTelegramOnramp()).toBe(false);
    open.mockRestore();
  });

  test('startTelegramOnramp: returns false (no open) when unconfigured', async () => {
    process.env.TELEGRAM_APP_LINK = '';
    const { startTelegramOnramp } = require('../js/telegramOnramp.js');
    const open = jest.spyOn(window, 'open').mockReturnValue({});
    expect(await startTelegramOnramp()).toBe(false);
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  // U1.4 — the onramp's failure paths must not be silent.
  test('U1.4: popup blocked → copies the deep link and toasts', async () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/knockbot/app';
    const writeText = jest.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { startTelegramOnramp } = require('../js/telegramOnramp.js');
    const open = jest.spyOn(window, 'open').mockReturnValue(null);
    const ok = await startTelegramOnramp();
    expect(ok).toBe(false);
    expect(writeText).toHaveBeenCalledWith('https://t.me/knockbot/app?startapp=lk_tok_xyz');
    expect(mockToast).toHaveBeenCalledWith('Link copied — open it in Telegram.');
    open.mockRestore();
  });

  test('U1.4: mint failure → error toast, returns false, does not open or throw', async () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/knockbot/app';
    mockMint.mockRejectedValueOnce(new Error('offline'));
    const { startTelegramOnramp } = require('../js/telegramOnramp.js');
    const open = jest.spyOn(window, 'open').mockReturnValue({});
    const ok = await startTelegramOnramp();
    expect(ok).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith("Couldn't reach Telegram right now. Try again.");
    open.mockRestore();
  });
});

describe('telegramOnramp DOM (initTelegramOnramp / syncTelegramOnramp)', () => {
  function mountDom() {
    document.body.innerHTML = `
      <div id="tg-onramp-promo" class="hidden"><button id="tg-onramp-action"></button><button id="tg-onramp-dismiss"></button></div>
      <div id="drawer-section-account" class="hidden">
        <div id="tg-onramp-drawer" class="hidden"><button id="tg-onramp-drawer-btn"></button></div>
      </div>`;
  }

  beforeEach(() => {
    jest.resetModules();
    // An earlier test in this file (`disabled inside Telegram`) doMocks
    // isTelegramContext → true; that override survives resetModules, so
    // re-assert the false case here rather than relying on the top-level mock.
    jest.doMock('../js/telegram.js', () => ({ isTelegramContext: jest.fn(() => false) }));
    mockMint.mockClear(); mockMint.mockResolvedValue({ token: 'tok_xyz' });
    mockToast.mockClear();
    mockFirstRunActive.mockReset(); mockFirstRunActive.mockReturnValue(false);
    localStorage.clear();
    process.env.TELEGRAM_APP_LINK = 'https://t.me/knockbot/app';
    mountDom();
  });

  test('init shows banner + card when enabled and unlinked', () => {
    const { initTelegramOnramp } = require('../js/telegramOnramp.js');
    initTelegramOnramp();
    expect(document.getElementById('tg-onramp-promo').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('tg-onramp-drawer').classList.contains('hidden')).toBe(false);
  });

  test('dismiss hides the banner forever (device-local), card stays', () => {
    const { initTelegramOnramp } = require('../js/telegramOnramp.js');
    initTelegramOnramp();
    document.getElementById('tg-onramp-dismiss').click();
    expect(document.getElementById('tg-onramp-promo').classList.contains('hidden')).toBe(true);
    mountDom();
    initTelegramOnramp(); // re-mount = new "session"
    expect(document.getElementById('tg-onramp-promo').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('tg-onramp-drawer').classList.contains('hidden')).toBe(false);
  });

  test('syncTelegramOnramp hides both once linked', () => {
    const { initTelegramOnramp, syncTelegramOnramp } = require('../js/telegramOnramp.js');
    initTelegramOnramp();
    syncTelegramOnramp({ telegram: { tgId: '42' } });
    expect(document.getElementById('tg-onramp-promo').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('tg-onramp-drawer').classList.contains('hidden')).toBe(true);
  });

  test('init hides both when disabled (no app link configured)', () => {
    process.env.TELEGRAM_APP_LINK = '';
    const { initTelegramOnramp } = require('../js/telegramOnramp.js');
    initTelegramOnramp();
    expect(document.getElementById('tg-onramp-promo').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('tg-onramp-drawer').classList.contains('hidden')).toBe(true);
  });

  test('action button starts the onramp flow', async () => {
    const { initTelegramOnramp } = require('../js/telegramOnramp.js');
    const open = jest.spyOn(window, 'open').mockReturnValue({});
    initTelegramOnramp();
    document.getElementById('tg-onramp-action').click();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockMint).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });

  // U1.7 — a web-side success beat once linking completes, but only when this
  // session actually started the onramp (not for an already-linked account).
  test('U1.7: success toast when linking completes after the CTA was tapped', async () => {
    const { initTelegramOnramp, syncTelegramOnramp } = require('../js/telegramOnramp.js');
    const open = jest.spyOn(window, 'open').mockReturnValue({});
    initTelegramOnramp();
    document.getElementById('tg-onramp-action').click();
    await Promise.resolve(); await Promise.resolve();
    syncTelegramOnramp({ telegram: { tgId: '42' } });
    expect(mockToast).toHaveBeenCalledWith('Linked — KnockKnock now works in your Telegram too.');
    open.mockRestore();
  });

  test('U1.7: no success toast for an already-linked account (no CTA tap)', () => {
    const { initTelegramOnramp, syncTelegramOnramp } = require('../js/telegramOnramp.js');
    initTelegramOnramp();
    syncTelegramOnramp({ telegram: { tgId: '42' } });
    expect(mockToast).not.toHaveBeenCalled();
  });

  // U2.2 — the first-run gate applies to the PROMO ONLY; the drawer card stays.
  test('U2.2: during first-run the promo is hidden but the drawer card is shown', () => {
    mockFirstRunActive.mockReturnValue(true);
    const { initTelegramOnramp } = require('../js/telegramOnramp.js');
    initTelegramOnramp();
    expect(document.getElementById('tg-onramp-promo').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('tg-onramp-drawer').classList.contains('hidden')).toBe(false);
  });

  test('U2.2: promo reappears on first-run-change once the empty state clears', () => {
    mockFirstRunActive.mockReturnValue(true);
    const { initTelegramOnramp } = require('../js/telegramOnramp.js');
    initTelegramOnramp();
    expect(document.getElementById('tg-onramp-promo').classList.contains('hidden')).toBe(true);
    mockFirstRunActive.mockReturnValue(false);
    document.dispatchEvent(new CustomEvent('first-run-change'));
    expect(document.getElementById('tg-onramp-promo').classList.contains('hidden')).toBe(false);
  });
});
