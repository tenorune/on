// tests/groupContext.test.js
jest.mock('../js/store.js', () => ({
  getLastTimeout: jest.fn(() => 120),
  setLastTimeout: jest.fn(),
}));
jest.mock('../js/db.js', () => ({
  readGroup: jest.fn().mockResolvedValue(null),
  watchGroupMeta: jest.fn(() => () => {}),
  watchGroupMembers: jest.fn(() => () => {}),
  watchGroupInvites: jest.fn(() => () => {}),
  watchStatus: jest.fn(() => () => {}),
  watchOwnMemberOverride: jest.fn(() => () => {}),
  removeUserGroupsEntry: jest.fn().mockResolvedValue(undefined),
  setLastTimeoutMinutes: jest.fn().mockResolvedValue(undefined),
  timeRemainingMs: jest.fn((availableUntil) => Math.max(0, availableUntil - Date.now())),
  formatTimeRemaining: jest.fn((ms) => {
    if (ms <= 0) return '';
    if (ms < 60000) return '< 1m';
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
  }),
  formatTimeRemainingFuzzy: jest.fn((ms) => {
    if (ms <= 0) return '';
    const hours = ms / 3600000;
    return `about ${Math.round(hours)} hours left`;
  }),
}));
jest.mock('../js/invites.js', () => ({
  buildInviteUrl: jest.fn((token) => `https://app.example/?i=${token}`),
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
  toggleStatusOverride: jest.fn().mockResolvedValue(undefined),
  setOverrideStatusAvailable: jest.fn().mockResolvedValue(undefined),
  setOverrideStatusUnavailable: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../js/inviteModal.js', () => ({
  openInviteModal: jest.fn(),
}));
jest.mock('../js/knock.js', () => ({
  sendKnock: jest.fn(),
  clearGroupCardBadge: jest.fn(),
  drainPendingKnocks: jest.fn(),
  getFloatedUserIds: jest.fn(() => []),
}));
jest.mock('../js/features.js', () => ({
  KNOCK_ENABLED: true,
}));

const db = require('../js/db.js');
const groupNav = require('../js/groupNav.js');
const groupsModule = require('../js/groups.js');
const inviteModal = require('../js/inviteModal.js');
const store = require('../js/store.js');
const { enterGroupContext, exitGroupContext } = require('../js/groupContext');

