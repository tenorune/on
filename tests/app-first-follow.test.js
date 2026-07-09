// tests/app-first-follow.test.js
//
// Focused test for J#15: the one-time "tap to knock" beat in app.js's
// handleInviteRedemptionResult. After a newcomer's FIRST successful personal
// invite redemption (a follow — a contact silently appears with no beat
// pointing at the knock loop today), show a one-time toast naming the person
// followed. Gated by a sessionStorage marker (kk-first-follow) so it fires
// once per session and never again — including on a group-join success,
// which has no single contact card to "tap ... to knock" on.
//
// Strategy mirrors tests/app-call-recovery.test.js: mock every module app.js
// imports so `require('../js/app')` (which runs main() as an import side
// effect) doesn't throw, then call the exported handleInviteRedemptionResult
// directly — it's synchronous, so there's no need to await main()'s boot
// sequence to observe its effects.

const IDENTITY = { userId: 'me', code: 'MYCODE', recoveryCode: 'a-b-c-d' };

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

jest.mock('../js/installAffordance.js', () => ({
  initInstallAffordance: jest.fn(),
}));

jest.mock('../js/notifyDebug.js', () => ({
  initNotifyDebug: jest.fn(),
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
  navigateToDirect: jest.fn(),
  setLastKnownGroupName: jest.fn(),
  getCurrentContext: jest.fn(() => ({ context: 'direct' })),
}));

jest.mock('../js/notifyRouting.js', () => ({
  routeNotificationClick: jest.fn(),
}));

jest.mock('../js/ownStatus.js', () => ({
  initOwnStatus: jest.fn(),
  subscribeOwnStatus: jest.fn(),
}));

jest.mock('../js/groupContext.js', () => ({
  enterGroupContext: jest.fn(),
  exitGroupContext: jest.fn(),
}));

// showToast is the toast helper under test — kept as a real jest.fn() (not a
// DOM-touching real implementation) so we can assert on exactly what
// handleInviteRedemptionResult passes it.
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

// telegram.js imports firebase/auth directly (not through js/auth.js's mock
// above), so without this it drags the real firebase/auth module into jsdom.
jest.mock('../js/telegram.js', () => ({
  isTelegramContext: jest.fn(() => false),
  ensureTelegramIdentity: jest.fn(),
  isTelegramLinked: jest.fn(() => false),
  telegramFirstName: jest.fn(() => ''),
}));

jest.mock('../js/telegramChrome.js', () => ({
  initTelegramChrome: jest.fn(),
}));

jest.mock('../js/telegramFirstRun.js', () => ({
  telegramInviteGate: jest.fn().mockResolvedValue(null),
  stampInviteOutcome: jest.fn(),
  redemptionConsumedToken: jest.fn(() => false),
}));

jest.mock('../js/cacheOwner.js', () => ({
  ensureCacheOwner: jest.fn(() => false),
}));

jest.mock('../js/telegramSettings.js', () => ({
  initTelegramSettings: jest.fn(),
  showLinkScreen: jest.fn(),
}));

jest.mock('../js/graduation.js', () => ({
  showGraduationInfo: jest.fn(),
}));

jest.mock('../js/notifyChannel.js', () => ({
  syncNotifyChannel: jest.fn(),
}));

jest.mock('../js/notifySuppression.js', () => ({
  syncBotDelivery: jest.fn(),
}));

jest.mock('../js/firstRun.js', () => ({
  initFirstRun: jest.fn(),
  consumeGraduationNotice: jest.fn(() => null),
}));

jest.mock('../js/recoveryModal.js', () => ({
  showRecoveryCodeModal: jest.fn(),
}));

// ---- Helpers ----

function loadApp() {
  return require('../js/app');
}

// ---- Tests ----

