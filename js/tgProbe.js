// js/tgProbe.js — TEMPORARY on-device diagnostic. REMOVE after the readout.
//
// Question under test: chrome color (setHeaderColor/setBackgroundColor) tracks
// --bg on iOS Telegram but not on macOS Telegram. setHeaderColor only accepts an
// arbitrary hex color from Bot API 6.9+ (older clients accept only the named keys
// bg_color/secondary_bg_color), so a version gap is the leading suspect. macOS
// Telegram has no readily-accessible DevTools console, so the readout goes to the
// in-app toast where it can be read on-device; console.info mirrors it for the
// preview. Read the toast on macOS AND iOS and compare platform + Bot API version.
import { tgWebApp } from './telegram.js';
import { showToast } from './groups.js';

export function showTelegramProbe() {
  const wa = tgWebApp();
  if (!wa) return;
  const info = `Telegram: ${wa.platform || '?'} · Bot API ${wa.version || '?'}`;
  try { console.info('[kk-probe]', info); } catch { /* ignore */ }
  showToast(info);
}
