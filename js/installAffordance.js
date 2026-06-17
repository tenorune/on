// js/installAffordance.js
// Install affordance: a small bottom-left corner icon plus a toast (centered in
// the app column). The icon and the toast are never shown at once. Every lane
// leads with the corner icon as the persistent, low-key affordance; tapping it
// surfaces the toast with the details:
// - installable (Chromium): toast has a real Install button (beforeinstallprompt).
// - push-in-tab (Firefox desktop): toast explains installing via another browser.
// - ios-install / macos-install: toast repeats the Add-to-Home-Screen / Add-to-Dock
//   steps from onboarding, plus the save-your-phrase reminder.
import { onboardingLane, installStepBodyHtml } from './installGuidance.js';
import { phraseReminderHtml, wirePhraseCopyButton } from './phraseReminder.js';
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
  } else if (lane === 'ios-install' || lane === 'macos-install') {
    // Same Add-to-Home-Screen / Add-to-Dock content as the onboarding install
    // modal, plus the save-your-phrase reminder (the toast is shown to a signed-in
    // user, so Copy works here). No button — install is manual via the Share/File menu.
    textEl.innerHTML = installStepBodyHtml(lane) + phraseReminderHtml();
    wirePhraseCopyButton(textEl);
    actionEl.classList.add('hidden');
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

  // Every lane leads with the corner icon as the persistent, low-key install
  // affordance; tapping it surfaces the toast (and, for the installable lane, the
  // Install button). The icon and toast are never shown together. Consistent
  // across platforms — no toast-leads-for-some, icon-leads-for-others.
  let dismissed = true;

  const apply = () => {
    const lane = currentLane();
    const relevant = !isAppInstalled()
      && (lane === 'installable' || lane === 'push-in-tab' || lane === 'ios-install' || lane === 'macos-install');
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
