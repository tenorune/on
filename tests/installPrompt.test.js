const {
  initInstallPrompt, isInstallPromptAvailable, isAppInstalled,
  promptInstall, onInstallPromptChange, __resetInstallPromptForTests,
} = require('../js/installPrompt.js');

function fireBeforeInstallPrompt() {
  const evt = new Event('beforeinstallprompt');
  evt.preventDefault = jest.fn();
  evt.prompt = jest.fn();
  evt.userChoice = Promise.resolve({ outcome: 'accepted' });
  window.dispatchEvent(evt);
  return evt;
}

describe('installPrompt', () => {
  beforeEach(() => { __resetInstallPromptForTests(); initInstallPrompt(); });

  test('not available until the event fires', () => {
    expect(isInstallPromptAvailable()).toBe(false);
  });

  test('captures the event, prevents default, becomes available', () => {
    const evt = fireBeforeInstallPrompt();
    expect(evt.preventDefault).toHaveBeenCalled();
    expect(isInstallPromptAvailable()).toBe(true);
  });

  test('promptInstall fires the native prompt once, then is consumed', async () => {
    const evt = fireBeforeInstallPrompt();
    const outcome = await promptInstall();
    expect(evt.prompt).toHaveBeenCalledTimes(1);
    expect(outcome).toBe('accepted');
    expect(isInstallPromptAvailable()).toBe(false);
    expect(await promptInstall()).toBeNull(); // single-use
  });

  test('appinstalled clears availability and sets installed', () => {
    fireBeforeInstallPrompt();
    window.dispatchEvent(new Event('appinstalled'));
    expect(isAppInstalled()).toBe(true);
    expect(isInstallPromptAvailable()).toBe(false);
  });

  test('change listeners fire on capture and on consume', async () => {
    const cb = jest.fn();
    onInstallPromptChange(cb);
    fireBeforeInstallPrompt();
    expect(cb).toHaveBeenCalledTimes(1);
    await promptInstall();
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
