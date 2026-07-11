/**
 * @jest-environment node
 */
const fs = require('fs');
const path = require('path');
const { renderAbout, invitePreviewUrl } = require('../scripts/build.js');

describe('renderAbout substitution', () => {
  const tpl = 'T:__APP_TITLE__ R:__DATA_REGION__ M:__ABOUT_MADE_BY__';

  test('fills title and region', () => {
    const out = renderAbout(tpl, { APP_TITLE: 'KnockKnock', DATA_REGION: 'europe-west1', ABOUT_AUTHOR: 'Alex K.' });
    expect(out).toContain('T:KnockKnock');
    expect(out).toContain('R:the europe-west1 region');
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

  test('substitutes the invite-preview callable URL', () => {
    const out = renderAbout('U:__INVITE_PREVIEW_URL__', { INVITE_PREVIEW_URL: 'https://x/resolveInvitePreview' });
    expect(out).toBe('U:https://x/resolveInvitePreview');
  });

  test('invite-preview URL is blank when unset (placeholder cleared)', () => {
    const out = renderAbout('U:__INVITE_PREVIEW_URL__', { APP_TITLE: 'X' });
    expect(out).toBe('U:');
  });

  test('substitutes the Telegram deep link (spec N5)', () => {
    const out = renderAbout('L:__TELEGRAM_APP_LINK__', { TELEGRAM_APP_LINK: 'https://t.me/bot/app' });
    expect(out).toBe('L:https://t.me/bot/app');
  });

  test('Telegram link is blank when unset (placeholder cleared — fail-closed)', () => {
    const out = renderAbout('L:__TELEGRAM_APP_LINK__', { APP_TITLE: 'X' });
    expect(out).toBe('L:');
  });

  test('region degrades gracefully when unset', () => {
    const out = renderAbout(tpl, { APP_TITLE: 'X', DATA_REGION: '', ABOUT_AUTHOR: '' });
    expect(out).toContain('a Google Cloud region');
    expect(out).not.toContain('__DATA_REGION__');
    expect(out).not.toContain('region region');
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

describe('readTelegramEnabled (spec N5: features.js is the single source of truth)', () => {
  test('matches the flag literal in js/features.js source', () => {
    const { readTelegramEnabled } = require('../scripts/build.js');
    const src = readRoot('js/features.js');
    const expected = /export const TELEGRAM_ENABLED = true/.test(src);
    expect(readTelegramEnabled()).toBe(expected);
  });

  test('returns false when readFileSync fails (fail-closed)', () => {
    jest.resetModules();
    jest.doMock('fs', () => ({
      ...jest.requireActual('fs'),
      readFileSync: jest.fn(() => {
        throw new Error('boom');
      }),
    }));
    const { readTelegramEnabled } = require('../scripts/build.js');
    expect(readTelegramEnabled()).toBe(false);
    jest.resetModules();
  });

  test('returns false when source has no TELEGRAM_ENABLED line (fail-closed)', () => {
    jest.resetModules();
    jest.doMock('fs', () => ({
      ...jest.requireActual('fs'),
      readFileSync: jest.fn(() => 'export const SOME_OTHER_FLAG = true;'),
    }));
    const { readTelegramEnabled } = require('../scripts/build.js');
    expect(readTelegramEnabled()).toBe(false);
    jest.resetModules();
  });
});

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

  test('has the invite-framing slot + preview-url placeholder + scripts', () => {
    expect(tpl).toMatch(/id="about-invite-framing"/);
    expect(tpl).toContain('data-preview-url="__INVITE_PREVIEW_URL__"');
    expect(tpl).toContain('js/about-invite.js');
    expect(tpl).toContain('js/about-cta.js');
  });

  test('has the invite landing block with fail-closed Telegram CTAs (spec N4)', () => {
    expect(tpl).toMatch(/id="invite-landing"/);
    expect(tpl).toMatch(/id="invite-telegram-cta"[^>]*data-telegram-link="__TELEGRAM_APP_LINK__"/);
    expect(tpl).toMatch(/id="about-telegram-cta"[^>]*data-telegram-link="__TELEGRAM_APP_LINK__"/);
    expect(tpl).toMatch(/id="about-open-cta"/);
    expect(tpl).toMatch(/id="invite-copy-btn"/);
    expect(tpl).toMatch(/id="about-more-btn"/);
    expect(tpl).toContain('js/about-telegram.js');
  });

  test('the framing slot lives inside the landing block (about-invite.js untouched)', () => {
    const landing = tpl.match(/<section id="invite-landing"[\s\S]*?<\/section>/);
    expect(landing).not.toBeNull();
    expect(landing[0]).toMatch(/id="about-invite-framing"/);
    expect(landing[0]).toContain('data-preview-url="__INVITE_PREVIEW_URL__"');
  });

  test('the intro lede survives config #1 (C4: split from the collapsible rest)', () => {
    expect(tpl).toMatch(/class="intro-lede"/);
    expect(tpl).toMatch(/class="intro-more"/);
    expect(readRoot('css/about.css')).toContain('body.invite-first .intro-more');
  });
});

describe('invitePreviewUrl', () => {
  test('builds the europe-west1 callable URL for a project', () => {
    expect(invitePreviewUrl('on-on-22cb4'))
      .toBe('https://europe-west1-on-on-22cb4.cloudfunctions.net/resolveInvitePreview');
  });
  test('is empty without a project id', () => {
    expect(invitePreviewUrl('')).toBe('');
  });
});

describe('about-cta link rewriting (token carry + in-app escape)', () => {
  const vm = require('vm');
  function runCta({ ua, maxTouchPoints = 0, search = '', host = 'knock.example' }) {
    const link = {
      attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; },
      removeAttribute(k) { delete this.attrs[k]; },
    };
    const sandbox = {
      navigator: { userAgent: ua, maxTouchPoints },
      location: { search, host },
      document: { querySelectorAll: () => [link] },
      URLSearchParams,
      encodeURIComponent,
    };
    vm.runInNewContext(readRoot('js/about-cta.js'), sandbox);
    return link;
  }
  const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36';
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Version/17.4 Mobile Safari/604.1';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel) Chrome/120 Mobile Safari/537.36';

  test('desktop with no token: rewritten to /?stay=1 (phase 3 — the landing must not bounce back)', () => {
    const link = runCta({ ua: DESKTOP, search: '' });
    expect(link.attrs.href).toBe('/?stay=1');
  });
  test('desktop with token: carries ?i= AND stay=1 on the normal link (C2)', () => {
    const link = runCta({ ua: DESKTOP, search: '?i=ABC123' });
    expect(link.attrs.href).toBe('/?i=ABC123&stay=1');
  });
  test('iOS: x-safari-https carries token + stay=1, drops target', () => {
    const link = runCta({ ua: IPHONE, search: '?i=ABC123' });
    expect(link.attrs.href).toBe('x-safari-https://knock.example/?i=ABC123&stay=1');
    expect(link.attrs.target).toBeUndefined();
  });
  test('iOS with no token: stay=1 still rides (C2 — tokenless loop guard)', () => {
    const link = runCta({ ua: IPHONE, search: '' });
    expect(link.attrs.href).toBe('x-safari-https://knock.example/?stay=1');
  });
  test('Android: intent:// with token + stay=1, fallback URL carries both too', () => {
    const link = runCta({ ua: ANDROID, search: '?i=ABC123' });
    expect(link.attrs.href).toContain('intent://knock.example/?i=ABC123&stay=1#Intent;scheme=https;');
    expect(link.attrs.href).toContain('browser_fallback_url=' + encodeURIComponent('https://knock.example/?i=ABC123&stay=1'));
    expect(link.attrs.href).toMatch(/;end$/);
  });
  test('Android with no token: stay=1 still rides, incl. the fallback URL', () => {
    const link = runCta({ ua: ANDROID, search: '' });
    expect(link.attrs.href).toContain('intent://knock.example/?stay=1#Intent');
    expect(link.attrs.href).toContain('browser_fallback_url=' + encodeURIComponent('https://knock.example/?stay=1'));
  });
  test('malformed token on desktop: treated as none → /?stay=1', () => {
    const link = runCta({ ua: DESKTOP, search: '?i=' + encodeURIComponent('bad token!') });
    expect(link.attrs.href).toBe('/?stay=1');
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

  test('/invite rewrite serves about.html and precedes the ** catch-all (spec N2)', () => {
    const rewrites = cfg.hosting.rewrites;
    const inviteIdx = rewrites.findIndex((r) => r.source === '/invite' && r.destination === '/about.html');
    const catchAllIdx = rewrites.findIndex((r) => r.source === '**');
    expect(inviteIdx).toBeGreaterThanOrEqual(0);
    expect(catchAllIdx).toBeGreaterThan(inviteIdx);
  });
});

describe('status-color easter egg', () => {
  const vm = require('vm');
  const crypto = require('crypto');

  // The egg is an inline <script> in <head> (so it runs before the <em> paints —
  // no green→custom flash). It's the SECOND inline script; the first is the theme
  // bootstrap. Extract it by its identifying body.
  const EGG_RE = /<script>\(function\(\)\{try\{var s=JSON\.parse[\s\S]*?<\/script>/;
  function eggScriptTag() {
    const m = readRoot('about.template.html').match(EGG_RE);
    if (!m) throw new Error('inline easter-egg script not found in about.template.html');
    return m[0];
  }
  function eggScriptBody() {
    return eggScriptTag().replace(/^<script>/, '').replace(/<\/script>$/, '');
  }

  function runEcho(storage) {
    const docEl = { style: { _vars: {}, setProperty(k, v) { this._vars[k] = v; } } };
    const sandbox = {
      JSON,
      localStorage: { getItem: (k) => (k in storage ? storage[k] : null) },
      document: { documentElement: docEl },
    };
    vm.runInNewContext(eggScriptBody(), sandbox);
    return docEl.style._vars['--status-echo'];
  }

  test('the egg runs inline in <head> (before paint), and the <em> falls back to green', () => {
    const tpl = readRoot('about.template.html');
    const headEnd = tpl.indexOf('</head>');
    const eggAt = tpl.search(EGG_RE);
    expect(eggAt).toBeGreaterThanOrEqual(0);
    expect(eggAt).toBeLessThan(headEnd);          // inline, in <head>
    expect(tpl).not.toContain('about-echo.js');    // no external/bottom script
    expect(readRoot('css/about.css')).toContain('var(--status-echo, var(--green))');
  });

  test("the egg script's hash is whitelisted in the CSP (won't be blocked / silently break)", () => {
    const hash = crypto.createHash('sha256').update(eggScriptBody(), 'utf8').digest('base64');
    expect(readRoot('firebase.json')).toContain(`'sha256-${hash}'`);
  });

  test('applies the saved status color when present', () => {
    const stored = JSON.stringify({ activeSet: 2, sets: { '1': { selectedColor: '#22c55e' }, '2': { selectedColor: '#3b82f6' } } });
    expect(runEcho({ statusapp_palette_state: stored })).toBe('#3b82f6');
  });

  test('does nothing when no palette state is saved', () => {
    expect(runEcho({})).toBeUndefined();
  });

  test('ignores a non-hex / unexpected color value', () => {
    const stored = JSON.stringify({ activeSet: 1, sets: { '1': { selectedColor: 'rgb(1,2,3)' }, '2': {} } });
    expect(runEcho({ statusapp_palette_state: stored })).toBeUndefined();
  });

  test('never throws on malformed storage', () => {
    expect(() => runEcho({ statusapp_palette_state: '{not json' })).not.toThrow();
  });
});

describe('about-telegram behavior (spec N4: configs, doors, pass-through)', () => {
  const vm = require('vm');
  const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';

  function makeEl(attrs = {}) {
    const cls = new Set(['hidden']);
    return {
      attrs: { ...attrs }, handlers: {}, textContent: '',
      classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      setAttribute(k, v) { this.attrs[k] = v; },
      addEventListener(t, f) { this.handlers[t] = f; },
    };
  }

  function runScript({ pathname = '/invite', search = '', link = 'https://t.me/bot/app', identity = null, ua = 'Mozilla/5.0 (Linux; Android 14) Chrome/120', clipboardOk = true } = {}) {
    const els = {
      'about-telegram-cta': makeEl({ 'data-telegram-link': link }),
      'about-open-cta': makeEl(),
      'invite-landing': makeEl(),
      'invite-telegram-cta': makeEl({ 'data-telegram-link': link }),
      'invite-copy-btn': makeEl(),
      'invite-copy-fallback': makeEl(),
      'about-more-btn': makeEl(),
    };
    const bodyCls = new Set();
    const replaced = [];
    const sandbox = {
      URLSearchParams, Promise,
      setTimeout: (f) => f(),
      navigator: {
        userAgent: ua, maxTouchPoints: 0,
        clipboard: { writeText: () => (clipboardOk ? Promise.resolve() : Promise.reject(new Error('denied'))) },
      },
      localStorage: { getItem: (k) => (k === 'statusapp_identity' ? identity : null) },
      location: { pathname, search, origin: 'https://knock.example', replace: (u) => replaced.push(u) },
      document: {
        getElementById: (id) => els[id] || null,
        body: { classList: { add: (c) => bodyCls.add(c), remove: (c) => bodyCls.delete(c), contains: (c) => bodyCls.has(c) } },
      },
    };
    vm.runInNewContext(readRoot('js/about-telegram.js'), sandbox);
    return { els, bodyCls, replaced };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  test('token-less page: standing bare CTA unhides with a real link (A3)', () => {
    const { els } = runScript({ pathname: '/about', search: '' });
    expect(els['about-telegram-cta'].classList.contains('hidden')).toBe(false);
    expect(els['about-telegram-cta'].attrs.href).toBe('https://t.me/bot/app');
    expect(els['invite-landing'].classList.contains('hidden')).toBe(true);
  });

  test('token-less + unsubstituted placeholder: everything stays hidden (fail-closed)', () => {
    const { els } = runScript({ pathname: '/about', search: '', link: '__TELEGRAM_APP_LINK__' });
    expect(els['about-telegram-cta'].classList.contains('hidden')).toBe(true);
  });

  test('config #1 (/invite + token): landing shows, token CTA composed, intro doors hidden, marketing collapsed', () => {
    const { els, bodyCls } = runScript({ search: `?i=${TOKEN}` });
    expect(els['invite-landing'].classList.contains('hidden')).toBe(false);
    expect(els['invite-telegram-cta'].attrs.href).toBe(`https://t.me/bot/app?startapp=${TOKEN}`);
    expect(els['invite-telegram-cta'].classList.contains('hidden')).toBe(false);
    expect(els['about-telegram-cta'].classList.contains('hidden')).toBe(true);
    expect(els['about-open-cta'].classList.contains('hidden')).toBe(true);
    expect(bodyCls.has('invite-first')).toBe(true);
  });

  test('config #2 (/about + token): landing shows, marketing NOT collapsed', () => {
    const { els, bodyCls } = runScript({ pathname: '/about', search: `?i=${TOKEN}` });
    expect(els['invite-landing'].classList.contains('hidden')).toBe(false);
    expect(bodyCls.has('invite-first')).toBe(false);
  });

  test('placeholder link with a token: Telegram CTA stays hidden, landing still shows', () => {
    const { els } = runScript({ search: `?i=${TOKEN}`, link: '__TELEGRAM_APP_LINK__' });
    expect(els['invite-telegram-cta'].classList.contains('hidden')).toBe(true);
    expect(els['invite-landing'].classList.contains('hidden')).toBe(false);
  });

  test('C1 pass-through: /invite + token + identity → replace(/?i=…&stay=1), landing untouched', () => {
    const { els, replaced } = runScript({ search: `?i=${TOKEN}`, identity: '{"userId":"u1"}' });
    expect(replaced).toEqual([`/?i=${TOKEN}&stay=1`]);
    expect(els['invite-landing'].classList.contains('hidden')).toBe(true);
  });

  test('no pass-through on /about?i= (config #2 is a reading page)', () => {
    const { replaced, els } = runScript({ pathname: '/about', search: `?i=${TOKEN}`, identity: '{"userId":"u1"}' });
    expect(replaced).toEqual([]);
    expect(els['invite-landing'].classList.contains('hidden')).toBe(false);
  });

  test('malformed token behaves as token-less', () => {
    const { els } = runScript({ search: '?i=' + encodeURIComponent('bad token!') });
    expect(els['invite-landing'].classList.contains('hidden')).toBe(true);
    expect(els['about-telegram-cta'].classList.contains('hidden')).toBe(false);
  });

  test('copy: success gives button feedback', async () => {
    const { els } = runScript({ search: `?i=${TOKEN}` });
    els['invite-copy-btn'].handlers.click();
    await flush();
    expect(els['invite-copy-btn'].textContent).toBe('Copy'); // set to 'Copied!' then restored by the immediate fake setTimeout
    expect(els['invite-copy-fallback'].classList.contains('hidden')).toBe(true);
  });

  test('copy: denied clipboard falls back to a selectable URL (C7)', async () => {
    const { els } = runScript({ search: `?i=${TOKEN}`, clipboardOk: false });
    els['invite-copy-btn'].handlers.click();
    await flush();
    expect(els['invite-copy-fallback'].textContent).toBe(`https://knock.example/invite?i=${TOKEN}`);
    expect(els['invite-copy-fallback'].classList.contains('hidden')).toBe(false);
  });

  test('iOS UA promotes the installed-app door (C5)', () => {
    const { bodyCls } = runScript({ search: `?i=${TOKEN}`, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Safari/604.1' });
    expect(bodyCls.has('ios-door-promoted')).toBe(true);
  });

  test('expander click un-collapses config #1', () => {
    const { els, bodyCls } = runScript({ search: `?i=${TOKEN}` });
    expect(bodyCls.has('invite-first')).toBe(true);
    els['about-more-btn'].handlers.click();
    expect(bodyCls.has('invite-first')).toBe(false);
  });
});
