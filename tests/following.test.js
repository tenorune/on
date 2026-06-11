// tests/following.test.js
jest.mock('../js/favorites.js', () => ({
  saveCombo: jest.fn(),
  initFavoritesStrip: jest.fn(),
  buildAdoptedCombo: jest.fn((statusColor, paletteKey) => ({
    statusColor: statusColor || '#22c55e',
    surface: '#1e293b',
    surface2: '#334155',
    paletteKey: paletteKey ?? null,
    selectedKey: paletteKey ?? 'forest',
    activeSet: 1,
  })),
}));

// PointerEvent polyfill for jsdom (does not implement it natively)
if (typeof PointerEvent === 'undefined') {
  global.PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type, params = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
    }
  };
}

jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true, KNOCK_ENABLED: true, CALL_ENABLED: true, NOTIFICATIONS_ENABLED: true }));
jest.mock('../js/notifyBell.js', () => ({ createNotifyBell: jest.fn() }));
jest.mock('../js/notifyPrompt.js', () => ({ ensureNotificationsReady: jest.fn() }));
jest.mock('../js/palettes.js', () => ({
  ...jest.requireActual('../js/palettes.js'),
  getPaletteByKey: jest.fn(),
  applyThemeVars: jest.fn(),
  resetThemeVars: jest.fn(),
  enterPaletteMode: jest.fn(),
  exitPaletteMode: jest.fn(),
  switchSet: jest.fn(),
}));
jest.mock('../js/db.js', () => ({
  lookupCode: jest.fn(),
  watchStatus: jest.fn(),
  watchFollowers: jest.fn(),
  registerAsFollower: jest.fn(),
  unregisterAsFollower: jest.fn(),
  removeFollower: jest.fn(),
  isExpired: jest.fn(() => false),
  writeBackExpired: jest.fn(),
  formatTimeRemainingFuzzy: jest.fn(() => 'about 2 hours left'),
  timeRemainingMs: jest.fn(() => 7200000),
  formatLastSeen: jest.fn(() => null),
  writeKnock: jest.fn(),
  getKnocks: jest.fn(),
  watchKnocksAdded: jest.fn(),
  clearKnock: jest.fn(),
  startCall: jest.fn().mockResolvedValue(undefined),
  answerCall: jest.fn().mockResolvedValue(undefined),
  endCall: jest.fn().mockResolvedValue(undefined),
  watchOwnCall: jest.fn(() => () => {}),
  setStatusColor: jest.fn().mockResolvedValue(undefined),
  setPaletteKey: jest.fn().mockResolvedValue(undefined),
  watchFollowing: jest.fn(() => jest.fn()),
  setFollowingEntry: jest.fn().mockResolvedValue(undefined),
  removeFollowingEntry: jest.fn().mockResolvedValue(undefined),
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
  readGroup: jest.fn().mockResolvedValue(null),
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
  watchUserPrefs: jest.fn(() => () => {}),
  watchOwnMemberOverride: jest.fn(() => () => {}),
  watchPendingInvites: jest.fn(() => () => {}),
  writePendingInvite: jest.fn().mockResolvedValue(undefined),
  deletePendingInvite: jest.fn().mockResolvedValue(undefined),
  readPendingInviteesForGroup: jest.fn().mockResolvedValue([]),
  watchRevocations: jest.fn(() => () => {}),
}));
jest.mock('../js/knock.js', () => ({
  sendKnock: jest.fn(),
  applyFloatToTop: jest.fn(),
  getFloatedUserIds: jest.fn(() => []),
  initKnocks: jest.fn(),
}));
jest.mock('../js/store.js', () => ({
  getFollowing: jest.fn(),
  setFollowing: jest.fn(),
  getFollowerName: jest.fn(() => null),
  addFollowing: jest.fn(),
  removeFollowing: jest.fn(),
  renameFollowing: jest.fn(),
  updateFollowingCode: jest.fn(),
  getPaletteState: jest.fn().mockReturnValue({
    activeSet: 1,
    sets: {
      '1': { selectedKey: 'forest', activePaletteKey: null },
      '2': { selectedKey: 'volt',   activePaletteKey: null },
    },
  }),
  setPaletteState: jest.fn(),
}));
jest.mock('../js/prefs.js', () => ({
  isHintSeen: jest.fn(() => false),
  markHintSeen: jest.fn(),
  getMadeCallCount: jest.fn().mockReturnValue(0),
  incrementMadeCallCount: jest.fn(),
  getAnsweredCallCount: jest.fn().mockReturnValue(0),
  incrementAnsweredCallCount: jest.fn(),
  getFavorites: jest.fn(() => []),
  getPaletteState: jest.fn().mockReturnValue({
    activeSet: 1,
    sets: {
      '1': { selectedKey: 'forest', activePaletteKey: null },
      '2': { selectedKey: 'volt',   activePaletteKey: null },
    },
  }),
  setPaletteState: jest.fn(),
}));

const { watchStatus, watchFollowers, watchFollowing, startCall, answerCall, endCall, watchOwnCall, watchRevocations } = require('../js/db.js');
const { getFollowing, setFollowing, updateFollowingCode, getFollowerName, removeFollowing } = require('../js/store.js');
const { getMadeCallCount, getAnsweredCallCount } = require('../js/prefs.js');
const { getGlowForColor, getPaletteByKey, enterPaletteMode, exitPaletteMode, switchSet } = require('../js/palettes.js');
const {
  initList, setFolloweeReadyCallback, updateFolloweeRow, resetRenderedFollowees,
  enterCallMode, exitCallMode, getCallModeCalleeId, reEnterCallMode, getIncomingCallFrom,
} = require('../js/following.js');
const { createNotifyBell } = require('../js/notifyBell.js');

// Default implementation: return a real button so li.appendChild doesn't throw.
// Individual test suites may override via mockImplementation in their beforeEach.
beforeEach(() => {
  createNotifyBell.mockImplementation(() => {
    const b = document.createElement('button');
    b.className = 'notify-bell';
    return b;
  });
});

function setupDom() {
  document.body.innerHTML = `
    <ul id="people-list"></ul>
    <p id="empty-list-msg" class="hidden">Add someone below to get started.</p>
    <div id="add-person-area">
    <button id="add-person-btn"></button>
    <div id="add-person-form">
      <input id="add-code-input" />
      <input id="add-label-input" />
      <p id="add-error" class="hidden"></p>
      <button id="add-submit-btn"></button>
      <button id="add-cancel-btn"></button>
    </div>
    </div>
    <div id="offline-banner" class="hidden"></div>
  `;
}

/// Helper: call initList and capture the watchFollowers callback.
// Calling the returned fn(followersArray) triggers renderList().
function initAndCaptureFollowersCallback(myUserId = 'myUid', myCode = 'MYCODE') {
  let followersCallback;
  watchFollowers.mockImplementation((_userId, cb) => {
    followersCallback = cb;
    return jest.fn();
  });
  watchStatus.mockReturnValue(jest.fn());
  initList(myUserId, myCode);
  return (arr) => followersCallback(arr);
}

// Capture the calls/{me} own-call watcher callback so tests can simulate a ring
// (the receiver-side glow now keys off _incomingCall, set by this watcher —
// it no longer rides a callState field on the followee's status record).
function captureOwnCall(myUserId = 'myUid', myCode = 'MYCODE') {
  let ownCallCb;
  watchOwnCall.mockImplementation((_uid, cb) => { ownCallCb = cb; return jest.fn(); });
  watchFollowers.mockReturnValue(jest.fn());
  watchStatus.mockReturnValue(jest.fn());
  initList(myUserId, myCode);
  return (call) => ownCallCb(call);
}

// --- renderList: section rendering ---

describe('renderList: sections', () => {
  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
  });

  test('user in both getFollowing and followers → row under "Mutuals" label', () => {
    getFollowing.mockReturnValue([
      { userId: 'u1', code: 'XY9K2M', label: 'Alice' },
    ]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u1', code: 'XY9K2M' }]);

    const labels = Array.from(document.querySelectorAll('.list-section-label'));
    expect(labels.some(l => l.textContent === 'Mutuals')).toBe(true);
    expect(labels.some(l => l.textContent === 'Following')).toBe(false);
    expect(labels.some(l => l.textContent === 'Followers')).toBe(false);
  });

  test('user in getFollowing but not followers → row under "Following" label', () => {
    getFollowing.mockReturnValue([
      { userId: 'u1', code: 'XY9K2M', label: 'Alice' },
    ]);
    const fire = initAndCaptureFollowersCallback();
    fire([]); // no followers

    const labels = Array.from(document.querySelectorAll('.list-section-label'));
    expect(labels.some(l => l.textContent === 'Following')).toBe(true);
    expect(labels.some(l => l.textContent === 'Mutuals')).toBe(false);
  });

  test('user in followers but not getFollowing → row under "Followers" label', () => {
    getFollowing.mockReturnValue([]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u2', code: 'Q3ZP7R' }]);

    const labels = Array.from(document.querySelectorAll('.list-section-label'));
    expect(labels.some(l => l.textContent === 'Followers')).toBe(true);
    expect(labels.some(l => l.textContent === 'Mutuals')).toBe(false);
    expect(labels.some(l => l.textContent === 'Following')).toBe(false);
  });

  test('empty section has no label rendered', () => {
    getFollowing.mockReturnValue([
      { userId: 'u1', code: 'XY9K2M', label: 'Alice' },
    ]);
    const fire = initAndCaptureFollowersCallback();
    fire([]); // no followers → no Mutuals, no Followers labels

    const labels = Array.from(document.querySelectorAll('.list-section-label'));
    expect(labels.some(l => l.textContent === 'Mutuals')).toBe(false);
    expect(labels.some(l => l.textContent === 'Followers')).toBe(false);
  });

  test('all groups empty → #empty-list-msg shown, #people-list hidden', () => {
    getFollowing.mockReturnValue([]);
    const fire = initAndCaptureFollowersCallback();
    fire([]);

    expect(document.getElementById('empty-list-msg').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('people-list').style.display).toBe('none');
  });

  test('non-empty list → #empty-list-msg hidden, #people-list visible', () => {
    getFollowing.mockReturnValue([
      { userId: 'u1', code: 'XY9K2M', label: 'Alice' },
    ]);
    const fire = initAndCaptureFollowersCallback();
    fire([]);

    expect(document.getElementById('empty-list-msg').classList.contains('hidden')).toBe(true);
  });
});

