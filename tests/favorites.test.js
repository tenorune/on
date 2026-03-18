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
      { statusColor: '#22c55e', themeBg: '#0f172a', paletteKey: null, selectedKey: 'forest', activeSet: 1 },
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

jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true }));

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
}));

jest.mock('../js/store.js', () => ({
  ...jest.requireActual('../js/store.js'),
  getPaletteState: jest.fn(),
  setPaletteState: jest.fn(),
  getFavorites: jest.fn(() => []),
  setFavorites: jest.fn(),
}));

// Default palette mock
const FOREST_PALETTE = { color: '#22c55e', theme: { bg: '#052e16' } };
const VOLT_PALETTE   = { color: '#aaff00', theme: { bg: '#1a2a00' } };
const IRIS_PALETTE   = { color: '#818cf8', theme: { bg: '#1e1b4b' } };

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
}

describe('saveFavorite', () => {
  let saveFavorite;

  beforeEach(() => {
    setupDom();
    jest.resetModules();
    // Re-apply mocks after resetModules
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true }));
    jest.mock('../js/palettes.js', () => ({
      ...jest.requireActual('../js/palettes.js'),
      switchSet: jest.fn(),
      enterPaletteMode: jest.fn(),
      exitPaletteMode: jest.fn(),
      getPaletteByKey: jest.fn((key) => {
        // Inline the palette data from defaultPaletteByKey helper
        const palettes = {
          forest: { color: '#22c55e', theme: { bg: '#052e16' } },
          volt: { color: '#aaff00', theme: { bg: '#1a2a00' } },
          iris: { color: '#818cf8', theme: { bg: '#1e1b4b' } },
        };
        return palettes[key] ?? null;
      }),
      getGlowForColor: jest.fn(() => 'rgba(34,197,94,0.4)'),
    }));
    jest.mock('../js/db.js', () => ({ setStatusColor: jest.fn().mockResolvedValue(undefined) }));
    jest.mock('../js/store.js', () => ({
      ...jest.requireActual('../js/store.js'),
      getPaletteState: jest.fn(() => {
        // Inline the palette state data from defaultPaletteState helper
        return {
          activeSet: 1,
          sets: {
            '1': { selectedKey: 'forest', activePaletteKey: null },
            '2': { selectedKey: 'volt', activePaletteKey: null },
          },
        };
      }),
      setPaletteState: jest.fn(),
      getFavorites: jest.fn(() => []),
      setFavorites: jest.fn(),
    }));
    ({ saveFavorite } = require('../js/favorites.js'));
  });

  test('does not save when combo matches slot 1 (all 4 fields match)', () => {
    // --my-status = '#22c55e' = forest color, selectedKey = 'forest', activeSet = 1
    // slot 1 statusColor = getPaletteByKey('forest').color = '#22c55e' → match
    saveFavorite();
    const { setFavorites } = require('../js/store.js');
    expect(setFavorites).not.toHaveBeenCalled();
  });

  test('does not save when combo matches slot 2', () => {
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

  test('saves when statusColor differs from both slots', () => {
    // Adopted iris color — --my-status doesn't match forest or volt
    document.documentElement.style.setProperty('--my-status', '#818cf8');
    saveFavorite();
    const { setFavorites } = require('../js/store.js');
    expect(setFavorites).toHaveBeenCalledWith([
      expect.objectContaining({
        statusColor: '#818cf8',
        selectedKey: 'forest',
        activeSet: 1,
      }),
    ]);
  });

  test('prepends to existing history', () => {
    document.documentElement.style.setProperty('--my-status', '#818cf8');
    const existing = [{ statusColor: '#3b82f6', themeBg: '#0f172a', paletteKey: null, selectedKey: 'ocean', activeSet: 1 }];
    require('../js/store.js').getFavorites.mockReturnValue(existing);
    saveFavorite();
    const { setFavorites } = require('../js/store.js');
    const saved = setFavorites.mock.calls.at(-1)[0];
    expect(saved[0].statusColor).toBe('#818cf8');
    expect(saved[1]).toEqual(existing[0]);
  });

  test('drops oldest entry when history reaches 14', () => {
    document.documentElement.style.setProperty('--my-status', '#818cf8');
    const full = Array.from({ length: 14 }, (_, i) => ({
      statusColor: `#${String(i).padStart(6, '0')}`,
      themeBg: '#0f172a', paletteKey: null, selectedKey: 'ocean', activeSet: 1,
    }));
    require('../js/store.js').getFavorites.mockReturnValue(full);
    saveFavorite();
    const { setFavorites } = require('../js/store.js');
    const saved = setFavorites.mock.calls.at(-1)[0];
    expect(saved).toHaveLength(14);
    expect(saved[0].statusColor).toBe('#818cf8');
    expect(saved[13]).toEqual(full[12]); // last old entry is full[12], full[13] dropped
  });

  test('themeBg uses palette theme.bg when paletteKey is set', () => {
    require('../js/store.js').getPaletteState.mockReturnValue({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'forest', activePaletteKey: 'iris' },
        '2': { selectedKey: 'volt', activePaletteKey: null },
      },
    });
    document.documentElement.style.setProperty('--my-status', '#818cf8');
    saveFavorite();
    const { setFavorites } = require('../js/store.js');
    const saved = setFavorites.mock.calls.at(-1)[0][0];
    expect(saved.themeBg).toBe('#1e1b4b'); // iris theme.bg
    expect(saved.paletteKey).toBe('iris');
  });

  test('themeBg is #0f172a when paletteKey is null', () => {
    document.documentElement.style.setProperty('--my-status', '#818cf8');
    saveFavorite();
    const { setFavorites } = require('../js/store.js');
    const saved = setFavorites.mock.calls.at(-1)[0][0];
    expect(saved.themeBg).toBe('#0f172a');
  });
});

describe('renderStrip / initFavoritesStrip', () => {
  let initFavoritesStrip;
  let mocks;

  beforeEach(() => {
    setupDom();
    jest.resetModules();
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true }));
    jest.mock('../js/palettes.js', () => ({
      ...jest.requireActual('../js/palettes.js'),
      switchSet: jest.fn(), enterPaletteMode: jest.fn(), exitPaletteMode: jest.fn(),
      getPaletteByKey: jest.fn(key => ({
        forest: { color: '#22c55e', theme: { bg: '#052e16' } },
        volt:   { color: '#aaff00', theme: { bg: '#1a2a00' } },
        iris:   { color: '#818cf8', theme: { bg: '#1e1b4b' } },
      })[key] ?? null),
      getGlowForColor: jest.fn(() => 'rgba(34,197,94,0.4)'),
    }));
    jest.mock('../js/db.js', () => ({ setStatusColor: jest.fn().mockResolvedValue(undefined) }));
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
    { statusColor: '#818cf8', themeBg: '#1e1b4b', paletteKey: 'iris', selectedKey: 'iris', activeSet: 1 },
  ];

  test('strip container stays hidden when favorites array is empty', () => {
    initFavoritesStrip('myUid');
    expect(document.getElementById('favorites-strip').style.display).toBe('none');
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

  test('active slot (Set 1 active) has fav-pill--active class, slot 2 has fav-pill--inactive', () => {
    mocks.getFavorites.mockReturnValue(ONE_ENTRY);
    initFavoritesStrip('myUid');
    const pills = document.querySelectorAll('.fav-pill[data-type="slot"]');
    expect(pills[0].classList.contains('fav-pill--active')).toBe(true);
    expect(pills[1].classList.contains('fav-pill--inactive')).toBe(true);
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
