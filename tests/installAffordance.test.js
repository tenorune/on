function setUA(ua) { Object.defineProperty(global.navigator, 'userAgent', { value: ua, configurable: true }); }
function setStandalone(matches) { global.window.matchMedia = () => ({ matches }); }

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
  beforeEach(() => { __resetInstallPromptForTests(); dom(); setStandalone(false); delete window.onbeforeinstallprompt; });

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
});
