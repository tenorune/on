// tests/groupContext.test.js
jest.mock('../js/store.js', () => ({
  getLastTimeout: jest.fn(() => 120),
  setLastTimeout: jest.fn(),
  getGroupChipMinutes: jest.fn(() => null),
  setGroupChipMinutes: jest.fn(),
  getPaletteState: jest.fn(() => ({
    activeSet: 1,
    sets: {
      '1': { selectedKey: 'forest', activePaletteKey: null },
      '2': { selectedKey: 'volt', activePaletteKey: null },
    },
  })),
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
  watchPendingInvites: jest.fn(() => () => {}),
  writePendingInvite: jest.fn().mockResolvedValue(undefined),
  deletePendingInvite: jest.fn().mockResolvedValue(undefined),
  readPendingInviteesForGroup: jest.fn().mockResolvedValue([]),
}));
jest.mock('../js/invites.js', () => ({
  buildInviteUrl: jest.fn((token) => `https://app.example/?i=${token}`),
}));
jest.mock('../js/groupNav.js', () => ({
  navigateToDirect: jest.fn().mockResolvedValue(undefined),
  getCurrentContext: jest.fn(() => ({ context: 'group', groupId: 'G1' })),
  applyOptimisticAppearance: jest.fn(),
}));
jest.mock('../js/groups.js', () => ({
  renameGroup: jest.fn().mockResolvedValue(undefined),
  deleteGroup: jest.fn().mockResolvedValue(undefined),
  leaveGroup: jest.fn().mockResolvedValue(undefined),
  editOwnDisplayName: jest.fn().mockResolvedValue(undefined),
  toggleStatusOverride: jest.fn().mockResolvedValue(undefined),
  setOverrideStatusAvailable: jest.fn().mockResolvedValue(undefined),
  setOverrideStatusUnavailable: jest.fn().mockResolvedValue(undefined),
  setOverrideAppearance: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../js/favorites.js', () => ({
  saveCombo: jest.fn(),
  buildAdoptedCombo: jest.fn((statusColor, paletteKey) => ({
    statusColor: statusColor || '#22c55e',
    surface: '#1e293b',
    surface2: '#334155',
    paletteKey: paletteKey ?? null,
    selectedKey: paletteKey ?? 'forest',
    activeSet: 1,
  })),
}));
jest.mock('../js/inviteModal.js', () => ({
  openInviteModal: jest.fn(),
}));
jest.mock('../js/prefs.js', () => ({
  isHintSeen: jest.fn(() => false),
  markHintSeen: jest.fn(),
  getGroupPaletteState: jest.fn(() => ({
    activeSet: 1,
    sets: {
      '1': { selectedKey: 'forest', selectedColor: '#22c55e', activePaletteKey: null },
      '2': { selectedKey: 'volt',   selectedColor: '#aaff00', activePaletteKey: null },
    },
  })),
  setGroupPaletteState: jest.fn(),
  getPaletteState: jest.fn(() => ({
    activeSet: 1,
    sets: {
      '1': { selectedKey: 'forest', activePaletteKey: null },
      '2': { selectedKey: 'volt', activePaletteKey: null },
    },
  })),
  getLastTimeout: jest.fn(() => 120),
  setLastTimeout: jest.fn(),
  getGroupChipMinutes: jest.fn(() => null),
  setGroupChipMinutes: jest.fn(),
}));
jest.mock('../js/knock.js', () => ({
  sendKnock: jest.fn(),
  clearGroupCardBadge: jest.fn(),
  drainPendingKnocks: jest.fn(),
  getFloatedUserIds: jest.fn(() => []),
}));
jest.mock('../js/features.js', () => ({
  KNOCK_ENABLED: true,
  PALETTES_ENABLED: true,
  PALETTE_INTERACTIONS_ENABLED: true,
  NOTIFICATIONS_ENABLED: true,
  FOLLOW_REQUESTS_ENABLED: true,
}));
jest.mock('../js/notifyBell.js', () => ({ createNotifyBell: jest.fn(), isNotifyPopoverOpen: jest.fn(() => false) }));
jest.mock('../js/notifyPrompt.js', () => ({ ensureNotificationsReady: jest.fn() }));
jest.mock('../js/me.js', () => ({
  clearFirstUsePulse: jest.fn(),
}));
jest.mock('../js/following.js', () => ({
  getCurrentFollowersMap: jest.fn(() => ({})),
  getCurrentMutuals: jest.fn(() => []),
}));
jest.mock('../js/followRequests.js', () => ({
  isFollowRequestEligible: jest.fn(() => false),
  createRequestFollowButton: jest.fn(),
}));
jest.mock('../js/cardDrawer.js', () => ({
  createCardDrawer: jest.fn(),
  isCardDrawerOpen: jest.fn(() => false),
  closeCardDrawer: jest.fn(),
}));

// PointerEvent polyfill for jsdom (does not implement it natively)
if (typeof PointerEvent === 'undefined') {
  global.PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type, params = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
    }
  };
}

const db = require('../js/db.js');
const groupNav = require('../js/groupNav.js');
const groupsModule = require('../js/groups.js');
const inviteModal = require('../js/inviteModal.js');
const prefs = require('../js/prefs.js');
const store = require('../js/store.js');
const { enterGroupContext, exitGroupContext } = require('../js/groupContext');
const { createNotifyBell, isNotifyPopoverOpen } = require('../js/notifyBell.js');

