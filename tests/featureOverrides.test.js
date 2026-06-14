// tests/featureOverrides.test.js
const { readOverrides, writeOverride } = require('../js/featureOverrides.js');

beforeEach(() => localStorage.clear());

test('readOverrides returns {} when nothing stored', () => {
  expect(readOverrides()).toEqual({});
});

test('readOverrides returns {} on malformed JSON', () => {
  localStorage.setItem('statusapp_feature_overrides', 'not json');
  expect(readOverrides()).toEqual({});
});

test('writeOverride persists a boolean and round-trips via readOverrides', () => {
  writeOverride('palettes', false);
  expect(readOverrides()).toEqual({ palettes: false });
  expect(localStorage.getItem('statusapp_feature_overrides'))
    .toBe(JSON.stringify({ palettes: false }));
});

test('writeOverride merges, does not clobber other keys, and coerces to boolean', () => {
  writeOverride('palettes', false);
  writeOverride('groups', 0); // truthy/falsy coercion → false
  expect(readOverrides()).toEqual({ palettes: false, groups: false });
  writeOverride('palettes', 'yes'); // → true
  expect(readOverrides()).toEqual({ palettes: true, groups: false });
});
