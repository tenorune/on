// tests/palettes.test.js
jest.mock('../js/db.js', () => ({
  setStatusColor: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../js/store.js', () => ({
  getPalette: jest.fn().mockReturnValue('forest'),
  setPalette: jest.fn(),
}));

const {
  PALETTES, getPaletteByKey, getGlowForColor, applyPaletteVars, tapSwatch, initSwatches,
} = require('../js/palettes.js');
const { setStatusColor } = require('../js/db.js');
const { getPalette: getPaletteMock, setPalette } = require('../js/store.js');

// --- PALETTES array ---

test('PALETTES has 8 entries', () => {
  expect(PALETTES).toHaveLength(8);
});

test('PALETTES contains forest entry with correct hex and glow', () => {
  const forest = PALETTES.find(p => p.key === 'forest');
  expect(forest).toBeDefined();
  expect(forest.color).toBe('#22c55e');
  expect(forest.glow).toBe('rgba(34, 197, 94, 0.4)');
});

test('PALETTES contains all 8 keys', () => {
  const keys = PALETTES.map(p => p.key);
  expect(keys).toEqual(expect.arrayContaining([
    'forest', 'ocean', 'iris', 'ember', 'coral', 'sky', 'gold', 'mint',
  ]));
});

// --- getPaletteByKey ---

test('getPaletteByKey returns correct palette for known key', () => {
  const p = getPaletteByKey('iris');
  expect(p.color).toBe('#a855f7');
});

test('getPaletteByKey falls back to forest for unknown key', () => {
  const p = getPaletteByKey('nonexistent');
  expect(p.key).toBe('forest');
});

// --- getGlowForColor ---

test('getGlowForColor returns correct glow for known hex', () => {
  expect(getGlowForColor('#a855f7')).toBe('rgba(168, 85, 247, 0.4)');
});

test('getGlowForColor falls back to forest glow for unknown hex', () => {
  // Must match the forest PALETTES entry exactly (spaced form)
  expect(getGlowForColor('#000000')).toBe('rgba(34, 197, 94, 0.4)');
});

// --- applyPaletteVars ---

test('applyPaletteVars sets --my-status on :root for known key', () => {
  applyPaletteVars('iris');
  expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#a855f7');
});

test('applyPaletteVars sets --my-glow on :root for known key', () => {
  applyPaletteVars('iris');
  expect(document.documentElement.style.getPropertyValue('--my-glow')).toBe('rgba(168, 85, 247, 0.4)');
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
    expect(setStatusColor).toHaveBeenCalledWith('uid1', '#a855f7');
  });

  test('updates --my-status CSS var', () => {
    tapSwatch('iris', 'uid1');
    expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#a855f7');
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
