// tests/groupContext.test.js
jest.mock('../js/hintRotation.js', () => ({
  refreshHints: jest.fn(),
  initHintRotation: jest.fn(),
  stopHintRotation: jest.fn(),
  clearActiveHint: jest.fn(),
}));
jest.mock('../js/ownStatus.js', () => ({
  subscribeOwnStatus: jest.fn(() => () => {}),
}));
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
  isAvailable: (s, t) => s === 'available' && !(t !== null && t !== undefined && t < Date.now()),
  readGroup: jest.fn().mockResolvedValue(null),
  watchGroupMeta: jest.fn(() => () => {}),
  watchGroupMembers: jest.fn(() => () => {}),
  watchGroupInvites: jest.fn(() => () => {}),
  watchPresence: jest.fn(() => () => {}),
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
    return `about ${Math.round(hours)} hours`;
  }),
  watchPendingInvites: jest.fn(() => () => {}),
  writePendingInvite: jest.fn().mockResolvedValue(undefined),
  deletePendingInvite: jest.fn().mockResolvedValue(undefined),
  readPendingInviteesForGroup: jest.fn().mockResolvedValue([]),
}));
jest.mock('../js/invites.js', () => ({
  buildInviteUrl: jest.fn((token) => `https://app.example/invite?i=${token}`),
}));
jest.mock('../js/groupNav.js', () => ({
  navigateToDirect: jest.fn().mockResolvedValue(undefined),
  getCurrentContext: jest.fn(() => ({ context: 'group', groupId: 'G1' })),
  subscribeGroupMeta: jest.fn(() => () => {}),
}));
// Own-override state now lives in statusStore. Same in-suite cache mock as the
// groupNav suite: subscribeOwnOverride + pushOptimistic share a cache so an
// optimistic push (dot/chip/adopt) fans out to groupContext's subscription and
// re-renders, exactly as the real store does. __fireOverride simulates a tick.
jest.mock('../js/statusStore.js', () => {
  const cache = new Map();
  const consumers = new Map();
  const ticked = new Set();
  const valueOf = (gid) => (cache.has(gid) ? cache.get(gid) : null);
  const fanOut = (gid) => {
    const set = consumers.get(gid);
    if (!set) return;
    for (const cb of [...set]) { try { cb(valueOf(gid)); } catch { /* consumer threw */ } }
  };
  const getOwnOverrideImpl = (gid) => valueOf(gid);
  const pushOptimisticImpl = (gid, partial) => {
    if (gid === null) return;
    cache.set(gid, { ...(cache.get(gid) || {}), ...partial });
    ticked.add(gid);
    fanOut(gid);
  };
  const subscribeOwnOverrideImpl = (gid, cb) => {
    let set = consumers.get(gid);
    if (!set) { set = new Set(); consumers.set(gid, set); }
    set.add(cb);
    if (ticked.has(gid)) { try { cb(valueOf(gid)); } catch { /* replay threw */ } }
    return () => { const s = consumers.get(gid); if (s) s.delete(cb); };
  };
  const mod = {
    __esModule: true,
    initStatusStore: jest.fn(),
    setWatchedGroups: jest.fn(),
    getOwnOverride: jest.fn(getOwnOverrideImpl),
    pushOptimistic: jest.fn(pushOptimisticImpl),
    subscribeOwnOverride: jest.fn(subscribeOwnOverrideImpl),
    __fireOverride: (gid, v) => { cache.set(gid, v); ticked.add(gid); fanOut(gid); },
    // __reset clears the closure cache AND restores default implementations — a
    // per-test mockImplementation (e.g. the teardown spy) would otherwise persist
    // (clearAllMocks resets calls, not implementations) and starve later tests.
    __reset: () => {
      cache.clear(); consumers.clear(); ticked.clear();
      mod.getOwnOverride.mockImplementation(getOwnOverrideImpl);
      mod.pushOptimistic.mockImplementation(pushOptimisticImpl);
      mod.subscribeOwnOverride.mockImplementation(subscribeOwnOverrideImpl);
    },
  };
  return mod;
});
jest.mock('../js/groups.js', () => ({
  renameGroup: jest.fn().mockResolvedValue(undefined),
  deleteGroup: jest.fn().mockResolvedValue(undefined),
  leaveGroup: jest.fn().mockResolvedValue(undefined),
  editOwnDisplayName: jest.fn().mockResolvedValue(undefined),
  toggleStatusOverride: jest.fn().mockResolvedValue(undefined),
  setOverrideStatusAvailable: jest.fn().mockResolvedValue(undefined),
  setOverrideStatusUnavailable: jest.fn().mockResolvedValue(undefined),
  setOverrideAppearance: jest.fn().mockResolvedValue(undefined),
  showToast: jest.fn(),
  LOCATION_DENIED_TOAST: 'Location permission is denied — allow location access for this app in your device settings.',
}));
jest.mock('../js/promptModal.js', () => ({
  showTextPrompt: jest.fn(),
  showConfirmModal: jest.fn(),
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
  getLocationOptIn: jest.fn(() => false),
}));
jest.mock('../js/locationShare.js', () => ({
  toggleContext: jest.fn(),
  capabilityState: jest.fn(() => 'supported'),
  isPermissionDenied: jest.fn(() => false),
  // Distance-sub eligibility requires the context's own node to exist
  // (last-known model) AND own availability IN THAT CONTEXT (de facto
  // sharing; group availability is override-aware and independent of
  // Direct) — default true so the roster distance tests exercise the
  // opt-in axis independently.
  isContextPublished: jest.fn(() => true),
  isContextAvailable: jest.fn(() => true),
}));
jest.mock('../js/locationHub.js', () => ({
  subscribeCellDistance: jest.fn(() => jest.fn()),
  subscribeDistance: jest.fn(() => jest.fn()),
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
  // Real implementation (mirrors js/me.js's paintLocationGlyph) so the group
  // glyph tests can assert on actual DOM state, not just call args — same
  // pattern as the cardDrawer/notifyBell functional mocks in this file.
  paintLocationGlyph: jest.fn((el, state) => {
    el.classList.toggle('on', state === 'on');
    el.classList.toggle('denied', state === 'denied' || state === 'unsupported');
    el.setAttribute('aria-pressed', state === 'on' ? 'true' : 'false');
    if (state === 'denied') el.title = 'Location unavailable — check permissions';
    else if (state === 'unsupported') el.title = 'Location unavailable — not supported on this device';
    else el.removeAttribute('title');
  }),
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
const ownStatus = require('../js/ownStatus.js');
const groupNav = require('../js/groupNav.js');
const statusStore = require('../js/statusStore.js');
const groupsModule = require('../js/groups.js');
const inviteModal = require('../js/inviteModal.js');
const prefs = require('../js/prefs.js');
const store = require('../js/store.js');
const { enterGroupContext, exitGroupContext } = require('../js/groupContext');
const { createNotifyBell, isNotifyPopoverOpen } = require('../js/notifyBell.js');

// Default implementation: return a real button so li.appendChild doesn't throw.
beforeEach(() => {
  statusStore.__reset(); // the store mock's cache lives in a module-closure
  require('../js/presenceHub.js')._resetPresenceHub(); // clean per-uid watch state between tests
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
              <button id="group-location-glyph" class="location-glyph" aria-label="Share location" aria-pressed="false" style="display:none"></button>
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
    groupNav.subscribeGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    expect(() => metaCb({ name: 'Family', ownerId: 'owner', createdAt: 1 })).not.toThrow();
  });

  test('shows owner-only action buttons when caller is the owner', () => {
    let metaCb;
    groupNav.subscribeGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    expect(document.getElementById('group-action-rename').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('group-action-delete').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('group-action-edit-name').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('group-action-leave').classList.contains('hidden')).toBe(true);
  });

  test('shows member-only action buttons when caller is a non-owner member', () => {
    let metaCb;
    groupNav.subscribeGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
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
    groupNav.subscribeGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb(null); // group entity was deleted
    expect(db.removeUserGroupsEntry).toHaveBeenCalledWith('me', 'G1');
  });
});

describe('group roster render', () => {
  // Shared MutationObserver helper: capture records via the callback. A no-op
  // observer callback drains the queue before takeRecords() runs, so
  // callback-capture is the reliable technique in this jsdom setup. Used by the
  // Task-1 repaint tests and the audit-2 N3 appearance-tick test.
  function observeRow(el) {
    const records = [];
    const mo = new MutationObserver((muts) => records.push(...muts));
    mo.observe(el, { attributes: true, attributeOldValue: true, childList: true, subtree: true, characterData: true });
    return { records, disconnect: () => mo.disconnect() };
  }

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

  test('each member gets a watchPresence subscription', () => {
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({
      'a': { role: 'member', displayName: 'Alice', joinedAt: 1 },
      'b': { role: 'member', displayName: 'Bob',   joinedAt: 2 },
    });
    expect(db.watchPresence).toHaveBeenCalledWith('a', expect.any(Function));
    expect(db.watchPresence).toHaveBeenCalledWith('b', expect.any(Function));
  });

  test('member status updates render the available/unavailable dot', () => {
    let membersCb;
    const statusCbs = {};
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    db.watchPresence.mockImplementation((uid, cb) => { statusCbs[uid] = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({ 'a': { role: 'member', displayName: 'Alice', joinedAt: 1 } });

    statusCbs.a({ status: 'available', statusColor: '#22c55e', availableUntil: Date.now() + 60000 });
    const dot = document.querySelector('#group-roster [data-user-id="a"] .person-dot');
    expect(dot).not.toBeNull();
    expect(dot.dataset.available).toBe('true');
  });

  test('a member override applies on the first render, before any presence tick (reconcile update-before-insert)', () => {
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    db.watchPresence.mockImplementation(() => () => {}); // presence never fires
    enterGroupContext('G1', 'me');
    const ovr = { enabled: true, status: 'available', availableUntil: Date.now() + 3600000 };
    membersCb({ b: { role: 'member', displayName: 'Bob', joinedAt: 1, statusOverride: ovr } });
    const li = document.querySelector('#group-roster [data-user-id="b"]');
    expect(li.dataset.available).toBe('true');
  });

  test('exitGroupContext unsubscribes from member status watchers', () => {
    let membersCb;
    const unsubs = [];
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    db.watchPresence.mockImplementation(() => { const fn = jest.fn(); unsubs.push(fn); return fn; });
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
    db.watchPresence.mockImplementation((uid, cb) => { statusCbs[uid] = cb; return () => {}; });
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
    db.watchPresence.mockImplementation((uid, cb) => { statusCbs[uid] = cb; return () => {}; });
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
    db.watchPresence.mockImplementation((uid, cb) => { statusCbs[uid] = cb; return () => {}; });
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

  test('removed members lose their watchPresence subscription on the next tick', () => {
    let membersCb;
    const unsubByUid = {};
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    db.watchPresence.mockImplementation((uid) => { const fn = jest.fn(); unsubByUid[uid] = fn; return fn; });
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

  // Perf audit item: syncStatusSubscriptions' subscribePresence callback used to
  // call syncRosterOrder() (full resort + repaint of every row) on every tick,
  // including lastSeen-only writes stamped on every peer app-open. Mirrors the
  // Direct-list discipline (js/following.ts ~1093-1102): repaint only the
  // ticking member's row; resort only when effective availability flips.
  describe('presence ticks repaint only the ticking row (Task 1)', () => {
    test('a lastSeen-only tick does not touch the other members\' rows', async () => {
      let membersCb;
      const statusCbs = {};
      db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
      db.watchPresence.mockImplementation((uid, cb) => { statusCbs[uid] = cb; return () => {}; });
      enterGroupContext('G1', 'me');
      membersCb({
        a: { role: 'member', displayName: 'Alice', joinedAt: 1 },
        b: { role: 'member', displayName: 'Bob', joinedAt: 2 },
        c: { role: 'member', displayName: 'Carol', joinedAt: 3 },
      });
      // Establish a baseline presence for all three (all unavailable).
      statusCbs.a({ status: 'unavailable', availableUntil: null, lastSeen: 1000 });
      statusCbs.b({ status: 'unavailable', availableUntil: null, lastSeen: 1000 });
      statusCbs.c({ status: 'unavailable', availableUntil: null, lastSeen: 1000 });

      const rowA = document.querySelector('#group-roster [data-user-id="a"]');
      const rowB = document.querySelector('#group-roster [data-user-id="b"]');
      const rowC = document.querySelector('#group-roster [data-user-id="c"]');
      const obsA = observeRow(rowA);
      const obsB = observeRow(rowB);
      const obsC = observeRow(rowC);

      // lastSeen-only tick on Alice: same status/availableUntil (no availability
      // flip), just a newer lastSeen stamp (js/db/social.ts:293 writes this on
      // every peer app-open).
      statusCbs.a({ status: 'unavailable', availableUntil: null, lastSeen: 2000 });
      await Promise.resolve(); // flush the MutationObserver microtask queue

      obsA.disconnect(); obsB.disconnect(); obsC.disconnect();

      expect(obsA.records.length).toBeGreaterThan(0); // the ticking row IS repainted
      expect(obsB.records.length).toBe(0); // untouched — no full resort/repaint
      expect(obsC.records.length).toBe(0); // untouched — no full resort/repaint
    });

    test('an availability flip still reorders the roster', () => {
      let membersCb;
      const statusCbs = {};
      db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
      db.watchPresence.mockImplementation((uid, cb) => { statusCbs[uid] = cb; return () => {}; });
      enterGroupContext('G1', 'me');
      membersCb({
        a: { role: 'member', displayName: 'Alice', joinedAt: 1 },
        b: { role: 'member', displayName: 'Bob', joinedAt: 2 },
        c: { role: 'member', displayName: 'Carol', joinedAt: 3 },
      });
      statusCbs.a({ status: 'unavailable', availableUntil: null });
      statusCbs.b({ status: 'unavailable', availableUntil: null });
      statusCbs.c({ status: 'unavailable', availableUntil: null });

      const order = () => Array.from(document.querySelectorAll('#group-roster li[data-user-id]'))
        .map((el) => el.dataset.userId);
      expect(order()).toEqual(['a', 'b', 'c']); // alphabetical, all unavailable

      // Carol flips to available — must float to the top (a resort, not just a repaint).
      statusCbs.c({ status: 'available', availableUntil: Date.now() + 60000 });
      expect(order()).toEqual(['c', 'a', 'b']);
    });
  });

  // Perf audit item (audit-2 N3): the open group's watchGroupMembers callback
  // had zero change detection — every co-member statusOverride write (per
  // swatch/palette tap) re-ran the FULL pass (renderRoster -> reconcile-
  // DistanceSubs, reconcileChildren repainting every row, refreshHints) and
  // syncStatusSubscriptions for every viewer in the group, even though
  // appearance fields (statusColor/paletteKey) can't change membership,
  // names, ordering, distance eligibility, or the status-sub set. Client
  // analogue of Task 3's server-side gate.
  describe('appearance-only member ticks take the fast path (audit-2 N3)', () => {
    test('a statusColor-only override tick repaints only the touched row (audit-2 N3)', async () => {
      let membersCb;
      db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
      enterGroupContext('G1', 'me');
      const base = {
        me: { displayName: 'Me' },
        u2: { displayName: 'Bea', statusOverride: { enabled: true, status: 'available', statusColor: '#111111', availableUntil: null } },
        u3: { displayName: 'Cal' },
      };
      membersCb(base);
      await Promise.resolve();
      const rowU3 = document.querySelector('[data-user-id="u3"]');
      // Callback-capture (not takeRecords()) via the shared observeRow helper:
      // a no-op observer callback drains the queue before takeRecords() runs.
      const obsU3 = observeRow(rowU3);
      membersCb({ ...base, u2: { ...base.u2, statusOverride: { ...base.u2.statusOverride, statusColor: '#222222' } } });
      await Promise.resolve();
      obsU3.disconnect();
      expect(obsU3.records.length).toBe(0); // untouched row: zero DOM work

      // The touched row DID repaint — same observable paintRosterRow effects
      // the file's existing tests assert for a member row's statusColor:
      // the .status-available span's inline color (copied from "available
      // member with statusColor but no paletteKey has fuzzy time in
      // statusColor", ~L1758-1763) and the dot's painted background (copied
      // from "dot click going Available keeps the override's statusColor on
      // the optimistic update", ~L1267-1269 — paintStatusDot is the same
      // function for both the own-status dot and a roster row's .person-dot).
      const rowU2 = document.querySelector('[data-user-id="u2"]');
      const span = rowU2.querySelector('.status-available');
      expect(span).not.toBeNull();
      expect(span.getAttribute('style')).toMatch(/color:\s*#222222/i);
      const dot = rowU2.querySelector('.person-dot');
      expect(dot.style.background).not.toBe('');
      expect(dot.style.background.toLowerCase()).toMatch(/222222|34,\s*34,\s*34/);
    });

    test('a membership change still runs the full reconcile after an appearance tick', async () => {
      let membersCb;
      db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
      enterGroupContext('G1', 'me');
      const base = { me: { displayName: 'Me' }, u2: { displayName: 'Bea' } };
      membersCb(base);
      await Promise.resolve();
      membersCb({ ...base, u4: { displayName: 'Dex' } }); // join
      await Promise.resolve();
      expect(document.querySelector('[data-user-id="u4"]')).not.toBeNull();
    });

    test('an override enabled-flip is NOT the fast path (ordering may change)', async () => {
      let membersCb;
      db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
      enterGroupContext('G1', 'me');
      const ov = { enabled: true, status: 'available', statusColor: '#111111', availableUntil: null };
      const base = { me: { displayName: 'Me' }, u2: { displayName: 'Bea', statusOverride: ov } };
      membersCb(base);
      await Promise.resolve();
      membersCb({ ...base, u2: { ...base.u2, statusOverride: { ...ov, enabled: false } } });
      await Promise.resolve();
      // Full pass ran: the row left the available cohort. Same assertions the
      // file's existing availability tests make for this transition — dataset
      // .available (copied from "member with override.enabled uses override
      // status not primary", ~L1723) and the .person-dot 'available' class
      // toggle (same test, ~L1728) — inverted here since u2 is leaving the
      // available cohort rather than entering it.
      const li = document.querySelector('[data-user-id="u2"]');
      expect(li.dataset.available).toBe('false');
      expect(li.querySelector('.person-dot').classList.contains('available')).toBe(false);
    });
  });

  function captureRosterCallbacks() {
    let metaCb, membersCb;
    groupNav.subscribeGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
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
    expect(followRequests.createRequestFollowButton).toHaveBeenCalledWith('me', 'a', 'G1', 'Alice');
    expect(row.querySelector('.card-drawer-toggle').dataset.actionCount).toBe('2');
  });

  test('switching groups recreates the request-follow button with the NEW group id + name (no stale capture across groups)', () => {
    const followRequests = require('../js/followRequests.js');
    followRequests.isFollowRequestEligible.mockReturnValue(true);
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });

    enterGroupContext('G2', 'me');
    membersCb({ a: { role: 'member', displayName: 'DOG', joinedAt: 1 } });
    expect(followRequests.createRequestFollowButton).toHaveBeenCalledWith('me', 'a', 'G2', 'DOG');

    followRequests.createRequestFollowButton.mockClear();
    enterGroupContext('G1', 'me'); // 'a' is a member of BOTH groups, named CAT here
    membersCb({ a: { role: 'member', displayName: 'CAT', joinedAt: 1 } });
    // Without a roster reset the reconcile would reuse G2's row (update path) and
    // never recreate the button → it would keep capturing 'G2' + 'DOG'.
    expect(followRequests.createRequestFollowButton).toHaveBeenCalledWith('me', 'a', 'G1', 'CAT');
  });

  test('a card drawer survives a members tick that keeps its row, closes when the row is removed', () => {
    // Reconciliation contract (render-reconciliation spec §3): the blanket
    // close-on-every-render is gone; the drawer closes only when its row is removed.
    const cardDrawer = require('../js/cardDrawer.js');
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });
    cardDrawer.closeCardDrawer.mockClear();
    // Unrelated tick (same member set): the drawer must NOT be force-closed.
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });
    expect(cardDrawer.closeCardDrawer).not.toHaveBeenCalled();
    // Simulate the open drawer living inside a's row, then remove a.
    const rowA = document.querySelector('#group-roster [data-user-id="a"]');
    const slice = document.createElement('div');
    slice.className = 'card-drawer';
    rowA.appendChild(slice);
    cardDrawer.isCardDrawerOpen.mockReturnValue(true);
    membersCb({});
    expect(cardDrawer.closeCardDrawer).toHaveBeenCalled();
    cardDrawer.isCardDrawerOpen.mockReturnValue(false);
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

  test('roster rows keep node identity across a members tick', () => {
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });
    const rowA = document.querySelector('#group-roster [data-user-id="a"]');
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });
    expect(document.querySelector('#group-roster [data-user-id="a"]')).toBe(rowA);
  });

  test('knock fires once per tap after two members ticks (no duplicated handlers)', () => {
    const knock = require('../js/knock.js');
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });
    document.querySelector('#group-roster [data-user-id="a"]').click();
    expect(knock.sendKnock).toHaveBeenCalledTimes(1);
  });

  test('an eligibility flip recreates the row (key carries the eligibility bit)', () => {
    const followRequests = require('../js/followRequests.js');
    followRequests.isFollowRequestEligible.mockReturnValue(true);
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });
    const before = document.querySelector('#group-roster [data-user-id="a"]');
    expect(before.querySelector('.card-drawer-toggle')).not.toBeNull();
    followRequests.isFollowRequestEligible.mockReturnValue(false);
    document.dispatchEvent(new CustomEvent('following-synced'));
    const after = document.querySelector('#group-roster [data-user-id="a"]');
    expect(after).not.toBe(before); // recreated, not patched
    expect(after.querySelector('.card-drawer-toggle')).toBeNull();
    expect(after.querySelector('.notify-bell')).not.toBeNull();
  });

  test('a floated member stays pinned to the top across a members tick', () => {
    const knock = require('../js/knock.js');
    knock.getFloatedUserIds.mockReturnValue(['b']);
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({
      a: { role: 'member', displayName: 'Alice', joinedAt: 1 },
      b: { role: 'member', displayName: 'Bob', joinedAt: 2 },
    });
    const rows = [...document.querySelectorAll('#group-roster li')];
    expect(rows[0].dataset.userId).toBe('b'); // floated beats alphabetical
    knock.getFloatedUserIds.mockReturnValue([]);
  });

  test('a displayName change repaints the surviving row label', () => {
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });
    const rowA = document.querySelector('#group-roster [data-user-id="a"]');
    membersCb({ a: { role: 'member', displayName: 'Alicia', joinedAt: 1 } });
    expect(document.querySelector('#group-roster [data-user-id="a"]')).toBe(rowA);
    expect(rowA.querySelector('.person-label').textContent).toBe('Alicia');
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

  test('a floated row survives an eligibility flip (recreated, still pinned, restore-safe)', () => {
    const knock = require('../js/knock.js');
    const followRequests = require('../js/followRequests.js');
    followRequests.isFollowRequestEligible.mockReturnValue(true);
    knock.getFloatedUserIds.mockReturnValue(['a']);
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({
      a: { role: 'member', displayName: 'Alice', joinedAt: 1 },
      b: { role: 'member', displayName: 'Bob', joinedAt: 2 },
    });
    const before = document.querySelector('#group-roster [data-user-id="a"]');
    expect([...document.querySelectorAll('#group-roster li')][0]).toBe(before); // floated → top
    // Eligibility flips mid-float: the key changes, the row is recreated…
    followRequests.isFollowRequestEligible.mockReturnValue(false);
    document.dispatchEvent(new CustomEvent('following-synced'));
    const after = document.querySelector('#group-roster [data-user-id="a"]');
    expect(after).not.toBe(before);
    // …but stays pinned to the top (still floated) and is findable by the
    // float-restore lookup ([data-user-id] within the list).
    expect([...document.querySelectorAll('#group-roster li')][0]).toBe(after);
    knock.getFloatedUserIds.mockReturnValue([]);
  });
});

