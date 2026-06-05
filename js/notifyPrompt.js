// js/notifyPrompt.js
import { NOTIFICATIONS_ENABLED } from './features.js';
import { isHintSeen, markHintSeen, addPushToken } from './prefs.js';
import { detectNotifyCapability, guidanceCopyFor } from './installGuidance.js';
import { getMessagingIfSupported } from './firebase-config.js';

const PROMO_HINT = 'notifyPromo';

// Pure: decide whether the promo banner should be shown.
export function shouldShowPromo({ enabled, hintSeen, engaged, capState, permission }) {
  if (!enabled) return false;
  if (hintSeen) return false;
  if (!engaged) return false;
  if (permission === 'granted') return false;
  if (capState === 'denied') return false;
  if (capState === 'unsupported') return false;
  return true; // 'supported' | 'needs-install-ios' | 'ios-use-safari'
}
