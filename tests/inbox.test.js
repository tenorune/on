// tests/inbox.test.js
jest.mock('../js/db.js', () => ({
  watchPendingInvites: jest.fn(),
  deletePendingInvite: jest.fn().mockResolvedValue(undefined),
  readGroup: jest.fn(),
  readMember: jest.fn().mockResolvedValue(null),
  watchFollowRequests: jest.fn(),
  deleteFollowRequest: jest.fn().mockResolvedValue(undefined),
  writeFollowGrant: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../js/groups.js', () => ({
  joinGroup: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../js/groupNav.js', () => ({
  navigateToGroup: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../js/prefs.js', () => ({
  getFollowing: jest.fn(() => [
    { userId: 'uOwner1', code: 'codeOwn1', label: 'Owner One' },
    { userId: 'uOwner2', code: 'codeOwn2', label: 'Owner Two' },
  ]),
}));
jest.mock('../js/groupDisplayNamePrompt.js', () => ({
  showGroupDisplayNamePrompt: jest.fn().mockResolvedValue('My Group Name'),
}));

jest.mock('../js/store.js', () => ({
  setFollowerName: jest.fn(),
}));

const db = require('../js/db.js');
const store = require('../js/store.js');
const groups = require('../js/groups.js');
const groupNav = require('../js/groupNav.js');
const prompt = require('../js/groupDisplayNamePrompt.js');
const { initInbox, renderInboxNavSlot, openInboxModal, getPendingCount } = require('../js/inbox.js');

function setupDom() {
  document.body.innerHTML = `
    <div id="nav-row-inbox-slot"></div>
    <div id="inbox-modal" class="modal-overlay hidden">
      <div class="modal-card">
        <h2 id="inbox-modal-title"></h2>
        <ul id="inbox-modal-list"></ul>
      </div>
    </div>
    <div id="group-displayname-screen" class="hidden">
      <p id="group-displayname-framing"></p>
      <input id="group-displayname-input" />
      <p id="group-displayname-error" class="hidden"></p>
      <button id="group-displayname-submit-btn"></button>
    </div>
  `;
}

beforeEach(() => {
  jest.clearAllMocks();
  try { localStorage.clear(); } catch { /* no-op */ }
  setupDom();
});

