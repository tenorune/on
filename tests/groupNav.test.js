// tests/groupNav.test.js
jest.mock('../js/db.js', () => ({
  setCurrentContext: jest.fn().mockResolvedValue(undefined),
  setLastVisited: jest.fn().mockResolvedValue(undefined),
  watchUserGroups: jest.fn(),
  watchGroupMeta: jest.fn(),
  readMembers: jest.fn().mockResolvedValue({}),
  watchOwnMemberOverride: jest.fn(() => () => {}),
  watchStatus: jest.fn(() => () => {}),
}));
jest.mock('../js/features.js', () => ({ GROUPS_ENABLED: true }));
jest.mock('../js/groups.js', () => ({
  createGroup: jest.fn(),
}));

const db = require('../js/db.js');
const groups = require('../js/groups.js');
const {
  initNav, getCurrentContext, navigateToDirect, navigateToGroup,
  onContextChange, applyServerCurrentContext,
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
    expect(db.setCurrentContext).toHaveBeenCalledWith('uid1', 'group:G1');
    expect(db.setLastVisited).toHaveBeenCalledWith('uid1', 'G1', expect.any(Number));
    expect(seen[seen.length - 1]).toEqual({ context: 'group', groupId: 'G1' });
  });

  test('navigateToDirect writes direct + emits change', async () => {
    await navigateToGroup('G1');
    const seen = [];
    onContextChange((ctx) => seen.push(ctx));
    await navigateToDirect();
    expect(getCurrentContext()).toEqual({ context: 'direct', groupId: null });
    expect(db.setCurrentContext).toHaveBeenCalledWith('uid1', 'direct');
    expect(seen[seen.length - 1]).toEqual({ context: 'direct', groupId: null });
  });

  test('navigation is idempotent: same context twice does not double-write', async () => {
    await navigateToGroup('G1');
    db.setCurrentContext.mockClear();
    await navigateToGroup('G1');
    expect(db.setCurrentContext).not.toHaveBeenCalled();
  });

  test('applyServerCurrentContext updates local state without round-tripping to Firebase', () => {
    const seen = [];
    onContextChange((ctx) => seen.push(ctx));
    applyServerCurrentContext('group:G2');
    expect(getCurrentContext()).toEqual({ context: 'group', groupId: 'G2' });
    expect(db.setCurrentContext).not.toHaveBeenCalled();
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
    document.getElementById('create-group-displayname-input').value = 'Mike';
    document.getElementById('create-group-submit-btn').click();
    await new Promise(setImmediate);
    expect(document.getElementById('create-group-error').classList.contains('hidden')).toBe(false);
    expect(groups.createGroup).not.toHaveBeenCalled();
  });

  test('Submit happy path: calls createGroup, closes modal, navigates to new group', async () => {
    groups.createGroup.mockResolvedValue({ groupId: 'G1ABCDEF', name: 'Family' });
    openCreateGroupModal();
    document.getElementById('create-group-name-input').value = 'Family';
    document.getElementById('create-group-displayname-input').value = 'Mike';
    document.getElementById('create-group-submit-btn').click();
    await new Promise(setImmediate);
    expect(groups.createGroup).toHaveBeenCalledWith('uid1', 'Family', 'Mike');
    expect(document.getElementById('create-group-modal').classList.contains('hidden')).toBe(true);
    expect(db.setCurrentContext).toHaveBeenCalledWith('uid1', 'group:G1ABCDEF');
  });

  test('Submit failure: surfaces error from createGroup, stays open', async () => {
    groups.createGroup.mockRejectedValue(new Error('boom'));
    openCreateGroupModal();
    document.getElementById('create-group-name-input').value = 'Family';
    document.getElementById('create-group-displayname-input').value = 'Mike';
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

  test('card with override.enabled=true and status=available shows border (falls back to primary statusColor when override has no statusColor)', () => {
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
    overrideCb({ enabled: true, status: 'available', availableUntil: Date.now() + 60 * 60 * 1000 });
    const card = document.querySelector('#nav-row .group-card');
    // Override wins for availability; override has no statusColor so falls back to primary (#11aaff).
    expect(card.style.borderColor).toMatch(/#11aaff|rgb\(17,\s*170,\s*255\)/i);
    expect(card.style.background).toBe('');
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

  test('Direct context with no groups renders Direct + plus only', () => {
    db.watchUserGroups.mockImplementation(() => () => {});
    db.watchGroupMeta.mockImplementation(() => () => {});
    db.watchOwnMemberOverride.mockImplementation(() => () => {});
    db.watchStatus.mockImplementation(() => () => {});
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    const row = document.getElementById('nav-row');
    const items = row.querySelectorAll('.nav-current, .group-card, .group-cards-plus');
    expect(items.length).toBe(2);
    expect(items[0].classList.contains('nav-current')).toBe(true);
    expect(items[0].textContent).toBe('Direct');
    expect(items[1].classList.contains('group-cards-plus')).toBe(true);
    expect(items[1].textContent).toBe('+');
  });

  test('Direct context with two groups renders Direct + lastVisited order + plus', () => {
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
    const items = row.querySelectorAll('.nav-current, .group-card, .group-cards-plus');
    expect(items.length).toBe(4);
    expect(items[0].textContent).toBe('Direct');
    // G2 has higher lastVisited, comes before G1.
    expect(items[1].textContent).toBe('Family');
    expect(items[1].dataset.groupId).toBe('G2');
    expect(items[2].textContent).toBe('Work');
    expect(items[2].dataset.groupId).toBe('G1');
    expect(items[3].textContent).toBe('+');
  });

  test('Tapping a group card navigates to that group', () => {
    let enumCb, metaCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation(() => () => {});
    db.watchStatus.mockImplementation(() => () => {});
    db.setCurrentContext.mockResolvedValue(undefined);
    db.setLastVisited.mockResolvedValue(undefined);
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    document.querySelector('.group-card[data-group-id="G1"]').click();
    expect(db.setCurrentContext).toHaveBeenCalledWith('me', 'group:G1');
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

  test('Tapping Direct in Direct context is a no-op (no setCurrentContext call)', () => {
    db.watchUserGroups.mockImplementation(() => () => {});
    db.watchGroupMeta.mockImplementation(() => () => {});
    db.watchOwnMemberOverride.mockImplementation(() => () => {});
    db.watchStatus.mockImplementation(() => () => {});
    db.setCurrentContext.mockResolvedValue(undefined);
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    document.querySelector('.nav-current').click();
    expect(db.setCurrentContext).not.toHaveBeenCalled();
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

  test('card with override enabled+available but no override statusColor falls back to primary statusColor', () => {
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
    // Phase 2 reality: override.statusColor isn't written. The Direct nav card
    // should still show the user's primary color, not the forest-green fallback.
    const card = document.querySelector('.group-card[data-group-id="G1"]');
    expect(card.style.borderColor).toMatch(/#11aaff|rgb\(17,\s*170,\s*255\)/i);
  });
});
