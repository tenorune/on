function setUA(ua) { Object.defineProperty(global.navigator, 'userAgent', { value: ua, configurable: true }); }
function setStandalone(matches) { global.window.matchMedia = () => ({ matches }); }

jest.mock('../js/firstRun.js', () => ({ isFirstRunActive: jest.fn(() => false) }));
jest.mock('../js/telegram.js', () => ({ isTelegramContext: jest.fn(() => false) }));
jest.mock('../js/telegramOnramp.js', () => ({ isOnrampPromoActive: jest.fn(() => false) }));

const { pushInTabCopy } = require('../js/installAffordance.js');

describe('pushInTabCopy', () => {
  test('macOS lists Safari, Chrome, or Edge', () => {
    setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko Firefox/125.0');
    expect(pushInTabCopy()).toContain('Safari, Chrome, or Edge');
    expect(pushInTabCopy()).toContain('even when your browser is closed');
  });
  test('non-macOS lists Chrome or Edge only', () => {
    setUA('Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko Firefox/125.0');
    expect(pushInTabCopy()).toContain('Chrome or Edge');
    expect(pushInTabCopy()).not.toContain('Safari');
  });
});

describe('install affordance rendering', () => {
  const { initInstallAffordance } = require('../js/installAffordance.js');
  const { __resetInstallPromptForTests } = require('../js/installPrompt.js');

  function dom() {
    document.body.innerHTML = `
      <button id="install-fab" class="install-fab hidden"></button>
      <div id="install-toast" class="install-toast hidden">
        <span id="install-toast-text"></span>
        <button id="install-toast-action" class="hidden"></button>
        <button id="install-toast-dismiss"></button>
      </div>`;
  }
  function setInstallPromptSupport(on) {
    if (on) window.onbeforeinstallprompt = null; else delete window.onbeforeinstallprompt;
  }
  beforeEach(() => {
    const { isFirstRunActive } = require('../js/firstRun.js');
    isFirstRunActive.mockReturnValue(false);
    require('../js/telegramOnramp.js').isOnrampPromoActive.mockReturnValue(false);
    __resetInstallPromptForTests();
    dom();
    setStandalone(false);
    delete window.onbeforeinstallprompt;
  });

  // Finding: the "Use in Telegram" onramp promo and this install/notify nudge
  // could show at once (cluttered). The install affordance defers to the promo —
  // it offers the same notifications via the bot, so one teaching surface wins.
  test('defers entirely while the onramp promo is active; resumes on onramp-change', () => {
    setUA('Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko Firefox/125.0');
    const onramp = require('../js/telegramOnramp.js');
    onramp.isOnrampPromoActive.mockReturnValue(true);
    initInstallAffordance();
    const fab = document.getElementById('install-fab');
    const toast = document.getElementById('install-toast');
    expect(toast.classList.contains('hidden')).toBe(true);
    expect(fab.classList.contains('hidden')).toBe(true);
    // Promo dismissed/linked → onramp-change fires → the affordance resumes.
    onramp.isOnrampPromoActive.mockReturnValue(false);
    document.dispatchEvent(new CustomEvent('onramp-change'));
    expect(toast.classList.contains('hidden')).toBe(false);
  });

  test('Firefox desktop: toast shows first (fab hidden); dismiss reveals fab; fab reopens toast', () => {
    setUA('Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko Firefox/125.0');
    initInstallAffordance();
    const fab = document.getElementById('install-fab');
    const toast = document.getElementById('install-toast');
    // toast leads, fab hidden
    expect(toast.classList.contains('hidden')).toBe(false);
    expect(fab.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('install-toast-text').textContent).toContain('Chrome or Edge');
    expect(document.getElementById('install-toast-action').classList.contains('hidden')).toBe(true);
    // dismiss → fab appears, toast hidden
    document.getElementById('install-toast-dismiss').click();
    expect(toast.classList.contains('hidden')).toBe(true);
    expect(fab.classList.contains('hidden')).toBe(false);
    // fab click → toast returns, fab hidden again
    fab.click();
    expect(toast.classList.contains('hidden')).toBe(false);
    expect(fab.classList.contains('hidden')).toBe(true);
  });

  test('ready lane (standalone) hides both toast and fab', () => {
    setUA('Mozilla/5.0 (X11; Linux x86_64) Chrome/120 Safari/537.36');
    setStandalone(true);
    initInstallAffordance();
    expect(document.getElementById('install-fab').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('install-toast').classList.contains('hidden')).toBe(true);
  });

  test('installable lane: toast shows first with a working Install button (fab hidden)', async () => {
    setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36');
    // Fire a beforeinstallprompt so the install prompt is available → lane 'installable'.
    const evt = new Event('beforeinstallprompt');
    evt.preventDefault = jest.fn();
    evt.prompt = jest.fn();
    evt.userChoice = Promise.resolve({ outcome: 'accepted' });
    initInstallAffordance();        // registers the beforeinstallprompt listener
    window.dispatchEvent(evt);      // now available; onInstallPromptChange → apply()

    const fab = document.getElementById('install-fab');
    const action = document.getElementById('install-toast-action');
    const toast = document.getElementById('install-toast');
    // toast leads, with the Install button; fab hidden
    expect(toast.classList.contains('hidden')).toBe(false);
    expect(fab.classList.contains('hidden')).toBe(true);
    expect(action.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('install-toast-text').textContent).toContain('install KnockKnock');

    action.click();
    await Promise.resolve(); await Promise.resolve();
    expect(evt.prompt).toHaveBeenCalledTimes(1);
    expect(toast.classList.contains('hidden')).toBe(true);
  });

  test('installable lane: from page load with no captured event, manual step is inline (no button)', () => {
    setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36');
    setInstallPromptSupport(true);   // Chromium exposes onbeforeinstallprompt
    initInstallAffordance();         // no beforeinstallprompt dispatched
    const toast = document.getElementById('install-toast');
    const action = document.getElementById('install-toast-action');
    const textEl = document.getElementById('install-toast-text');
    // toast leads from page load; no button (the native dialog can't be opened),
    // and the manual step is appended inline — no extra click, no duplicate lead.
    expect(toast.classList.contains('hidden')).toBe(false);
    expect(action.classList.contains('hidden')).toBe(true);
    expect(textEl.textContent).toContain('install KnockKnock'); // upsell lead, once
    expect(textEl.innerHTML).toContain('address bar');          // manual step inline
  });

  test('iOS install lane: lands with the corner icon; tapping it shows the Add-to-Home-Screen toast (no button)', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1');
    initInstallAffordance();
    const fab = document.getElementById('install-fab');
    const toast = document.getElementById('install-toast');
    // The onboarding modal already showed the content → land with the corner icon.
    expect(fab.classList.contains('hidden')).toBe(false);
    expect(toast.classList.contains('hidden')).toBe(true);
    fab.click();
    expect(toast.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('install-toast-text').innerHTML).toMatch(/Add to Home Screen/i);
    expect(document.getElementById('install-toast-action').classList.contains('hidden')).toBe(true);
  });

  test('first-run suppresses the whole install affordance: toast AND corner icon hidden', () => {
    const { isFirstRunActive } = require('../js/firstRun.js');
    isFirstRunActive.mockReturnValue(true);
    setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36');
    // Fire a beforeinstallprompt so the install prompt is available → lane 'installable'.
    const evt = new Event('beforeinstallprompt');
    evt.preventDefault = jest.fn();
    evt.prompt = jest.fn();
    evt.userChoice = Promise.resolve({ outcome: 'accepted' });
    initInstallAffordance();        // registers the beforeinstallprompt listener
    window.dispatchEvent(evt);      // now available; onInstallPromptChange → apply()
    // Guided empty state is the single teaching surface (spec §3). The corner icon
    // is suppressed too — on its own it is a no-op tease, since its toast can't open
    // while first-run holds.
    expect(document.getElementById('install-toast').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('install-fab').classList.contains('hidden')).toBe(true);
  });

  test('first-run: clicking the (suppressed) corner icon does not force the toast open', () => {
    const { isFirstRunActive } = require('../js/firstRun.js');
    isFirstRunActive.mockReturnValue(true);
    setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36');
    const evt = new Event('beforeinstallprompt');
    evt.preventDefault = jest.fn();
    evt.prompt = jest.fn();
    evt.userChoice = Promise.resolve({ outcome: 'accepted' });
    initInstallAffordance();
    window.dispatchEvent(evt);
    document.getElementById('install-fab').click(); // clears `dismissed`, re-applies
    expect(document.getElementById('install-toast').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('install-fab').classList.contains('hidden')).toBe(true);
  });

  test('first-run-change re-applies: toast resumes when the empty state clears', () => {
    const { isFirstRunActive } = require('../js/firstRun.js');
    isFirstRunActive.mockReturnValue(true);
    setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36');
    // Fire a beforeinstallprompt so the install prompt is available → lane 'installable'.
    const evt = new Event('beforeinstallprompt');
    evt.preventDefault = jest.fn();
    evt.prompt = jest.fn();
    evt.userChoice = Promise.resolve({ outcome: 'accepted' });
    initInstallAffordance();        // registers the beforeinstallprompt listener
    window.dispatchEvent(evt);      // now available; onInstallPromptChange → apply()
    isFirstRunActive.mockReturnValue(false);
    document.dispatchEvent(new CustomEvent('first-run-change'));
    expect(document.getElementById('install-toast').classList.contains('hidden')).toBe(false);
  });

  describe('bot-delivered suppression (linked account, telegram channel)', () => {
    const { syncBotDelivery, __resetBotDeliveryForTests } = require('../js/notifySuppression.js');
    const LINKED_TG = { telegram: { linkedAt: 1 }, notifyChannel: 'telegram' };
    const LINKED_PUSH = { telegram: { linkedAt: 1 }, notifyChannel: 'push' };
    const toast = () => document.getElementById('install-toast');
    const fab = () => document.getElementById('install-fab');

    beforeEach(() => {
      __resetBotDeliveryForTests();
      setUA('Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko Firefox/125.0'); // push-in-tab lane
    });
    afterAll(() => __resetBotDeliveryForTests());

    test('suppressed at init: toast AND fab hidden in an otherwise-showing lane', () => {
      syncBotDelivery(LINKED_TG);
      initInstallAffordance();
      expect(toast().classList.contains('hidden')).toBe(true);
      expect(fab().classList.contains('hidden')).toBe(true);
    });

    test('suppression arriving after init hides a visible toast (prefs tick landed late)', () => {
      initInstallAffordance();
      expect(toast().classList.contains('hidden')).toBe(false);
      syncBotDelivery(LINKED_TG); // bot-delivery-change → apply()
      expect(toast().classList.contains('hidden')).toBe(true);
      expect(fab().classList.contains('hidden')).toBe(true);
    });

    test('suppression lifting (switch to push) revives the affordance without re-init', () => {
      syncBotDelivery(LINKED_TG);
      initInstallAffordance();
      expect(toast().classList.contains('hidden')).toBe(true);
      syncBotDelivery(LINKED_PUSH);
      expect(toast().classList.contains('hidden')).toBe(false);
      expect(fab().classList.contains('hidden')).toBe(true); // toast leads, as usual
    });
  });
});
