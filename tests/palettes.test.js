// tests/palettes.test.js
jest.mock('../js/db.js', () => ({
  setStatusColor: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../js/store.js', () => ({
  getPalette: jest.fn().mockReturnValue('forest'),
  setPalette: jest.fn(),
}));

const { PALETTES, getPaletteByKey, getGlowForColor } = require('../js/palettes.js');

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