// Default implementation: return a real button so li.appendChild doesn't throw.
beforeEach(() => {
  isNotifyPopoverOpen.mockReturnValue(false);
  createNotifyBell.mockImplementation(() => {
    const b = document.createElement('button');
    b.className = 'notify-bell';
    return b;
  });

  const followRequests = require('../js/followRequests.js');
  followRequests.createRequestFollowButton.mockImplementation(() => {
    const b = document.createElement('button');
    b.className = 'request-follow-btn';
    b.textContent = 'Request to follow';
    return b;
  });

  const cardDrawer = require('../js/cardDrawer.js');
  cardDrawer.createCardDrawer.mockImplementation((actions) => {
    const t = document.createElement('button');
    t.className = 'card-drawer-toggle';
    t.dataset.actionCount = String(actions.length);
    return t;
  });
  cardDrawer.isCardDrawerOpen.mockReturnValue(false);
});

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
                  <button id="group-action-delete" class="hidden">Delete group</button>
                  <button id="group-action-edit-name" class="hidden">Edit my name</button>
                  <button id="group-action-leave" class="hidden">Leave group</button>
                </div>
              </details>
            </div>
            <div id="group-swatch-row" class="group-swatch-row"></div>
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
    // Restore the factory default (false) so the eligible-member test's
    // mockReturnValue(true) doesn't leak into subsequent tests.
    // jest.clearAllMocks() resets call history but NOT mockReturnValue.
    const followRequests = require('../js/followRequests.js');
    followRequests.isFollowRequestEligible.mockReturnValue(false);
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

  test('tapping the notification bell on a member row does NOT send a knock', () => {
    const knock = require('../js/knock.js');
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });
    const bell = document.querySelector('#group-roster [data-user-id="a"] .notify-bell');
    expect(bell).not.toBeNull();
    // The bell's own stopPropagation is a first line of defence; this guards the
    // case where a bell tap still reaches the row (stale shell, event-order
    // quirks). The knock handler must ignore taps originating from the bell.
    const before = knock.sendKnock.mock.calls.length;
    bell.click();
    expect(knock.sendKnock.mock.calls.length).toBe(before);
  });

  test('pressing the bell does not add the row press highlight', () => {
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });
    const row = document.querySelector('#group-roster [data-user-id="a"]');
    const bell = row.querySelector('.notify-bell');
    bell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(row.classList.contains('knock-pressing')).toBe(false);
  });

  test('a normal row press DOES add the press highlight (and clears on release)', () => {
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });
    const row = document.querySelector('#group-roster [data-user-id="a"]');
    row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(row.classList.contains('knock-pressing')).toBe(true);
    row.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    expect(row.classList.contains('knock-pressing')).toBe(false);
  });

  test('while a bell popover is open, tapping a row does NOT knock or highlight', () => {
    const knock = require('../js/knock.js');
    isNotifyPopoverOpen.mockReturnValue(true);
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });
    const row = document.querySelector('#group-roster [data-user-id="a"]');
    const before = knock.sendKnock.mock.calls.length;
    row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    row.click();
    expect(knock.sendKnock.mock.calls.length).toBe(before);
    expect(row.classList.contains('knock-pressing')).toBe(false);
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

  function captureRosterCallbacks() {
    let metaCb, membersCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    return { getMetaCb: () => metaCb, getMembersCb: () => membersCb };
  }

  test('group roster shows "Invite to group" row for the owner', () => {
    const cbs = captureRosterCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getMembersCb()({ me: { displayName: 'Me', role: 'owner', joinedAt: 1 } });
    const row = document.getElementById('group-roster-invite-row');
    expect(row).not.toBeNull();
    // Label is plain "Invite to group" (no leading "+").
    expect(row.querySelector('button').textContent).toBe('Invite to group');
  });

  test('group roster does NOT show "Invite to group" row for non-owner members', () => {
    const cbs = captureRosterCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'someoneElse', createdAt: 1 });
    cbs.getMembersCb()({ me: { displayName: 'Me', role: 'member', joinedAt: 1 } });
    const row = document.getElementById('group-roster-invite-row');
    expect(row).toBeNull();
  });

  test('clicking the roster invite row opens the invite modal in group scope', () => {
    const cbs = captureRosterCallbacks();
    const inviteModalMock = require('../js/inviteModal.js');
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getMembersCb()({ me: { displayName: 'Me', role: 'owner', joinedAt: 1 } });
    document.getElementById('group-roster-invite-row').querySelector('button').click();
    expect(inviteModalMock.openInviteModal).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'group', groupId: 'G1', groupName: 'Family' })
    );
  });

  test('an eligible co-member gets a ⋮ drawer carrying the request-follow action', () => {
    const followRequests = require('../js/followRequests.js');
    followRequests.isFollowRequestEligible.mockReturnValue(true);
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });

    const row = document.querySelector('#group-roster [data-user-id="a"]');
    expect(row.querySelector('.card-drawer-toggle')).not.toBeNull();
    expect(followRequests.createRequestFollowButton).toHaveBeenCalledWith('me', 'a', 'G1');
    expect(row.querySelector('.card-drawer-toggle').dataset.actionCount).toBe('2');
  });

  test('re-rendering the roster closes any open card drawer first', () => {
    const cardDrawer = require('../js/cardDrawer.js');
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });
    cardDrawer.closeCardDrawer.mockClear();
    // Second tick re-renders the roster; the open-drawer teardown must run first.
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });
    expect(cardDrawer.closeCardDrawer).toHaveBeenCalled();
  });

  test('a co-member you already follow keeps the bare bell (no drawer)', () => {
    const followRequests = require('../js/followRequests.js');
    followRequests.isFollowRequestEligible.mockReturnValue(false);
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });

    const row = document.querySelector('#group-roster [data-user-id="a"]');
    expect(row.querySelector('.card-drawer-toggle')).toBeNull();
    expect(row.querySelector('.notify-bell')).not.toBeNull();
  });

  test('following-synced re-renders the roster so a stale request-follow affordance drops', () => {
    const followRequests = require('../js/followRequests.js');
    // Boot-into-group on a fresh device: following cache is empty, so the
    // member looks eligible and gets the drawer.
    followRequests.isFollowRequestEligible.mockReturnValue(true);
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });
    expect(document.querySelector('#group-roster [data-user-id="a"] .card-drawer-toggle')).not.toBeNull();

    // The server following list arrives: this member is already followed.
    followRequests.isFollowRequestEligible.mockReturnValue(false);
    document.dispatchEvent(new CustomEvent('following-synced'));

    const row = document.querySelector('#group-roster [data-user-id="a"]');
    expect(row.querySelector('.card-drawer-toggle')).toBeNull();
    expect(row.querySelector('.notify-bell')).not.toBeNull();
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

  // The roster "Invite to group" row is now the only invite entry point (the
  // Settings-menu Invite button was removed). Render it (owner + meta + members)
  // and click it to exercise the invite-modal wiring.
  function clickRosterInvite({ metaCb, membersCb }) {
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    membersCb({ me: { displayName: 'Me', role: 'owner', joinedAt: 1 } });
    document.getElementById('group-roster-invite-row').querySelector('button').click();
  }

  test('roster invite row opens the modal with group scope', () => {
    let metaCb, membersCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    clickRosterInvite({ metaCb, membersCb });
    expect(inviteModal.openInviteModal).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'group',
      userId: 'me',
      groupId: 'G1',
      groupName: 'Family',
    }));
  });

  test('roster invite row passes activeInvite when an unrevoked group invite exists', () => {
    let metaCb, membersCb, invitesCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    db.watchGroupInvites.mockImplementation((groupId, cb) => { invitesCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    invitesCb({
      tok1: { scope: 'group', token: 'tok1', creatorUid: 'me', createdAt: 2, revoked: false },
    });
    clickRosterInvite({ metaCb, membersCb });
    expect(inviteModal.openInviteModal).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'group',
      activeInvite: expect.objectContaining({
        token: 'tok1',
        url: expect.stringContaining('tok1'),
      }),
    }));
  });

  test('roster invite row passes activeInvite=null when no invites exist', () => {
    let metaCb, membersCb, invitesCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    db.watchGroupInvites.mockImplementation((groupId, cb) => { invitesCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    invitesCb({});
    clickRosterInvite({ metaCb, membersCb });
    expect(inviteModal.openInviteModal).toHaveBeenCalledWith(expect.objectContaining({
      activeInvite: null,
    }));
  });

  test('roster invite row ignores revoked invites', () => {
    let metaCb, membersCb, invitesCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    db.watchGroupInvites.mockImplementation((groupId, cb) => { invitesCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    invitesCb({
      gone: { scope: 'group', token: 'gone', revoked: true },
    });
    clickRosterInvite({ metaCb, membersCb });
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
      me: { role: 'member', displayName: 'Alex K.', joinedAt: 1 },
      a:  { role: 'member', displayName: 'Alice',   joinedAt: 2 },
    });
    window.prompt = jest.fn(() => null);
    document.getElementById('group-action-edit-name').click();
    expect(window.prompt).toHaveBeenCalledWith('Your name in this group', 'Alex K.');
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

// localStorage isolation: the group-context palette picker stores activeSet +
// isPaletteMode per group in localStorage. Without resetting, the set-toggle
// test leaves activeSet=2 in storage and the next test starts looking at the
// wrong set.
beforeEach(() => { try { localStorage.clear(); } catch {} });

describe('own status row', () => {
  function captureCallbacks() {
    let metaCb, primaryCb, overrideCb;
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchStatus.mockImplementation((uid, cb) => { primaryCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation((g, uid, cb) => { overrideCb = cb; return () => {}; });
    return { getMetaCb: () => metaCb, getPrimaryCb: () => primaryCb, getOverrideCb: () => overrideCb };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    setupContextDom();
    // Set up stateful mocks for getGroupPaletteState / setGroupPaletteState
    // so set-toggle tests can mutate and read state.
    const prefsStore = {};
    const prefs = require('../js/prefs.js');
    prefs.getGroupPaletteState.mockImplementation((groupId) => {
      return prefsStore[groupId] || {
        activeSet: 1,
        sets: {
          '1': { selectedKey: 'forest', selectedColor: '#22c55e', activePaletteKey: null },
          '2': { selectedKey: 'volt',   selectedColor: '#aaff00', activePaletteKey: null },
        },
      };
    });
    prefs.setGroupPaletteState.mockImplementation((groupId, state) => {
      prefsStore[groupId] = state;
    });
  });

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

  test('exit restores --my-status to the Direct paletteState color, not the group override\'s color', () => {
    // Regression: user picks orange in group with override ON, navigates
    // back to Direct, observes Direct's dot/border is now orange (leaked
    // from the group). restorePrimaryPalette was only setting --my-status
    // when _ownPrimary.statusColor was truthy — but a fresh user who never
    // picked a swatch in Direct has primary.statusColor=null, so the
    // override's orange stayed stuck on document root after exit.
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    // Fresh user — primary has no statusColor or paletteKey.
    cbs.getPrimaryCb()({ status: 'unavailable', availableUntil: null });
    // Override has orange (the user's group pick).
    cbs.getOverrideCb()({
      enabled: true,
      status: 'available',
      availableUntil: Date.now() + 60 * 60 * 1000,
      statusColor: '#f97316', // ember
    });
    // applyEffectivePalette would have set --my-status to ember while in
    // the group. Confirm + then exit.
    expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#f97316');
    exitGroupContext();
    // After exit, root must show the Direct color — which for a fresh user
    // is the paletteState's selectedKey ('forest' → #22c55e).
    expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#22c55e');
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

  test('dot click going Available keeps the override\'s statusColor on the optimistic update', () => {
    // Regression: the dot handler used to do
    //   _ownOverride = { enabled: true, status: 'available', availableUntil }
    // which wiped statusColor/paletteKey until the watch echo restored them.
    // The dot briefly fell back to the user's Direct color (via --my-status).
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()({
      enabled: true,
      status: 'unavailable',
      availableUntil: null,
      statusColor: '#3b82f6', // ocean
    });
    document.getElementById('group-my-dot').click();
    // The dot should still be painted with the override's statusColor —
    // not cleared to '' (which would defer to --my-status and the user's
    // Direct color).
    const dot = document.getElementById('group-my-dot');
    expect(dot.style.background).not.toBe('');
    expect(dot.style.background.toLowerCase()).toMatch(/3b82f6|59,\s*130,\s*246/);
  });

  test('first override-ON tick with no statusColor seeds it from the picker\'s current selection', () => {
    // Regression: a fresh user who flips override ON via the chain icon but
    // hasn't opened the picker yet would have override.statusColor=null. The
    // dot then fell back to --my-status (their Direct color). Per the
    // user-stated "override ON = independent" principle, seed the override
    // with the picker's currently-selected color (forest by default for
    // Set 1) so subsequent Direct theme changes don't leak in.
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()({ enabled: true, status: 'unavailable', availableUntil: null });
    expect(groupsModule.setOverrideAppearance).toHaveBeenCalledWith('G1', 'me', {
      statusColor: '#22c55e', // forest (Set 1 index 0 default)
    });
  });

  test('first override-ON tick with an existing statusColor does NOT re-seed', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()({
      enabled: true,
      status: 'unavailable',
      availableUntil: null,
      statusColor: '#3b82f6', // ocean
    });
    expect(groupsModule.setOverrideAppearance).not.toHaveBeenCalled();
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

  test('clicking the group dot clears the FTU first-use-pulse', () => {
    const me = require('../js/me.js');
    me.clearFirstUsePulse.mockClear();
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()({ enabled: true, status: 'available', availableUntil: Date.now() + 60 * 60 * 1000 });
    document.getElementById('group-my-dot').click();
    expect(me.clearFirstUsePulse).toHaveBeenCalled();
  });

  test('clicking the group dot in read-only mode (override OFF) still clears the FTU pulse', () => {
    const me = require('../js/me.js');
    me.clearFirstUsePulse.mockClear();
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()(null);
    document.getElementById('group-my-dot').click();
    expect(me.clearFirstUsePulse).toHaveBeenCalled();
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
    // Chip cycle is now per-group (no leak into Direct's getLastTimeout /
    // setLastTimeoutMinutes anymore).
    expect(prefs.setGroupChipMinutes).toHaveBeenCalledWith('G1', 180);
    expect(prefs.setLastTimeout).not.toHaveBeenCalled();
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

  test('group swatch row is visible when override is ON and status is unavailable', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()({ enabled: true, status: 'unavailable', availableUntil: null });
    // Visibility is now opacity-based (.visible on swatch row, inline opacity:0
    // on chips) so the chip+swatch overlap in the same grid cell and the
    // header height stays constant — like Direct's #swatch-row / #header-chips.
    expect(document.getElementById('group-swatch-row').classList.contains('visible')).toBe(true);
    expect(document.querySelector('#group-context-root .group-header-chips').style.opacity).toBe('0');
    // 8 swatches (active set only) + 1 set-toggle button.
    expect(document.querySelectorAll('#group-swatch-row .swatch').length).toBe(8);
    expect(document.querySelectorAll('#group-swatch-row .set-toggle-btn').length).toBe(1);
  });

  test('Set 1 has forest preselected by default for a brand-new group', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()({ enabled: true, status: 'unavailable', availableUntil: null });
    const selected = document.querySelector('#group-swatch-row .swatch.selected');
    expect(selected).not.toBeNull();
    expect(selected.dataset.paletteKey).toBe('forest');
  });

  test('Set 2 has volt preselected by default after toggling sets', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()({ enabled: true, status: 'unavailable', availableUntil: null });
    document.querySelector('#group-swatch-row .set-toggle-btn').click();
    const selected = document.querySelector('#group-swatch-row .swatch.selected');
    expect(selected).not.toBeNull();
    expect(selected.dataset.paletteKey).toBe('volt');
  });

  test('set-toggle writes the target set\'s selectedColor to the override', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()({ enabled: true, status: 'unavailable', availableUntil: null });
    document.querySelector('#group-swatch-row .set-toggle-btn').click();
    expect(groupsModule.setOverrideAppearance).toHaveBeenCalledWith('G1', 'me', {
      statusColor: '#aaff00', // volt
      paletteKey: null,
    });
  });

  test('set-toggle swaps the visible set; both default to base mode', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()({ enabled: true, status: 'unavailable', availableUntil: null });
    // First swatch is the Set 1 default (forest).
    expect(document.querySelectorAll('#group-swatch-row .swatch')[0].dataset.paletteKey).toBe('forest');
    document.querySelector('#group-swatch-row .set-toggle-btn').click();
    // After toggle, first swatch is the Set 2 default (volt).
    expect(document.querySelectorAll('#group-swatch-row .swatch')[0].dataset.paletteKey).toBe('volt');
  });

  test('second tap on a selected swatch enters palette mode (key + 7 complements) by writing paletteKey only', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    // Pick ocean in base mode (statusColor only; paletteKey absent so we're
    // still base mode — matches Direct: first tap = color only).
    cbs.getOverrideCb()({
      enabled: true,
      status: 'unavailable',
      availableUntil: null,
      statusColor: '#3b82f6',
    });
    const oceanSwatch = document.querySelector('#group-swatch-row .swatch[data-palette-key="ocean"]');
    oceanSwatch.click();
    // Second tap promotes to palette mode by writing paletteKey only.
    expect(groupsModule.setOverrideAppearance).toHaveBeenCalledWith('G1', 'me', {
      paletteKey: 'ocean',
    });
  });

  test('palette-mode complement click writes only statusColor (paletteKey preserved by omission)', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    // Open already in palette mode for ocean.
    cbs.getOverrideCb()({
      enabled: true,
      status: 'unavailable',
      availableUntil: null,
      statusColor: '#3b82f6',
      paletteKey: 'ocean',
    });
    // Ocean's base-set index is 1; in palette mode the key swatch stays at
    // slot 1, complements fill slots 0 + 2..7. Click slot 0 (first complement).
    const swatches = document.querySelectorAll('#group-swatch-row .swatch');
    swatches[0].click();
    expect(groupsModule.setOverrideAppearance).toHaveBeenCalledWith('G1', 'me', {
      statusColor: '#06b6d4', // ocean's first complement
    });
  });

  test('palette-mode key swatch stays at the index it occupied in base mode', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    // Open in palette mode for ember (Set 1 index 3).
    cbs.getOverrideCb()({
      enabled: true,
      status: 'unavailable',
      availableUntil: null,
      statusColor: '#f97316',
      paletteKey: 'ember',
    });
    const swatches = document.querySelectorAll('#group-swatch-row .swatch');
    expect(swatches.length).toBe(8);
    // ember is at base index 3 — key swatch should be at the same slot.
    expect(swatches[3].classList.contains('key-swatch')).toBe(true);
    expect(swatches[3].dataset.paletteKey).toBe('ember');
    // None of the other slots are the key swatch.
    [0, 1, 2, 4, 5, 6, 7].forEach((i) => {
      expect(swatches[i].classList.contains('key-swatch')).toBe(false);
    });
  });

  test('group swatch row is hidden when override is ON but status is available', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()({ enabled: true, status: 'available', availableUntil: Date.now() + 60000 });
    expect(document.getElementById('group-swatch-row').classList.contains('visible')).toBe(false);
    expect(document.querySelector('#group-context-root .group-header-chips').style.opacity).toBe('');
  });

  test('group swatch row is hidden when override is OFF (read-only chips remain)', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()(null);
    cbs.getPrimaryCb()({ status: 'unavailable', availableUntil: null });
    expect(document.getElementById('group-swatch-row').classList.contains('visible')).toBe(false);
    expect(document.querySelector('#group-context-root .group-header-chips').style.opacity).toBe('');
  });

  test('base-mode click writes only statusColor — paletteKey is left alone so the theme stays', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()({ enabled: true, status: 'unavailable', availableUntil: null });
    const swatches = document.querySelectorAll('#group-swatch-row .swatch');
    // Pick the second swatch (ocean).
    swatches[1].click();
    expect(groupsModule.setOverrideAppearance).toHaveBeenCalledWith('G1', 'me', {
      statusColor: '#3b82f6',
    });
  });

  test('the selected swatch reflects the current override.paletteKey', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()({
      enabled: true,
      status: 'unavailable',
      availableUntil: null,
      statusColor: '#3b82f6',
      paletteKey: 'ocean',
    });
    const selected = document.querySelector('#group-swatch-row .swatch.selected');
    expect(selected).not.toBeNull();
    expect(selected.dataset.paletteKey).toBe('ocean');
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

  test('available member with statusColor but no paletteKey has fuzzy time in statusColor', () => {
    const getMembers = captureMembers();
    const statusCbs = captureStatuses();
    enterGroupContext('G1', 'me');
    getMembers()({
      me: { role: 'owner', displayName: 'Me', joinedAt: 1 },
      uidC: { role: 'member', displayName: 'C', joinedAt: 4 },
    });
    statusCbs.uidC?.({
      status: 'available',
      availableUntil: Date.now() + 60 * 60 * 1000,
      statusColor: '#3b82f6', // ocean — non-default
      // No paletteKey set.
    });
    const span = document.querySelector('#group-roster [data-user-id="uidC"] .status-available');
    expect(span).not.toBeNull();
    // Inline color attribute on the span carries the statusColor — without
    // this, the .status-available CSS rule's var(--green) wins and the
    // fuzzy time renders forest green for every non-themed member.
    expect(span.getAttribute('style')).toMatch(/color:\s*#3b82f6/i);
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

  test('member with override.enabled=true but no paletteKey does NOT inherit their Direct paletteKey', () => {
    const getMembers = captureMembers();
    const statusCbs = captureStatuses();
    enterGroupContext('G1', 'me');
    getMembers()({
      me: { role: 'owner', displayName: 'Me', joinedAt: 1 },
      uidD: {
        role: 'member',
        displayName: 'D',
        joinedAt: 5,
        statusOverride: {
          enabled: true,
          status: 'available',
          availableUntil: Date.now() + 60 * 60 * 1000,
          statusColor: '#3b82f6', // override color only — no paletteKey
        },
      },
    });
    // D's PRIMARY has ocean paletteKey + statusColor. That's their Direct
    // theme — but override is ON in this group with no per-group paletteKey,
    // so the card must NOT take on ocean's theme. "Override ON = independent
    // in this group."
    statusCbs.uidD?.({
      status: 'available',
      availableUntil: Date.now() + 60 * 60 * 1000,
      statusColor: '#3b82f6',
      paletteKey: 'ocean',
    });
    const li = document.querySelector('#group-roster [data-user-id="uidD"]');
    // No palette surface bg / no theme-tinted text — the card stays as the
    // default surface. The border-left still gets the override.statusColor.
    expect(li.style.background).toBe('');
    const statusEl = li.querySelector('.person-status');
    expect(statusEl.style.color).toBe('');
  });
});

describe('buildGroupCombo', () => {
  let buildGroupCombo;

  beforeEach(() => {
    jest.resetModules();
    ({ buildGroupCombo } = require('../js/groupContext.js'));
  });

  test('prefers override.statusColor + override.paletteKey when override is enabled', () => {
    const combo = buildGroupCombo({
      ownOverride: { enabled: true, statusColor: '#ff00aa', paletteKey: 'forest' },
      ownPrimary:  { statusColor: '#000', paletteKey: 'volt' },
      paletteState: { activeSet: 2, sets: { '1': { selectedKey: 'forest' }, '2': { selectedKey: 'volt' } } },
    });
    expect(combo.statusColor).toBe('#ff00aa');
    expect(combo.paletteKey).toBe('forest');
    expect(combo.activeSet).toBe(2);
    expect(combo.selectedKey).toBe('volt');
  });

  test('statusColor falls back to primary; paletteKey does NOT fall back when override is enabled', () => {
    // statusColor: paintRosterRow uses (override || primary || fallback), so fall-through is correct.
    // paletteKey:  paintRosterRow's override path is (override.paletteKey || null) — when override is
    //              enabled but paletteKey is null, render shows no palette. Match that here so the
    //              saved combo reflects what the user actually saw.
    const combo = buildGroupCombo({
      ownOverride: { enabled: true, statusColor: null, paletteKey: null },
      ownPrimary:  { statusColor: '#abc123', paletteKey: 'volt' },
      paletteState: { activeSet: 1, sets: { '1': { selectedKey: 'forest' }, '2': { selectedKey: 'volt' } } },
    });
    expect(combo.statusColor).toBe('#abc123');
    expect(combo.paletteKey).toBe(null);
  });

  test('falls back to forest #22c55e when neither override nor primary has a color', () => {
    const combo = buildGroupCombo({
      ownOverride: null,
      ownPrimary: null,
      paletteState: { activeSet: 1, sets: { '1': { selectedKey: 'forest' }, '2': { selectedKey: 'volt' } } },
    });
    expect(combo.statusColor).toBe('#22c55e');
    expect(combo.paletteKey).toBe(null);
  });
});

describe('group-context long-press adoption', () => {
  const db = require('../js/db.js');
  const groups = require('../js/groups.js');
  const groupNav = require('../js/groupNav.js');
  const favorites = require('../js/favorites.js');
  const knock = require('../js/knock.js');
  const prefs = require('../js/prefs.js');

  function setupRoster({ ownOverrideEnabled, members }) {
    db.watchGroupMembers.mockImplementation((_gid, cb) => {
      cb(members);
      return () => {};
    });
    db.watchOwnMemberOverride.mockImplementation((_gid, _uid, cb) => {
      cb(ownOverrideEnabled
        ? { enabled: true, status: 'available', availableUntil: Date.now() + 60000, statusColor: '#ff00aa' }
        : { enabled: false, status: null });
      return () => {};
    });
    db.watchStatus.mockImplementation((uid, cb) => {
      cb({ status: 'available', statusColor: '#ff00aa', paletteKey: 'forest' });
      return () => {};
    });
    setupContextDom();
    enterGroupContext('G1', 'me');
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    exitGroupContext();
  });

  test('long-press is a no-op when this group override is OFF', () => {
    setupRoster({
      ownOverrideEnabled: false,
      members: { src: { displayName: 'Alice' } },
    });
    const li = document.querySelector('#group-roster li[data-user-id="src"]');
    li.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
    jest.advanceTimersByTime(600);
    expect(groups.setOverrideAppearance).not.toHaveBeenCalled();
    expect(groupNav.applyOptimisticAppearance).not.toHaveBeenCalled();
    expect(favorites.saveCombo).not.toHaveBeenCalled();
  });

  test('long-press triggers adoption when this group override is ON', () => {
    setupRoster({
      ownOverrideEnabled: true,
      members: { src: { displayName: 'Alice' } },
    });
    const li = document.querySelector('#group-roster li[data-user-id="src"]');
    li.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
    jest.advanceTimersByTime(600);
    expect(groups.setOverrideAppearance).toHaveBeenCalledWith('G1', 'me',
      expect.objectContaining({ statusColor: '#ff00aa', paletteKey: 'forest' }));
    expect(groupNav.applyOptimisticAppearance).toHaveBeenCalledWith('G1',
      expect.objectContaining({ statusColor: '#ff00aa', paletteKey: 'forest' }));
    expect(favorites.saveCombo).toHaveBeenCalledWith(expect.objectContaining({
      statusColor: '#ff00aa', paletteKey: 'forest',
    }));
  });

  test('a long-press starting on the notification bell does NOT adopt', () => {
    setupRoster({
      ownOverrideEnabled: true,
      members: { src: { displayName: 'Alice' } },
    });
    const bell = document.querySelector('#group-roster li[data-user-id="src"] .notify-bell');
    expect(bell).not.toBeNull();
    bell.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0, bubbles: true }));
    jest.advanceTimersByTime(600);
    expect(groups.setOverrideAppearance).not.toHaveBeenCalled();
    expect(groupNav.applyOptimisticAppearance).not.toHaveBeenCalled();
    expect(favorites.saveCombo).not.toHaveBeenCalled();
  });

  test('a long-press on a row while a bell popover is open does NOT adopt', () => {
    isNotifyPopoverOpen.mockReturnValue(true);
    setupRoster({
      ownOverrideEnabled: true,
      members: { src: { displayName: 'Alice' } },
    });
    const li = document.querySelector('#group-roster li[data-user-id="src"]');
    li.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
    jest.advanceTimersByTime(600);
    expect(groups.setOverrideAppearance).not.toHaveBeenCalled();
    expect(groupNav.applyOptimisticAppearance).not.toHaveBeenCalled();
    expect(favorites.saveCombo).not.toHaveBeenCalled();
  });

  test('movement > 8px cancels the long-press', () => {
    setupRoster({
      ownOverrideEnabled: true,
      members: { src: { displayName: 'Alice' } },
    });
    const li = document.querySelector('#group-roster li[data-user-id="src"]');
    li.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
    li.dispatchEvent(new PointerEvent('pointermove', { clientX: 20, clientY: 0 }));
    jest.advanceTimersByTime(600);
    expect(groups.setOverrideAppearance).not.toHaveBeenCalled();
  });

  test('short tap (pointerup before timer) fires knock, not adopt', () => {
    setupRoster({
      ownOverrideEnabled: true,
      members: { src: { displayName: 'Alice' } },
    });
    const li = document.querySelector('#group-roster li[data-user-id="src"]');
    li.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
    jest.advanceTimersByTime(200);
    li.dispatchEvent(new PointerEvent('pointerup', { clientX: 0, clientY: 0 }));
    li.click();
    jest.advanceTimersByTime(400);
    expect(groups.setOverrideAppearance).not.toHaveBeenCalled();
    expect(knock.sendKnock).toHaveBeenCalled();
  });

  test('source with paletteKey but no statusColor adopts the palette key color', () => {
    setupRoster({
      ownOverrideEnabled: true,
      members: { src: { displayName: 'Alice',
                        statusOverride: { enabled: true, statusColor: null, paletteKey: 'volt' } } },
    });
    const li = document.querySelector('#group-roster li[data-user-id="src"]');
    li.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
    jest.advanceTimersByTime(600);
    // 'volt' palette's key color is #aaff00 (defined in PALETTE_SETS).
    expect(groups.setOverrideAppearance).toHaveBeenCalledWith('G1', 'me',
      { statusColor: '#aaff00', paletteKey: 'volt' });
  });

  test('source uses override.statusColor when override is enabled', () => {
    db.watchOwnMemberOverride.mockImplementation((_gid, _uid, cb) => {
      cb({ enabled: true, status: 'available', availableUntil: Date.now() + 60000, statusColor: '#ff00aa' });
      return () => {};
    });
    db.watchGroupMembers.mockImplementation((_gid, cb) => {
      cb({ src: { displayName: 'Alice', statusOverride: { enabled: true, statusColor: '#aa00ff', paletteKey: 'volt' } } });
      return () => {};
    });
    db.watchStatus.mockImplementation((uid, cb) => {
      cb({ statusColor: '#000', paletteKey: 'forest' });   // primary, but override wins
      return () => {};
    });
    setupContextDom();
    enterGroupContext('G1', 'me');
    const li = document.querySelector('#group-roster li[data-user-id="src"]');
    li.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
    jest.advanceTimersByTime(600);
    expect(groups.setOverrideAppearance).toHaveBeenCalledWith('G1', 'me',
      { statusColor: '#aa00ff', paletteKey: 'volt' });
  });

  test('source falls back to primary when source member has no override', () => {
    db.watchOwnMemberOverride.mockImplementation((_gid, _uid, cb) => {
      cb({ enabled: true, status: 'available', availableUntil: Date.now() + 60000, statusColor: '#ff00aa' });
      return () => {};
    });
    db.watchGroupMembers.mockImplementation((_gid, cb) => {
      cb({ src: { displayName: 'Alice' } });   // no override
      return () => {};
    });
    db.watchStatus.mockImplementation((uid, cb) => {
      cb({ statusColor: '#abcdef', paletteKey: 'forest' });
      return () => {};
    });
    setupContextDom();
    enterGroupContext('G1', 'me');
    const li = document.querySelector('#group-roster li[data-user-id="src"]');
    li.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
    jest.advanceTimersByTime(600);
    expect(groups.setOverrideAppearance).toHaveBeenCalledWith('G1', 'me',
      { statusColor: '#abcdef', paletteKey: 'forest' });
  });

  test('source falls back to forest #22c55e when neither override nor primary has a color', () => {
    db.watchOwnMemberOverride.mockImplementation((_gid, _uid, cb) => {
      cb({ enabled: true, status: 'available', availableUntil: Date.now() + 60000, statusColor: '#ff00aa' });
      return () => {};
    });
    db.watchGroupMembers.mockImplementation((_gid, cb) => {
      cb({ src: { displayName: 'Alice' } });
      return () => {};
    });
    db.watchStatus.mockImplementation((uid, cb) => {
      cb({});   // no statusColor, no paletteKey
      return () => {};
    });
    setupContextDom();
    enterGroupContext('G1', 'me');
    const li = document.querySelector('#group-roster li[data-user-id="src"]');
    li.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
    jest.advanceTimersByTime(600);
    expect(groups.setOverrideAppearance).toHaveBeenCalledWith('G1', 'me',
      { statusColor: '#22c55e', paletteKey: null });
  });

  test('marks longpress hint seen on first adoption', () => {
    // prefs.isHintSeen defaults to false via the module-level jest.mock factory.
    db.watchOwnMemberOverride.mockImplementation((_gid, _uid, cb) => {
      cb({ enabled: true, status: 'available', availableUntil: Date.now() + 60000, statusColor: '#ff00aa' });
      return () => {};
    });
    db.watchGroupMembers.mockImplementation((_gid, cb) => {
      cb({ src: { displayName: 'Alice' } });
      return () => {};
    });
    db.watchStatus.mockImplementation((uid, cb) => {
      cb({ statusColor: '#abc', paletteKey: null });
      return () => {};
    });
    setupContextDom();
    enterGroupContext('G1', 'me');
    const li = document.querySelector('#group-roster li[data-user-id="src"]');
    li.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
    jest.advanceTimersByTime(600);
    expect(prefs.markHintSeen).toHaveBeenCalledWith('longpress');
  });
});

