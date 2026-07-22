/** @jest-environment node */
// js/features.js is FROZEN as .js: scripts/build.js readTelegramEnabled()
// reads its SOURCE TEXT with a silent fail-closed catch — if the file is
// renamed (e.g. a TypeScript conversion) or the flag line is reworded, the
// build does NOT fail; it silently disables the Telegram CTA on the built
// about page. This test turns that silent failure into a red suite.
const fs = require('fs');
const path = require('path');

test('js/features.js exists as .js and spells TELEGRAM_ENABLED the way scripts/build.js parses it', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'features.js'), 'utf8');
  // The EXACT regex from scripts/build.js readTelegramEnabled():
  expect(src).toMatch(/export const TELEGRAM_ENABLED = (true|false)/);
});
