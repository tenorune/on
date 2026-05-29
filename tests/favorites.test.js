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

  test('renders history pills with correct left color', () => {
    // History has 2 entries → expect exactly 2 pills (no slot pills).
    const history = [
      { statusColor: '#ff00aa', surface: '#111', surface2: '#222', paletteKey: 'forest', selectedKey: 'forest', activeSet: 1 },
      { statusColor: '#00ffaa', surface: '#111', surface2: '#222', paletteKey: 'volt',   selectedKey: 'volt',   activeSet: 2 },
    ];
    mocks.getFavorites.mockReturnValue(history);
    initFavoritesStrip('myUid');
    const pills = document.querySelectorAll('.fav-pill');
    expect(pills.length).toBe(2);
    expect(pills[0].querySelector('.fav-pill-left').style.background).toContain('rgb(255, 0, 170)');
    expect(pills[1].querySelector('.fav-pill-left').style.background).toContain('rgb(0, 255, 170)');
  });

  test('collapsed state: renders .fav-collapsed gradient line when collapsed', () => {
    localStorage.setItem('statusapp_favorites_collapsed', '1');
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
    expect(localStorage.getItem('statusapp_favorites_collapsed')).toBe('1');
    expect(document.querySelector('.fav-collapsed')).not.toBeNull();
    localStorage.removeItem('statusapp_favorites_collapsed');
  });

  test('clicking collapsed line removes collapsed state and re-renders expanded', () => {
    localStorage.setItem('statusapp_favorites_collapsed', '1');
    mocks.getFavorites.mockReturnValue(ONE_ENTRY);
    initFavoritesStrip('myUid');
    document.querySelector('.fav-collapsed').click();
    expect(localStorage.getItem('statusapp_favorites_collapsed')).toBeNull();
    expect(document.querySelector('.fav-strip')).not.toBeNull();
    localStorage.removeItem('statusapp_favorites_collapsed');
  });
});


