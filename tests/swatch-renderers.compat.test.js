// tests/swatch-renderers.compat.test.js
jest.mock('../js/notifyPrompt.js', () => ({ requestPermissionAndRegister: jest.fn() }));
// groupContext.js's chain reaches following.js -> firstRun.js ->
// telegram.js -> firebase/auth; mock firstRun.js so this suite (unrelated to
// first-run UI) never loads that real chain.
jest.mock('../js/firstRun.js', () => ({
  initFirstRun: jest.fn(),
  setListEmpty: jest.fn(),
  isFirstRunActive: jest.fn(() => false),
}));
// Cross-renderer compatibility test.
//
// The Direct (#swatch-row) and Group (#group-swatch-row) swatch pickers are
// two parallel implementations of the same UI. They differ in where state
// lives (Direct's paletteState vs the per-group override) and a handful of
// surface details (element tag, container ID, dataset key name) — but the
// structural shape of the rendered row must match. Drift between the two
// is exactly what produced the theme-hint and key-spin bugs. This test
// pins the shapes that should match so future drift fails noisily.
//
// Both renderers now emit <button type="button"> swatches (issue #116 — the
// last semantic divergence, resolved; tag is asserted in palettes.test.js /
// groupContext.test.js).
//
// Intentionally NOT asserted (these are the known/accepted differences):
//   - container id (#swatch-row vs #group-swatch-row)
//   - dataset attribute name (data-key vs data-palette-key)
//   - extra class (.group-swatch on group swatches)

const mockHintKeys = {
  bolt: 'statusapp_seen_bolt',
  flower: 'statusapp_seen_flower',
  theme: 'statusapp_seen_theme',
  stripPeek: 'statusapp_seen_strip_peek_done',
  longpress: 'statusapp_seen_longpress',
  swipe: 'statusapp_seen_swipe',
  customAvail: 'statusapp_went_avail_custom',
};

const mockState = { direct: null, group: {} };

jest.mock('../js/db.js', () => ({
  setStatusColor: jest.fn().mockResolvedValue(undefined),
  setPaletteKey: jest.fn().mockResolvedValue(undefined),
  setStatus: jest.fn().mockResolvedValue(undefined),
  isExpired: () => false,
  isAvailable: (s, t) => s === 'available' && !(t !== null && t !== undefined && t < Date.now()),
  watchGroupMeta: jest.fn(() => () => {}),
  watchGroupMembers: jest.fn((_gid, cb) => { cb({}); return () => {}; }),
  watchGroupInvites: jest.fn(() => () => {}),
  watchStatus: jest.fn(() => () => {}),
  watchOwnMemberOverride: jest.fn(() => () => {}),
  removeUserGroupsEntry: jest.fn().mockResolvedValue(undefined),
  setLastTimeoutMinutes: jest.fn().mockResolvedValue(undefined),
  timeRemainingMs: jest.fn((until) => Math.max(0, until - Date.now())),
  formatTimeRemaining: jest.fn(() => ''),
  formatTimeRemainingFuzzy: jest.fn(() => ''),
  watchPendingInvites: jest.fn(() => () => {}),
  writePendingInvite: jest.fn().mockResolvedValue(undefined),
  deletePendingInvite: jest.fn().mockResolvedValue(undefined),
  readPendingInviteesForGroup: jest.fn().mockResolvedValue([]),
}));

jest.mock('../js/store.js', () => ({
  getFavorites: jest.fn(() => []),
  getPalette: jest.fn(),
  setPalette: jest.fn(),
}));

jest.mock('../js/prefs.js', () => ({
  isHintSeen: (name) => globalThis.localStorage.getItem(mockHintKeys[name]) === '1',
  markHintSeen: (name) => globalThis.localStorage.setItem(mockHintKeys[name], '1'),
  getPaletteState: () => JSON.parse(JSON.stringify(mockState.direct)),
  setPaletteState: (s) => { mockState.direct = JSON.parse(JSON.stringify(s)); },
  getGroupPaletteState: (gid) => JSON.parse(JSON.stringify(
    mockState.group[gid] || { activeSet: 1, sets: { '1': { selectedKey: 'forest', selectedColor: '#22c55e', activePaletteKey: null }, '2': { selectedKey: 'volt', selectedColor: '#aaff00', activePaletteKey: null } } }
  )),
  setGroupPaletteState: (gid, s) => { mockState.group[gid] = JSON.parse(JSON.stringify(s)); },
  getLastTimeout: jest.fn(() => 120),
  setLastTimeout: jest.fn(),
  getGroupChipMinutes: jest.fn(() => null),
  setGroupChipMinutes: jest.fn(),
  getFavorites: jest.fn(() => []),
  setFavorites: jest.fn(),
  initPrefs: jest.fn(),
  setCurrentContext: jest.fn(),
  syncFromServer: jest.fn(),
  isFavoritesCollapsed: jest.fn(() => false),
  setFavoritesCollapsed: jest.fn(),
  getMadeCallCount: jest.fn(() => 0),
  incrementMadeCallCount: jest.fn(),
  getAnsweredCallCount: jest.fn(() => 0),
  incrementAnsweredCallCount: jest.fn(),
}));

