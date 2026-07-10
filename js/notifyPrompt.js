// js/notifyPrompt.js
import { NOTIFICATIONS_ENABLED } from './features.js';
import { markHintSeen, addPushToken, removePushToken, getRegisteredPushToken, hasAnyNotifyPrefEnabled, touchPushToken, cullStalePushTokens } from './prefs.js';
import { detectNotifyCapability, guidanceCopyFor } from './installGuidance.js';
import { isTelegramContext } from './telegram.js';
import { isBotDelivered, setRepromptActive } from './notifySuppression.js';
import { escapeHatchHtml, wireEscapeHatch } from './telegramEscapeHatch.js';
import { phraseReminderHtml, wirePhraseCopyButton } from './phraseReminder.js';
import { getMessagingIfSupported } from './firebase-config.js';
import { getToken } from 'firebase/messaging';

const PROMO_HINT = 'notifyPromo';

// Device-local (NOT synced) dismissal for the "you have notify prefs but this
// device can't deliver" reprompt. Kept out of userPrefs so dismissing on one
// device doesn't suppress the reprompt on another that genuinely needs it.
const REPROMPT_DISMISS_KEY = 'statusapp_notify_reprompt_dismissed';
function isRepromptDismissedOnDevice() {
  try { return localStorage.getItem(REPROMPT_DISMISS_KEY) === '1'; } catch { return false; }
}
function dismissRepromptOnDevice() {
  try { localStorage.setItem(REPROMPT_DISMISS_KEY, '1'); } catch { /* quota */ }
}

// Pure: decide whether to RE-prompt because the user has enabled notify prefs
// (synced from another device) but this device has no OS permission/token, so
// the "on" bells silently deliver nothing. Deliberately ignores hintSeen and
// engagement: a concrete unmet intent overrides the passive promo's gating (the
// synced "dismissed forever" from the old device must not suppress this). Held
// back only by a device-local dismissal and the absence of an actionable path.
export function shouldReprompt({ enabled, hasEnabledPrefs, permission, capState, deviceDismissed }) {
  if (!enabled) return false;
  if (permission === 'granted') return false;
  if (deviceDismissed) return false;
  if (!hasEnabledPrefs) return false;
  if (capState === 'denied') return false;
  if (capState === 'unsupported') return false;
  return true; // 'supported' | 'needs-install-ios' | 'in-app-browser'
}

const VAPID_KEY = process.env.FIREBASE_VAPID_KEY;

// Requests OS permission, obtains an FCM token against the existing SW, registers it.
// Returns true on success.
export async function requestPermissionAndRegister() {
  if (typeof Notification === 'undefined') return false;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;
  const messaging = await getMessagingIfSupported();
  if (!messaging) return false;
  const registration = await navigator.serviceWorker.ready;
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) return false;
  addPushToken(token);
  return true;
}

function dismissPromoForever() { markHintSeen(PROMO_HINT); }

// Self-heal the server-side FCM token on app load. Permission/token state drifts
// (especially on iOS), and the client otherwise only registers a token on
// toggle-on — leaving the server with a stale/absent token and no recovery short
// of a reinstall. When permission is already granted, fetch the device's current
// token and reconcile: drop a rotated old token, then (re-)register the current
// one (idempotent — also heals a token the server pruned while still valid).
export async function refreshPushToken() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const messaging = await getMessagingIfSupported();
  if (!messaging) return;
  const registration = await navigator.serviceWorker.ready;
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) return;
  const prev = getRegisteredPushToken();
  if (prev === token) {
    touchPushToken(token);            // unchanged → just bump lastSeen
  } else {
    if (prev) removePushToken(prev);  // rotated → drop the old token
    addPushToken(token);              // (re)register the current one
  }
  // Prune long-dead sibling tokens (orphaned installs). The active token was
  // just touched/added, so it's never culled. See #157.
  cullStalePushTokens().catch(() => {});
}

// Permission was granted but token registration didn't complete (getMessaging/
// getToken returned nothing) — capability detection still reads 'supported', so
// re-rendering the plain promo would just show the same Enable button. Give an
// explicit "it didn't work" message while keeping Enable as a retry.
function showRegistrationFailed(banner) {
  const textEl = banner.querySelector('#notify-promo-text');
  const actionEl = banner.querySelector('#notify-promo-action');
  if (textEl) {
    textEl.innerHTML = "Couldn't turn on notifications on this device — it may not fully support web push. You can try again."
      + escapeHatchHtml();
    wireEscapeHatch(textEl);
  }
  if (actionEl) actionEl.classList.remove('hidden');
  banner.classList.remove('hidden');
}

// Explicitly show the promo banner for a capability state, bypassing the
// engagement/dismissal gating used by the passive promo — the user just asked
// for notifications, so we always show how to get them.
function showBannerForState(capState) {
  const banner = document.getElementById('notify-promo');
  if (!banner) return;
  renderBanner(banner, capState);
  banner.classList.remove('hidden');
}

