// js/installGuidance.js
// Platform/capability detection + Add-to-Home-Screen guidance.
// NOT gated by NOTIFICATIONS_ENABLED — installing is valuable on its own.

export function isStandalone() {
  if (typeof navigator !== 'undefined' && navigator.standalone === true) return true;
  try { return window.matchMedia('(display-mode: standalone)').matches; }
  catch { return false; }
}

function isPushApiAvailable() {
  return typeof window !== 'undefined'
    && 'PushManager' in window
    && 'Notification' in window
    && typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator;
}

function ua() { return (typeof navigator !== 'undefined' && navigator.userAgent) || ''; }
function isIos() {
  const u = ua();
  if (/iPhone|iPad|iPod/.test(u)) return true;
  // iPadOS Safari reports as "Macintosh"; distinguish a real touch device (iPad,
  // maxTouchPoints > 0) from a desktop Mac browser. Desktop Chrome exposes
  // 'ontouchend' even without a touchscreen, which previously misrouted Chrome on
  // macOS into the iOS install lane — so key off maxTouchPoints (Macs report 0),
  // matching isMacSafari.
  const touchPoints = (typeof navigator !== 'undefined' && navigator.maxTouchPoints) || 0;
  return /Macintosh/.test(u) && touchPoints > 0;
}
// Embedded WebViews (in-app browsers inside Instagram, Facebook, Slack, etc.)
// lack the com.apple.developer.web-browser entitlement, so on iOS they can't
// "Add to Home Screen" / install a PWA (nor on Android). Route them to a real
// browser. Markers: common host apps + Android System WebView (; wv).
export function isInAppBrowser() {
  return /FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|Twitter|LinkedInApp|WhatsApp|musical_ly|Bytedance|TikTok|Pinterest|Telegram|MicroMessenger|; ?wv\)|GSA\//.test(ua());
}
// Desktop (macOS) Safari — its re-enable path lives in an obscure menu, unlike
// Chromium/Firefox which expose site permissions from the address bar. Excludes
// Chromium/Firefox (which also carry "Safari" in their UA) and iPadOS (touch).
function isMacSafari() {
  const u = ua();
  if (!/Macintosh/.test(u) || !/Safari/.test(u)) return false;
  if (/Chrome|Chromium|CriOS|FxiOS|Edg|EdgiOS|OPiOS|OPR|Firefox/.test(u)) return false;
  // iPadOS Safari also reports "Macintosh"; exclude it by its touch capability
  // (desktop Macs report 0). Using maxTouchPoints rather than 'ontouchend in
  // document' avoids a false positive under jsdom.
  const touchPoints = (typeof navigator !== 'undefined' && navigator.maxTouchPoints) || 0;
  return touchPoints === 0;
}

// Desktop Firefox: push works in-tab but there is no PWA install. Exclude
// mobile Firefox (Android) and Firefox-on-iOS (FxiOS), which behave differently.
export function isFirefoxDesktop() {
  const u = ua();
  return /Firefox/.test(u) && !/Mobile|Android|iPhone|iPad|iPod|FxiOS/.test(u);
}

// Chromium (Chrome/Edge/Opera/Samsung/Brave) exposes the `onbeforeinstallprompt`
// event handler property — present whether or not the event has fired yet. This
// is a capability signal: the browser CAN install via the native prompt, so we
// surface the Install affordance from page load rather than waiting on the
// browser's event timing. Safari/Firefox don't define it. (The captured event is
// still required to actually OPEN the dialog — see js/installPrompt.js.)
export function supportsInstallPrompt() {
  return typeof window !== 'undefined' && 'onbeforeinstallprompt' in window;
}

// Returns { state, supported } where state is one of:
// 'supported' | 'denied' | 'needs-install-ios' | 'needs-install-macos' | 'in-app-browser' | 'unsupported'
export function detectNotifyCapability() {
  if (typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'denied') {
    return { state: 'denied', supported: false };
  }
  // In-app/embedded browsers can't install (no Add to Home Screen), so push can
  // never work there — route the user to a real browser.
  if (isInAppBrowser()) return { state: 'in-app-browser', supported: false };
  // In-browser macOS Safari HAS the Push API, but in practice it accepts a push
  // and silently never displays it (the installed Dock app does). Treat a normal
  // Safari tab on macOS like iOS-needs-install and point the user at Add to Dock;
  // the installed web app runs standalone, so it falls through to 'supported'.
  if (isMacSafari() && !isStandalone()) return { state: 'needs-install-macos', supported: false };
  if (isPushApiAvailable()) return { state: 'supported', supported: true };
  // iOS Safari AND third-party browsers (Chrome/Firefox/Edge) in a tab: all can
  // Add to Home Screen, and the installed app gets push (iOS 16.4+), so all get
  // the same install guidance.
  if (isIos() && !isStandalone()) return { state: 'needs-install-ios', supported: false };
  return { state: 'unsupported', supported: false };
}

// Inline step icons rendered into the guidance copy (decorative — aria-hidden;
// they inherit the banner's text color via currentColor). The copy is rendered
// as HTML by notifyPrompt's renderBanner; it's all app-controlled, no user input.
export const SHARE_ICON = '<svg class="step-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>';
export const ADD_HOME_ICON = '<svg class="step-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';
export const ADD_DOCK_ICON = '<svg class="step-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><rect x="9.5" y="13" width="5" height="3" rx="1" fill="currentColor" stroke="none"/></svg>';
// Chromium's address-bar "install" glyph: a display with a downward arrow.
export const INSTALL_ICON = '<svg class="step-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><polyline points="9 9 12 12 15 9"/><line x1="12" y1="6" x2="12" y2="12"/></svg>';