describe('app.js: J#15 first-accept "tap to knock" beat', () => {
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    sessionStorage.clear();
  });

  test('first newcomer accept shows the tap-to-knock beat once', () => {
    const { handleInviteRedemptionResult } = loadApp();
    const { showToast } = require('../js/groups.js');

    const beatShown = handleInviteRedemptionResult({ ok: true, creatorUid: 'u1', creatorCode: 'U1CODE', creatorLabel: 'Ana' });

    expect(showToast).toHaveBeenCalledWith("You're following Ana — tap their card to knock.");
    expect(sessionStorage.getItem('kk-first-follow')).toBeTruthy();
    expect(beatShown).toBe(true);
  });

  test('subsequent accept with the marker already set shows no beat', () => {
    sessionStorage.setItem('kk-first-follow', '1');
    const { handleInviteRedemptionResult } = loadApp();
    const { showToast } = require('../js/groups.js');

    const beatShown = handleInviteRedemptionResult({ ok: true, creatorUid: 'u2', creatorCode: 'U2CODE', creatorLabel: 'Bo' });

    expect(showToast).not.toHaveBeenCalledWith("You're following Bo — tap their card to knock.");
    expect(showToast).not.toHaveBeenCalled();
    expect(beatShown).toBe(false);
  });

  test('a group-join success does not fire the beat (no single contact card to tap)', () => {
    const { handleInviteRedemptionResult } = loadApp();
    const { showToast } = require('../js/groups.js');

    const beatShown = handleInviteRedemptionResult({ ok: true, groupId: 'g1', groupName: 'Family' });

    expect(showToast).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('kk-first-follow')).toBeFalsy();
    expect(beatShown).toBe(false);
  });

  test('a failed redemption does not fire the beat', () => {
    const { handleInviteRedemptionResult } = loadApp();
    const { showToast } = require('../js/groups.js');

    const beatShown = handleInviteRedemptionResult({ ok: false, reason: 'expired' });

    expect(showToast).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('kk-first-follow')).toBeFalsy();
    expect(beatShown).toBe(false);
  });
});

describe('app.js: call-site reconciliation of the beat vs. the Telegram silent-redeem toast', () => {
  // Regression coverage for the review-flagged gap: main()'s redemption
  // block calls handleInviteRedemptionResult(result) and then, on a
  // Telegram-silent redemption, may call a second confirm toast. Driving
  // main() itself is impractical here (it's an unexported async function
  // wired to the full boot sequence covered by app-boot-mocks
  // conventions elsewhere), so this exercises the real call-site sequence
  // by calling the two exported pieces in the exact order main() does:
  // handleInviteRedemptionResult(result), capture its return, then
  // reconcileSilentRedeemToast(result, tgInvite, beatShown) — the actual
  // reconciliation logic factored out of the call site, not a
  // reimplementation of it. This is the seam that lets a test observe the
  // double-toast/gate-burn interaction without duplicating main()'s wiring.
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    sessionStorage.clear();
  });

  test('first personal silent follow: exactly the beat toast, marker set', () => {
    const { handleInviteRedemptionResult, reconcileSilentRedeemToast } = loadApp();
    const { showToast } = require('../js/groups.js');
    const result = { ok: true, creatorUid: 'u1', creatorCode: 'U1CODE', creatorLabel: 'Ana' };
    const tgInvite = { silent: true, preview: { scope: 'personal', label: 'Ana' } };

    const beatShown = handleInviteRedemptionResult(result);
    reconcileSilentRedeemToast(result, tgInvite, beatShown);

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("You're following Ana — tap their card to knock.");
    expect(sessionStorage.getItem('kk-first-follow')).toBeTruthy();
  });

  test('silent group join shows "You joined X." (beat never applies to groups)', () => {
    const { handleInviteRedemptionResult, reconcileSilentRedeemToast } = loadApp();
    const { showToast } = require('../js/groups.js');
    const result = { ok: true, groupId: 'g1', groupName: 'Family' };
    const tgInvite = { silent: true, preview: { scope: 'group', groupName: 'Family' } };

    const beatShown = handleInviteRedemptionResult(result);
    reconcileSilentRedeemToast(result, tgInvite, beatShown);

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('You joined Family.');
    expect(sessionStorage.getItem('kk-first-follow')).toBeFalsy();
  });

  test('second silent personal follow (marker already set) shows "You\'re now following X."', () => {
    sessionStorage.setItem('kk-first-follow', '1');
    const { handleInviteRedemptionResult, reconcileSilentRedeemToast } = loadApp();
    const { showToast } = require('../js/groups.js');
    const result = { ok: true, creatorUid: 'u2', creatorCode: 'U2CODE', creatorLabel: 'Bo' };
    const tgInvite = { silent: true, preview: { scope: 'personal', label: 'Bo' } };

    const beatShown = handleInviteRedemptionResult(result);
    reconcileSilentRedeemToast(result, tgInvite, beatShown);

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("You're now following Bo.");
  });

  test('non-silent (web) path: beat only, no second toast, since tgInvite is absent', () => {
    const { handleInviteRedemptionResult, reconcileSilentRedeemToast } = loadApp();
    const { showToast } = require('../js/groups.js');
    const result = { ok: true, creatorUid: 'u3', creatorCode: 'U3CODE', creatorLabel: 'Cy' };
    const tgInvite = null;

    const beatShown = handleInviteRedemptionResult(result);
    reconcileSilentRedeemToast(result, tgInvite, beatShown);

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("You're following Cy — tap their card to knock.");
  });
});
