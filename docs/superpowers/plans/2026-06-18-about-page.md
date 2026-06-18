# /about Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a friendly, non-technical public `/about` page that introduces KnockKnock, gives the privacy model at a glance plus a detailed privacy section, and re-themes exactly like the app for returning users.

**Architecture:** A standalone static page (`about.html`, built from `about.template.html`, styled by `css/about.css`) — no JS bundle, no Firebase, no auth. It reuses the app's byte-identical inline theme-bootstrap script (already whitelisted by the CSP hash) so a saved palette themes the page. `build.js` substitutes `__APP_TITLE__`, `__DATA_REGION__`, and a computed `__ABOUT_MADE_BY__` line; the author's name comes from the `ABOUT_AUTHOR` env var, so it lives only in the built artifact, never the repo. Firebase Hosting serves it at a clean `/about` via a rewrite placed before the catch-all.

**Tech Stack:** Static HTML + CSS, native `<details>` (no JS), Node `build.js` string substitution, Firebase Hosting rewrites, Jest (file-reading contract tests).

**Spec:** `docs/superpowers/specs/2026-06-18-about-page-design.md`

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `scripts/build.js` | modify | Add pure `renderAbout(template, vars)` (exported) + `writeAboutHtml(defaultTitle)`. |
| `scripts/dev.js`, `scripts/dev-build.js`, `scripts/prod.js` | modify | Call `writeAboutHtml(...)` so every build path emits `about.html`. |
| `about.template.html` | create | The page source (placeholders `__APP_TITLE__` / `__DATA_REGION__` / `__ABOUT_MADE_BY__`). |
| `css/about.css` | create | Page styling; declares default theme tokens on `:root`, styles via `var(--…)`. |
| `about.html` | build output | **gitignored**, served by hosting. |
| `.gitignore` | modify | Add `about.html`. |
| `firebase.json` | modify | `/about` rewrite before the `**` catch-all. |
| `tests/about-page.test.js` | create | Contract tests: substitution, content, theme-script parity, routing. |

---

## Task 1: `renderAbout` substitution helper in build.js

**Files:**
- Modify: `scripts/build.js`
- Test: `tests/about-page.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/about-page.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/about-page.test.js`
Expected: FAIL — `renderAbout` is not a function / not exported.

- [ ] **Step 3: Implement `renderAbout` and `writeAboutHtml` in `scripts/build.js`**

Add these two functions after the existing `writeIndexHtml` function (reusing the existing `escapeHtml`, `env`, `readFileSync`, `writeFileSync`, `path`):

```js
function renderAbout(template, vars) {
  const title = vars.APP_TITLE || 'KnockKnock';
  const region = vars.DATA_REGION || 'a Google Cloud region';
  const author = vars.ABOUT_AUTHOR || '';
  const madeBy = author
    ? `Made by ${escapeHtml(author)} with a little help from Claude`
    : 'Made with a little help from Claude';
  return template
    .replaceAll('__APP_TITLE__', escapeHtml(title))
    .replaceAll('__DATA_REGION__', escapeHtml(region))
    .replaceAll('__ABOUT_MADE_BY__', madeBy);
}

function writeAboutHtml(defaultTitle) {
  const templatePath = path.resolve(__dirname, '..', 'about.template.html');
  const outPath = path.resolve(__dirname, '..', 'about.html');
  const template = readFileSync(templatePath, 'utf8');
  const out = renderAbout(template, {
    APP_TITLE: process.env.APP_TITLE || env.APP_TITLE || defaultTitle,
    DATA_REGION: process.env.DATA_REGION || env.DATA_REGION || '',
    ABOUT_AUTHOR: process.env.ABOUT_AUTHOR || env.ABOUT_AUTHOR || '',
  });
  writeFileSync(outPath, out);
}
```

Update the `module.exports` line to add both:

```js
module.exports = { define, envFile, writeIndexHtml, writeServiceWorker, renderAbout, writeAboutHtml };
```