jest.mock('../js/groupNav.js', () => ({
  navigateToDirect: jest.fn().mockResolvedValue(undefined),
  getCurrentContext: jest.fn(() => ({ context: 'group', groupId: 'G1' })),
  applyOptimisticAppearance: jest.fn(),
  onContextChange: jest.fn(),
  subscribeGroupMeta: jest.fn(() => () => {}),
  subscribeOwnOverride: jest.fn(() => () => {}),
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
  buildAdoptedCombo: jest.fn(() => ({})),
  buildDirectCombo: jest.fn(() => ({})),
  initFavoritesStrip: jest.fn(),
}));

jest.mock('../js/inviteModal.js', () => ({ openInviteModal: jest.fn() }));
jest.mock('../js/invites.js', () => ({ buildInviteUrl: jest.fn() }));
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
  CALL_ENABLED: true,
}));
jest.mock('../js/me.js', () => ({ clearFirstUsePulse: jest.fn() }));

if (typeof PointerEvent === 'undefined') {
  global.PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type, params = {}) { super(type, params); this.pointerId = params.pointerId ?? 0; }
  };
}

const db = require('../js/db.js');
const groupNav = require('../js/groupNav.js');
const { initSwatches, enterPaletteMode } = require('../js/palettes.js');
const { enterGroupContext, exitGroupContext } = require('../js/groupContext.js');

function defaultPaletteState() {
  return {
    activeSet: 1,
    sets: {
      '1': { selectedKey: 'forest', selectedColor: '#22c55e', activePaletteKey: null },
      '2': { selectedKey: 'volt',   selectedColor: '#aaff00', activePaletteKey: null },
    },
  };
}

function directDom() {
  document.body.innerHTML = `
    <div id="swatch-row" class="visible"></div>
    <div id="my-dot" class="dot"></div>
  `;
}

function groupDom() {
  document.body.innerHTML = `
    <div id="nav-row"></div>
    <div id="main-ui-direct"></div>
    <div id="group-context-root" class="hidden">
      <header>
        <div id="group-header-row">
          <div id="group-my-dot" class="dot"></div>
          <span id="group-my-status-label"></span>
          <span id="group-time-remaining"></span>
          <button id="group-time-chip"></button>
          <details id="group-context-actions">
            <summary></summary>
            <div class="group-actions-menu">
              <button id="group-action-rename" class="hidden"></button>
              <button id="group-action-delete" class="hidden"></button>
              <button id="group-action-edit-name" class="hidden"></button>
              <button id="group-action-leave" class="hidden"></button>
            </div>
          </details>
          <div id="group-swatch-row" class="group-swatch-row"></div>
        </div>
      </header>
      <ul id="group-roster"></ul>
    </div>
  `;
}

function renderDirect(paletteState) {
  mockState.direct = paletteState;
  directDom();
  initSwatches('uid1');
  return document.getElementById('swatch-row');
}

function renderGroup(paletteState, override) {
  mockState.group = { G1: paletteState };
  groupDom();
  groupNav.subscribeGroupMeta.mockImplementation((_gid, cb) => { cb({ name: 'Family', ownerId: 'uid1', createdAt: 1 }); return () => {}; });
  db.watchStatus.mockImplementation((_uid, cb) => { cb({}); return () => {}; });
  db.watchGroupMembers.mockImplementation((_gid, cb) => { cb({}); return () => {}; });
  groupNav.subscribeOwnOverride.mockImplementation((_gid, cb) => { cb(override); return () => {}; });
  enterGroupContext('G1', 'uid1');
  return document.getElementById('group-swatch-row');
}

// Returns the structural properties that should match across both renderers.
// Deliberately ignores tag name, dataset attribute name, and extra classes —
// those are the known accepted differences.
function shape(row) {
  const swatches = Array.from(row.querySelectorAll('.swatch'));
  const setToggle = row.querySelector('.set-toggle-btn');
  const paletteKeyOf = (s) => s.dataset.paletteKey || s.dataset.key || null;
  return {
    swatchCount: swatches.length,
    setToggleIsFirstChild: row.firstElementChild === setToggle,
    setTogglePulse: setToggle ? setToggle.classList.contains('first-use-pulse') : false,
    selectedIndex: swatches.findIndex((s) => s.classList.contains('selected')),
    selectedPaletteKey: paletteKeyOf(swatches.find((s) => s.classList.contains('selected')) || {}),
    keySwatchIndex: swatches.findIndex((s) => s.classList.contains('key-swatch')),
    themeHintIndex: swatches.findIndex((s) => s.classList.contains('theme-hint')),
    hintWaveCount: swatches.filter((s) => s.classList.contains('hint-wave')).length,
  };
}

