// js/app.js
import { loadIdentity, saveIdentity, generateUserId, generateCode, clearIdentity } from './identity.js';
import { initUser, watchStatus, isExpired, writeBackExpired, userExists, touchLastSeen, setStatus } from './db.js';
import { initHeader, applyOwnStatus, enterFirstUseMode, setOwnStatusReadyCallback } from './me.js';
import { initList, setFolloweeReadyCallback } from './following.js';
import { initKnocks } from './knock.js';
import { initCodeDrawer } from './mycode.js';
import { PALETTES_ENABLED, KNOCK_ENABLED } from './features.js';
import { applyPaletteVars, applyThemeVars, getPaletteByKey, initSwatches } from './palettes.js';
import { getPaletteState, getFollowing } from './store.js';

// Apply stored palette theme before main() initialises Firebase so the splash
// renders in the user's chosen colours immediately.
(function applyStoredTheme() {
  try {
    const raw = localStorage.getItem('statusapp_palette_state');
    if (!raw) return;
    const state = JSON.parse(raw);
    const key = state?.activePaletteKey;
    if (!key) return;
    const palette = getPaletteByKey(key);
    if (palette) applyThemeVars(palette.theme);
  } catch {}
})();

let splashCounter = 0;
let splashDone = false;

function initSplash(followeeCount) {
  splashCounter = 1 + followeeCount;
  // Call dismissSplash directly (not signalReady) so the splash always
  // disappears after 3s regardless of how many followees haven't reported in.
  setTimeout(dismissSplash, 3000);
}

function signalReady() {
  if (splashDone) return;
  splashCounter--;
  if (splashCounter <= 0) {
    dismissSplash();
  }
}

function dismissSplash() {
  if (splashDone) return;
  splashDone = true;
  const el = document.getElementById('splash');
  if (!el) return;
  el.classList.add('fading');
  el.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'opacity') el.style.display = 'none';
  }, { once: true });
}

async function ensureIdentity() {
  const existing = loadIdentity();
  if (existing) {
    try {
      const valid = await userExists(existing.userId);
      if (!valid) {
        clearIdentity();
        return { identity: null, isNew: false };
      }
    } catch {
      // Network error (offline) — assume valid and proceed
    }
    return { identity: existing, isNew: false };
  }

  let userId, code, success;
  do {
    userId = generateUserId();
    code = generateCode();
    success = await initUser(userId, code);
  } while (!success);

  saveIdentity(userId, code);
  return { identity: { userId, code }, isNew: true };
}

function showStaleScreen() {
  return new Promise((resolve) => {
    document.getElementById('stale-screen').classList.remove('hidden');
    document.getElementById('stale-continue-btn').addEventListener('click', () => {
      document.getElementById('stale-screen').classList.add('hidden');
      resolve();
    }, { once: true });
  });
}

async function main() {
  let { identity, isNew } = await ensureIdentity();
  if (!identity) {
    dismissSplash();
    await showStaleScreen();
    ({ identity, isNew } = await ensureIdentity());
  }
  const { userId, code } = identity;

  touchLastSeen(userId).catch(() => {});

  initCodeDrawer(userId, code);
  initHeader(userId);
  initList(userId, code);
  if (!splashDone) {
    const followeeCount = getFollowing().length;
    initSplash(followeeCount);
    setOwnStatusReadyCallback(signalReady);
    setFolloweeReadyCallback(signalReady);
  }
  if (KNOCK_ENABLED) initKnocks(userId);

  if (isNew) enterFirstUseMode();  // must come before watchStatus subscription

  if (PALETTES_ENABLED) {
    document.getElementById('swatch-row').style.display = '';
    const paletteState = getPaletteState();
    const activeSetKey = String(paletteState.activeSet);
    const { selectedKey, activePaletteKey } = paletteState.sets[activeSetKey];
    // Apply status color vars before first paint
    applyPaletteVars(selectedKey);
    initSwatches(userId);
  }

  let lastStatus = null;
  let lastAvailableUntil = null;
  watchStatus(userId, (userData) => {
    if (!userData) return;
    const expired = userData.status === 'available' && isExpired(userData.availableUntil);
    const effectiveStatus = expired ? 'unavailable' : userData.status;
    const effectiveUntil  = expired ? null : userData.availableUntil;
    // Skip re-render when only unrelated fields changed (code, statusColor, followers).
    // This prevents the label animation from firing on every swatch tap or code rotation.
    if (effectiveStatus === lastStatus && effectiveUntil === lastAvailableUntil) return;
    lastStatus = effectiveStatus;
    lastAvailableUntil = effectiveUntil;
    if (expired) writeBackExpired(userId);
    applyOwnStatus(effectiveStatus, effectiveUntil);
  });

  if (isNew) {
    const availableUntil = Date.now() + 120 * 60000;
    setStatus(userId, 'available', availableUntil).catch(() => {});
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  }
}

main().catch(console.error);
