// js/app.js
import { loadIdentity, saveIdentity, clearIdentity, generateCode, generateRecoveryCode, parseRecoveryCode, deriveUserIdFromRecoveryCode } from './identity.js';
import { initUser, watchStatus, isExpired, writeBackExpired, userExists, touchLastSeen, setStatus, clearCallState, getUser, getUserPrefs, readGroup } from './db.js';
import { initHeader, applyOwnStatus, enterFirstUseMode, setOwnStatusReadyCallback } from './me.js';
import { initList, setFolloweeReadyCallback, reEnterCallMode, exitCallMode, getCallModeCalleeId } from './following.js';
import { initKnocks } from './knock.js';
import { initCodeDrawer, updateMyCode } from './mycode.js';
import { PALETTES_ENABLED, PALETTE_INTERACTIONS_ENABLED, KNOCK_ENABLED, CALL_ENABLED, NOTIFICATIONS_ENABLED } from './features.js';
import { initNotifyPrompt, refreshPushToken } from './notifyPrompt.js';
import { getMessagingIfSupported } from './firebase-config.js';
import { applyPaletteVars, initSwatches, getGlowForColor, getPaletteByKey, applyThemeVars, resetThemeVars, syncPaletteStateFromServer } from './palettes.js';
import { initFavoritesStrip } from './favorites.js';
import { getPaletteState, getFollowing } from './store.js';
import { attemptRedeemFromUrl, extractInviteTokenFromUrl, resolveInvitePreview } from './invites.js';
import { initPrefs, syncFromServer as syncPrefsFromServer, setCurrentContext as setPrefsCurrentContext } from './prefs.js';
import { watchUserPrefs } from './db.js';
import { initNav, startCardsRowSubscriptions, initNavRow, onContextChange, applyServerCurrentContext, navigateToGroup, setLastKnownGroupName, getCurrentContext } from './groupNav.js';
import { enterGroupContext, exitGroupContext } from './groupContext.js';
import { initGroupRemovalDetector } from './groups.js';


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
  if (!el) return new Promise(() => {}); // not mounted (e.g. partial DOM under test) — stay inert
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
  if (!el) return new Promise(() => {}); // not mounted (e.g. partial DOM under test) — stay inert
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
  if (!el) return new Promise(() => {}); // not mounted (e.g. partial DOM under test) — stay inert

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
  if (!el) return new Promise(() => {}); // not mounted (e.g. partial DOM under test) — stay inert

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

