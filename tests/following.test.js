// tests/following.test.js
// Mock db.js directly — prevents Firebase from loading (same pattern as mycode.test.js).
// utils.js needs no mock; it's a pure function with no external dependencies.
jest.mock('../js/db.js', () => ({
  lookupCode: jest.fn(),
  watchStatus: jest.fn(),
  registerAsFollower: jest.fn(),
  unregisterAsFollower: jest.fn(),
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

const { watchStatus } = require('../js/db.js');
const { getFollowing, updateFollowingCode } = require('../js/store.js');
const { initFollowingTab } = require('../js/following.js');

function setupDom() {
  document.body.innerHTML = `
    <ul id="following-list"></ul>
    <button id="add-person-btn"></button>
    <div id="add-person-form" class="hidden">
      <input id="add-code-input" />
      <input id="add-label-input" />
      <div id="add-error" class="hidden"></div>
      <button id="add-submit-btn"></button>
      <button id="add-cancel-btn"></button>
    </div>
    <div id="offline-banner" class="hidden"></div>
  `;
}

describe('subscribeToFollowee — code-change sync', () => {
  let watchStatusCallback;

  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();

    watchStatus.mockImplementation((_userId, cb) => {
      watchStatusCallback = cb;
      return jest.fn(); // unsubscribe fn
    });

    getFollowing.mockReturnValue([
      { userId: 'u1', code: 'OLD123', label: 'Alice' },
    ]);

    initFollowingTab('myUserId', 'MYCODE');
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
