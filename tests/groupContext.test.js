// tests/groupContext.test.js
jest.mock('../js/db.js', () => ({
  readGroup: jest.fn().mockResolvedValue(null),
  watchGroupMeta: jest.fn(() => () => {}),
  watchGroupMembers: jest.fn(() => () => {}),
  watchStatus: jest.fn(() => () => {}),
  removeUserGroupsEntry: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../js/groupNav.js', () => ({
  navigateToDirect: jest.fn().mockResolvedValue(undefined),
  getCurrentContext: jest.fn(() => ({ context: 'group', groupId: 'G1' })),
}));
jest.mock('../js/groups.js', () => ({
  renameGroup: jest.fn().mockResolvedValue(undefined),
  deleteGroup: jest.fn().mockResolvedValue(undefined),
  leaveGroup: jest.fn().mockResolvedValue(undefined),
  editOwnDisplayName: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../js/inviteModal.js', () => ({
  openInviteModal: jest.fn(),
}));

const db = require('../js/db.js');
const groupNav = require('../js/groupNav.js');
const groupsModule = require('../js/groups.js');
const inviteModal = require('../js/inviteModal.js');
const { enterGroupContext, exitGroupContext } = require('../js/groupContext');

function setupContextDom() {
  document.body.innerHTML = `
    <div id="main-ui-direct"></div>
    <div id="group-context-root" class="group-context-root hidden">
      <div class="group-breadcrumb">
        <button id="group-breadcrumb-back">←</button>
        <span id="group-breadcrumb-name"></span>
      </div>
      <header class="group-context-header">
        <h2 id="group-context-name"></h2>
        <details id="group-context-actions">
          <summary>Settings</summary>
          <div class="group-actions-menu">
            <button id="group-action-rename" class="hidden">Rename group</button>
            <button id="group-action-invite" class="hidden">Invite link</button>
            <button id="group-action-delete" class="hidden">Delete group</button>
            <button id="group-action-edit-name" class="hidden">Edit my name</button>
            <button id="group-action-leave" class="hidden">Leave group</button>
          </div>
        </details>
      </header>
      <ul id="group-roster"></ul>
    </div>
  `;
}

describe('groupContext scaffolding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupContextDom();
  });

  test('enterGroupContext reveals the root and hides direct UI', () => {
    enterGroupContext('G1', 'me');
    expect(document.getElementById('group-context-root').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('main-ui-direct').classList.contains('hidden')).toBe(true);
  });

  test('enterGroupContext renders the breadcrumb name and header name on watchGroupMeta tick', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'owner', createdAt: 1 });
    expect(document.getElementById('group-breadcrumb-name').textContent).toBe('Family');
    expect(document.getElementById('group-context-name').textContent).toBe('Family');
  });

  test('shows owner-only action buttons when caller is the owner', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    expect(document.getElementById('group-action-rename').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('group-action-invite').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('group-action-delete').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('group-action-edit-name').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('group-action-leave').classList.contains('hidden')).toBe(true);
  });

  test('shows member-only action buttons when caller is a non-owner member', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'someoneElse', createdAt: 1 });
    expect(document.getElementById('group-action-rename').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('group-action-invite').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('group-action-delete').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('group-action-edit-name').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('group-action-leave').classList.contains('hidden')).toBe(false);
  });

  test('breadcrumb back button calls navigateToDirect', () => {
    enterGroupContext('G1', 'me');
    document.getElementById('group-breadcrumb-back').click();
    expect(groupNav.navigateToDirect).toHaveBeenCalled();
  });

  test('exitGroupContext hides the root and shows direct', () => {
    enterGroupContext('G1', 'me');
    exitGroupContext();
    expect(document.getElementById('group-context-root').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('main-ui-direct').classList.contains('hidden')).toBe(false);
  });

  test('watchGroupMeta returning null (owner deleted group) clears the local enumeration entry', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb(null); // group entity was deleted
    expect(db.removeUserGroupsEntry).toHaveBeenCalledWith('me', 'G1');
  });
});