const COPY = {
  'needs-install-ios': {
    title: 'Add to Home Screen',
    body: `On iPhone, notifications need the app on your Home Screen. Tap the Share button ${SHARE_ICON}, then "Add to Home Screen" ${ADD_HOME_ICON}.`,
    remindPhrase: true,
  },
  'in-app-browser': {
    title: 'Open in your browser',
    body: `This app’s built-in browser can’t install KnockKnock. Open this page in your browser — Safari, Chrome, or any other — then add it to your Home Screen ${ADD_HOME_ICON} to get notified.`,
    remindPhrase: true,
  },
  'needs-install-macos': {
    title: 'Add to Dock',
    body: `In Safari on a Mac, notifications need the app in your Dock. Choose File → Add to Dock ${ADD_DOCK_ICON}, then open the app from there.`,
    remindPhrase: true,
  },
  // 'denied' body is computed per-browser in guidanceCopyFor (the re-enable
  // steps differ): this static entry is the non-Safari/desktop fallback.
  'denied': {
    title: 'Notifications are blocked',
    body: 'Notifications are blocked for this site. Open your browser’s site settings — usually the lock or site-info icon in the address bar — allow Notifications, then reload.',
    remindPhrase: false,
  },
  'unsupported': {
    title: 'Notifications unavailable',
    body: 'This browser doesn’t support web notifications.',
    remindPhrase: false,
  },
};

export function guidanceCopyFor(state) {
  if (state === 'denied' && isMacSafari()) {
    return {
      title: 'Notifications are blocked',
      body: 'Notifications are blocked for this site. In Safari, choose Safari → Settings → Websites → Notifications, find this site and set it to Allow, then reload.',
      remindPhrase: false,
    };
  }
  return COPY[state] || COPY.unsupported;
}

// Shared install-step body for the iOS/macOS lanes — used by the onboarding
// install modal AND the persistent install toast, so they read identically. Leads
// with the notification value, then the platform Add-to-Home-Screen / Add-to-Dock
// steps with inline icons.
export function installStepBodyHtml(lane) {
  const lead = 'To get notified about knocks, calls, and people coming online, install the app:';
  if (lane === 'macos-install') {
    return lead + `<span class="install-step-instruction">Choose File → Add to Dock ${ADD_DOCK_ICON}, then open the app from there.</span>`;
  }
  return lead + `<span class="install-step-instruction">Tap the Share button ${SHARE_ICON}, then “Add to Home Screen” ${ADD_HOME_ICON}.</span>`;
}

// Manual install steps for the Chromium 'installable' lane, shown when the
// Install button is tapped but no beforeinstallprompt has been captured (so the
// native dialog can't be opened programmatically). Platform-aware: Android
// Chromium installs from the menu; desktop Chromium has the address-bar glyph.
export function installPromptInstructionsHtml() {
  const lead = 'To get notified about knocks, calls, and people coming online, install the app:';
  if (/Android/.test(ua())) {
    return lead + `<span class="install-step-instruction">Open the browser menu (⋮), then “Add to Home screen” ${ADD_HOME_ICON}.</span>`;
  }
  return lead + `<span class="install-step-instruction">Click the install icon ${INSTALL_ICON} in the address bar, or open the browser menu (⋮) and choose “Install KnockKnock”.</span>`;
}

// Onboarding lane selector — classifies the environment into the path the
// onboarding flow should take. `installPromptAvailable` is the (async) signal
// from js/installPrompt.js that a real beforeinstallprompt has been captured.
// Returns: 'ready' | 'in-app-browser' | 'ios-install' | 'macos-install'
//          | 'installable' | 'push-in-tab'
// NOTE: iOS Chrome/Firefox/Edge are NOT special-cased — since iOS 16.4 they can
// Add to Home Screen and the installed app receives web push like Safari, so they
// take the normal 'ios-install' path. Only true in-app/embedded browsers (which
// can't install at all) are redirected.
// The 'installable' lane is driven by CAPABILITY (supportsInstallPrompt), not by
// whether the event has fired yet — so Chromium shows the Install affordance from
// page load. If the event isn't captured at click time, the button falls back to
// manual instructions instead of a no-op (the native dialog can't be summoned).
export function onboardingLane({ installPromptAvailable = false } = {}) {
  if (isStandalone()) return 'ready';
  if (isInAppBrowser()) return 'in-app-browser';
  if (isMacSafari()) return 'macos-install';
  if (isIos()) return 'ios-install';
  if (installPromptAvailable || supportsInstallPrompt()) return 'installable';
  if (isFirefoxDesktop()) return 'push-in-tab';
  return 'ready';
}

// A standalone (installed) launch with no stored identity is almost certainly a
// just-installed user who must restore — our flow only prompts install AFTER
// account creation. Prime restore instead of showing the new/restore chooser, so
// they don't accidentally create a duplicate account.
export function shouldPrimeRestore({ standalone, hasIdentity }) {
  return !!standalone && !hasIdentity;
}
