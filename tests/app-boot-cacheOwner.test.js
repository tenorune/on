// tests/app-boot-cacheOwner.test.js
//
// Focused test for the boot-time cache-owner guard wiring in app.js main():
// when ensureCacheOwner() reports it wiped another account's cache, boot must
// resetThemeVars() so the CSS vars the inline theme-restore script already
// painted (from the PREVIOUS owner's now-wiped statusapp_theme) don't survive
// the whole session. Regression: after a Telegram unlink the fresh derived
// account kept the old linked account's theme (status color reset, theme
// didn't) because nothing downstream re-derives theme vars when the server
// state is "no palette" (app.js's own-status watcher sees null === null and
// skips resetThemeVars).
//
// Strategy (mirrors tests/app-call-recovery.test.js): mock identity.js so
// ensureIdentity() resolves immediately with userId 'me', mock every other
// module main() touches, run the REAL cacheOwner.js against jsdom
// localStorage, and assert on the palettes.js resetThemeVars mock.

const IDENTITY = { userId: 'me', code: 'MYCODE', recoveryCode: 'a-b-c-d' };

// Stub the hint-rotation engine: app.js calls initHintRotation() at boot (see
// the app-call-recovery suite's note — boot suites must mock this or main()
// throws).
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
  getCurrentContextPref: jest.fn().mockResolvedValue(null),
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
  CALL_ENABLED: false,
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

jest.mock('../js/telegram.js', () => ({
  isTelegramContext: jest.fn(() => false),
  ensureTelegramIdentity: jest.fn(),
  isTelegramLinked: jest.fn(() => false),
  telegramFirstName: jest.fn(() => ''),
}));

// Boot app.js fresh (all mocks in place) and drain the microtask queue so
// main() runs past ensureCacheOwner.
async function bootApp() {
  require('../js/app');
  await new Promise((r) => setTimeout(r, 0));
}

describe('app.js boot: cache-owner switch resets theme vars', () => {
  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    document.body.innerHTML = '';
  });

  test('owner change at boot → resetThemeVars() (wiped theme cache must not linger in the DOM)', async () => {
    // The previous session on this origin belonged to a different account
    // (e.g. a linked phrase account before a Telegram unlink).
    localStorage.setItem('statusapp_cache_owner', 'previous-account');
    localStorage.setItem('statusapp_theme', '{"bg":"#1a0f2e"}');

    await bootApp();

    const { resetThemeVars } = require('../js/palettes.js');
    expect(resetThemeVars).toHaveBeenCalled();
    // And the wipe itself happened (real cacheOwner ran).
    expect(localStorage.getItem('statusapp_theme')).toBeNull();
    expect(localStorage.getItem('statusapp_cache_owner')).toBe('me');
  });

  test('same owner at boot → no theme reset', async () => {
    localStorage.setItem('statusapp_cache_owner', 'me');
    localStorage.setItem('statusapp_theme', '{"bg":"#1a0f2e"}');

    await bootApp();

    const { resetThemeVars } = require('../js/palettes.js');
    expect(resetThemeVars).not.toHaveBeenCalled();
    expect(localStorage.getItem('statusapp_theme')).toBe('{"bg":"#1a0f2e"}');
  });

  test('first run (no owner marker) → adopt without wiping or resetting', async () => {
    localStorage.setItem('statusapp_theme', '{"bg":"#1a0f2e"}');

    await bootApp();

    const { resetThemeVars } = require('../js/palettes.js');
    expect(resetThemeVars).not.toHaveBeenCalled();
    expect(localStorage.getItem('statusapp_theme')).toBe('{"bg":"#1a0f2e"}');
    expect(localStorage.getItem('statusapp_cache_owner')).toBe('me');
  });
});

