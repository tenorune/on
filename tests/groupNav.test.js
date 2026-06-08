// tests/groupNav.test.js
jest.mock('../js/notifyPrompt.js', () => ({ requestPermissionAndRegister: jest.fn() }));
jest.mock('../js/db.js', () => ({
  setLastVisited: jest.fn().mockResolvedValue(undefined),
  watchUserGroups: jest.fn(),
  watchGroupMeta: jest.fn(),
  readMembers: jest.fn().mockResolvedValue({}),
  watchOwnMemberOverride: jest.fn(() => () => {}),
  watchStatus: jest.fn(() => () => {}),
  removeUserGroupsEntry: jest.fn().mockResolvedValue(undefined),
  watchPendingInvites: jest.fn(() => () => {}),
  writePendingInvite: jest.fn().mockResolvedValue(undefined),
  deletePendingInvite: jest.fn().mockResolvedValue(undefined),
  readPendingInviteesForGroup: jest.fn().mockResolvedValue([]),
}));
jest.mock('../js/prefs.js', () => ({
  setCurrentContext: jest.fn(),
}));
jest.mock('../js/inbox.js', () => ({
  renderInboxNavSlot: jest.fn(),
}));
jest.mock('../js/features.js', () => ({ GROUPS_ENABLED: true }));
jest.mock('../js/groups.js', () => ({
  createGroup: jest.fn(),
  toggleStatusOverride: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../js/inviteModal.js', () => ({
  openInviteModal: jest.fn(),
}));

const db = require('../js/db.js');
const prefs = require('../js/prefs.js');
const groups = require('../js/groups.js');
const inviteModal = require('../js/inviteModal.js');
const {
  initNav, getCurrentContext, navigateToDirect, navigateToGroup,
  onContextChange, applyServerCurrentContext, applyOptimisticAppearance,
} = require('../js/groupNav');

describe('groupNav state machine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    initNav('uid1');
  });

  test('initNav defaults to direct context', () => {
    expect(getCurrentContext()).toEqual({ context: 'direct', groupId: null });
  });

  test('navigateToGroup writes currentContext + lastVisited and emits change', async () => {
    const seen = [];
    onContextChange((ctx) => seen.push(ctx));
    await navigateToGroup('G1');
    expect(getCurrentContext()).toEqual({ context: 'group', groupId: 'G1' });
    expect(prefs.setCurrentContext).toHaveBeenCalledWith('group:G1');
    expect(db.setLastVisited).toHaveBeenCalledWith('uid1', 'G1', expect.any(Number));
    expect(seen[seen.length - 1]).toEqual({ context: 'group', groupId: 'G1' });
  });

  test('navigateToDirect writes direct + emits change', async () => {
    await navigateToGroup('G1');
    const seen = [];
    onContextChange((ctx) => seen.push(ctx));
    await navigateToDirect();
    expect(getCurrentContext()).toEqual({ context: 'direct', groupId: null });
    expect(prefs.setCurrentContext).toHaveBeenCalledWith('direct');
    expect(seen[seen.length - 1]).toEqual({ context: 'direct', groupId: null });
  });

  test('navigation is idempotent: same context twice does not double-write', async () => {
    await navigateToGroup('G1');
    prefs.setCurrentContext.mockClear();
    await navigateToGroup('G1');
    expect(prefs.setCurrentContext).not.toHaveBeenCalled();
  });

  test('applyServerCurrentContext updates local state without round-tripping to Firebase', () => {
    const seen = [];
    onContextChange((ctx) => seen.push(ctx));
    applyServerCurrentContext('group:G2');
    expect(getCurrentContext()).toEqual({ context: 'group', groupId: 'G2' });
    expect(prefs.setCurrentContext).not.toHaveBeenCalled();
    expect(seen[seen.length - 1]).toEqual({ context: 'group', groupId: 'G2' });
  });

  test('applyServerCurrentContext for direct works', () => {
    applyServerCurrentContext('group:G2');
    applyServerCurrentContext('direct');
    expect(getCurrentContext()).toEqual({ context: 'direct', groupId: null });
  });

  test('applyServerCurrentContext no-ops when already in the same context', () => {
    const seen = [];
    onContextChange((ctx) => seen.push(ctx));
    applyServerCurrentContext('direct');
    expect(seen.length).toBe(0);
  });

  test('falls back to direct when server provides a malformed value', () => {
    applyServerCurrentContext('garbage');
    expect(getCurrentContext()).toEqual({ context: 'direct', groupId: null });
  });
});

