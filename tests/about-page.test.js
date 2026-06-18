/**
 * @jest-environment node
 */
const fs = require('fs');
const path = require('path');
const { renderAbout } = require('../scripts/build.js');

describe('renderAbout substitution', () => {
  const tpl = 'T:__APP_TITLE__ R:__DATA_REGION__ M:__ABOUT_MADE_BY__';

  test('fills title and region', () => {
    const out = renderAbout(tpl, { APP_TITLE: 'KnockKnock', DATA_REGION: 'europe-west1', ABOUT_AUTHOR: 'Alex K.' });
    expect(out).toContain('T:KnockKnock');
    expect(out).toContain('R:europe-west1');
  });

  test('made-by includes the author when set', () => {
    const out = renderAbout(tpl, { APP_TITLE: 'X', DATA_REGION: 'r', ABOUT_AUTHOR: 'Alex K.' });
    expect(out).toContain('Made by Alex K. with a little help from Claude');
  });

  test('made-by degrades gracefully when author is unset', () => {
    const out = renderAbout(tpl, { APP_TITLE: 'X', DATA_REGION: 'r', ABOUT_AUTHOR: '' });
    expect(out).toContain('Made with a little help from Claude');
    expect(out).not.toContain('Made by ');
    expect(out).not.toContain('__ABOUT_MADE_BY__');
  });

  test('region degrades gracefully when unset', () => {
    const out = renderAbout(tpl, { APP_TITLE: 'X', DATA_REGION: '', ABOUT_AUTHOR: '' });
    expect(out).toContain('a Google Cloud region');
    expect(out).not.toContain('__DATA_REGION__');
  });

  test('escapes HTML in author and title', () => {
    const out = renderAbout('__ABOUT_MADE_BY__ __APP_TITLE__', { APP_TITLE: '<b>', DATA_REGION: 'r', ABOUT_AUTHOR: '<i>' });
    expect(out).not.toContain('<b>');
    expect(out).not.toContain('<i>');
    expect(out).toContain('&lt;');
  });
});

const root = path.resolve(__dirname, '..');
const readRoot = (f) => fs.readFileSync(path.join(root, f), 'utf8');

describe('about.template.html content', () => {
  let tpl;
  beforeAll(() => { tpl = readRoot('about.template.html'); });

  test('has the privacy-detail anchor', () => {
    expect(tpl).toMatch(/id="privacy"/);
  });

  test('names the six core features', () => {
    for (const f of ['Availability', 'Knock', 'Colors', 'Calls', 'Groups', 'Notifications']) {
      expect(tpl).toContain(f);
    }
  });

  test('has at least four how-it-works <details> blocks', () => {
    const count = (tpl.match(/<details>/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test('mentions favorites feeding the call canvas pens', () => {
    expect(tpl.toLowerCase()).toContain('pen');
    expect(tpl.toLowerCase()).toContain('canvas');
  });

  test('every new-tab link is safe (target=_blank => rel=noopener)', () => {
    const anchors = tpl.match(/<a [^>]*>/g) || [];
    const blanks = anchors.filter((a) => /target="_blank"/.test(a));
    expect(blanks.length).toBeGreaterThan(0);
    for (const a of blanks) expect(a).toMatch(/\bnoopener\b/);
  });

  test('links to the GitHub repo', () => {
    expect(tpl).toContain('https://github.com/tenorune/on');
  });

  test('carries the substitution placeholders', () => {
    expect(tpl).toContain('__APP_TITLE__');
    expect(tpl).toContain('__DATA_REGION__');
    expect(tpl).toContain('__ABOUT_MADE_BY__');
  });

  test('links a stylesheet, not the app bundle', () => {
    expect(tpl).toContain('css/about.css');
    expect(tpl).not.toContain('dist/bundle.js');
  });
});

describe('theme bootstrap parity (keeps the CSP hash valid)', () => {
  const SCRIPT_RE = /<script>try\{var t=JSON\.parse[\s\S]*?<\/script>/;
  test('about reuses the byte-identical inline theme script from index', () => {
    const about = readRoot('about.template.html').match(SCRIPT_RE);
    const index = readRoot('index.template.html').match(SCRIPT_RE);
    expect(about).not.toBeNull();
    expect(index).not.toBeNull();
    expect(about[0]).toBe(index[0]);
  });
});

describe('firebase.json routing', () => {
  let cfg;
  beforeAll(() => { cfg = JSON.parse(readRoot('firebase.json')); });

  test('/about rewrite exists and precedes the ** catch-all', () => {
    const rewrites = cfg.hosting.rewrites;
    const aboutIdx = rewrites.findIndex((r) => r.source === '/about' && r.destination === '/about.html');
    const catchAllIdx = rewrites.findIndex((r) => r.source === '**');
    expect(aboutIdx).toBeGreaterThanOrEqual(0);
    expect(catchAllIdx).toBeGreaterThan(aboutIdx);
  });
});
