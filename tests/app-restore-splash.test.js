// tests/app-restore-splash.test.js
//
// Regression suite for the post-restore splash gating (the "state-resolution
// flash", first fixed in aac5e24). Restoring from a secret phrase on a fresh
// device re-arms the splash (rearmSplash), but the splash counter was armed
// from getFollowing() — the LOCAL cache, which is empty on a fresh device — so
// the counter collapsed to 1 (own status only). The ownStatus single-owner
// refactor then made the own-status ready signal fire synchronously (the
// subscribeOwnStatus replay: the watch opens in Stage 2, ticks during Stage
// 3's awaited prefetches, and replays at Stage 5's subscribe), dismissing the
// re-armed splash immediately — before the server following list, followee
// presence, or group names arrived. Observed: guided empty state flashes in
// Direct, nav cards flash group codes (macOS PWA / desktop Safari).
//
// The fix gates a restore boot on SERVER truth instead: own status + the first
// following-list tick (which adds one pending unit per followee) + each
// followee's first presence render + the group set with names resolved.
//
// Strategy (mirrors tests/app-boot-cacheOwner.test.js): mock every module
// main() touches, run the REAL app.js boot against jsdom DOM including the
// restore screen, drive the restore submit, then fire the captured ready
// callbacks one at a time and assert on the #splash element.

// Must be set up BEFORE app.js is require()'d.
const IDENTITY = { userId: 'me', code: 'MYCODE', recoveryCode: 'a-b-c-d' };

jest.mock('../js/hintRotation.js', () => ({
  initHintRotation: jest.fn(),
  refreshHints: jest.fn(),
  stopHintRotation: jest.fn(),
  clearActiveHint: jest.fn(),
}));

jest.mock('../js/identity.js', () => ({
  loadIdentity: jest.fn(() => null),
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
  getUser: jest.fn().mockResolvedValue({ code: 'MYCODE' }),
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
  setFollowingListReadyCallback: jest.fn(),
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
  startPersonalInviteFlow: jest.fn(),
}));

jest.mock('../js/features.js', () => ({
  PALETTES_ENABLED: false,
  PALETTE_INTERACTIONS_ENABLED: false,
  KNOCK_ENABLED: false,
  CALL_ENABLED: false,
  NOTIFICATIONS_ENABLED: false,
}));

jest.mock('../js/notifyPrompt.js', () => ({
  initNotifyPrompt: jest.fn(),
  refreshPushToken: jest.fn().mockResolvedValue(undefined),
  requestPermissionAndRegister: jest.fn(),
  phraseReminderHtml: jest.fn(() => ''),
  wirePhraseCopyButton: jest.fn(),
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
  // locationShare's boot seeding reads these synchronously at init.
  getLocationOptIn: jest.fn(() => false),
  getOptedInLocationGids: jest.fn(() => []),
}));