const { initNavRow, onCreateRequested, openCreateGroupModal, getLastKnownGroupName, startCardsRowSubscriptions } = require('../js/groupNav');

function setupCreateModalDom() {
  // Replace the bare #create-group-modal placeholder (from setupNavDom) with
  // the full modal markup so inputs and buttons are accessible to tests.
  const existing = document.getElementById('create-group-modal');
  const markup = `<div id="create-group-modal" class="modal-overlay hidden">
      <div class="modal-card">
        <input id="create-group-name-input" type="text" maxlength="40" />
        <input id="create-group-displayname-input" type="text" maxlength="40" />
        <p id="create-group-error" class="error-msg hidden"></p>
        <button id="create-group-submit-btn"></button>
        <button id="create-group-cancel-btn"></button>
      </div>
    </div>`;
  if (existing) {
    existing.outerHTML = markup;
  } else {
    document.body.innerHTML += markup;
  }
}

describe('create-group modal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupNavDom();
    setupCreateModalDom();
    initNav('uid1');
  });

  test('openCreateGroupModal reveals the overlay and clears inputs', () => {
    document.getElementById('create-group-name-input').value = 'stale';
    document.getElementById('create-group-displayname-input').value = 'stale';
    openCreateGroupModal();
    expect(document.getElementById('create-group-modal').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('create-group-name-input').value).toBe('');
    expect(document.getElementById('create-group-displayname-input').value).toBe('');
  });

  test('Cancel closes without writing', () => {
    openCreateGroupModal();
    document.getElementById('create-group-cancel-btn').click();
    expect(document.getElementById('create-group-modal').classList.contains('hidden')).toBe(true);
    expect(groups.createGroup).not.toHaveBeenCalled();
  });

  test('Submit validates: empty name shows error', async () => {
    openCreateGroupModal();
    document.getElementById('create-group-name-input').value = '   ';
    document.getElementById('create-group-displayname-input').value = 'Alex';
    document.getElementById('create-group-submit-btn').click();
    await new Promise(setImmediate);
    expect(document.getElementById('create-group-error').classList.contains('hidden')).toBe(false);
    expect(groups.createGroup).not.toHaveBeenCalled();
  });

  test('Submit happy path: calls createGroup, closes modal, navigates to new group', async () => {
    groups.createGroup.mockResolvedValue({ groupId: 'G1ABCDEF', name: 'Family' });
    openCreateGroupModal();
    document.getElementById('create-group-name-input').value = 'Family';
    document.getElementById('create-group-displayname-input').value = 'Alex';
    document.getElementById('create-group-submit-btn').click();
    await new Promise(setImmediate);
    expect(groups.createGroup).toHaveBeenCalledWith('uid1', 'Family', 'Alex');
    expect(document.getElementById('create-group-modal').classList.contains('hidden')).toBe(true);
    expect(prefs.setCurrentContext).toHaveBeenCalledWith('group:G1ABCDEF');
  });

  test('Submit happy path also opens the invite modal in create state for the new group', async () => {
    groups.createGroup.mockResolvedValue({ groupId: 'G1ABCDEF', name: 'Family' });
    openCreateGroupModal();
    document.getElementById('create-group-name-input').value = 'Family';
    document.getElementById('create-group-displayname-input').value = 'Alex';
    document.getElementById('create-group-submit-btn').click();
    await new Promise(setImmediate);
    expect(inviteModal.openInviteModal).toHaveBeenCalledWith({
      scope: 'group',
      userId: 'uid1',
      groupId: 'G1ABCDEF',
      groupName: 'Family',
    });
  });

  test('Submit failure: surfaces error from createGroup, stays open', async () => {
    groups.createGroup.mockRejectedValue(new Error('boom'));
    openCreateGroupModal();
    document.getElementById('create-group-name-input').value = 'Family';
    document.getElementById('create-group-displayname-input').value = 'Alex';
    document.getElementById('create-group-submit-btn').click();
    await new Promise(setImmediate);
    expect(document.getElementById('create-group-error').textContent).toBe('boom');
    expect(document.getElementById('create-group-modal').classList.contains('hidden')).toBe(false);
  });
});