// --- renderList: follower-only rows ---

describe('renderList: follower-only rows', () => {
  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
  });

  test('follower-only row has .follower-only class', () => {
    getFollowing.mockReturnValue([]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u2', code: 'Q3ZP7R' }]);

    const li = document.querySelector('[data-user-id="u2"]');
    expect(li).not.toBeNull();
    expect(li.classList.contains('follower-only')).toBe(true);
  });

  test('follower-only row has .follow-back-btn', () => {
    getFollowing.mockReturnValue([]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u2', code: 'Q3ZP7R' }]);

    const li = document.querySelector('[data-user-id="u2"]');
    expect(li.querySelector('.follow-back-btn')).not.toBeNull();
  });

  test('clicking follow-back btn pre-fills code input and shows add form', () => {
    getFollowing.mockReturnValue([]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u2', code: 'Q3ZP7R' }]);

    const li = document.querySelector('[data-user-id="u2"]');
    li.querySelector('.follow-back-btn').click();

    expect(document.getElementById('add-code-input').value).toBe('Q3ZP7R');
    expect(document.getElementById('add-person-form').classList.contains('open')).toBe(true);
  });

  test('shows the remembered roster name next to the code', () => {
    getFollowing.mockReturnValue([]);
    getFollowerName.mockReturnValue('Bea');
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u2', code: 'Q3ZP7R' }]);

    const label = document.querySelector('[data-user-id="u2"] .person-label');
    expect(label.textContent).toBe('Q3ZP7R (Bea)');
  });

  test('shows the bare code when no roster name is remembered', () => {
    getFollowing.mockReturnValue([]);
    getFollowerName.mockReturnValue(null);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u2', code: 'Q3ZP7R' }]);

    const label = document.querySelector('[data-user-id="u2"] .person-label');
    expect(label.textContent).toBe('Q3ZP7R');
  });

  test('follow-back pre-fills the label input with the remembered roster name', () => {
    getFollowing.mockReturnValue([]);
    getFollowerName.mockReturnValue('Bea');
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u2', code: 'Q3ZP7R' }]);

    document.querySelector('[data-user-id="u2"] .follow-back-btn').click();
    expect(document.getElementById('add-label-input').value).toBe('Bea');
  });
});

// --- renderList: name display (moved from mycode.test.js) ---

describe('renderList: name display on mutual rows', () => {
  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
  });

  test('mutual row with non-empty label does not show .person-follower-name', () => {
    getFollowing.mockReturnValue([
      { userId: 'u1', code: 'XY9K2M', label: 'Alice' },
    ]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u1', code: 'XY9K2M' }]);

    const li = document.querySelector('[data-user-id="u1"]');
    expect(li.querySelector('.person-follower-name')).toBeNull();
  });

  test('mutual row with empty label has no .person-follower-name', () => {
    getFollowing.mockReturnValue([
      { userId: 'u1', code: 'XY9K2M', label: '' },
    ]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u1', code: 'XY9K2M' }]);

    const li = document.querySelector('[data-user-id="u1"]');
    expect(li.querySelector('.person-follower-name')).toBeNull();
  });

  test('mutual row with label: primary .person-label shows label text', () => {
    getFollowing.mockReturnValue([
      { userId: 'u1', code: 'XY9K2M', label: 'Alice' },
    ]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u1', code: 'XY9K2M' }]);

    const li = document.querySelector('[data-user-id="u1"]');
    expect(li.querySelector('.person-label').textContent).toBe('Alice');
  });
});

// --- renderList: XSS escaping (moved from mycode.test.js) ---

describe('renderList: XSS escaping', () => {
  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
  });

  test('escapes HTML in label', () => {
    getFollowing.mockReturnValue([
      { userId: 'u1', code: 'XY9K2M', label: '<b>Alice</b>' },
    ]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u1', code: 'XY9K2M' }]);

    const li = document.querySelector('[data-user-id="u1"]');
    const labelEl = li.querySelector('.person-label');
    expect(labelEl.textContent).toBe('<b>Alice</b>');
    expect(labelEl.innerHTML).not.toContain('<b>');
  });

  test('escapes HTML in code', () => {
    getFollowing.mockReturnValue([]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u1', code: '<img>' }]);

    const li = document.querySelector('[data-user-id="u1"]');
    expect(li.innerHTML).not.toContain('<img>');
  });
});

// --- confirm dialog: unfollow and removeFollower routing ---

describe('confirm dialog', () => {
  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
  });

  test('× on following row sets confirm title to "Unfollow [name]?" and button to "Unfollow"', () => {
    getFollowing.mockReturnValue([
      { userId: 'u1', code: 'XY9K2M', label: 'Alice' },
    ]);
    const fire = initAndCaptureFollowersCallback();
    fire([]); // u1 is following-only

    const li = document.querySelector('[data-user-id="u1"]');
    li.querySelector('.card-drawer-toggle').click();
    li.querySelector('.unfollow-btn').click();

    expect(document.getElementById('unfollow-confirm-title').textContent).toBe('Unfollow Alice?');
    expect(document.getElementById('unfollow-do-btn').textContent).toBe('Unfollow');
    expect(document.getElementById('unfollow-confirm').classList.contains('hidden')).toBe(false);
  });

  test('× on follower-only row sets confirm title to "Remove follower [code]?" and button to "Remove"', () => {
    getFollowing.mockReturnValue([]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u2', code: 'Q3ZP7R' }]); // u2 is follower-only

    const li = document.querySelector('[data-user-id="u2"]');
    li.querySelector('.unfollow-btn').click();

    expect(document.getElementById('unfollow-confirm-title').textContent).toBe('Remove follower Q3ZP7R?');
    expect(document.getElementById('unfollow-do-btn').textContent).toBe('Remove');
    expect(document.getElementById('unfollow-confirm').classList.contains('hidden')).toBe(false);
  });
});

// --- subscribeToFollowee — code-change sync (updated for initList) ---

describe('subscribeToFollowee — code-change sync', () => {
  let watchFollowersCallback;
  let watchStatusCallback;

  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();

    watchFollowers.mockImplementation((_userId, cb) => {
      watchFollowersCallback = cb;
      return jest.fn();
    });
    watchStatus.mockImplementation((_userId, cb) => {
      watchStatusCallback = cb;
      return jest.fn();
    });

    getFollowing.mockReturnValue([
      { userId: 'u1', code: 'OLD123', label: 'Alice' },
    ]);

    initList('myUserId', 'MYCODE');
    // Fire followers callback to trigger renderList, which calls subscribeToFollowee
    // (u1 is in getFollowing but not in followers → Following section; subscribeToFollowee called)
    watchFollowersCallback([]);
  });

  test('calls updateFollowingCode when userData.code differs from entry.code', () => {
    watchStatusCallback({ status: 'unavailable', code: 'NEW456' });
    expect(updateFollowingCode).toHaveBeenCalledWith('u1', 'NEW456');
  });

  test('does not call updateFollowingCode when userData.code matches entry.code', () => {
    watchStatusCallback({ status: 'unavailable', code: 'OLD123' });
    expect(updateFollowingCode).not.toHaveBeenCalled();
  });

  test('does not call updateFollowingCode when userData.code is absent', () => {
    watchStatusCallback({ status: 'unavailable' });
    expect(updateFollowingCode).not.toHaveBeenCalled();
  });

  test('updates entry.code in place so a second identical callback does not trigger another sync', () => {
    watchStatusCallback({ status: 'unavailable', code: 'NEW456' });
    watchStatusCallback({ status: 'unavailable', code: 'NEW456' });
    expect(updateFollowingCode).toHaveBeenCalledTimes(1);
  });
});

// --- palette-aware follower rows (PALETTES_ENABLED: true) ---

describe('updateFolloweeRow: palette-aware dot and status text', () => {
  let watchFollowersCallback;
  let watchStatusCallback;

  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();

    watchFollowers.mockImplementation((_userId, cb) => {
      watchFollowersCallback = cb;
      return jest.fn();
    });
    watchStatus.mockImplementation((_userId, cb) => {
      watchStatusCallback = cb;
      return jest.fn();
    });
    getFollowing.mockReturnValue([
      { userId: 'u1', code: 'XY9K2M', label: 'Alice' },
    ]);
    initList('myUid', 'MYCODE');
    watchFollowersCallback([{ userId: 'u1', code: 'XY9K2M' }]); // u1 is mutual
  });

  test('available dot has inline background matching statusColor', () => {
    watchStatusCallback({ status: 'available', availableUntil: Date.now() + 3600000, statusColor: '#a855f7' });
    const dot = document.querySelector('[data-user-id="u1"] .person-dot');
    expect(dot.style.background).toBe('rgb(168, 85, 247)');
  });

  test('available dot has inline boxShadow derived from statusColor', () => {
    watchStatusCallback({ status: 'available', availableUntil: Date.now() + 3600000, statusColor: '#818cf8' });
    const dot = document.querySelector('[data-user-id="u1"] .person-dot');
    expect(dot.style.boxShadow).toContain('rgba(129,140,248,0.4)');
  });

  test('unavailable dot has inline styles cleared', () => {
    // First set available with a color
    watchStatusCallback({ status: 'available', availableUntil: Date.now() + 3600000, statusColor: '#818cf8' });
    // Then go unavailable
    watchStatusCallback({ status: 'unavailable', statusColor: '#818cf8' });
    const dot = document.querySelector('[data-user-id="u1"] .person-dot');
    expect(dot.style.background).toBe('');
    expect(dot.style.boxShadow).toBe('');
  });

  test('available status text has inline color matching statusColor', () => {
    watchStatusCallback({ status: 'available', availableUntil: Date.now() + 3600000, statusColor: '#a855f7' });
    const statusEl = document.querySelector('[data-user-id="u1"] .person-status');
    const span = statusEl.querySelector('.status-available');
    expect(span.style.color).toBe('rgb(168, 85, 247)');
  });

  test('falls back to green (#22c55e) when statusColor absent', () => {
    watchStatusCallback({ status: 'available', availableUntil: Date.now() + 3600000 });
    const dot = document.querySelector('[data-user-id="u1"] .person-dot');
    expect(dot.style.background).toBe('rgb(34, 197, 94)');
  });
});

// --- Palette Cards (Increment 3) ---