describe('app.js boot: Telegram boot failure shows the retry overlay (W1 J#2)', () => {
  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    document.body.innerHTML = `
      <div id="boot-error-overlay" class="modal-overlay hidden" role="dialog" aria-modal="true">
        <div class="modal-card modal-card-small">
          <p>Couldn't start KnockKnock.</p>
          <div class="modal-actions">
            <button id="boot-error-retry" class="primary-btn" type="button">Try again</button>
          </div>
        </div>
      </div>
    `;
  });

  test('telegram boot failure shows the retry overlay, not just a toast', async () => {
    const telegram = require('../js/telegram.js');
    telegram.isTelegramContext.mockReturnValue(true);
    telegram.ensureTelegramIdentity.mockRejectedValue(new Error('boom'));
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await bootApp();

    expect(consoleErrorSpy).toHaveBeenCalledWith('telegram boot failed:', expect.any(Error));
    const overlay = document.getElementById('boot-error-overlay');
    expect(overlay.classList.contains('hidden')).toBe(false);

    // "Try again" reloads. jsdom's window.location.reload is a non-configurable
    // no-op that cannot be spied on (see tests/graduation.test.js) — asserting
    // the click doesn't throw is the closest we can get to verifying the
    // reload wiring without a real navigation.
    expect(() => document.getElementById('boot-error-retry').click()).not.toThrow();

    consoleErrorSpy.mockRestore();
  });

  // W1 J#2 (completion): a boot failure AFTER ensureTelegramIdentity resolves
  // (but before initSplash's 3s fallback near the end of main()) used to leave
  // the user stuck on the splash — main().catch(console.error) only logged.
  // initOwnStatus runs synchronously right after identity resolves (app.js
  // main(), ~L571), before initNav/initPrefs/the splash timer, so forcing it
  // to throw is the cleanest way to exercise a genuinely post-identity failure
  // through the real main().catch wiring (not a direct unit call).
  test('post-identity boot failure (main() throws after identity resolves) shows the retry overlay', async () => {
    const telegram = require('../js/telegram.js');
    telegram.isTelegramContext.mockReturnValue(true);
    telegram.ensureTelegramIdentity.mockResolvedValue({ identity: IDENTITY, isNew: false });
    const { initOwnStatus } = require('../js/ownStatus.js');
    initOwnStatus.mockImplementation(() => { throw new Error('post-identity boom'); });
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await bootApp();

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(Error));
    const overlay = document.getElementById('boot-error-overlay');
    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(() => document.getElementById('boot-error-retry').click()).not.toThrow();

    consoleErrorSpy.mockRestore();
  });
});

describe('app.js boot: invite redemption carries the redeemer name', () => {
  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    document.body.innerHTML = '';
  });

  test('passes the Telegram first name as redeemerName so the inviter names the follower', async () => {
    const invites = require('../js/invites.js');
    const telegram = require('../js/telegram.js');
    invites.extractInviteTokenFromUrl.mockReturnValue('TOKEN');
    telegram.telegramFirstName.mockReturnValue('Bea');

    await bootApp();

    expect(invites.attemptRedeemFromUrl).toHaveBeenCalledWith(
      'TOKEN', 'me', 'MYCODE', { redeemerName: 'Bea' },
    );
  });

  test('web invite (no Telegram name) redeems with an empty redeemerName', async () => {
    const invites = require('../js/invites.js');
    const telegram = require('../js/telegram.js');
    invites.extractInviteTokenFromUrl.mockReturnValue('TOKEN');
    telegram.telegramFirstName.mockReturnValue('');

    await bootApp();

    expect(invites.attemptRedeemFromUrl).toHaveBeenCalledWith(
      'TOKEN', 'me', 'MYCODE', { redeemerName: '' },
    );
  });
});

// Task 13c: startSubscriptions used to call touchLastSeen(userId) on every
// app open unconditionally, ticking every follower's presence watcher just
// from a re-open. Gated behind a per-device localStorage stamp (30 min)
// since real availability changes still stamp lastSeen via setStatus.
describe('app.js boot: touchLastSeen throttled per-device (Task 13c)', () => {
  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    document.body.innerHTML = '';
  });

  test('two boots inside the 30-min window: touchLastSeen fires on the first boot, not the second', async () => {
    await bootApp();
    const db1 = require('../js/db.js');
    expect(db1.touchLastSeen).toHaveBeenCalledTimes(1);

    // Simulate a second app open on the SAME device shortly after (fresh JS
    // context/module registry, same localStorage) — must be throttled.
    jest.resetModules();
    document.body.innerHTML = '';
    await bootApp();
    const db2 = require('../js/db.js');
    expect(db2.touchLastSeen).not.toHaveBeenCalled();
  });

  test('a boot after the 30-min window calls touchLastSeen again', async () => {
    await bootApp();
    const key = 'statusapp_lastseen_touched';
    const stamp = Number(localStorage.getItem(key));
    expect(stamp).toBeGreaterThan(0);
    localStorage.setItem(key, String(stamp - 31 * 60 * 1000)); // simulate 31 minutes elapsed

    jest.resetModules();
    document.body.innerHTML = '';
    await bootApp();
    const db2 = require('../js/db.js');
    expect(db2.touchLastSeen).toHaveBeenCalledTimes(1);
  });
});