describe('group roster render', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupContextDom();
  });

  test('renders one li per member, with own card first', () => {
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({
      'me': { role: 'member', displayName: 'My Name', joinedAt: 1 },
      'a':  { role: 'member', displayName: 'Alice',   joinedAt: 2 },
      'b':  { role: 'owner',  displayName: 'Bob',     joinedAt: 0 },
    });
    const items = document.querySelectorAll('#group-roster li');
    expect(items.length).toBe(3);
    expect(items[0].dataset.userId).toBe('me');
    expect(items[1].textContent).toContain('Alice');
    expect(items[2].textContent).toContain('Bob');
  });

  test('owner gets the (owner) badge', () => {
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({
      'b': { role: 'owner', displayName: 'Bob', joinedAt: 0 },
    });
    expect(document.querySelector('#group-roster li').textContent).toContain('(owner)');
  });

  test('each member gets a watchStatus subscription', () => {
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({
      'a': { role: 'member', displayName: 'Alice', joinedAt: 1 },
      'b': { role: 'member', displayName: 'Bob',   joinedAt: 2 },
    });
    expect(db.watchStatus).toHaveBeenCalledWith('a', expect.any(Function));
    expect(db.watchStatus).toHaveBeenCalledWith('b', expect.any(Function));
  });

  test('member status updates render the available/unavailable dot', () => {
    let membersCb;
    const statusCbs = {};
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    db.watchStatus.mockImplementation((uid, cb) => { statusCbs[uid] = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({ 'a': { role: 'member', displayName: 'Alice', joinedAt: 1 } });

    statusCbs.a({ status: 'available', statusColor: '#22c55e', availableUntil: Date.now() + 60000 });
    const dot = document.querySelector('#group-roster [data-user-id="a"] .person-dot');
    expect(dot).not.toBeNull();
    expect(dot.dataset.available).toBe('true');
  });

  test('exitGroupContext unsubscribes from member status watchers', () => {
    let membersCb;
    const unsubs = [];
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    db.watchStatus.mockImplementation(() => { const fn = jest.fn(); unsubs.push(fn); return fn; });
    enterGroupContext('G1', 'me');
    membersCb({ 'a': { role: 'member', displayName: 'Alice', joinedAt: 1 } });
    exitGroupContext();
    unsubs.forEach((u) => expect(u).toHaveBeenCalled());
  });

  test('removed members lose their watchStatus subscription on the next tick', () => {
    let membersCb;
    const unsubByUid = {};
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    db.watchStatus.mockImplementation((uid) => { const fn = jest.fn(); unsubByUid[uid] = fn; return fn; });
    enterGroupContext('G1', 'me');
    membersCb({
      'a': { role: 'member', displayName: 'Alice', joinedAt: 1 },
      'b': { role: 'member', displayName: 'Bob', joinedAt: 2 },
    });
    expect(unsubByUid.a).not.toHaveBeenCalled();
    expect(unsubByUid.b).not.toHaveBeenCalled();
    // Subsequent tick: Bob has left.
    membersCb({
      'a': { role: 'member', displayName: 'Alice', joinedAt: 1 },
    });
    expect(unsubByUid.a).not.toHaveBeenCalled(); // Alice's sub stays
    expect(unsubByUid.b).toHaveBeenCalled();     // Bob's sub torn down
  });
});

describe('owner actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupContextDom();
  });

  test('Rename group prompts and calls renameGroup', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    window.prompt = jest.fn(() => '  Familia  ');
    document.getElementById('group-action-rename').click();
    expect(groupsModule.renameGroup).toHaveBeenCalledWith('G1', 'me', 'Familia');
  });

  test('Delete group confirms and calls deleteGroup', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    window.confirm = jest.fn(() => true);
    document.getElementById('group-action-delete').click();
    expect(groupsModule.deleteGroup).toHaveBeenCalledWith('G1', 'me');
  });

  test('Invite link opens the modal with group scope', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    document.getElementById('group-action-invite').click();
    expect(inviteModal.openInviteModal).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'group',
      userId: 'me',
      groupId: 'G1',
      groupName: 'Family',
    }));
  });
});

describe('member actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupContextDom();
  });

  test('Edit my name prompts and calls editOwnDisplayName', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'someoneElse', createdAt: 1 });
    window.prompt = jest.fn(() => '  M. P.  ');
    document.getElementById('group-action-edit-name').click();
    expect(groupsModule.editOwnDisplayName).toHaveBeenCalledWith('G1', 'me', 'M. P.');
  });

  test('Leave group confirms and calls leaveGroup', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'someoneElse', createdAt: 1 });
    window.confirm = jest.fn(() => true);
    document.getElementById('group-action-leave').click();
    expect(groupsModule.leaveGroup).toHaveBeenCalledWith('G1', 'me');
  });
});
