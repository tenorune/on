// tests/favorites.test.js

// ─── Store helpers ──────────────────────────────────────────────────────────
// These tests use the REAL store implementation with jsdom localStorage.
// They must be in a describe block that requires the module fresh each time.

describe('getFavorites / setFavorites', () => {
  let getFavorites, setFavorites;

  beforeEach(() => {
    localStorage.clear();
    jest.resetModules();
    jest.unmock('../js/store.js');
    ({ getFavorites, setFavorites } = require('../js/store.js'));
  });

  test('returns empty array when nothing stored', () => {
    expect(getFavorites()).toEqual([]);
  });

  test('round-trips an array of combo objects', () => {
    const data = [
      { statusColor: '#22c55e', surface2: '#334155', paletteKey: null, selectedKey: 'forest', activeSet: 1 },
    ];
    setFavorites(data);
    expect(getFavorites()).toEqual(data);
  });

  test('returns empty array when stored value is corrupt JSON', () => {
    localStorage.setItem('statusapp_favorites', '{bad json');
    expect(getFavorites()).toEqual([]);
  });
});

// ─── favorites.js tests ─────────────────────────────────────────────────────

jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true }));

jest.mock('../js/palettes.js', () => ({
  ...jest.requireActual('../js/palettes.js'),
  switchSet: jest.fn(),
  enterPaletteMode: jest.fn(),
  exitPaletteMode: jest.fn(),
  getPaletteByKey: jest.fn(),
  getGlowForColor: jest.fn(() => 'rgba(34,197,94,0.4)'),
}));

jest.mock('../js/db.js', () => ({
  setStatusColor: jest.fn().mockResolvedValue(undefined),
  setUserFavorites: jest.fn().mockResolvedValue(undefined),
  claimInviteToken: jest.fn(),
  releaseInviteToken: jest.fn(),
  readInviteIndex: jest.fn(),
  readUserInvite: jest.fn(),
  readUserInvites: jest.fn().mockResolvedValue({}),
  writeUserInvite: jest.fn(),
  deleteUserInvite: jest.fn(),
  setInviteRevoked: jest.fn(),
  incrementInviteRedemptions: jest.fn(),
  getCreatorCode: jest.fn(),
  watchUserInvites: jest.fn(() => () => {}),
  claimGroupId: jest.fn(),
  writeUserGroupsEntry: jest.fn(),
  removeUserGroupsEntry: jest.fn(),
  readUserGroups: jest.fn().mockResolvedValue({}),
  watchUserGroups: jest.fn(() => () => {}),
  setLastVisited: jest.fn(),
  setCurrentContext: jest.fn(),
  writeGroup: jest.fn(),
  readGroup: jest.fn().mockResolvedValue(null),
  renameGroup: jest.fn(),
  deleteGroup: jest.fn(),
  watchGroupMeta: jest.fn(() => () => {}),
  writeMember: jest.fn(),
  readMember: jest.fn().mockResolvedValue(null),
  readMembers: jest.fn().mockResolvedValue({}),
  removeMember: jest.fn(),
  setMemberDisplayName: jest.fn(),
  watchGroupMembers: jest.fn(() => () => {}),
  writeGroupInvite: jest.fn(),
  readGroupInvites: jest.fn().mockResolvedValue({}),
  setGroupInviteRevoked: jest.fn(),
  incrementGroupInviteRedemptions: jest.fn(),
  watchGroupInvites: jest.fn(() => () => {}),
  setStatusOverride: jest.fn().mockResolvedValue(undefined),
  clearStatusOverride: jest.fn().mockResolvedValue(undefined),
  mergeStatusOverride: jest.fn().mockResolvedValue(undefined),
  mergeUserPrefs: jest.fn().mockResolvedValue(undefined),
  watchUserPrefs: jest.fn(() => () => {}),
  watchOwnMemberOverride: jest.fn(() => () => {}),
}));

jest.mock('../js/store.js', () => ({
  ...jest.requireActual('../js/store.js'),
  getPaletteState: jest.fn(),
  setPaletteState: jest.fn(),
  getFavorites: jest.fn(() => []),
  setFavorites: jest.fn(),
}));

// Default palette mock
const FOREST_PALETTE = { color: '#22c55e', theme: { bg: '#071a0c', surface: '#0f2e18', surface2: '#184226' } };
const VOLT_PALETTE   = { color: '#aaff00', theme: { bg: '#0e1700', surface: '#192500', surface2: '#243600' } };
const IRIS_PALETTE   = { color: '#818cf8', theme: { bg: '#0c0c1e', surface: '#141432', surface2: '#1d1d47' } };

function defaultPaletteByKey(key) {
  return { forest: FOREST_PALETTE, volt: VOLT_PALETTE, iris: IRIS_PALETTE }[key] ?? null;
}

function defaultPaletteState() {
  return {
    activeSet: 1,
    sets: {
      '1': { selectedKey: 'forest', activePaletteKey: null },
      '2': { selectedKey: 'volt',   activePaletteKey: null },
    },
  };
}

function setupDom() {
  document.body.innerHTML = '<div id="favorites-strip"></div>';
  document.documentElement.style.setProperty('--my-status', '#22c55e');
  document.documentElement.style.setProperty('--my-glow', 'rgba(34,197,94,0.4)');
  localStorage.setItem('statusapp_seen_theme', '1');
  localStorage.setItem('statusapp_seen_strip_peek_done', '1');
}