Note: `region` is escaped via the `replaceAll('__DATA_REGION__', escapeHtml(region))` call; `madeBy` already escapes the author before assembly.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/about-page.test.js`
Expected: PASS (5 tests in the `renderAbout substitution` block).

- [ ] **Step 5: Commit**

```bash
git add scripts/build.js tests/about-page.test.js
git commit -m "feat: add renderAbout/writeAboutHtml build helpers for /about page"
```

---

## Task 2: The page — `about.template.html` + `css/about.css`

**Files:**
- Create: `about.template.html`
- Create: `css/about.css`
- Test: `tests/about-page.test.js` (append content + theme-parity blocks)

- [ ] **Step 1: Write the failing content tests**

Append to `tests/about-page.test.js`:

```js
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
    for (const a of blanks) expect(a).toMatch(/rel="noopener"/);
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/about-page.test.js`
Expected: FAIL — `about.template.html` does not exist (ENOENT).

- [ ] **Step 3: Create `about.template.html`**

Create `about.template.html` with exactly this content (the inline `<script>` is copied byte-for-byte from `index.template.html` line 21 — do not reformat it):

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#0f172a" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-title" content="__APP_TITLE__" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="description" content="__APP_TITLE__ — a quiet way to let the people who matter know when you're free." />
  <title>About · __APP_TITLE__</title>
  <link rel="manifest" href="manifest.json" />
  <link rel="apple-touch-icon" sizes="180x180" href="icons/icon-180.png" />
  <link rel="apple-touch-icon" sizes="192x192" href="icons/icon-192.png" />
  <link rel="stylesheet" href="css/about.css" />
  <script>try{var t=JSON.parse(localStorage.getItem('statusapp_theme')||'null');if(t){var r=document.documentElement;r.style.setProperty('--bg',t.bg);r.style.setProperty('--surface',t.surface);r.style.setProperty('--surface2',t.surface2);r.style.setProperty('--text',t.text);r.style.setProperty('--text-muted',t.textMuted);r.style.setProperty('--accent',t.accent);r.style.setProperty('--error-bg',t.errorBg);r.style.setProperty('--error-text',t.errorText);}}catch(e){}</script>
</head>
<body>
  <header class="hero">
    <span class="brand-mark">k&#x0338;n&#x0336;o&#x0338;c&#x0335;k&#x0335; &#x0336;k&#x0338;n&#x0337;o&#x0335;c&#x0338;k&#x0335;</span>
    <p class="tagline">Let the people who matter know when you're free.</p>
    <a class="cta" href="/" target="_blank" rel="noopener">Open __APP_TITLE__ &rarr;</a>
  </header>

  <main>
    <section class="intro">
      <h1>A quieter way to be reachable</h1>
      <p>__APP_TITLE__ is about <em>ambient presence</em> — a soft signal that you're around and open to company, without the pressure of a chat thread or an always-on green dot you can never switch off. Mark yourself available for a little while, and the handful of people you've chosen simply see it. When the timer runs out, you fade back to quiet.</p>
      <p class="muted">It's a small, experimental space — more playground than product. It rewards a little curiosity, so feel free to poke around.</p>
    </section>

    <section class="features">
      <h2>What you can do</h2>

      <article class="feature">
        <h3>Availability</h3>
        <p>Go available for a set stretch of time. The people you've connected with see it in real time, glowing in your color — no message to send, no &ldquo;you up?&rdquo;.</p>
      </article>

      <article class="feature">
        <h3>Knock</h3>
        <p>A gentle nudge. Tap a contact to send a little pulse their way — a hello without words.</p>
      </article>

      <article class="feature">
        <h3>Colors</h3>
        <p>Pick a palette and the whole app dresses up in it.</p>
        <details>
          <summary>How colors work</summary>
          <p>There are 16 palettes across two sets, and each one re-themes the entire app — including this page. You can save your favorite color combos, and borrow a contact's color by long-pressing their card. The favorites you build here also become your pen colors when you draw together on a call.</p>
        </details>
      </article>

      <article class="feature">
        <h3>Calls &amp; a shared canvas</h3>
        <p>Reach someone in the moment — and doodle together while you do.</p>
        <details>
          <summary>How calls work</summary>
          <p>Swipe right to call a mutual; they swipe right to answer. Answering opens a shared drawing canvas kept just for the two of you. Your saved favorite colors are the canvas pens — so the palette you build in Colors is the palette you draw with.</p>
        </details>
      </article>

      <article class="feature">
        <h3>Groups</h3>
        <p>Small circles, each with their own name and mood.</p>
        <details>
          <summary>How groups work</summary>
          <p>Every group can have its own display name and its own status and color, separate from your primary one — so you can be &ldquo;free to wander&rdquo; with friends and &ldquo;heads down&rdquo; with another circle at the same time. Prefer not to keep a separate status for a group? Turn that group's override off anytime. Invite people with a link or pick them right inside the app.</p>
        </details>
      </article>

      <article class="feature">
        <h3>Notifications</h3>
        <p>Off by default, and yours to shape.</p>
        <details>
          <summary>How notifications work</summary>
          <p>Notifications are opt-in, contact by contact — you choose who and what you hear about (knocks, calls, availability, invites). On some platforms (an iPhone Home Screen, the macOS Dock) the app needs to be installed first to deliver them, and it'll walk you through that when the time comes.</p>
        </details>
      </article>
    </section>

    <section class="privacy-short">
      <h2>Your privacy, in short</h2>
      <ul>
        <li><strong>No email, phone, or social sign-up.</strong> Your account is a four-word secret phrase.</li>
        <li><strong>Only your people see you.</strong> Your status is visible to the contacts you've connected with — and to fellow members inside a group.</li>
        <li><strong>No ads. No tracking. No analytics.</strong> Nothing about you is sold or measured.</li>
        <li><strong>A small, invite-based space</strong> — not a public network.</li>
      </ul>
      <p><a href="#privacy">Read the privacy details in full &darr;</a></p>
    </section>
  </main>

  <section id="privacy" class="privacy-detail">
    <h2>Privacy, in detail</h2>

    <h3>Your identity is a secret phrase</h3>
    <p>Instead of an email and password, your account is four words — something like <code>swift-river-amber-dust</code>. Type the same phrase on any device and you're back. That phrase is the only key to your account: treat it like a password, because anyone who has it can sign in as you. There's no &ldquo;forgot password&rdquo; — it can't be reset or recovered for you, so keep it somewhere safe.</p>

    <h3>What others can see — and what they can't</h3>
    <p>The people you've connected with can see your availability, your status, and your color, updating in real time. Inside a group, fellow members see the status you've set for that group. Everything else — who your contacts are, your settings, your saved colors — stays private to you.</p>

    <h3>Where your data lives</h3>
    <p>__APP_TITLE__ runs on Firebase (Google Cloud). Your data is stored in a Realtime Database hosted in the __DATA_REGION__ region. Access is locked down so each account can only read and write its own data — the only thing shared is the presence others need in order to see your status. When you sign in, a small server function checks your phrase and hands your device a token; your phrase itself is never stored as a password.</p>

    <h3>Notifications are opt-in</h3>
    <p>You decide who can notify you and about what, contact by contact. Nothing is pushed to you until you turn it on.</p>

    <h3>No analytics, ads, or data sales</h3>
    <p>There are no third-party trackers, no advertising, and no analytics quietly watching how you use the app. Your presence is for your people, not for anyone else.</p>
  </section>

  <footer class="footer">
    <nav class="footer-links">
      <a href="/" target="_blank" rel="noopener">Open __APP_TITLE__ &rarr;</a>
      <a href="https://github.com/tenorune/on" target="_blank" rel="noopener">Source on GitHub</a>
    </nav>
    <p class="muted">An experimental personal project.</p>
    <p class="made-by">__ABOUT_MADE_BY__</p>
  </footer>
</body>
</html>
```

