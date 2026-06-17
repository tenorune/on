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
  beforeEach(() => { __resetInstallPromptForTests(); dom(); setStandalone(false); });

  test('Firefox desktop: lands with the corner icon; tapping it shows the toast; dismiss returns to the icon', () => {
    setUA('Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko Firefox/125.0');
    initInstallAffordance();
    const fab = document.getElementById('install-fab');
    const toast = document.getElementById('install-toast');
    // icon leads, toast hidden
    expect(fab.classList.contains('hidden')).toBe(false);
    expect(toast.classList.contains('hidden')).toBe(true);
    // fab click → toast shows the explanation (no button), fab hidden
    fab.click();
    expect(toast.classList.contains('hidden')).toBe(false);
    expect(fab.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('install-toast-text').textContent).toContain('Chrome or Edge');
    expect(document.getElementById('install-toast-action').classList.contains('hidden')).toBe(true);
    // dismiss → back to the corner icon
    document.getElementById('install-toast-dismiss').click();
    expect(toast.classList.contains('hidden')).toBe(true);
    expect(fab.classList.contains('hidden')).toBe(false);
  });

  test('ready lane (standalone) hides both toast and fab', () => {
    setUA('Mozilla/5.0 (X11; Linux x86_64) Chrome/120 Safari/537.36');
    setStandalone(true);
    initInstallAffordance();
    expect(document.getElementById('install-fab').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('install-toast').classList.contains('hidden')).toBe(true);
  });

  test('installable lane: lands with the corner icon; tapping it shows a working Install button', async () => {
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
    // icon leads, toast hidden
    expect(fab.classList.contains('hidden')).toBe(false);
    expect(toast.classList.contains('hidden')).toBe(true);
    // fab click → toast shows with the Install button
    fab.click();
    expect(toast.classList.contains('hidden')).toBe(false);
    expect(action.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('install-toast-text').textContent).toContain('install KnockKnock');

    action.click();
    await Promise.resolve(); await Promise.resolve();
    expect(evt.prompt).toHaveBeenCalledTimes(1);
    expect(toast.classList.contains('hidden')).toBe(true);
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