describe('saveFavorite', () => {
  let saveFavorite;

  beforeEach(() => {
    setupDom();
    jest.resetModules();
    // Re-apply mocks after resetModules
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true }));
    jest.mock('../js/palettes.js', () => ({
      ...jest.requireActual('../js/palettes.js'),
      switchSet: jest.fn(),
      enterPaletteMode: jest.fn(),
      exitPaletteMode: jest.fn(),
      getPaletteByKey: jest.fn((key) => {
        const palettes = {
          forest: { color: '#22c55e', theme: { bg: '#071a0c', surface: '#0f2e18', surface2: '#184226' } },
          volt: { color: '#aaff00', theme: { bg: '#0e1700', surface: '#192500', surface2: '#243600' } },
          iris: { color: '#818cf8', theme: { bg: '#0c0c1e', surface: '#141432', surface2: '#1d1d47' } },
        };
        return palettes[key] ?? null;
      }),
      getGlowForColor: jest.fn(() => 'rgba(34,197,94,0.4)'),
    }));
    jest.mock('../js/db.js', () => ({ setStatusColor: jest.fn().mockResolvedValue(undefined), setUserFavorites: jest.fn().mockResolvedValue(undefined) }));
    jest.mock('../js/store.js', () => ({
      ...jest.requireActual('../js/store.js'),
      getPaletteState: jest.fn(() => {
        return {
          activeSet: 1,
          sets: {
            '1': { selectedKey: 'forest', activePaletteKey: null, selectedColor: '#818cf8' },
            '2': { selectedKey: 'volt',   activePaletteKey: null, selectedColor: '#aaff00' },
          },
        };
      }),
      setPaletteState: jest.fn(),
      getFavorites: jest.fn(() => []),
      setFavorites: jest.fn(),
    }));
    ({ saveFavorite } = require('../js/favorites.js'));
  });

  test('does NOT save when selectedColor is absent (user made no explicit color choice)', () => {
    require('../js/store.js').getPaletteState.mockReturnValue({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'forest', activePaletteKey: null },
        '2': { selectedKey: 'volt',   activePaletteKey: null },
      },
    });
    saveFavorite();
    const { setFavorites } = require('../js/store.js');
    expect(setFavorites).not.toHaveBeenCalled();
  });

  test('does NOT save on Set 2 when selectedColor is absent', () => {
    require('../js/store.js').getPaletteState.mockReturnValue({
      activeSet: 2,
      sets: {
        '1': { selectedKey: 'forest', activePaletteKey: null },
        '2': { selectedKey: 'volt',   activePaletteKey: null },
      },
    });
    document.documentElement.style.setProperty('--my-status', '#aaff00');
    saveFavorite();
    expect(require('../js/store.js').setFavorites).not.toHaveBeenCalled();
  });

  test('force=true saves even when active slot matches (adoption path)', () => {
    // Active slot always mirrors buildCombo, so non-forced saves are always blocked by slot dedup.
    // force=true (used by adoption) bypasses all dedup checks.
    document.documentElement.style.setProperty('--my-status', '#818cf8');
    saveFavorite(true);
    const { setFavorites } = require('../js/store.js');
    expect(setFavorites).toHaveBeenCalledWith([
      expect.objectContaining({
        statusColor: '#818cf8',
        selectedKey: 'forest',
        activeSet: 1,
      }),
    ]);
  });

  test('prepends to existing history (force=true)', () => {
    document.documentElement.style.setProperty('--my-status', '#818cf8');
    const existing = [{ statusColor: '#3b82f6', surface2: '#334155', paletteKey: null, selectedKey: 'ocean', activeSet: 1 }];
    require('../js/store.js').getFavorites.mockReturnValue(existing);
    saveFavorite(true);
    const { setFavorites } = require('../js/store.js');
    const saved = setFavorites.mock.calls.at(-1)[0];
    expect(saved[0].statusColor).toBe('#818cf8');
    expect(saved[1]).toEqual(existing[0]);
  });

  test('drops oldest entry when history reaches 6 (force=true)', () => {
    document.documentElement.style.setProperty('--my-status', '#818cf8');
    const full = Array.from({ length: 6 }, (_, i) => ({
      statusColor: `#${String(i).padStart(6, '0')}`,
      surface2: '#334155', paletteKey: null, selectedKey: 'ocean', activeSet: 1,
    }));
    require('../js/store.js').getFavorites.mockReturnValue(full);
    saveFavorite(true);
    const { setFavorites } = require('../js/store.js');
    const saved = setFavorites.mock.calls.at(-1)[0];
    expect(saved).toHaveLength(6);
    expect(saved[0].statusColor).toBe('#818cf8');
    expect(saved[5]).toEqual(full[4]); // last old entry is full[4], full[5] dropped
  });

  test('combo surface2 uses palette theme.surface2 when paletteKey is set (force=true)', () => {
    require('../js/store.js').getPaletteState.mockReturnValue({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'forest', activePaletteKey: 'iris', selectedColor: '#818cf8' },
        '2': { selectedKey: 'volt',   activePaletteKey: null,   selectedColor: '#aaff00' },
      },
    });
    document.documentElement.style.setProperty('--my-status', '#818cf8');
    saveFavorite(true);
    const { setFavorites } = require('../js/store.js');
    const saved = setFavorites.mock.calls.at(-1)[0][0];
    expect(saved.surface2).toBe('#1d1d47'); // iris theme.surface2
    expect(saved.paletteKey).toBe('iris');
  });

  test('combo surface2 defaults to #334155 when paletteKey is null (force=true)', () => {
    document.documentElement.style.setProperty('--my-status', '#818cf8');
    saveFavorite(true);
    const { setFavorites } = require('../js/store.js');
    const saved = setFavorites.mock.calls.at(-1)[0][0];
    expect(saved.surface2).toBe('#334155');
  });

  test('combo includes surface from palette theme when paletteKey is set (force=true)', () => {
    require('../js/store.js').getPaletteState.mockReturnValue({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'forest', activePaletteKey: 'iris', selectedColor: '#818cf8' },
        '2': { selectedKey: 'volt', activePaletteKey: null, selectedColor: '#aaff00' },
      },
    });
    document.documentElement.style.setProperty('--my-status', '#818cf8');
    saveFavorite(true);
    const { setFavorites } = require('../js/store.js');
    const saved = setFavorites.mock.calls.at(-1)[0][0];
    expect(saved.surface).toBe('#141432');   // iris theme.surface
    expect(saved.surface2).toBe('#1d1d47');  // iris theme.surface2
  });

  test('combo includes default surface when paletteKey is null (force=true)', () => {
    document.documentElement.style.setProperty('--my-status', '#818cf8');
    saveFavorite(true);
    const { setFavorites } = require('../js/store.js');
    const saved = setFavorites.mock.calls.at(-1)[0][0];
    expect(saved.surface).toBe('#1e293b');   // DEFAULT_SURFACE
    expect(saved.surface2).toBe('#334155');  // DEFAULT_SURFACE2
  });

  test('force=true skips save when combo already exists in history (dedup)', () => {
    document.documentElement.style.setProperty('--my-status', '#818cf8');
    const existing = [{ statusColor: '#818cf8', surface2: '#334155', paletteKey: null, selectedKey: 'forest', activeSet: 1 }];
    require('../js/store.js').getFavorites.mockReturnValue(existing);
    saveFavorite(true);
    const { setFavorites } = require('../js/store.js');
    expect(setFavorites).not.toHaveBeenCalled();
  });

  test('force=true saves even when combo matches active slot (adoption path)', () => {
    // Default state: --my-status = '#22c55e' = forest = slot 1 — force bypasses slot dedup
    saveFavorite(true);
    const { setFavorites } = require('../js/store.js');
    expect(setFavorites).toHaveBeenCalledWith([
      expect.objectContaining({ statusColor: '#22c55e', selectedKey: 'forest', activeSet: 1 }),
    ]);
  });

  test('non-forced: saves PREVIOUS combo (Apple) when user commits new combo (Banana)', () => {
    // Commit Apple as the last known state via force=true (simulates prior "go available")
    document.documentElement.style.setProperty('--my-status', '#22c55e');
    require('../js/store.js').getPaletteState.mockReturnValue({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'forest', activePaletteKey: null, selectedColor: '#22c55e' },
        '2': { selectedKey: 'volt',   activePaletteKey: null, selectedColor: '#aaff00' },
      },
    });
    saveFavorite(true); // sets _lastCommittedCombo = Apple; adds Apple to history
    const { setFavorites } = require('../js/store.js');
    setFavorites.mockClear();
    // Clear Apple from history so dedup doesn't block
    require('../js/store.js').getFavorites.mockReturnValue([]);

    // Now change to Banana = iris
    document.documentElement.style.setProperty('--my-status', '#818cf8');
    require('../js/store.js').getPaletteState.mockReturnValue({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'iris', activePaletteKey: null, selectedColor: '#818cf8' },
        '2': { selectedKey: 'volt', activePaletteKey: null, selectedColor: '#aaff00' },
      },
    });

    saveFavorite(); // non-forced: should save Apple (previous), not Banana (current)
    expect(setFavorites).toHaveBeenCalledTimes(1);
    expect(setFavorites).toHaveBeenCalledWith([
      expect.objectContaining({ statusColor: '#22c55e', selectedKey: 'forest', activeSet: 1 }),
    ]);
  });

  test('non-forced: no save when current combo == previous (no change)', () => {
    // Commit Apple, then call non-forced with same state → no save
    saveFavorite(true); // sets _lastCommittedCombo = current (forest, #22c55e per beforeEach)
    const { setFavorites } = require('../js/store.js');
    setFavorites.mockClear();
    saveFavorite(); // same state, no change
    expect(setFavorites).not.toHaveBeenCalled();
  });

  test('non-forced: no save when previous combo already in any history slot', () => {
    // Set _lastCommitted to Apple via force=true, keep Apple in history
    document.documentElement.style.setProperty('--my-status', '#22c55e');
    require('../js/store.js').getPaletteState.mockReturnValue({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'forest', activePaletteKey: null, selectedColor: '#22c55e' },
        '2': { selectedKey: 'volt',   activePaletteKey: null, selectedColor: '#aaff00' },
      },
    });
    saveFavorite(true); // saves Apple, _lastCommitted = Apple
    // Apple is at history[1] (not [0]) — dedup still catches it via pillsLookSame
    require('../js/store.js').getFavorites.mockReturnValue([
      { statusColor: '#3b82f6', surface2: '#334155', paletteKey: null, selectedKey: 'ocean', activeSet: 1 },
      { statusColor: '#22c55e', surface2: '#334155', paletteKey: null, selectedKey: 'forest', activeSet: 1 },
    ]);
    const { setFavorites } = require('../js/store.js');
    setFavorites.mockClear();

    // Change to Banana
    document.documentElement.style.setProperty('--my-status', '#818cf8');
    require('../js/store.js').getPaletteState.mockReturnValue({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'iris', activePaletteKey: null, selectedColor: '#818cf8' },
        '2': { selectedKey: 'volt', activePaletteKey: null, selectedColor: '#aaff00' },
      },
    });
    saveFavorite(); // Apple is in history[1] → dedup catches it, no duplicate
    expect(setFavorites).not.toHaveBeenCalled();
  });

  test('force=true skips save when pill looks the same (different selectedKey, same visual)', () => {
    document.documentElement.style.setProperty('--my-status', '#818cf8');
    // History has a combo with same statusColor and surface2 but different selectedKey
    const existing = [{ statusColor: '#818cf8', surface2: '#334155', paletteKey: null, selectedKey: 'ocean', activeSet: 2 }];
    require('../js/store.js').getFavorites.mockReturnValue(existing);
    saveFavorite(true);
    const { setFavorites } = require('../js/store.js');
    expect(setFavorites).not.toHaveBeenCalled();
  });

  test('non-forced: no save when _lastCommittedCombo not yet set (no init or prior force)', () => {
    // Fresh module, _lastCommittedCombo = null, selectedColor IS set (beforeEach default)
    // previousCombo is null → return without saving
    saveFavorite();
    const { setFavorites } = require('../js/store.js');
    expect(setFavorites).not.toHaveBeenCalled();
  });
});