describe('Inbox', () => {
  test('subscribes via watchPendingInvites on init', () => {
    initInbox('me');
    expect(db.watchPendingInvites).toHaveBeenCalledWith('me', expect.any(Function));
  });

  test('a new pending invite glows (.unseen); opening the Inbox clears it', async () => {
    let cb;
    db.watchPendingInvites.mockImplementation((_uid, fn) => { cb = fn; return () => {}; });
    db.readGroup.mockResolvedValue({ name: 'Family' });
    initInbox('me');
    cb({ G1: { from: 'uOwner1', ts: 100 } });
    expect(document.querySelector('#nav-row-inbox-slot .inbox-btn.unseen')).not.toBeNull();
    await openInboxModal();
    // After opening, the (re-rendered) button no longer glows.
    const btn = document.querySelector('#nav-row-inbox-slot .inbox-btn');
    expect(btn).not.toBeNull();
    expect(btn.classList.contains('unseen')).toBe(false);
  });

  test('a re-invite (new ts) glows again after a prior one was seen', async () => {
    let cb;
    db.watchPendingInvites.mockImplementation((_uid, fn) => { cb = fn; return () => {}; });
    db.readGroup.mockResolvedValue({ name: 'Family' });
    initInbox('me');
    cb({ G1: { from: 'uOwner1', ts: 100 } });
    await openInboxModal();                       // seen
    cb({});                                        // declined → mailbox empties
    cb({ G1: { from: 'uOwner1', ts: 200 } });      // re-invited (new ts)
    expect(document.querySelector('#nav-row-inbox-slot .inbox-btn.unseen')).not.toBeNull();
  });

  test('caches readGroup across renders — same group fetched once (#214 R5)', async () => {
    let cb;
    db.watchPendingInvites.mockImplementation((_uid, fn) => { cb = fn; return () => {}; });
    db.readGroup.mockResolvedValue({ name: 'Family' });
    initInbox('me');
    cb({ G1: { from: 'uOwner1', ts: 100 } });
    await openInboxModal();   // render 1 → readGroup('G1')
    await openInboxModal();   // render 2 → served from the session cache
    expect(db.readGroup).toHaveBeenCalledTimes(1);
    expect(db.readGroup).toHaveBeenCalledWith('G1');
  });

  test('renders no button when there are zero pending invites', () => {
    let cb;
    db.watchPendingInvites.mockImplementation((_uid, fn) => { cb = fn; return () => {}; });
    initInbox('me');
    cb({});
    expect(document.querySelector('#nav-row-inbox-slot .inbox-btn')).toBeNull();
  });

  test('renders into a passed slot node not yet attached to the DOM (reconcile update-before-insert)', () => {
    // reconcileChildren calls update(node) BEFORE inserting a freshly-created
    // node. After a group round-trip the nav-row inbox slot is recreated, so at
    // update time the new slot is detached and the old one is already removed —
    // a getElementById lookup would find nothing and drop the button (Inbox
    // "disappears"). renderInboxNavSlot must paint into the node it's handed.
    let cb;
    db.watchPendingInvites.mockImplementation((_uid, fn) => { cb = fn; return () => {}; });
    initInbox('me');
    cb({ G1: { from: 'uOwner1', ts: 1 } }); // totalCount > 0
    document.getElementById('nav-row-inbox-slot').remove(); // old slot gone (group mode removed it)
    const freshSlot = document.createElement('div'); // new slot, not yet inserted
    freshSlot.id = 'nav-row-inbox-slot';
    renderInboxNavSlot(freshSlot);
    expect(freshSlot.querySelector('.inbox-btn')).not.toBeNull();
  });

  test('renders an Inbox button in the slot when ≥1 pending invite', () => {
    let cb;
    db.watchPendingInvites.mockImplementation((_uid, fn) => { cb = fn; return () => {}; });
    initInbox('me');
    cb({ G1: { from: 'uOwner1', ts: 1 } });
    expect(document.querySelector('#nav-row-inbox-slot .inbox-btn')).not.toBeNull();
  });

  test('opening the Inbox modal lists one row per pending invite', async () => {
    let cb;
    db.watchPendingInvites.mockImplementation((_uid, fn) => { cb = fn; return () => {}; });
    db.readGroup.mockImplementation((gid) => Promise.resolve({ name: gid === 'G1' ? 'Family' : 'Work' }));
    initInbox('me');
    cb({ G1: { from: 'uOwner1', ts: 1 }, G2: { from: 'uOwner2', ts: 2 } });
    await openInboxModal();
    const rows = document.querySelectorAll('#inbox-modal-list .inbox-row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Owner One');
    expect(rows[0].textContent).toContain('Family');
  });

  test('inviter not followed by the invitee → shows their group displayName, never the raw uid', async () => {
    let cb;
    db.watchPendingInvites.mockImplementation((_uid, fn) => { cb = fn; return () => {}; });
    db.readGroup.mockResolvedValue({ name: 'Family' });
    db.readMember.mockResolvedValue({ role: 'owner', displayName: 'Bobby', joinedAt: 1 });
    initInbox('me');
    cb({ G1: { from: 'uStranger', ts: 1 } }); // uStranger is not in getFollowing()
    await openInboxModal();
    const row = document.querySelector('#inbox-modal-list .inbox-row');
    expect(row.textContent).toContain('Bobby');
    expect(row.textContent).not.toContain('uStranger');
  });

  test('inviter unresolvable (not followed, no member record) → "Someone", never the raw uid', async () => {
    let cb;
    db.watchPendingInvites.mockImplementation((_uid, fn) => { cb = fn; return () => {}; });
    db.readGroup.mockResolvedValue({ name: 'Family' });
    db.readMember.mockResolvedValue(null);
    initInbox('me');
    cb({ G1: { from: 'uStranger', ts: 1 } });
    await openInboxModal();
    const row = document.querySelector('#inbox-modal-list .inbox-row');
    expect(row.textContent).toContain('Someone');
    expect(row.textContent).not.toContain('uStranger');
  });

  test('Join prompts for displayName, calls joinGroup, deletes pending, navigates', async () => {
    let cb;
    db.watchPendingInvites.mockImplementation((_uid, fn) => { cb = fn; return () => {}; });
    db.readGroup.mockResolvedValue({ name: 'Family' });
    initInbox('me');
    cb({ G1: { from: 'uOwner1', ts: 1 } });
    await openInboxModal();
    const joinBtn = document.querySelector('#inbox-modal-list .inbox-row[data-group-id="G1"] .inbox-join-btn');
    joinBtn.click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(prompt.showGroupDisplayNamePrompt).toHaveBeenCalledWith('Family');
    expect(groups.joinGroup).toHaveBeenCalledWith('G1', 'me', 'My Group Name');
    expect(db.deletePendingInvite).toHaveBeenCalledWith('me', 'G1');
    expect(groupNav.navigateToGroup).toHaveBeenCalledWith('G1');
  });

  test('Join surfaces an error and keeps the pending invite when joinGroup fails', async () => {
    let cb;
    db.watchPendingInvites.mockImplementation((_uid, fn) => { cb = fn; return () => {}; });
    db.readGroup.mockResolvedValue({ name: 'Family' });
    groups.joinGroup.mockRejectedValueOnce(new Error('Network down'));
    window.alert = jest.fn();
    initInbox('me');
    cb({ G1: { from: 'uOwner1', ts: 1 } });
    await openInboxModal();
    const joinBtn = document.querySelector('#inbox-modal-list .inbox-row[data-group-id="G1"] .inbox-join-btn');
    joinBtn.click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(groups.joinGroup).toHaveBeenCalled();
    // On failure: don't delete the pending invite or navigate (so the Inbox row
    // stays for a retry), surface the error, and re-enable the Join button.
    expect(db.deletePendingInvite).not.toHaveBeenCalled();
    expect(groupNav.navigateToGroup).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith('Network down');
    expect(joinBtn.disabled).toBe(false);
  });

  test('Join on a row where the user is already a member silently dismisses (no prompt, no joinGroup)', async () => {
    let cb;
    db.watchPendingInvites.mockImplementation((_uid, fn) => { cb = fn; return () => {}; });
    db.readGroup.mockResolvedValue({ name: 'Family' });
    db.readMember.mockResolvedValueOnce({ role: 'member', displayName: 'Me', joinedAt: 1 });
    initInbox('me');
    cb({ G1: { from: 'uOwner1', ts: 1 } });
    await openInboxModal();
    const joinBtn = document.querySelector('#inbox-modal-list .inbox-row[data-group-id="G1"] .inbox-join-btn');
    joinBtn.click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(prompt.showGroupDisplayNamePrompt).not.toHaveBeenCalled();
    expect(groups.joinGroup).not.toHaveBeenCalled();
    expect(db.deletePendingInvite).toHaveBeenCalledWith('me', 'G1');
  });

  test('Join on a row whose group has been deleted silently dismisses', async () => {
    let cb;
    db.watchPendingInvites.mockImplementation((_uid, fn) => { cb = fn; return () => {}; });
    db.readGroup.mockResolvedValue(null);
    initInbox('me');
    cb({ G1: { from: 'uOwner1', ts: 1 } });
    await openInboxModal();
    const joinBtn = document.querySelector('#inbox-modal-list .inbox-row[data-group-id="G1"] .inbox-join-btn');
    joinBtn.click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(groups.joinGroup).not.toHaveBeenCalled();
    expect(db.deletePendingInvite).toHaveBeenCalledWith('me', 'G1');
  });

  test('Decline deletes the pending record without joining', async () => {
    let cb;
    db.watchPendingInvites.mockImplementation((_uid, fn) => { cb = fn; return () => {}; });
    db.readGroup.mockResolvedValue({ name: 'Family' });
    initInbox('me');
    cb({ G1: { from: 'uOwner1', ts: 1 } });
    await openInboxModal();
    const declineBtn = document.querySelector('#inbox-modal-list .inbox-row[data-group-id="G1"] .inbox-decline-btn');
    declineBtn.click();
    await Promise.resolve(); await Promise.resolve();
    expect(groups.joinGroup).not.toHaveBeenCalled();
    expect(db.deletePendingInvite).toHaveBeenCalledWith('me', 'G1');
  });

  test('Inbox modal dismisses on overlay click', async () => {
    let cb;
    db.watchPendingInvites.mockImplementation((_uid, fn) => { cb = fn; return () => {}; });
    initInbox('me');
    cb({ G1: { from: 'uOwner1', ts: 1 } });
    await openInboxModal();
    expect(document.getElementById('inbox-modal').classList.contains('hidden')).toBe(false);
    document.getElementById('inbox-modal').click();
    expect(document.getElementById('inbox-modal').classList.contains('hidden')).toBe(true);
  });

  test('Inbox modal does NOT dismiss on card click', async () => {
    let cb;
    db.watchPendingInvites.mockImplementation((_uid, fn) => { cb = fn; return () => {}; });
    initInbox('me');
    cb({ G1: { from: 'uOwner1', ts: 1 } });
    await openInboxModal();
    document.querySelector('#inbox-modal .modal-card').click();
    expect(document.getElementById('inbox-modal').classList.contains('hidden')).toBe(false);
  });

  test('getPendingCount returns the current pending invite count', () => {
    let cb;
    db.watchPendingInvites.mockImplementation((_uid, fn) => { cb = fn; return () => {}; });
    initInbox('me');
    cb({ G1: { from: 'uOwner1', ts: 1 }, G2: { from: 'uOwner2', ts: 2 } });
    expect(getPendingCount()).toBe(2);
  });
});