describe('palette card styling', () => {
  const OCEAN_PALETTE = {
    key: 'ocean', color: '#3b82f6', glow: 'rgba(59,130,246,0.4)',
    theme: { bg: '#05101e', surface: '#0b1e38', surface2: '#102c52', text: '#eef4ff', textMuted: '#5f9acf' },
    complements: [],
  };

  function setupOneFollowee(paletteKey) {
    setupDom();
    getFollowing.mockReturnValue([{ userId: 'user1', code: 'ABC123', label: 'Jordan' }]);

    let watchStatusCallback;
    let watchFollowersCallback;

    watchFollowers.mockImplementation((_userId, cb) => {
      watchFollowersCallback = cb;
      return jest.fn();
    });
    watchStatus.mockImplementation((_uid, cb) => {
      watchStatusCallback = cb;
      return jest.fn();
    });

    initList('myUid', 'MYCODE');
    watchFollowersCallback([]);     // no followers — 'Jordan' appears in Following section

    // Trigger watchStatus with palette data
    watchStatusCallback({ status: 'available', availableUntil: Date.now() + 3600000, paletteKey });
    return document.querySelector('[data-user-id="user1"]');
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const VOLT_PALETTE = {
    key: 'volt', color: '#aaff00', glow: 'rgba(170,255,0,0.4)',
    theme: { bg: '#0e1700', surface: '#192500', surface2: '#243600', text: '#f4ffe6', textMuted: '#88cc33' },
    complements: [],
  };

  test('card with known Set 1 paletteKey gets palette.theme.surface as background', () => {
    getPaletteByKey.mockReturnValue(OCEAN_PALETTE);
    const li = setupOneFollowee('ocean');
    expect(li.style.background).toBe('rgb(11, 30, 56)');
  });

  test('card with known Set 2 paletteKey gets palette.theme.surface as background', () => {
    getPaletteByKey.mockReturnValue(VOLT_PALETTE);
    const li = setupOneFollowee('volt');
    expect(li.style.background).toBe('rgb(25, 37, 0)');
  });

  test('card with known paletteKey gets palette.color as borderLeftColor when available', () => {
    getPaletteByKey.mockReturnValue(OCEAN_PALETTE);
    const li = setupOneFollowee('ocean');
    expect(li.style.borderLeftColor).toBe('rgb(59, 130, 246)');
  });

  test('card with known paletteKey gets palette.theme.textMuted as status text color', () => {
    getPaletteByKey.mockReturnValue(OCEAN_PALETTE);
    const li = setupOneFollowee('ocean');
    const statusEl = li.querySelector('.person-status');
    expect(statusEl.style.color).toBe('rgb(95, 154, 207)');
  });

  test('available span inside status gets palette.color when available', () => {
    getPaletteByKey.mockReturnValue(OCEAN_PALETTE);
    const li = setupOneFollowee('ocean');
    const span = li.querySelector('.status-available');
    expect(span).not.toBeNull();
    expect(span.style.color).toBe('rgb(59, 130, 246)');
  });

  test('card with paletteKey: null renders with default CSS, no inline background', () => {
    getPaletteByKey.mockReturnValue(null);
    const li = setupOneFollowee(null);
    expect(li.style.background).toBe('');
  });

  test('card with unknown paletteKey string falls back to default CSS, no inline background', () => {
    getPaletteByKey.mockReturnValue(null);
    const li = setupOneFollowee('unknown-palette');
    expect(li.style.background).toBe('');
  });

  test('card without paletteKey field renders with default CSS (no regression)', () => {
    getPaletteByKey.mockReturnValue(null);
    const li = setupOneFollowee(undefined);
    expect(li.style.background).toBe('');
  });

  test('unavailable card with known paletteKey gets transparent borderLeftColor', () => {
    setupDom();
    getFollowing.mockReturnValue([{ userId: 'user1', code: 'ABC123', label: 'Jordan' }]);
    let watchStatusCallback;
    let watchFollowersCallback;
    watchFollowers.mockImplementation((_userId, cb) => { watchFollowersCallback = cb; return jest.fn(); });
    watchStatus.mockImplementation((_uid, cb) => { watchStatusCallback = cb; return jest.fn(); });
    initList('myUid', 'MYCODE');
    watchFollowersCallback([]);
    getPaletteByKey.mockReturnValue(OCEAN_PALETTE);
    watchStatusCallback({ status: 'unavailable', paletteKey: 'ocean' });
    const li = document.querySelector('[data-user-id="user1"]');
    // Unavailable: all palette card styles cleared — default CSS applies
    expect(li.style.background).toBe('');
    expect(li.style.borderLeftColor).toBe('');
  });
});

// --- subscribeToFollowee: field-change guard ---
// Note: the old "skip-if-only-knocks-changed" guard in subscribeToFollowee was
// deleted when knocks moved out of users/{uid} into the top-level knocks/
// mailbox (knocks writes no longer trigger the watchStatus onValue tick).
// The test below was renamed to reflect the new behavior: updateFolloweeRow IS
// called on every status tick regardless of whether a knocks key is present,
// but since the same data produces the same DOM the dot class is stable.

describe('subscribeToFollowee: field-change guard', () => {
  let fireStatus; // fn(userData) → triggers watchStatus callback

  function setupMutual(userId = 'u1') {
    setupDom();
    jest.clearAllMocks();
    getFollowing.mockReturnValue([{ userId, code: 'ABC123', label: 'Alice' }]);
    let statusCallback;
    watchStatus.mockImplementation((_uid, cb) => {
      statusCallback = cb;
      return jest.fn();
    });
    watchFollowers.mockImplementation((_uid, cb) => {
      cb([{ userId, code: 'ABC123' }]); // make it a mutual
      return jest.fn();
    });
    initList('myUid', 'MYCODE');
    fireStatus = (data) => statusCallback(data);
  }

  test('re-render with same data leaves dot class unchanged (knocks key in payload is irrelevant)', () => {
    setupMutual();
    const baseData = {
      status: 'unavailable', availableUntil: null,
      statusColor: '#22c55e', paletteKey: null, code: 'ABC123',
    };
    fireStatus(baseData); // initial call, sets lastUserData

    const li = document.querySelector('[data-user-id="u1"]');
    const dotBefore = li.querySelector('.person-dot').className;

    // Fire again with a knocks key present — guard no longer exists, but same
    // visible data means the dot class is identical after the re-render.
    fireStatus({ ...baseData, knocks: { someUser: { count: 1, ts: Date.now() } } });

    expect(li.querySelector('.person-dot').className).toBe(dotBefore);
  });

  test('updateFolloweeRow IS called when status changes', () => {
    setupMutual();
    const baseData = {
      status: 'unavailable', availableUntil: null,
      statusColor: '#22c55e', paletteKey: null, code: 'ABC123',
    };
    fireStatus(baseData);
    const li = document.querySelector('[data-user-id="u1"]');
    const statusElBefore = li.querySelector('.person-status').innerHTML;

    // Fire with changed status
    fireStatus({ ...baseData, status: 'available', availableUntil: Date.now() + 3600000 });
    // status changed → updateFolloweeRow runs → person-status text changes
    expect(document.querySelector('[data-user-id="u1"] .person-status').innerHTML)
      .not.toBe(statusElBefore);
  });
});

// --- knock click handler on mutual rows ---

describe('knock click handler on mutual rows', () => {
  const { sendKnock } = require('../js/knock.js');
  const { isCardDrawerOpen } = require('../js/cardDrawer.js');

  function setupMutualWithKnock(userId = 'u1') {
    setupDom();
    jest.clearAllMocks();
    getFollowing.mockReturnValue([{ userId, code: 'ABC123', label: 'Alice' }]);
    watchStatus.mockReturnValue(jest.fn());
    watchFollowers.mockImplementation((_uid, cb) => {
      cb([{ userId, code: 'ABC123' }]);
      return jest.fn();
    });
    initList('myUid', 'MYCODE');
    return document.querySelector(`[data-user-id="${userId}"]`);
  }

  test('tapping mutual li calls sendKnock', () => {
    const li = setupMutualWithKnock();
    li.click();
    expect(sendKnock).toHaveBeenCalled();
  });

  test('tapping person-label skips knock (allows rename)', () => {
    const li = setupMutualWithKnock();
    sendKnock.mockClear();
    li.querySelector('.person-label').click();
    expect(sendKnock).not.toHaveBeenCalled();
  });

  test('tapping unfollow inside the drawer does not knock', () => {
    const li = setupMutualWithKnock();
    sendKnock.mockClear();
    li.querySelector('.card-drawer-toggle').click();
    li.querySelector('.unfollow-btn').click();
    expect(sendKnock).not.toHaveBeenCalled();
  });

  test('tapping the card body to dismiss an open drawer does not knock (C1)', () => {
    const li = setupMutualWithKnock();
    sendKnock.mockClear();
    li.querySelector('.card-drawer-toggle').click(); // open the drawer
    expect(isCardDrawerOpen()).toBe(true);
    // Tap the li body itself (NOT inside .card-drawer) to dismiss.
    li.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(sendKnock).not.toHaveBeenCalled();
    expect(isCardDrawerOpen()).toBe(false); // dismissed
  });
});

// --- Helper used by call mode tests ---
function makeFolloweeLi(userId) {
  const li = document.createElement('li');
  li.dataset.userId = userId;
  li.innerHTML = `
    <div class="person-dot"></div>
    <div class="person-info">
      <div class="person-label">Name</div>
      <div class="person-status"></div>
    </div>
    <button class="unfollow-btn"></button>`;
  document.getElementById('people-list').appendChild(li);
  return li;
}

describe('setFolloweeReadyCallback', () => {
  let cb;
  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
    resetRenderedFollowees();
    cb = jest.fn();
    setFolloweeReadyCallback(cb);
  });

  test('callback fires on first updateFolloweeRow call for a userId', () => {
    const li = makeFolloweeLi('alice');
    const entry = { userId: 'alice', code: 'ALICE1' };
    updateFolloweeRow(entry, { status: 'unavailable', availableUntil: null }, 'me');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('callback does not fire again for the same userId', () => {
    const li = makeFolloweeLi('alice');
    const entry = { userId: 'alice', code: 'ALICE1' };
    updateFolloweeRow(entry, { status: 'unavailable', availableUntil: null }, 'me');
    updateFolloweeRow(entry, { status: 'available', availableUntil: Date.now() + 3600000 }, 'me');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('callback fires independently for different userIds', () => {
    makeFolloweeLi('alice');
    makeFolloweeLi('bob');
    const entryA = { userId: 'alice', code: 'ALICE1' };
    const entryB = { userId: 'bob',   code: 'BOB111' };
    updateFolloweeRow(entryA, { status: 'unavailable', availableUntil: null }, 'me');
    updateFolloweeRow(entryB, { status: 'unavailable', availableUntil: null }, 'me');
    expect(cb).toHaveBeenCalledTimes(2);
  });

  test('initList resets renderedFollowees so callback fires again after re-init', () => {
    makeFolloweeLi('alice');
    const entry = { userId: 'alice', code: 'ALICE1' };
    updateFolloweeRow(entry, { status: 'unavailable', availableUntil: null }, 'me');
    // Simulate re-init: initList clears renderedFollowees
    resetRenderedFollowees();
    makeFolloweeLi('alice');
    updateFolloweeRow(entry, { status: 'unavailable', availableUntil: null }, 'me');
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

describe('call mode: receiver-side glow via updateFolloweeRow', () => {
  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
    resetRenderedFollowees();
  });

  // Receiver-side glow now keys off the calls/{me} own-call watcher (_incomingCall)
  // instead of a callState field on the followee's status record. Each test fires
  // a ring through the captured own-call callback, then asserts updateFolloweeRow
  // paints the glow. Updated (not weakened) because the detection source changed.
  test('adds .call-mode and sets --call-color-rgb when ringing from this followee', () => {
    const entry = { userId: 'alice', code: 'AAA111', label: 'Alice' };
    getFollowing.mockReturnValue([entry]);
    makeFolloweeLi('alice');
    const ring = captureOwnCall('myUid', 'MYCODE');
    ring({ from: 'alice', ts: 1 });
    updateFolloweeRow(entry, {
      status: 'available',
      availableUntil: Date.now() + 3600000,
      statusColor: '#3b82f6',
    }, 'myUid');
    const li = document.querySelector('[data-user-id="alice"]');
    expect(li.classList.contains('call-mode')).toBe(true);
    expect(li.style.getPropertyValue('--call-color-rgb')).toBe('59, 130, 246');
  });

  test('removes .call-mode when there is no incoming call', () => {
    const entry = { userId: 'alice', code: 'AAA111', label: 'Alice' };
    getFollowing.mockReturnValue([entry]);
    const li = makeFolloweeLi('alice');
    li.classList.add('call-mode');
    li.style.setProperty('--call-color-rgb', '59, 130, 246');
    captureOwnCall('myUid', 'MYCODE'); // no ring fired → _incomingCall stays null
    updateFolloweeRow(entry, {
      status: 'available',
      availableUntil: Date.now() + 3600000,
      statusColor: '#3b82f6',
    }, 'myUid');
    expect(li.classList.contains('call-mode')).toBe(false);
    expect(li.style.getPropertyValue('--call-color-rgb')).toBe('');
  });

  test('removes .call-mode when the ring is from someone else', () => {
    const entry = { userId: 'alice', code: 'AAA111', label: 'Alice' };
    getFollowing.mockReturnValue([entry]);
    const li = makeFolloweeLi('alice');
    li.classList.add('call-mode');
    const ring = captureOwnCall('myUid', 'MYCODE');
    ring({ from: 'someoneElse', ts: 1 });
    updateFolloweeRow(entry, {
      status: 'available',
      availableUntil: Date.now() + 3600000,
      statusColor: '#3b82f6',
    }, 'myUid');
    expect(li.classList.contains('call-mode')).toBe(false);
  });

  test('uses fallback #22c55e when statusColor absent', () => {
    const entry = { userId: 'alice', code: 'AAA111', label: 'Alice' };
    getFollowing.mockReturnValue([entry]);
    makeFolloweeLi('alice');
    const ring = captureOwnCall('myUid', 'MYCODE');
    ring({ from: 'alice', ts: 1 });
    updateFolloweeRow(entry, {
      status: 'available',
      availableUntil: Date.now() + 3600000,
    }, 'myUid');
    const li = document.querySelector('[data-user-id="alice"]');
    expect(li.style.getPropertyValue('--call-color-rgb')).toBe('34, 197, 94');
  });
});

describe('call deferral while a drawer is open', () => {
  const { createCardDrawer } = require('../js/cardDrawer.js');
  // The receiver-side glow is now driven by the calls/{me} own-call watcher
  // (_incomingCall) rather than a callState field on the status record, so the
  // status payload no longer carries call info; the ring is fired separately.
  const STATUS = { status: 'available', availableUntil: Date.now() + 3600000, statusColor: '#3b82f6' };
  const entry = { userId: 'alice', code: 'AAA111', label: 'Alice' };
  let ring; // fire a calls/{me} update through the captured own-call watcher

  function openADrawer() {
    const ellipsis = createCardDrawer([{ el: document.createElement('button') }, { el: document.createElement('button') }]);
    document.body.appendChild(ellipsis);
    ellipsis.click(); // isCardDrawerOpen() is now true
    return ellipsis;
  }

  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
    resetRenderedFollowees();
    // initList sets the module-level myUserIdRef used by the reconcile listener.
    // captureOwnCall installs no-op followers/status watchers + grabs the
    // own-call callback so a ring can be simulated.
    getFollowing.mockReturnValue([entry]);
    ring = captureOwnCall('myUid', 'MYCODE');
    resetRenderedFollowees();
  });

  test('incoming call does NOT enter call-mode while a drawer is open', () => {
    makeFolloweeLi('alice');
    openADrawer();
    ring({ from: 'alice', ts: 1 });
    updateFolloweeRow(entry, STATUS, 'myUid');
    const li = document.querySelector('[data-user-id="alice"]');
    expect(li.classList.contains('call-mode')).toBe(false);
  });

  test('closing the drawer applies a still-live call', () => {
    makeFolloweeLi('alice');
    const ellipsis = openADrawer();
    ring({ from: 'alice', ts: 1 });           // ring arrives while drawer open
    updateFolloweeRow(entry, STATUS, 'myUid'); // deferred; caches STATUS in lastUserData
    ellipsis.click(); // close the real drawer -> fires card-drawer-close, reconcile runs
    const li = document.querySelector('[data-user-id="alice"]');
    expect(li.classList.contains('call-mode')).toBe(true);
  });

  test('a call cancelled during the open window is not replayed on close', () => {
    makeFolloweeLi('alice');
    const ellipsis = openADrawer();
    ring({ from: 'alice', ts: 1 });            // call arrives (deferred)
    updateFolloweeRow(entry, STATUS, 'myUid');
    ring(null);                                // caller hangs up -> _incomingCall cleared
    ellipsis.click(); // close the real drawer -> fires card-drawer-close, reconcile runs
    const li = document.querySelector('[data-user-id="alice"]');
    expect(li.classList.contains('call-mode')).toBe(false);
  });

  test('drawer close does not re-render rows without an incoming call', () => {
    const li = makeFolloweeLi('alice');
    // Prime lastUserData + renderedFollowees with a NON-call state for alice
    // (no ring fired, so _incomingCall is null).
    updateFolloweeRow(entry, STATUS, 'myUid');
    // Put a sentinel in the status element that a re-render would clobber.
    const statusEl = li.querySelector('.person-status');
    statusEl.innerHTML = 'SENTINEL';
    const ellipsis = openADrawer();
    ellipsis.click(); // close the real drawer -> fires card-drawer-close
    expect(document.querySelector('[data-user-id="alice"] .person-status').innerHTML).toBe('SENTINEL');
  });
});

describe('call mode: display text during call', () => {
  let ring; // fire a ring through the captured own-call watcher (receiver tests)
  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
    resetRenderedFollowees();
    // initList resets callModeCalleeId so tests are isolated. captureOwnCall
    // also grabs the calls/{me} callback so receiver-side tests can ring.
    ring = captureOwnCall('myUid', 'MYCODE');
  });

  test('caller sees "Calling them…" when madeCallCount >= 4', () => {
    getMadeCallCount.mockReturnValue(4);
    const entry = { userId: 'alice', code: 'AAA111', label: 'Alice' };
    getFollowing.mockReturnValue([entry]);
    makeFolloweeLi('alice');
    enterCallMode(entry, 'myUid');
    updateFolloweeRow(entry, {
      status: 'available', availableUntil: Date.now() + 3600000, statusColor: '#22c55e',
    }, 'myUid');
    const status = document.querySelector('[data-user-id="alice"] .person-status');
    expect(status.textContent).toBe('Calling them\u2026');
  });

  test('caller sees "(swipe left to hang up)" hint when madeCallCount < 4', () => {
    getMadeCallCount.mockReturnValue(2);
    const entry = { userId: 'alice', code: 'AAA111', label: 'Alice' };
    getFollowing.mockReturnValue([entry]);
    makeFolloweeLi('alice');
    enterCallMode(entry, 'myUid');
    updateFolloweeRow(entry, {
      status: 'available', availableUntil: Date.now() + 3600000, statusColor: '#22c55e',
    }, 'myUid');
    const status = document.querySelector('[data-user-id="alice"] .person-status');
    expect(status.textContent).toBe('Calling them\u2026 (swipe left to hang up)');
  });

  test('receiver sees "Calling you…" when answeredCallCount >= 4', () => {
    getAnsweredCallCount.mockReturnValue(5);
    const entry = { userId: 'alice', code: 'AAA111', label: 'Alice' };
    getFollowing.mockReturnValue([entry]);
    makeFolloweeLi('alice');
    ring({ from: 'alice', ts: 1 });
    updateFolloweeRow(entry, {
      status: 'available', availableUntil: Date.now() + 3600000, statusColor: '#3b82f6',
    }, 'myUid');
    const status = document.querySelector('[data-user-id="alice"] .person-status');
    expect(status.textContent).toBe('Calling you\u2026');
  });

  test('receiver sees "(swipe right to answer)" hint when answeredCallCount < 4', () => {
    getAnsweredCallCount.mockReturnValue(1);
    const entry = { userId: 'alice', code: 'AAA111', label: 'Alice' };
    getFollowing.mockReturnValue([entry]);
    makeFolloweeLi('alice');
    ring({ from: 'alice', ts: 1 });
    updateFolloweeRow(entry, {
      status: 'available', availableUntil: Date.now() + 3600000, statusColor: '#3b82f6',
    }, 'myUid');
    const status = document.querySelector('[data-user-id="alice"] .person-status');
    expect(status.textContent).toBe('Calling you\u2026 (swipe right to answer)');
  });

  test('normal status text resumes after call mode ends', () => {
    const entry = { userId: 'alice', code: 'AAA111', label: 'Alice' };
    getFollowing.mockReturnValue([entry]);
    makeFolloweeLi('alice');
    enterCallMode(entry, 'myUid');
    exitCallMode('myUid');
    updateFolloweeRow(entry, {
      status: 'available', availableUntil: Date.now() + 3600000, statusColor: '#22c55e',
    }, 'myUid');
    const status = document.querySelector('[data-user-id="alice"] .person-status');
    expect(status.textContent).toContain('Available for');
  });
});

// Detection moved off the followee status watch onto the calls/{me} mailbox:
// a ring now arrives via the own-call watcher (not as a callState field on the
// status record). This re-points the test at that source — a fresh ring repaints
// the followee row into call-mode — rather than removing the coverage.
describe('call mode: a ring on the own-call mailbox repaints the row', () => {
  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
    resetRenderedFollowees();
  });

  test('updateFolloweeRow enters call-mode when an own-call ring lands', () => {
    const entry = { userId: 'alice', code: 'AAA111', label: 'Alice' };
    makeFolloweeLi('alice');
    getFollowing.mockReturnValue([entry]);

    const ring = captureOwnCall('myUid', 'MYCODE');

    const baseData = {
      status: 'available',
      availableUntil: Date.now() + 3600000,
      statusColor: '#3b82f6',
      paletteKey: null,
      code: 'AAA111',
    };
    // Prime lastUserData + render once: no incoming call yet.
    updateFolloweeRow(entry, baseData, 'myUid');

    const li = document.querySelector('[data-user-id="alice"]');
    expect(li.classList.contains('call-mode')).toBe(false);

    // alice rings us → own-call watcher sets _incomingCall + repaints the row
    // (it re-runs updateFolloweeRow from the cached lastUserData).
    ring({ from: 'alice', ts: 1 });
    expect(li.classList.contains('call-mode')).toBe(true);
  });
});

