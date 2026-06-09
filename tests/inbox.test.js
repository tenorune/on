// tests/inbox.test.js
jest.mock('../js/db.js', () => ({
  watchPendingInvites: jest.fn(),
  deletePendingInvite: jest.fn().mockResolvedValue(undefined),
  readGroup: jest.fn(),
  readMember: jest.fn().mockResolvedValue(null),
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

const db = require('../js/db.js');
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

  test('renders no button when there are zero pending invites', () => {
    let cb;
    db.watchPendingInvites.mockImplementation((_uid, fn) => { cb = fn; return () => {}; });
    initInbox('me');
    cb({});
    expect(document.querySelector('#nav-row-inbox-slot .inbox-btn')).toBeNull();
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