describe('getLastKnownGroupName', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupNavDom();
    initNav('uid1');
  });

  test('returns null for an unknown group', () => {
    expect(getLastKnownGroupName('NOPE')).toBeNull();
  });

  test('caches the name observed from watchGroupMeta and returns it after the meta clears', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    db.watchUserGroups.mockImplementation((uid, cb) => { cb({ G1: { lastVisited: 1 } }); return () => {}; });
    startCardsRowSubscriptions();
    metaCb({ name: 'Family', ownerId: 'owner', createdAt: 1 });
    expect(getLastKnownGroupName('G1')).toBe('Family');
    // Group is now deleted; meta callback fires with null.
    metaCb(null);
    // The cache survives the deletion event.
    expect(getLastKnownGroupName('G1')).toBe('Family');
  });
});

describe('group cards own-override color reflection', () => {
  beforeEach(() => { jest.clearAllMocks(); setupNavDom(); });

  test('card without active override has no inline color', () => {
    let enumCb, metaCb, overrideCb, statusCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation((g, uid, cb) => { overrideCb = cb; return () => {}; });
    db.watchStatus.mockImplementation((uid, cb) => { statusCb = cb; return () => {}; });
    initNav('me');
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });
    metaCb({ name: 'Family', ownerId: 'someone', createdAt: 1 });
    overrideCb(null);
    const card = document.querySelector('#nav-row .group-card');
    expect(card.style.background).toBe('');
  });

  test('card with override.enabled=true uses override.statusColor (does NOT inherit primary)', () => {
    let enumCb, metaCb, overrideCb, statusCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation((g, uid, cb) => { overrideCb = cb; return () => {}; });
    db.watchStatus.mockImplementation((uid, cb) => { statusCb = cb; return () => {}; });
    initNav('me');
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });
    metaCb({ name: 'Family', ownerId: 'someone', createdAt: 1 });
    statusCb({ status: 'available', availableUntil: Date.now() + 60 * 60 * 1000, statusColor: '#11aaff' });
    overrideCb({
      enabled: true,
      status: 'available',
      availableUntil: Date.now() + 60 * 60 * 1000,
      statusColor: '#ff7700',
    });
    const card = document.querySelector('#nav-row .group-card');
    // Override-ON is independent — chip uses override's #ff7700, not primary's #11aaff.
    expect(card.style.borderColor).toMatch(/#ff7700|rgb\(255,\s*119,\s*0\)/i);
    expect(card.style.background).toBe('');
  });

  test('card with override.enabled=false ignores preserved override.statusColor and mirrors primary', () => {
    // Regression: user picks orange in a group (override.statusColor=ff7700),
    // then turns the override OFF. The picked color is preserved on the
    // override record so re-enabling restores it — but while disabled, the
    // chip in Direct's nav must mirror Direct (the user's primary color),
    // not the stale override color. Before the fix, the chip border kept
    // showing orange even with override.enabled=false.
    let enumCb, metaCb, overrideCb, statusCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation((g, uid, cb) => { overrideCb = cb; return () => {}; });
    db.watchStatus.mockImplementation((uid, cb) => { statusCb = cb; return () => {}; });
    initNav('me');
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });
    metaCb({ name: 'Family', ownerId: 'someone', createdAt: 1 });
    statusCb({ status: 'available', availableUntil: Date.now() + 60 * 60 * 1000, statusColor: '#11aaff' });
    overrideCb({
      enabled: false,
      status: null,
      availableUntil: null,
      statusColor: '#ff7700', // preserved from a prior pick, but override is OFF
    });
    const card = document.querySelector('#nav-row .group-card');
    expect(card.style.borderColor).toMatch(/#11aaff|rgb\(17,\s*170,\s*255\)/i);
  });

  test('card with override.enabled=true but status=unavailable has no inline color', () => {
    let enumCb, metaCb, overrideCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation((g, uid, cb) => { overrideCb = cb; return () => {}; });
    db.watchStatus.mockImplementation(() => () => {});
    initNav('me');
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });
    metaCb({ name: 'Family', ownerId: 'someone', createdAt: 1 });
    overrideCb({ enabled: true, status: 'unavailable', availableUntil: null });
    const card = document.querySelector('#nav-row .group-card');
    expect(card.style.background).toBe('');
  });
});

function setupNavDom() {
  document.body.innerHTML = `
    <div id="nav-row" class="nav-row hidden"></div>
    <div id="main-ui-direct"></div>
    <div id="group-context-root" class="hidden"></div>
    <div id="create-group-modal" class="hidden"></div>
  `;
}

