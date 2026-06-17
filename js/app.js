// js/app.js
import { loadIdentity, saveIdentity, clearIdentity, generateCode, generateRecoveryCode, parseRecoveryCode, deriveUserIdFromRecoveryCode } from './identity.js';
import { initUser, isExpired, writeBackExpired, userExists, touchLastSeen, setStatus, watchOwnCall, endCall, getUser, getUserPrefs, readGroupName } from './db.js';
import { initHeader, applyOwnStatus, enterFirstUseMode, setOwnStatusReadyCallback } from './me.js';
import { initList, setFolloweeReadyCallback, reEnterCallMode } from './following.js';
import { initKnocks } from './knock.js';
import { initCodeDrawer, updateMyCode } from './mycode.js';
import { PALETTES_ENABLED, PALETTE_INTERACTIONS_ENABLED, KNOCK_ENABLED, CALL_ENABLED, NOTIFICATIONS_ENABLED } from './features.js';
import { initNotifyPrompt, refreshPushToken, phraseReminderHtml, wirePhraseCopyButton } from './notifyPrompt.js';
import { initInstallAffordance } from './installAffordance.js';
import { initNotifyDebug } from './notifyDebug.js';
import { getMessagingIfSupported } from './firebase-config.js';
import { applyPaletteVars, initSwatches, getGlowForColor, getPaletteByKey, applyThemeVars, resetThemeVars, syncPaletteStateFromServer } from './palettes.js';
import { initFavoritesStrip } from './favorites.js';
import { getPaletteState, getFollowing } from './store.js';
import { attemptRedeemFromUrl, extractInviteTokenFromUrl, extractInboxIntentFromUrl, extractDirectIntentFromUrl, resolveInvitePreview } from './invites.js';
import { initPrefs, syncFromServer as syncPrefsFromServer, setCurrentContext as setPrefsCurrentContext } from './prefs.js';
import { watchUserPrefs } from './db.js';
import { initNav, startCardsRowSubscriptions, initNavRow, onContextChange, applyServerCurrentContext, navigateToGroup, navigateToDirect, setLastKnownGroupName, getCurrentContext } from './groupNav.js';
import { routeNotificationClick } from './notifyRouting.js';
import { initOwnStatus, subscribeOwnStatus } from './ownStatus.js';
import { enterGroupContext, exitGroupContext } from './groupContext.js';
import { initGroupRemovalDetector } from './groups.js';
import { initInbox, openInboxModal } from './inbox.js';
import { initFollowGrants } from './followRequests.js';
import { showGroupDisplayNamePrompt } from './groupDisplayNamePrompt.js';
import { flashRegenerated } from './regenFlash.js';
import { ensureSignedIn } from './auth.js';
import { shouldPrimeRestore, isStandalone, onboardingLane, SHARE_ICON, ADD_HOME_ICON, ADD_DOCK_ICON } from './installGuidance.js';


let splashCounter = 0;
let splashDone = false;
let _followGrantsUnsub = null; // captured for a future user-switch teardown (#214 R2)

// Busy/idle feedback for a primary action button while an async round-trip runs
// (restore verification, new-account setup). Disabling it both dims the button
// via the existing `.primary-btn:disabled` opacity rule and blocks double-taps;
// the label swaps to a progress word. The idle label is stashed on first use so
// clearButtonBusy restores whatever the markup shipped, and a re-open starts clean.
function setButtonBusy(btn, busyText) {
  if (!btn) return;
  if (btn.dataset.idleLabel === undefined) btn.dataset.idleLabel = btn.textContent;
  btn.textContent = busyText;
  btn.disabled = true;
}
function clearButtonBusy(btn) {
  if (!btn) return;
  if (btn.dataset.idleLabel !== undefined) btn.textContent = btn.dataset.idleLabel;
  btn.disabled = false;
}

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

// Bring the splash back after it was dismissed to show the welcome/restore
// screens. A just-restored account has real groups + contacts that load
// asynchronously; without re-arming, main() skips the `if (!splashDone)` splash
// setup and the post-restore reveal lets the user watch the nav row resolve
// from group code-names + default border colors into real names/overrides (and
// the empty Direct view fill in) — the exact "watch the UI figure itself out"
// flash a normal reload avoids by keeping the splash up until ready. The early
// dismiss's fade has long finished (the user spent seconds on the restore
// screen), so there's no pending transitionend listener to fight.
function rearmSplash() {
  splashDone = false;
  const el = document.getElementById('splash');
  if (!el) return;
  el.classList.remove('fading');
  el.style.display = '';
}

