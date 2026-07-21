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

  test('typechecks scripts/ alongside the root typecheck before deploy', () => {
    // scripts/*.js are covered by tsconfig.scripts.json (Node-typed), separate
    // from the browser root tsconfig; both must gate CI so a scripts type
    // regression fails the build the same way a client one does.
    const scriptsCheck = wf.indexOf('npm run typecheck:scripts');
    const deploy = wf.indexOf('npx firebase deploy');
    expect(scriptsCheck).toBeGreaterThan(-1);
    expect(deploy).toBeGreaterThan(-1);
    expect(scriptsCheck).toBeLessThan(deploy);
  });
});

// Pin the hosting headers the location feature depends on (spec §9): the
// Permissions-Policy grant is what lets same-origin pages call the
// Geolocation API once browsers enforce the policy — losing it silently
// breaks capture in production while dev (no headers) keeps working.
describe('firebase.json hosting headers', () => {
  test('Permissions-Policy allows geolocation for self on every route', () => {
    const cfg = JSON.parse(readRoot('firebase.json'));
    const all = cfg.hosting.headers.find((h) => h.source === '**');
    expect(all).toBeDefined();
    expect(all.headers).toContainEqual({ key: 'Permissions-Policy', value: 'geolocation=(self)' });
  });

  test('sw.js is served no-store, in a block AFTER the "**" no-cache rule', () => {
    // no-cache (revalidate) is NOT enough for the worker script: iOS WebKit
    // has been device-observed (2026-07-21) answering the SW update check
    // from its conditional-revalidation state with stale bytes — update()
    // "succeeds" seeing the old sw.js for days while the server serves a new
    // one, so the PWA never auto-updates. no-store leaves nothing to
    // revalidate on either the client or CDN side. Firebase applies the
    // LATER matching headers block for a duplicate key, so this block must
    // stay after '**' (same ordering constraint as the chunks rule).
    const cfg = JSON.parse(readRoot('firebase.json'));
    const idxAll = cfg.hosting.headers.findIndex((h) => h.source === '**');
    const idxSw = cfg.hosting.headers.findIndex((h) => h.source === '/sw.js');
    expect(idxSw).toBeGreaterThan(idxAll);
    expect(cfg.hosting.headers[idxSw].headers).toContainEqual({ key: 'Cache-Control', value: 'no-store' });
  });
});