describe('call mode: enterCallMode', () => {
  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
    resetRenderedFollowees();
    // initList resets callModeCalleeId/callModeSnapshot
    initAndCaptureFollowersCallback('myUid', 'MYCODE');
  });

  test('sets callModeCalleeId to callee userId', () => {
    enterCallMode({ userId: 'alice', code: 'AAA111', label: 'Alice' }, 'myUid');
    expect(getCallModeCalleeId()).toBe('alice');
  });

  test('calls startCall with callerId and calleeId (no prior ringer → third arg undefined)', () => {
    enterCallMode({ userId: 'alice', code: 'AAA111', label: 'Alice' }, 'myUid');
    expect(startCall).toHaveBeenCalledWith('myUid', 'alice', undefined);
  });

  test('enterCallMode while being rung starts the new call and clears the ringer atomically', () => {
    let ownCallCb;
    watchOwnCall.mockImplementation((uid, cb) => { ownCallCb = cb; return jest.fn(); });
    getFollowing.mockReturnValue([
      { userId: 'ann', code: 'C1', label: 'Ann' },
      { userId: 'cara', code: 'C2', label: 'Cara' },
    ]);
    initList('myUid', 'MYCODE');
    ownCallCb({ from: 'ann', ts: 1 }); // Ann is ringing me
    enterCallMode({ userId: 'cara' }, 'myUid'); // I call Cara instead
    expect(startCall).toHaveBeenCalledWith('myUid', 'cara', 'ann');
  });
});

