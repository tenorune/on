// Pins the two ignore lists that keep server-side source off the public site
// and the ops panel out of the functions deploy archive. The hosting gap was
// live and confirmed (curl -I .../functions/telegram-auth.js -> 200) before
// this test existed.
const config = require('../firebase.json');

describe('hosting.ignore', () => {
  test('excludes functions/** so Cloud Functions source is not served publicly', () => {
    expect(config.hosting.ignore).toContain('functions/**');
  });

  test('still excludes the pre-existing entries', () => {
    for (const entry of ['**/node_modules/**', 'tests/**', 'scripts/**', 'docs/**', 'css/**']) {
      expect(config.hosting.ignore).toContain(entry);
    }
  });
});

describe('functions.ignore', () => {
  test('excludes the ops panel from the deploy archive', () => {
    expect(config.functions.ignore).toContain('ops/**');
  });

  test('re-lists the CLI defaults, which specifying `ignore` replaces', () => {
    for (const entry of ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log']) {
      expect(config.functions.ignore).toContain(entry);
    }
  });
});
