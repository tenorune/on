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
// 'supported' | 'denied' | 'needs-install-ios' | 'ios-use-safari' | 'unsupported'
export function detectNotifyCapability() {
  if (typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'denied') {
    return { state: 'denied', supported: false };
  }
  if (isPushApiAvailable()) return { state: 'supported', supported: true };
  if (isIosThirdParty()) return { state: 'ios-use-safari', supported: false };
  if (isIos() && !isStandalone()) return { state: 'needs-install-ios', supported: false };
  return { state: 'unsupported', supported: false };
}

const COPY = {
  'needs-install-ios': {
    title: 'Add to Home Screen',
    body: 'On iPhone, notifications need the app on your Home Screen. Tap the Share button, then "Add to Home Screen."',
    remindPhrase: true,
  },
  'ios-use-safari': {
    title: 'Open in Safari',
    body: 'On iPhone, notifications only work from Safari. Open this app in Safari, then tap Share → "Add to Home Screen."',
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
