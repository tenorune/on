// js/installAffordance.js
// Install affordance: a toast (centered in the app column) plus a small bottom-
// left corner icon. The toast and the corner icon are never shown at once.
// - installable (Chromium): toast leads, shown from page load (capability-
//   detected). With a captured beforeinstallprompt it carries a one-tap Install
//   button; without one, it appends the manual install step inline (no button).
// - push-in-tab (Firefox desktop): toast leads, explains installing via another browser.
// - ios-install / macos-install: the user has just tapped "Maybe later" on the
//   install step of the core new-user flow, so we don't re-pop the same content —
//   we land with the corner icon (toast on tap) as an ongoing reminder.
import { onboardingLane, installStepBodyHtml, installPromptStepHtml } from './installGuidance.js';
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
    const lead = 'To get notified about knocks, calls, and people coming online — even when this browser is closed — install KnockKnock.';
    if (isInstallPromptAvailable()) {
      textEl.textContent = lead;            // one-tap native dialog via the button
      actionEl.classList.remove('hidden');
    } else {
      // No beforeinstallprompt captured: the native dialog can't be opened, so
      // append the manual step inline. No button — it would only reveal these
      // same steps on click.
      textEl.innerHTML = lead + installPromptStepHtml();
      actionEl.classList.add('hidden');
    }
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

  // The toast leads; once dismissed, the corner icon takes over. Never both.
  // iOS/macOS land already-dismissed: the user has just said "Maybe later" on the
  // install step of the new-user flow, so re-popping the same content would nag.
  // installable/push-in-tab have had no prior install prompt → the toast leads.
  const initialLane = currentLane();
  let dismissed = (initialLane === 'ios-install' || initialLane === 'macos-install');

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
  // The Install button only renders when a beforeinstallprompt is captured (see
  // fillToast), so its click always has a live prompt to fire.
  if (actionEl) actionEl.addEventListener('click', async () => { await promptInstall(); apply(); });
  onInstallPromptChange(apply);
  apply();
}
