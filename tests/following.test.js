// tests/following.test.js

// PointerEvent polyfill for jsdom (does not implement it natively)
if (typeof PointerEvent === 'undefined') {
  global.PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type, params = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
    }
  };
}

jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, KNOCK_ENABLED: true, CALL_ENABLED: true }));
jest.mock('../js/palettes.js', () => ({
  ...jest.requireActual('../js/palettes.js'),
  getPaletteByKey: jest.fn(),
  applyThemeVars: jest.fn(),
  resetThemeVars: jest.fn(),
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
  setCallState: jest.fn().mockResolvedValue(undefined),
  clearCallState: jest.fn().mockResolvedValue(undefined),
  setStatusColor: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../js/knock.js', () => ({
  sendKnock: jest.fn(),
}));
jest.mock('../js/store.js', () => ({
  getFollowing: jest.fn(),
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
}));

const { watchStatus, watchFollowers, setCallState, clearCallState, setStatusColor } = require('../js/db.js');
const { getFollowing, updateFollowingCode } = require('../js/store.js');
const { getGlowForColor, getPaletteByKey, applyThemeVars, resetThemeVars } = require('../js/palettes.js');
const {
  initList, setFolloweeReadyCallback, updateFolloweeRow, resetRenderedFollowees,
  enterCallMode, exitCallMode, getCallModeCalleeId, reEnterCallMode,
} = require('../js/following.js');

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

  test('updateFolloweeRow NOT called when only knocks key changes', () => {
    setupMutual();
    const baseData = {
      status: 'unavailable', availableUntil: null,
      statusColor: '#22c55e', paletteKey: null, code: 'ABC123',
    };
    fireStatus(baseData); // initial call, sets lastUserData

    const li = document.querySelector('[data-user-id="u1"]');
    const dotBefore = li.querySelector('.person-dot').className;

    // Fire again with only knocks key added — all 5 named fields unchanged
    fireStatus({ ...baseData, knocks: { someUser: { count: 1, ts: Date.now() } } });

    // DOM should not have changed (no re-render)
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

  test('tapping unfollow-btn skips knock', () => {
    const li = setupMutualWithKnock();
    sendKnock.mockClear();
    li.querySelector('.unfollow-btn').click();
    expect(sendKnock).not.toHaveBeenCalled();
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

  test('adds .call-mode and sets --call-color-rgb when callState.calleeId === myUserId', () => {
    const entry = { userId: 'alice', code: 'AAA111', label: 'Alice' };
    makeFolloweeLi('alice');
    updateFolloweeRow(entry, {
      status: 'available',
      availableUntil: Date.now() + 3600000,
      statusColor: '#3b82f6',
      callState: { calleeId: 'myUid', since: Date.now() },
    }, 'myUid');
    const li = document.querySelector('[data-user-id="alice"]');
    expect(li.classList.contains('call-mode')).toBe(true);
    expect(li.style.getPropertyValue('--call-color-rgb')).toBe('59, 130, 246');
  });

  test('removes .call-mode when callState is absent', () => {
    const entry = { userId: 'alice', code: 'AAA111', label: 'Alice' };
    const li = makeFolloweeLi('alice');
    li.classList.add('call-mode');
    li.style.setProperty('--call-color-rgb', '59, 130, 246');
    updateFolloweeRow(entry, {
      status: 'available',
      availableUntil: Date.now() + 3600000,
      statusColor: '#3b82f6',
    }, 'myUid');
    expect(li.classList.contains('call-mode')).toBe(false);
    expect(li.style.getPropertyValue('--call-color-rgb')).toBe('');
  });

  test('removes .call-mode when callState.calleeId !== myUserId', () => {
    const entry = { userId: 'alice', code: 'AAA111', label: 'Alice' };
    const li = makeFolloweeLi('alice');
    li.classList.add('call-mode');
    updateFolloweeRow(entry, {
      status: 'available',
      availableUntil: Date.now() + 3600000,
      statusColor: '#3b82f6',
      callState: { calleeId: 'someoneElse', since: Date.now() },
    }, 'myUid');
    expect(li.classList.contains('call-mode')).toBe(false);
  });

  test('uses fallback #22c55e when statusColor absent', () => {
    const entry = { userId: 'alice', code: 'AAA111', label: 'Alice' };
    makeFolloweeLi('alice');
    updateFolloweeRow(entry, {
      status: 'available',
      availableUntil: Date.now() + 3600000,
      callState: { calleeId: 'myUid', since: Date.now() },
    }, 'myUid');
    const li = document.querySelector('[data-user-id="alice"]');
    expect(li.style.getPropertyValue('--call-color-rgb')).toBe('34, 197, 94');
  });
});

describe('call mode: change-detection guard passes callState changes through', () => {
  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
    resetRenderedFollowees();
  });

  test('updateFolloweeRow fires when only callState changes', () => {
    const entry = { userId: 'alice', code: 'AAA111', label: 'Alice' };
    makeFolloweeLi('alice');

    let statusCallback;
    watchStatus.mockImplementationOnce((_uid, cb) => {
      statusCallback = cb;
      return jest.fn();
    });
    watchFollowers.mockReturnValue(jest.fn());
    getFollowing.mockReturnValue([entry]);

    const fire = initAndCaptureFollowersCallback('myUid', 'MYCODE');
    fire([{ userId: 'alice', code: 'AAA111' }]);

    const baseData = {
      status: 'available',
      availableUntil: Date.now() + 3600000,
      statusColor: '#3b82f6',
      paletteKey: null,
      code: 'AAA111',
    };
    statusCallback(baseData);

    const li = document.querySelector('[data-user-id="alice"]');
    expect(li.classList.contains('call-mode')).toBe(false);

    // Same everything except callState now points to us
    statusCallback({ ...baseData, callState: { calleeId: 'myUid', since: Date.now() } });
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

  test('calls setCallState with callerId and calleeId', () => {
    enterCallMode({ userId: 'alice', code: 'AAA111', label: 'Alice' }, 'myUid');
    expect(setCallState).toHaveBeenCalledWith('myUid', 'alice');
  });

  test('sets --my-status CSS var to callee statusColor from lastUserData', () => {
    // Simulate having cached callee data
    watchStatus.mockImplementationOnce((_uid, cb) => {
      cb({ status: 'available', availableUntil: Date.now() + 3600000, statusColor: '#3b82f6' });
      return jest.fn();
    });
    watchFollowers.mockReturnValue(jest.fn());
    getFollowing.mockReturnValue([{ userId: 'alice', code: 'AAA111', label: 'Alice' }]);
    const fire = initAndCaptureFollowersCallback('myUid', 'MYCODE');
    fire([{ userId: 'alice', code: 'AAA111' }]);

    enterCallMode({ userId: 'alice', code: 'AAA111', label: 'Alice' }, 'myUid');
    expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#3b82f6');
  });

  test('does NOT overwrite snapshot on call mode replacement (second right-swipe)', () => {
    document.documentElement.style.setProperty('--my-status', '#ff0000');
    enterCallMode({ userId: 'alice', code: 'AAA111', label: 'Alice' }, 'myUid');
    // Simulate CSS var changing to callee's color after first entry
    document.documentElement.style.setProperty('--my-status', '#0000ff');
    enterCallMode({ userId: 'bob', code: 'BBB222', label: 'Bob' }, 'myUid');
    // Exit should revert to original #ff0000
    exitCallMode('myUid');
    expect(setStatusColor).toHaveBeenLastCalledWith('myUid', '#ff0000');
  });
});

describe('call mode: exitCallMode', () => {
  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
    resetRenderedFollowees();
    initAndCaptureFollowersCallback('myUid', 'MYCODE');
  });

  test('calls clearCallState with myUserId', () => {
    enterCallMode({ userId: 'alice', code: 'AAA111' }, 'myUid');
    exitCallMode('myUid');
    expect(clearCallState).toHaveBeenCalledWith('myUid');
  });

  test('resets callModeCalleeId to null', () => {
    enterCallMode({ userId: 'alice', code: 'AAA111' }, 'myUid');
    exitCallMode('myUid');
    expect(getCallModeCalleeId()).toBeNull();
  });

  test('reverts --my-status to snapshotted color', () => {
    document.documentElement.style.setProperty('--my-status', '#884400');
    enterCallMode({ userId: 'alice', code: 'AAA111' }, 'myUid');
    exitCallMode('myUid');
    expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#884400');
  });

  test('calls setStatusColor with snapshotted color', () => {
    document.documentElement.style.setProperty('--my-status', '#884400');
    enterCallMode({ userId: 'alice', code: 'AAA111' }, 'myUid');
    jest.clearAllMocks();
    exitCallMode('myUid');
    expect(setStatusColor).toHaveBeenCalledWith('myUid', '#884400');
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

  test('right-swipe past 40% on a mutual card calls setCallState', () => {
    getFollowing.mockReturnValue([{ userId: 'alice', code: 'AAA111', label: 'Alice' }]);
    watchStatus.mockReturnValue(jest.fn());
    const fire = initAndCaptureFollowersCallback('myUid', 'MYCODE');
    fire([{ userId: 'alice', code: 'AAA111' }]);

    const li = document.querySelector('[data-user-id="alice"]');
    jest.spyOn(li, 'getBoundingClientRect').mockReturnValue({ width: 200 });

    firePointer(li, 'pointerdown', 10, 50);
    firePointer(li, 'pointermove', 100, 52); // dx=90 > 200*0.4=80; ratio 90/2 = 45 > 1.5 ✓
    firePointer(li, 'pointerup',   100, 52);

    expect(setCallState).toHaveBeenCalledWith('myUid', 'alice');
  });

  test('left-swipe on caller-side .call-mode card calls clearCallState(myUserId)', () => {
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

    expect(clearCallState).toHaveBeenCalledWith('myUid');
  });

  test('left-swipe on receiver-side .call-mode card calls clearCallState(callerId)', () => {
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

    // alice is the caller (entry.userId = 'alice'), so clearCallState('alice')
    expect(clearCallState).toHaveBeenCalledWith('alice');
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

    expect(setCallState).not.toHaveBeenCalled();
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

    expect(setCallState).not.toHaveBeenCalled();
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

  test('does NOT call setCallState (no Firebase write on restart)', () => {
    reEnterCallMode({ userId: 'alice', code: 'AAA111', label: 'Alice' }, {}, 'myUid');
    expect(setCallState).not.toHaveBeenCalled();
  });

  test('sets --my-status CSS var to calleeData.statusColor', () => {
    reEnterCallMode(
      { userId: 'alice', code: 'AAA111', label: 'Alice' },
      { statusColor: '#3b82f6' },
      'myUid'
    );
    expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#3b82f6');
  });

  test('sets --my-glow CSS var derived from calleeData.statusColor', () => {
    reEnterCallMode(
      { userId: 'alice', code: 'AAA111', label: 'Alice' },
      { statusColor: '#3b82f6' },
      'myUid'
    );
    expect(document.documentElement.style.getPropertyValue('--my-glow')).toBe('rgba(59, 130, 246, 0.4)');
  });

  test('falls back to #22c55e when calleeData has no statusColor', () => {
    reEnterCallMode({ userId: 'alice', code: 'AAA111', label: 'Alice' }, {}, 'myUid');
    expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#22c55e');
  });

  test('applies theme vars when calleeData has a known paletteKey', () => {
    const OCEAN_PALETTE = {
      key: 'ocean', color: '#3b82f6',
      theme: { bg: '#05101e', surface: '#0b1e38', surface2: '#102c52', text: '#eef4ff', textMuted: '#5f9acf' },
    };
    getPaletteByKey.mockReturnValue(OCEAN_PALETTE);
    reEnterCallMode(
      { userId: 'alice', code: 'AAA111', label: 'Alice' },
      { statusColor: '#3b82f6', paletteKey: 'ocean' },
      'myUid'
    );
    expect(getPaletteByKey).toHaveBeenCalledWith('ocean');
    expect(applyThemeVars).toHaveBeenCalledWith(OCEAN_PALETTE.theme);
  });

  test('does NOT call applyThemeVars when calleeData has no paletteKey', () => {
    reEnterCallMode(
      { userId: 'alice', code: 'AAA111', label: 'Alice' },
      { statusColor: '#3b82f6' },
      'myUid'
    );
    expect(applyThemeVars).not.toHaveBeenCalled();
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

  test('no snapshot set — exitCallMode reverts to own palette primary color', () => {
    // When reEnterCallMode is used, callModeSnapshot stays null.
    // exitCallMode should fall back to the active palette color (or #22c55e if none).
    // Ensure getPaletteByKey returns null so fallbackColor = '#22c55e'
    getPaletteByKey.mockReturnValue(null);
    reEnterCallMode({ userId: 'alice', code: 'AAA111', label: 'Alice' }, {}, 'myUid');
    jest.clearAllMocks();
    getPaletteByKey.mockReturnValue(null);
    exitCallMode('myUid');
    // getPaletteState mock returns activePaletteKey: null → fallback is #22c55e
    expect(setStatusColor).toHaveBeenCalledWith('myUid', '#22c55e');
  });
});
