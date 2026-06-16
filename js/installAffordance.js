// js/installAffordance.js
// Bottom-left install affordance: a small corner icon that opens a toast.
// - installable (Chromium): toast has a real Install button (beforeinstallprompt).
// - push-in-tab (Firefox desktop): toast explains installing via another browser.
// Dismissing the toast hides only the toast; the corner icon stays. The icon
// shows only when install is relevant and the app isn't already installed.
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

function openToast(toast) {
  const lane = currentLane();
  const textEl = toast.querySelector('#install-toast-text');
  const actionEl = toast.querySelector('#install-toast-action');
  if (lane === 'installable') {
    textEl.textContent = 'To get notified about knocks, calls, and people coming online — even when this browser is closed — install KnockKnock.';
    actionEl.classList.remove('hidden');
    actionEl.onclick = async () => { await promptInstall(); toast.classList.add('hidden'); };
  } else { // push-in-tab
    textEl.textContent = pushInTabCopy();
    actionEl.classList.add('hidden');
  }
  toast.classList.remove('hidden');
}

export function initInstallAffordance() {
  initInstallPrompt();
  const fab = document.getElementById('install-fab');
  const toast = document.getElementById('install-toast');
  if (!fab || !toast) return;

  const render = () => {
    const lane = currentLane();
    const show = !isAppInstalled() && (lane === 'installable' || lane === 'push-in-tab');
    fab.classList.toggle('hidden', !show);
    if (!show) toast.classList.add('hidden');
  };

  fab.addEventListener('click', () => openToast(toast));
  toast.querySelector('#install-toast-dismiss').addEventListener('click', () => toast.classList.add('hidden'));
  onInstallPromptChange(render);
  render();
}