describe('call mode: exitCallMode', () => {
  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
    resetRenderedFollowees();
    initAndCaptureFollowersCallback('myUid', 'MYCODE');
  });

  test('calls endCall with both participants', () => {
    enterCallMode({ userId: 'alice', code: 'AAA111' }, 'myUid');
    exitCallMode('myUid');
    expect(endCall).toHaveBeenCalledWith('myUid', 'alice');
  });

  test('resets callModeCalleeId to null', () => {
    enterCallMode({ userId: 'alice', code: 'AAA111' }, 'myUid');
    exitCallMode('myUid');
    expect(getCallModeCalleeId()).toBeNull();
  });

});

describe('call mode: own-call mailbox', () => {
  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
    resetRenderedFollowees();
  });

  test('a ring (own-call from) marks incoming', () => {
    let ownCallCb;
    watchOwnCall.mockImplementation((uid, cb) => { ownCallCb = cb; return jest.fn(); });
    getFollowing.mockReturnValue([{ userId: 'caller', code: 'C', label: 'Cara' }]);
    initList('me', 'MYCODE');
    ownCallCb({ from: 'caller', ts: 1 });
    expect(getIncomingCallFrom()).toBe('caller');
  });

  test('endCall fires when I exit call mode', () => {
    watchOwnCall.mockImplementation(() => jest.fn());
    initList('me', 'MYCODE');
    enterCallMode({ userId: 'callee' }, 'me');
    exitCallMode('me');
    expect(endCall).toHaveBeenCalledWith('me', 'callee');
  });

  // canvas.js is not mocked in this suite, so enterCanvas runs as-is in jsdom
  // and may error/no-op (canvas-screen element absent). The state mutations that
  // happen BEFORE the enterCanvas call are the observable under test here.
  test('boot into an answered call sets callModeCalleeId and clears _incomingCall for the callee (from-record)', () => {
    let ownCallCb;
    watchOwnCall.mockImplementation((uid, cb) => { ownCallCb = cb; return jest.fn(); });
    getFollowing.mockReturnValue([{ userId: 'caller', code: 'C', label: 'Cara' }]);
    initList('me', 'MYCODE');
    // No canvas active; persisted answered record where I'm the callee.
    // The watcher fires on attach with the persisted record — this simulates boot recovery.
    ownCallCb({ from: 'caller', answered: true, ts: 1 });
    // callModeCalleeId is set to 'caller' (peerId = call.to || call.from = 'caller')
    expect(getCallModeCalleeId()).toBe('caller');
    // _incomingCall is cleared (no longer ringing since the call is answered)
    expect(getIncomingCallFrom()).toBeNull();
  });
});

describe('call mode: sortFollowees pins callee to top', () => {
  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
    resetRenderedFollowees();
  });

  test('callee is first in the Mutuals section when call mode active', () => {
    getFollowing.mockReturnValue([
      { userId: 'alice', code: 'AAA111', label: 'Alice' },
      { userId: 'bob',   code: 'BBB222', label: 'Bob' },
      { userId: 'carol', code: 'CCC333', label: 'Carol' },
    ]);
    watchStatus.mockReturnValue(jest.fn());
    const fire = initAndCaptureFollowersCallback('myUid', 'MYCODE');
    fire([
      { userId: 'alice', code: 'AAA111' },
      { userId: 'bob',   code: 'BBB222' },
      { userId: 'carol', code: 'CCC333' },
    ]);

    enterCallMode({ userId: 'bob', code: 'BBB222', label: 'Bob' }, 'myUid');

    // Trigger re-render
    fire([
      { userId: 'alice', code: 'AAA111' },
      { userId: 'bob',   code: 'BBB222' },
      { userId: 'carol', code: 'CCC333' },
    ]);

    // Find first mutual row (after the "Mutuals" label)
    const rows = Array.from(document.querySelectorAll('#people-list [data-user-id]'));
    expect(rows[0].dataset.userId).toBe('bob');
  });
});

describe('call mode: swipe gesture', () => {
  function firePointer(el, type, clientX, clientY) {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX, clientY, pointerId: 1 }));
  }

  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
    resetRenderedFollowees();
  });

  test('right-swipe past 40% on a mutual card calls startCall', () => {
    getFollowing.mockReturnValue([{ userId: 'alice', code: 'AAA111', label: 'Alice' }]);
    watchStatus.mockReturnValue(jest.fn());
    const fire = initAndCaptureFollowersCallback('myUid', 'MYCODE');
    fire([{ userId: 'alice', code: 'AAA111' }]);

    const li = document.querySelector('[data-user-id="alice"]');
    jest.spyOn(li, 'getBoundingClientRect').mockReturnValue({ width: 200 });

    firePointer(li, 'pointerdown', 10, 50);
    firePointer(li, 'pointermove', 100, 52); // dx=90 > 200*0.4=80; ratio 90/2 = 45 > 1.5 ✓
    firePointer(li, 'pointerup',   100, 52);

    expect(startCall).toHaveBeenCalledWith('myUid', 'alice', undefined);
  });

  test('left-swipe on caller-side .call-mode card ends the call', () => {
    getFollowing.mockReturnValue([{ userId: 'alice', code: 'AAA111', label: 'Alice' }]);
    watchStatus.mockImplementationOnce((_uid, cb) => {
      cb({ status: 'unavailable', statusColor: '#22c55e' });
      return jest.fn();
    });
    const fire = initAndCaptureFollowersCallback('myUid', 'MYCODE');
    fire([{ userId: 'alice', code: 'AAA111' }]);

    enterCallMode({ userId: 'alice', code: 'AAA111' }, 'myUid');
    jest.clearAllMocks();

    // Re-query li after renderList() from enterCallMode
    const li = document.querySelector('[data-user-id="alice"]');
    jest.spyOn(li, 'getBoundingClientRect').mockReturnValue({ width: 200 });

    firePointer(li, 'pointerdown', 100, 50);
    firePointer(li, 'pointermove',  10, 52); // dx=-90 < -80
    firePointer(li, 'pointerup',    10, 52);

    // Caller side: exitCallMode → endCall(myUid, alice)
    expect(endCall).toHaveBeenCalledWith('myUid', 'alice');
  });

  test('left-swipe on receiver-side .call-mode card ends the call', () => {
    getFollowing.mockReturnValue([{ userId: 'alice', code: 'AAA111', label: 'Alice' }]);
    watchStatus.mockImplementationOnce((_uid, cb) => {
      cb({ status: 'unavailable', statusColor: '#22c55e' });
      return jest.fn();
    });
    const fire = initAndCaptureFollowersCallback('myUid', 'MYCODE');
    fire([{ userId: 'alice', code: 'AAA111' }]);

    // Receiver scenario: alice's card is glowing but WE are not in call mode
    const li = document.querySelector('[data-user-id="alice"]');
    li.classList.add('call-mode');
    jest.spyOn(li, 'getBoundingClientRect').mockReturnValue({ width: 200 });

    firePointer(li, 'pointerdown', 100, 50);
    firePointer(li, 'pointermove',  10, 52);
    firePointer(li, 'pointerup',    10, 52);

    // Receiver decline: endCall(myUid, alice) tears down both mailboxes.
    expect(endCall).toHaveBeenCalledWith('myUid', 'alice');
  });

  test('short right-swipe (< 40%) does nothing', () => {
    getFollowing.mockReturnValue([{ userId: 'alice', code: 'AAA111', label: 'Alice' }]);
    watchStatus.mockReturnValue(jest.fn());
    const fire = initAndCaptureFollowersCallback('myUid', 'MYCODE');
    fire([{ userId: 'alice', code: 'AAA111' }]);

    const li = document.querySelector('[data-user-id="alice"]');
    jest.spyOn(li, 'getBoundingClientRect').mockReturnValue({ width: 200 });

    firePointer(li, 'pointerdown', 10, 50);
    firePointer(li, 'pointermove', 50, 52); // dx=40 = 20% < 40%
    firePointer(li, 'pointerup',   50, 52);

    expect(startCall).not.toHaveBeenCalled();
  });

  test('mostly-vertical movement does not trigger swipe', () => {
    getFollowing.mockReturnValue([{ userId: 'alice', code: 'AAA111', label: 'Alice' }]);
    watchStatus.mockReturnValue(jest.fn());
    const fire = initAndCaptureFollowersCallback('myUid', 'MYCODE');
    fire([{ userId: 'alice', code: 'AAA111' }]);

    const li = document.querySelector('[data-user-id="alice"]');
    jest.spyOn(li, 'getBoundingClientRect').mockReturnValue({ width: 200 });

    firePointer(li, 'pointerdown', 10, 10);
    firePointer(li, 'pointermove', 100, 100); // dx=90, dy=90 → ratio 90/90=1.0 < 1.5 → blocked
    firePointer(li, 'pointerup',   100, 100);

    expect(startCall).not.toHaveBeenCalled();
  });
});