describe('renderStrip / initFavoritesStrip', () => {
  let initFavoritesStrip;
  let mocks;

  beforeEach(() => {
    setupDom();
    jest.resetModules();
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true }));
    jest.mock('../js/palettes.js', () => ({
      ...jest.requireActual('../js/palettes.js'),
      switchSet: jest.fn(), enterPaletteMode: jest.fn(), exitPaletteMode: jest.fn(),
      getPaletteByKey: jest.fn(key => ({
        forest: { color: '#22c55e', theme: { bg: '#071a0c', surface: '#0f2e18', surface2: '#184226' } },
        volt:   { color: '#aaff00', theme: { bg: '#0e1700', surface: '#192500', surface2: '#243600' } },
        iris:   { color: '#818cf8', theme: { bg: '#0c0c1e', surface: '#141432', surface2: '#1d1d47' } },
      })[key] ?? null),
      getGlowForColor: jest.fn(() => 'rgba(34,197,94,0.4)'),
    }));
    jest.mock('../js/db.js', () => ({ setStatusColor: jest.fn().mockResolvedValue(undefined), setUserFavorites: jest.fn().mockResolvedValue(undefined) }));
    jest.mock('../js/store.js', () => ({
      ...jest.requireActual('../js/store.js'),
      getPaletteState: jest.fn(() => ({
        activeSet: 1,
        sets: {
          '1': { selectedKey: 'forest', activePaletteKey: null },
          '2': { selectedKey: 'volt',   activePaletteKey: null },
        },
      })),
      setPaletteState: jest.fn(),
      getFavorites: jest.fn(() => []),
      setFavorites: jest.fn(),
    }));
    mocks = {
      getPaletteState: require('../js/store.js').getPaletteState,
      getFavorites: require('../js/store.js').getFavorites,
    };
    ({ initFavoritesStrip } = require('../js/favorites.js'));
  });

  const ONE_ENTRY = [
    { statusColor: '#818cf8', surface2: '#1e1b4b', paletteKey: 'iris', selectedKey: 'iris', activeSet: 1 },
  ];

  test('strip container shows only collapsed line (no pills) when favorites array is empty', () => {
    initFavoritesStrip('myUid');
    expect(document.querySelector('.fav-collapsed')).not.toBeNull();
    expect(document.querySelectorAll('.fav-pill')).toHaveLength(0);
  });

  test('strip container is shown when favorites has at least one entry', () => {
    mocks.getFavorites.mockReturnValue(ONE_ENTRY);
    initFavoritesStrip('myUid');
    expect(document.getElementById('favorites-strip').style.display).not.toBe('none');
  });

  test('renders slot 1 pill with forest color and slot 2 pill with volt color', () => {
    mocks.getFavorites.mockReturnValue(ONE_ENTRY);
    initFavoritesStrip('myUid');
    const pills = document.querySelectorAll('.fav-pill[data-type="slot"]');
    expect(pills).toHaveLength(2);
    expect(pills[0].querySelector('.fav-pill-left').style.background).toBe('rgb(34, 197, 94)');
    expect(pills[1].querySelector('.fav-pill-left').style.background).toBe('rgb(170, 255, 0)');
  });

  test('active slot (Set 1 active) has fav-pill--inactive class, slot 2 has fav-pill--active', () => {
    mocks.getFavorites.mockReturnValue(ONE_ENTRY);
    initFavoritesStrip('myUid');
    const pills = document.querySelectorAll('.fav-pill[data-type="slot"]');
    expect(pills[0].classList.contains('fav-pill--inactive')).toBe(true);
    expect(pills[1].classList.contains('fav-pill--active')).toBe(true);
  });

  test('renders history pills with correct left color', () => {
    mocks.getFavorites.mockReturnValue(ONE_ENTRY);
    initFavoritesStrip('myUid');
    const historyPills = document.querySelectorAll('.fav-pill[data-type="history"]');
    expect(historyPills).toHaveLength(1);
    expect(historyPills[0].querySelector('.fav-pill-left').style.background).toBe('rgb(129, 140, 248)');
  });

  test('collapsed state: renders .fav-collapsed gradient line when collapsed', () => {
    localStorage.setItem('statusapp_favorites_collapsed', 'true');
    mocks.getFavorites.mockReturnValue(ONE_ENTRY);
    initFavoritesStrip('myUid');
    expect(document.querySelector('.fav-collapsed')).not.toBeNull();
    expect(document.querySelector('.fav-strip')).toBeNull();
    localStorage.removeItem('statusapp_favorites_collapsed');
  });

  test('collapse button sets collapsed state and re-renders to collapsed', () => {
    mocks.getFavorites.mockReturnValue(ONE_ENTRY);
    initFavoritesStrip('myUid');
    document.querySelector('.fav-collapse-btn').click();
    expect(localStorage.getItem('statusapp_favorites_collapsed')).toBe('true');
    expect(document.querySelector('.fav-collapsed')).not.toBeNull();
    localStorage.removeItem('statusapp_favorites_collapsed');
  });

  test('clicking collapsed line removes collapsed state and re-renders expanded', () => {
    localStorage.setItem('statusapp_favorites_collapsed', 'true');
    mocks.getFavorites.mockReturnValue(ONE_ENTRY);
    initFavoritesStrip('myUid');
    document.querySelector('.fav-collapsed').click();
    expect(localStorage.getItem('statusapp_favorites_collapsed')).toBeNull();
    expect(document.querySelector('.fav-strip')).not.toBeNull();
    localStorage.removeItem('statusapp_favorites_collapsed');
  });
});

