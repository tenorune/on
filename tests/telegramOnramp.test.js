/** @jest-environment jsdom */
// Pin TELEGRAM_ENABLED on so the enabled=true cases don't depend on the flag
// literal in js/features.js (false on mainline, true on the feature/launch
// branches). Other flags stay real via requireActual.
jest.mock('../js/features.js', () => ({
  ...jest.requireActual('../js/features.js'),
  TELEGRAM_ENABLED: true,
}));
const mockMint = jest.fn(async () => ({ token: 'tok_xyz' }));
const mockToast = jest.fn();
const mockFirstRunActive = jest.fn(() => false);
// Default RESOLVED: steady-state (the list has rendered at least once). The
// boot-window flash test flips this to unresolved.
const mockFirstRunResolved = jest.fn(() => true);
jest.mock('../js/telegram.js', () => ({
  isTelegramContext: jest.fn(() => false),
}));
jest.mock('../js/firebase-config.js', () => ({
  callMintTelegramLinkToken: (...a) => mockMint(...a),
}));
jest.mock('../js/groups.js', () => ({ showToast: (...a) => mockToast(...a) }));
jest.mock('../js/firstRun.js', () => ({
  isFirstRunActive: (...a) => mockFirstRunActive(...a),
  isFirstRunResolved: (...a) => mockFirstRunResolved(...a),
}));

describe('telegramOnramp', () => {
  beforeEach(() => {
    jest.resetModules();
    mockMint.mockClear(); mockMint.mockResolvedValue({ token: 'tok_xyz' });
    mockToast.mockClear();
    mockFirstRunActive.mockReset(); mockFirstRunActive.mockReturnValue(false);
    mockFirstRunResolved.mockReset(); mockFirstRunResolved.mockReturnValue(true);
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

  // Installed PWAs block window.open('_blank'). Rather than dead-end, navigate
  // the current context (_self is a navigation, not a popup, so it's not
  // blocked) — the deep link still opens Telegram.
  test('startTelegramOnramp: blocked new tab → navigates current context (_self), returns true', async () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/knockbot/app';
    const { startTelegramOnramp } = require('../js/telegramOnramp.js');
    const open = jest.spyOn(window, 'open').mockReturnValue(null);
    expect(await startTelegramOnramp()).toBe(true);
    expect(open).toHaveBeenCalledWith('https://t.me/knockbot/app?startapp=lk_tok_xyz', '_self');
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

  function promoDom() {
    document.body.innerHTML = `
      <div id="tg-onramp-promo" class="hidden">
        <button id="tg-onramp-action"></button>
        <button id="tg-onramp-dismiss"></button>
      </div>
      <div id="tg-onramp-drawer" class="hidden">
        <button id="tg-onramp-drawer-btn"></button>
      </div>
      <div id="drawer-section-account" class="hidden"></div>`;
  }

  test('startTelegramOnrampFromNudge disables the button in flight and arms the success beat', async () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/knockbot/app';
    let release;
    mockMint.mockReturnValue(new Promise((r) => { release = () => r({ token: 'tok_xyz' }); }));
    const open = jest.spyOn(window, 'open').mockReturnValue({});
    const mod = require('../js/telegramOnramp.js');
    const btn = document.createElement('button');
    const flight = mod.startTelegramOnrampFromNudge(btn);
    expect(btn.disabled).toBe(true);
    release(); await flight;
    expect(btn.disabled).toBe(false);
    // Success beat: the linked echo now toasts (same as the promo CTA path).
    mod.syncTelegramOnramp({ telegram: { linkedAt: 1 } });
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('Linked'));
    open.mockRestore();
  });

  test('startTelegramOnrampFromNudge on mint failure re-enables and does NOT arm the beat', async () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/knockbot/app';
    mockMint.mockRejectedValue(new Error('nope'));
    const mod = require('../js/telegramOnramp.js');
    const btn = document.createElement('button');
    await mod.startTelegramOnrampFromNudge(btn);
    expect(btn.disabled).toBe(false);
    mockToast.mockClear();
    mod.syncTelegramOnramp({ telegram: { linkedAt: 1 } });
    expect(mockToast).not.toHaveBeenCalled(); // no beat armed by the failed tap
  });

  test('promo defers while the reprompt is active and resumes on reprompt-change', () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/knockbot/app';
    localStorage.clear();   // the promo's dismissed flag persists across tests in jsdom
    // An earlier test ('disabled inside Telegram') doMocks isTelegramContext →
    // true; that override survives resetModules (see the DOM describe block's
    // beforeEach), so re-assert the false case here too.
    jest.doMock('../js/telegram.js', () => ({ isTelegramContext: jest.fn(() => false) }));
    promoDom();
    const { setRepromptActive } = require('../js/notifySuppression.js');
    const mod = require('../js/telegramOnramp.js');
    setRepromptActive(true);
    mod.initTelegramOnramp();
    mod.syncTelegramOnramp({});          // unlinked
    const promo = document.getElementById('tg-onramp-promo');
    expect(promo.classList.contains('hidden')).toBe(true);   // reprompt holds it
    expect(mod.isOnrampPromoActive()).toBe(false);
    setRepromptActive(false);            // fires reprompt-change → refresh()
    expect(promo.classList.contains('hidden')).toBe(false);  // resumes
    expect(mod.isOnrampPromoActive()).toBe(true);
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
    mockFirstRunResolved.mockReset(); mockFirstRunResolved.mockReturnValue(true);
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

  // Boot-window flash (iOS FTU): initTelegramOnramp runs before initList's first
  // render establishes the empty state, so isFirstRunActive() is still false but
  // the guided empty state is merely UNRESOLVED, not absent. The promo must stay
  // hidden until the list has rendered once (isFirstRunResolved), else it flashes
  // before the guided empty state replaces it.
  test('promo stays hidden until the first-run state is resolved (no boot flash)', () => {
    mockFirstRunActive.mockReturnValue(false);   // not (yet) active…
    mockFirstRunResolved.mockReturnValue(false); // …because the list hasn't rendered yet
    const { initTelegramOnramp, isOnrampPromoActive } = require('../js/telegramOnramp.js');
    initTelegramOnramp();
    expect(document.getElementById('tg-onramp-promo').classList.contains('hidden')).toBe(true);
    expect(isOnrampPromoActive()).toBe(false);
    // The drawer card is opt-in and stays reachable throughout.
    expect(document.getElementById('tg-onramp-drawer').classList.contains('hidden')).toBe(false);
    // First render lands (non-empty account): resolved, not active → promo shows.
    mockFirstRunResolved.mockReturnValue(true);
    document.dispatchEvent(new CustomEvent('first-run-change'));
    expect(document.getElementById('tg-onramp-promo').classList.contains('hidden')).toBe(false);
    expect(isOnrampPromoActive()).toBe(true);
  });

  // Coordination signal for the install/notify nudge (the two must not co-show).
  test('isOnrampPromoActive tracks promo visibility and dispatches onramp-change on change', () => {
    const { initTelegramOnramp, isOnrampPromoActive, syncTelegramOnramp } = require('../js/telegramOnramp.js');
    const onChange = jest.fn();
    document.addEventListener('onramp-change', onChange);
    initTelegramOnramp(); // enabled, unlinked, not first-run → promo active
    expect(isOnrampPromoActive()).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1); // false → true
    syncTelegramOnramp({ telegram: { tgId: '42' } }); // linked → promo off
    expect(isOnrampPromoActive()).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(2); // true → false
    document.removeEventListener('onramp-change', onChange);
  });
});
