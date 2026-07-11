// tests/app-call-recovery.test.js
//
// Focused tests for the boot-time call-recovery block in app.js main().
// That block calls watchOwnCall once, recovers caller/callee state via
// reEnterCallMode, or endCall-cleans stale mailbox entries for unknown peers.
//
// Strategy: mock identity.js so loadIdentity() returns a valid identity
// immediately (so ensureIdentity() doesn't hang on showWelcomeScreen), mock
// all other modules that main() touches, and set CALL_ENABLED=true so the
// recovery block runs.

// Must be set up BEFORE app.js is require()'d.
const IDENTITY = { userId: 'me', code: 'MYCODE', recoveryCode: 'a-b-c-d' };

// Stub the hint-rotation engine: app.js calls initHintRotation() at boot, which
// would otherwise pull in the real engine (and its following.js call-state
// imports) and run during main(). This suite tests boot recovery, not rotation.
jest.mock('../js/hintRotation.js', () => ({
  initHintRotation: jest.fn(),
  refreshHints: jest.fn(),
  stopHintRotation: jest.fn(),
  clearActiveHint: jest.fn(),
}));

jest.mock('../js/identity.js', () => ({
  loadIdentity: jest.fn(() => IDENTITY),
  saveIdentity: jest.fn(),
  clearIdentity: jest.fn(),
  generateCode: jest.fn(() => 'ABCDEF'),
  generateRecoveryCode: jest.fn(() => 'w1-w2-w3-w4'),
  parseRecoveryCode: jest.fn(),
  deriveUserIdFromRecoveryCode: jest.fn().mockResolvedValue('me'),
}));

jest.mock('../js/firebase-config.js', () => ({
  db: {},
  getMessagingIfSupported: jest.fn().mockResolvedValue(null),
}));

// devReset.js imports firebase/auth directly (not through js/auth.js's mock),
// so without this it drags the real firebase/auth module into jsdom.
jest.mock('../js/devReset.js', () => ({ maybeRunDevReset: jest.fn().mockResolvedValue(false) }));

jest.mock('../js/db.js', () => ({
  initUser: jest.fn().mockResolvedValue(true),
  isExpired: jest.fn().mockReturnValue(false),
  writeBackExpired: jest.fn(),
  userExists: jest.fn().mockResolvedValue(true),
  touchLastSeen: jest.fn().mockResolvedValue(undefined),
  setStatus: jest.fn().mockResolvedValue(undefined),
  watchOwnCall: jest.fn(() => () => {}),
  endCall: jest.fn().mockResolvedValue(undefined),
  getUser: jest.fn().mockResolvedValue(null),
  getUserPrefs: jest.fn().mockResolvedValue(null),
  readGroup: jest.fn().mockResolvedValue(null),
  readGroupName: jest.fn().mockResolvedValue(null),
  watchUserPrefs: jest.fn(() => () => {}),
  watchStatus: jest.fn(() => () => {}),
  watchPendingInvites: jest.fn(() => () => {}),
  writePendingInvite: jest.fn().mockResolvedValue(undefined),
  deletePendingInvite: jest.fn().mockResolvedValue(undefined),
  readPendingInviteesForGroup: jest.fn().mockResolvedValue([]),
  claimInviteToken: jest.fn(),
  releaseInviteToken: jest.fn(),
  readInviteIndex: jest.fn(),
  readUserInvite: jest.fn(),
  readUserInvites: jest.fn().mockResolvedValue({}),
  writeUserInvite: jest.fn(),
  deleteUserInvite: jest.fn(),
  setInviteRevoked: jest.fn(),
  incrementInviteRedemptions: jest.fn(),
  getCreatorCode: jest.fn(),
  watchUserInvites: jest.fn(() => () => {}),
  claimGroupId: jest.fn(),
  writeUserGroupsEntry: jest.fn(),
  removeUserGroupsEntry: jest.fn(),
  readUserGroups: jest.fn().mockResolvedValue({}),
  watchUserGroups: jest.fn(() => () => {}),
  setLastVisited: jest.fn(),
  setCurrentContext: jest.fn(),
  writeGroup: jest.fn(),
  renameGroup: jest.fn(),
  deleteGroup: jest.fn(),
  watchGroupMeta: jest.fn(() => () => {}),
  writeMember: jest.fn(),
  readMember: jest.fn().mockResolvedValue(null),
  readMembers: jest.fn().mockResolvedValue({}),
  removeMember: jest.fn(),
  setMemberDisplayName: jest.fn(),
  watchGroupMembers: jest.fn(() => () => {}),
  writeGroupInvite: jest.fn(),
  readGroupInvites: jest.fn().mockResolvedValue({}),
  setGroupInviteRevoked: jest.fn(),
  incrementGroupInviteRedemptions: jest.fn(),
  watchGroupInvites: jest.fn(() => () => {}),
  setStatusOverride: jest.fn().mockResolvedValue(undefined),
  clearStatusOverride: jest.fn().mockResolvedValue(undefined),
  mergeStatusOverride: jest.fn().mockResolvedValue(undefined),
  mergeUserPrefs: jest.fn().mockResolvedValue(undefined),
  watchOwnMemberOverride: jest.fn(() => () => {}),
  watchFollowers: jest.fn(() => () => {}),
  watchFollowing: jest.fn(() => () => {}),
  setFollowingEntry: jest.fn().mockResolvedValue(undefined),
  removeFollowingEntry: jest.fn().mockResolvedValue(undefined),
  watchRevocations: jest.fn(() => () => {}),
  startCall: jest.fn().mockResolvedValue(undefined),
  answerCall: jest.fn().mockResolvedValue(undefined),
  setStatusColor: jest.fn().mockResolvedValue(undefined),
  registerAsFollower: jest.fn().mockResolvedValue(undefined),
  unregisterAsFollower: jest.fn().mockResolvedValue(undefined),
  removeFollower: jest.fn().mockResolvedValue(undefined),
  lookupCode: jest.fn().mockResolvedValue(null),
  formatTimeRemainingFuzzy: jest.fn(() => '2 hours'),
  timeRemainingMs: jest.fn(() => 7200000),
  formatLastSeen: jest.fn(() => null),
  writeBackExpired: jest.fn(),
}));