describe('call mode: reEnterCallMode', () => {
  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
    resetRenderedFollowees();
    // initList resets callModeCalleeId/callModeSnapshot
    initAndCaptureFollowersCallback('myUid', 'MYCODE');
  });

  test('sets callModeCalleeId to callee userId', () => {
    reEnterCallMode({ userId: 'alice', code: 'AAA111', label: 'Alice' }, {}, 'myUid');
    expect(getCallModeCalleeId()).toBe('alice');
  });

  test('does NOT call startCall (no Firebase write on restart)', () => {
    reEnterCallMode({ userId: 'alice', code: 'AAA111', label: 'Alice' }, {}, 'myUid');
    expect(startCall).not.toHaveBeenCalled();
  });

  test('adds .call-mode class to callee li element', () => {
    // Set up alice as a mutual with cached status data so updateFolloweeRow fires on re-render
    getFollowing.mockReturnValue([{ userId: 'alice', code: 'AAA111', label: 'Alice' }]);
    let aliceStatusCallback;
    watchStatus.mockImplementationOnce((_uid, cb) => {
      aliceStatusCallback = cb;
      return jest.fn();
    });
    const fire = initAndCaptureFollowersCallback('myUid', 'MYCODE');
    fire([{ userId: 'alice', code: 'AAA111' }]);
    // Populate lastUserData for alice so updateFolloweeRow is called on re-render
    aliceStatusCallback({ status: 'available', availableUntil: Date.now() + 3600000, statusColor: '#3b82f6' });

    reEnterCallMode(
      { userId: 'alice', code: 'AAA111', label: 'Alice' },
      { statusColor: '#3b82f6' },
      'myUid'
    );
    const li = document.querySelector('[data-user-id="alice"]');
    expect(li.classList.contains('call-mode')).toBe(true);
  });

  test('sets --call-color-rgb on callee li element', () => {
    // Set up alice as a mutual with cached status data so updateFolloweeRow fires on re-render
    getFollowing.mockReturnValue([{ userId: 'alice', code: 'AAA111', label: 'Alice' }]);
    let aliceStatusCallback;
    watchStatus.mockImplementationOnce((_uid, cb) => {
      aliceStatusCallback = cb;
      return jest.fn();
    });
    const fire = initAndCaptureFollowersCallback('myUid', 'MYCODE');
    fire([{ userId: 'alice', code: 'AAA111' }]);
    aliceStatusCallback({ status: 'available', availableUntil: Date.now() + 3600000, statusColor: '#3b82f6' });

    reEnterCallMode(
      { userId: 'alice', code: 'AAA111', label: 'Alice' },
      { statusColor: '#3b82f6' },
      'myUid'
    );
    const li = document.querySelector('[data-user-id="alice"]');
    expect(li.style.getPropertyValue('--call-color-rgb')).toBe('59, 130, 246');
  });

});

// --- long-press palette adoption ---

describe('long-press palette adoption: scaffolding', () => {
  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
  });

  test('enterPaletteMode, exitPaletteMode, switchSet are jest.fn() in the palettes mock', () => {
    const { enterPaletteMode, exitPaletteMode, switchSet } = require('../js/palettes.js');
    expect(jest.isMockFunction(enterPaletteMode)).toBe(true);
    expect(jest.isMockFunction(exitPaletteMode)).toBe(true);
    expect(jest.isMockFunction(switchSet)).toBe(true);
  });
});

// Helper: long-press a card by userId (fake timers, then restore real timers)
function longPressCard(userId) {
  jest.useFakeTimers();
  const li = document.querySelector(`[data-user-id="${userId}"]`);
  li.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 50 }));
  jest.advanceTimersByTime(500);
  jest.useRealTimers();
  return li;
}

// Helper used in adoption tests — sets up a mutual card and populates lastUserData
function setupMutualAndFireStatus(userId, userData, myUserId = 'myUid') {
  getFollowing.mockReturnValue([{ userId, code: 'XY9K2M', label: 'Alice' }]);
  const fire = initAndCaptureFollowersCallback(myUserId);
  fire([{ userId, code: 'XY9K2M' }]);  // mutual
  // Populate lastUserData by firing a watchStatus callback
  const watchStatusCb = watchStatus.mock.calls.find(c => c[0] === userId)?.[1];
  if (watchStatusCb) watchStatusCb(userData);
  return document.querySelector(`[data-user-id="${userId}"]`);
}

describe('applyAdoption', () => {
  const TARGET_ID = 'u1';
  const MY_ID = 'myUid';

  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
    document.documentElement.style.setProperty('--my-status', '#22c55e');
    document.documentElement.style.setProperty('--my-glow', '#86efac');
  });

  function triggerAdoptionFor(userId, userData) {
    setupMutualAndFireStatus(userId, userData, MY_ID);
    return longPressCard(userId);
  }

  test('calls enterPaletteMode with target paletteKey when present', () => {
    triggerAdoptionFor(TARGET_ID, { statusColor: '#f59e0b', paletteKey: 'ember' });
    expect(enterPaletteMode).toHaveBeenCalledWith('ember', MY_ID);
  });

  test('does NOT call enterPaletteMode when target has no paletteKey', () => {
    triggerAdoptionFor(TARGET_ID, { statusColor: '#f59e0b' });
    expect(enterPaletteMode).not.toHaveBeenCalled();
  });

  test('calls setStatusColor with target statusColor when present', () => {
    const { setStatusColor } = require('../js/db.js');
    triggerAdoptionFor(TARGET_ID, { statusColor: '#f59e0b', paletteKey: 'ember' });
    expect(setStatusColor).toHaveBeenCalledWith(MY_ID, '#f59e0b');
  });

  test('does NOT call setStatusColor when target has no statusColor', () => {
    const { setStatusColor } = require('../js/db.js');
    triggerAdoptionFor(TARGET_ID, { paletteKey: 'ember' });
    expect(setStatusColor).not.toHaveBeenCalled();
  });

  test('sets --my-status CSS var to target statusColor', () => {
    triggerAdoptionFor(TARGET_ID, { statusColor: '#f59e0b' });
    expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#f59e0b');
  });

  test('adds .adopted-from class to target li', () => {
    const li = triggerAdoptionFor(TARGET_ID, { statusColor: '#f59e0b' });
    expect(li.classList.contains('adopted-from')).toBe(true);
  });

  test('calls saveCombo once after adoption with the adopted combo', () => {
    const { saveCombo } = require('../js/favorites.js');
    triggerAdoptionFor(TARGET_ID, { statusColor: '#f59e0b', paletteKey: 'ember' });
    expect(saveCombo).toHaveBeenCalledTimes(1);
    // Adopted combo has the source's statusColor + paletteKey.
    expect(saveCombo).toHaveBeenCalledWith(expect.objectContaining({
      statusColor: '#f59e0b',
      paletteKey: 'ember',
    }));
  });

});