describe('renderNavRow — Direct mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupNavDom();
  });

  test('Direct context with no groups renders the plus only (no Direct label)', () => {
    db.watchUserGroups.mockImplementation(() => () => {});
    db.watchGroupMeta.mockImplementation(() => () => {});
    db.watchOwnMemberOverride.mockImplementation(() => () => {});
    db.watchStatus.mockImplementation(() => () => {});
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    const row = document.getElementById('nav-row');
    expect(row.querySelector('.nav-current')).toBeNull();
    const items = row.querySelectorAll('.group-card, .group-cards-plus');
    expect(items.length).toBe(1);
    expect(items[0].classList.contains('group-cards-plus')).toBe(true);
    expect(items[0].textContent).toBe('+');
  });

  test('Direct context with two groups renders groups (lastVisited order) + plus, no Direct label', () => {
    let enumCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    const metaCbs = {};
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCbs[groupId] = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation(() => () => {});
    db.watchStatus.mockImplementation(() => () => {});
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 100 }, G2: { lastVisited: 200 } });
    metaCbs.G1({ name: 'Work', ownerId: 'me', createdAt: 1 });
    metaCbs.G2({ name: 'Family', ownerId: 'me', createdAt: 2 });
    const row = document.getElementById('nav-row');
    expect(row.querySelector('.nav-current')).toBeNull();
    const items = row.querySelectorAll('.group-card, .group-cards-plus');
    expect(items.length).toBe(3);
    // G2 has higher lastVisited, comes before G1.
    expect(items[0].textContent).toBe('Family');
    expect(items[0].dataset.groupId).toBe('G2');
    expect(items[1].textContent).toBe('Work');
    expect(items[1].dataset.groupId).toBe('G1');
    expect(items[2].textContent).toBe('+');
  });

  test('Tapping a group card navigates to that group', () => {
    let enumCb, metaCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation(() => () => {});
    db.watchStatus.mockImplementation(() => () => {});
    db.setLastVisited.mockResolvedValue(undefined);
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    document.querySelector('.group-card[data-group-id="G1"]').click();
    expect(prefs.setCurrentContext).toHaveBeenCalledWith('group:G1');
  });

  test('Tapping the + button emits a create-group request', () => {
    db.watchUserGroups.mockImplementation(() => () => {});
    db.watchGroupMeta.mockImplementation(() => () => {});
    db.watchOwnMemberOverride.mockImplementation(() => () => {});
    db.watchStatus.mockImplementation(() => () => {});
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    const handler = jest.fn();
    onCreateRequested(handler);
    document.querySelector('.group-cards-plus').click();
    expect(handler).toHaveBeenCalled();
  });

  test('Direct context does not render the "Direct" nav-current label', () => {
    db.watchUserGroups.mockImplementation(() => () => {});
    db.watchGroupMeta.mockImplementation(() => () => {});
    db.watchOwnMemberOverride.mockImplementation(() => () => {});
    db.watchStatus.mockImplementation(() => () => {});
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    // "Direct" is the implicit context — the nav row signals it via the absence
    // of a back-link and current-group label. No label needed.
    expect(document.querySelector('#nav-row .nav-current')).toBeNull();
  });

  test('renderNavRowDirectMode injects an inbox slot before the group cards', () => {
    db.watchUserGroups.mockImplementation(() => () => {});
    db.watchGroupMeta.mockImplementation(() => () => {});
    db.watchOwnMemberOverride.mockImplementation(() => () => {});
    db.watchStatus.mockImplementation(() => () => {});
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    const row = document.getElementById('nav-row');
    const slot = row.querySelector('#nav-row-inbox-slot');
    expect(slot).not.toBeNull();
    // The slot is the first child of #nav-row (before any .group-card or .group-cards-plus).
    expect(row.firstElementChild).toBe(slot);
  });
});