beforeEach(() => {
  localStorage.clear();
  mockState.direct = null;
  mockState.group = {};
  jest.clearAllMocks();
});

afterEach(() => {
  try { exitGroupContext(); } catch {}
});

describe('swatch renderers — structural compat', () => {
  test('base mode, default selectedKey: same swatch count, same selected index', () => {
    const state = defaultPaletteState();
    const directRow = renderDirect(state);
    const groupRow = renderGroup(state, { enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#22c55e' });
    const d = shape(directRow);
    const g = shape(groupRow);
    expect(d.swatchCount).toBe(8);
    expect(g.swatchCount).toBe(8);
    expect(d.selectedIndex).toBe(g.selectedIndex);
    expect(d.selectedPaletteKey).toBe(g.selectedPaletteKey);
    expect(d.setToggleIsFirstChild).toBe(true);
    expect(g.setToggleIsFirstChild).toBe(true);
  });

  test('base mode, non-default selectedKey: same selected index across renderers', () => {
    const state = defaultPaletteState();
    state.sets['1'].selectedKey = 'iris';
    state.sets['1'].selectedColor = '#818cf8';
    const directRow = renderDirect(state);
    const groupRow = renderGroup(state, { enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#818cf8' });
    const d = shape(directRow);
    const g = shape(groupRow);
    expect(d.selectedPaletteKey).toBe('iris');
    expect(g.selectedPaletteKey).toBe('iris');
    expect(d.selectedIndex).toBe(g.selectedIndex);
  });

  test('set-toggle pulse: same presence in both rows when bolt unseen', () => {
    const state = defaultPaletteState();
    const directRow = renderDirect(state);
    const groupRow = renderGroup(state, { enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#22c55e' });
    expect(shape(directRow).setTogglePulse).toBe(true);
    expect(shape(groupRow).setTogglePulse).toBe(true);
  });

  test('set-toggle pulse: same absence in both rows once bolt seen', () => {
    localStorage.setItem(mockHintKeys.bolt, '1');
    const state = defaultPaletteState();
    const directRow = renderDirect(state);
    const groupRow = renderGroup(state, { enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#22c55e' });
    expect(shape(directRow).setTogglePulse).toBe(false);
    expect(shape(groupRow).setTogglePulse).toBe(false);
  });

  test('hint-wave: same count on unselected swatches when wave gate is open', () => {
    const state = defaultPaletteState();
    const directRow = renderDirect(state);
    const groupRow = renderGroup(state, { enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#22c55e' });
    const d = shape(directRow);
    const g = shape(groupRow);
    expect(d.hintWaveCount).toBeGreaterThan(0);
    expect(d.hintWaveCount).toBe(g.hintWaveCount);
  });

  test('hint-wave: same absence in both rows when customAvail seen', () => {
    localStorage.setItem(mockHintKeys.customAvail, '1');
    const state = defaultPaletteState();
    const directRow = renderDirect(state);
    const groupRow = renderGroup(state, { enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#22c55e' });
    expect(shape(directRow).hintWaveCount).toBe(0);
    expect(shape(groupRow).hintWaveCount).toBe(0);
  });

  test('theme-hint: appears on selected swatch in both rows when customAvail seen and theme unseen', () => {
    localStorage.setItem(mockHintKeys.customAvail, '1');
    const state = defaultPaletteState();
    const directRow = renderDirect(state);
    const groupRow = renderGroup(state, { enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#22c55e' });
    const d = shape(directRow);
    const g = shape(groupRow);
    expect(d.themeHintIndex).toBeGreaterThanOrEqual(0);
    expect(d.themeHintIndex).toBe(d.selectedIndex);
    expect(g.themeHintIndex).toBe(g.selectedIndex);
  });

  test('theme-hint: hidden in both rows when theme already seen', () => {
    localStorage.setItem(mockHintKeys.customAvail, '1');
    localStorage.setItem(mockHintKeys.theme, '1');
    const state = defaultPaletteState();
    const directRow = renderDirect(state);
    const groupRow = renderGroup(state, { enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#22c55e' });
    expect(shape(directRow).themeHintIndex).toBe(-1);
    expect(shape(groupRow).themeHintIndex).toBe(-1);
  });

  test('palette mode: 8 swatches and key-swatch at the same index in both rows', () => {
    const state = defaultPaletteState();
    state.sets['1'].selectedKey = 'iris';
    state.sets['1'].selectedColor = '#818cf8';
    state.sets['1'].activePaletteKey = 'iris';
    const directRow = renderDirect(state);
    const groupRow = renderGroup(state, { enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#818cf8', paletteKey: 'iris' });
    const d = shape(directRow);
    const g = shape(groupRow);
    expect(d.swatchCount).toBe(8);
    expect(g.swatchCount).toBe(8);
    expect(d.keySwatchIndex).toBeGreaterThanOrEqual(0);
    expect(d.keySwatchIndex).toBe(g.keySwatchIndex);
  });
});