// Called when a user turns a per-person bell on. Always gives feedback: prompts
// when push is available, otherwise (or on denial) surfaces the right guidance.
export async function ensureNotificationsReady() {
  // In Telegram, notifications are delivered by the bot (notifyChannel:'telegram').
  // There's no web-push permission to grant, so skip the capability/banner flow
  // entirely — otherwise it surfaces web-push framing ("this browser doesn't
  // support web notifications"), the wrong lens inside the Mini App. (Spec §9.)
  if (isTelegramContext()) return;
  // Bot-delivered on web (linked account, telegram channel): bells just write
  // prefs — the notifier routes them to the bot (functions/notifier.js), so
  // there is no web-push permission to demand (spec 2026-07-07-web-nudge-suppression).
  if (isBotDelivered()) return;
  const cap = detectNotifyCapability();
  if (cap.state === 'supported') {
    const ok = await requestPermissionAndRegister();
    if (!ok) {
      // Same distinction as the Enable button's own retry handler: if capability
      // still reads 'supported' the permission prompt succeeded but token
      // registration didn't — that's the registration-failed dead end (with its
      // escape hatch), not a plain re-render of the Enable banner.
      const state = detectNotifyCapability().state;
      const banner = document.getElementById('notify-promo');
      if (state === 'supported') { if (banner) showRegistrationFailed(banner); }
      else showBannerForState(state);
    }
    // On success, re-evaluate the banner now: the switch-to-push flow revives
    // the reprompt an instant before this runs, and waiting for the token
    // write's notify-prefs-synced echo would leave a stale "Enable" showing.
    else maybeRepromptForMissingPermission();
    return;
  }
  showBannerForState(cap.state);
}

let _userId = null;
let _repromptListenerWired = false;
export function initNotifyPrompt(userId) {
  _userId = userId;
  // Re-evaluate once the synced notify prefs land — that's when we can tell a
  // restored device has "on" bells it can't yet deliver (no permission/token).
  if (!_repromptListenerWired && typeof document !== 'undefined') {
    document.addEventListener('notify-prefs-synced', maybeRepromptForMissingPermission);
    document.addEventListener('bot-delivery-change', maybeRepromptForMissingPermission);
    _repromptListenerWired = true;
  }
  refreshPromoVisibility();
}

// Public entry: re-check whether the promo should surface (called on the
// notify-prefs-synced event, after a restore hydrates the bells).
export function maybeRepromptForMissingPermission() { refreshPromoVisibility(); }

// Single source of truth for the banner's visibility. Notifications are
// bell-gated: the banner surfaces ONLY for the reprompt — the user enabled notify
// bells (possibly on another device) but this device has no permission/token.
// There is no passive 2nd-session promo. Close is a device-local dismissal.
function refreshPromoVisibility() {
  const banner = document.getElementById('notify-promo');
  if (!banner) return;
  // Never surface the web-push promo/reprompt in Telegram — the bot is the
  // notification channel there (spec §9); web-push framing would only mislead.
  if (isTelegramContext()) { setRepromptActive(false); banner.classList.add('hidden'); return; }
  // Bot-delivered: the reprompt's premise ("your on-bells deliver nothing on
  // this device") is false — the bot delivers them. Re-evaluated on
  // bot-delivery-change, so switching to push revives the reprompt live.
  if (isBotDelivered()) { setRepromptActive(false); banner.classList.add('hidden'); return; }
  const cap = detectNotifyCapability();
  const permission = (typeof Notification !== 'undefined' && Notification.permission) || 'default';
  const reprompt = shouldReprompt({
    enabled: NOTIFICATIONS_ENABLED, hasEnabledPrefs: hasAnyNotifyPrefEnabled(),
    permission, capState: cap.state, deviceDismissed: isRepromptDismissedOnDevice(),
  });
  // The onramp promo defers while the reprompt is up (concrete unmet intent
  // beats a passive promo) — notifySuppression carries the flag.
  setRepromptActive(reprompt);
  if (!reprompt) { banner.classList.add('hidden'); return; }
  renderBanner(banner, cap.state, () => {
    dismissRepromptOnDevice(); setRepromptActive(false); banner.classList.add('hidden');
  });
  banner.classList.remove('hidden');
}

// The phrase-reminder block + clipboard wiring live in ./phraseReminder.js (no
// Firebase deps, so the install toast can import them too). Re-exported here for
// existing consumers of this module.
export { phraseReminderHtml, wirePhraseCopyButton };

function renderBanner(banner, capState, onDismiss) {
  const textEl = banner.querySelector('#notify-promo-text');
  const actionEl = banner.querySelector('#notify-promo-action');
  if (capState === 'supported') {
    textEl.textContent = 'Get notified about knocks, calls, and people coming online.';
    actionEl.textContent = 'Enable';
    actionEl.classList.remove('hidden');
    actionEl.onclick = async () => {
      const ok = await requestPermissionAndRegister();
      if (ok) { banner.classList.add('hidden'); return; }
      // Failure feedback — previously a silent no-op. A denied prompt flips
      // capability to 'denied' → show the re-enable guidance. If it's still
      // 'supported', permission was granted but token registration failed
      // (e.g. the browser can't complete web-push setup) — say so rather than
      // leaving the user staring at an Enable button that appeared to do nothing.
      const state = detectNotifyCapability().state;
      if (state === 'supported') showRegistrationFailed(banner);
      else showBannerForState(state);
    };
  } else {
    const copy = guidanceCopyFor(capState);
    let html = copy.body;
    if (copy.remindPhrase) html += phraseReminderHtml();
    html += escapeHatchHtml();   // '' when unavailable — dead-end lanes offer Telegram
    textEl.innerHTML = html;
    wirePhraseCopyButton(textEl);
    wireEscapeHatch(textEl);
    actionEl.classList.add('hidden');
  }
  banner.querySelector('#notify-promo-dismiss').onclick = onDismiss
    || (() => { dismissPromoForever(); banner.classList.add('hidden'); });
}
