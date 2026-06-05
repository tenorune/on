// js/installGuidance.js
// Platform/capability detection + Add-to-Home-Screen guidance.
// NOT gated by NOTIFICATIONS_ENABLED — installing is valuable on its own.

export function isStandalone() {
  if (typeof navigator !== 'undefined' && navigator.standalone === true) return true;
  try { return window.matchMedia('(display-mode: standalone)').matches; }
  catch { return false; }
}

export function isPushApiAvailable() {
  return typeof window !== 'undefined'
    && 'PushManager' in window
    && 'Notification' in window
    && typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator;
}

function ua() { return (typeof navigator !== 'undefined' && navigator.userAgent) || ''; }
function isIos() { return /iPhone|iPad|iPod/.test(ua()) || (/Macintosh/.test(ua()) && 'ontouchend' in (typeof document !== 'undefined' ? document : {})); }
function isIosThirdParty() { return isIos() && /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua()); }

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
