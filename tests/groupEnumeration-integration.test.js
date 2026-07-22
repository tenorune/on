// tests/groupEnumeration-integration.test.js
//
// Task 12: groupNav.ts and groups.ts each used to open their own
// watchUserGroups(uid, ...) listen on users/{uid}/groups. This suite loads
// BOTH real modules (only db.js and other leaf deps are mocked — groupNav.js
// and groups.js are NOT mocked against each other, since the whole point is
// to exercise the real wiring between them) and asserts:
//   (a) after both init functions have run, db.watchUserGroups was called
//       exactly ONCE — the removal detector rides groupNav's enumeration
//       fan-out (subscribeGroupEnumeration) instead of opening a second one.
//   (b) a real enumeration tick reaches the removal detector through that
//       fan-out (a removed group triggers the removal toast).
//   (c) if groupNav's enumeration has already ticked (_enumTicked) by the
//       time the removal detector subscribes, subscribeGroupEnumeration
//       replays the current enumeration synchronously — and the detector's
//       existing _prevEnum === null first-tick-skip logic treats that
//       replay as its baseline (no spurious removal fires on the very next
//       real change).
jest.mock('../js/notifyPrompt.js', () => ({ requestPermissionAndRegister: jest.fn() }));
jest.mock('../js/ownStatus.js', () => ({
  initOwnStatus: jest.fn(),
  subscribeOwnStatus: jest.fn(() => () => {}),
}));
jest.mock('../js/db.js', () => ({
  isAvailable: (s, t) => s === 'available' && !(t !== null && t !== undefined && t < Date.now()),
  setLastVisited: jest.fn().mockResolvedValue(undefined),
  watchUserGroups: jest.fn(),
  watchGroupMeta: jest.fn(() => () => {}),
  readMembers: jest.fn().mockResolvedValue({}),
  watchOwnMemberOverride: jest.fn(() => () => {}),
  watchStatus: jest.fn(() => () => {}),
  removeUserGroupsEntry: jest.fn().mockResolvedValue(undefined),
  watchPendingInvites: jest.fn(() => () => {}),
  writePendingInvite: jest.fn().mockResolvedValue(undefined),
  deletePendingInvite: jest.fn().mockResolvedValue(undefined),
  readPendingInviteesForGroup: jest.fn().mockResolvedValue([]),
  // groups.ts's own db surface
  claimGroupId: jest.fn(),
  writeGroup: jest.fn(),
  writeMember: jest.fn(),
  writeUserGroupsEntry: jest.fn(),
  removeMember: jest.fn(),
  deleteGroup: jest.fn(),
  renameGroup: jest.fn(),
  setMemberDisplayName: jest.fn(),
  readGroup: jest.fn().mockResolvedValue(null),
  readGroupName: jest.fn().mockResolvedValue(null),
  readMember: jest.fn().mockResolvedValue(null),
  mergeStatusOverride: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../js/prefs.js', () => ({
  setCurrentContext: jest.fn(),
  clearGroupPaletteState: jest.fn(),
}));
jest.mock('../js/inbox.js', () => ({
  renderInboxNavSlot: jest.fn(),
}));
jest.mock('../js/features.js', () => ({ GROUPS_ENABLED: true }));
jest.mock('../js/inviteModal.js', () => ({
  openInviteModal: jest.fn(),
}));
jest.mock('../js/following.js', () => ({
  getCurrentFollowersMap: jest.fn(() => ({})),
  getCurrentMutuals: jest.fn(() => []),
}));
jest.mock('../js/firebase-config.js', () => ({
  callJoinGroup: jest.fn(),
}));
jest.mock('../js/statusStore.js', () => ({
  __esModule: true,
  initStatusStore: jest.fn(),
  setWatchedGroups: jest.fn(),
  getOwnOverride: jest.fn(() => null),
  pushOptimistic: jest.fn(),
  subscribeOwnOverride: jest.fn(() => () => {}),
}));

const db = require('../js/db.js');
const groupNav = require('../js/groupNav.js');
const groups = require('../js/groups.js');

function setupDom() {
  document.body.innerHTML = `
    <div id="nav-row" class="nav-row hidden"></div>
    <div id="main-ui-direct"></div>
    <div id="group-context-root" class="hidden"></div>
    <div id="create-group-modal" class="hidden"></div>
    <div id="group-removal-toast" class="hidden">
      <span id="group-removal-toast-text"></span>
      <button id="group-removal-toast-dismiss"></button>
    </div>
  `;
}

function flushPromises() { return new Promise(setImmediate); }

describe('groupNav enumeration fan-out -> groups.js removal detector (one listen)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupDom();
    groups._resetGroupRemovalDetectorForTests();
  });

  test('boot order (initNav -> startCardsRowSubscriptions -> initGroupRemovalDetector) opens exactly one watchUserGroups listen', () => {
    let enumCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });

    groupNav.initNav('me');
    groupNav.initNavRow();
    groupNav.startCardsRowSubscriptions();
    groups.initGroupRemovalDetector('me');

    expect(db.watchUserGroups).toHaveBeenCalledTimes(1);
    expect(typeof enumCb).toBe('function');
  });

  test('a removal seen through the fan-out (no second watch) fires the removal toast', async () => {
    let enumCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.readGroupName.mockResolvedValue(null);

    groupNav.initNav('me');
    groupNav.initNavRow();
    groupNav.startCardsRowSubscriptions();
    groups.initGroupRemovalDetector('me');

    // First tick: baseline (G1 + G2 enumerated).
    enumCb({ G1: { lastVisited: 1 }, G2: { lastVisited: 2 } });
    // Second tick: G1 removed.
    enumCb({ G2: { lastVisited: 2 } });
    await flushPromises();

    expect(document.getElementById('group-removal-toast').classList.contains('hidden')).toBe(false);
    expect(db.watchUserGroups).toHaveBeenCalledTimes(1);
  });

  test('late subscribe after groupNav has already ticked replays as the detector\'s baseline (no spurious removal)', async () => {
    let enumCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.readGroupName.mockResolvedValue(null);

    groupNav.initNav('me');
    groupNav.initNavRow();
    groupNav.startCardsRowSubscriptions();
    // groupNav's first server tick lands BEFORE the removal detector subscribes.
    enumCb({ G1: { lastVisited: 1 } });

    groups.initGroupRemovalDetector('me');
    await flushPromises();
    // The replay is the detector's baseline tick — must not read as "G1 removed".
    expect(document.getElementById('group-removal-toast').classList.contains('hidden')).toBe(true);

    // Now a real removal should fire normally against that baseline.
    enumCb({});
    await flushPromises();
    expect(document.getElementById('group-removal-toast').classList.contains('hidden')).toBe(false);
    expect(db.watchUserGroups).toHaveBeenCalledTimes(1);
  });
});