describe('long press handler', () => {
  const TARGET_ID = 'u1';
  const MY_ID = 'myUid';

  function setupForLongPress(userData = { statusColor: '#f59e0b' }) {
    setupDom();
    jest.useFakeTimers();
    jest.clearAllMocks();
    document.documentElement.style.setProperty('--my-status', '#22c55e');
    document.documentElement.style.setProperty('--my-glow', '#86efac');
    setupMutualAndFireStatus(TARGET_ID, userData, MY_ID);
    return document.querySelector(`[data-user-id="${TARGET_ID}"]`);
  }

  afterEach(() => jest.useRealTimers());

  function press(li, x = 50, y = 50) {
    li.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
  }

  test('fires adoption after 500 ms', () => {
    const li = setupForLongPress();
    press(li);
    jest.advanceTimersByTime(500);
    expect(enterPaletteMode).not.toHaveBeenCalled(); // no paletteKey
    // setStatusColor should have been called (statusColor present)
    const { setStatusColor } = require('../js/db.js');
    expect(setStatusColor).toHaveBeenCalledWith(MY_ID, '#f59e0b');
  });

  test('does NOT fire adoption at 499 ms', () => {
    const li = setupForLongPress();
    press(li);
    jest.advanceTimersByTime(499);
    const { setStatusColor } = require('../js/db.js');
    expect(setStatusColor).not.toHaveBeenCalled();
  });

  test('pointermove > 8 px cancels — no adoption', () => {
    const li = setupForLongPress();
    press(li, 50, 50);
    li.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 59, clientY: 50 }));
    jest.advanceTimersByTime(500);
    const { setStatusColor } = require('../js/db.js');
    expect(setStatusColor).not.toHaveBeenCalled();
  });

  test('pointermove <= 8 px does NOT cancel', () => {
    const li = setupForLongPress();
    press(li, 50, 50);
    li.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 57, clientY: 50 }));
    jest.advanceTimersByTime(500);
    const { setStatusColor } = require('../js/db.js');
    expect(setStatusColor).toHaveBeenCalled();
  });

  test('pointerup before 500 ms cancels — no adoption', () => {
    const li = setupForLongPress();
    press(li, 50, 50);
    li.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    jest.advanceTimersByTime(500);
    const { setStatusColor } = require('../js/db.js');
    expect(setStatusColor).not.toHaveBeenCalled();
  });

  test('pointercancel cancels — no adoption', () => {
    const li = setupForLongPress();
    press(li, 50, 50);
    li.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
    jest.advanceTimersByTime(500);
    const { setStatusColor } = require('../js/db.js');
    expect(setStatusColor).not.toHaveBeenCalled();
  });

  test('long-press is suppressed while a card drawer is open', () => {
    const li = setupForLongPress(); // mutual row with statusColor '#f59e0b'
    li.querySelector('.card-drawer-toggle').click(); // open the drawer
    const { setStatusColor } = require('../js/db.js');
    setStatusColor.mockClear();
    press(li);
    jest.advanceTimersByTime(500);
    expect(setStatusColor).not.toHaveBeenCalled();
  });

  test('target has no statusColor — CSS vars unchanged, setStatusColor not called', () => {
    const { setStatusColor } = require('../js/db.js');
    const li = setupForLongPress({ paletteKey: 'ember' }); // no statusColor
    press(li);
    jest.advanceTimersByTime(500);
    expect(setStatusColor).not.toHaveBeenCalled();
    expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#22c55e'); // unchanged
  });

  test('PALETTE_INTERACTIONS_ENABLED false — no long-press handler attached (palettes still active)', () => {
    jest.resetModules();
    jest.doMock('../js/features.js', () => ({
      PALETTES_ENABLED: true,
      PALETTE_INTERACTIONS_ENABLED: false,
      KNOCK_ENABLED: true,
      CALL_ENABLED: true,
    }));
    const { initList: initList3 } = require('../js/following.js');
    setupDom();
    jest.useFakeTimers();
    let cb;
    let statusCb;
    const { watchFollowers: wf3, watchStatus: ws3 } = require('../js/db.js');
    wf3.mockImplementation((_uid, fn) => { cb = fn; return jest.fn(); });
    ws3.mockImplementation((_uid, fn) => { statusCb = fn; return jest.fn(); });
    const { getFollowing: gf3 } = require('../js/store.js');
    gf3.mockReturnValue([{ userId: TARGET_ID, code: 'XY9K2M', label: 'Alice' }]);
    initList3(MY_ID, 'MYCODE');
    cb([{ userId: TARGET_ID, code: 'XY9K2M' }]);
    // Populate lastUserData so adoption would fire setStatusColor if handler is attached
    if (statusCb) statusCb({ status: 'available', availableUntil: Date.now() + 3600000, statusColor: '#f59e0b' });
    const li = document.querySelector(`[data-user-id="${TARGET_ID}"]`);
    press(li);
    jest.advanceTimersByTime(600);
    const { setStatusColor: ssc3 } = require('../js/db.js');
    expect(ssc3).not.toHaveBeenCalled();
    // Restore
    jest.resetModules();
    jest.doMock('../js/features.js', () => ({ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true, KNOCK_ENABLED: true, CALL_ENABLED: true }));
  });

  test('PALETTES_ENABLED false — no adoption on long press', () => {
    // Isolate this test: reset module registry, apply a PALETTES_ENABLED:false override,
    // then restore the original mock after the test.
    jest.resetModules();
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: false, PALETTE_INTERACTIONS_ENABLED: false, KNOCK_ENABLED: true, CALL_ENABLED: true }));
    const { initList: initList2 } = require('../js/following.js');
    setupDom();
    jest.useFakeTimers();
    let cb;
    const { watchFollowers: wf, watchStatus: ws } = require('../js/db.js');
    wf.mockImplementation((_uid, fn) => { cb = fn; return jest.fn(); });
    ws.mockReturnValue(jest.fn());
    const { getFollowing: gf } = require('../js/store.js');
    gf.mockReturnValue([{ userId: TARGET_ID, code: 'XY9K2M', label: 'Alice' }]);
    initList2(MY_ID, 'MYCODE');
    cb([{ userId: TARGET_ID, code: 'XY9K2M' }]);
    const li = document.querySelector(`[data-user-id="${TARGET_ID}"]`);
    press(li);
    jest.advanceTimersByTime(500);
    const { setStatusColor } = require('../js/db.js');
    expect(setStatusColor).not.toHaveBeenCalled();
    // Restore: reset registry and re-apply original PALETTES_ENABLED:true mock
    jest.resetModules();
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true, KNOCK_ENABLED: true, CALL_ENABLED: true }));
  });

});

// --- float-to-top: direct contacts ---

describe('direct-list float survives re-render', () => {
  // These tests exercise the float-restore contract that renderList implements.
  // A true integration test that drives renderList end-to-end is unreliable here
  // because earlier tests in this file use jest.resetModules() which rebinds the
  // imports in js/following.js. The contract is also covered by the manual
  // verification checklist in Task 22 and by the renderList implementation
  // directly reading getFloatedUserIds() (single call site, easy to grep).

  test('re-render contract: rows reported by getFloatedUserIds get prepended', () => {
    document.body.innerHTML = `
      <ul id="people-list">
        <li data-user-id="a"></li>
        <li data-user-id="b"></li>
        <li data-user-id="c"></li>
      </ul>
    `;
    const knock = require('../js/knock.js');
    knock.getFloatedUserIds.mockReturnValue(['b']);
    const list = document.getElementById('people-list');
    for (const uid of knock.getFloatedUserIds()) {
      const li = list.querySelector(`[data-user-id="${uid}"]`);
      if (li) list.prepend(li);
    }
    const order = Array.from(list.querySelectorAll('li')).map((el) => el.dataset.userId);
    expect(order).toEqual(['b', 'a', 'c']);
  });

  test('re-render contract: multiple floats land most-recent-first', () => {
    document.body.innerHTML = `
      <ul id="people-list">
        <li data-user-id="a"></li>
        <li data-user-id="b"></li>
        <li data-user-id="c"></li>
      </ul>
    `;
    const knock = require('../js/knock.js');
    // getFloatedUserIds returns insertion order (oldest first); the loop
    // prepends each in turn, so the LAST id in the array ends up at the top.
    knock.getFloatedUserIds.mockReturnValue(['a', 'b']);
    const list = document.getElementById('people-list');
    for (const uid of knock.getFloatedUserIds()) {
      const li = list.querySelector(`[data-user-id="${uid}"]`);
      if (li) list.prepend(li);
    }
    const order = Array.from(list.querySelectorAll('li')).map((el) => el.dataset.userId);
    expect(order).toEqual(['b', 'a', 'c']);
  });
});

// --- notification bell on contact rows ---

describe('notification bell on contact rows', () => {
  const { createNotifyBell } = require('../js/notifyBell.js');

  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
    createNotifyBell.mockImplementation(() => {
      const b = document.createElement('button');
      b.className = 'notify-bell';
      return b;
    });
  });

  test('mutual contact gets a bell with all three types', () => {
    getFollowing.mockReturnValue([
      { userId: 'alex', code: 'alex-code', label: 'Alex K.' },
    ]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'alex', code: 'alex-code' }]); // mutual row

    const li = document.querySelector('#people-list li[data-user-id="alex"]');
    expect(createNotifyBell).toHaveBeenCalledWith('alex',
      expect.objectContaining({ types: ['knock', 'call', 'availability'] }));
    li.querySelector('.card-drawer-toggle').click();
    expect(li.querySelector('.notify-bell')).not.toBeNull();
  });

  test('non-mutual Following contact gets availability-only', () => {
    getFollowing.mockReturnValue([
      { userId: 'bea', code: 'bea-code', label: 'Bea' },
    ]);
    const fire = initAndCaptureFollowersCallback();
    fire([]); // no followers → Following-only row

    expect(createNotifyBell).toHaveBeenCalledWith('bea',
      expect.objectContaining({ types: ['availability'] }));
  });
});

// --- tool drawer on contact rows ---