describe('history pill tap interactions (adopt-only)', () => {
  let tapHistoryPill, localMocks;

  beforeEach(() => {
    setupDom();
    jest.resetModules();
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true }));
    jest.mock('../js/palettes.js', () => ({
      ...jest.requireActual('../js/palettes.js'),
      switchSet: jest.fn(),
      enterPaletteMode: jest.fn(),
      exitPaletteMode: jest.fn(),
      getPaletteByKey: jest.fn((key) => {
        const palettes = {
          forest: { color: '#22c55e', theme: { bg: '#071a0c', surface: '#0f2e18', surface2: '#184226' } },
          iris:   { color: '#818cf8', theme: { bg: '#0c0c1e', surface: '#141432', surface2: '#1d1d47' } },
        };
        return palettes[key] ?? null;
      }),
      getGlowForColor: jest.fn(() => 'rgba(0,0,0,0.4)'),
    }));
    jest.mock('../js/db.js', () => ({
      setStatusColor: jest.fn().mockResolvedValue(undefined),
      setUserFavorites: jest.fn().mockResolvedValue(undefined),
    }));
    jest.mock('../js/store.js', () => ({
      ...jest.requireActual('../js/store.js'),
      getPaletteState: jest.fn(() => ({
        activeSet: 1,
        sets: { '1': { selectedKey: 'forest', activePaletteKey: null, selectedColor: '#22c55e' },
                '2': { selectedKey: 'volt',   activePaletteKey: null, selectedColor: '#aaff00' } },
      })),
      setPaletteState: jest.fn(),
      getFavorites: jest.fn(() => [
        { statusColor: '#818cf8', surface: '#141432', surface2: '#1d1d47',
          paletteKey: 'iris', selectedKey: 'iris', activeSet: 1 },
      ]),
      setFavorites: jest.fn(),
    }));

    localMocks = {
      switchSet:       require('../js/palettes.js').switchSet,
      enterPaletteMode: require('../js/palettes.js').enterPaletteMode,
      exitPaletteMode:  require('../js/palettes.js').exitPaletteMode,
      getGlowForColor:  require('../js/palettes.js').getGlowForColor,
      setStatusColor:   require('../js/db.js').setStatusColor,
      getPaletteState:  require('../js/store.js').getPaletteState,
      setPaletteState:  require('../js/store.js').setPaletteState,
      getFavorites:     require('../js/store.js').getFavorites,
      setFavorites:     require('../js/store.js').setFavorites,
    };

    // Wire setPaletteState to track state so getPaletteState reflects updates.
    let trackingState = {
      activeSet: 1,
      sets: { '1': { selectedKey: 'forest', activePaletteKey: null, selectedColor: '#22c55e' },
              '2': { selectedKey: 'volt',   activePaletteKey: null, selectedColor: '#aaff00' } },
    };
    localMocks.getPaletteState.mockImplementation(() => JSON.parse(JSON.stringify(trackingState)));
    localMocks.setPaletteState.mockImplementation((s) => { trackingState = JSON.parse(JSON.stringify(s)); });

    const { initFavoritesStrip } = require('../js/favorites.js');
    initFavoritesStrip('myUid');
    tapHistoryPill = () => {
      const pill = document.querySelector('.fav-pill[data-type="history"]');
      pill.click();
    };
  });

  test('restores combo selectedKey/selectedColor into palette state', () => {
    tapHistoryPill();
    const lastSet = localMocks.setPaletteState.mock.calls.at(-1)[0];
    expect(lastSet.sets['1'].selectedKey).toBe('iris');
    expect(lastSet.sets['1'].selectedColor).toBe('#818cf8');
  });

  test('calls switchSet with the combo activeSet', () => {
    tapHistoryPill();
    expect(localMocks.switchSet).toHaveBeenCalledWith(1, 'myUid');
  });

  test('calls enterPaletteMode when combo.paletteKey is non-null', () => {
    tapHistoryPill();
    expect(localMocks.enterPaletteMode).toHaveBeenCalledWith('iris', 'myUid');
  });

  test('calls exitPaletteMode when combo.paletteKey is null', () => {
    localMocks.getFavorites.mockReturnValue([
      { statusColor: '#abc', surface: '#000', surface2: '#000',
        paletteKey: null, selectedKey: 'forest', activeSet: 1 },
    ]);
    const { initFavoritesStrip } = require('../js/favorites.js');
    initFavoritesStrip('myUid');
    tapHistoryPill();
    expect(localMocks.exitPaletteMode).toHaveBeenCalledWith('myUid');
  });

  test('calls setStatusColor with the combo statusColor', () => {
    tapHistoryPill();
    expect(localMocks.setStatusColor).toHaveBeenCalledWith('myUid', '#818cf8');
  });

  test('does NOT mutate the favorites strip (no setFavorites call)', () => {
    tapHistoryPill();
    expect(localMocks.setFavorites).not.toHaveBeenCalled();
  });
});