jest.mock('../js/me.js', () => ({
  initHeader: jest.fn(),
  applyOwnStatus: jest.fn(),
  enterFirstUseMode: jest.fn(),
  setOwnStatusReadyCallback: jest.fn(),
}));

jest.mock('../js/following.js', () => ({
  initList: jest.fn(),
  setFolloweeReadyCallback: jest.fn(),
  reEnterCallMode: jest.fn(),
  exitCallMode: jest.fn(),
  getCallModeCalleeId: jest.fn().mockReturnValue(null),
}));

jest.mock('../js/knock.js', () => ({
  initKnocks: jest.fn(),
  getFloatedUserIds: jest.fn(() => []),
}));

jest.mock('../js/mycode.js', () => ({
  initCodeDrawer: jest.fn(),
  updateMyCode: jest.fn(),
}));

jest.mock('../js/features.js', () => ({
  PALETTES_ENABLED: false,
  PALETTE_INTERACTIONS_ENABLED: false,
  KNOCK_ENABLED: false,
  CALL_ENABLED: true,
  NOTIFICATIONS_ENABLED: false,
}));

jest.mock('../js/notifyPrompt.js', () => ({
  initNotifyPrompt: jest.fn(),
  refreshPushToken: jest.fn().mockResolvedValue(undefined),
  requestPermissionAndRegister: jest.fn(),
}));

jest.mock('../js/palettes.js', () => ({
  applyPaletteVars: jest.fn(),
  initSwatches: jest.fn(),
  getGlowForColor: jest.fn(() => '#86efac'),
  getPaletteByKey: jest.fn(),
  applyThemeVars: jest.fn(),
  resetThemeVars: jest.fn(),
  syncPaletteStateFromServer: jest.fn(),
}));

jest.mock('../js/favorites.js', () => ({
  initFavoritesStrip: jest.fn(),
}));

jest.mock('../js/store.js', () => ({
  getPaletteState: jest.fn(() => ({
    activeSet: 1,
    sets: { '1': { selectedKey: 'default', activePaletteKey: 'default' } },
  })),
  getFollowing: jest.fn().mockReturnValue([]),
}));

jest.mock('../js/invites.js', () => ({
  attemptRedeemFromUrl: jest.fn().mockResolvedValue(null),
  extractInviteTokenFromUrl: jest.fn().mockReturnValue(null),
  extractInboxIntentFromUrl: jest.fn().mockReturnValue(false),
  extractDirectIntentFromUrl: jest.fn().mockReturnValue(false),
  resolveInvitePreview: jest.fn().mockResolvedValue(null),
}));

jest.mock('../js/prefs.js', () => ({
  initPrefs: jest.fn(),
  syncFromServer: jest.fn(),
  setCurrentContext: jest.fn(),
  getPaletteState: jest.fn(() => ({
    activeSet: 1,
    sets: { '1': { selectedKey: 'default', activePaletteKey: 'default' } },
  })),
  getFollowing: jest.fn().mockReturnValue([]),
}));

jest.mock('../js/groupNav.js', () => ({
  initNav: jest.fn(),
  startCardsRowSubscriptions: jest.fn(),
  initNavRow: jest.fn(),
  onContextChange: jest.fn(),
  applyServerCurrentContext: jest.fn(),
  navigateToGroup: jest.fn().mockResolvedValue(undefined),
  setLastKnownGroupName: jest.fn(),
  getCurrentContext: jest.fn(() => ({ context: 'direct' })),
}));