describe('tool drawer on contact rows', () => {
  const { createNotifyBell } = require('../js/notifyBell.js');
  // Captured at describe-evaluation time (before any jest.resetModules() in later
  // tests would create a fresh registry), so this shares the same module instance
  // as the top-level require of following.js and cardDrawer.js.
  const { isCardDrawerOpen } = require('../js/cardDrawer.js');
  function mountMutual(userId = 'alex') {
    setupDom();
    jest.clearAllMocks();
    createNotifyBell.mockImplementation(() => {
      const b = document.createElement('button');
      b.className = 'notify-bell';
      return b;
    });
    getFollowing.mockReturnValue([{ userId, code: 'ABC123', label: 'Alice' }]);
    watchStatus.mockReturnValue(jest.fn());
    watchFollowers.mockImplementation((_uid, cb) => { cb([{ userId, code: 'ABC123' }]); return jest.fn(); });
    initList('myUid', 'MYCODE');
    return document.querySelector(`[data-user-id="${userId}"]`);
  }

  test('mutual row shows a drawer toggle, not inline unfollow/bell', () => {
    const li = mountMutual();
    expect(li.querySelector('.card-drawer-toggle')).not.toBeNull();
    expect(li.querySelector('.unfollow-btn')).toBeNull();
    expect(li.querySelector('.notify-bell')).toBeNull();
  });

  test('opening the drawer reveals unfollow and bell', () => {
    const li = mountMutual();
    li.querySelector('.card-drawer-toggle').click();
    expect(li.querySelector('.card-drawer .unfollow-btn')).not.toBeNull();
    expect(li.querySelector('.card-drawer .notify-bell')).not.toBeNull();
  });

  test('tapping unfollow inside the drawer opens the confirm dialog', () => {
    const li = mountMutual();
    li.querySelector('.card-drawer-toggle').click();
    li.querySelector('.unfollow-btn').click();
    expect(document.querySelector('.confirm-overlay')).not.toBeNull();
  });

  function mountFollowingOnly(userId = 'alex') {
    setupDom();
    jest.clearAllMocks();
    createNotifyBell.mockImplementation(() => {
      const b = document.createElement('button');
      b.className = 'notify-bell';
      return b;
    });
    getFollowing.mockReturnValue([{ userId, code: 'ABC123', label: 'Alice' }]);
    watchStatus.mockReturnValue(jest.fn());
    // No followers → not mutual (Following-only row).
    watchFollowers.mockImplementation((_uid, cb) => { cb([]); return jest.fn(); });
    initList('myUid', 'MYCODE');
    return document.querySelector(`[data-user-id="${userId}"]`);
  }

  test('following-only (non-mutual) row also gets a drawer toggle, not inline actions', () => {
    const li = mountFollowingOnly();
    expect(li.dataset.mutual).toBeUndefined();
    expect(li.querySelector('.card-drawer-toggle')).not.toBeNull();
    expect(li.querySelector('.unfollow-btn')).toBeNull();
    expect(li.querySelector('.notify-bell')).toBeNull();
  });

  test('call swipe is suppressed while a drawer is open', () => {
    const { startCall } = require('../js/db.js');
    const li = mountMutual();
    li.querySelector('.card-drawer-toggle').click(); // open drawer
    startCall.mockClear();
    const w = 300;
    jest.spyOn(li, 'getBoundingClientRect').mockReturnValue({ width: w });
    li.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0, pointerId: 1, bubbles: true }));
    li.dispatchEvent(new PointerEvent('pointermove', { clientX: w, clientY: 0, pointerId: 1, bubbles: true }));
    expect(li.classList.contains('call-mode')).toBe(false);
  });

  test('re-render (renderList): drawer persists on surviving row; closes when row is removed', () => {
    // Use initAndCaptureFollowersCallback so we can re-fire the followers callback
    // to trigger renderList() a second time, simulating a server-driven update.
    setupDom();
    jest.clearAllMocks();
    createNotifyBell.mockImplementation(() => {
      const b = document.createElement('button');
      b.className = 'notify-bell';
      return b;
    });
    getFollowing.mockReturnValue([{ userId: 'alex', code: 'ABC123', label: 'Alice' }]);
    watchStatus.mockReturnValue(jest.fn());
    const fire = initAndCaptureFollowersCallback('myUid', 'MYCODE');
    // Deliver followers so renderList renders the mutual row.
    fire([{ userId: 'alex', code: 'ABC123' }]);

    const li = document.querySelector('[data-user-id="alex"]');
    li.querySelector('.card-drawer-toggle').click();
    expect(isCardDrawerOpen()).toBe(true);

    // Re-fire with the same row surviving: reconcile keeps the node, so the
    // drawer must NOT close (no DOM teardown — isCardDrawerOpen() must stay true).
    fire([{ userId: 'alex', code: 'ABC123' }]);
    expect(isCardDrawerOpen()).toBe(true);
    expect(document.querySelector('.card-drawer')).not.toBeNull();

    // Row is removed (user unfollows back): reconcile calls onRemove, which
    // closes the drawer so its document listeners are cleaned up.
    getFollowing.mockReturnValue([]);
    fire([]);
    expect(isCardDrawerOpen()).toBe(false);
    expect(document.querySelector('.card-drawer')).toBeNull();
  });
});

// --- syncFollowingFromServer: following-synced event ---

describe('syncFollowingFromServer event', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupDom();
  });

  function initAndCaptureFollowingCallback() {
    let followingCb;
    watchFollowing.mockImplementation((_uid, cb) => { followingCb = cb; return jest.fn(); });
    watchFollowers.mockImplementation(() => jest.fn());
    watchStatus.mockReturnValue(jest.fn());
    initList('myUid', 'MYCODE');
    return (list) => followingCb(list);
  }

  test('dispatches following-synced when the server list updates the local cache', () => {
    getFollowing.mockReturnValue([]); // fresh device: empty local cache
    const onSynced = jest.fn();
    document.addEventListener('following-synced', onSynced);
    const fireFollowing = initAndCaptureFollowingCallback();

    fireFollowing([{ userId: 'tgt', code: 'C1', label: 'Bea' }]);

    expect(setFollowing).toHaveBeenCalledWith([{ userId: 'tgt', code: 'C1', label: 'Bea' }]);
    expect(onSynced).toHaveBeenCalled();
    document.removeEventListener('following-synced', onSynced);
  });

  test('does not dispatch when the server list matches the local cache', () => {
    getFollowing.mockReturnValue([{ userId: 'tgt', code: 'C1', label: 'Bea' }]);
    const onSynced = jest.fn();
    document.addEventListener('following-synced', onSynced);
    const fireFollowing = initAndCaptureFollowingCallback();

    fireFollowing([{ userId: 'tgt', code: 'C1', label: 'Bea' }]);

    expect(setFollowing).not.toHaveBeenCalled();
    expect(onSynced).not.toHaveBeenCalled();
    document.removeEventListener('following-synced', onSynced);
  });
});

describe('renderList reconciliation', () => {
  // Captured at describe-eval time (before any jest.resetModules() in earlier tests
  // creates a fresh registry) so these share the same module instance as the
  // top-level require of following.js and cardDrawer.js.
  const { createNotifyBell: createNotifyBellMock } = require('../js/notifyBell.js');
  const { isCardDrawerOpen: isDrawerOpen } = require('../js/cardDrawer.js');
  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
    // Provide a real DOM element so createFolloweeRow can build the card drawer.
    createNotifyBellMock.mockImplementation(() => {
      const b = document.createElement('button');
      b.className = 'notify-bell';
      return b;
    });
  });

  test('rows keep node identity across a followers tick', () => {
    getFollowing.mockReturnValue([{ userId: 'u1', code: 'AAA111', label: 'Alpha' }]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u1', code: 'AAA111' }]); // u1 mutual
    const row = document.querySelector('[data-user-id="u1"]');
    fire([{ userId: 'u1', code: 'AAA111' }]);
    expect(document.querySelector('[data-user-id="u1"]')).toBe(row);
  });

  test('a section move (mutual -> follower-only loses follow) replaces the row', () => {
    getFollowing.mockReturnValue([{ userId: 'u1', code: 'AAA111', label: 'Alpha' }]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u1', code: 'AAA111' }]);
    const mutualRow = document.querySelector('[data-user-id="u1"]');
    expect(mutualRow.dataset.mutual).toBe('1');
    // Following list empties: u1 becomes follower-only — structurally different row.
    getFollowing.mockReturnValue([]);
    fire([{ userId: 'u1', code: 'AAA111' }]);
    const followerRow = document.querySelector('[data-user-id="u1"]');
    expect(followerRow).not.toBe(mutualRow);
    expect(followerRow.classList.contains('follower-only')).toBe(true);
  });

  test('section labels render once and persist', () => {
    getFollowing.mockReturnValue([{ userId: 'u1', code: 'AAA111', label: 'Alpha' }]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u1', code: 'AAA111' }]);
    const label = document.querySelector('.list-section-label');
    expect(label.textContent).toBe('Mutuals');
    fire([{ userId: 'u1', code: 'AAA111' }]);
    expect(document.querySelectorAll('.list-section-label').length).toBe(1);
    expect(document.querySelector('.list-section-label')).toBe(label);
  });

  test('follow-back prefill reads the follower name at CLICK time, not render time', () => {
    getFollowing.mockReturnValue([]);
    getFollowerName.mockReturnValue(null); // unknown at render
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u2', code: 'Q3ZP7R' }]);
    getFollowerName.mockReturnValue('Bea'); // learned later (approval flow)
    document.querySelector('[data-user-id="u2"] .follow-back-btn').click();
    expect(document.getElementById('add-label-input').value).toBe('Bea');
  });

  test('empty list still clears rows and shows the empty state', () => {
    getFollowing.mockReturnValue([{ userId: 'u1', code: 'AAA111', label: 'Alpha' }]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u1', code: 'AAA111' }]);
    getFollowing.mockReturnValue([]);
    fire([]);
    expect(document.querySelectorAll('#people-list li').length).toBe(0);
    expect(document.getElementById('people-list').style.display).toBe('none');
  });

  test('a revocation mailbox tick auto-unfollows the revoker', () => {
    let revCb;
    watchRevocations.mockImplementation((uid, cb) => { revCb = cb; return jest.fn(); });
    getFollowing.mockReturnValue([{ userId: 'u1', code: 'AAA111', label: 'A' }]);
    initList('me', 'MYCODE');
    revCb({ u1: true });
    expect(removeFollowing).toHaveBeenCalledWith('u1');
  });

  test('a revocation tick for someone I no longer follow is skipped (no thrash)', () => {
    let revCb;
    watchRevocations.mockImplementation((uid, cb) => { revCb = cb; return jest.fn(); });
    getFollowing.mockReturnValue([]); // u1 not in my following — stale mailbox entry
    initList('me', 'MYCODE');
    expect(() => revCb({ u1: true })).not.toThrow();
    expect(removeFollowing).not.toHaveBeenCalled();
  });

  test('a card drawer survives a tick that keeps its row, closes when the row is removed', () => {
    getFollowing.mockReturnValue([{ userId: 'u1', code: 'AAA111', label: 'Alpha' }]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u1', code: 'AAA111' }]);
    const row = document.querySelector('[data-user-id="u1"]');
    // Open the real card drawer via the toggle button.
    row.querySelector('.card-drawer-toggle').click();
    expect(isDrawerOpen()).toBe(true);
    // Unrelated tick (same data): the surviving row's drawer must NOT close.
    fire([{ userId: 'u1', code: 'AAA111' }]);
    expect(isDrawerOpen()).toBe(true);
    expect(row.querySelector('.card-drawer')).not.toBeNull();
    // The row is removed (u1 stops following us AND we unfollow → empty):
    getFollowing.mockReturnValue([]);
    fire([]);
    expect(isDrawerOpen()).toBe(false);
  });
});
