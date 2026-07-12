/**
 * @jest-environment node
 */
// Optional build vars (TELEGRAM_APP_LINK, DEV_RESET_*) must be settable as
// real environment variables — CI builds have no editable env file (the
// FIREBASE_CONFIG_* secrets are write-only), so the deploy workflows pass
// them via the Build step's `env:` instead. A real env var wins over the
// env-file value; unset means empty string (fail-closed), never REPLACE_ME.
const OPTIONAL_KEYS = ['TELEGRAM_APP_LINK', 'DEV_RESET_SECRET', 'DEV_RESET_HOSTS'];
// ENV=production makes build.js read .env.production, absent on dev machines
// and in CI's test job — so a developer's .env.local can't skew these tests.
const PINNED = [...OPTIONAL_KEYS, 'ENV'];

describe('build.js optional defines honor process.env (CI override)', () => {
  const saved = {};
  beforeEach(() => {
    jest.resetModules();
    for (const k of PINNED) { saved[k] = process.env[k]; delete process.env[k]; }
    process.env.ENV = 'production';
  });
  afterEach(() => {
    for (const k of PINNED) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  });

  test('a real environment variable reaches the bundle define', () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/prod_bot/app';
    process.env.DEV_RESET_SECRET = 's3cret';
    process.env.DEV_RESET_HOSTS = 'knock.example';
    const { define } = require('../scripts/build.js');
    expect(define['process.env.TELEGRAM_APP_LINK']).toBe(JSON.stringify('https://t.me/prod_bot/app'));
    expect(define['process.env.DEV_RESET_SECRET']).toBe(JSON.stringify('s3cret'));
    expect(define['process.env.DEV_RESET_HOSTS']).toBe(JSON.stringify('knock.example'));
  });

  test('unset stays an empty string (fail-closed feature detection)', () => {
    const { define } = require('../scripts/build.js');
    for (const k of OPTIONAL_KEYS) {
      expect(define[`process.env.${k}`]).toBe(JSON.stringify(''));
    }
  });
});