describe('owner actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupContextDom();
  });

  test('activating a settings option closes the Settings menu', () => {
    let metaCb;
    groupNav.subscribeGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    const details = document.getElementById('group-context-actions');
    details.open = true;
    require('../js/promptModal.js').showTextPrompt.mockResolvedValue(null);
    document.getElementById('group-action-rename').click();
    expect(details.open).toBe(false); // closeSettingsMenu runs synchronously, before the awaited prompt
  });

  test('tapping outside the Settings menu closes it', () => {
    let metaCb;
    groupNav.subscribeGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    const details = document.getElementById('group-context-actions');
    details.open = true;
    document.getElementById('group-roster').click();
    expect(details.open).toBe(false);
  });

  test('tapping inside the Settings menu does not close it', () => {
    let metaCb;
    groupNav.subscribeGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    const details = document.getElementById('group-context-actions');
    details.open = true;
    // Click on the .group-actions-menu container itself (not an action button)
    document.querySelector('#group-context-actions .group-actions-menu').click();
    expect(details.open).toBe(true);
  });

  test('Rename group prompts (prefilled) and calls renameGroup with the returned value', async () => {
    const { showTextPrompt } = require('../js/promptModal.js');
    let metaCb;
    groupNav.subscribeGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    showTextPrompt.mockResolvedValue('Familia'); // promptModal trims/validates; returns the clean value
    document.getElementById('group-action-rename').click();
    expect(showTextPrompt).toHaveBeenCalledWith(expect.objectContaining({ title: 'New group name', value: 'Family' }));
    await new Promise(setImmediate);
    expect(groupsModule.renameGroup).toHaveBeenCalledWith('G1', 'me', 'Familia');
  });

  test('Rename group does nothing when the prompt is cancelled (null)', async () => {
    const { showTextPrompt } = require('../js/promptModal.js');
    let metaCb;
    groupNav.subscribeGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    showTextPrompt.mockResolvedValue(null);
    document.getElementById('group-action-rename').click();
    await new Promise(setImmediate);
    expect(groupsModule.renameGroup).not.toHaveBeenCalled();
  });

  test('Delete group confirms and calls deleteGroup', async () => {
    const { showConfirmModal } = require('../js/promptModal.js');
    let metaCb;
    groupNav.subscribeGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    showConfirmModal.mockResolvedValue(true);
    document.getElementById('group-action-delete').click();
    expect(showConfirmModal).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Delete' }));
    await new Promise(setImmediate);
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
    groupNav.subscribeGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
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
    groupNav.subscribeGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
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
    groupNav.subscribeGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
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
    groupNav.subscribeGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
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

  test('Edit my name prompts and calls editOwnDisplayName with the returned value', async () => {
    const { showTextPrompt } = require('../js/promptModal.js');
    let metaCb;
    groupNav.subscribeGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'someoneElse', createdAt: 1 });
    showTextPrompt.mockResolvedValue('M. P.');
    document.getElementById('group-action-edit-name').click();
    await new Promise(setImmediate);
    expect(groupsModule.editOwnDisplayName).toHaveBeenCalledWith('G1', 'me', 'M. P.');
  });

  test('Edit my name pre-fills the prompt with the user\'s current group displayName', () => {
    const { showTextPrompt } = require('../js/promptModal.js');
    let metaCb; let membersCb;
    groupNav.subscribeGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'someoneElse', createdAt: 1 });
    membersCb({
      me: { role: 'member', displayName: 'Alex K.', joinedAt: 1 },
      a:  { role: 'member', displayName: 'Alice',   joinedAt: 2 },
    });
    showTextPrompt.mockResolvedValue(null);
    document.getElementById('group-action-edit-name').click();
    // showTextPrompt is invoked synchronously (the await suspends after the call).
    expect(showTextPrompt).toHaveBeenCalledWith(expect.objectContaining({ title: 'Your name in this group', value: 'Alex K.' }));
  });

  test('Leave group confirms and calls leaveGroup', async () => {
    const { showConfirmModal } = require('../js/promptModal.js');
    let metaCb;
    groupNav.subscribeGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'someoneElse', createdAt: 1 });
    showConfirmModal.mockResolvedValue(true);
    document.getElementById('group-action-leave').click();
    await new Promise(setImmediate);
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
    let metaCb, primaryCb;
    groupNav.subscribeGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    ownStatus.subscribeOwnStatus.mockImplementation((cb) => { primaryCb = cb; return () => {}; });
    // Override state flows through the store now — enterGroupContext subscribes via
    // the (real) store mock, so ticks are driven through __fireOverride on whatever
    // group it subscribed to. getOverrideCb() returns a fire fn, keeping the
    // `cbs.getOverrideCb()(value)` callsites unchanged.
    return {
      getMetaCb: () => metaCb,
      getPrimaryCb: () => primaryCb,
      getOverrideCb: () => (v) => {
        const gid = statusStore.subscribeOwnOverride.mock.calls[0]?.[0] ?? 'G1';
        statusStore.__fireOverride(gid, v);
      },
    };
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
    ownStatus.subscribeOwnStatus.mockImplementation(() => ownPrimaryUnsub);
    statusStore.subscribeOwnOverride.mockImplementation(() => ownOverrideUnsub);
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