jest.mock('../js/ownStatus.js', () => ({
  initOwnStatus: jest.fn(),
  subscribeOwnStatus: jest.fn(),
}));

jest.mock('../js/groupContext.js', () => ({
  enterGroupContext: jest.fn(),
  exitGroupContext: jest.fn(),
}));

jest.mock('../js/groups.js', () => ({
  initGroupRemovalDetector: jest.fn(),
}));

jest.mock('../js/inbox.js', () => ({
  initInbox: jest.fn(),
  openInboxModal: jest.fn(),
}));

jest.mock('../js/followRequests.js', () => ({
  initFollowGrants: jest.fn(),
}));

jest.mock('../js/groupDisplayNamePrompt.js', () => ({
  showGroupDisplayNamePrompt: jest.fn(),
}));

jest.mock('../js/regenFlash.js', () => ({
  flashRegenerated: jest.fn(),
}));

jest.mock('../js/auth.js', () => ({ ensureSignedIn: jest.fn().mockResolvedValue(undefined) }));

// telegram.js imports firebase/auth directly (not through js/auth.js's mock
// above), so without this it drags the real firebase/auth module into jsdom.
jest.mock('../js/telegram.js', () => ({
  isTelegramContext: jest.fn(() => false),
  ensureTelegramIdentity: jest.fn(),
}));

// ---- Helpers ----

// Require app.js fresh (after all mocks are set), let main() run,
// and return the watchOwnCall callback that the boot-recovery block
// installed (the SECOND call to watchOwnCall — first is following.js's
// initList mock, but since following.js is fully mocked, only app.js's
// call to watchOwnCall lands).
//
// main() is async and fire-and-forgets itself. We return a promise that
// resolves once the microtask queue drains (enough for main() to reach the
// watchOwnCall registration synchronously, which it does before any await
// except getUserPrefs which we make resolve immediately).
async function loadAppAndCaptureRecoveryCb() {
  const { watchOwnCall } = require('../js/db.js');
  let recoveryCb = null;
  watchOwnCall.mockImplementation((_uid, cb) => {
    recoveryCb = cb;
    return jest.fn();
  });
  require('../js/app');
  // Drain the microtask queue so main()'s awaits (getUserPrefs) resolve
  // and main() reaches the watchOwnCall call.
  await new Promise((r) => setTimeout(r, 0));
  return recoveryCb;
}

// ---- Tests ----

describe('app.js boot-recovery: watchOwnCall callback', () => {
  const PEER_ENTRY = { userId: 'peer', code: 'PEER01', label: 'Peer' };
  const PEER_DATA = { statusColor: '#22c55e', code: 'PEER01' };

  beforeEach(() => {
    jest.resetModules();
    // Re-apply mocks after resetModules (jest.mock hoisting covers top-level
    // declarations, but resetModules clears the registry so we rely on the
    // hoisted mocks being re-applied when each module is require()'d fresh).
    document.body.innerHTML = '';
  });

  test('caller boot: call.to+answered+peer in following → reEnterCallMode called', async () => {
    const { getFollowing } = require('../js/store.js');
    const { getUser } = require('../js/db.js');
    const { reEnterCallMode } = require('../js/following.js');

    getFollowing.mockReturnValue([PEER_ENTRY]);
    getUser.mockResolvedValue(PEER_DATA);

    const cb = await loadAppAndCaptureRecoveryCb();
    expect(cb).not.toBeNull();

    await cb({ to: 'peer', answered: true, ts: 1 });
    await new Promise((r) => setTimeout(r, 0)); // let async cb settle

    expect(reEnterCallMode).toHaveBeenCalledWith(PEER_ENTRY, PEER_DATA, 'me');
  });

  test('callee boot: call.from+answered+peer in following → reEnterCallMode called', async () => {
    const { getFollowing } = require('../js/store.js');
    const { getUser } = require('../js/db.js');
    const { reEnterCallMode } = require('../js/following.js');

    getFollowing.mockReturnValue([PEER_ENTRY]);
    getUser.mockResolvedValue(PEER_DATA);

    const cb = await loadAppAndCaptureRecoveryCb();
    expect(cb).not.toBeNull();

    await cb({ from: 'peer', answered: true, ts: 1 });
    await new Promise((r) => setTimeout(r, 0));

    expect(reEnterCallMode).toHaveBeenCalledWith(PEER_ENTRY, PEER_DATA, 'me');
  });

  test('cleanup: peer NOT in following → endCall called, reEnterCallMode not called', async () => {
    const { getFollowing } = require('../js/store.js');
    const { endCall } = require('../js/db.js');
    const { reEnterCallMode } = require('../js/following.js');

    getFollowing.mockReturnValue([]); // peer not in following
    const cb = await loadAppAndCaptureRecoveryCb();
    expect(cb).not.toBeNull();

    await cb({ to: 'peer', answered: true, ts: 1 });
    await new Promise((r) => setTimeout(r, 0));

    expect(endCall).toHaveBeenCalledWith('me', 'peer');
    expect(reEnterCallMode).not.toHaveBeenCalled();
  });

  test('one-shot guard: callback is idempotent (second call is no-op)', async () => {
    const { getFollowing } = require('../js/store.js');
    const { getUser } = require('../js/db.js');
    const { reEnterCallMode } = require('../js/following.js');

    getFollowing.mockReturnValue([PEER_ENTRY]);
    getUser.mockResolvedValue(PEER_DATA);

    const cb = await loadAppAndCaptureRecoveryCb();
    await cb({ to: 'peer', answered: true, ts: 1 });
    await new Promise((r) => setTimeout(r, 0));
    await cb({ to: 'peer', answered: true, ts: 2 }); // second call — should be ignored
    await new Promise((r) => setTimeout(r, 0));

    expect(reEnterCallMode).toHaveBeenCalledTimes(1);
  });
});