- [ ] **Step 4: Create `css/about.css`**

Create `css/about.css` with exactly this content:

```css
/* css/about.css — standalone styling for /about. Default theme tokens live on
   :root; the inline theme-bootstrap script may override them per saved palette. */
:root {
  --bg: #0f172a;
  --surface: #1e293b;
  --surface2: #334155;
  --text: #f1f5f9;
  --text-muted: #94a3b8;
  --accent: #6366f1;
  --green: #22c55e;
  --green-glow: rgba(34, 197, 94, 0.4);
  --error-bg: #7f1d1d;
  --error-text: #fca5a5;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html { scroll-behavior: smooth; }

body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  line-height: 1.6;
  min-width: 360px;
  max-width: 640px;
  margin: 0 auto;
  padding: 0 1.25rem 4rem;
}

a { color: var(--accent); }
em { font-style: normal; color: var(--green); }
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  background: var(--surface2);
  padding: 0.1rem 0.35rem;
  border-radius: 0.3rem;
  font-size: 0.9em;
}

/* Hero */
.hero { text-align: center; padding: 3.5rem 0 2rem; }
.brand-mark { font-size: 1.85rem; display: block; letter-spacing: 0.02em; }
.tagline { color: var(--text-muted); margin-top: 0.75rem; font-size: 1.15rem; }
.cta {
  display: inline-block;
  margin-top: 1.75rem;
  padding: 0.65rem 1.3rem;
  background: var(--accent);
  color: #fff;
  font-weight: 600;
  text-decoration: none;
  border-radius: 0.6rem;
  box-shadow: 0 0 28px var(--green-glow);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.cta:hover { transform: translateY(-1px); }

/* Sections */
main, .privacy-detail { display: block; }
h1 { font-size: 1.6rem; margin-bottom: 0.75rem; }
h2 { font-size: 1.3rem; margin: 2.5rem 0 1rem; }
h3 { font-size: 1.05rem; margin-bottom: 0.4rem; }
p { margin-bottom: 0.9rem; }
.muted { color: var(--text-muted); }

.intro p:first-of-type { font-size: 1.05rem; }

/* Feature cards */
.feature {
  background: var(--surface);
  border-radius: 0.75rem;
  padding: 1.1rem 1.25rem;
  margin-bottom: 0.9rem;
}
.feature h3 { color: var(--text); }
.feature > p { margin-bottom: 0; color: var(--text-muted); }

.feature details { margin-top: 0.75rem; }
.feature summary {
  cursor: pointer;
  color: var(--accent);
  font-weight: 600;
  list-style: none;
}
.feature summary::-webkit-details-marker { display: none; }
.feature summary::before { content: "▸ "; }
.feature details[open] summary::before { content: "▾ "; }
.feature details p {
  margin-top: 0.6rem;
  margin-bottom: 0;
  color: var(--text-muted);
  border-left: 2px solid var(--surface2);
  padding-left: 0.85rem;
}

/* Privacy */
.privacy-short ul { list-style: none; }
.privacy-short li {
  background: var(--surface);
  border-radius: 0.6rem;
  padding: 0.75rem 1rem;
  margin-bottom: 0.6rem;
}
.privacy-short strong { color: var(--text); }
.privacy-short li { color: var(--text-muted); }

.privacy-detail {
  margin-top: 2.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--surface2);
}
.privacy-detail h3 { margin-top: 1.5rem; color: var(--accent); }
.privacy-detail p { color: var(--text-muted); }

/* Footer */
.footer {
  margin-top: 3rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--surface2);
  text-align: center;
}
.footer-links { display: flex; gap: 1.5rem; justify-content: center; flex-wrap: wrap; margin-bottom: 1rem; }
.footer-links a { font-weight: 600; text-decoration: none; }
.made-by { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 0; }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest tests/about-page.test.js`
Expected: PASS (the `renderAbout`, `about.template.html content`, and `theme bootstrap parity` blocks all green). The theme-parity test in particular confirms the inline script was copied byte-for-byte.

