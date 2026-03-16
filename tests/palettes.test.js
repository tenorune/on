// tests/palettes.test.js
jest.mock('../js/db.js', () => ({
  setStatusColor: jest.fn().mockResolvedValue(undefined),
}));

const DEFAULT_PALETTE_STATE = {
  activeSet: 1,
  sets: {
    '1': { selectedKey: 'forest', activePaletteKey: null },
    '2': { selectedKey: 'volt',   activePaletteKey: null },
  },
};

jest.mock('../js/store.js', () => ({
  getPaletteState: jest.fn().mockImplementation(() =>
    JSON.parse(JSON.stringify(DEFAULT_PALETTE_STATE))
  ),
  setPaletteState: jest.fn(),
  getPalette: jest.fn().mockReturnValue('forest'),
  setPalette: jest.fn(),
}));

const {
  PALETTE_SETS, getPaletteByKey, getGlowForColor, applyPaletteVars,
  tapSwatch, initSwatches, switchSet,
} = require('../js/palettes.js');
const { setStatusColor } = require('../js/db.js');
const { getPaletteState, setPaletteState } = require('../js/store.js');

// --- PALETTE_SETS structure ---

test('PALETTE_SETS[1] has 8 entries', () => {
  expect(PALETTE_SETS[1]).toHaveLength(8);
});

test('PALETTE_SETS[2] has 8 entries', () => {
  expect(PALETTE_SETS[2]).toHaveLength(8);
});

test('PALETTE_SETS[1] contains all Natural keys', () => {
  const keys = PALETTE_SETS[1].map(p => p.key);
  expect(keys).toEqual(['forest', 'ocean', 'iris', 'ember', 'coral', 'sky', 'gold', 'mint']);
});

test('PALETTE_SETS[2] contains all Electric keys', () => {
  const keys = PALETTE_SETS[2].map(p => p.key);
  expect(keys).toEqual(['volt', 'plasma', 'arc', 'venom', 'inferno', 'aurora', 'solar', 'ultraviolet']);
});

test('forest palette has correct hex and glow', () => {
  const forest = PALETTE_SETS[1].find(p => p.key === 'forest');
  expect(forest.color).toBe('#22c55e');
  expect(forest.glow).toBe('rgba(34,197,94,0.4)');
});

test('volt palette has correct hex and glow', () => {
  const volt = PALETTE_SETS[2].find(p => p.key === 'volt');
  expect(volt.color).toBe('#aaff00');
  expect(volt.glow).toBe('rgba(170,255,0,0.4)');
});

test('each Set 1 palette has theme and complements', () => {
  PALETTE_SETS[1].forEach(p => {
    expect(p.theme).toBeDefined();
    expect(p.theme.bg).toBeDefined();
    expect(p.complements).toHaveLength(7);
  });
});

test('each Set 2 palette has theme and complements', () => {
  PALETTE_SETS[2].forEach(p => {
    expect(p.theme).toBeDefined();
    expect(p.complements).toHaveLength(7);
  });
});

// --- getPaletteByKey ---

test('getPaletteByKey returns correct palette for Set 1 key', () => {
  const p = getPaletteByKey('iris');
  expect(p.color).toBe('#818cf8');
});

test('getPaletteByKey returns correct palette for Set 2 key', () => {
  const p = getPaletteByKey('volt');
  expect(p.color).toBe('#aaff00');
});

test('getPaletteByKey falls back to forest for unknown key', () => {
  const p = getPaletteByKey('nonexistent');
  expect(p.key).toBe('forest');
});

// --- getGlowForColor ---

test('getGlowForColor returns correct glow for Set 1 hex', () => {
  expect(getGlowForColor('#818cf8')).toBe('rgba(129,140,248,0.4)');
});

test('getGlowForColor returns correct glow for Set 2 hex', () => {
  expect(getGlowForColor('#aaff00')).toBe('rgba(170,255,0,0.4)');
});

test('getGlowForColor falls back to forest glow for unknown hex', () => {
  expect(getGlowForColor('#000000')).toBe('rgba(34,197,94,0.4)');
});

// --- applyPaletteVars (unchanged API) ---

test('applyPaletteVars sets --my-status on :root for Set 1 key', () => {
  applyPaletteVars('iris');
  expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#818cf8');
});

test('applyPaletteVars sets --my-glow on :root for Set 1 key', () => {
  applyPaletteVars('iris');
  expect(document.documentElement.style.getPropertyValue('--my-glow')).toBe('rgba(129,140,248,0.4)');
});

test('applyPaletteVars works for Set 2 key', () => {
  applyPaletteVars('volt');
  expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#aaff00');
});

test('applyPaletteVars falls back to forest for unknown key', () => {
  applyPaletteVars('nonexistent');
  expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#22c55e');
});

// --- tapSwatch ---

describe('tapSwatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPaletteState.mockReturnValue({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'forest', activePaletteKey: null },
        '2': { selectedKey: 'volt',   activePaletteKey: null },
      },
    });
    document.body.innerHTML = `
      <div id="swatch-row">
        <div class="swatch selected" data-key="forest"></div>
        <div class="swatch" data-key="iris"></div>
      </div>`;
  });

  test('calls setPaletteState with updated selectedKey for active set', () => {
    tapSwatch('iris', 'uid1');
    expect(setPaletteState).toHaveBeenCalledWith(
      expect.objectContaining({
        sets: expect.objectContaining({
          '1': expect.objectContaining({ selectedKey: 'iris' }),
        }),
      })
    );
  });

  test('calls setStatusColor with userId and palette color', () => {
    tapSwatch('iris', 'uid1');
    expect(setStatusColor).toHaveBeenCalledWith('uid1', '#818cf8');
  });

  test('updates --my-status CSS var', () => {
    tapSwatch('iris', 'uid1');
    expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#818cf8');
  });

  test('moves .selected to tapped swatch', () => {
    tapSwatch('iris', 'uid1');
    expect(document.querySelector('[data-key="forest"]').classList.contains('selected')).toBe(false);
    expect(document.querySelector('[data-key="iris"]').classList.contains('selected')).toBe(true);
  });

  test('is synchronous — returns undefined', () => {
    expect(tapSwatch('iris', 'uid1')).toBeUndefined();
  });
});

