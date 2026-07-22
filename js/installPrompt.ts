// js/installPrompt.ts
// Captures the Chromium `beforeinstallprompt` event so the app can drive a real
// in-app Install button. Safari/Firefox never fire it (handled by other lanes).

/** The non-standard Chromium beforeinstallprompt event (not in lib.dom). */
type BeforeInstallPromptEvent = Event & { prompt: () => void; userChoice: Promise<{ outcome: string }> };

let _deferred: BeforeInstallPromptEvent | null = null;
let _installed = false;
const _listeners = new Set<() => void>();
let _initialized = false;
let _beforeInstallPromptHandler: ((e: Event) => void) | null = null;
let _appInstalledHandler: (() => void) | null = null;

function notify() { for (const fn of _listeners) { try { fn(); } catch { /* ignore */ } } }

function initInstallPrompt() {
  if (_initialized || typeof window === 'undefined') return;
  _initialized = true;
  _beforeInstallPromptHandler = (e) => {
    e.preventDefault();   // suppress the browser's mini-infobar
    _deferred = e as BeforeInstallPromptEvent; // stash for our own button
    notify();
  };
  _appInstalledHandler = () => {
    _installed = true;
    _deferred = null;
    notify();
  };
  window.addEventListener('beforeinstallprompt', _beforeInstallPromptHandler);
  window.addEventListener('appinstalled', _appInstalledHandler);
}

function isInstallPromptAvailable() { return _deferred != null; }
function isAppInstalled() { return _installed; }

// Fires the native install dialog. Single-use: the stashed event is consumed.
async function promptInstall() {
  if (!_deferred) return null;
  const evt = _deferred;
  _deferred = null;
  notify();
  evt.prompt();
  try { const { outcome } = await evt.userChoice; return outcome; }
  catch { return null; }
}

function onInstallPromptChange(fn: () => void) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

// Test-only: reset module state between tests.
function __resetInstallPromptForTests() {
  if (typeof window !== 'undefined') {
    if (_beforeInstallPromptHandler) {
      window.removeEventListener('beforeinstallprompt', _beforeInstallPromptHandler);
    }
    if (_appInstalledHandler) {
      window.removeEventListener('appinstalled', _appInstalledHandler);
    }
  }
  _deferred = null;
  _installed = false;
  _listeners.clear();
  _initialized = false;
  _beforeInstallPromptHandler = null;
  _appInstalledHandler = null;
}

export {
  initInstallPrompt,
  isInstallPromptAvailable,
  isAppInstalled,
  promptInstall,
  onInstallPromptChange,
  __resetInstallPromptForTests,
};
