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
  createRequestFollowButton,
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

describe('createRequestFollowButton', () => {
  test('renders "Request to follow"; click sends and flips to disabled "Requested"', async () => {
    const btn = createRequestFollowButton('me', 'tgt', 'g1');
    expect(btn.textContent).toBe('Request to follow');
    expect(btn.disabled).toBe(false);
    btn.click();
    await Promise.resolve(); await Promise.resolve();
    expect(db.writeFollowRequest).toHaveBeenCalledWith('me', 'tgt', 'g1');
    expect(btn.textContent).toBe('Requested');
    expect(btn.disabled).toBe(true);
  });

  test('renders disabled "Requested" when already requested', () => {
    localStorage.setItem('statusapp_follow_requested', JSON.stringify(['tgt']));
    const btn = createRequestFollowButton('me', 'tgt', 'g1');
    expect(btn.textContent).toBe('Requested');
    expect(btn.disabled).toBe(true);
  });

  test('a click does not bubble to the row (knock guard)', () => {
    const btn = createRequestFollowButton('me', 'tgt', 'g1');
    const row = document.createElement('li');
    const onRow = jest.fn();
    row.addEventListener('click', onRow);
    row.appendChild(btn);
    btn.click();
    expect(onRow).not.toHaveBeenCalled();
  });
});