// --- initSwatches ---

describe('initSwatches', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPaletteState.mockReturnValue({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'iris', activePaletteKey: null },
        '2': { selectedKey: 'volt', activePaletteKey: null },
      },
    });
    document.body.innerHTML = `<div id="swatch-row"></div>`;
  });

  test('injects 8 swatches into #swatch-row', () => {
    initSwatches('uid1');
    expect(document.querySelectorAll('.swatch')).toHaveLength(8);
  });

  test('toggle button is first child of swatch-row', () => {
    initSwatches('uid1');
    const first = document.getElementById('swatch-row').firstChild;
    expect(first.tagName).toBe('BUTTON');
    expect(first.className).toBe('set-toggle-btn');
  });

  test('toggle button shows bolt icon when in Set 1 (pointing to Electric)', () => {
    initSwatches('uid1');
    const btn = document.querySelector('.set-toggle-btn');
    expect(btn.innerHTML).toContain('<svg');
    expect(btn.innerHTML).toContain('Switch to Electric');
  });

  test('Set 1 swatches have correct data-keys', () => {
    initSwatches('uid1');
    const keys = Array.from(document.querySelectorAll('.swatch')).map(s => s.dataset.key);
    expect(keys).toEqual(['forest', 'ocean', 'iris', 'ember', 'coral', 'sky', 'gold', 'mint']);
  });

  test('swatch matching savedKey gets .selected', () => {
    initSwatches('uid1'); // savedKey is 'iris'
    expect(document.querySelector('[data-key="iris"]').classList.contains('selected')).toBe(true);
    expect(document.querySelector('[data-key="forest"]').classList.contains('selected')).toBe(false);
  });

  test('clicking a swatch calls setPaletteState (via tapSwatch)', () => {
    initSwatches('uid1');
    document.querySelector('[data-key="forest"]').click();
    expect(setPaletteState).toHaveBeenCalled();
  });
});

// --- switchSet ---

describe('switchSet', () => {
  let mockState;

  beforeEach(() => {
    jest.clearAllMocks();
    mockState = {
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'forest', activePaletteKey: null },
        '2': { selectedKey: 'volt',   activePaletteKey: null },
      },
    };
    document.body.innerHTML = `<div id="swatch-row"></div>`;
  });

  test('calls setPaletteState with activeSet updated to target', () => {
    getPaletteState.mockReturnValue(JSON.parse(JSON.stringify(mockState)));
    switchSet(2, 'uid1');
    expect(setPaletteState).toHaveBeenCalledWith(
      expect.objectContaining({ activeSet: 2 })
    );
  });

  test('applies --my-status CSS var for target set selectedKey', () => {
    getPaletteState.mockReturnValue(JSON.parse(JSON.stringify(mockState)));
    switchSet(2, 'uid1');
    // volt (#aaff00) is Set 2 selectedKey
    expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#aaff00');
  });

  test('calls setStatusColor with target set selectedKey color', () => {
    getPaletteState.mockReturnValue(JSON.parse(JSON.stringify(mockState)));
    switchSet(2, 'uid1');
    expect(setStatusColor).toHaveBeenCalledWith('uid1', '#aaff00');
  });

  test('re-renders swatch row with Set 2 swatches after switching to Set 2', () => {
    // First call (in switchSet): returns state with activeSet 1
    // Second call (in renderSwatchRow after setPaletteState): returns state with activeSet 2
    getPaletteState
      .mockReturnValueOnce(JSON.parse(JSON.stringify(mockState)))
      .mockReturnValueOnce({ ...JSON.parse(JSON.stringify(mockState)), activeSet: 2 });

    switchSet(2, 'uid1');

    const keys = Array.from(document.querySelectorAll('.swatch')).map(s => s.dataset.key);
    expect(keys).toContain('volt');
    expect(keys).not.toContain('forest');
  });

  test('toggle button shows tree icon after switching to Set 2', () => {
    getPaletteState
      .mockReturnValueOnce(JSON.parse(JSON.stringify(mockState)))
      .mockReturnValueOnce({ ...JSON.parse(JSON.stringify(mockState)), activeSet: 2 });

    switchSet(2, 'uid1');
    const btn = document.querySelector('.set-toggle-btn');
    expect(btn.innerHTML).toContain('Switch to Natural');
  });

  test('clicking toggle button from Set 1 calls switchSet with 2', () => {
    getPaletteState.mockReturnValue(JSON.parse(JSON.stringify(mockState)));
    initSwatches('uid1');
    jest.clearAllMocks();

    // Return state with activeSet 1 for the toggle click's switchSet call
    getPaletteState.mockReturnValue(JSON.parse(JSON.stringify(mockState)));

    document.querySelector('.set-toggle-btn').click();
    expect(setPaletteState).toHaveBeenCalledWith(
      expect.objectContaining({ activeSet: 2 })
    );
  });
});