describe('Direct nav per-group status indicator', () => {
  beforeEach(() => { jest.clearAllMocks(); setupNavDom(); });

  test('card with effective available status shows a colored border (primary)', () => {
    let enumCb, metaCb, statusCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation(() => () => {});
    db.watchStatus.mockImplementation((uid, cb) => { statusCb = cb; return () => {}; });
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    statusCb({ status: 'available', availableUntil: Date.now() + 60 * 60 * 1000, statusColor: '#11aaff' });
    const card = document.querySelector('.group-card[data-group-id="G1"]');
    expect(card.style.borderColor).toMatch(/#11aaff|rgb\(17,\s*170,\s*255\)/i);
    expect(card.classList.contains('greyed')).toBe(false);
  });

  test('card with effective available status and no statusColor falls back to forest green', () => {
    let enumCb, metaCb, statusCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation(() => () => {});
    db.watchStatus.mockImplementation((uid, cb) => { statusCb = cb; return () => {}; });
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    statusCb({ status: 'available', availableUntil: Date.now() + 60 * 60 * 1000 });
    const card = document.querySelector('.group-card[data-group-id="G1"]');
    expect(card.style.borderColor).toMatch(/#22c55e|rgb\(34,\s*197,\s*94\)/i);
  });

  test('card with override enabled+available uses override color over primary', () => {
    let enumCb, metaCb, overrideCb, statusCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation((g, uid, cb) => { overrideCb = cb; return () => {}; });
    db.watchStatus.mockImplementation((uid, cb) => { statusCb = cb; return () => {}; });
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    statusCb({ status: 'available', availableUntil: Date.now() + 60 * 60 * 1000, statusColor: '#ff0000' });
    overrideCb({ enabled: true, status: 'available', availableUntil: Date.now() + 30 * 60 * 1000, statusColor: '#00ff00' });
    const card = document.querySelector('.group-card[data-group-id="G1"]');
    expect(card.style.borderColor).toMatch(/#00ff00|rgb\(0,\s*255,\s*0\)/i);
  });

  test('card with effective unavailable status has no border and greyed class', () => {
    let enumCb, metaCb, statusCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation(() => () => {});
    db.watchStatus.mockImplementation((uid, cb) => { statusCb = cb; return () => {}; });
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    statusCb({ status: 'unavailable', availableUntil: null });
    const card = document.querySelector('.group-card[data-group-id="G1"]');
    expect(card.style.borderColor).toBe('');
    expect(card.classList.contains('greyed')).toBe(true);
  });

  test('card with override enabled+unavailable has no border and greyed (override masks available primary)', () => {
    let enumCb, metaCb, overrideCb, statusCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation((g, uid, cb) => { overrideCb = cb; return () => {}; });
    db.watchStatus.mockImplementation((uid, cb) => { statusCb = cb; return () => {}; });
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    statusCb({ status: 'available', availableUntil: Date.now() + 60 * 60 * 1000, statusColor: '#ff0000' });
    overrideCb({ enabled: true, status: 'unavailable', availableUntil: null });
    const card = document.querySelector('.group-card[data-group-id="G1"]');
    expect(card.style.borderColor).toBe('');
    expect(card.classList.contains('greyed')).toBe(true);
  });

  test('card with override enabled+available but no override statusColor falls back to default green (not primary)', () => {
    let enumCb, metaCb, overrideCb, statusCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation((g, uid, cb) => { overrideCb = cb; return () => {}; });
    db.watchStatus.mockImplementation((uid, cb) => { statusCb = cb; return () => {}; });
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    statusCb({ status: 'available', availableUntil: Date.now() + 60 * 60 * 1000, statusColor: '#11aaff' });
    overrideCb({ enabled: true, status: 'available', availableUntil: Date.now() + 30 * 60 * 1000 });
    // Override is ON — chip is independent of primary. Without a per-group
    // statusColor (the seed-on-first-tick in groupContext would normally
    // populate this when the user enters the group context for the first
    // time), the chip falls back to default forest #22c55e — NOT primary's
    // #11aaff. That'd be the leak the override-ON-is-independent principle
    // forbids.
    const card = document.querySelector('.group-card[data-group-id="G1"]');
    expect(card.style.borderColor).toMatch(/#22c55e|rgb\(34,\s*197,\s*94\)/i);
  });
});

describe('renderNavRow — group mode', () => {
  beforeEach(() => { jest.clearAllMocks(); setupNavDom(); });

  test('group mode renders group name (left) + override toggle + Direct card (right)', () => {
    let enumCb, metaCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation(() => () => {});
    db.watchStatus.mockImplementation(() => () => {});
    db.setLastVisited.mockResolvedValue(undefined);
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    navigateToGroup('G1');
    const row = document.getElementById('nav-row');
    // Group name on the left (flex: 1 fills available space, truncates on overflow).
    const current = row.querySelector('.nav-current');
    expect(current).not.toBeNull();
    expect(current.textContent).toBe('Family');
    expect(current.classList.contains('nav-current-truncate')).toBe(true);
    // Override toggle in the middle, "=" for OFF, aria-pressed=false.
    const toggle = row.querySelector('#group-override-toggle');
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.textContent).toBe('=');
    // Direct card on the right, styled like a group card.
    const direct = row.querySelector('.group-card[data-nav="direct"]');
    expect(direct).not.toBeNull();
    expect(direct.textContent).toBe('Direct');
  });

  test('override toggle reflects override.enabled via aria-pressed and ≠ glyph', () => {
    let enumCb, metaCb, overrideCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation((g, uid, cb) => { overrideCb = cb; return () => {}; });
    db.watchStatus.mockImplementation(() => () => {});
    db.setLastVisited.mockResolvedValue(undefined);
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    overrideCb({ enabled: true, status: 'unavailable', availableUntil: null });
    navigateToGroup('G1');
    const toggle = document.querySelector('#group-override-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.textContent).toBe('≠');
  });

  test('Direct card border reflects primary statusColor when available; greyed when not', () => {
    let enumCb, metaCb, statusCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation(() => () => {});
    db.watchStatus.mockImplementation((uid, cb) => { statusCb = cb; return () => {}; });
    db.setLastVisited.mockResolvedValue(undefined);
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    statusCb({ status: 'available', availableUntil: Date.now() + 60 * 60 * 1000, statusColor: '#11aaff' });
    navigateToGroup('G1');
    const direct = document.querySelector('.group-card[data-nav="direct"]');
    expect(direct.style.borderColor).toMatch(/#11aaff|rgb\(17,\s*170,\s*255\)/i);
    expect(direct.classList.contains('greyed')).toBe(false);
  });

  test('tapping the chain icon calls toggleStatusOverride with inverted state', () => {
    let enumCb, metaCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation(() => () => {});
    db.watchStatus.mockImplementation(() => () => {});
    db.setLastVisited.mockResolvedValue(undefined);
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    navigateToGroup('G1');
    document.querySelector('#group-override-toggle').click();
    expect(groups.toggleStatusOverride).toHaveBeenCalledWith('G1', 'me', true);
  });

  test('Tapping the Direct card in group mode navigates to Direct', () => {
    let enumCb, metaCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation(() => () => {});
    db.watchStatus.mockImplementation(() => () => {});
    db.setLastVisited.mockResolvedValue(undefined);
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    navigateToGroup('G1');
    document.querySelector('.group-card[data-nav="direct"]').click();
    expect(prefs.setCurrentContext).toHaveBeenCalledWith('direct');
  });
});

describe('applyOptimisticAppearance', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="nav-row"></div>';
    jest.clearAllMocks();
  });

  test('merges statusColor + paletteKey into the internal cache and re-renders the nav row', () => {
    db.watchUserGroups.mockImplementation((_uid, cb) => {
      cb({ G1: { lastVisited: 1 } });
      return () => {};
    });
    db.watchGroupMeta.mockImplementation((_gid, cb) => {
      cb({ name: 'Family', ownerId: 'me' });
      return () => {};
    });
    db.watchOwnMemberOverride.mockImplementation((_gid, _uid, cb) => {
      cb({ enabled: true, status: 'available', availableUntil: Date.now() + 60000 });
      return () => {};
    });
    initNav('me');
    require('../js/groupNav').initNavRow();
    require('../js/groupNav').startCardsRowSubscriptions();

    applyOptimisticAppearance('G1', { statusColor: '#ff00aa', paletteKey: 'forest' });

    const card = document.querySelector('#nav-row [data-group-id="G1"]');
    expect(card).not.toBeNull();
    expect(card.style.borderColor).toBe('rgb(255, 0, 170)');
  });

  test('preserves enabled/status/availableUntil from the existing override entry', () => {
    db.watchUserGroups.mockImplementation((_uid, cb) => {
      cb({ G1: { lastVisited: 1 } });
      return () => {};
    });
    db.watchGroupMeta.mockImplementation((_gid, cb) => {
      cb({ name: 'Family', ownerId: 'me' });
      return () => {};
    });
    db.watchOwnMemberOverride.mockImplementation((_gid, _uid, cb) => {
      cb({ enabled: true, status: 'available', availableUntil: 9999999999999, statusColor: '#000000' });
      return () => {};
    });
    initNav('me');
    require('../js/groupNav').initNavRow();
    require('../js/groupNav').startCardsRowSubscriptions();

    applyOptimisticAppearance('G1', { statusColor: '#ff00aa', paletteKey: 'forest' });

    const card = document.querySelector('#nav-row [data-group-id="G1"]');
    expect(card.style.borderColor).toBe('rgb(255, 0, 170)');
    // The group card should remain bordered (i.e. "effectively available" is preserved
    // because enabled/status/availableUntil were not clobbered).
    expect(card.style.borderStyle).not.toBe('none');
  });
});
