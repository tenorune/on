// tests/followRequests.test.js
jest.mock('../js/db.js', () => ({
  writeFollowRequest: jest.fn().mockResolvedValue(undefined),
  watchFollowGrants: jest.fn(() => () => {}),
  deleteFollowGrant: jest.fn().mockResolvedValue(undefined),
  setFollowingEntry: jest.fn().mockResolvedValue(undefined),
  registerAsFollower: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../js/prefs.js', () => ({
  getFollowing: jest.fn(() => []),
}));

const db = require('../js/db.js');
const prefs = require('../js/prefs.js');
const {
  requestToFollow, isRequested, isFollowRequestEligible,
} = require('../js/followRequests.js');

beforeEach(() => {
  jest.clearAllMocks();
  try { localStorage.clear(); } catch { /* no-op */ }
  prefs.getFollowing.mockReturnValue([]);
});

describe('requestToFollow', () => {
  test('writes the request and marks it requested (persisted)', async () => {
    expect(isRequested('tgt')).toBe(false);
    await requestToFollow('me', 'tgt', 'g1');
    expect(db.writeFollowRequest).toHaveBeenCalledWith('me', 'tgt', 'g1');
    expect(isRequested('tgt')).toBe(true);
    expect(JSON.parse(localStorage.getItem('statusapp_follow_requested'))).toContain('tgt');
  });
});

describe('isFollowRequestEligible', () => {
  test('true when not already following', () => {
    prefs.getFollowing.mockReturnValue([{ userId: 'other' }]);
    expect(isFollowRequestEligible('tgt')).toBe(true);
  });
  test('false when already following', () => {
    prefs.getFollowing.mockReturnValue([{ userId: 'tgt' }]);
    expect(isFollowRequestEligible('tgt')).toBe(false);
  });
});