- [ ] **Step 6: Commit**

```bash
git add about.template.html css/about.css tests/about-page.test.js
git commit -m "feat: add /about page template and stylesheet"
```

---

## Task 3: Wire `writeAboutHtml` into the build paths + gitignore

**Files:**
- Modify: `scripts/dev.js`, `scripts/dev-build.js`, `scripts/prod.js`
- Modify: `.gitignore`

- [ ] **Step 1: Add `about.html` to `.gitignore`**

Edit `.gitignore` — add a line directly under `/index.html`:

```
/index.html
/about.html
```

- [ ] **Step 2: Wire into `scripts/dev-build.js`**

Change the require line to add `writeAboutHtml`:

```js
const { define, envFile, writeIndexHtml, writeServiceWorker, writeAboutHtml } = require('./build.js');
```

Add a call right after `const title = writeIndexHtml('On - Dev');`:

```js
const title = writeIndexHtml('On - Dev');
writeAboutHtml('On - Dev');
```

- [ ] **Step 3: Wire into `scripts/prod.js`**

Change the require line to add `writeAboutHtml`:

```js
const { define, envFile, writeIndexHtml, writeServiceWorker, writeAboutHtml } = require('./build.js');
```

Add a call right after `const title = writeIndexHtml('KnockKnock');`:

```js
const title = writeIndexHtml('KnockKnock');
writeAboutHtml('KnockKnock');
```

- [ ] **Step 4: Wire into `scripts/dev.js`**

Change the require line to add `writeAboutHtml`:

```js
const { define, writeIndexHtml, writeAboutHtml } = require('./build.js');
```

Add a call right after the existing `writeIndexHtml('On - Dev');` (around line 20):

```js
  writeIndexHtml('On - Dev');
  writeAboutHtml('On - Dev');
```