describe('slot tap interactions', () => {
  let initFavoritesStrip, localMocks;

  beforeEach(() => {
    setupDom();
    jest.resetModules();
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true }));
    jest.mock('../js/palettes.js', () => ({
      ...jest.requireActual('../js/palettes.js'),
      switchSet: jest.fn(), enterPaletteMode: jest.fn(), exitPaletteMode: jest.fn(),
      getPaletteByKey: jest.fn(key => ({
        forest: { color: '#22c55e', theme: { bg: '#071a0c', surface: '#0f2e18', surface2: '#184226' } },
        volt:   { color: '#aaff00', theme: { bg: '#0e1700', surface: '#192500', surface2: '#243600' } },
        iris:   { color: '#818cf8', theme: { bg: '#0c0c1e', surface: '#141432', surface2: '#1d1d47' } },
      })[key] ?? null),
      getGlowForColor: jest.fn(() => 'rgba(34,197,94,0.4)'),
    }));
    jest.mock('../js/db.js', () => ({ setStatusColor: jest.fn().mockResolvedValue(undefined), setUserFavorites: jest.fn().mockResolvedValue(undefined) }));
    jest.mock('../js/store.js', () => ({
      ...jest.requireActual('../js/store.js'),
      getPaletteState: jest.fn(() => ({
        activeSet: 1,
        sets: {
          '1': { selectedKey: 'forest', activePaletteKey: null },
          '2': { selectedKey: 'volt',   activePaletteKey: null },
        },
      })),
      setPaletteState: jest.fn(),
      getFavorites: jest.fn(() => [
        { statusColor: '#818cf8', surface2: '#1e1b4b', paletteKey: 'iris', selectedKey: 'iris', activeSet: 1 },
      ]),
      setFavorites: jest.fn(),
    }));
    localMocks = {
      switchSet: require('../js/palettes.js').switchSet,
    };
    ({ initFavoritesStrip } = require('../js/favorites.js'));
  });

  test('tapping active slot (slot 1 when Set 1 is active) is a no-op', () => {
    initFavoritesStrip('myUid');
    const slot1Pill = document.querySelector('.fav-pill[data-type="slot"][data-index="1"]');
    slot1Pill.click();
    expect(localMocks.switchSet).not.toHaveBeenCalled();
  });

  test('tapping inactive slot (slot 2) calls switchSet with 2', () => {
    initFavoritesStrip('myUid');
    const slot2Pill = document.querySelector('.fav-pill[data-type="slot"][data-index="2"]');
    slot2Pill.click();
    expect(localMocks.switchSet).toHaveBeenCalledWith(2, 'myUid');
  });
});

