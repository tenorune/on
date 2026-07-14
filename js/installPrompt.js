// @ts-check
// js/installPrompt.js
// Captures the Chromium `beforeinstallprompt` event so the app can drive a real
// in-app Install button. Safari/Firefox never fire it (handled by other lanes).
// CommonJS (module.exports) — required by tests; kept .js + JSDoc (not renamed to
// .ts, which would force an ESM rewrite the type-only conversion forbids).

/** The non-standard Chromium beforeinstallprompt event (not in lib.dom).
 * @typedef {Event & { prompt: () => void, userChoice: Promise<{ outcome: string }> }} BeforeInstallPromptEvent */

/** @type {BeforeInstallPromptEvent | null} */
let _deferred = null;
let _installed = false;
/** @type {Set<() => void>} */
const _listeners = new Set();
let _initialized = false;
/** @type {((e: Event) => void) | null} */
let _beforeInstallPromptHandler = null;
/** @type {(() => void) | null} */
let _appInstalledHandler = null;

function notify() { for (const fn of _listeners) { try { fn(); } catch { /* ignore */ } } }

function initInstallPrompt() {
  if (_initialized || typeof window === 'undefined') return;
  _initialized = true;
  _beforeInstallPromptHandler = (e) => {
    e.preventDefault();   // suppress the browser's mini-infobar
    _deferred = /** @type {BeforeInstallPromptEvent} */ (e); // stash for our own button
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

/** @param {() => void} fn */
function onInstallPromptChange(fn) {
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

module.exports = {
  initInstallPrompt,
  isInstallPromptAvailable,
  isAppInstalled,
  promptInstall,
  onInstallPromptChange,
  __resetInstallPromptForTests,
};
