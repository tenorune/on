// js/app.js
import { loadIdentity, saveIdentity, clearIdentity, generateCode, generateRecoveryCode, parseRecoveryCode, deriveUserIdFromRecoveryCode } from './identity.js';
import { initUser, watchStatus, isExpired, writeBackExpired, userExists, touchLastSeen, setStatus, clearCallState, getUser } from './db.js';
import { initHeader, applyOwnStatus, enterFirstUseMode, setOwnStatusReadyCallback, updateChipFromServer } from './me.js';
import { initList, setFolloweeReadyCallback, reEnterCallMode, exitCallMode, getCallModeCalleeId } from './following.js';
import { initKnocks } from './knock.js';
import { initCodeDrawer, updateMyCode } from './mycode.js';
import { PALETTES_ENABLED, PALETTE_INTERACTIONS_ENABLED, KNOCK_ENABLED, CALL_ENABLED } from './features.js';
import { applyPaletteVars, initSwatches, getGlowForColor, getPaletteByKey, applyThemeVars, resetThemeVars, syncPaletteStateFromServer } from './palettes.js';
import { initFavoritesStrip, syncFavoritesFromServer } from './favorites.js';
import { getPaletteState, getFollowing } from './store.js';
import { attemptRedeemFromUrl, extractInviteTokenFromUrl, resolveInvitePreview } from './invites.js';
import { initNav, startCardsRowSubscriptions, initCardsRow, onContextChange, applyServerCurrentContext } from './groupNav.js';
import { enterGroupContext, exitGroupContext } from './groupContext.js';


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

async function ensureIdentity(pendingInviteToken = null) {
  const existing = loadIdentity();
  if (existing) {
    let valid = true;
    try {
      valid = await userExists(existing.userId);
    } catch {
      // Network error — assume valid and proceed offline
    }
    if (valid) return { identity: existing, isNew: false };
    // Stale identity flow: localStorage exists but Firebase doesn't.
    // Dismiss splash so the user can see and interact with the screens.
    dismissSplash();
    clearIdentity();
    // Loop so that cancelling the restore screen returns the user to the
    // stale screen, not silently to the new-account flow.
    while (true) {
      const choice = await showStaleScreen();
      if (choice === 'restore') {
        const restored = await showRestoreScreen();
        if (restored) {
          saveIdentity(restored.userId, restored.code, restored.recoveryCode);
          return { identity: restored, isNew: false };
        }
        continue;
      }
      return await createNewAccount();
    }
  }

  // Empty localStorage — true new user OR cleared cache.
  // Resolve invite preview BEFORE dismissing splash, so the welcome
  // screen renders with framing already populated. resolveInvitePreview
  // returns null synchronously when there is no pending token, so non-invite
  // boots do not pay the round-trip cost.
  const invitePreview = await resolveInvitePreview(pendingInviteToken);
  const inviteCreatorLabel = invitePreview?.scope === 'personal' ? invitePreview.label : null;
  const inviteGroupName = invitePreview?.scope === 'group' ? invitePreview.groupName : null;
  // Dismiss splash so the user can see and interact with the welcome screen.
  dismissSplash();
  // Loop so that cancelling the restore screen returns the user to the
  // welcome screen, not silently into the new-account flow.
  while (true) {
    const choice = await showWelcomeScreen({ inviteCreatorLabel, inviteGroupName });
    if (choice === 'restore') {
      const restored = await showRestoreScreen();
      if (restored) {
        saveIdentity(restored.userId, restored.code, restored.recoveryCode);
        return { identity: restored, isNew: false };
      }
      continue;
    }
    return await createNewAccount();
  }
}

async function createNewAccount() {
  const initial = generateRecoveryCode();
  const recoveryCode = await showRecoveryCodeModal(initial);
  const userId = await deriveUserIdFromRecoveryCode(recoveryCode);

  // Claim a share code transactionally; loop on collision
  let code, success;
  do {
    code = generateCode();
    success = await initUser(userId, code);
  } while (!success);

  saveIdentity(userId, code, recoveryCode);
  return { identity: { userId, code, recoveryCode }, isNew: true };
}

function showStaleScreen() {
  const el = document.getElementById('stale-screen');
  const continueBtn = document.getElementById('stale-continue-btn');
  const restoreBtn = document.getElementById('stale-restore-btn');
  el.classList.remove('hidden');
  return new Promise((resolve) => {
    function pick(choice) {
      continueBtn.removeEventListener('click', onContinue);
      restoreBtn.removeEventListener('click', onRestore);
      el.classList.add('hidden');
      resolve(choice);
    }
    function onContinue() { pick('continue'); }
    function onRestore() { pick('restore'); }
    continueBtn.addEventListener('click', onContinue);
    restoreBtn.addEventListener('click', onRestore);
  });
}