describe('Inbox — follow requests', () => {
  // Drive both watchers: capture their callbacks so tests can push snapshots.
  function initWithCallbacks() {
    let inviteCb, frCb;
    db.watchPendingInvites.mockImplementation((uid, cb) => { inviteCb = cb; return () => {}; });
    db.watchFollowRequests.mockImplementation((uid, cb) => { frCb = cb; return () => {}; });
    initInbox('me', 'MYCODE');
    return { inviteCb, frCb };
  }

  test('subscribes via watchFollowRequests on init', () => {
    initWithCallbacks();
    expect(db.watchFollowRequests).toHaveBeenCalledWith('me', expect.any(Function));
  });

  test('a follow request alone makes the Inbox nav button appear and glow', () => {
    const { inviteCb, frCb } = initWithCallbacks();
    inviteCb({});
    frCb({ req: { from: 'req', groupId: 'g1', ts: 5 } });
    const btn = document.querySelector('#nav-row-inbox-slot .inbox-btn');
    expect(btn).not.toBeNull();
    expect(btn.classList.contains('unseen')).toBe(true);
  });

  test('renders a follow-request row and Approve writes a grant + deletes the request', async () => {
    // The requester's name resolves from the shared group; the approver's own
    // member record carries the display name the requester saw on the roster.
    db.readMember.mockImplementation(async (gid, uid) =>
      uid === 'me' ? { displayName: 'My Roster Name' } : { displayName: 'Req Name' });
    const { inviteCb, frCb } = initWithCallbacks();
    inviteCb({});
    frCb({ req: { from: 'req', groupId: 'g1', ts: 5 } });

    await openInboxModal();
    const row = document.querySelector('.inbox-row[data-requester-id="req"]');
    expect(row).not.toBeNull();
    expect(row.querySelector('.inbox-row-text').textContent).toBe('Req Name wants to follow you.');

    row.querySelector('.inbox-approve-btn').click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(db.writeFollowGrant).toHaveBeenCalledWith('req', 'me', 'MYCODE', 'My Roster Name');
    expect(db.deleteFollowRequest).toHaveBeenCalledWith('me', 'req');
    // The requester's roster name is remembered for the follower card.
    expect(store.setFollowerName).toHaveBeenCalledWith('req', 'Req Name');
  });

  test('Approve passes no name when the resolved label is the generic fallback', async () => {
    db.readMember.mockResolvedValue(null); // no member records resolve
    const { inviteCb, frCb } = initWithCallbacks();
    inviteCb({});
    frCb({ req: { from: 'req', groupId: 'g1', ts: 5 } });

    await openInboxModal();
    document.querySelector('.inbox-row[data-requester-id="req"] .inbox-approve-btn').click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(db.writeFollowGrant).toHaveBeenCalledWith('req', 'me', 'MYCODE', null);
    expect(store.setFollowerName).not.toHaveBeenCalled();
  });

  test('Decline deletes the request only (no grant)', async () => {
    db.readMember.mockResolvedValue({ displayName: 'Req Name' });
    const { inviteCb, frCb } = initWithCallbacks();
    inviteCb({});
    frCb({ req: { from: 'req', groupId: 'g1', ts: 5 } });

    await openInboxModal();
    document.querySelector('.inbox-row[data-requester-id="req"] .inbox-fr-decline-btn').click();
    await Promise.resolve();
    expect(db.deleteFollowRequest).toHaveBeenCalledWith('me', 'req');
    expect(db.writeFollowGrant).not.toHaveBeenCalled();
  });

  test('uses the viewer label for the requester when followed', async () => {
    // prefs.getFollowing mock returns uOwner1 labelled "Owner One"
    const { inviteCb, frCb } = initWithCallbacks();
    inviteCb({});
    frCb({ uOwner1: { from: 'uOwner1', groupId: 'g1', ts: 7 } });
    await openInboxModal();
    const row = document.querySelector('.inbox-row[data-requester-id="uOwner1"]');
    expect(row.querySelector('.inbox-row-text').textContent).toBe('Owner One wants to follow you.');
    expect(db.readMember).not.toHaveBeenCalledWith('g1', 'uOwner1');
  });

  test('a failed Approve re-enables the button and does not delete the request', async () => {
    db.readMember.mockResolvedValue({ displayName: 'Req Name' });
    db.writeFollowGrant.mockRejectedValueOnce(new Error('offline'));
    window.alert = jest.fn();
    const { inviteCb, frCb } = initWithCallbacks();
    inviteCb({});
    frCb({ req: { from: 'req', groupId: 'g1', ts: 5 } });

    await openInboxModal();
    const btn = document.querySelector('.inbox-row[data-requester-id="req"] .inbox-approve-btn');
    btn.click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(db.deleteFollowRequest).not.toHaveBeenCalled();
    expect(btn.disabled).toBe(false);
    expect(window.alert).toHaveBeenCalled();
  });
});

describe('foreground resync', () => {
  // A backgrounded/suspended PWA misses live onValue ticks, so an invite or
  // follow-request that arrives while the app is hidden never reaches the inbox
  // until a full restart. Re-subscribe the watchers when the app returns to the
  // foreground (mirrors knock.js's visibilitychange re-init).
  test('re-subscribes both watchers when the app becomes visible', () => {
    db.watchPendingInvites.mockReturnValue(() => {});
    db.watchFollowRequests.mockReturnValue(() => {});
    initInbox('me', 'CODE');
    const invitesBefore = db.watchPendingInvites.mock.calls.length;
    const frBefore = db.watchFollowRequests.mock.calls.length;

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(db.watchPendingInvites.mock.calls.length).toBe(invitesBefore + 1);
    expect(db.watchFollowRequests.mock.calls.length).toBe(frBefore + 1);
  });

  test('does nothing while the app is hidden', () => {
    db.watchPendingInvites.mockReturnValue(() => {});
    db.watchFollowRequests.mockReturnValue(() => {});
    initInbox('me', 'CODE');
    const invitesBefore = db.watchPendingInvites.mock.calls.length;

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(db.watchPendingInvites.mock.calls.length).toBe(invitesBefore);
  });
});
