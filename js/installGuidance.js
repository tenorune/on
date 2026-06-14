// js/installGuidance.js
// Platform/capability detection + Add-to-Home-Screen guidance.
// NOT gated by NOTIFICATIONS_ENABLED — installing is valuable on its own.

function isStandalone() {
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
function isIos() { return /iPhone|iPad|iPod/.test(ua()) || (/Macintosh/.test(ua()) && 'ontouchend' in (typeof document !== 'undefined' ? document : {})); }
function isIosThirdParty() { return isIos() && /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua()); }
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

// Returns { state, supported } where state is one of:
// 'supported' | 'denied' | 'needs-install-ios' | 'needs-install-macos' | 'ios-use-safari' | 'unsupported'
export function detectNotifyCapability() {
  if (typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'denied') {
    return { state: 'denied', supported: false };
  }
  // In-browser macOS Safari HAS the Push API, but in practice it accepts a push
  // and silently never displays it (the installed Dock app does). Treat a normal
  // Safari tab on macOS like iOS-needs-install and point the user at Add to Dock;
  // the installed web app runs standalone, so it falls through to 'supported'.
  if (isMacSafari() && !isStandalone()) return { state: 'needs-install-macos', supported: false };
  if (isPushApiAvailable()) return { state: 'supported', supported: true };
  if (isIosThirdParty()) return { state: 'ios-use-safari', supported: false };
  if (isIos() && !isStandalone()) return { state: 'needs-install-ios', supported: false };
  return { state: 'unsupported', supported: false };
}

// Inline step icons rendered into the guidance copy (decorative — aria-hidden;
// they inherit the banner's text color via currentColor). The copy is rendered
// as HTML by notifyPrompt's renderBanner; it's all app-controlled, no user input.
const SHARE_ICON = '<svg class="step-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>';
const ADD_HOME_ICON = '<svg class="step-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';
const ADD_DOCK_ICON = '<svg class="step-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><rect x="9.5" y="13" width="5" height="3" rx="1" fill="currentColor" stroke="none"/></svg>';

const COPY = {
  'needs-install-ios': {
    title: 'Add to Home Screen',
    body: `On iPhone, notifications need the app on your Home Screen. Tap the Share button ${SHARE_ICON}, then "Add to Home Screen" ${ADD_HOME_ICON}.`,
    remindPhrase: true,
  },
  'ios-use-safari': {
    title: 'Open in Safari',
    body: `On iPhone, notifications only work from Safari. Open this app in Safari, then tap Share ${SHARE_ICON} → "Add to Home Screen" ${ADD_HOME_ICON}.`,
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