describe('group-context dot-tap to go available', () => {
  const db = require('../js/db.js');
  const groups = require('../js/groups.js');
  const favorites = require('../js/favorites.js');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    exitGroupContext();
  });

  test('dot-tap going available with override ON pushes the going-active combo to favorites', () => {
    db.watchGroupMembers.mockImplementation((_gid, cb) => { cb({}); return () => {}; });
    db.watchOwnMemberOverride.mockImplementation((_gid, _uid, cb) => {
      cb({ enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#ff00aa', paletteKey: 'forest' });
      return () => {};
    });
    db.watchStatus.mockImplementation((_uid, cb) => { cb({ statusColor: '#000', paletteKey: null }); return () => {}; });
    setupContextDom();
    enterGroupContext('G1', 'me');

    const dot = document.getElementById('group-my-dot');
    dot.click();

    expect(groups.setOverrideStatusAvailable).toHaveBeenCalled();
    expect(favorites.saveCombo).toHaveBeenCalledWith(expect.objectContaining({
      statusColor: '#ff00aa',
      paletteKey: 'forest',
    }));
  });

  test('dot-tap going UNavailable with override ON does NOT push to favorites', () => {
    db.watchGroupMembers.mockImplementation((_gid, cb) => { cb({}); return () => {}; });
    db.watchOwnMemberOverride.mockImplementation((_gid, _uid, cb) => {
      cb({ enabled: true, status: 'available', availableUntil: Date.now() + 60000, statusColor: '#ff00aa', paletteKey: 'forest' });
      return () => {};
    });
    db.watchStatus.mockImplementation((_uid, cb) => { cb({ statusColor: '#000', paletteKey: null }); return () => {}; });
    setupContextDom();
    enterGroupContext('G1', 'me');

    const dot = document.getElementById('group-my-dot');
    dot.click();

    expect(groups.setOverrideStatusUnavailable).toHaveBeenCalled();
    expect(favorites.saveCombo).not.toHaveBeenCalled();
  });

  test('chip cycle while available does NOT push to favorites', () => {
    db.watchGroupMembers.mockImplementation((_gid, cb) => { cb({}); return () => {}; });
    db.watchOwnMemberOverride.mockImplementation((_gid, _uid, cb) => {
      cb({ enabled: true, status: 'available', availableUntil: Date.now() + 60000, statusColor: '#ff00aa', paletteKey: 'forest' });
      return () => {};
    });
    db.watchStatus.mockImplementation((_uid, cb) => { cb({ statusColor: '#000', paletteKey: null }); return () => {}; });
    setupContextDom();
    enterGroupContext('G1', 'me');

    const chip = document.getElementById('group-time-chip');
    chip.click();
    // Chip cycle updates availableUntil but combo is unchanged — not a transition.
    expect(favorites.saveCombo).not.toHaveBeenCalled();
  });
});

