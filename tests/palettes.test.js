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
const { getPaletteState, setPaletteState, getPalette: getPaletteMock, setPalette } = require('../js/store.js');

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

// --- applyPaletteVars ---

test('applyPaletteVars sets --my-status on :root for known key', () => {
  applyPaletteVars('iris');
  expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#818cf8');
});

test('applyPaletteVars sets --my-glow on :root for known key', () => {
  applyPaletteVars('iris');
  expect(document.documentElement.style.getPropertyValue('--my-glow')).toBe('rgba(129,140,248,0.4)');
});

test('applyPaletteVars falls back to forest for unknown key', () => {
  applyPaletteVars('nonexistent');
  expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#22c55e');
});

// --- tapSwatch ---

describe('tapSwatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = `
      <div id="swatch-row">
        <div class="swatch selected" data-key="forest"></div>
        <div class="swatch" data-key="iris"></div>
      </div>`;
  });

  test('calls setPalette with the tapped key', () => {
    tapSwatch('iris', 'uid1');
    expect(setPalette).toHaveBeenCalledWith('iris');
  });

  test('calls setStatusColor with userId and palette color (fire-and-forget)', () => {
    tapSwatch('iris', 'uid1');
    expect(setStatusColor).toHaveBeenCalledWith('uid1', '#818cf8');
  });

  test('updates --my-status CSS var', () => {
    tapSwatch('iris', 'uid1');
    expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#818cf8');
  });

  test('moves .selected from old swatch to tapped swatch', () => {
    tapSwatch('iris', 'uid1');
    expect(document.querySelector('[data-key="forest"]').classList.contains('selected')).toBe(false);
    expect(document.querySelector('[data-key="iris"]').classList.contains('selected')).toBe(true);
  });

  test('is synchronous — returns undefined, not a Promise', () => {
    const result = tapSwatch('iris', 'uid1');
    expect(result).toBeUndefined();
  });
});

// --- initSwatches ---

describe('initSwatches', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPaletteMock.mockReturnValue('iris');
    document.body.innerHTML = `<div id="swatch-row"></div>`;
  });

  test('injects 8 swatches into #swatch-row', () => {
    initSwatches('uid1');
    expect(document.querySelectorAll('.swatch')).toHaveLength(8);
  });

  test('each swatch has correct data-key', () => {
    initSwatches('uid1');
    const keys = Array.from(document.querySelectorAll('.swatch')).map(s => s.dataset.key);
    expect(keys).toEqual(expect.arrayContaining(['forest', 'ocean', 'iris', 'ember', 'coral', 'sky', 'gold', 'mint']));
  });

  test('each swatch background is set to palette color', () => {
    initSwatches('uid1');
    const forestSwatch = document.querySelector('[data-key="forest"]');
    expect(forestSwatch.style.background).toBe('rgb(34, 197, 94)');
  });

  test('swatch matching saved key gets .selected', () => {
    initSwatches('uid1'); // saved key is 'iris'
    expect(document.querySelector('[data-key="iris"]').classList.contains('selected')).toBe(true);
    expect(document.querySelector('[data-key="forest"]').classList.contains('selected')).toBe(false);
  });

  test('clicking a swatch calls setPalette (via tapSwatch)', () => {
    initSwatches('uid1');
    document.querySelector('[data-key="forest"]').click();
    expect(setPalette).toHaveBeenCalledWith('forest');
  });

  test('does NOT add .visible to #swatch-row', () => {
    initSwatches('uid1');
    expect(document.getElementById('swatch-row').classList.contains('visible')).toBe(false);
  });
});