export function showWelcomeScreen({ inviteCreatorLabel = null, inviteGroupName = null } = {}) {
  const el = document.getElementById('welcome-screen');
  const newBtn = document.getElementById('welcome-new-btn');
  const restoreBtn = document.getElementById('welcome-restore-btn');
  const framingEl = document.getElementById('welcome-invite-framing');
  if (framingEl) {
    let text = '';
    if (inviteCreatorLabel) text = `You've been invited to follow ${inviteCreatorLabel}. First, let's set up your account.`;
    else if (inviteGroupName) text = `You've been invited to join '${inviteGroupName}'. First, let's set up your account.`;
    framingEl.textContent = text;
    framingEl.classList.toggle('hidden', !text);
  }
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
        error.textContent = "That doesn't look like a secret phrase — check that you entered 4 words from the list.";
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
        error.textContent = "No account found with that phrase. Check spelling, or tap Cancel to start over.";
        error.classList.remove('hidden');
        return;
      }
      const user = await getUser(userId);
      if (!user) {
        error.textContent = "No account found with that phrase. Check spelling, or tap Cancel to start over.";
        error.classList.remove('hidden');
        return;
      }
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

function handleInviteRedemptionResult(result) {
  if (result.ok) {
    // On success, the follow is now in place. No banner — the contact will appear
    // in the user's Following list once their watch subscriptions tick.
    return;
  }
  showInviteFailureOverlay(result.reason);
}

function showInviteFailureOverlay(reason) {
  const overlay = document.getElementById('invite-failure-overlay');
  const messageEl = document.getElementById('invite-failure-message');
  const continueBtn = document.getElementById('invite-failure-continue');
  // Defensive: no-op if the markup is absent (e.g., a future template change).
  if (!overlay || !messageEl || !continueBtn) return;
  messageEl.textContent = inviteFailureCopy(reason);
  overlay.classList.remove('hidden');
  continueBtn.onclick = () => overlay.classList.add('hidden');
}

function inviteFailureCopy(reason) {
  switch (reason) {
    case 'not-found': return "This invite link isn't valid.";
    case 'revoked':   return 'This invite link has been revoked.';
    case 'expired':   return 'This invite link has expired.';
    case 'cap':       return 'This invite link is no longer accepting new joiners.';
    case 'self':      return "That's your own invite link.";
    case 'already-following': return 'You already follow this person.';
    case 'creator-missing':   return "The link's creator no longer has an account.";
    default:          return "This invite link can't be used right now.";
  }
}

function cleanInviteParamFromUrl() {
  try {
    const clean = new URL(window.location.href);
    clean.searchParams.delete('i');
    window.history.replaceState({}, document.title, clean.toString());
  } catch { /* no-op on unusual URLs */ }
}

async function main() {
  const pendingInviteToken = extractInviteTokenFromUrl(window.location.href);
  const { identity, isNew } = await ensureIdentity(pendingInviteToken);
  const { userId, code } = identity;

  if (pendingInviteToken) {
    const result = await attemptRedeemFromUrl(pendingInviteToken, identity.userId, identity.code);
    if (result) {
      handleInviteRedemptionResult(result);
      // Clean the URL so a refresh doesn't re-trigger.
      cleanInviteParamFromUrl();
    }
  }

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

  initNav(userId);
  initCardsRow();
  startCardsRowSubscriptions();
  onContextChange((ctx) => {
    if (ctx.context === 'group') enterGroupContext(ctx.groupId, userId);
    else exitGroupContext();
  });

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
  let lastStatusColor = null;
  let lastPaletteKey = null;
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

    // Sync color/palette across devices. These updates are independent of the
    // status-text re-render below, so they must run BEFORE the early-return that
    // suppresses label animation on no-op status changes.
    let colorOrPaletteChanged = false;
    if (userData.statusColor && userData.statusColor !== lastStatusColor) {
      lastStatusColor = userData.statusColor;
      document.documentElement.style.setProperty('--my-status', userData.statusColor);
      document.documentElement.style.setProperty('--my-glow', getGlowForColor(userData.statusColor));
      colorOrPaletteChanged = true;
    }
    const incomingPaletteKey = userData.paletteKey ?? null;
    if (incomingPaletteKey !== lastPaletteKey) {
      lastPaletteKey = incomingPaletteKey;
      if (incomingPaletteKey) {
        const palette = getPaletteByKey(incomingPaletteKey);
        if (palette) applyThemeVars(palette.theme);
      } else {
        resetThemeVars();
      }
      colorOrPaletteChanged = true;
    }
    if (PALETTES_ENABLED && colorOrPaletteChanged) {
      syncPaletteStateFromServer(userId, userData.statusColor, incomingPaletteKey);
    }
    if (PALETTE_INTERACTIONS_ENABLED) {
      syncFavoritesFromServer(userId, userData.favorites);
    }
    if (userData.code) {
      updateMyCode(userData.code);
    }
    if (userData.lastTimeoutMinutes) {
      updateChipFromServer(userData.lastTimeoutMinutes);
    }
    applyServerCurrentContext(userData?.currentContext || 'direct');

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