- [ ] **Step 5: Verify the build emits `about.html`**

Run: `node scripts/dev-build.js && test -f about.html && echo ABOUT_OK`
Expected: build log line + `ABOUT_OK`. (If `.env.local` is missing the build still substitutes — `__DATA_REGION__`/`__ABOUT_AUTHOR__` fall back to their defaults.)

- [ ] **Step 6: Verify placeholders were substituted (no leftovers)**

Run: `grep -c "__APP_TITLE__\|__DATA_REGION__\|__ABOUT_MADE_BY__" about.html; echo "exit=$?"`
Expected: `0` matches (grep prints `0` and exits non-zero; that's fine — the point is zero leftover placeholders).

- [ ] **Step 7: Commit**

```bash
git add scripts/dev.js scripts/dev-build.js scripts/prod.js .gitignore
git commit -m "build: emit about.html from all build paths; gitignore it"
```

---

## Task 4: Clean `/about` routing in firebase.json

**Files:**
- Modify: `firebase.json`
- Test: `tests/about-page.test.js` (append routing block)

- [ ] **Step 1: Write the failing routing test**

Append to `tests/about-page.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/about-page.test.js -t "catch-all"`
Expected: FAIL — no `/about` rewrite yet (`aboutIdx` is `-1`).

- [ ] **Step 3: Add the rewrite to `firebase.json`**

In `firebase.json`, change the `rewrites` array so `/about` comes first:

```json
    "rewrites": [
      { "source": "/about", "destination": "/about.html" },
      { "source": "**", "destination": "/index.html" }
    ],
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/about-page.test.js -t "catch-all"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add firebase.json tests/about-page.test.js
git commit -m "feat: serve /about at a clean URL via hosting rewrite"
```

---

## Task 5: Integration verification

**Files:** none (verification only)

- [ ] **Step 1: Full dev build**

Run: `node scripts/dev-build.js`
Expected: completes with the `Build complete: …` log line; `about.html` present at repo root.

- [ ] **Step 2: Full web test suite**

Run: `npx jest`
Expected: all suites pass (the existing suites + the new `tests/about-page.test.js`). Confirm no regression in count.

- [ ] **Step 3: Manual eyeball — default theme**

Run: `npm run dev` (prints a LAN URL), open `/about` in a private window (no `statusapp_theme` in localStorage).
Expected: dark slate page, indigo accent, brand mark, all six features, the four `<details>` toggles open/close with keyboard + click, privacy-short list, full privacy section reachable via the in-page anchor, footer links open the app and GitHub in a new tab.

- [ ] **Step 4: Manual eyeball — re-themed**

In the same browser, in DevTools console set a theme then reload `/about`:

```js
localStorage.setItem('statusapp_theme', JSON.stringify({ bg:'#1a0f2e', surface:'#2a1a44', surface2:'#3d2a5e', text:'#f3e8ff', textMuted:'#c4b5fd', accent:'#a855f7', errorBg:'#7f1d1d', errorText:'#fca5a5' }));
```

Expected: the page re-themes to the new palette (purple background/accent) — confirming the shared theme-bootstrap script works and the CSP didn't block it (no CSP error in console).

- [ ] **Step 5: Confirm no CSP violation**

In the same DevTools session, check the Console for any `Content-Security-Policy` errors on `/about`.
Expected: none — the inline theme script's hash matches the existing `script-src` allowance.

- [ ] **Step 6: Final commit (if any verification fixups were needed)**

Only if Steps 1–5 surfaced a fix:

```bash
git add -A
git commit -m "fix: address /about verification findings"
```

---

## Notes for the implementer

- **Do not reformat the inline `<script>`** in `about.template.html` — it must stay byte-identical to `index.template.html` line 21 or the CSP hash (`8plvDJLmM7886+ra4DrxBzGM2hgpxIJwDEK2Iu4PWMU=`) won't match and theming will be blocked. The parity test in Task 2 guards this.
- `about.html` is a **build artifact** (gitignored). Never commit it; CI/deploy regenerate it from the template.
- The author's name only ever appears in the built `about.html` via the `ABOUT_AUTHOR` env var — never hardcode it into `about.template.html` or any committed file.
- Branch: work on `claude/adoring-fermi-panh4e`. Push the branch; do not merge to `dev`/`main`.
- Set `git config user.email noreply@anthropic.com && git config user.name Claude` before committing so commits are verified.
```
