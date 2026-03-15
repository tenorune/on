// tests/following.test.js
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
}));
jest.mock('../js/store.js', () => ({
  getFollowing: jest.fn(),
  addFollowing: jest.fn(),
  removeFollowing: jest.fn(),
  renameFollowing: jest.fn(),
  updateFollowingCode: jest.fn(),
}));

const { watchStatus, watchFollowers } = require('../js/db.js');
const { getFollowing, updateFollowingCode } = require('../js/store.js');
const { initList } = require('../js/following.js');

function setupDom() {
  document.body.innerHTML = `
    <ul id="people-list"></ul>
    <p id="empty-list-msg" class="hidden">Add someone below to get started.</p>
    <button id="add-person-btn"></button>
    <div id="add-person-form" class="hidden">
      <input id="add-code-input" />
      <input id="add-label-input" />
      <p id="add-error" class="hidden"></p>
      <button id="add-submit-btn"></button>
      <button id="add-cancel-btn"></button>
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
    expect(document.getElementById('add-person-form').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('add-person-btn').classList.contains('hidden')).toBe(true);
  });
});

// --- renderList: name display (moved from mycode.test.js) ---

describe('renderList: name display on mutual rows', () => {
  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
  });

  test('mutual row with non-empty label shows .person-follower-name with code', () => {
    getFollowing.mockReturnValue([
      { userId: 'u1', code: 'XY9K2M', label: 'Alice' },
    ]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u1', code: 'XY9K2M' }]);

    const li = document.querySelector('[data-user-id="u1"]');
    const nameEl = li.querySelector('.person-follower-name');
    expect(nameEl).not.toBeNull();
    expect(nameEl.textContent).toBe('XY9K2M');
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
