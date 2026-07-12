# Telegram Invite Pitch — No-Duplicate-Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Telegram interstitial's "What is KnockKnock?" pitch open the read-only `/about?i=` page in a `pitch` mode that never auto-redeems and exposes no web-account exit, closing the duplicate-account hole N8 reopened.

**Architecture:** Point the N8 link at `/about?i=TOKEN&pitch=1` (the reading page — no C1 pass-through) instead of `/invite?i=TOKEN`. The existing inline pre-paint `<head>` script tags `<html>` with a new `cfg-pitch` class when `pitch=1`; CSS keyed off `html.cfg-pitch` hides the web-facing exits (Continue-in-browser door, Copy-invite block, copy fallback) while keeping the framing and the token-carrying "Open in Telegram" return door.

**Tech Stack:** Vanilla ES modules (`js/`), classic inline `<head>` script (CSP-hashed), plain CSS (`css/about.css`), Jest (`node_modules/.bin/jest` from repo root), Playwright-core + pre-installed Chromium for browser checks.

## Global Constraints

- Run web tests with `node_modules/.bin/jest` from the repo root — NOT bare `npx jest`.
- Build with `npm run build`. `about.html` / `index.html` / `sw.js` / `dist/bundle.js` are gitignored build artifacts.
- The inline `<head>` script is CSP-hashed: whenever its bytes change, recompute its sha256 and update `firebase.json`'s `script-src`. The hash-guard test in `tests/about-page.test.js` fails if it drifts.
- `pitch=1` must take effect only on the About reading page, never on `/invite` (config #1 is the actionable landing).
- The "Open in Telegram" door (`#invite-telegram-cta`) must remain visible in pitch mode; it is already fail-closed (hidden when no real Telegram deep link is configured).
- Do not touch redemption logic, the interstitial Accept/phrase/Not-now paths, or normal (non-pitch) `/about` / `/invite` behaviour.
- Never commit the model identifier or session URL beyond the standard commit trailer.

---

### Task 1: Point the N8 "What is KnockKnock?" link at the pitch reading page

**Files:**
- Modify: `js/telegramFirstRun.js:93`
- Test: `tests/telegramFirstRun.test.js:301-311`

**Interfaces:**
- Consumes: nothing new.
- Produces: the URL contract other tasks rely on — the pitch surface is `${origin}/about?i=<token>&pitch=1`.

- [ ] **Step 1: Update the failing test**

In `tests/telegramFirstRun.test.js`, replace the existing test at lines 301-311 with:

```js
  test('click opens /about?i=TOKEN&pitch=1 via openLink (reading page — never auto-redeems) and does NOT resolve the interstitial', async () => {
    arm();
    mockWa.openLink = jest.fn();
    const gate = telegramInviteGate({ linked: false, isNew: true, dismissSplash: jest.fn() });
    await flush();
    document.getElementById('tg-invite-about-btn').click();
    expect(mockWa.openLink).toHaveBeenCalledWith(`${window.location.origin}/about?i=${TOKEN}&pitch=1`);
    // still open — accepting afterwards works normally
    document.getElementById('tg-invite-accept-btn').click();
    await expect(gate).resolves.toMatchObject({ token: TOKEN, silent: false });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node_modules/.bin/jest tests/telegramFirstRun.test.js -t "pitch=1"`
Expected: FAIL — `openLink` was called with `${origin}/invite?i=${TOKEN}` (old URL), not the new `/about?i=…&pitch=1`.

- [ ] **Step 3: Change the link in `onAbout`**

In `js/telegramFirstRun.js`, in `onAbout` (currently line 93), change:

```js
      const url = window.location.origin + '/invite?i=' + token;
```

to:

```js
      // The reading page (/about) NEVER runs the C1 pass-through, so the token
      // can't auto-redeem on a web account; pitch=1 hides the web-facing exits
      // so the only door is "Open in Telegram" (redeems on the Telegram account).
      const url = window.location.origin + '/about?i=' + token + '&pitch=1';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node_modules/.bin/jest tests/telegramFirstRun.test.js`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add js/telegramFirstRun.js tests/telegramFirstRun.test.js
git commit -m "fix(telegram): N8 pitch opens the /about reading page, not /invite

'What is KnockKnock?' opened /invite?i=TOKEN — an actionable landing that
C1-passes-through and can auto-redeem the invite on a web account. Point it at
/about?i=TOKEN&pitch=1: the reading page never passes through, and pitch mode
(next tasks) hides the web-facing exits.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014PCkjCzHHy158DwoxtYZe5"
```

---

### Task 2: Tag `cfg-pitch` pre-paint from the inline `<head>` script

**Files:**
- Modify: `about.template.html:25` (the inline pre-paint `<script>`)
- Modify: `firebase.json` (the `script-src` sha256 for that inline script)
- Test: `tests/about-page.test.js` (the `describe('pre-paint config decision …')` block)

**Interfaces:**
- Consumes: the `/about?i=…&pitch=1` URL from Task 1.
- Produces: `<html>` carries `cfg-pitch` (alongside `cfg-invite`) exactly when a valid token is present, `pitch=1`, and the path is not `/invite`. CSS in Task 3 keys off `html.cfg-pitch`.

- [ ] **Step 1: Update the test regex and add failing behavior tests**

In `tests/about-page.test.js`, inside `describe('pre-paint config decision (inline <head> script)', …)`:

(a) Update `PT_RE` (the script no longer begins `var t,tok`):

```js
  const PT_RE = /<script>\(function\(\)\{var sp,tok=null[\s\S]*?<\/script>/;
```

(b) Add these tests at the end of that describe block (before its closing `});`):

```js
  test('/about?i= with pitch=1 → tags cfg-invite AND cfg-pitch, no redirect', () => {
    const { replaced, htmlCls } = run({ pathname: '/about', search: '?i=AbCdEf&pitch=1' });
    expect(replaced).toEqual([]);
    expect([...htmlCls].sort()).toEqual(['cfg-invite', 'cfg-pitch']);
  });

  test('/about?i= without pitch → no cfg-pitch', () => {
    expect(run({ pathname: '/about', search: '?i=AbCdEf' }).htmlCls.has('cfg-pitch')).toBe(false);
  });

  test('pitch=1 does nothing on /invite (config #1 is the actionable landing)', () => {
    const { htmlCls } = run({ pathname: '/invite', search: '?i=AbCdEf&pitch=1' });
    expect(htmlCls.has('cfg-pitch')).toBe(false);
    expect(htmlCls.has('cfg-invite-first')).toBe(true);
  });
```

- [ ] **Step 2: Run the pre-paint tests to verify they fail**

Run: `node_modules/.bin/jest tests/about-page.test.js -t "pre-paint config decision"`
Expected: FAIL — `PT_RE` no longer matches the (still-old) inline script, so `tag()` throws "inline pre-paint script not found", and the new cfg-pitch tests fail.

- [ ] **Step 3: Replace the inline `<head>` script**

In `about.template.html`, replace the single-line `<script>` at line 25 (the one beginning `<script>(function(){var t,tok=null,inv=false;`) with this exact line:

```html
  <script>(function(){var sp,tok=null,inv=false,pitch=false;try{sp=new URLSearchParams(location.search);var t=sp.get('i');tok=(t&&/^[A-Za-z0-9_-]{1,64}$/.test(t))?t:null;inv=location.pathname==='/invite';pitch=sp.get('pitch')==='1';}catch(e){return;}if(!tok)return;if(inv){var id=null;try{id=localStorage.getItem('statusapp_identity');}catch(e){}if(id){location.replace('/?i='+tok+'&stay=1');return;}}var c=document.documentElement.classList;c.add('cfg-invite');if(inv)c.add('cfg-invite-first');else if(pitch)c.add('cfg-pitch');})();</script>
```

(Note the `else if(pitch)` — cfg-pitch is only added when the path is NOT `/invite`.)

- [ ] **Step 4: Update the CSP hash in `firebase.json`**

In `firebase.json`'s `Content-Security-Policy` `script-src`, replace:

```
'sha256-YJTaeY4UZOiEnWybQb9UURPRfJaI3J8Kk65j3sPVy28='
```

with:

```
'sha256-kEwq5LDxr+Wrj7/XRBWyEe5gr2ks8/cM/JGonOOb1Ks='
```

- [ ] **Step 5: Run the pre-paint tests to verify they pass**

Run: `node_modules/.bin/jest tests/about-page.test.js -t "pre-paint config decision"`
Expected: PASS — including the existing "hash is whitelisted in the CSP" test (it recomputes the sha256 from the template and finds the updated value in `firebase.json`).

- [ ] **Step 6: Commit**

```bash
git add about.template.html firebase.json tests/about-page.test.js
git commit -m "feat(about): pre-paint cfg-pitch tag for the Telegram invite pitch

The inline <head> script adds .cfg-pitch to <html> when a valid ?i=TOKEN is
present with pitch=1 and the path isn't /invite, so the pitch surface paints
correct from the first frame. Refreshed the inline script's CSP sha256.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014PCkjCzHHy158DwoxtYZe5"
```

---

### Task 3: Hide the web-facing exits in `html.cfg-pitch`

**Files:**
- Modify: `css/about.css` (near the existing `html.cfg-invite` rules)
- Test: `tests/about-page.test.js` (the `describe('pre-paint config decision …')` block — CSS guard)

**Interfaces:**
- Consumes: `html.cfg-pitch` from Task 2.
- Produces: in pitch mode, the web door (`.invite-landing .cta[data-open-app]`), the Copy-invite block (`.invite-installed-hint`), and the copy fallback (`#invite-copy-fallback`) are `display:none`; the Telegram door (`#invite-telegram-cta`) and framing stay visible.

- [ ] **Step 1: Add the failing CSS guard test**

In `tests/about-page.test.js`, add this test at the end of the `describe('pre-paint config decision …')` block:

```js
  test('pitch mode hides the web-facing exits, keeps the Telegram return door', () => {
    const css = readRoot('css/about.css');
    expect(css).toContain('html.cfg-pitch .invite-landing .cta[data-open-app]');
    expect(css).toContain('html.cfg-pitch .invite-installed-hint');
    expect(css).toContain('html.cfg-pitch #invite-copy-fallback');
    // the "Open in Telegram" return door is NOT among the pitch-hidden selectors
    expect(css).not.toMatch(/html\.cfg-pitch[^;{]*#invite-telegram-cta/);
  });
```

- [ ] **Step 2: Run the CSS guard to verify it fails**

Run: `node_modules/.bin/jest tests/about-page.test.js -t "pitch mode hides"`
Expected: FAIL — `css` does not yet contain `html.cfg-pitch …` rules.

- [ ] **Step 3: Add the pitch-mode CSS**

In `css/about.css`, immediately AFTER the existing block:

```css
html.cfg-invite-first .intro-more,
html.cfg-invite-first .features,
html.cfg-invite-first .privacy-short,
html.cfg-invite-first .privacy-detail { display: none; }
```

insert:

```css
/* Telegram invite "What is KnockKnock?" pitch (/about?i=…&pitch=1): the reading
   page never auto-redeems, and pitch mode additionally hides every web-facing
   exit — the "Continue in browser" door, the "Copy invite" block, and its
   fallback (the copy target is /invite?i=, which WOULD pass through if pasted
   into a web app). The framing and the token-carrying "Open in Telegram" return
   door stay, so the only way forward is back into Telegram. */
html.cfg-pitch .invite-landing .cta[data-open-app],
html.cfg-pitch .invite-installed-hint,
html.cfg-pitch #invite-copy-fallback { display: none; }
```

- [ ] **Step 4: Run the CSS guard to verify it passes**

Run: `node_modules/.bin/jest tests/about-page.test.js`
Expected: PASS (whole file).

- [ ] **Step 5: Build and verify in Chromium**

Run: `npm run build` — Expected: `BUILD_OK` (build completes, `about.html` regenerated).

Then verify the rendered pitch surface. Write this to `/home/user/on/_pitch.mjs`, run it, then delete it:

```js
import http from 'http'; import fs from 'fs'; import path from 'path';
import { chromium } from 'playwright-core';
const root = '/home/user/on';
const about = fs.readFileSync(path.join(root, 'about.html'), 'utf8');
const fb = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
let csp = ''; for (const h of fb.hosting.headers || []) for (const kv of h.headers || []) if (kv.key === 'Content-Security-Policy') csp = kv.value;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const H = { 'Content-Security-Policy': csp };
  if (u.pathname === '/about') { res.writeHead(200, { ...H, 'Content-Type': 'text/html' }); res.end(about); return; }
  const fp = path.join(root, u.pathname);
  if (fs.existsSync(fp) && fs.statSync(fp).isFile()) { const e = path.extname(fp); const ct = e === '.css' ? 'text/css' : e === '.js' ? 'text/javascript' : 'application/octet-stream'; res.writeHead(200, { ...H, 'Content-Type': ct }); res.end(fs.readFileSync(fp)); return; }
  res.writeHead(404, H); res.end('nf');
});
await new Promise(r => server.listen(8099, r));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const T = 'AbCdEfGhIjKlMnOp';
// inject a real telegram deep link so the return door is present to assert on
const withLink = about.replace('data-telegram-link=""', 'data-telegram-link="https://t.me/bot/app"');
const probe = async (url, html) => {
  server.removeAllListeners('request');
  server.on('request', (req, res) => { const u = new URL(req.url, 'http://x'); const H = { 'Content-Security-Policy': csp };
    if (u.pathname === '/about') { res.writeHead(200, { ...H, 'Content-Type': 'text/html' }); res.end(html); return; }
    const fp = path.join(root, u.pathname);
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) { const e = path.extname(fp); const ct = e === '.css' ? 'text/css' : e === '.js' ? 'text/javascript' : 'application/octet-stream'; res.writeHead(200, { ...H, 'Content-Type': ct }); res.end(fs.readFileSync(fp)); return; }
    res.writeHead(404, H); res.end('nf'); });
  const pg = await b.newPage({ viewport: { width: 390, height: 844 } });
  await pg.goto(url, { waitUntil: 'load' });
  const r = await pg.evaluate(() => {
    const g = s => { const el = document.querySelector(s); return el ? getComputedStyle(el).display : 'no-el'; };
    return { htmlClass: document.documentElement.className,
      telegramDoor: g('#invite-telegram-cta'), webDoor: g('.invite-landing .cta[data-open-app]'),
      copyBlock: g('.invite-installed-hint'), framing: g('#about-invite-framing') };
  });
  await pg.close(); return r;
};
const pitch = await probe(`http://localhost:8099/about?i=${T}&pitch=1`, withLink);
const normal = await probe(`http://localhost:8099/about?i=${T}`, withLink);
await b.close(); server.close();
console.log(JSON.stringify({ pitch, normal }, null, 2));
```

Run: `node /home/user/on/_pitch.mjs && rm -f /home/user/on/_pitch.mjs`
Expected:
- `pitch.htmlClass` contains `cfg-invite cfg-pitch`; `pitch.telegramDoor` = `"block"`; `pitch.webDoor` = `"none"`; `pitch.copyBlock` = `"none"`; `pitch.framing` = `"block"`.
- `normal.htmlClass` = `cfg-invite` (no cfg-pitch); `normal.webDoor` = `"block"` (unaffected — normal web `/about?i=` keeps its door).

- [ ] **Step 6: Commit**

```bash
git add css/about.css tests/about-page.test.js
git commit -m "feat(about): pitch mode hides web-facing exits, keeps the Telegram door

html.cfg-pitch hides the 'Continue in browser' door, the 'Copy invite' block,
and the copy fallback, leaving only the framing and the 'Open in Telegram'
return door — so the Telegram invite pitch can't create or redeem on a web
account. Verified in Chromium under the enforced CSP.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014PCkjCzHHy158DwoxtYZe5"
```

---

### Task 4: Full-suite + build gate, then push

**Files:** none (verification only).

- [ ] **Step 1: Full web suite**

Run: `node_modules/.bin/jest`
Expected: all suites pass (baseline was 1684 tests; this plan adds ~4 tests and modifies 1, so ~1688 — the exact count isn't load-bearing, but there must be 0 failures).

- [ ] **Step 2: Cloud Functions suite (unaffected, confirm green)**

Run: `cd functions && npm test && cd ..`
Expected: PASS (this change is web-only; run to confirm nothing regressed).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `BUILD_OK` (build completes cleanly).

- [ ] **Step 4: Push**

```bash
git push -u origin claude/knockknock-283-phase1-xsolck
```
Expected: push succeeds; `git rev-parse HEAD origin/claude/knockknock-283-phase1-xsolck` prints the same SHA twice.

> Deploy note (not a plan step): `about.html`/`sw.js`/`dist/bundle.js` are gitignored — the maintainer's deploy must re-run the build for this to appear on device. On-device Telegram walkthrough is the acceptance gate.

---

## Notes for the executor

- The web door in the invite-landing card has no id; `.invite-landing .cta[data-open-app]` uniquely targets it (`#invite-telegram-cta` has `data-telegram-link`, not `data-open-app`; `#about-open-cta` lives in `.intro`, not `.invite-landing`).
- In this environment, node deps and the Chromium harness are already installed. If starting fresh, install apt libs (`libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev`) before `npm ci`, and `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-save playwright-core` for the browser checks.
- Do not push until Task 4. Commit per task.