describe('app.js boot: inbox deep-link (cold tap on an invite / follow-request)', () => {
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
  });

  async function bootApp() {
    require('../js/app');
    // Drain enough microtasks/macrotasks for main()'s awaits (ensureIdentity,
    // getUserPrefs, readGroup) to settle and reach the inbox-open near the end.
    for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
  }

  test('lands in Direct and opens the Inbox — does NOT restore the last group context', async () => {
    const invites = require('../js/invites.js');
    const db = require('../js/db.js');
    const { navigateToGroup } = require('../js/groupNav.js');
    const { openInboxModal } = require('../js/inbox.js');
    const { setCurrentContext } = require('../js/prefs.js');

    invites.extractInboxIntentFromUrl.mockReturnValue(true);
    db.getUserPrefs.mockResolvedValue({ currentContext: 'group:fam' }); // last context was a group
    db.readGroupName.mockResolvedValue({ name: 'Fam' }); // would otherwise drive navigateToGroup

    await bootApp();

    expect(openInboxModal).toHaveBeenCalled();
    expect(navigateToGroup).not.toHaveBeenCalled(); // restore skipped — we stay in Direct
    // Force-write 'direct' so the watchUserPrefs echo of the persisted
    // 'group:fam' doesn't yank us back into the group after boot.
    expect(setCurrentContext).toHaveBeenCalledWith('direct');
  });

  test('a ?direct=1 cold tap pins Direct (no group restore, no Inbox modal)', async () => {
    const invites = require('../js/invites.js');
    const db = require('../js/db.js');
    const { navigateToGroup } = require('../js/groupNav.js');
    const { openInboxModal } = require('../js/inbox.js');
    const { setCurrentContext } = require('../js/prefs.js');

    invites.extractDirectIntentFromUrl.mockReturnValue(true);
    db.getUserPrefs.mockResolvedValue({ currentContext: 'group:fam' }); // last context was a group
    db.readGroupName.mockResolvedValue({ name: 'Fam' }); // would otherwise drive navigateToGroup

    await bootApp();

    expect(navigateToGroup).not.toHaveBeenCalled();      // restore skipped — we stay in Direct
    expect(setCurrentContext).toHaveBeenCalledWith('direct'); // force-write so the echo can't yank us
    expect(openInboxModal).not.toHaveBeenCalled();       // Direct intent, not inbox — no modal
  });

  test('without the deep-link, a returning user still restores their last group context', async () => {
    const invites = require('../js/invites.js');
    const db = require('../js/db.js');
    const { navigateToGroup } = require('../js/groupNav.js');
    const { openInboxModal } = require('../js/inbox.js');

    invites.extractInboxIntentFromUrl.mockReturnValue(false);
    db.getUserPrefs.mockResolvedValue({ currentContext: 'group:fam' });
    db.readGroupName.mockResolvedValue({ name: 'Fam' });

    await bootApp();

    expect(navigateToGroup).toHaveBeenCalledWith('fam');
    expect(openInboxModal).not.toHaveBeenCalled();
  });

  test('boot signs in (ensureSignedIn) before wiring RTDB watchers', async () => {
    const { ensureSignedIn } = require('../js/auth.js');
    let signedInBeforeOwnStatus = false;
    require('../js/ownStatus.js').initOwnStatus.mockImplementation(() => {
      signedInBeforeOwnStatus = ensureSignedIn.mock.calls.length > 0;
    });
    await bootApp();
    expect(ensureSignedIn).toHaveBeenCalled();
    expect(signedInBeforeOwnStatus).toBe(true);
  });
});