describe('history pill tap interactions', () => {
  let initFavoritesStrip, localMocks;
  const IRIS_COMBO = {
    statusColor: '#818cf8', surface2: '#1e1b4b',
    paletteKey: 'iris', selectedKey: 'iris', activeSet: 1,
  };
  const NO_THEME_COMBO = {
    statusColor: '#3b82f6', surface2: '#334155',
    paletteKey: null, selectedKey: 'ocean', activeSet: 2,
  };

  function tapHistoryPill(idx = 0) {
    document.querySelector(`.fav-pill[data-type="history"][data-index="${idx}"]`).click();
  }

  beforeEach(() => {
    setupDom();
    jest.resetModules();
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true }));
    jest.mock('../js/palettes.js', () => ({
      ...jest.requireActual('../js/palettes.js'),
      switchSet: jest.fn(), enterPaletteMode: jest.fn(), exitPaletteMode: jest.fn(),
      getPaletteByKey: jest.fn(key => ({
        forest: { color: '#22c55e', theme: { bg: '#071a0c', surface: '#0f2e18', surface2: '#184226' } },
        volt:   { color: '#aaff00', theme: { bg: '#0e1700', surface: '#192500', surface2: '#243600' } },
        iris:   { color: '#818cf8', theme: { bg: '#0c0c1e', surface: '#141432', surface2: '#1d1d47' } },
      })[key] ?? null),
      getGlowForColor: jest.fn(() => 'rgba(34,197,94,0.4)'),
    }));
    jest.mock('../js/db.js', () => ({ setStatusColor: jest.fn().mockResolvedValue(undefined), setUserFavorites: jest.fn().mockResolvedValue(undefined) }));
    jest.mock('../js/store.js', () => ({
      ...jest.requireActual('../js/store.js'),
      getPaletteState: jest.fn(() => ({
        activeSet: 1,
        sets: {
          '1': { selectedKey: 'forest', activePaletteKey: null },
          '2': { selectedKey: 'volt',   activePaletteKey: null },
        },
      })),
      setPaletteState: jest.fn(),
      getFavorites: jest.fn(() => [{
        statusColor: '#818cf8', surface2: '#1e1b4b',
        paletteKey: 'iris', selectedKey: 'iris', activeSet: 1,
      }]),
      setFavorites: jest.fn(),
    }));
    localMocks = {
      switchSet:       require('../js/palettes.js').switchSet,
      enterPaletteMode: require('../js/palettes.js').enterPaletteMode,
      exitPaletteMode:  require('../js/palettes.js').exitPaletteMode,
      setStatusColor:   require('../js/db.js').setStatusColor,
      getPaletteState:  require('../js/store.js').getPaletteState,
      setPaletteState:  require('../js/store.js').setPaletteState,
      getFavorites:     require('../js/store.js').getFavorites,
      setFavorites:     require('../js/store.js').setFavorites,
    };
    ({ initFavoritesStrip } = require('../js/favorites.js'));
  });

  test('step 0: writes combo.selectedKey into palette state before calling switchSet', () => {
    initFavoritesStrip('myUid');
    tapHistoryPill();
    expect(localMocks.setPaletteState).toHaveBeenCalledWith(
      expect.objectContaining({
        sets: expect.objectContaining({
          '1': expect.objectContaining({ selectedKey: 'iris' }),
        }),
      })
    );
    // setPaletteState must be called before switchSet
    const setOrder = localMocks.setPaletteState.mock.invocationCallOrder[0];
    const switchOrder = localMocks.switchSet.mock.invocationCallOrder[0];
    expect(setOrder).toBeLessThan(switchOrder);
  });

  test('step 1: calls switchSet with combo.activeSet', () => {
    initFavoritesStrip('myUid');
    tapHistoryPill();
    expect(localMocks.switchSet).toHaveBeenCalledWith(1, 'myUid');
  });

  test('step 2a: calls enterPaletteMode when combo.paletteKey is non-null', () => {
    initFavoritesStrip('myUid');
    tapHistoryPill();
    expect(localMocks.enterPaletteMode).toHaveBeenCalledWith('iris', 'myUid');
    expect(localMocks.exitPaletteMode).not.toHaveBeenCalled();
  });

  test('step 2b: calls exitPaletteMode when combo.paletteKey is null', () => {
    localMocks.getFavorites.mockReturnValue([NO_THEME_COMBO]);
    localMocks.getPaletteState.mockReturnValue({
      activeSet: 2,
      sets: {
        '1': { selectedKey: 'forest', activePaletteKey: null },
        '2': { selectedKey: 'volt',   activePaletteKey: null },
      },
    });
    initFavoritesStrip('myUid');
    tapHistoryPill();
    expect(localMocks.exitPaletteMode).toHaveBeenCalledWith('myUid');
    expect(localMocks.enterPaletteMode).not.toHaveBeenCalled();
  });

  test('step 3: calls setStatusColor and sets --my-status and --my-glow CSS vars', () => {
    initFavoritesStrip('myUid');
    tapHistoryPill();
    expect(localMocks.setStatusColor).toHaveBeenCalledWith('myUid', '#818cf8');
    expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#818cf8');
    expect(document.documentElement.style.getPropertyValue('--my-glow')).toBe('rgba(34,197,94,0.4)');
  });

  test('step 3: setStatusColor is called after switchSet (overrides it)', () => {
    initFavoritesStrip('myUid');
    tapHistoryPill();
    const switchOrder    = localMocks.switchSet.mock.invocationCallOrder[0];
    const setStatusOrder = localMocks.setStatusColor.mock.invocationCallOrder[0];
    expect(switchOrder).toBeLessThan(setStatusOrder);
  });

  test('step 4: removes tapped pill from history', () => {
    initFavoritesStrip('myUid');
    tapHistoryPill();
    expect(localMocks.setFavorites).toHaveBeenCalledWith(
      expect.not.arrayContaining([IRIS_COMBO])
    );
  });

  test('step 5: prepends old active slot combo to history after tap', () => {
    // Tap IRIS_COMBO (activeSet: 1, selectedKey: 'iris'). Initial state has set1 selectedKey
    // 'forest'. Step 0 changes set1.selectedKey to 'iris' in palette state — with a state-
    // tracking mock, slotCombo(1) after the tap returns iris (differs from old forest), so
    // shouldPrepend is true and old slot 1 (forest) is prepended to history.
    let trackingState = {
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'forest', activePaletteKey: null },
        '2': { selectedKey: 'volt',   activePaletteKey: null },
      },
    };
    localMocks.getPaletteState.mockImplementation(() => JSON.parse(JSON.stringify(trackingState)));
    localMocks.setPaletteState.mockImplementation(s => { trackingState = JSON.parse(JSON.stringify(s)); });
    // IRIS_COMBO is the default getFavorites mock from beforeEach — no override needed
    initFavoritesStrip('myUid');
    tapHistoryPill();
    const saved = localMocks.setFavorites.mock.calls.at(-1)[0];
    // Old slot 1 (forest, no theme, set 1, statusColor #22c55e) should be prepended
    expect(saved[0]).toMatchObject({ selectedKey: 'forest', activeSet: 1, paletteKey: null, statusColor: '#22c55e' });
  });
});

