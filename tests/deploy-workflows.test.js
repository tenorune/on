/**
 * @jest-environment node
 */
// Guard: both deploy workflows must write functions/.env before running
// `firebase deploy` — the CLI bakes that file into the functions at deploy
// time, so a CI deploy without this step silently strips the Telegram config
// from the live functions (the "push wipes the bot" landmine). Values come
// from suffixed Actions entries: tokens/secrets as `secrets.*`, the app URL
// (not sensitive) as `vars.*`. Unset entries write nothing — feature inert.
const fs = require('fs');
const path = require('path');
const readRoot = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');

describe.each([
  ['deploy-dev.yml', 'DEV'],
  ['deploy-prod.yml', 'PROD'],
])('%s writes functions/.env for the deploy', (file, sfx) => {
  let wf;
  beforeAll(() => { wf = readRoot(`.github/workflows/${file}`); });

  test('sources the Telegram values from suffixed Actions entries', () => {
    expect(wf).toContain(`secrets.TELEGRAM_BOT_TOKEN_${sfx}`);
    expect(wf).toContain(`secrets.TELEGRAM_WEBHOOK_SECRET_${sfx}`);
    expect(wf).toContain(`secrets.TELEGRAM_UID_SECRET_${sfx}`);
    expect(wf).toContain(`vars.TELEGRAM_APP_URL_${sfx}`);
  });

  test('writes functions/.env before firebase deploy runs', () => {
    const write = wf.indexOf('functions/.env');
    const deploy = wf.indexOf('npx firebase deploy');
    expect(write).toBeGreaterThan(-1);
    expect(deploy).toBeGreaterThan(-1);
    expect(write).toBeLessThan(deploy);
  });

  test('still deploys functions (the step this guard protects)', () => {
    expect(wf).toMatch(/--only [^\n]*functions/);
  });
});
