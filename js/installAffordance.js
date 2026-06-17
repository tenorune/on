// js/installAffordance.js
// Install affordance: a toast (centered in the app column) plus a small bottom-
// left corner icon. The toast shows FIRST on landing; dismissing it hides the
// toast and reveals the corner icon, which re-opens the toast. The toast and the
// corner icon are never shown at the same time.
// - installable (Chromium): toast has a real Install button (beforeinstallprompt).
// - push-in-tab (Firefox desktop): toast explains installing via another browser.
import { onboardingLane } from './installGuidance.js';
import {
  initInstallPrompt, isInstallPromptAvailable, isAppInstalled,
  promptInstall, onInstallPromptChange,
} from './installPrompt.js';

function isMac() { return /Macintosh|Mac OS X/.test((navigator.userAgent) || ''); }

export function pushInTabCopy() {
  const browsers = isMac() ? 'Safari, Chrome, or Edge' : 'Chrome or Edge';
  return `To get notified about knocks, calls, and people coming online even when your browser is closed, open the app in ${browsers} and install it.`;
}

function currentLane() {
  return onboardingLane({ installPromptAvailable: isInstallPromptAvailable() });
}

function fillToast(toast, lane) {
  const textEl = toast.querySelector('#install-toast-text');
  const actionEl = toast.querySelector('#install-toast-action');
  if (lane === 'installable') {
    textEl.textContent = 'To get notified about knocks, calls, and people coming online — even when this browser is closed — install KnockKnock.';
    actionEl.classList.remove('hidden');
  } else { // push-in-tab — no in-app install possible, so no button
    textEl.textContent = pushInTabCopy();
    actionEl.classList.add('hidden');
  }
}

export function initInstallAffordance() {
  initInstallPrompt();
  const fab = document.getElementById('install-fab');
  const toast = document.getElementById('install-toast');
  if (!fab || !toast) return;
  const actionEl = toast.querySelector('#install-toast-action');
  const dismissEl = toast.querySelector('#install-toast-dismiss');

  // The toast leads; once dismissed, the corner icon takes over. Never both.
  let dismissed = false;

  const apply = () => {
    const lane = currentLane();
    const relevant = !isAppInstalled() && (lane === 'installable' || lane === 'push-in-tab');
    if (!relevant) { toast.classList.add('hidden'); fab.classList.add('hidden'); return; }
    if (dismissed) {
      toast.classList.add('hidden');
      fab.classList.remove('hidden');
    } else {
      fillToast(toast, lane);
      toast.classList.remove('hidden');
      fab.classList.add('hidden');
    }
  };

  // initInstallAffordance is called once at boot. We intentionally do not guard
  // against repeated init: this binds to DOM nodes that may be replaced (e.g. in
  // tests), so a guard would skip re-wiring a fresh DOM rather than prevent a leak.
  fab.addEventListener('click', () => { dismissed = false; apply(); });
  dismissEl.addEventListener('click', () => { dismissed = true; apply(); });
  if (actionEl) actionEl.addEventListener('click', async () => { await promptInstall(); apply(); });
  onInstallPromptChange(apply);
  apply();
}
