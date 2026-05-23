// js/app.js
import { loadIdentity, saveIdentity, generateUserId, generateCode, clearIdentity, generateRecoveryCode, parseRecoveryCode, deriveUserIdFromRecoveryCode } from './identity.js';
import { initUser, watchStatus, isExpired, writeBackExpired, userExists, touchLastSeen, setStatus, clearCallState, getUser } from './db.js';
import { initHeader, applyOwnStatus, enterFirstUseMode, setOwnStatusReadyCallback } from './me.js';
import { initList, setFolloweeReadyCallback, reEnterCallMode, exitCallMode, getCallModeCalleeId } from './following.js';
import { initKnocks } from './knock.js';
import { initCodeDrawer } from './mycode.js';
import { PALETTES_ENABLED, PALETTE_INTERACTIONS_ENABLED, KNOCK_ENABLED, CALL_ENABLED } from './features.js';
import { applyPaletteVars, initSwatches } from './palettes.js';
import { initFavoritesStrip } from './favorites.js';
import { getPaletteState, getFollowing } from './store.js';


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

export function showWelcomeScreen() {
  const el = document.getElementById('welcome-screen');
  const newBtn = document.getElementById('welcome-new-btn');
  const restoreBtn = document.getElementById('welcome-restore-btn');
  el.classList.remove('hidden');
  return new Promise((resolve) => {
    function pick(choice) {
      newBtn.removeEventListener('click', onNew);
      restoreBtn.removeEventListener('click', onRestore);
      el.classList.add('hidden');
      resolve(choice);
    }
    function onNew() { pick('new'); }
    function onRestore() { pick('restore'); }
    newBtn.addEventListener('click', onNew);
    restoreBtn.addEventListener('click', onRestore);
  });
}

export function showRecoveryCodeModal(initialCode) {
  const el = document.getElementById('recovery-modal');
  const text = document.getElementById('recovery-code-text');
  const rotateBtn = document.getElementById('recovery-rotate-btn');
  const copyBtn = document.getElementById('recovery-copy-btn');
  const savedBtn = document.getElementById('recovery-saved-btn');

  let current = initialCode;
  text.textContent = current;
  if (copyBtn) copyBtn.textContent = 'Copy';
  el.classList.remove('hidden');

  return new Promise((resolve) => {
    function onRotate() {
      current = generateRecoveryCode();
      text.textContent = current;
      if (copyBtn) copyBtn.textContent = 'Copy';
    }
    async function onCopy() {
      try {
        await navigator.clipboard?.writeText(current);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      } catch (_) {
        // ignore clipboard failures
      }
    }
    function onSaved() {
      rotateBtn.removeEventListener('click', onRotate);
      copyBtn.removeEventListener('click', onCopy);
      savedBtn.removeEventListener('click', onSaved);
      el.classList.add('hidden');
      resolve(current);
    }
    rotateBtn.addEventListener('click', onRotate);
    copyBtn.addEventListener('click', onCopy);
    savedBtn.addEventListener('click', onSaved);
  });
}

export function showRestoreScreen() {
  const el = document.getElementById('restore-screen');
  const input = document.getElementById('restore-input');
  const error = document.getElementById('restore-error');
  const submit = document.getElementById('restore-submit-btn');
  const cancel = document.getElementById('restore-cancel-btn');

  input.value = '';
  error.classList.add('hidden');
  error.textContent = '';
  el.classList.remove('hidden');

  return new Promise((resolve) => {
    async function onSubmit() {
      const normalized = parseRecoveryCode(input.value);
      if (!normalized) {
        error.textContent = "That doesn't look like a recovery code — check that you entered 4 words from the list.";
        error.classList.remove('hidden');
        return;
      }
      const userId = await deriveUserIdFromRecoveryCode(normalized);
      let exists;
      try {
        exists = await userExists(userId);
      } catch (_) {
        exists = false;
      }
      if (!exists) {
        error.textContent = "No account found with that code. Check spelling, or tap Cancel to start over.";
        error.classList.remove('hidden');
        return;
      }
      const user = await getUser(userId);
      teardown();
      resolve({ userId, code: user.code, recoveryCode: normalized });
    }
    function onCancel() {
      teardown();
      resolve(null);
    }
    function teardown() {
      submit.removeEventListener('click', onSubmit);
      cancel.removeEventListener('click', onCancel);
      el.classList.add('hidden');
    }
    submit.addEventListener('click', onSubmit);
    cancel.addEventListener('click', onCancel);
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
  if (!splashDone) {
    const followeeCount = getFollowing().length;
    initSplash(followeeCount);
    setOwnStatusReadyCallback(signalReady);
    setFolloweeReadyCallback(signalReady);
  }
  initList(userId, code);
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
    if (PALETTE_INTERACTIONS_ENABLED) initFavoritesStrip(userId);
  }

  let lastStatus = null;
  let lastAvailableUntil = null;
  let callModeHandled = false;
  watchStatus(userId, async (userData) => {
    if (!userData) return;

    if (!callModeHandled) {
      callModeHandled = true;
      if (CALL_ENABLED && userData.callState) {
        const { calleeId } = userData.callState;
        const calleeEntry = getFollowing().find(e => e.userId === calleeId);
        if (!calleeEntry) {
          clearCallState(userId).catch(() => {});
        } else {
          try {
            const calleeData = await getUser(calleeId);
            if (calleeData) {
              reEnterCallMode(calleeEntry, calleeData, userId);
            } else {
              clearCallState(userId).catch(() => {});
            }
          } catch {
            clearCallState(userId).catch(() => {});
          }
        }
      }
    } else if (CALL_ENABLED && getCallModeCalleeId() !== null && !userData.callState) {
      // Peer intentionally ended the call (callState cleared)
      const canvasScreen = document.getElementById('canvas-screen');
      if (canvasScreen && canvasScreen.classList.contains('active')) {
        // On canvas — show "partner left" dialog, then exit
        import('./canvas.js').then(({ showPeerLeftDialog, exitCanvas }) => {
          showPeerLeftDialog(canvasScreen, 'Your partner', () => {
            exitCanvas();
            exitCallMode(userId);
          });
        });
      } else {
        exitCallMode(userId);
      }
    }

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