function showGroupDisplayNamePrompt(groupName) {
  const screen = document.getElementById('group-displayname-screen');
  const framing = document.getElementById('group-displayname-framing');
  const input = document.getElementById('group-displayname-input');
  const errEl = document.getElementById('group-displayname-error');
  const submit = document.getElementById('group-displayname-submit-btn');

  framing.textContent = `Your name in '${groupName}'`;
  errEl.textContent = '';
  errEl.classList.add('hidden');
  input.value = '';
  screen.classList.remove('hidden');

  return new Promise((resolve) => {
    function onSubmit() {
      const trimmed = (input.value || '').trim();
      if (!trimmed) { errEl.textContent = 'Please enter a name.'; errEl.classList.remove('hidden'); return; }
      if (trimmed.length > 40) { errEl.textContent = 'Name must be at most 40 characters.'; errEl.classList.remove('hidden'); return; }
      submit.removeEventListener('click', onSubmit);
      screen.classList.add('hidden');
      resolve(trimmed);
    }
    submit.addEventListener('click', onSubmit);
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
    case 'group-missing':     return "That group no longer exists.";
    case 'already-member':    return "You're already in that group.";
    case 'invalid-display-name': return 'Please choose a different display name.';
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

  // Wire navigation BEFORE the invite-redemption block, otherwise navigateToGroup
  // writes to users/null/... (because initNav hasn't set the local userId yet) AND
  // its state change gets wiped by initNav's reset-to-direct that follows.
  initNav(userId);
  initNavRow();  // Must register its onContextChange listener BEFORE the
                 // enterGroupContext listener below, so renderNavRow runs first
                 // on each emit and creates #group-override-toggle-slot before
                 // enterGroupContext looks for it.
  onContextChange((ctx) => {
    if (ctx.context === 'group') enterGroupContext(ctx.groupId, userId);
    else exitGroupContext();
  });

  // Make the prefs module aware of who's writing BEFORE the invite-redemption
  // block below. setCurrentContext (prefs.js) only mirrors to userPrefs/{uid}/
  // when it knows the userId; the redemption flow navigates contexts
  // (navigateToGroup → setCurrentContext('group:X'), or the personal-success
  // force-write of 'direct') before this point. If initPrefs ran later, those
  // writes would hit localStorage only, and the watchUserPrefs echo set up at
  // the end of main() would then read the *stale* server currentContext and
  // yank a just-joined invitee back out of the group (or into their old
  // context). The watchUserPrefs subscription itself stays below so echoes
  // don't fire mid-redemption.
  initPrefs(userId);

  if (pendingInviteToken) {
    // Dismiss the splash before redemption: the flow may show the
    // displayname prompt (new joiner) or a failure overlay (revoked,
    // already-member, etc.). Splash has z-index 1000 and would otherwise
    // sit on top of those overlays — the user couldn't dismiss it because
    // ensureIdentity dismisses splash only on welcome / stale paths, and
    // signalReady doesn't fire until watchStatus is set up below.
    dismissSplash();
    // Hide #main-ui-direct AND #nav-row for the entirety of the redemption
    // flow so neither the empty Direct view nor the empty nav row flashes
    // between the recovery-code modal closing and the displayname prompt
    // opening, or between the displayname submit and navigateToGroup landing.
    // initNavRow above synchronously removed .hidden on #nav-row; re-hide it
    // here, before the first await yields to the paint.
    const directEl = document.getElementById('main-ui-direct');
    if (directEl) directEl.classList.add('hidden');
    const navRowEl = document.getElementById('nav-row');
    if (navRowEl) navRowEl.classList.add('hidden');
    let landedInGroup = false;
    let result = await attemptRedeemFromUrl(pendingInviteToken, identity.userId, identity.code);
    // Captured from the needs-display-name response so we can prime
    // setLastKnownGroupName even on the success path (where the second
    // attemptRedeemFromUrl call returns its own groupName too).
    let previewGroupName = null;
    if (result && result.ok === false && result.reason === 'needs-display-name') {
      previewGroupName = result.groupName;
      const promptName = previewGroupName || 'this group';
      const displayName = await showGroupDisplayNamePrompt(promptName);
      // Pass the cache forward so the second call doesn't re-fetch the
      // invite index + group record.
      result = await attemptRedeemFromUrl(pendingInviteToken, identity.userId, identity.code, {
        displayName,
        cache: result.cache,
      });
    }
    if (result) {
      handleInviteRedemptionResult(result);
      // Clean the URL so a refresh doesn't re-trigger.
      cleanInviteParamFromUrl();
      if (result.ok && result.groupId) {
        // Prime the nav-row name cache so the group context shows "Family"
        // immediately rather than flashing the random groupId for the
        // round-trip until watchGroupMeta resolves with the name.
        const knownName = result.groupName || previewGroupName || null;
        if (knownName) setLastKnownGroupName(result.groupId, knownName);
        await navigateToGroup(result.groupId);
        landedInGroup = true;
      } else if (result.ok) {
        // Personal-invite success: the new contact lives in Direct, so we must
        // land the user in Direct context. Without this, an existing user who
        // last had currentContext='group:X' gets yanked into that group by the
        // watchUserPrefs tick below — and never sees the new follow. initNav set
        // _state locally to 'direct' already; force-write 'direct' to userPrefs
        // so the sync echo doesn't override us.
        setPrefsCurrentContext('direct');
      }
    }
    // If we didn't end up in a group context (personal invite, failure,
    // etc.), restore the Direct view AND the nav row so the user has
    // somewhere to land. The landed-in-group case re-shows the nav row
    // automatically via navigateToGroup's emit() → renderNavRow chain.
    if (!landedInGroup) {
      if (directEl) directEl.classList.remove('hidden');
      if (navRowEl) navRowEl.classList.remove('hidden');
    }
  } else if (!isNew) {
    // Returning user (no pending invite). Pre-resolve the user's last
    // currentContext from Firebase BEFORE any visible paint. Without
    // this, initNav defaults _state to 'direct', the end-of-main reveal
    // shows #main-ui-direct, and the first watchStatus tick then yanks
    // the user into 'group:X' — producing the documented sequence of
    // Direct flash → group context with the backend groupId → group
    // context with the real name once watchGroupMeta lands. Hiding the
    // direct shell + nav row across the prefetch keeps the screen empty
    // until we know where we're landing.
    const directEl = document.getElementById('main-ui-direct');
    const navRowEl = document.getElementById('nav-row');
    if (directEl) directEl.classList.add('hidden');
    if (navRowEl) navRowEl.classList.add('hidden');
    try {
      // currentContext lives in userPrefs/{uid}/ after the migration.
      const prefsSnap = await getUserPrefs(userId);
      const cc = prefsSnap?.currentContext;
      if (typeof cc === 'string' && cc.startsWith('group:')) {
        const groupId = cc.slice(6);
        const groupData = await readGroup(groupId);
        if (groupData?.name) {
          // Prime the nav-row name cache so the group nav renders the
          // real name on its first emit, not the groupId.
          setLastKnownGroupName(groupId, groupData.name);
          // navigateToGroup runs emit() synchronously: renderNavRow
          // unhides #nav-row and renders group mode; the onContextChange
          // listener registered above reveals #group-context-root.
          await navigateToGroup(groupId);
        }
      }
    } catch (_) {
      // Network / read failure — fall through to direct context. The
      // end-of-main reveal block below unhides #main-ui-direct +
      // #nav-row.
    }
  }

  touchLastSeen(userId).catch(() => {});

  // Cross-device user-preferences sync. initPrefs already ran above (before the
  // invite-redemption block) so context writes there persist; the watchUserPrefs
  // subscription reconciles local cache with server on every change. Started
  // here, after redemption, so its echoes can't reset context mid-flow. Writes
  // throughout the app (markHintSeen, incrementMadeCallCount, etc.) go through
  // prefs.js so they hit both localStorage and userPrefs/{uid}/ in Firebase.
  watchUserPrefs(userId, (serverPrefs) => {
    syncPrefsFromServer(serverPrefs);
  });

  if (NOTIFICATIONS_ENABLED) {
    initNotifyPrompt(userId);
    // Self-heal a drifted/stale FCM token on load (no-op unless already granted).
    refreshPushToken().catch(() => {});
    getMessagingIfSupported().then((messaging) => {
      if (!messaging) return;
      import('firebase/messaging').then(({ onMessage }) => {
        onMessage(messaging, () => { /* foreground: in-app UI already reflects it; no OS toast */ });
      });
    });
    // Deep-link routing: the SW postMessages a clicked notification to the focused
    // client (sw.js notificationclick). Route group notifications into that group.
    navigator.serviceWorker?.addEventListener('message', (e) => {
      if (e.data?.kind !== 'notification-click') return;
      const gid = e.data.data?.contextGroupId;
      if (gid) navigateToGroup(gid);
    });
  }

  // currentContext changes from sibling devices arrive as a
  // 'current-context-synced' CustomEvent; forward into groupNav so the
  // active context flips just like the old watchStatus-driven path used to.
  document.addEventListener('current-context-synced', (e) => {
    applyServerCurrentContext(e.detail?.currentContext || 'direct');
  });

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

  startCardsRowSubscriptions();
  initGroupRemovalDetector(userId);

  // #main-ui-direct starts hidden (markup default) so the welcome / restore /
  // recovery-code / displayname overlays render against a clean dark body
  // bg instead of having the empty Direct shell bleed through their
  // semi-transparent backdrops. Reveal it now — unless we navigated into a
  // group during the invite-redemption block above, in which case
  // enterGroupContext already toggled the visibility correctly.
  if (getCurrentContext().context !== 'group') {
    const directEl = document.getElementById('main-ui-direct');
    if (directEl) directEl.classList.remove('hidden');
    // Returning-user prefetch block above hides #nav-row when the prior
    // currentContext was a group but we couldn't navigate (no group, no
    // name, or read failure); restore it here so direct-context users
    // still get their nav.
    const navRowEl = document.getElementById('nav-row');
    if (navRowEl) navRowEl.classList.remove('hidden');
  }

  if (isNew) enterFirstUseMode();  // must come before watchStatus subscription

  if (PALETTES_ENABLED) {
    document.getElementById('swatch-row').style.display = '';
    const paletteState = getPaletteState();
    const activeSetKey = String(paletteState.activeSet);
    const { selectedKey, activePaletteKey } = paletteState.sets[activeSetKey];
    // Apply status color vars before first paint — but only when landing in
    // Direct context. In a group context, the override owns --my-status via
    // groupContext.applyEffectivePalette; writing the Direct picker color
    // here would clobber any override color set during the async
    // enterGroupContext path above (which can fire Firebase callbacks during
    // the `await navigateToGroup` that runs before we reach this point).
    if (getCurrentContext().context === 'direct') {
      applyPaletteVars(selectedKey);
    }
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
    //
    // The --my-status / --my-glow / theme-var writes are scoped to Direct
    // context. In a group context the override owns those vars (set by
    // groupContext.applyEffectivePalette on the override callback). Without
    // this gate, an unrelated primary echo would clobber the override color
    // — and on a fresh boot where the override callback fires before this
    // one, the final --my-status ends up at the user's Direct picker color
    // even though they're Available in the group with override on.
    const inDirectCtx = getCurrentContext().context === 'direct';
    let colorOrPaletteChanged = false;
    if (userData.statusColor && userData.statusColor !== lastStatusColor) {
      lastStatusColor = userData.statusColor;
      if (inDirectCtx) {
        document.documentElement.style.setProperty('--my-status', userData.statusColor);
        document.documentElement.style.setProperty('--my-glow', getGlowForColor(userData.statusColor));
      }
      colorOrPaletteChanged = true;
    }
    const incomingPaletteKey = userData.paletteKey ?? null;
    if (incomingPaletteKey !== lastPaletteKey) {
      lastPaletteKey = incomingPaletteKey;
      if (inDirectCtx) {
        if (incomingPaletteKey) {
          const palette = getPaletteByKey(incomingPaletteKey);
          if (palette) applyThemeVars(palette.theme);
        } else {
          resetThemeVars();
        }
      }
      colorOrPaletteChanged = true;
    }
    if (PALETTES_ENABLED && colorOrPaletteChanged) {
      syncPaletteStateFromServer(userId, userData.statusColor, incomingPaletteKey);
    }
    // Favorites cross-device sync now lands via watchUserPrefs →
    // prefs.syncFromServer (the legacy users/{uid}/favorites field is
    // ignored after this migration; userPrefs/{uid}/favorites is the
    // source of truth).
    if (userData.code) {
      updateMyCode(userData.code);
    }
    // Chip-default cross-device sync now lands via watchUserPrefs →
    // prefs.syncFromServer → 'last-timeout-synced' event, which me.js's
    // initHeader listener picks up. The legacy users/{uid}/lastTimeoutMinutes
    // field is no longer read. currentContext is read from userPrefs too
    // (via the 'current-context-synced' event wired below).

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
    // Reload once when a newly-installed service worker takes control, so the
    // freshly-activated shell is shown without a manual reinstall. Guarded to
    // the update case (a controller already existed) so the first-ever install
    // doesn't reload. The SW calls skipWaiting()+clients.claim(), so a detected
    // update activates and fires controllerchange on its own.
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !hadController) return;
      reloading = true;
      window.location.reload();
    });

    navigator.serviceWorker.register('/sw.js').then((reg) => {
      window.__swRegistration = reg;
      // iOS standalone PWAs resume without a navigation, so the browser never
      // re-checks sw.js on its own. Poke it every time the app is foregrounded
      // (and once at launch) so a deployed update is noticed promptly.
      const checkForUpdate = () => { reg.update().catch(() => {}); };
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });
      checkForUpdate();
    }).catch(console.error);
  }
}

main().catch(console.error);