// The ?setup=install marker is stamped on the URL after account creation on the
// iOS/macOS install lanes. When the user opens that URL in a real browser to Add
// to Home Screen (a fresh storage partition with no identity), it routes them to
// install instructions instead of the new/restore chooser — preventing a
// duplicate account.
function markSetupInstall() {
  try { const u = new URL(location.href); u.searchParams.set('setup', 'install'); history.replaceState(null, '', u); } catch { /* ignore */ }
}
function isSetupInstall() {
  try { return new URLSearchParams(location.search).get('setup') === 'install'; } catch { return false; }
}

async function ensureIdentity(pendingInviteToken = null) {
  const existing = loadIdentity();
  if (existing) {
    let valid = true;
    try {
      await ensureSignedIn(existing.recoveryCode);
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
          await ensureSignedIn(restored.recoveryCode);
          // Re-show the splash so the user doesn't watch their groups + contacts
          // resolve from scratch after restoring.
          rearmSplash();
          return { identity: restored, isNew: false };
        }
        continue;
      }
      return await createNewAccount();
    }
  }

  // Empty localStorage — true new user OR cleared cache.

  // Standalone launch with empty storage → almost certainly a just-installed user
  // who must restore. Prime restore (AutoFill/Paste/manual) instead of the
  // new/restore chooser, with an escape hatch for the rare genuine-new case.
  if (shouldPrimeRestore({ standalone: isStandalone(), hasIdentity: false })) {
    dismissSplash();
    const restored = await showRestoreScreen();
    if (restored && restored.userId) {
      saveIdentity(restored.userId, restored.code, restored.recoveryCode);
      rearmSplash();
      return { identity: restored, isNew: false };
    }
    // restored.createNew (escape hatch) or null (cancel) → fall through to normal flow.
  }

  // Safari install-hop: the user created an account elsewhere (e.g. an in-app
  // browser) and opened this page in a real browser to Add to Home Screen — a
  // fresh partition with no identity but carrying the ?setup=install marker. Show
  // install instructions instead of the new/restore chooser so they don't fork a
  // duplicate account; after installing they Paste in the app.
  if (isSetupInstall() && !isStandalone()) {
    dismissSplash();
    const hopLane = onboardingLane({ installPromptAvailable: false });
    if (hopLane === 'ios-install' || hopLane === 'macos-install') {
      await showInstallStep(hopLane);
      // "Maybe later" falls through to the normal welcome flow below.
    }
  }

  // Resolve invite preview BEFORE dismissing splash, so the welcome
  // screen renders with framing already populated. resolveInvitePreview
  // returns null synchronously when there is no pending token, so non-invite
  // boots do not pay the round-trip cost.
  const invitePreview = await resolveInvitePreview(pendingInviteToken);
  const inviteCreatorLabel = invitePreview?.scope === 'personal' ? invitePreview.label : null;
  const inviteGroupName = invitePreview?.scope === 'group' ? invitePreview.groupName : null;
  // Dismiss splash so the user can see and interact with the welcome screen.
  dismissSplash();
  if (onboardingLane({ installPromptAvailable: false }) === 'in-app-browser') {
    await showInAppBrowserRedirect(); // informational; user may continue here anyway
  }
  // Loop so that cancelling the restore screen returns the user to the
  // welcome screen, not silently into the new-account flow.
  while (true) {
    const choice = await showWelcomeScreen({ inviteCreatorLabel, inviteGroupName });
    if (choice === 'restore') {
      const restored = await showRestoreScreen();
      if (restored) {
        saveIdentity(restored.userId, restored.code, restored.recoveryCode);
        // Re-show the splash so the user doesn't watch their groups + contacts
        // resolve from scratch after restoring.
        rearmSplash();
        return { identity: restored, isNew: false };
      }
      continue;
    }
    const created = await createNewAccount();
    const lane = onboardingLane({ installPromptAvailable: false });
    if (lane === 'ios-install' || lane === 'macos-install') {
      markSetupInstall(); // so the Safari hop (to Add to Home Screen) shows install, not the chooser
      await showInstallStep(lane);
    }
    return created;
  }
}