test('saveFavorite: does not save when PALETTE_INTERACTIONS_ENABLED is false', () => {
  jest.resetModules();
  jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: false }));
  jest.mock('../js/palettes.js', () => ({
    ...jest.requireActual('../js/palettes.js'),
    getPaletteByKey: jest.fn(() => ({ color: '#22c55e', theme: { bg: '#071a0c', surface: '#0f2e18', surface2: '#184226' } })),
    getGlowForColor: jest.fn(() => 'rgba(34,197,94,0.4)'),
  }));
  jest.mock('../js/db.js', () => ({ setStatusColor: jest.fn().mockResolvedValue(undefined), setUserFavorites: jest.fn().mockResolvedValue(undefined) }));
  jest.mock('../js/store.js', () => ({
    ...jest.requireActual('../js/store.js'),
    getPaletteState: jest.fn(() => ({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'forest', activePaletteKey: null },
        '2': { selectedKey: 'volt', activePaletteKey: null },
      },
    })),
    setPaletteState: jest.fn(),
    getFavorites: jest.fn(() => []),
    setFavorites: jest.fn(),
  }));
  const { saveFavorite: sf } = require('../js/favorites.js');
  sf();
  const { setFavorites } = require('../js/store.js');
  expect(setFavorites).not.toHaveBeenCalled();
  // No restore needed.
});