describe('getAllCombos', () => {
  let getAllCombos;
  beforeEach(() => {
    setupDom();
    jest.resetModules();
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true }));
    jest.mock('../js/db.js', () => ({}));
    jest.mock('../js/store.js', () => ({
      ...jest.requireActual('../js/store.js'),
      getFavorites: jest.fn(() => [
        { statusColor: '#abc', surface: '#000', surface2: '#000', paletteKey: null, selectedKey: 'forest', activeSet: 1 },
        { statusColor: '#def', surface: '#000', surface2: '#000', paletteKey: null, selectedKey: 'volt',   activeSet: 2 },
      ]),
    }));
    ({ getAllCombos } = require('../js/favorites.js'));
  });

  test('returns the favorites array directly', () => {
    const combos = getAllCombos();
    expect(combos.length).toBe(2);
    expect(combos[0].statusColor).toBe('#abc');
    expect(combos[1].statusColor).toBe('#def');
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
        { statusColor: '#22c55e', surface: '#0f2e18', surface2: '#184226', paletteKey: 'forest', selectedKey: 'forest', activeSet: 1 },
        { statusColor: '#aaff00', surface: '#192500', surface2: '#243600', paletteKey: 'volt', selectedKey: 'volt', activeSet: 2 },
      ]),
      setFavorites: jest.fn(),
    }));
    ({ getCanvasColors, initFavoritesStrip } = require('../js/favorites.js'));
  });

  test('returns deduplicated pen colors', () => {
    initFavoritesStrip('myUid');
    const { penColors } = getCanvasColors();
    expect(penColors).toContain('#818cf8');
    expect(penColors).toContain('#22c55e');
    expect(penColors).toContain('#aaff00');
    expect(penColors.length).toBe(new Set(penColors).size);
  });

  test('returns deduplicated bg colors', () => {
    initFavoritesStrip('myUid');
    const { bgColors } = getCanvasColors();
    expect(bgColors).toContain('#141432');  // iris surface
    expect(bgColors).toContain('#0f2e18');  // forest surface
    expect(bgColors.length).toBe(new Set(bgColors).size);
  });

  test('pads pen colors with defaults up to 4 when user has fewer', () => {
    // Setup: no history → 0 pen colors; defaults fill up to 4.
    require('../js/store.js').getFavorites.mockReturnValue([]);
    initFavoritesStrip('myUid');
    const { penColors } = getCanvasColors();
    expect(penColors).toHaveLength(4);
    // CANVAS_DEFAULT_KEYS = ['forest', 'iris', 'coral', 'gold'] → all four added.
    expect(penColors).toEqual(['#22c55e', '#818cf8', '#fb7185', '#facc15']);
  });

  test('does not add defaults that are already present', () => {
    // Setup: history contains coral and gold — forest and iris still added to reach 4.
    require('../js/store.js').getFavorites.mockReturnValue([
      { statusColor: '#fb7185', surface: '#2e0f1a', surface2: '#421722', paletteKey: 'coral', selectedKey: 'coral', activeSet: 1 },
      { statusColor: '#facc15', surface: '#2e2400', surface2: '#423500', paletteKey: 'gold',  selectedKey: 'gold',  activeSet: 1 },
    ]);
    initFavoritesStrip('myUid');
    const { penColors } = getCanvasColors();
    expect(penColors).toHaveLength(4);
    // History has coral + gold; padded with forest + iris up to minimum 4.
    expect(penColors).toEqual(['#fb7185', '#facc15', '#22c55e', '#818cf8']);
  });

  test('does not pad when user already has 4+ pen colors', () => {
    require('../js/store.js').getFavorites.mockReturnValue([
      { statusColor: '#3b82f6', surface: '#1e293b', surface2: '#334155', paletteKey: null, selectedKey: 'forest', activeSet: 1 },
      { statusColor: '#a855f7', surface: '#1e293b', surface2: '#334155', paletteKey: null, selectedKey: 'forest', activeSet: 1 },
      { statusColor: '#ec4899', surface: '#1e293b', surface2: '#334155', paletteKey: null, selectedKey: 'forest', activeSet: 1 },
      { statusColor: '#f97316', surface: '#1e293b', surface2: '#334155', paletteKey: null, selectedKey: 'forest', activeSet: 1 },
    ]);
    initFavoritesStrip('myUid');
    const { penColors } = getCanvasColors();
    expect(penColors).toHaveLength(4);  // exactly 4 from history, no defaults added
    // No defaults appended.
    expect(penColors).not.toContain('#22c55e');
    expect(penColors).not.toContain('#818cf8');
  });
});