function setupContextDom() {
  document.body.innerHTML = `
    <div id="nav-row"></div>
    <div id="main-ui-direct"></div>
    <div id="group-context-root" class="group-context-root hidden">
      <header class="group-context-header">
        <div id="group-header-row">
          <div id="group-my-dot" class="dot" data-available="false"></div>
          <div class="group-header-text">
            <div class="group-header-status-row">
              <span id="group-my-status-label" class="status-label">Unavailable</span>
              <span id="group-time-remaining" style="display:none"></span>
            </div>
            <div class="group-header-chips">
              <button id="group-time-chip" class="chip time-chip">2 hours</button>
              <details id="group-context-actions">
                <summary class="chip">Settings</summary>
                <div class="group-actions-menu">
                  <button id="group-action-rename" class="hidden">Rename group</button>
                  <button id="group-action-invite" class="hidden">Invite link</button>
                  <button id="group-action-delete" class="hidden">Delete group</button>
                  <button id="group-action-edit-name" class="hidden">Edit my name</button>
                  <button id="group-action-leave" class="hidden">Leave group</button>
                </div>
              </details>
            </div>
          </div>
        </div>
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

  test('watchGroupMeta tick does not throw when h2 and breadcrumb are absent', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    expect(() => metaCb({ name: 'Family', ownerId: 'owner', createdAt: 1 })).not.toThrow();
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

  test('renders one li per member, alphabetical, excluding the current user', () => {
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({
      'me': { role: 'member', displayName: 'My Name', joinedAt: 1 },
      'a':  { role: 'member', displayName: 'Alice',   joinedAt: 2 },
      'b':  { role: 'owner',  displayName: 'Bob',     joinedAt: 0 },
    });
    const items = document.querySelectorAll('#group-roster li');
    expect(items.length).toBe(2);
    expect(document.querySelector('#group-roster [data-user-id="me"]')).toBeNull();
    expect(items[0].textContent).toContain('Alice');
    expect(items[1].textContent).toContain('Bob');
  });

  test('roster does not render an (owner) badge', () => {
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({
      'b': { role: 'owner', displayName: 'Bob', joinedAt: 0 },
    });
    expect(document.querySelector('#group-roster li').textContent).not.toContain('owner');
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

  test('clicking a member row sends a knock with the current group id (KNOCK_ENABLED)', () => {
    const knock = require('../js/knock.js');
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });
    document.querySelector('#group-roster [data-user-id="a"]').click();
    expect(knock.sendKnock).toHaveBeenCalledWith('a', 'me', undefined, expect.objectContaining({ contextGroupId: 'G1' }));
  });

  test('available member shows "Available for ..." status text', () => {
    let membersCb;
    const statusCbs = {};
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    db.watchStatus.mockImplementation((uid, cb) => { statusCbs[uid] = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });
    statusCbs.a({ status: 'available', availableUntil: Date.now() + 90 * 60000 });
    const statusEl = document.querySelector('#group-roster [data-user-id="a"] .person-status');
    expect(statusEl).not.toBeNull();
    expect(statusEl.textContent).toMatch(/Available for /);
  });

  test('unavailable member shows no status text (just the dot)', () => {
    let membersCb;
    const statusCbs = {};
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    db.watchStatus.mockImplementation((uid, cb) => { statusCbs[uid] = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });
    statusCbs.a({ status: 'unavailable', availableUntil: null });
    const statusEl = document.querySelector('#group-roster [data-user-id="a"] .person-status');
    expect(statusEl.textContent).toBe('');
  });

  test('available members sort to the top of the roster', () => {
    let membersCb;
    const statusCbs = {};
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    db.watchStatus.mockImplementation((uid, cb) => { statusCbs[uid] = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({
      a: { role: 'member', displayName: 'Alice',   joinedAt: 1 },
      b: { role: 'member', displayName: 'Bob',     joinedAt: 2 },
      c: { role: 'member', displayName: 'Carol',   joinedAt: 3 },
    });
    // Mark only Bob available; Alice and Carol stay unavailable.
    statusCbs.b({ status: 'available', availableUntil: Date.now() + 60000 });
    statusCbs.a({ status: 'unavailable', availableUntil: null });
    statusCbs.c({ status: 'unavailable', availableUntil: null });
    const items = document.querySelectorAll('#group-roster li');
    // Bob (available) first; Alice and Carol follow in alphabetical order.
    expect(items[0].dataset.userId).toBe('b');
    expect(items[1].dataset.userId).toBe('a');
    expect(items[2].dataset.userId).toBe('c');
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

  test('activating a settings option closes the Settings menu', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    const details = document.getElementById('group-context-actions');
    details.open = true;
    window.prompt = jest.fn(() => null);
    document.getElementById('group-action-rename').click();
    expect(details.open).toBe(false);
  });

  test('tapping outside the Settings menu closes it', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    const details = document.getElementById('group-context-actions');
    details.open = true;
    document.getElementById('group-roster').click();
    expect(details.open).toBe(false);
  });

  test('tapping inside the Settings menu does not close it', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    const details = document.getElementById('group-context-actions');
    details.open = true;
    // Click on the .group-actions-menu container itself (not an action button)
    document.querySelector('#group-context-actions .group-actions-menu').click();
    expect(details.open).toBe(true);
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

  test('Invite link passes activeInvite when an unrevoked group invite exists', () => {
    let metaCb, invitesCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    db.watchGroupInvites.mockImplementation((groupId, cb) => { invitesCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    invitesCb({
      tok1: { scope: 'group', token: 'tok1', creatorUid: 'me', createdAt: 2, revoked: false },
    });
    document.getElementById('group-action-invite').click();
    expect(inviteModal.openInviteModal).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'group',
      activeInvite: expect.objectContaining({
        token: 'tok1',
        url: expect.stringContaining('tok1'),
      }),
    }));
  });

  test('Invite link passes activeInvite=null when no invites exist', () => {
    let metaCb, invitesCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    db.watchGroupInvites.mockImplementation((groupId, cb) => { invitesCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    invitesCb({});
    document.getElementById('group-action-invite').click();
    expect(inviteModal.openInviteModal).toHaveBeenCalledWith(expect.objectContaining({
      activeInvite: null,
    }));
  });

  test('Invite link ignores revoked invites', () => {
    let metaCb, invitesCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    db.watchGroupInvites.mockImplementation((groupId, cb) => { invitesCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    invitesCb({
      gone: { scope: 'group', token: 'gone', revoked: true },
    });
    document.getElementById('group-action-invite').click();
    expect(inviteModal.openInviteModal).toHaveBeenCalledWith(expect.objectContaining({
      activeInvite: null,
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

  test('Edit my name pre-fills the prompt with the user\'s current group displayName', () => {
    let metaCb; let membersCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'someoneElse', createdAt: 1 });
    membersCb({
      me: { role: 'member', displayName: 'Mike P.', joinedAt: 1 },
      a:  { role: 'member', displayName: 'Alice',   joinedAt: 2 },
    });
    window.prompt = jest.fn(() => null);
    document.getElementById('group-action-edit-name').click();
    expect(window.prompt).toHaveBeenCalledWith('Your name in this group', 'Mike P.');
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

describe('own status row', () => {
  function captureCallbacks() {
    let metaCb, primaryCb, overrideCb;
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchStatus.mockImplementation((uid, cb) => { primaryCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation((g, uid, cb) => { overrideCb = cb; return () => {}; });
    return { getMetaCb: () => metaCb, getPrimaryCb: () => primaryCb, getOverrideCb: () => overrideCb };
  }

  beforeEach(() => { jest.clearAllMocks(); setupContextDom(); });

  test('renders primary status when override is null', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()(null);
    cbs.getPrimaryCb()({ status: 'available', availableUntil: Date.now() + 60 * 60 * 1000, statusColor: '#abcdef' });
    expect(document.getElementById('group-my-status-label').textContent).toBe('Available');
    expect(document.getElementById('group-my-dot').dataset.available).toBe('true');
    // The label gets the .available class so CSS picks up var(--my-status)
    // for the text color, matching Direct context behavior.
    expect(document.getElementById('group-my-status-label').classList.contains('available')).toBe(true);
  });

  test('renders override status when override.enabled is true', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getPrimaryCb()({ status: 'available', availableUntil: Date.now() + 60 * 60 * 1000 });
    cbs.getOverrideCb()({ enabled: true, status: 'unavailable', availableUntil: null });
    expect(document.getElementById('group-my-status-label').textContent).toBe('Unavailable');
    expect(document.getElementById('group-my-dot').dataset.available).toBe('false');
  });

  test('dot and time chip get readonly class when override is OFF', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()(null);
    cbs.getPrimaryCb()({ status: 'unavailable', availableUntil: null });
    expect(document.getElementById('group-my-dot').classList.contains('readonly')).toBe(true);
    expect(document.getElementById('group-time-chip').classList.contains('readonly')).toBe(true);
  });

  test('dot and time chip lose readonly class when override is ON', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()({ enabled: true, status: 'unavailable', availableUntil: null });
    expect(document.getElementById('group-my-dot').classList.contains('readonly')).toBe(false);
    expect(document.getElementById('group-time-chip').classList.contains('readonly')).toBe(false);
  });

  test('exitGroupContext tears down own primary and override subscriptions', () => {
    const ownPrimaryUnsub = jest.fn();
    const ownOverrideUnsub = jest.fn();
    db.watchStatus.mockImplementation(() => ownPrimaryUnsub);
    db.watchOwnMemberOverride.mockImplementation(() => ownOverrideUnsub);
    enterGroupContext('G1', 'me');
    exitGroupContext();
    expect(ownPrimaryUnsub).toHaveBeenCalledTimes(1);
    expect(ownOverrideUnsub).toHaveBeenCalledTimes(1);
  });

  test('dot click for a new-default user (getLastTimeout=2) writes a 120-minute availableUntil', () => {
    // Regression: js/store.js's getLastTimeout returns 2 (legacy: stored as
    // hours) for fresh accounts. The dot handler used to multiply that
    // raw value by 60000, producing 2 minutes instead of 2 hours. Fix:
    // route through CHIP_VALUES[chipIndexForMinutes(...)].minutes so the
    // legacy <=12 → *60 migration applies (same as js/me.js).
    const storeMock = require('../js/store.js');
    storeMock.getLastTimeout.mockReturnValueOnce(2);
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()({ enabled: true, status: 'unavailable', availableUntil: null });
    const before = Date.now();
    document.getElementById('group-my-dot').click();
    expect(groupsModule.setOverrideStatusAvailable).toHaveBeenCalledTimes(1);
    const [, , until] = groupsModule.setOverrideStatusAvailable.mock.calls[0];
    // 120 minutes from now (2-hour default expressed in minutes), ±2s tolerance.
    expect(until).toBeGreaterThanOrEqual(before + 120 * 60000 - 2000);
    expect(until).toBeLessThanOrEqual(Date.now() + 120 * 60000 + 2000);
  });

  test('chip click immediately after dot tap still writes available with cycled duration', () => {
    // Same race for the chip — dot tap optimistically marks override
    // available, so a follow-up chip click before Firebase ack still works.
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()({ enabled: true, status: 'unavailable', availableUntil: null });

    document.getElementById('group-my-dot').click();
    expect(groupsModule.setOverrideStatusAvailable).toHaveBeenCalledTimes(1);
    // Do NOT fire cbs.getOverrideCb() with the new available state.

    document.getElementById('group-time-chip').click();
    expect(groupsModule.setOverrideStatusAvailable).toHaveBeenCalledTimes(2);
  });

  test('clicking the dot when override ON and currently unavailable goes available with lastTimeoutMinutes', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()({ enabled: true, status: 'unavailable', availableUntil: null });
    const before = Date.now();
    document.getElementById('group-my-dot').click();
    expect(groupsModule.setOverrideStatusAvailable).toHaveBeenCalledTimes(1);
    const [g, u, until] = groupsModule.setOverrideStatusAvailable.mock.calls[0];
    expect(g).toBe('G1');
    expect(u).toBe('me');
    // 120 minutes from now, ±2s tolerance for test latency.
    expect(until).toBeGreaterThanOrEqual(before + 120 * 60000 - 2000);
    expect(until).toBeLessThanOrEqual(Date.now() + 120 * 60000 + 2000);
  });

  test('clicking the dot when override ON and currently available goes unavailable', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()({ enabled: true, status: 'available', availableUntil: Date.now() + 60 * 60 * 1000 });
    document.getElementById('group-my-dot').click();
    expect(groupsModule.setOverrideStatusUnavailable).toHaveBeenCalledWith('G1', 'me');
    expect(groupsModule.setOverrideStatusUnavailable).toHaveBeenCalledTimes(1);
  });

  test('clicking the dot when override OFF is a no-op', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()(null);
    document.getElementById('group-my-dot').click();
    expect(groupsModule.setOverrideStatusAvailable).not.toHaveBeenCalled();
    expect(groupsModule.setOverrideStatusUnavailable).not.toHaveBeenCalled();
  });

  test('clicking the time chip when override ON+available updates availableUntil', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()({ enabled: true, status: 'available', availableUntil: Date.now() + 60 * 60 * 1000 });
    const before = Date.now();
    document.getElementById('group-time-chip').click();
    expect(groupsModule.setOverrideStatusAvailable).toHaveBeenCalledTimes(1);
    const [, , until] = groupsModule.setOverrideStatusAvailable.mock.calls[0];
    // Chip default cycles forward from "2 hours" (index 3) to "3 hours" (index 4).
    expect(until).toBeGreaterThanOrEqual(before + 180 * 60000 - 2000);
    expect(until).toBeLessThanOrEqual(Date.now() + 180 * 60000 + 2000);
    expect(store.setLastTimeout).toHaveBeenCalledWith(180);
    expect(db.setLastTimeoutMinutes).toHaveBeenCalledWith('me', 180);
  });

  test('clicking the time chip when override OFF is a no-op', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()(null);
    document.getElementById('group-time-chip').click();
    expect(groupsModule.setOverrideStatusAvailable).not.toHaveBeenCalled();
  });

  test('clicking the time chip when override ON but unavailable is a no-op', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()({ enabled: true, status: 'unavailable', availableUntil: null });
    document.getElementById('group-time-chip').click();
    expect(groupsModule.setOverrideStatusAvailable).not.toHaveBeenCalled();
  });
});

describe('roster context-aware status', () => {
  function captureMembers() {
    let membersCb;
    db.watchGroupMembers.mockImplementation((g, cb) => { membersCb = cb; return () => {}; });
    return () => membersCb;
  }
  function captureStatuses() {
    const cbs = {};
    db.watchStatus.mockImplementation((uid, cb) => { cbs[uid] = cb; return () => {}; });
    return cbs;
  }

  beforeEach(() => { jest.clearAllMocks(); setupContextDom(); });

  test('member with override.enabled uses override status not primary', () => {
    const getMembers = captureMembers();
    const statusCbs = captureStatuses();
    enterGroupContext('G1', 'me');
    getMembers()({
      me: { role: 'owner', displayName: 'Me', joinedAt: 1 },
      uidA: {
        role: 'member',
        displayName: 'A',
        joinedAt: 2,
        statusOverride: { enabled: true, status: 'available', availableUntil: Date.now() + 60 * 60 * 1000 },
      },
    });
    // uidA's primary says unavailable, but override should win.
    statusCbs.uidA?.({ status: 'unavailable', availableUntil: null });
    const li = document.querySelector('#group-roster [data-user-id="uidA"]');
    expect(li.dataset.available).toBe('true');
    // Regression: the CSS rule for the green available dot is .person-dot.available
    // (class), not [data-available="true"]. Without the class toggle the dot stays
    // grey even when isAvailable is true — only masked when a statusColor inline
    // background happens to be set.
    expect(li.querySelector('.person-dot').classList.contains('available')).toBe(true);
  });

  test('member without override uses primary status', () => {
    const getMembers = captureMembers();
    const statusCbs = captureStatuses();
    enterGroupContext('G1', 'me');
    getMembers()({
      me: { role: 'owner', displayName: 'Me', joinedAt: 1 },
      uidB: { role: 'member', displayName: 'B', joinedAt: 3 },
    });
    statusCbs.uidB?.({ status: 'available', availableUntil: Date.now() + 60 * 60 * 1000, statusColor: '#abcdef' });
    const li = document.querySelector('#group-roster [data-user-id="uidB"]');
    expect(li.dataset.available).toBe('true');
  });

  test('member with override.enabled=false ignores override and uses primary', () => {
    const getMembers = captureMembers();
    const statusCbs = captureStatuses();
    enterGroupContext('G1', 'me');
    getMembers()({
      me: { role: 'owner', displayName: 'Me', joinedAt: 1 },
      uidC: {
        role: 'member',
        displayName: 'C',
        joinedAt: 4,
        statusOverride: { enabled: false, status: 'unavailable', availableUntil: null },
      },
    });
    statusCbs.uidC?.({ status: 'available', availableUntil: Date.now() + 60 * 60 * 1000 });
    const li = document.querySelector('#group-roster [data-user-id="uidC"]');
    expect(li.dataset.available).toBe('true');
  });
});

