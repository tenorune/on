// tests/cacheOwner.test.js
const fs = require('fs');
const path = require('path');
// Single source of truth (W2 C7): the classification lists live in cacheOwner
// and are imported here — no third hand-copy to drift out of step.
const {
  ensureCacheOwner,
  OWNER_KEY,
  ACCOUNT_SCOPED_KEYS,
  ACCOUNT_SCOPED_PREFIXES,
  DEVICE_SCOPED_KEYS,
  DEVICE_SCOPED_PREFIXES,
} = require('../js/cacheOwner');

function seedAccountScopedKeys() {
  for (const key of ACCOUNT_SCOPED_KEYS) {
    localStorage.setItem(key, 'value-for-' + key);
  }
}

function seedDeviceScopedKeys() {
  for (const key of DEVICE_SCOPED_KEYS) {
    localStorage.setItem(key, 'value-for-' + key);
  }
}

beforeEach(() => {
  localStorage.clear();
});

test('first run (no marker) adopts: keeps cache and stamps the uid', () => {
  seedAccountScopedKeys();

  ensureCacheOwner('uidA');

  for (const key of ACCOUNT_SCOPED_KEYS) {
    expect(localStorage.getItem(key)).toBe('value-for-' + key);
  }
  expect(localStorage.getItem(OWNER_KEY)).toBe('uidA');
});

test('same owner: calling again with the same uid keeps the cache', () => {
  seedAccountScopedKeys();
  ensureCacheOwner('uidA');

  ensureCacheOwner('uidA');

  for (const key of ACCOUNT_SCOPED_KEYS) {
    expect(localStorage.getItem(key)).toBe('value-for-' + key);
  }
  expect(localStorage.getItem(OWNER_KEY)).toBe('uidA');
});

test('owner change: wipes account-scoped keys (incl. prefixed groups) but keeps device-scoped keys', () => {
  seedAccountScopedKeys();
  seedDeviceScopedKeys();
  localStorage.setItem('statusapp_group_chip_G1', '15');
  localStorage.setItem('statusapp_group_palette_G2', 'volt');
  ensureCacheOwner('uidA');

  ensureCacheOwner('uidB');

  for (const key of ACCOUNT_SCOPED_KEYS) {
    expect(localStorage.getItem(key)).toBeNull();
  }
  expect(localStorage.getItem('statusapp_group_chip_G1')).toBeNull();
  expect(localStorage.getItem('statusapp_group_palette_G2')).toBeNull();

  for (const key of DEVICE_SCOPED_KEYS) {
    expect(localStorage.getItem(key)).toBe('value-for-' + key);
  }
  expect(localStorage.getItem(OWNER_KEY)).toBe('uidB');
});

// The return value tells the caller whether a wipe happened, so boot can
// reset DOM state derived from the wiped cache (the inline theme-restore
// script has already painted the previous owner's theme vars by the time
// this runs — app.js resets them iff we report a wipe).
test('returns true only when an owner change wiped the cache', () => {
  seedAccountScopedKeys();

  expect(ensureCacheOwner('uidA')).toBe(false); // first run: adopt, no wipe
  expect(ensureCacheOwner('uidA')).toBe(false); // same owner: no wipe
  expect(ensureCacheOwner('uidB')).toBe(true);  // owner change: wiped
  expect(ensureCacheOwner('uidB')).toBe(false); // new owner settled: no wipe
});

test('falsy uid returns false', () => {
  seedAccountScopedKeys();
  ensureCacheOwner('uidA');

  expect(ensureCacheOwner(null)).toBe(false);
  expect(ensureCacheOwner(undefined)).toBe(false);
  expect(ensureCacheOwner('')).toBe(false);
});

test('falsy uid is a no-op', () => {
  seedAccountScopedKeys();
  ensureCacheOwner('uidA');

  ensureCacheOwner(null);
  ensureCacheOwner(undefined);
  ensureCacheOwner('');

  for (const key of ACCOUNT_SCOPED_KEYS) {
    expect(localStorage.getItem(key)).toBe('value-for-' + key);
  }
  expect(localStorage.getItem(OWNER_KEY)).toBe('uidA');
});

// Drift guard (W2 C7): every statusapp_* localStorage key in the client source
// must be explicitly classified — account-scoped (wiped on owner change),
// device-scoped (kept), or the owner marker itself. A new key that lands in a
// module without a classification decision fails here, instead of silently
// surviving account switches (the exact leak cacheOwner exists to stop).
test('every statusapp_ key in js/ is classified (no silent drift)', () => {
  const jsDir = path.join(__dirname, '..', 'js');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.isFile() && e.name.endsWith('.js') ? [full] : [];
  });
  const keys = new Set();
  for (const file of walk(jsDir)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/statusapp_[a-z0-9_]+/g)) keys.add(m[0]);
  }
  expect(keys.size).toBeGreaterThan(20); // sanity: the scan actually found keys

  const classify = (k) =>
    k === OWNER_KEY ? 'owner'
    : ACCOUNT_SCOPED_KEYS.includes(k) ? 'account'
    : DEVICE_SCOPED_KEYS.includes(k) ? 'device'
    : ACCOUNT_SCOPED_PREFIXES.some((p) => k.startsWith(p)) ? 'account-prefix'
    : DEVICE_SCOPED_PREFIXES.some((p) => k.startsWith(p)) ? 'device-prefix'
    : null;

  const unclassified = [...keys].filter((k) => classify(k) === null).sort();
  expect(unclassified).toEqual([]);
});