jest.mock('../js/groupNav.js', () => ({
  initNav: jest.fn(),
  startCardsRowSubscriptions: jest.fn(),
  initNavRow: jest.fn(),
  onContextChange: jest.fn(),
  applyServerCurrentContext: jest.fn(),
  navigateToGroup: jest.fn().mockResolvedValue(undefined),
  navigateToDirect: jest.fn().mockResolvedValue(undefined),
  setLastKnownGroupName: jest.fn(),
  setGroupsReadyCallback: jest.fn(),
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
  showToast: jest.fn(),
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

jest.mock('../js/telegram.js', () => ({
  isTelegramContext: jest.fn(() => false),
  ensureTelegramIdentity: jest.fn(),
  isTelegramLinked: jest.fn(() => false),
  telegramFirstName: jest.fn(() => ''),
}));

// Route the boot down the prime-restore lane (standalone install, empty
// storage) — the exact macOS-PWA repro surface. The welcome-screen lane's
// restore branch shares rearmSplash, so one lane covers the gating.
jest.mock('../js/installGuidance.js', () => ({
  ...jest.requireActual('../js/installGuidance.js'),
  shouldPrimeRestore: jest.fn(() => true),
  isStandalone: jest.fn(() => true),
  onboardingLane: jest.fn(() => 'none'),
}));

// ---- Helpers ----

function setupDom() {
  document.body.innerHTML = `
    <div id="splash"><span class="brand-mark">kk</span></div>
    <div id="restore-screen" class="restore-screen hidden">
      <form id="restore-form">
        <input id="restore-input" type="text" />
        <p id="restore-error" class="error-msg hidden"></p>
        <button id="restore-submit-btn" type="submit">Paste &amp; Sign in</button>
        <button id="restore-cancel-btn" type="button">Cancel</button>
      </form>
    </div>
    <div id="invite-failure-overlay" class="modal-overlay hidden" role="dialog" aria-modal="true">
      <p id="invite-failure-message"></p>
      <button id="invite-failure-continue" type="button">Continue</button>
    </div>
    <div id="nav-row" class="nav-row hidden"></div>
    <div id="main-ui-direct" class="hidden"></div>
  `;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

// Boot app.js with empty identity, then drive the restore screen through a
// successful phrase submit. Returns the captured ready callbacks.
async function bootThroughRestore() {
  const identity = require('../js/identity.js');
  identity.loadIdentity.mockReturnValue(null);
  identity.parseRecoveryCode.mockResolvedValue(IDENTITY.recoveryCode);
  identity.deriveUserIdFromRecoveryCode.mockResolvedValue(IDENTITY.userId);

  require('../js/app');
  await flush();

  // The restore screen is up; the splash was dismissed early so the user can
  // interact with it.
  expect(document.getElementById('restore-screen').classList.contains('hidden')).toBe(false);

  document.getElementById('restore-input').value = 'alpha-bravo-charlie-delta';
  document.getElementById('restore-submit-btn').click();
  await flush();
  await flush();

  const me = require('../js/me.js');
  const following = require('../js/following.js');
  const groupNav = require('../js/groupNav.js');
  expect(me.setOwnStatusReadyCallback).toHaveBeenCalled();
  return {
    ownReady: me.setOwnStatusReadyCallback.mock.calls.at(-1)[0],
    followeeReady: following.setFolloweeReadyCallback.mock.calls.at(-1)?.[0],
    listReadyCalls: following.setFollowingListReadyCallback.mock.calls,
    groupsReadyCalls: groupNav.setGroupsReadyCallback.mock.calls,
  };
}

const splashEl = () => document.getElementById('splash');
const splashFading = () => splashEl().classList.contains('fading');

// ---- Tests ----

describe('post-restore splash gating (fresh-device restore)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    localStorage.clear();
    setupDom();
  });

  test('splash is re-armed after the restore submit (not left dismissed)', async () => {
    await bootThroughRestore();
    expect(splashEl().style.display).not.toBe('none');
    expect(splashFading()).toBe(false);
  });

  test('own-status ready alone must NOT dismiss the splash (the local following cache is empty — server data is still unresolved)', async () => {
    const { ownReady } = await bootThroughRestore();
    ownReady();
    expect(splashFading()).toBe(false);
  });

  test('splash holds until own status + server following list + every followee presence + groups are resolved', async () => {
    const { ownReady, followeeReady, listReadyCalls, groupsReadyCalls } = await bootThroughRestore();
    const listReady = listReadyCalls.at(-1)[0];
    const groupsReady = groupsReadyCalls.at(-1)[0];

    ownReady();
    expect(splashFading()).toBe(false);
    listReady(2); // server says: two followees — their presence renders are now pending
    expect(splashFading()).toBe(false);
    groupsReady();
    expect(splashFading()).toBe(false);
    followeeReady();
    expect(splashFading()).toBe(false);
    followeeReady();
    expect(splashFading()).toBe(true);
  });

  test('an account with no contacts and no groups reveals once the empty server state is confirmed', async () => {
    const { ownReady, listReadyCalls, groupsReadyCalls } = await bootThroughRestore();
    const listReady = listReadyCalls.at(-1)[0];
    const groupsReady = groupsReadyCalls.at(-1)[0];

    ownReady();
    listReady(0);
    expect(splashFading()).toBe(false);
    groupsReady();
    expect(splashFading()).toBe(true);
  });

  // ── Invite-redemption boots ──────────────────────────────────────────────
  // Same flash class as the restore path: the redemption branch dismisses the
  // splash up front (so the displayname prompt / failure overlay are usable
  // under splash z-1000), and any outcome that lands in Direct — e.g. a member
  // redeeming an invite to a group they already belong to, which only learns
  // 'already-member' from the SECOND redeem call, after the name prompt —
  // revealed the Direct shell with nothing covering the state resolution.

  async function bootThroughGroupInviteRedemption(secondResult) {
    const identity = require('../js/identity.js');
    identity.loadIdentity.mockReturnValue(IDENTITY); // existing user on this device
    const invites = require('../js/invites.js');
    invites.extractInviteTokenFromUrl.mockReturnValue('TOKEN');
    invites.attemptRedeemFromUrl
      .mockResolvedValueOnce({ ok: false, reason: 'needs-display-name', groupId: 'G1', groupName: 'Family', cache: {} })
      .mockResolvedValueOnce(secondResult);
    // The prompt is interactive and sits below splash z-1000 — the splash must
    // be dismissed by the time it opens (and not before something needs it).
    let fadingAtPrompt = null;
    require('../js/groupDisplayNamePrompt.js').showGroupDisplayNamePrompt.mockImplementation(async () => {
      fadingAtPrompt = splashFading();
      return 'Alex';
    });

    require('../js/app');
    await flush();
    await flush();

    expect(fadingAtPrompt).toBe(true);

    const me = require('../js/me.js');
    const following = require('../js/following.js');
    const groupNav = require('../js/groupNav.js');
    return { me, following, groupNav };
  }

  test('no-prompt already-member outcome keeps the splash SOLID through the redemption (no fade-out/fade-back artifact)', async () => {
    // Post-short-circuit shape: already-member comes back from the FIRST call.
    // Device-observed artifact: the branch used to dismiss the splash up
    // front, so the fade began, then rearmSplash reversed it mid-transition —
    // fade out, snap back to solid, fade again. The splash must not begin
    // fading while the redemption round-trip is in flight.
    const identity = require('../js/identity.js');
    identity.loadIdentity.mockReturnValue(IDENTITY);
    const invites = require('../js/invites.js');
    invites.extractInviteTokenFromUrl.mockReturnValue('TOKEN');
    let fadingAtRedeemCall = null;
    invites.attemptRedeemFromUrl.mockImplementation(async () => {
      fadingAtRedeemCall = splashFading() || splashEl().style.display === 'none';
      return { ok: false, reason: 'already-member', groupId: 'G1', groupName: 'Family' };
    });

    require('../js/app');
    await flush();
    await flush();

    expect(fadingAtRedeemCall).toBe(false); // splash still solid during the round-trip
    expect(splashFading()).toBe(false);     // and still solid at boot completion
    expect(splashEl().style.display).not.toBe('none');
    expect(document.getElementById('invite-failure-overlay').classList.contains('hidden')).toBe(false);

    // Server-truth gating still governs the fade.
    const me = require('../js/me.js');
    const following = require('../js/following.js');
    const groupNav = require('../js/groupNav.js');
    me.setOwnStatusReadyCallback.mock.calls.at(-1)[0]();
    expect(splashFading()).toBe(false);
    following.setFollowingListReadyCallback.mock.calls.at(-1)[0](0);
    groupNav.setGroupsReadyCallback.mock.calls.at(-1)[0]();
    expect(splashFading()).toBe(true);
  });

  test('already-member from the SECOND call (prompt-window race) re-arms the splash over the Direct reveal and holds it until server state resolves', async () => {
    const { me, following, groupNav } = await bootThroughGroupInviteRedemption(
      { ok: false, reason: 'already-member', groupId: 'G1', groupName: 'Family' },
    );

    // The failure surface is queued (visible once the splash fades)…
    expect(document.getElementById('invite-failure-overlay').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('invite-failure-message').textContent).toBe("You're already in that group.");
    // …and the splash is re-armed over the reveal.
    expect(splashEl().style.display).not.toBe('none');
    expect(splashFading()).toBe(false);

    // Server-truth gating, same as the restore path.
    const ownReady = me.setOwnStatusReadyCallback.mock.calls.at(-1)[0];
    const listReady = following.setFollowingListReadyCallback.mock.calls.at(-1)[0];
    const groupsReady = groupNav.setGroupsReadyCallback.mock.calls.at(-1)[0];
    const followeeReady = following.setFolloweeReadyCallback.mock.calls.at(-1)[0];
    ownReady();
    expect(splashFading()).toBe(false);
    listReady(1);
    groupsReady();
    expect(splashFading()).toBe(false);
    followeeReady();
    expect(splashFading()).toBe(true);
  });

  test('new-joiner success lands in the group context and does NOT re-arm the splash', async () => {
    const groupNavMock = require('../js/groupNav.js');
    groupNavMock.getCurrentContext.mockReturnValue({ context: 'group', groupId: 'G1' });
    const { following, groupNav } = await bootThroughGroupInviteRedemption(
      { ok: true, groupId: 'G1', groupName: 'Family' },
    );

    expect(groupNav.navigateToGroup).toHaveBeenCalledWith('G1');
    // Splash stays dismissed (the group context owns its own reveal) and the
    // cold-gating callbacks are never registered.
    expect(splashFading()).toBe(true);
    expect(following.setFollowingListReadyCallback).not.toHaveBeenCalled();
  });

  test('normal boot (identity already on device) keeps the local-cache gating and never registers the server-list callbacks', async () => {
    const identity = require('../js/identity.js');
    identity.loadIdentity.mockReturnValue(IDENTITY);

    require('../js/app');
    await flush();

    const me = require('../js/me.js');
    const following = require('../js/following.js');
    const groupNav = require('../js/groupNav.js');
    expect(following.setFollowingListReadyCallback).not.toHaveBeenCalled();
    expect(groupNav.setGroupsReadyCallback).not.toHaveBeenCalled();

    // Local cache says 0 followees → own-status ready alone reveals (unchanged
    // pre-existing behavior for a warm-cache boot).
    const ownReady = me.setOwnStatusReadyCallback.mock.calls.at(-1)[0];
    ownReady();
    expect(splashFading()).toBe(true);
  });
});