describe('getAllCombos', () => {
  let getAllCombos, initFavoritesStrip;

  beforeEach(() => {
    setupDom();
    jest.resetModules();
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true }));
    jest.mock('../js/palettes.js', () => ({
      ...jest.requireActual('../js/palettes.js'),
      switchSet: jest.fn(), enterPaletteMode: jest.fn(), exitPaletteMode: jest.fn(),
      getPaletteByKey: jest.fn(key => ({
        forest: { color: '#22c55e', theme: { bg: '#071a0c', surface: '#0f2e18', surface2: '#184226' } },
        volt:   { color: '#aaff00', theme: { bg: '#0e1700', surface: '#192500', surface2: '#243600' } },
        iris:   { color: '#818cf8', theme: { bg: '#0c0c1e', surface: '#141432', surface2: '#1d1d47' } },
      })[key] ?? null),
      getGlowForColor: jest.fn(() => 'rgba(34,197,94,0.4)'),
    }));
    jest.mock('../js/db.js', () => ({ setStatusColor: jest.fn().mockResolvedValue(undefined), setUserFavorites: jest.fn().mockResolvedValue(undefined) }));
    jest.mock('../js/store.js', () => ({
      ...jest.requireActual('../js/store.js'),
      getPaletteState: jest.fn(() => ({
        activeSet: 1,
        sets: {
          '1': { selectedKey: 'forest', activePaletteKey: null },
          '2': { selectedKey: 'volt',   activePaletteKey: null },
        },
      })),
      setPaletteState: jest.fn(),
      getFavorites: jest.fn(() => [
        { statusColor: '#818cf8', surface: '#141432', surface2: '#1d1d47', paletteKey: 'iris', selectedKey: 'iris', activeSet: 1 },
      ]),
      setFavorites: jest.fn(),
    }));
    ({ getAllCombos, initFavoritesStrip } = require('../js/favorites.js'));
  });

  test('returns slot 1, slot 2, then history combos', () => {
    initFavoritesStrip('myUid');
    const combos = getAllCombos();
    expect(combos).toHaveLength(3);
    expect(combos[0].activeSet).toBe(1);
    expect(combos[1].activeSet).toBe(2);
    expect(combos[2].paletteKey).toBe('iris');
  });

  test('all combos have surface and surface2 fields', () => {
    initFavoritesStrip('myUid');
    const combos = getAllCombos();
    combos.forEach(c => {
      expect(c.surface).toBeDefined();
      expect(c.surface2).toBeDefined();
    });
  });

  test('returns only 2 combos when history is empty', () => {
    require('../js/store.js').getFavorites.mockReturnValue([]);
    initFavoritesStrip('myUid');
    expect(getAllCombos()).toHaveLength(2);
  });
});

