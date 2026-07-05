// tests/cacheOwner.test.js
const { ensureCacheOwner } = require('../js/cacheOwner');

const OWNER_KEY = 'statusapp_cache_owner';

const ACCOUNT_SCOPED_KEYS = [
  'statusapp_following',
  'statusapp_favorites',
  'statusapp_favorites_collapsed',
  'statusapp_palette_state',
  'statusapp_palette',
  'statusapp_theme',
  'statusapp_last_timeout',
  'statusapp_current_context',
  'statusapp_notify_prefs',
  'statusapp_follower_names',
  'statusapp_made_call_count',
  'statusapp_answered_call_count',
  'statusapp_inbox_seen',
  'statusapp_follow_requested',
  'statusapp_seen_bolt',
  'statusapp_seen_flower',
  'statusapp_seen_theme',
  'statusapp_seen_strip_peek_done',
  'statusapp_seen_longpress',
  'statusapp_seen_swipe',
  'statusapp_went_avail_custom',
  'statusapp_seen_notify_promo',
];

const DEVICE_SCOPED_KEYS = [
  'statusapp_identity',
  'statusapp_push_token',
  'statusapp_notify_reprompt_dismissed',
  'statusapp_notify_debug',
];

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
