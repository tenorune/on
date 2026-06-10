// tests/followRequests.test.js
jest.mock('../js/db.js', () => ({
  writeFollowRequest: jest.fn().mockResolvedValue(undefined),
  deleteFollowRequest: jest.fn().mockResolvedValue(undefined),
  watchFollowGrants: jest.fn(() => () => {}),
  deleteFollowGrant: jest.fn().mockResolvedValue(undefined),
  setFollowingEntry: jest.fn().mockResolvedValue(undefined),
  registerAsFollower: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../js/prefs.js', () => ({
  getFollowing: jest.fn(() => []),
}));
jest.mock('../js/groups.js', () => ({
  showToast: jest.fn(),
}));

const db = require('../js/db.js');
const prefs = require('../js/prefs.js');
const { showToast } = require('../js/groups.js');
const {
  requestToFollow, cancelFollowRequest, isRequested, isFollowRequestEligible,
  createRequestFollowButton, initFollowGrants,
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
  // Settle the click handler's awaits.
  const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

  test('renders the circled-plus icon, unrequested state', () => {
    const btn = createRequestFollowButton('me', 'tgt', 'g1', 'Bea');
    expect(btn.querySelector('svg')).not.toBeNull();
    expect(btn.classList.contains('requested')).toBe(false);
    expect(btn.getAttribute('aria-label')).toBe('Request to follow');
    expect(btn.disabled).toBe(false);
  });

  test('click sends the request, flips to requested (white) and toasts', async () => {
    const btn = createRequestFollowButton('me', 'tgt', 'g1', 'Bea');
    btn.click();
    await settle();
    expect(db.writeFollowRequest).toHaveBeenCalledWith('me', 'tgt', 'g1');
    expect(btn.classList.contains('requested')).toBe(true);
    expect(btn.getAttribute('aria-label')).toBe('Cancel follow request');
    expect(btn.disabled).toBe(false); // toggle stays tappable (cancel)
    expect(showToast).toHaveBeenCalledWith('You requested to follow Bea.');
  });

  test('renders requested state when already requested, still enabled', () => {
    localStorage.setItem('statusapp_follow_requested', JSON.stringify(['tgt']));
    const btn = createRequestFollowButton('me', 'tgt', 'g1', 'Bea');
    expect(btn.classList.contains('requested')).toBe(true);
    expect(btn.getAttribute('aria-label')).toBe('Cancel follow request');
    expect(btn.disabled).toBe(false);
  });

  test('click while requested cancels: deletes the request, clears state, toasts', async () => {
    localStorage.setItem('statusapp_follow_requested', JSON.stringify(['tgt']));
    const btn = createRequestFollowButton('me', 'tgt', 'g1', 'Bea');
    btn.click();
    await settle();
    expect(db.deleteFollowRequest).toHaveBeenCalledWith('tgt', 'me');
    expect(db.writeFollowRequest).not.toHaveBeenCalled();
    expect(isRequested('tgt')).toBe(false);
    expect(btn.classList.contains('requested')).toBe(false);
    expect(btn.getAttribute('aria-label')).toBe('Request to follow');
    expect(showToast).toHaveBeenCalledWith('You cancelled your request to follow Bea.');
  });

  test('a click does not bubble to the row (knock guard)', () => {
    const btn = createRequestFollowButton('me', 'tgt', 'g1', 'Bea');
    const row = document.createElement('li');
    const onRow = jest.fn();
    row.addEventListener('click', onRow);
    row.appendChild(btn);
    btn.click();
    expect(onRow).not.toHaveBeenCalled();
  });

  test('stays unrequested and toast-free when the request write fails', async () => {
    db.writeFollowRequest.mockRejectedValueOnce(new Error('offline'));
    const btn = createRequestFollowButton('me', 'tgt', 'g1', 'Bea');
    btn.click();
    await settle();
    expect(btn.disabled).toBe(false);
    expect(btn.classList.contains('requested')).toBe(false);
    expect(isRequested('tgt')).toBe(false);
    expect(showToast).not.toHaveBeenCalled();
  });

  test('a click on a stale button (target now followed) sends nothing', async () => {
    // Rendered while the following cache was empty, clicked after it synced.
    const btn = createRequestFollowButton('me', 'tgt', 'g1', 'Bea');
    prefs.getFollowing.mockReturnValue([{ userId: 'tgt' }]);
    btn.click();
    await settle();
    expect(db.writeFollowRequest).not.toHaveBeenCalled();
    expect(isRequested('tgt')).toBe(false);
    expect(showToast).not.toHaveBeenCalled();
  });
});

