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

  test('Firefox desktop shows the fab; toast shows install-elsewhere copy, no button', () => {
    setUA('Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko Firefox/125.0');
    initInstallAffordance();
    const fab = document.getElementById('install-fab');
    expect(fab.classList.contains('hidden')).toBe(false);
    fab.click();
    expect(document.getElementById('install-toast').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('install-toast-text').textContent).toContain('Chrome or Edge');
    expect(document.getElementById('install-toast-action').classList.contains('hidden')).toBe(true);
  });

  test('ready lane (standalone) hides the fab', () => {
    setUA('Mozilla/5.0 (X11; Linux x86_64) Chrome/120 Safari/537.36');
    setStandalone(true);
    initInstallAffordance();
    expect(document.getElementById('install-fab').classList.contains('hidden')).toBe(true);
  });
});