describe('getCanvasColors', () => {
  let getCanvasColors, initFavoritesStrip;

  beforeEach(() => {
    setupDom();
    jest.resetModules();
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true }));
    jest.mock('../js/palettes.js', () => ({
      ...jest.requireActual('../js/palettes.js'),
      switchSet: jest.fn(), enterPaletteMode: jest.fn(), exitPaletteMode: jest.fn(),
      getPaletteByKey: jest.fn(key => ({
        forest: { color: '#22c55e', theme: { bg: '#071a0c', surface: '#0f2e18', surface2: '#184226' } },
        volt:   { color: '#aaff00', theme: { bg: '#0e1700', surface: '#192500', surface2: '#243600' } },
        iris:   { color: '#818cf8', theme: { bg: '#0c0c1e', surface: '#141432', surface2: '#1d1d47' } },
        coral:  { color: '#fb7185', theme: { bg: '#1a0810', surface: '#2e0f1a', surface2: '#421722' } },
        gold:   { color: '#facc15', theme: { bg: '#1a1500', surface: '#2e2400', surface2: '#423500' } },
      })[key] ?? null),
      getGlowForColor: jest.fn(() => 'rgba(34,197,94,0.4)'),
    }));
    jest.mock('../js/db.js', () => ({ setStatusColor: jest.fn().mockResolvedValue(undefined), setUserFavorites: jest.fn().mockResolvedValue(undefined) }));
    jest.mock('../js/store.js', () => ({
      ...jest.requireActual('../js/store.js'),
      getPaletteState: jest.fn(() => ({
        activeSet: 1,
        sets: {
          '1': { selectedKey: 'forest', activePaletteKey: null },
          '2': { selectedKey: 'volt',   activePaletteKey: null },
        },
      })),
      setPaletteState: jest.fn(),
      getFavorites: jest.fn(() => [
        { statusColor: '#818cf8', surface: '#141432', surface2: '#1d1d47', paletteKey: 'iris', selectedKey: 'iris', activeSet: 1 },
      ]),
      setFavorites: jest.fn(),
    }));
    ({ getCanvasColors, initFavoritesStrip } = require('../js/favorites.js'));
  });

  test('returns deduplicated pen colors', () => {
    initFavoritesStrip('myUid');
    const { penColors } = getCanvasColors();
    expect(penColors).toContain('#22c55e');
    expect(penColors).toContain('#aaff00');
    expect(penColors).toContain('#818cf8');
    expect(penColors.length).toBe(new Set(penColors).size);
  });

  test('returns deduplicated bg colors', () => {
    initFavoritesStrip('myUid');
    const { bgColors } = getCanvasColors();
    expect(bgColors).toContain('#1e293b');  // default surface (both slots)
    expect(bgColors).toContain('#141432');  // iris surface
    expect(bgColors.length).toBe(new Set(bgColors).size);
  });

  test('pads pen colors with defaults up to 4 when user has fewer', () => {
    // Setup: slot1 forest, slot2 volt, no history → 2 pen colors
    require('../js/store.js').getFavorites.mockReturnValue([]);
    initFavoritesStrip('myUid');
    const { penColors } = getCanvasColors();
    expect(penColors).toHaveLength(4);
    // forest already present (slot 1) → skipped; iris and coral added.
    expect(penColors).toEqual(['#22c55e', '#aaff00', '#818cf8', '#fb7185']);
  });

  test('does not add defaults that are already present', () => {
    // Setup: history contains coral, gold → defaults forest (skip, slot1),
    // iris (add). Stop at 4.
    require('../js/store.js').getFavorites.mockReturnValue([
      { statusColor: '#fb7185', surface: '#2e0f1a', surface2: '#421722', paletteKey: 'coral', selectedKey: 'coral', activeSet: 1 },
      { statusColor: '#facc15', surface: '#2e2400', surface2: '#423500', paletteKey: 'gold',  selectedKey: 'gold',  activeSet: 1 },
    ]);
    initFavoritesStrip('myUid');
    const { penColors } = getCanvasColors();
    expect(penColors).toHaveLength(4);
    expect(penColors).toEqual(['#22c55e', '#aaff00', '#fb7185', '#facc15']);
  });

  test('does not pad when user already has 4+ pen colors', () => {
    require('../js/store.js').getFavorites.mockReturnValue([
      { statusColor: '#3b82f6', surface: '#1e293b', surface2: '#334155', paletteKey: null, selectedKey: 'forest', activeSet: 1 },
      { statusColor: '#a855f7', surface: '#1e293b', surface2: '#334155', paletteKey: null, selectedKey: 'forest', activeSet: 1 },
      { statusColor: '#ec4899', surface: '#1e293b', surface2: '#334155', paletteKey: null, selectedKey: 'forest', activeSet: 1 },
    ]);
    initFavoritesStrip('myUid');
    const { penColors } = getCanvasColors();
    expect(penColors).toHaveLength(5);  // slot1, slot2, plus the 3 history
    // No defaults appended.
    expect(penColors).not.toContain('#818cf8');
    expect(penColors).not.toContain('#fb7185');
  });
});