describe('group-context FTU hints', () => {
  const db = require('../js/db.js');
  const prefs = require('../js/prefs.js');

  function seedRoster({ ownOverride, members = {}, memberStatus = {} }) {
    db.watchOwnMemberOverride.mockImplementation((_gid, _uid, cb) => { cb(ownOverride); return () => {}; });
    db.watchGroupMembers.mockImplementation((_gid, cb) => { cb(members); return () => {}; });
    db.watchStatus.mockImplementation((uid, cb) => { cb(memberStatus[uid] ?? {}); return () => {}; });
    setupContextDom();
    enterGroupContext('G1', 'me');
  }

  beforeEach(() => { jest.clearAllMocks(); });
  afterEach(() => { exitGroupContext(); });

  test('group set-toggle button has first-use-pulse when bolt hint unseen', () => {
    prefs.isHintSeen.mockImplementation((name) => name !== 'bolt');
    seedRoster({ ownOverride: { enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#22c55e' } });
    const toggle = document.querySelector('#group-swatch-row .set-toggle-btn');
    expect(toggle).not.toBeNull();
    expect(toggle.classList.contains('first-use-pulse')).toBe(true);
  });

  test('clicking the group set-toggle marks bolt seen and clears pulse', () => {
    prefs.isHintSeen.mockImplementation((name) => name !== 'bolt');
    seedRoster({ ownOverride: { enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#22c55e' } });
    const toggle = document.querySelector('#group-swatch-row .set-toggle-btn');
    toggle.click();
    expect(prefs.markHintSeen).toHaveBeenCalledWith('bolt');
  });

  test('group go-active marks customAvail when user has picked a non-default palette', () => {
    prefs.isHintSeen.mockImplementation(() => false);
    // getGroupPaletteState returns a NON-default selectedKey
    prefs.getGroupPaletteState.mockImplementation(() => ({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'iris', selectedColor: '#818cf8', activePaletteKey: 'iris' },
        '2': { selectedKey: 'volt', selectedColor: '#aaff00', activePaletteKey: null },
      },
    }));
    seedRoster({ ownOverride: { enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#22c55e' } });
    const dot = document.getElementById('group-my-dot');
    dot.click();
    expect(prefs.markHintSeen).toHaveBeenCalledWith('customAvail');
  });

  test('group go-active does NOT mark customAvail when picker is still on default', () => {
    prefs.isHintSeen.mockImplementation(() => false);
    // Defaults: forest in set 1, volt in set 2, no activePaletteKey.
    prefs.getGroupPaletteState.mockImplementation(() => ({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'forest', selectedColor: '#22c55e', activePaletteKey: null },
        '2': { selectedKey: 'volt',   selectedColor: '#aaff00', activePaletteKey: null },
      },
    }));
    seedRoster({ ownOverride: { enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#22c55e' } });
    const dot = document.getElementById('group-my-dot');
    dot.click();
    expect(prefs.markHintSeen).not.toHaveBeenCalledWith('customAvail');
  });

  test('roster member shows .longpress-hint when FTU chain is complete + override ON + combo differs', () => {
    // FTU chain progressed past stripPeek, longpress NOT yet seen.
    prefs.isHintSeen.mockImplementation((name) => name !== 'longpress');
    seedRoster({
      ownOverride: { enabled: true, status: 'available', availableUntil: Date.now() + 60000, statusColor: '#22c55e', paletteKey: 'forest' },
      members: { alice: { displayName: 'Alice', statusOverride: null } },
      memberStatus: { alice: { status: 'available', availableUntil: Date.now() + 60000, statusColor: '#aaff00', paletteKey: 'volt' } },
    });
    const aliceLi = document.querySelector('#group-roster li[data-user-id="alice"]');
    expect(aliceLi).not.toBeNull();
    expect(aliceLi.querySelector('.longpress-hint')).not.toBeNull();
  });

  test('roster does NOT show .longpress-hint when override is OFF', () => {
    prefs.isHintSeen.mockImplementation((name) => name !== 'longpress');
    seedRoster({
      ownOverride: { enabled: false, status: null, availableUntil: null },
      members: { alice: { displayName: 'Alice', statusOverride: null } },
      memberStatus: { alice: { status: 'available', availableUntil: Date.now() + 60000, statusColor: '#aaff00' } },
    });
    const aliceLi = document.querySelector('#group-roster li[data-user-id="alice"]');
    expect(aliceLi.querySelector('.longpress-hint')).toBeNull();
  });

  test('roster does NOT show .longpress-hint when member combo matches user combo', () => {
    prefs.isHintSeen.mockImplementation((name) => name !== 'longpress');
    seedRoster({
      ownOverride: { enabled: true, status: 'available', availableUntil: Date.now() + 60000, statusColor: '#aaff00', paletteKey: 'volt' },
      members: { alice: { displayName: 'Alice', statusOverride: null } },
      memberStatus: { alice: { status: 'available', availableUntil: Date.now() + 60000, statusColor: '#aaff00', paletteKey: 'volt' } },
    });
    const aliceLi = document.querySelector('#group-roster li[data-user-id="alice"]');
    expect(aliceLi.querySelector('.longpress-hint')).toBeNull();
  });

  test('roster does NOT show .longpress-hint when longpress already seen', () => {
    prefs.isHintSeen.mockImplementation(() => true); // EVERYTHING seen including longpress
    seedRoster({
      ownOverride: { enabled: true, status: 'available', availableUntil: Date.now() + 60000, statusColor: '#22c55e', paletteKey: 'forest' },
      members: { alice: { displayName: 'Alice', statusOverride: null } },
      memberStatus: { alice: { status: 'available', availableUntil: Date.now() + 60000, statusColor: '#aaff00', paletteKey: 'volt' } },
    });
    const aliceLi = document.querySelector('#group-roster li[data-user-id="alice"]');
    expect(aliceLi.querySelector('.longpress-hint')).toBeNull();
  });

  test('group dot gets dot-go-hint when user has picked a non-default swatch and is unavailable', () => {
    prefs.isHintSeen.mockImplementation((name) => name !== 'customAvail');
    prefs.getGroupPaletteState.mockImplementation(() => ({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'iris', selectedColor: '#818cf8', activePaletteKey: null },
        '2': { selectedKey: 'volt', selectedColor: '#aaff00', activePaletteKey: null },
      },
    }));
    seedRoster({ ownOverride: { enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#818cf8' } });
    const dot = document.getElementById('group-my-dot');
    expect(dot.classList.contains('dot-go-hint')).toBe(true);
  });

  test('group dot does NOT get dot-go-hint when user is on the default swatch', () => {
    prefs.isHintSeen.mockImplementation((name) => name !== 'customAvail');
    prefs.getGroupPaletteState.mockImplementation(() => ({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'forest', selectedColor: '#22c55e', activePaletteKey: null },
        '2': { selectedKey: 'volt',   selectedColor: '#aaff00', activePaletteKey: null },
      },
    }));
    seedRoster({ ownOverride: { enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#22c55e' } });
    const dot = document.getElementById('group-my-dot');
    expect(dot.classList.contains('dot-go-hint')).toBe(false);
  });

  test('group dot loses dot-go-hint when user goes available', () => {
    prefs.isHintSeen.mockImplementation((name) => name !== 'customAvail');
    prefs.getGroupPaletteState.mockImplementation(() => ({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'iris', selectedColor: '#818cf8', activePaletteKey: null },
        '2': { selectedKey: 'volt', selectedColor: '#aaff00', activePaletteKey: null },
      },
    }));
    seedRoster({ ownOverride: { enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#818cf8' } });
    const dot = document.getElementById('group-my-dot');
    expect(dot.classList.contains('dot-go-hint')).toBe(true);
    dot.click();
    expect(dot.classList.contains('dot-go-hint')).toBe(false);
  });

  test('group swatch row gets .hint-wave on unselected swatches when on default + customAvail unseen', () => {
    prefs.isHintSeen.mockImplementation(() => false);
    prefs.getGroupPaletteState.mockImplementation(() => ({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'forest', selectedColor: '#22c55e', activePaletteKey: null },
        '2': { selectedKey: 'volt',   selectedColor: '#aaff00', activePaletteKey: null },
      },
    }));
    seedRoster({ ownOverride: { enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#22c55e' } });
    // group swatch row visible (override ON + unavailable).
    const swatches = document.querySelectorAll('#group-swatch-row .swatch.hint-wave');
    expect(swatches.length).toBeGreaterThan(0);
  });

  test('promoting a group swatch to palette mode plays the key-spin animation once', () => {
    prefs.isHintSeen.mockImplementation(() => false);
    // Start with palette mode ON (so key-swatch is rendered). The promote
    // happens by tapping the selected key-swatch when it's the default base
    // mode — but a cleaner trigger is to tap a non-selected base-mode swatch
    // then verify the next render of palette mode shows key-spin. For this
    // test we set up palette mode directly and trigger via a re-promote.
    let state = {
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'forest', selectedColor: '#22c55e', activePaletteKey: null },
        '2': { selectedKey: 'volt',   selectedColor: '#aaff00', activePaletteKey: null },
      },
    };
    prefs.getGroupPaletteState.mockImplementation(() => JSON.parse(JSON.stringify(state)));
    prefs.setGroupPaletteState.mockImplementation((_gid, s) => { state = JSON.parse(JSON.stringify(s)); });
    seedRoster({ ownOverride: { enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#22c55e' } });
    // In base mode (no activePaletteKey), the selected swatch is forest.
    // Tapping it promotes to palette mode for forest.
    const selectedSwatch = document.querySelector('#group-swatch-row .swatch.selected');
    expect(selectedSwatch).not.toBeNull();
    selectedSwatch.click();
    // Now in palette mode → key-swatch is rendered with key-spin.
    const keySpin = document.querySelector('#group-swatch-row .swatch.key-swatch.key-spin');
    expect(keySpin).not.toBeNull();
  });

  test('group swatch row does NOT get .hint-wave when customAvail already seen', () => {
    // shouldShowHints in palettes.js reads localStorage directly (not the
    // prefs mock), so set the legacy key to simulate "customAvail seen".
    localStorage.setItem('statusapp_went_avail_custom', '1');
    prefs.isHintSeen.mockImplementation(() => true);
    prefs.getGroupPaletteState.mockImplementation(() => ({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'forest', selectedColor: '#22c55e', activePaletteKey: null },
        '2': { selectedKey: 'volt',   selectedColor: '#aaff00', activePaletteKey: null },
      },
    }));
    seedRoster({ ownOverride: { enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#22c55e' } });
    const swatches = document.querySelectorAll('#group-swatch-row .swatch.hint-wave');
    expect(swatches.length).toBe(0);
  });

  test('key-spin survives a subsequent re-render within the 5s animation window', () => {
    prefs.isHintSeen.mockImplementation(() => false);
    let state = {
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'forest', selectedColor: '#22c55e', activePaletteKey: null },
        '2': { selectedKey: 'volt',   selectedColor: '#aaff00', activePaletteKey: null },
      },
    };
    prefs.getGroupPaletteState.mockImplementation(() => JSON.parse(JSON.stringify(state)));
    prefs.setGroupPaletteState.mockImplementation((_gid, s) => { state = JSON.parse(JSON.stringify(s)); });
    // Capture the override callback so we can replay the RTDB echo manually.
    let overrideCb;
    db.watchOwnMemberOverride.mockImplementation((_gid, _uid, cb) => {
      overrideCb = cb;
      cb({ enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#22c55e' });
      return () => {};
    });
    db.watchGroupMembers.mockImplementation((_gid, cb) => { cb({}); return () => {}; });
    db.watchStatus.mockImplementation((_uid, cb) => { cb({}); return () => {}; });
    setupContextDom();
    enterGroupContext('G1', 'me');
    // Promote to palette mode by tapping the selected base swatch.
    const selectedSwatch = document.querySelector('#group-swatch-row .swatch.selected');
    selectedSwatch.click();
    expect(document.querySelector('#group-swatch-row .swatch.key-swatch.key-spin')).not.toBeNull();
    // Simulate the setOverrideAppearance echo arriving: the override
    // callback fires again, triggering renderOwnStatusRow → renderGroupSwatchRow.
    // Without the timestamp-based fix, the second render would create a new
    // key swatch without .key-spin and the animation would die.
    overrideCb({ enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#22c55e', paletteKey: 'forest' });
    expect(document.querySelector('#group-swatch-row .swatch.key-swatch.key-spin')).not.toBeNull();
  });

  test('group base-mode swatch row gets theme-hint on selected when customAvail seen and theme unseen', () => {
    prefs.isHintSeen.mockImplementation((name) => name === 'customAvail');
    prefs.getGroupPaletteState.mockImplementation(() => ({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'forest', selectedColor: '#22c55e', activePaletteKey: null },
        '2': { selectedKey: 'volt',   selectedColor: '#aaff00', activePaletteKey: null },
      },
    }));
    seedRoster({ ownOverride: { enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#22c55e' } });
    const selected = document.querySelector('#group-swatch-row .swatch.selected');
    expect(selected).not.toBeNull();
    expect(selected.classList.contains('theme-hint')).toBe(true);
  });

  test('group base-mode swatch row does NOT get theme-hint when theme already seen', () => {
    prefs.isHintSeen.mockImplementation(() => true); // customAvail AND theme both seen
    prefs.getGroupPaletteState.mockImplementation(() => ({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'forest', selectedColor: '#22c55e', activePaletteKey: null },
        '2': { selectedKey: 'volt',   selectedColor: '#aaff00', activePaletteKey: null },
      },
    }));
    seedRoster({ ownOverride: { enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#22c55e' } });
    const selected = document.querySelector('#group-swatch-row .swatch.selected');
    expect(selected.classList.contains('theme-hint')).toBe(false);
  });

  test('group base-mode swatch row does NOT get theme-hint when customAvail not seen', () => {
    prefs.isHintSeen.mockImplementation(() => false);
    prefs.getGroupPaletteState.mockImplementation(() => ({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'forest', selectedColor: '#22c55e', activePaletteKey: null },
        '2': { selectedKey: 'volt',   selectedColor: '#aaff00', activePaletteKey: null },
      },
    }));
    seedRoster({ ownOverride: { enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#22c55e' } });
    const selected = document.querySelector('#group-swatch-row .swatch.selected');
    expect(selected.classList.contains('theme-hint')).toBe(false);
  });

  test('group dot does NOT get dot-go-hint when override is OFF', () => {
    prefs.isHintSeen.mockImplementation((name) => name !== 'customAvail');
    prefs.getGroupPaletteState.mockImplementation(() => ({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'iris', selectedColor: '#818cf8', activePaletteKey: null },
        '2': { selectedKey: 'volt', selectedColor: '#aaff00', activePaletteKey: null },
      },
    }));
    seedRoster({ ownOverride: { enabled: false, status: null, availableUntil: null } });
    const dot = document.getElementById('group-my-dot');
    expect(dot.classList.contains('dot-go-hint')).toBe(false);
  });
});

// --- notification bell on roster rows ---

describe('notification bell on roster rows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupContextDom();
    createNotifyBell.mockImplementation(() => {
      const b = document.createElement('button');
      b.className = 'notify-bell';
      return b;
    });
  });

  test('renders a notification bell on each roster member when NOTIFICATIONS_ENABLED', () => {
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({ bea: { role: 'member', displayName: 'Bea', joinedAt: 1 } });

    const li = document.querySelector('#group-roster [data-user-id="bea"]');
    expect(li.querySelector('.notify-bell')).not.toBeNull();
    expect(createNotifyBell).toHaveBeenCalledWith('bea',
      expect.objectContaining({ types: ['knock', 'availability'] }));
  });
});