describe('cancelFollowRequest', () => {
  test('deletes the mailbox entry and clears the local marker', async () => {
    localStorage.setItem('statusapp_follow_requested', JSON.stringify(['tgt']));
    await cancelFollowRequest('me', 'tgt');
    expect(db.deleteFollowRequest).toHaveBeenCalledWith('tgt', 'me');
    expect(isRequested('tgt')).toBe(false);
  });
});

describe('initFollowGrants', () => {
  test('on a grant: completes the follow (both primitives), deletes grant, clears requested', async () => {
    localStorage.setItem('statusapp_follow_requested', JSON.stringify(['tgt']));
    let cb;
    db.watchFollowGrants.mockImplementation((uid, fn) => { cb = fn; return () => {}; });

    initFollowGrants('me', 'MYCODE');
    expect(db.watchFollowGrants).toHaveBeenCalledWith('me', expect.any(Function));

    await cb({ tgt: { from: 'tgt', code: 'TGTCODE', ts: 1 } });

    expect(db.setFollowingEntry).toHaveBeenCalledWith('me', 'tgt', 'TGTCODE', '');
    expect(db.registerAsFollower).toHaveBeenCalledWith('tgt', 'me', 'MYCODE');
    expect(db.deleteFollowGrant).toHaveBeenCalledWith('me', 'tgt');
    expect(isRequested('tgt')).toBe(false);
  });

  test('ignores a grant with no code', async () => {
    let cb;
    db.watchFollowGrants.mockImplementation((uid, fn) => { cb = fn; return () => {}; });
    initFollowGrants('me', 'MYCODE');
    await cb({ tgt: { from: 'tgt', ts: 1 } });
    expect(db.setFollowingEntry).not.toHaveBeenCalled();
    expect(db.deleteFollowGrant).not.toHaveBeenCalled();
  });

  test('a failed follow write leaves the grant in place (no delete)', async () => {
    let cb;
    db.watchFollowGrants.mockImplementation((uid, fn) => { cb = fn; return () => {}; });
    db.setFollowingEntry.mockRejectedValueOnce(new Error('offline'));
    initFollowGrants('me', 'MYCODE');
    await cb({ tgt: { from: 'tgt', code: 'TGTCODE', ts: 1 } });
    expect(db.deleteFollowGrant).not.toHaveBeenCalled();
  });

  test('processes multiple grants in one tick', async () => {
    let cb;
    db.watchFollowGrants.mockImplementation((uid, fn) => { cb = fn; return () => {}; });
    initFollowGrants('me', 'MYCODE');
    await cb({
      t1: { from: 't1', code: 'C1', ts: 1 },
      t2: { from: 't2', code: 'C2', ts: 2 },
    });
    expect(db.setFollowingEntry).toHaveBeenCalledWith('me', 't1', 'C1', '');
    expect(db.setFollowingEntry).toHaveBeenCalledWith('me', 't2', 'C2', '');
    expect(db.deleteFollowGrant).toHaveBeenCalledWith('me', 't1');
    expect(db.deleteFollowGrant).toHaveBeenCalledWith('me', 't2');
  });

  test('a tick arriving mid-flight does not re-process the same grant', async () => {
    let cb;
    db.watchFollowGrants.mockImplementation((uid, fn) => { cb = fn; return () => {}; });
    // Hold the first setFollowingEntry open so the first tick is mid-flight.
    let release;
    db.setFollowingEntry.mockImplementationOnce(() => new Promise((res) => { release = res; }));
    initFollowGrants('me', 'MYCODE');
    const first = cb({ tgt: { from: 'tgt', code: 'TGTCODE', ts: 1 } });
    // Echo tick with the grant still present while the first is blocked.
    const second = cb({ tgt: { from: 'tgt', code: 'TGTCODE', ts: 1 } });
    await second;
    release();
    await first;
    expect(db.setFollowingEntry).toHaveBeenCalledTimes(1);
    expect(db.registerAsFollower).toHaveBeenCalledTimes(1);
    expect(db.deleteFollowGrant).toHaveBeenCalledTimes(1);
  });
});
