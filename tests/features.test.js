// tests/features.test.js
// NOTE: deliberately does NOT mock ../js/features.js — exercises the real
// eval-time override read. Uses jest.isolateModules so each case re-evaluates
// the module against fresh localStorage.

beforeEach(() => localStorage.clear());

function loadFeatures() {
  let mod;
  jest.isolateModules(() => { mod = require('../js/features.js'); });
  return mod;
}

test('all controllable flags default ON when no override is stored', () => {
  const f = loadFeatures();
  expect(f.PALETTES_ENABLED).toBe(true);
  expect(f.PALETTE_INTERACTIONS_ENABLED).toBe(true);
  expect(f.GROUPS_ENABLED).toBe(true);
});

test('palettes override=false disables BOTH palette flags (bundled)', () => {
  localStorage.setItem('statusapp_feature_overrides', JSON.stringify({ palettes: false }));
  const f = loadFeatures();
  expect(f.PALETTES_ENABLED).toBe(false);
  expect(f.PALETTE_INTERACTIONS_ENABLED).toBe(false);
  expect(f.GROUPS_ENABLED).toBe(true);
});

test('groups override=false disables only groups', () => {
  localStorage.setItem('statusapp_feature_overrides', JSON.stringify({ groups: false }));
  const f = loadFeatures();
  expect(f.GROUPS_ENABLED).toBe(false);
  expect(f.PALETTES_ENABLED).toBe(true);
});

test('override=true is a no-op (feature already on by build default)', () => {
  localStorage.setItem('statusapp_feature_overrides', JSON.stringify({ groups: true }));
  const f = loadFeatures();
  expect(f.GROUPS_ENABLED).toBe(true);
});