describe('saveCombo', () => {
  let saveCombo;
  let store;

  beforeEach(() => {
    setupDom();
    jest.resetModules();
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true }));
    jest.mock('../js/palettes.js', () => ({
      ...jest.requireActual('../js/palettes.js'),
      switchSet: jest.fn(),
      enterPaletteMode: jest.fn(),
      exitPaletteMode: jest.fn(),
      getPaletteByKey: jest.fn(() => null),
      getGlowForColor: jest.fn(() => '#000'),
    }));
    jest.mock('../js/db.js', () => ({
      setStatusColor: jest.fn().mockResolvedValue(undefined),
      setUserFavorites: jest.fn().mockResolvedValue(undefined),
    }));
    jest.mock('../js/store.js', () => ({
      ...jest.requireActual('../js/store.js'),
      getPaletteState: jest.fn(() => ({
        activeSet: 1,
        sets: { '1': { selectedKey: 'forest', activePaletteKey: null, selectedColor: '#22c55e' },
                '2': { selectedKey: 'volt',   activePaletteKey: null, selectedColor: '#aaff00' } },
      })),
      setPaletteState: jest.fn(),
      getFavorites: jest.fn(() => []),
      setFavorites: jest.fn(),
    }));
    store = require('../js/store.js');
    ({ saveCombo } = require('../js/favorites.js'));
  });

  test('pushes combo to empty history', () => {
    const combo = { statusColor: '#ff00aa', surface: '#111', surface2: '#222',
                    paletteKey: 'forest', selectedKey: 'forest', activeSet: 1 };
    saveCombo(combo);
    expect(store.setFavorites).toHaveBeenCalledTimes(1);
    expect(store.setFavorites.mock.calls[0][0][0]).toEqual(combo);
  });

  test('prepends combo to non-empty history', () => {
    const existing = { statusColor: '#000000', surface: '#111', surface2: '#222',
                       paletteKey: null, selectedKey: 'forest', activeSet: 1 };
    const incoming = { statusColor: '#ff00aa', surface: '#111', surface2: '#222',
                       paletteKey: 'forest', selectedKey: 'forest', activeSet: 1 };
    store.getFavorites.mockReturnValueOnce([existing]);
    saveCombo(incoming);
    const written = store.setFavorites.mock.calls[0][0];
    expect(written[0]).toEqual(incoming);
    expect(written[1]).toEqual(existing);
  });

  test('head-only dedupe: suppresses push when incoming matches head', () => {
    const combo = { statusColor: '#ff00aa', surface: '#111', surface2: '#222',
                    paletteKey: 'forest', selectedKey: 'forest', activeSet: 1 };
    store.getFavorites.mockReturnValueOnce([combo]);
    saveCombo(combo);
    expect(store.setFavorites).not.toHaveBeenCalled();
  });

  test('does NOT dedupe against non-head positions (deeper duplicates allowed)', () => {
    const other = { statusColor: '#aabbcc', surface: '#000', surface2: '#000',
                    paletteKey: null, selectedKey: 'volt', activeSet: 2 };
    const combo = { statusColor: '#ff00aa', surface: '#111', surface2: '#222',
                    paletteKey: 'forest', selectedKey: 'forest', activeSet: 1 };
    // combo is at slot 2; head is `other` — dedupe should NOT fire.
    store.getFavorites.mockReturnValueOnce([other, combo]);
    saveCombo(combo);
    expect(store.setFavorites).toHaveBeenCalledTimes(1);
    const written = store.setFavorites.mock.calls[0][0];
    expect(written[0]).toEqual(combo);
    expect(written.length).toBe(3); // [combo, other, combo]
  });

  test('drops oldest when history is full (cap at 8)', () => {
    const full = Array.from({ length: 8 }, (_, i) => ({
      statusColor: `#00000${i}`, surface: '#111', surface2: '#222',
      paletteKey: null, selectedKey: 'forest', activeSet: 1,
    }));
    const incoming = { statusColor: '#ff00aa', surface: '#111', surface2: '#222',
                       paletteKey: 'forest', selectedKey: 'forest', activeSet: 1 };
    store.getFavorites.mockReturnValueOnce(full);
    saveCombo(incoming);
    const written = store.setFavorites.mock.calls[0][0];
    expect(written.length).toBe(8);
    expect(written[0]).toEqual(incoming);
    expect(written[7]).toEqual(full[6]); // full[7] (the oldest) was dropped; full[6] is the new tail
  });

  test('null combo is a no-op', () => {
    saveCombo(null);
    expect(store.setFavorites).not.toHaveBeenCalled();
  });

  test('feature flags off → no-op', () => {
    jest.resetModules();
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: false, PALETTE_INTERACTIONS_ENABLED: false }));
    jest.mock('../js/store.js', () => ({
      ...jest.requireActual('../js/store.js'),
      getFavorites: jest.fn(() => []),
      setFavorites: jest.fn(),
    }));
    const off = require('../js/store.js');
    const { saveCombo: gated } = require('../js/favorites.js');
    gated({ statusColor: '#fff', surface: '#000', surface2: '#000', paletteKey: null, selectedKey: 'forest', activeSet: 1 });
    expect(off.setFavorites).not.toHaveBeenCalled();
  });
});