async function createNewAccount() {
  const initial = generateRecoveryCode();
  // Account setup (sign-in + transactional share-code claim) runs inside the
  // modal's onConfirm hook, so the "I've saved it" button shows "Setting up…"
  // and the modal stays up through the round-trips instead of dropping to a
  // blank screen before the Direct context paints.
  let userId, code;
  const recoveryCode = await showRecoveryCodeModal(initial, async (rc) => {
    userId = await deriveUserIdFromRecoveryCode(rc);
    await ensureSignedIn(rc);
    // Claim a share code transactionally; loop on collision.
    let success;
    do {
      code = generateCode();
      success = await initUser(userId, code);
    } while (!success);
    const kcUser = document.getElementById('recovery-keychain-username');
    if (kcUser) kcUser.value = code;
    saveIdentity(userId, code, rc);
  });
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

// `onConfirm` (optional) is an async hook run when the user taps "I've saved it",
// WHILE the modal stays up with the button in a "Setting up…" busy state. The
// modal only hides + resolves once it completes; if it throws, the modal stays
// open and the button reverts so the user can retry. New-account setup
// (sign-in + share-code claim) runs here so the screen doesn't go blank during
// those round-trips (the FTU equivalent of restore's post-submit splash).
export function showRecoveryCodeModal(initialCode, onConfirm) {
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

  const kcPhrase = document.getElementById('recovery-keychain-phrase');
  const kcForm = document.getElementById('recovery-keychain-form');
  if (kcPhrase) kcPhrase.value = current;
  const onKcSubmit = (e) => e.preventDefault();
  if (kcForm) kcForm.addEventListener('submit', onKcSubmit);

  return new Promise((resolve) => {
    function onRotate() {
      current = generateRecoveryCode();
      text.textContent = current;
      if (kcPhrase) kcPhrase.value = current;
      if (copyBtn) copyBtn.textContent = 'Copy';
      // Same visible-change cue as the invite modal: fade-in + a NEW badge that
      // replaces the ↻ while it shows (which also drops the button's focus, so
      // it never looks "stuck selected").
      flashRegenerated(text, rotateBtn);
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
    // Trap the browser/PWA back-gesture so it can't dismiss the modal and discard
    // the un-saved phrase: push a history entry on open, and re-push if a back
    // pops it while the modal is still showing. Net history depth stays +1 (each
    // back pops our entry and we push it again). Removed once the user saves.
    function onPopState() {
      if (!el.classList.contains('hidden') && typeof history !== 'undefined' && history.pushState) {
        history.pushState({ recoveryModal: true }, '');
      }
    }
    async function onSaved() {
      // Run any setup hook first, keeping the modal up with feedback. On failure
      // leave everything mounted so the user can tap again to retry.
      if (onConfirm) {
        setButtonBusy(savedBtn, 'Setting up…');
        try {
          await onConfirm(current);
        } catch (e) {
          console.error('account setup failed:', e);
          clearButtonBusy(savedBtn);
          return;
        }
      }
      rotateBtn.removeEventListener('click', onRotate);
      copyBtn.removeEventListener('click', onCopy);
      savedBtn.removeEventListener('click', onSaved);
      window.removeEventListener('popstate', onPopState);
      if (kcForm) kcForm.removeEventListener('submit', onKcSubmit);
      el.classList.add('hidden');
      resolve(current);
    }
    if (typeof history !== 'undefined' && history.pushState) {
      history.pushState({ recoveryModal: true }, '');
      window.addEventListener('popstate', onPopState);
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
  clearButtonBusy(submit); // clean state if a prior attempt left it busy
  el.classList.remove('hidden');

  const restoreForm = document.getElementById('restore-form');
  function onFormSubmit(e) { e.preventDefault(); }
  if (restoreForm) restoreForm.addEventListener('submit', onFormSubmit);

  return new Promise((resolve) => {
    // The field is always visible. With it empty the button reads "Paste & Sign
    // in" and pulls the phrase from the clipboard; once there's text (typed or
    // pasted) it reads "Sign in". Busy → "Signing in…".
    function syncLabel() {
      if (submit.disabled) return; // don't clobber the busy label
      submit.textContent = input.value.trim() ? 'Sign in' : 'Paste & Sign in';
    }
    function showError(msg) {
      error.textContent = msg;
      error.classList.remove('hidden');
    }
    async function onAction() {
      syncLabel();
      if (!input.value.trim()) {
        // Empty field → pull from the clipboard (the just-installed paste path).
        try {
          const text = await navigator.clipboard?.readText();
          if (text) input.value = text;
        } catch { /* clipboard blocked */ }
        if (!input.value.trim()) {
          showError('Paste or type your secret phrase.');
          input.focus();
          return;
        }
      }
      await onSubmit();
    }
    async function onSubmit() {
      const normalized = parseRecoveryCode(input.value);
      if (!normalized) {
        // Malformed input is rejected instantly with no round-trip — no busy state.
        showError("That doesn't look like a secret phrase — check that you entered 4 words from the list.");
        return;
      }
      // Feedback through the derive + sign-in + account-read round-trip.
      setButtonBusy(submit, 'Signing in…');
      const userId = await deriveUserIdFromRecoveryCode(normalized);
      try {
        // Sign in for THIS phrase before the owner-scoped validation reads —
        // post-R1 `userExists`/`getUser` require an auth session for the
        // account, and a cold restore has none yet. ensureSignedIn re-auths if
        // a prior (mistyped) attempt left a session for a different account.
        await ensureSignedIn(normalized);
      } catch (e) {
        // A sign-in failure (network, blocked request, function error) is NOT
        // an unknown phrase — surface it distinctly and log the real cause
        // instead of masquerading as "no account found".
        console.error('restore sign-in failed:', e);
        showError("Couldn't verify your phrase right now. Check your connection and try again.");
        clearButtonBusy(submit);
        return;
      }
      let user;
      try {
        const exists = await userExists(userId);
        if (!exists) {
          showError("No account found with that phrase. Check spelling, or tap Cancel to start over.");
          clearButtonBusy(submit);
          return;
        }
        user = await getUser(userId);
      } catch (e) {
        // A read failure here is transient/offline — NOT a missing account.
        // Sign-in already succeeded, so the phrase is valid; telling the user to
        // "start over" would discard a real identity. Surface it as retryable
        // instead of conflating it with "no account found".
        console.error('restore account read failed:', e);
        showError("Couldn't verify your phrase right now. Check your connection and try again.");
        clearButtonBusy(submit);
        return;
      }
      if (!user) {
        showError("No account found with that phrase. Check spelling, or tap Cancel to start over.");
        clearButtonBusy(submit);
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
      submit.removeEventListener('click', onAction);
      cancel.removeEventListener('click', onCancel);
      input.removeEventListener('input', syncLabel);
      if (restoreForm) restoreForm.removeEventListener('submit', onFormSubmit);
      el.classList.add('hidden');
    }
    submit.addEventListener('click', onAction);
    cancel.addEventListener('click', onCancel);
    input.addEventListener('input', syncLabel);
    syncLabel();
  });
}


// Inline install step for the iOS/macOS lanes. Body leads with the notification
// value (per copy conventions); the phrase-reminder is the shared block.
// "Maybe later" resolves so the user lands in the app un-installed (install
// stays reachable via the corner fab).
function showInstallStep(lane) {
  const el = document.getElementById('install-step');
  const titleEl = document.getElementById('install-step-title');
  const bodyEl = document.getElementById('install-step-body');
  const reminderEl = document.getElementById('install-step-reminder');
  const laterBtn = document.getElementById('install-step-later-btn');
  if (!el) return Promise.resolve();

  if (lane === 'macos-install') {
    titleEl.textContent = 'Install the app';
    bodyEl.innerHTML = 'To get notified about knocks, calls, and people coming online, install the app:'
      + `<span class="install-step-instruction">Choose File → Add to Dock ${ADD_DOCK_ICON}, then open the app from there.</span>`;
  } else { // ios-install
    titleEl.textContent = 'Install the app';
    bodyEl.innerHTML = 'To get notified about knocks, calls, and people coming online, install the app:'
      + `<span class="install-step-instruction">Tap the Share button ${SHARE_ICON}, then “Add to Home Screen” ${ADD_HOME_ICON}.</span>`;
  }
  // Save-your-phrase reminder (with Copy). Shown on both install modals so they
  // are identical; on the Safari install-hop the phrase is already on the
  // clipboard from the creation step (Copy is a no-op there), but the reminder
  // still applies.
  reminderEl.innerHTML = phraseReminderHtml();
  wirePhraseCopyButton(reminderEl);
  reminderEl.classList.remove('hidden');
  el.classList.remove('hidden');

  return new Promise((resolve) => {
    function later() { laterBtn.removeEventListener('click', later); el.classList.add('hidden'); resolve(); }
    laterBtn.addEventListener('click', later);
  });
}

// Redirect for in-app/embedded browsers (Instagram, Facebook, etc.), which can't
// Add to Home Screen. Surfaced before account creation so the account is ideally
// created in a real browser. Real browsers (Safari, Chrome, Firefox) are NOT sent
// here — they install normally.
function showInAppBrowserRedirect() {
  const el = document.getElementById('browser-redirect');
  const bodyEl = document.getElementById('browser-redirect-body');
  const continueBtn = document.getElementById('browser-redirect-continue-btn');
  if (!el) return Promise.resolve();
  bodyEl.textContent = 'This app’s built-in browser can’t install KnockKnock. To get notified about knocks, calls, and people coming online, open this page in your browser (Safari, Chrome, …), then add it to your Home Screen.';
  el.classList.remove('hidden');
  return new Promise((resolve) => {
    function cont() { continueBtn.removeEventListener('click', cont); el.classList.add('hidden'); resolve(); }
    continueBtn.addEventListener('click', cont);
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
  // Cold tap on an invite / follow-request notification: the SW opened us at
  // /?inbox=1 (sw.template.js coldStartUrl). Land in Direct and open the Inbox
  // rather than restoring the user's last (possibly group) context, where the
  // inbox isn't reachable. Strip the param so a refresh doesn't reopen it.
  // Cold taps deep-link with an intent param (sw.template.js coldStartUrl):
  // ?inbox=1 for invite/follow-request, ?direct=1 for a Direct knock/call/
  // availability. Both pin Direct (skip the last-context group restore); only
  // the inbox intent also opens the modal.
  const wantInbox = extractInboxIntentFromUrl(window.location.href);
  const wantDirect = extractDirectIntentFromUrl(window.location.href);
  const pinDirect = wantInbox || wantDirect;
  if (pinDirect) {
    try {
      const clean = new URL(window.location.href);
      clean.searchParams.delete('inbox');
      clean.searchParams.delete('direct');
      window.history.replaceState({}, document.title, clean.toString());
    } catch { /* no-op on unusual URLs */ }
  }
  const { identity, isNew } = await ensureIdentity(pendingInviteToken);
  const { userId, code } = identity;

  // Wire navigation BEFORE the invite-redemption block, otherwise navigateToGroup
  // writes to users/null/... (because initNav hasn't set the local userId yet) AND
  // its state change gets wiped by initNav's reset-to-direct that follows.
  // initOwnStatus opens the single own-user watch FIRST; everything else
  // subscribes to it. The normal registration order is groupNav (via initNav →
  // startCardsRowSubscriptions) → this file's own handler (~L580) → groupContext
  // on group-enter. NOTE the deep-link/returning-in-group boot path inverts this
  // (navigateToGroup → enterGroupContext runs before startCardsRowSubscriptions),
  // so groupContext can register first there. That's harmless: the real guarantee
  // that app.js's Direct-theme write never clobbers a group override is the
  // `inDirectCtx` gate on those writes (~L634), not fan-out order. The order still
  // matters for replay determinism — keep initOwnStatus before initNav. See ownStatus.js.
  initOwnStatus(userId);
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
  } else if (!isNew && !pinDirect) {
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
        // Name leaf only: if the user was removed from this group while away,
        // the whole-node read would be denied (non-member). We just need the
        // name to prime the nav cache.
        const groupData = await readGroupName(groupId);
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

  // Cold tap that pins Direct (invite/follow-request → Inbox, or a Direct
  // knock/call/availability): the restore branch was skipped, but the user's
  // persisted currentContext is still their last (group) context — force-write
  // 'direct' here, BEFORE watchUserPrefs starts, so its first echo doesn't yank
  // us into that group (same hazard the personal-invite-success path guards
  // against above).
  if (pinDirect) setPrefsCurrentContext('direct');

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

  initInstallAffordance();
  initPushNotifications(userId);

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

  // Boot-time own-call recovery: if we reload mid-call, re-enter the canvas
  // from the persisted calls/{me} mailbox. One-shot — only acts on an already
  // answered call (the caller side). An unanswered ring is left for
  // following.js's own-call watcher to render on its first tick.
  initCallRecovery(userId);

  startCardsRowSubscriptions();
  initGroupRemovalDetector(userId);
  initInbox(userId, code);
  // Capture the follow-grants watcher unsub (it watches followGrants/{me} for the
  // page lifetime) so a future user-switch/teardown can drop it (#214 R2).
  _followGrantsUnsub = initFollowGrants(userId, code);

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

  // Cold-start deep-link from an invite / follow-request tap: now that the
  // inbox watchers are live (initInbox above) and Direct is revealed, open the
  // Inbox modal over it. Closing the modal leaves the user in Direct.
  if (wantInbox) openInboxModal();

  if (isNew) enterFirstUseMode();  // must come before watchStatus subscription

  initPaletteBoot(userId);

  initOwnStatusSync(userId);

  if (isNew) {
    const availableUntil = Date.now() + 120 * 60000;
    setStatus(userId, 'available', availableUntil).catch(() => {});
  }

  initServiceWorker();
}

// ── Boot init steps (extracted from main() for readability; call order in
// main() is load-bearing — see the comments there) ───────────────────────────

// Own primary-status subscription: cross-device color/palette/code sync + the
// status-label re-render. Color/theme writes are Direct-context-scoped (see
// inDirectCtx) so a primary echo can't clobber an active group override.
function initOwnStatusSync(userId) {
  let lastStatus = null;
  let lastAvailableUntil = null;
  let lastStatusColor = null;
  let lastPaletteKey = null;
  subscribeOwnStatus(async (userData) => {
    if (!userData) return;

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
}

// Direct-context palette boot: reveal the swatch row and apply the saved color
// (Direct context only — a group override owns --my-status otherwise).
function initPaletteBoot(userId) {
  if (!PALETTES_ENABLED) return;
  document.getElementById('swatch-row').style.display = '';
  const paletteState = getPaletteState();
  const activeSetKey = String(paletteState.activeSet);
  const { selectedKey } = paletteState.sets[activeSetKey];
  if (getCurrentContext().context === 'direct') {
    applyPaletteVars(selectedKey);
  }
  initSwatches(userId);
  if (PALETTE_INTERACTIONS_ENABLED) initFavoritesStrip(userId);
}

// Push notifications + deep-link routing from notification taps. No-op unless
// the feature flag is on.
function initPushNotifications(userId) {
  if (!NOTIFICATIONS_ENABLED) return;
  initNotifyPrompt(userId);
  // Flag/opt-in-gated push debug readout (#156). No-op unless NOTIFY_DEBUG or
  // ?notifydebug=1.
  initNotifyDebug(userId);
  // Self-heal a drifted/stale FCM token on load (no-op unless already granted).
  refreshPushToken().catch(() => {});
  getMessagingIfSupported().then((messaging) => {
    if (!messaging) return;
    import('firebase/messaging').then(({ onMessage }) => {
      onMessage(messaging, () => { /* foreground: in-app UI already reflects it; no OS toast */ });
    });
  });
  // Deep-link routing: the SW postMessages a clicked notification to the focused
  // client (sw.js notificationclick). Invite/follow-request taps land in Direct
  // then open the Inbox; group activity navigates into the group.
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.kind !== 'notification-click') return;
    routeNotificationClick(e.data.data || {}, { navigateToDirect, navigateToGroup, openInboxModal });
  });
}

// Boot-time own-call recovery: re-enter the canvas if we reloaded mid-call. One-
// shot, and only for an already-answered call (the caller side); an unanswered
// ring is left for following.js's own-call watcher to render on its first tick.
function initCallRecovery(userId) {
  if (!CALL_ENABLED) return;
  // One-shot: this only needs the FIRST calls/{me} value (boot recovery). Capture
  // the unsub and drop the watcher after the first fire, so it isn't a permanent
  // duplicate of following.js's live own-call watch on the same path (#214 R1).
  let unsub = null;
  let handled = false;
  unsub = watchOwnCall(userId, async (call) => {
    if (handled) return;
    handled = true;
    if (unsub) unsub();
    if (!call) return;
    const peerId = call.to || call.from;
    const entry = getFollowing().find((e) => e.userId === peerId);
    if (!entry) { endCall(userId, peerId).catch(() => {}); return; }
    try {
      const peerData = await getUser(peerId);
      if (!peerData) { endCall(userId, peerId).catch(() => {}); return; }
      if (call.answered) reEnterCallMode(entry, peerData, userId);
    } catch { endCall(userId, peerId).catch(() => {}); }
  });
}

// Service worker registration + update-on-foreground + reload-on-update. Guarded
// to the update case (a controller already existed) so the first-ever install
// doesn't reload.
function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
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
    // re-checks sw.js on its own. Poke it on every foreground (and once at
    // launch) so a deployed update is noticed promptly.
    const checkForUpdate = () => { reg.update().catch(() => {}); };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    });
    checkForUpdate();
  }).catch(console.error);
}

main().catch(console.error);