// The module wires the glyph's click + location-prefs-synced listeners ONCE
// per module lifetime (guarded by the internal _glyphWired flag — see the
// brief: "one-time listener wiring... NOT per entry"). Every other describe
// block above already calls enterGroupContext against its own fresh DOM
// (setupContextDom() replaces document.body.innerHTML per test), so by the
// time this describe runs, _glyphWired is permanently true and pointing at a
// long-discarded element. Each test here resets the module registry and
// re-requires js/groupContext.js (mid-file-require pattern, mirroring
// following.test.js's jest.resetModules()+jest.mock() sequences) to get a
// fresh module instance — and therefore a fresh _glyphWired — bound to that
// test's own DOM. jest.mock() factories declared at the top of this file are
// hoisted and stay registered across resetModules(), so no re-registration
// is needed, only re-require.
describe('group location glyph (band)', () => {
  let gc, ownStatusMod, prefsMod, locationShareMod;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    setupContextDom();
    ownStatusMod = require('../js/ownStatus.js');
    prefsMod = require('../js/prefs.js');
    locationShareMod = require('../js/locationShare.js');
    gc = require('../js/groupContext.js');
    require('../js/presenceHub.js')._resetPresenceHub();
    require('../js/statusStore.js').__reset();
    locationShareMod.capabilityState.mockImplementation(() => 'supported');
    locationShareMod.isPermissionDenied.mockImplementation(() => false);
    prefsMod.getLocationOptIn.mockImplementation(() => false);
  });

  test('hidden while the band is unavailable, shown while available, reflects the group\'s opt-in', () => {
    prefsMod.getLocationOptIn.mockImplementation((gid) => gid === 'G1');
    let primaryCb;
    ownStatusMod.subscribeOwnStatus.mockImplementation((cb) => { primaryCb = cb; return () => {}; });
    gc.enterGroupContext('G1', 'me');
    const glyph = document.getElementById('group-location-glyph');

    // Painted from the group's opt-in as soon as the own-status band
    // renders, independent of availability — mirrors Direct's #location-glyph.
    primaryCb({ status: 'unavailable', availableUntil: null });
    expect(glyph.classList.contains('on')).toBe(true);
    // display tracks the band's own availability exactly like #group-time-remaining.
    expect(glyph.style.display).toBe('none');

    primaryCb({ status: 'available', availableUntil: Date.now() + 90 * 60000 });
    expect(glyph.style.display).not.toBe('none');

    primaryCb({ status: 'unavailable', availableUntil: null });
    expect(glyph.style.display).toBe('none');
  });

  test('capabilityState unsupported paints denied on the group glyph, regardless of opt-in', () => {
    prefsMod.getLocationOptIn.mockImplementation(() => true);
    locationShareMod.capabilityState.mockImplementation(() => 'unsupported');
    let primaryCb;
    ownStatusMod.subscribeOwnStatus.mockImplementation((cb) => { primaryCb = cb; return () => {}; });
    gc.enterGroupContext('G1', 'me');
    primaryCb({ status: 'unavailable', availableUntil: null });
    const glyph = document.getElementById('group-location-glyph');
    expect(glyph.classList.contains('denied')).toBe(true);
    // Its own title — "check permissions" is wrong advice when there is no
    // geolocation permission to check.
    expect(glyph.title).toBe('Location unavailable — not supported on this device');
  });

  test('a tap resolving unsupported paints the unsupported title, not the permissions one', async () => {
    gc.enterGroupContext('G1', 'me');
    const glyph = document.getElementById('group-location-glyph');

    locationShareMod.toggleContext.mockResolvedValueOnce('unsupported');
    glyph.click();
    await Promise.resolve();

    expect(glyph.classList.contains('denied')).toBe(true);
    expect(glyph.title).toBe('Location unavailable — not supported on this device');
  });

  test('denied state is sticky: event repaints keep the denied paint while the permission stays denied', () => {
    gc.enterGroupContext('G1', 'me');
    const glyph = document.getElementById('group-location-glyph');

    // Revocation teardown: pref flipped off, denied flag set, event dispatched
    // — the repaint must not wash denied back to plain off.
    locationShareMod.isPermissionDenied.mockImplementation(() => true);
    document.dispatchEvent(new CustomEvent('location-optin-changed', { detail: { context: 'G1' } }));
    expect(glyph.classList.contains('denied')).toBe(true);
    expect(glyph.title).toBe('Location unavailable — check permissions');

    document.dispatchEvent(new CustomEvent('location-prefs-synced'));
    expect(glyph.classList.contains('denied')).toBe(true);

    // Denied lifted (e.g. a later successful glyph prove) → plain opt-in paint.
    locationShareMod.isPermissionDenied.mockImplementation(() => false);
    document.dispatchEvent(new CustomEvent('location-prefs-synced'));
    expect(glyph.classList.contains('denied')).toBe(false);
  });

  test('click calls toggleContext(currentGid) and repaints from the result', async () => {
    let primaryCb;
    ownStatusMod.subscribeOwnStatus.mockImplementation((cb) => { primaryCb = cb; return () => {}; });
    gc.enterGroupContext('G1', 'me');
    primaryCb({ status: 'unavailable', availableUntil: null });
    const glyph = document.getElementById('group-location-glyph');
    expect(glyph.classList.contains('on')).toBe(false);

    locationShareMod.toggleContext.mockResolvedValueOnce('on');
    glyph.click();
    await Promise.resolve();

    expect(locationShareMod.toggleContext).toHaveBeenCalledWith('G1');
    expect(glyph.classList.contains('on')).toBe(true);
    expect(glyph.getAttribute('aria-pressed')).toBe('true');

    locationShareMod.toggleContext.mockResolvedValueOnce('denied');
    glyph.click();
    await Promise.resolve();

    expect(glyph.classList.contains('on')).toBe(false);
    expect(glyph.classList.contains('denied')).toBe(true);
    // A denied tap also toasts — the OS-level deny otherwise reads as a no-op.
    const { showToast } = require('../js/groups.js');
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/location permission/i));
  });

  test('entering a DIFFERENT group repaints the glyph from THAT group\'s pref (no stale gid)', () => {
    prefsMod.getLocationOptIn.mockImplementation((gid) => gid === 'G2');
    let primaryCb;
    ownStatusMod.subscribeOwnStatus.mockImplementation((cb) => { primaryCb = cb; return () => {}; });

    gc.enterGroupContext('G1', 'me');
    primaryCb({ status: 'unavailable', availableUntil: null });
    let glyph = document.getElementById('group-location-glyph');
    expect(glyph.classList.contains('on')).toBe(false); // G1's opt-in is off

    gc.enterGroupContext('G2', 'me'); // same mockImplementation re-captures the new cb
    primaryCb({ status: 'unavailable', availableUntil: null });
    glyph = document.getElementById('group-location-glyph');
    expect(glyph.classList.contains('on')).toBe(true); // G2's opt-in is on
  });

  test('location-prefs-synced repaints the group glyph from the current group\'s pref (cross-device)', () => {
    prefsMod.getLocationOptIn.mockImplementation(() => false);
    gc.enterGroupContext('G1', 'me');
    const glyph = document.getElementById('group-location-glyph');
    expect(glyph.classList.contains('on')).toBe(false);

    prefsMod.getLocationOptIn.mockImplementation((gid) => gid === 'G1');
    document.dispatchEvent(new CustomEvent('location-prefs-synced'));
    expect(glyph.classList.contains('on')).toBe(true);
  });

  test('location-optin-changed (e.g. revocation teardown) repaints the group glyph from the current pref', () => {
    prefsMod.getLocationOptIn.mockImplementation(() => false);
    gc.enterGroupContext('G1', 'me');
    const glyph = document.getElementById('group-location-glyph');
    expect(glyph.classList.contains('on')).toBe(false);

    // locationShare flips prefs outside the tap path (revocation teardown)
    // and dispatches this event — the paint must ride it, mirroring the
    // location-prefs-synced listener above.
    prefsMod.getLocationOptIn.mockImplementation((gid) => gid === 'G1');
    document.dispatchEvent(new CustomEvent('location-optin-changed', { detail: { context: 'G1' } }));
    expect(glyph.classList.contains('on')).toBe(true);
  });

  test('re-entering the group context does not double-wire the glyph click listener', async () => {
    gc.enterGroupContext('G1', 'me');
    gc.enterGroupContext('G1', 'me'); // second entry — must not add a second listener
    const glyph = document.getElementById('group-location-glyph');
    locationShareMod.toggleContext.mockResolvedValueOnce('on');
    glyph.click();
    await Promise.resolve();
    expect(locationShareMod.toggleContext).toHaveBeenCalledTimes(1);
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
    db.watchPresence.mockImplementation((uid, cb) => { cbs[uid] = cb; return () => {}; });
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

// --- Coarse distance on the group roster (Task 10) ---
//
// Contract:
// 1. Own group opt-in ON + co-member cell distance known + member available →
//    status text ends with " · <1 km away" (or "~N km").
// 2. Own group opt-in OFF → no cell subscriptions, no suffix.
// 3. Member ALSO a Direct-publishing mutual with precise distance known →
//    precise text wins ("· 120 m", not "· <1 km away").
// 4. Unavailable member → status stays EMPTY (the roster's existing rule) —
//    no distance-only text appears.
//
// Reconcile regressions (mirrors Task 9's fix in js/following.ts): opening
// subs only at row-create and closing only at row-remove leaks when a row's
// eligibility changes while it stays rendered. Tests 5-9 pin the
// reconcileDistanceSubs pass — called from renderRoster on every render —
// against opt-in flips, group exit, roster removal, and mutuality loss.
describe('distance on group roster (Task 10)', () => {
  const { subscribeCellDistance, subscribeDistance } = require('../js/locationHub.js');
  const { getLocationOptIn } = require('../js/prefs.js');
  const { getCurrentMutuals } = require('../js/following.js');
  const { isContextPublished, isContextAvailable } = require('../js/locationShare.js');

  afterEach(() => {
    isContextPublished.mockImplementation(() => true);
    isContextAvailable.mockImplementation(() => true);
  });

  function captureMembers() {
    let membersCb;
    db.watchGroupMembers.mockImplementation((g, cb) => { membersCb = cb; return () => {}; });
    return () => membersCb;
  }
  function captureStatuses() {
    const cbs = {};
    db.watchPresence.mockImplementation((uid, cb) => { cbs[uid] = cb; return () => {}; });
    return cbs;
  }
  function fireAvailable(statusCbs, uid) {
    statusCbs[uid]?.({ status: 'available', availableUntil: Date.now() + 60 * 60 * 1000 });
  }

  let cellCbs, preciseCbs;

  beforeEach(() => {
    jest.clearAllMocks();
    setupContextDom();
    getLocationOptIn.mockImplementation(() => false);
    getCurrentMutuals.mockImplementation(() => []);
    cellCbs = new Map();    // peerUid -> cb
    preciseCbs = new Map(); // peerUid -> cb
    subscribeCellDistance.mockImplementation((gid, myUid, peerUid, cb) => {
      cellCbs.set(peerUid, cb);
      return jest.fn();
    });
    subscribeDistance.mockImplementation((myUid, peerUid, cb) => {
      preciseCbs.set(peerUid, cb);
      return jest.fn();
    });
  });

  test('1. own group opt-in ON + cell distance known + available → coarse suffix', () => {
    getLocationOptIn.mockImplementation((ctx) => ctx === 'G1');
    const getMembers = captureMembers();
    const statusCbs = captureStatuses();
    enterGroupContext('G1', 'me');
    getMembers()({
      me: { role: 'owner', displayName: 'Me', joinedAt: 1 },
      uidA: { role: 'member', displayName: 'A', joinedAt: 2 },
    });
    fireAvailable(statusCbs, 'uidA');
    expect(subscribeCellDistance).toHaveBeenCalledWith('G1', 'me', 'uidA', expect.any(Function));
    cellCbs.get('uidA')(500);
    const status = document.querySelector('#group-roster [data-user-id="uidA"] .person-status').textContent;
    expect(status).toMatch(/<1 km away$/);
    // Block fragment (utils.distanceFragmentHtml): own line, no separator.
    const row = document.querySelector('#group-roster [data-user-id="uidA"]');
    expect(row.querySelector('.person-status .loc-frag').textContent).toBe('<1 km away');
    expect(row.querySelector('.person-status').textContent).not.toContain('·');
  });

  test('2. own group opt-in OFF → no cell subscriptions, no suffix', () => {
    getLocationOptIn.mockImplementation(() => false);
    const getMembers = captureMembers();
    const statusCbs = captureStatuses();
    enterGroupContext('G1', 'me');
    getMembers()({
      me: { role: 'owner', displayName: 'Me', joinedAt: 1 },
      uidA: { role: 'member', displayName: 'A', joinedAt: 2 },
    });
    fireAvailable(statusCbs, 'uidA');
    expect(subscribeCellDistance).not.toHaveBeenCalled();
    const status = document.querySelector('#group-roster [data-user-id="uidA"] .person-status').textContent;
    expect(status).not.toContain('away');
  });

  test('3. member ALSO a Direct-publishing mutual with precise distance known → precise wins', () => {
    getLocationOptIn.mockImplementation((ctx) => ctx === 'G1' || ctx === 'direct');
    getCurrentMutuals.mockImplementation(() => [{ userId: 'uidA', label: 'A', code: 'X' }]);
    const getMembers = captureMembers();
    const statusCbs = captureStatuses();
    enterGroupContext('G1', 'me');
    getMembers()({
      me: { role: 'owner', displayName: 'Me', joinedAt: 1 },
      uidA: { role: 'member', displayName: 'A', joinedAt: 2 },
    });
    fireAvailable(statusCbs, 'uidA');
    expect(subscribeDistance).toHaveBeenCalledWith('me', 'uidA', expect.any(Function));
    cellCbs.get('uidA')(500);
    preciseCbs.get('uidA')(120);
    const status = document.querySelector('#group-roster [data-user-id="uidA"] .person-status').textContent;
    expect(status).toMatch(/120 meters away$/);
    expect(status).not.toContain('<1 km away');
  });

  test('mutual who never broadcasts in Direct: precise stays null → coarse cell distance keeps rendering (2026-07-20 bug)', () => {
    // The A/B device scenario: both share in the group; B has Direct OFF.
    // Viewer enables Direct → B becomes precise-ELIGIBLE (mutual +
    // primary-available), but B publishes no raw point, so the precise watch
    // emits null forever. Mere eligibility must not tear the coarse tier
    // down — only a precise value that actually RENDERS may exclude it.
    getLocationOptIn.mockImplementation((ctx) => ctx === 'G1' || ctx === 'direct');
    getCurrentMutuals.mockImplementation(() => [{ userId: 'uidA', label: 'A', code: 'X' }]);
    const getMembers = captureMembers();
    const statusCbs = captureStatuses();
    enterGroupContext('G1', 'me');
    getMembers()({
      me: { role: 'owner', displayName: 'Me', joinedAt: 1 },
      uidA: { role: 'member', displayName: 'A', joinedAt: 2 },
    });
    // Roster-load reconcile (presence unknown yet) opens the coarse sub.
    const firstCellUnsub = subscribeCellDistance.mock.results[0].value;
    cellCbs.get('uidA')(500);
    // B goes available in Direct AND the group → precise-eligible.
    fireAvailable(statusCbs, 'uidA');
    expect(subscribeDistance).toHaveBeenCalledWith('me', 'uidA', expect.any(Function));
    // Precise has DELIVERED nothing — the cell sub must stay open.
    expect(firstCellUnsub).not.toHaveBeenCalled();
    // B's locations node doesn't exist → the precise watch emits null.
    preciseCbs.get('uidA')(null);
    const status = document.querySelector('#group-roster [data-user-id="uidA"] .person-status').textContent;
    expect(status).toMatch(/<1 km away$/);
  });

  test('Task 2: mutual whose precise tier RENDERS keeps only the precise sub open; cell reopens once primary lapses', () => {
    // Precise wins at paint, so the cell sub for a precise-RENDERING mutual
    // is pure waste — every peer cell write re-delivers into a tier that
    // never paints. reconcileDistanceSubs excludes such uids from
    // cellEligible: exactly one wire listen per such mutual, not two. The
    // exclusion keys off a DELIVERED precise number, not mere eligibility —
    // an eligible mutual with no raw point emits null forever and must keep
    // the coarse tier (the 2026-07-20 bug's contract revision).
    getLocationOptIn.mockImplementation((ctx) => ctx === 'G1' || ctx === 'direct');
    getCurrentMutuals.mockImplementation(() => [{ userId: 'uidA', label: 'A', code: 'X' }]);
    const getMembers = captureMembers();
    const statusCbs = captureStatuses();
    enterGroupContext('G1', 'me');
    getMembers()({
      me: { role: 'owner', displayName: 'Me', joinedAt: 1 },
      uidA: {
        role: 'member', displayName: 'A', joinedAt: 2,
        // Override keeps the row rendering "available" in-group even once
        // primary presence lapses below, so the coarse-fallback assertion at
        // the end isn't confounded by the unrelated "unavailable → empty
        // status" rule (Test 4's contract).
        statusOverride: { enabled: true, status: 'available', availableUntil: Date.now() + 60 * 60 * 1000 },
      },
    });
    // Roster-load reconcile fires before any presence is known, so uidA is
    // (transiently) cell-only-eligible and the coarse sub opens once here.
    expect(subscribeCellDistance).toHaveBeenCalledTimes(1);
    const firstCellUnsub = subscribeCellDistance.mock.results[0].value;

    // Primary available: uidA becomes cell- AND precise-eligible. The cell
    // sub survives eligibility alone — precise hasn't delivered a number
    // yet, and tearing coarse down now would leave nothing rendering if the
    // mutual turns out not to broadcast in Direct.
    fireAvailable(statusCbs, 'uidA');
    expect(subscribeDistance).toHaveBeenCalledWith('me', 'uidA', expect.any(Function));
    expect(firstCellUnsub).not.toHaveBeenCalled();
    // Precise DELIVERS → it renders from here on; the now-redundant cell sub
    // closes (transition re-runs the reconcile) and must not reopen while
    // precise stays live.
    preciseCbs.get('uidA')(120);
    expect(firstCellUnsub).toHaveBeenCalled();
    expect(subscribeCellDistance).toHaveBeenCalledTimes(1); // still just the one, now-closed, call
    expect(document.querySelector('#group-roster [data-user-id="uidA"] .person-status').textContent).toMatch(/120 meters away$/);

    // Primary lapses → precise eligibility drops → the cell sub reopens
    // (reopen is cancel-free: the peer's cell node persists and
    // isContextPublished is already part of cellEligible's guard).
    const preciseUnsub = subscribeDistance.mock.results[0].value;
    statusCbs['uidA']?.({ status: 'unavailable', availableUntil: null });
    expect(preciseUnsub).toHaveBeenCalled();
    expect(subscribeCellDistance).toHaveBeenCalledTimes(2);
    cellCbs.get('uidA')(500);
    expect(document.querySelector('#group-roster [data-user-id="uidA"] .person-status').textContent).toMatch(/<1 km away$/);
  });

  test('precise cascades only while the mutual broadcasts in Direct: primary-unavailable member (override-available in group) gets coarse; primary up-flip upgrades to precise', () => {
    // The ANN/BOB device scenario: ANN is Unavailable in Direct but Available
    // in the group via her override. Her persisted locations node must NOT
    // render precise for BOB — her primary availability drives her raw-point
    // publishing (a group override never publishes), so precise is off and
    // the roster falls back to her coarse cell.
    getLocationOptIn.mockImplementation((ctx) => ctx === 'G1' || ctx === 'direct');
    getCurrentMutuals.mockImplementation(() => [{ userId: 'uidA', label: 'A', code: 'X' }]);
    const getMembers = captureMembers();
    const statusCbs = captureStatuses();
    enterGroupContext('G1', 'me');
    getMembers()({
      me: { role: 'owner', displayName: 'Me', joinedAt: 1 },
      uidA: {
        role: 'member', displayName: 'A', joinedAt: 2,
        statusOverride: { enabled: true, status: 'available', availableUntil: Date.now() + 60 * 60 * 1000 },
      },
    });
    // Primary presence: UNAVAILABLE (the row still renders available via the override).
    statusCbs['uidA']?.({ status: 'unavailable', availableUntil: null });
    expect(subscribeDistance).not.toHaveBeenCalled();
    expect(subscribeCellDistance).toHaveBeenCalledWith('G1', 'me', 'uidA', expect.any(Function));
    cellCbs.get('uidA')(500);
    const status = document.querySelector('#group-roster [data-user-id="uidA"] .person-status').textContent;
    expect(status).toMatch(/<1 km away$/);

    // ANN goes Available in Direct → she is broadcasting precise again; the
    // presence tick re-runs the reconcile and the precise sub opens.
    fireAvailable(statusCbs, 'uidA');
    expect(subscribeDistance).toHaveBeenCalledWith('me', 'uidA', expect.any(Function));
    preciseCbs.get('uidA')(120);
    expect(document.querySelector('#group-roster [data-user-id="uidA"] .person-status').textContent).toMatch(/120 meters away$/);

    // …and back to primary-unavailable: the precise sub closes and a FRESH
    // cell sub reopens (the redundant-parallel cell sub was excluded/closed
    // while precise was live, so its cached distance was dropped too — the
    // roster shows the coarse suffix again once the new cell sub delivers).
    const preciseUnsub = subscribeDistance.mock.results[0].value;
    statusCbs['uidA']?.({ status: 'unavailable', availableUntil: null });
    expect(preciseUnsub).toHaveBeenCalled();
    expect(subscribeCellDistance).toHaveBeenCalledTimes(2);
    cellCbs.get('uidA')(500);
    expect(document.querySelector('#group-roster [data-user-id="uidA"] .person-status').textContent).toMatch(/<1 km away$/);
  });

  test('4. unavailable member → status stays EMPTY, no distance-only text', () => {
    getLocationOptIn.mockImplementation((ctx) => ctx === 'G1');
    const getMembers = captureMembers();
    captureStatuses(); // never fired — member stays unavailable
    enterGroupContext('G1', 'me');
    getMembers()({
      me: { role: 'owner', displayName: 'Me', joinedAt: 1 },
      uidA: { role: 'member', displayName: 'A', joinedAt: 2 },
    });
    if (cellCbs.get('uidA')) cellCbs.get('uidA')(500);
    const statusEl = document.querySelector('#group-roster [data-user-id="uidA"] .person-status');
    expect(statusEl.textContent).toBe('');
  });

  test('5. opt-in flips ON mid-session (row already rendered) → subscription opens and a tick paints the suffix', () => {
    getLocationOptIn.mockImplementation(() => false);
    const getMembers = captureMembers();
    const statusCbs = captureStatuses();
    enterGroupContext('G1', 'me');
    getMembers()({
      me: { role: 'owner', displayName: 'Me', joinedAt: 1 },
      uidA: { role: 'member', displayName: 'A', joinedAt: 2 },
    });
    fireAvailable(statusCbs, 'uidA');
    expect(subscribeCellDistance).not.toHaveBeenCalled();

    getLocationOptIn.mockImplementation((ctx) => ctx === 'G1');
    document.dispatchEvent(new CustomEvent('location-optin-changed'));

    expect(subscribeCellDistance).toHaveBeenCalledWith('G1', 'me', 'uidA', expect.any(Function));
    cellCbs.get('uidA')(500);
    const status = document.querySelector('#group-roster [data-user-id="uidA"] .person-status').textContent;
    expect(status).toMatch(/<1 km away$/);
  });

  test('6. opt-in flips OFF mid-session (suffix shown) → subscription is unsubbed and the suffix disappears', () => {
    getLocationOptIn.mockImplementation((ctx) => ctx === 'G1');
    const getMembers = captureMembers();
    const statusCbs = captureStatuses();
    enterGroupContext('G1', 'me');
    getMembers()({
      me: { role: 'owner', displayName: 'Me', joinedAt: 1 },
      uidA: { role: 'member', displayName: 'A', joinedAt: 2 },
    });
    fireAvailable(statusCbs, 'uidA');
    cellCbs.get('uidA')(500);
    let status = document.querySelector('#group-roster [data-user-id="uidA"] .person-status').textContent;
    expect(status).toMatch(/<1 km away$/);

    const unsub = subscribeCellDistance.mock.results[0].value;
    getLocationOptIn.mockImplementation(() => false);
    document.dispatchEvent(new CustomEvent('location-optin-changed'));

    expect(unsub).toHaveBeenCalled();
    status = document.querySelector('#group-roster [data-user-id="uidA"] .person-status').textContent;
    expect(status).not.toContain('away');
  });

  test('7. group exit tears down all cell + precise subscriptions', () => {
    getLocationOptIn.mockImplementation(() => true); // 'G1' and 'direct' both on
    getCurrentMutuals.mockImplementation(() => [{ userId: 'uidA', label: 'A', code: 'X' }]);
    const getMembers = captureMembers();
    const statusCbs = captureStatuses();
    enterGroupContext('G1', 'me');
    getMembers()({
      me: { role: 'owner', displayName: 'Me', joinedAt: 1 },
      uidA: { role: 'member', displayName: 'A', joinedAt: 2 },
    });
    fireAvailable(statusCbs, 'uidA');
    const cellUnsub = subscribeCellDistance.mock.results[0].value;
    const preciseUnsub = subscribeDistance.mock.results[0].value;

    exitGroupContext();

    expect(cellUnsub).toHaveBeenCalled();
    expect(preciseUnsub).toHaveBeenCalled();
  });

  test('8. member removed from roster tears down their cell + precise subscriptions', () => {
    getLocationOptIn.mockImplementation(() => true);
    getCurrentMutuals.mockImplementation(() => [{ userId: 'uidA', label: 'A', code: 'X' }]);
    const getMembers = captureMembers();
    const statusCbs = captureStatuses();
    enterGroupContext('G1', 'me');
    getMembers()({
      me: { role: 'owner', displayName: 'Me', joinedAt: 1 },
      uidA: { role: 'member', displayName: 'A', joinedAt: 2 },
    });
    fireAvailable(statusCbs, 'uidA');
    const cellUnsub = subscribeCellDistance.mock.results[0].value;
    const preciseUnsub = subscribeDistance.mock.results[0].value;

    // uidA leaves the group — next members tick omits them.
    getMembers()({
      me: { role: 'owner', displayName: 'Me', joinedAt: 1 },
    });

    expect(cellUnsub).toHaveBeenCalled();
    expect(preciseUnsub).toHaveBeenCalled();
    expect(document.querySelector('#group-roster [data-user-id="uidA"]')).toBeNull();
  });

  test('9. mutuality lost mid-session → precise subscription closes, coarse suffix keeps showing', () => {
    getLocationOptIn.mockImplementation(() => true);
    getCurrentMutuals.mockImplementation(() => [{ userId: 'uidA', label: 'A', code: 'X' }]);
    const getMembers = captureMembers();
    const statusCbs = captureStatuses();
    enterGroupContext('G1', 'me');
    getMembers()({
      me: { role: 'owner', displayName: 'Me', joinedAt: 1 },
      uidA: { role: 'member', displayName: 'A', joinedAt: 2 },
    });
    fireAvailable(statusCbs, 'uidA');
    cellCbs.get('uidA')(500);
    preciseCbs.get('uidA')(120);
    let status = document.querySelector('#group-roster [data-user-id="uidA"] .person-status').textContent;
    expect(status).toMatch(/120 meters away$/);

    const preciseUnsub = subscribeDistance.mock.results[0].value;
    getCurrentMutuals.mockImplementation(() => []);
    document.dispatchEvent(new CustomEvent('following-synced'));

    expect(preciseUnsub).toHaveBeenCalled();
    // The redundant-parallel cell sub was closed (cache dropped) while
    // precise rendered, so a FRESH cell sub reopened here — the coarse
    // suffix returns once it delivers.
    cellCbs.get('uidA')(500);
    status = document.querySelector('#group-roster [data-user-id="uidA"] .person-status').textContent;
    expect(status).toMatch(/<1 km away$/);
  });

  test('10. own nodes deleted (unpublished) → cell + precise subs close; republish reopens FRESH subs', () => {
    getLocationOptIn.mockImplementation(() => true); // 'G1' and 'direct' both on
    getCurrentMutuals.mockImplementation(() => [{ userId: 'uidA', label: 'A', code: 'X' }]);
    const getMembers = captureMembers();
    const statusCbs = captureStatuses();
    enterGroupContext('G1', 'me');
    getMembers()({
      me: { role: 'owner', displayName: 'Me', joinedAt: 1 },
      uidA: { role: 'member', displayName: 'A', joinedAt: 2 },
    });
    fireAvailable(statusCbs, 'uidA');
    expect(subscribeCellDistance).toHaveBeenCalledTimes(1);
    expect(subscribeDistance).toHaveBeenCalledTimes(1);
    const cellUnsub = subscribeCellDistance.mock.results[0].value;
    const preciseUnsub = subscribeDistance.mock.results[0].value;

    // Own nodes deleted (opt-out on another device, permission revocation) —
    // eligibility must close both tiers' subs (the server cancelled the
    // underlying listeners when locations/cells vanished).
    isContextPublished.mockImplementation(() => false);
    document.dispatchEvent(new CustomEvent('location-publishing-changed'));
    expect(cellUnsub).toHaveBeenCalled();
    expect(preciseUnsub).toHaveBeenCalled();

    // Nodes republished: BOTH tiers reopen fresh — the fresh precise sub has
    // delivered nothing yet, so the cell exclusion (data-driven, Task 2 as
    // revised 2026-07-20) doesn't apply until precise renders again.
    isContextPublished.mockImplementation(() => true);
    document.dispatchEvent(new CustomEvent('location-publishing-changed'));
    expect(subscribeCellDistance).toHaveBeenCalledTimes(2);
    expect(subscribeDistance).toHaveBeenCalledTimes(2);
    // Precise delivers → the redundant cell sub closes again.
    const secondCellUnsub = subscribeCellDistance.mock.results[1].value;
    preciseCbs.get('uidA')(120);
    expect(secondCellUnsub).toHaveBeenCalled();
    expect(subscribeCellDistance).toHaveBeenCalledTimes(2);
  });

  test('cell tier is independent of Direct: own Direct unavailable but group-available → coarse subs open, precise stays closed', () => {
    // The viewer-side of the independence rule: being unavailable in Direct
    // (primary) must not hide the group's coarse distances when the viewer
    // is available IN THE GROUP (override). Precise stays closed — that
    // tier belongs to the Direct context.
    isContextAvailable.mockImplementation((ctx) => ctx === 'G1');
    getLocationOptIn.mockImplementation(() => true); // 'G1' and 'direct' both on
    getCurrentMutuals.mockImplementation(() => [{ userId: 'uidA', label: 'A', code: 'X' }]);
    const getMembers = captureMembers();
    const statusCbs = captureStatuses();
    enterGroupContext('G1', 'me');
    getMembers()({
      me: { role: 'owner', displayName: 'Me', joinedAt: 1 },
      uidA: { role: 'member', displayName: 'A', joinedAt: 2 },
    });
    fireAvailable(statusCbs, 'uidA');
    expect(subscribeCellDistance).toHaveBeenCalledWith('G1', 'me', 'uidA', expect.any(Function));
    expect(subscribeDistance).not.toHaveBeenCalled();
    cellCbs.get('uidA')(500);
    const status = document.querySelector('#group-roster [data-user-id="uidA"] .person-status').textContent;
    expect(status).toMatch(/<1 km away$/);
  });

  test('own availability drops → cell + precise subs close; available again reopens (viewer must be de facto sharing to see)', () => {
    getLocationOptIn.mockImplementation(() => true);
    getCurrentMutuals.mockImplementation(() => [{ userId: 'uidA', label: 'A', code: 'X' }]);
    const getMembers = captureMembers();
    const statusCbs = captureStatuses();
    enterGroupContext('G1', 'me');
    getMembers()({
      me: { role: 'owner', displayName: 'Me', joinedAt: 1 },
      uidA: { role: 'member', displayName: 'A', joinedAt: 2 },
    });
    fireAvailable(statusCbs, 'uidA');
    expect(subscribeCellDistance).toHaveBeenCalledTimes(1);
    expect(subscribeDistance).toHaveBeenCalledTimes(1);
    const cellUnsub = subscribeCellDistance.mock.results[0].value;
    const preciseUnsub = subscribeDistance.mock.results[0].value;

    isContextAvailable.mockImplementation(() => false);
    document.dispatchEvent(new CustomEvent('location-publishing-changed'));
    expect(cellUnsub).toHaveBeenCalled();
    expect(preciseUnsub).toHaveBeenCalled();

    // Available again: BOTH tiers reopen fresh — the fresh precise sub has
    // delivered nothing yet, so the cell exclusion (data-driven, Task 2 as
    // revised 2026-07-20) doesn't apply until precise renders again.
    isContextAvailable.mockImplementation(() => true);
    document.dispatchEvent(new CustomEvent('location-publishing-changed'));
    expect(subscribeCellDistance).toHaveBeenCalledTimes(2);
    expect(subscribeDistance).toHaveBeenCalledTimes(2);
  });

  test('11. entering while opted in but own nodes not yet published → no subs open', () => {
    isContextPublished.mockImplementation(() => false);
    getLocationOptIn.mockImplementation(() => true);
    getCurrentMutuals.mockImplementation(() => [{ userId: 'uidA', label: 'A', code: 'X' }]);
    const getMembers = captureMembers();
    const statusCbs = captureStatuses();
    enterGroupContext('G1', 'me');
    getMembers()({
      me: { role: 'owner', displayName: 'Me', joinedAt: 1 },
      uidA: { role: 'member', displayName: 'A', joinedAt: 2 },
    });
    fireAvailable(statusCbs, 'uidA');
    expect(subscribeCellDistance).not.toHaveBeenCalled();
    expect(subscribeDistance).not.toHaveBeenCalled();
  });
});

// --- uid -> row-element map for paintRosterRow's default arg (perf) ---
//
// paintRosterRow's default `li` argument used to be a plain
// `#group-roster [data-user-id="uid"]` querySelector scan, run on every
// distance/presence tick for every roster row. renderRoster's reconcile
// update hook now populates a module-level uid->node map so the common,
// still-connected case skips the DOM scan — but the map is only an
// optimization: rosterRow() double-checks isConnected before trusting it, so
// a missed/late removal can only cost an extra querySelector, never hand back
// a wrong or detached row. Mirrors the followeeRow map in js/following.ts.
describe('paintRosterRow uid map (perf)', () => {
  const { subscribeCellDistance, subscribeDistance } = require('../js/locationHub.js');
  const { getLocationOptIn } = require('../js/prefs.js');
  const { getCurrentMutuals } = require('../js/following.js');

  function captureMembers() {
    let membersCb;
    db.watchGroupMembers.mockImplementation((g, cb) => { membersCb = cb; return () => {}; });
    return () => membersCb;
  }
  function captureStatuses() {
    const cbs = {};
    db.watchPresence.mockImplementation((uid, cb) => { cbs[uid] = cb; return () => {}; });
    return cbs;
  }
  function fireAvailable(statusCbs, uid) {
    statusCbs[uid]?.({ status: 'available', availableUntil: Date.now() + 60 * 60 * 1000 });
  }

  let cellCbs;

  beforeEach(() => {
    jest.clearAllMocks();
    setupContextDom();
    getCurrentMutuals.mockImplementation(() => []);
    cellCbs = new Map(); // peerUid -> cb
    subscribeCellDistance.mockImplementation((gid, myUid, peerUid, cb) => {
      cellCbs.set(peerUid, cb);
      return jest.fn();
    });
    subscribeDistance.mockImplementation(() => jest.fn());
  });

  test('a mapped, connected roster row is resolved without a live document.querySelector', () => {
    getLocationOptIn.mockImplementation((ctx) => ctx === 'G1');
    const getMembers = captureMembers();
    const statusCbs = captureStatuses();
    enterGroupContext('G1', 'me');
    getMembers()({
      me: { role: 'owner', displayName: 'Me', joinedAt: 1 },
      uidA: { role: 'member', displayName: 'A', joinedAt: 2 },
    });
    fireAvailable(statusCbs, 'uidA');
    expect(subscribeCellDistance).toHaveBeenCalledWith('G1', 'me', 'uidA', expect.any(Function));

    const spy = jest.spyOn(document, 'querySelector');
    // The cell-distance tick callback calls paintRosterRow(uid) with its
    // default arg (no `node` passed) — this must resolve from the uid map
    // without falling back to a document-level scan.
    cellCbs.get('uidA')(500);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();

    const status = document.querySelector('#group-roster [data-user-id="uidA"] .person-status').textContent;
    expect(status).toMatch(/<1 km away$/);
  });

  test('removing the roster row clears its map entry — a later paint falls back to querySelector and finds nothing', () => {
    getLocationOptIn.mockImplementation((ctx) => ctx === 'G1');
    const getMembers = captureMembers();
    const statusCbs = captureStatuses();
    enterGroupContext('G1', 'me');
    getMembers()({
      me: { role: 'owner', displayName: 'Me', joinedAt: 1 },
      uidA: { role: 'member', displayName: 'A', joinedAt: 2 },
    });
    fireAvailable(statusCbs, 'uidA');
    expect(subscribeCellDistance).toHaveBeenCalledWith('G1', 'me', 'uidA', expect.any(Function));
    expect(document.querySelector('#group-roster [data-user-id="uidA"]')).not.toBeNull();

    // uidA leaves the group: the roster row is torn down (reconcile onRemove)
    // and must delete the stale map entry.
    getMembers()({ me: { role: 'owner', displayName: 'Me', joinedAt: 1 } });
    expect(document.querySelector('#group-roster [data-user-id="uidA"]')).toBeNull();

    const spy = jest.spyOn(document, 'querySelector');
    // A distance tick landing after teardown (the closure still holds the old
    // callback) must never resurrect the detached row from a stale map entry.
    expect(() => cellCbs.get('uidA')(500)).not.toThrow();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('uidA'));
    spy.mockRestore();
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
    statusStore.subscribeOwnOverride.mockImplementation((_gid, cb) => {
      cb(ownOverrideEnabled
        ? { enabled: true, status: 'available', availableUntil: Date.now() + 60000, statusColor: '#ff00aa' }
        : { enabled: false, status: null });
      return () => {};
    });
    db.watchPresence.mockImplementation((uid, cb) => {
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
    expect(statusStore.pushOptimistic).not.toHaveBeenCalled();
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
    expect(statusStore.pushOptimistic).toHaveBeenCalledWith('G1',
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
    expect(statusStore.pushOptimistic).not.toHaveBeenCalled();
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
    expect(statusStore.pushOptimistic).not.toHaveBeenCalled();
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
    statusStore.subscribeOwnOverride.mockImplementation((_gid, cb) => {
      cb({ enabled: true, status: 'available', availableUntil: Date.now() + 60000, statusColor: '#ff00aa' });
      return () => {};
    });
    db.watchGroupMembers.mockImplementation((_gid, cb) => {
      cb({ src: { displayName: 'Alice', statusOverride: { enabled: true, statusColor: '#aa00ff', paletteKey: 'volt' } } });
      return () => {};
    });
    db.watchPresence.mockImplementation((uid, cb) => {
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
    statusStore.subscribeOwnOverride.mockImplementation((_gid, cb) => {
      cb({ enabled: true, status: 'available', availableUntil: Date.now() + 60000, statusColor: '#ff00aa' });
      return () => {};
    });
    db.watchGroupMembers.mockImplementation((_gid, cb) => {
      cb({ src: { displayName: 'Alice' } });   // no override
      return () => {};
    });
    db.watchPresence.mockImplementation((uid, cb) => {
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
    statusStore.subscribeOwnOverride.mockImplementation((_gid, cb) => {
      cb({ enabled: true, status: 'available', availableUntil: Date.now() + 60000, statusColor: '#ff00aa' });
      return () => {};
    });
    db.watchGroupMembers.mockImplementation((_gid, cb) => {
      cb({ src: { displayName: 'Alice' } });
      return () => {};
    });
    db.watchPresence.mockImplementation((uid, cb) => {
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
    statusStore.subscribeOwnOverride.mockImplementation((_gid, cb) => {
      cb({ enabled: true, status: 'available', availableUntil: Date.now() + 60000, statusColor: '#ff00aa' });
      return () => {};
    });
    db.watchGroupMembers.mockImplementation((_gid, cb) => {
      cb({ src: { displayName: 'Alice' } });
      return () => {};
    });
    db.watchPresence.mockImplementation((uid, cb) => {
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
    db.watchPresence.mockImplementation((_uid, cb) => { cb({ statusColor: '#000', paletteKey: null }); return () => {}; });
    setupContextDom();
    enterGroupContext('G1', 'me');
    statusStore.__fireOverride('G1', { enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#ff00aa', paletteKey: 'forest' });

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
    statusStore.subscribeOwnOverride.mockImplementation((_gid, cb) => {
      cb({ enabled: true, status: 'available', availableUntil: Date.now() + 60000, statusColor: '#ff00aa', paletteKey: 'forest' });
      return () => {};
    });
    db.watchPresence.mockImplementation((_uid, cb) => { cb({ statusColor: '#000', paletteKey: null }); return () => {}; });
    setupContextDom();
    enterGroupContext('G1', 'me');

    const dot = document.getElementById('group-my-dot');
    dot.click();

    expect(groups.setOverrideStatusUnavailable).toHaveBeenCalled();
    expect(favorites.saveCombo).not.toHaveBeenCalled();
  });

  test('chip cycle while available does NOT push to favorites', () => {
    db.watchGroupMembers.mockImplementation((_gid, cb) => { cb({}); return () => {}; });
    statusStore.subscribeOwnOverride.mockImplementation((_gid, cb) => {
      cb({ enabled: true, status: 'available', availableUntil: Date.now() + 60000, statusColor: '#ff00aa', paletteKey: 'forest' });
      return () => {};
    });
    db.watchPresence.mockImplementation((_uid, cb) => { cb({ statusColor: '#000', paletteKey: null }); return () => {}; });
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
    db.watchGroupMembers.mockImplementation((_gid, cb) => { cb(members); return () => {}; });
    db.watchPresence.mockImplementation((uid, cb) => { cb(memberStatus[uid] ?? {}); return () => {}; });
    setupContextDom();
    enterGroupContext('G1', 'me');
    // Deliver the override through the store cache (so pushOptimistic on a dot
    // click merges into it and fans out to re-render).
    statusStore.__fireOverride('G1', ownOverride);
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

  test('roster member stamps data-hint-longpress when FTU chain complete + override ON + combo differs', () => {
    // FTU chain progressed past stripPeek, longpress NOT yet seen.
    prefs.isHintSeen.mockImplementation((name) => name !== 'longpress');
    seedRoster({
      ownOverride: { enabled: true, status: 'available', availableUntil: Date.now() + 60000, statusColor: '#22c55e', paletteKey: 'forest' },
      members: { alice: { displayName: 'Alice', statusOverride: null } },
      memberStatus: { alice: { status: 'available', availableUntil: Date.now() + 60000, statusColor: '#aaff00', paletteKey: 'volt' } },
    });
    const aliceLi = document.querySelector('#group-roster li[data-user-id="alice"]');
    expect(aliceLi).not.toBeNull();
    expect(aliceLi.dataset.hintLongpress).toBe('1');
    expect(aliceLi.dataset.hintAvail).toBe('1');
    expect(aliceLi.dataset.hintSwipe).toBe('0');
  });

  test('longpress adoption re-stamps the roster so data-hint-longpress drops to 0 synchronously', () => {
    // FTU chain complete, longpress NOT yet seen. Model the real prefs behavior:
    // markHintSeen('longpress') flips isHintSeen('longpress') to true, so the
    // synchronous re-stamp in triggerGroupAdoption sees longpress as seen and
    // drops every row's data-hint-longpress to '0' before the engine's next step
    // (rather than waiting for the async override echo to repaint).
    let longpressSeen = false;
    prefs.isHintSeen.mockImplementation((name) => {
      if (name === 'longpress') return longpressSeen;
      return true; // rest of the FTU chain already complete
    });
    prefs.markHintSeen.mockImplementation((name) => {
      if (name === 'longpress') longpressSeen = true;
    });
    seedRoster({
      ownOverride: { enabled: true, status: 'available', availableUntil: Date.now() + 60000, statusColor: '#22c55e', paletteKey: 'forest' },
      members: { alice: { displayName: 'Alice', statusOverride: null } },
      memberStatus: { alice: { status: 'available', availableUntil: Date.now() + 60000, statusColor: '#aaff00', paletteKey: 'volt' } },
    });
    const aliceLi = document.querySelector('#group-roster li[data-user-id="alice"]');
    // Precondition: while longpress is still unseen, the row is eligible and stamps '1'.
    expect(aliceLi.dataset.hintLongpress).toBe('1');

    // Drive the actual long-press adoption gesture on the member's row. The
    // 500ms press timer needs fake timers (this describe block runs on real ones).
    jest.useFakeTimers();
    try {
      aliceLi.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
      jest.advanceTimersByTime(600);
    } finally {
      jest.useRealTimers();
    }

    expect(prefs.markHintSeen).toHaveBeenCalledWith('longpress');
    // The synchronous re-stamp must have run: eligibility is now false, so '0'.
    const aliceAfter = document.querySelector('#group-roster li[data-user-id="alice"]');
    expect(aliceAfter.dataset.hintLongpress).toBe('0');
  });

  test('roster does NOT stamp data-hint-longpress when override is OFF', () => {
    prefs.isHintSeen.mockImplementation((name) => name !== 'longpress');
    seedRoster({
      ownOverride: { enabled: false, status: null, availableUntil: null },
      members: { alice: { displayName: 'Alice', statusOverride: null } },
      memberStatus: { alice: { status: 'available', availableUntil: Date.now() + 60000, statusColor: '#aaff00' } },
    });
    const aliceLi = document.querySelector('#group-roster li[data-user-id="alice"]');
    expect(aliceLi.dataset.hintLongpress).not.toBe('1');
  });

  test('roster does NOT stamp data-hint-longpress when combo matches', () => {
    prefs.isHintSeen.mockImplementation((name) => name !== 'longpress');
    seedRoster({
      ownOverride: { enabled: true, status: 'available', availableUntil: Date.now() + 60000, statusColor: '#aaff00', paletteKey: 'volt' },
      members: { alice: { displayName: 'Alice', statusOverride: null } },
      memberStatus: { alice: { status: 'available', availableUntil: Date.now() + 60000, statusColor: '#aaff00', paletteKey: 'volt' } },
    });
    const aliceLi = document.querySelector('#group-roster li[data-user-id="alice"]');
    expect(aliceLi.dataset.hintLongpress).not.toBe('1');
  });

  test('roster does NOT stamp data-hint-longpress when longpress already seen', () => {
    prefs.isHintSeen.mockImplementation(() => true); // EVERYTHING seen including longpress
    seedRoster({
      ownOverride: { enabled: true, status: 'available', availableUntil: Date.now() + 60000, statusColor: '#22c55e', paletteKey: 'forest' },
      members: { alice: { displayName: 'Alice', statusOverride: null } },
      memberStatus: { alice: { status: 'available', availableUntil: Date.now() + 60000, statusColor: '#aaff00', paletteKey: 'volt' } },
    });
    const aliceLi = document.querySelector('#group-roster li[data-user-id="alice"]');
    expect(aliceLi.dataset.hintLongpress).not.toBe('1');
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
    statusStore.subscribeOwnOverride.mockImplementation((_gid, cb) => {
      overrideCb = cb;
      cb({ enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#22c55e' });
      return () => {};
    });
    db.watchGroupMembers.mockImplementation((_gid, cb) => { cb({}); return () => {}; });
    db.watchPresence.mockImplementation((_uid, cb) => { cb({}); return () => {}; });
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

