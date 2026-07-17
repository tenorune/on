# Client Performance & Efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut cold-boot payload and runtime waste found in the 2026-07-17 performance audit — 8 findings, ordered by impact-per-risk.

**Architecture:** No architectural change. The build (esbuild via `scripts/`) gains a CSS pass and ESM code-splitting; the boot path gains preconnect hints and drops two eager loads (wordlist, firebase/messaging) plus a third-party script dependency; the canvas live-draw protocol goes delta-based; two micro-cleanups round it out. Every task is independently shippable, in order.

**Tech Stack:** esbuild (already a devDependency), vanilla TS, Firebase Hosting/RTDB, Jest + jsdom.

**Baseline (measured at `81f6d16`):** `dist/bundle.js` = 592,530 B minified / 175,089 B gzipped. Metafile: `js/wordlist.ts` 77,725 B (13%), firebase `messaging`+`installations` ~20,387 B, `css/app.css` 56,025 B raw unminified.

## Global Constraints

- Zero TS suppressions (`@ts-ignore`/`@ts-expect-error`/`as any` additions) — repo convention.
- `npm run typecheck` (tsc --noEmit, strict) must stay green after every task.
- Web tests: `npx jest` at repo root. Rules tests unaffected (no `database.rules.json` change anywhere in this plan).
- One commit per task; conversion/infra commits stay behavior-identical unless the task says otherwise.
- `js/features.js` and the `about-*.js` trio stay `.js` (served raw / source-text-read — documented landmines).
- Firebase Hosting serves the repo root (`"public": "."` in firebase.json); anything the page references must exist on disk post-build.
- CSP in firebase.json pins inline-script hashes — do NOT add or modify inline `<script>` blocks in templates; external same-origin scripts and `<link>` tags are fine.

---

### Task 1: Minify CSS at build (finding #2, incl. about.css/canvas.css)

Ship minified copies of all three stylesheets from `dist/css/`; sources in `css/` stay the readable source of truth.

**Files:**
- Modify: `scripts/build.js` (add `buildCss`, update `writeServiceWorker` hash inputs)
- Modify: `scripts/prod.js`, `scripts/dev-build.js`, `scripts/dev.js`
- Modify: `index.template.html:27-28`, `about.template.html:29`
- Modify: `sw.template.js:10` (SHELL paths)
- Modify: `firebase.json` (hosting ignore)
- Test: `tests/sw.test.js` (update pinned paths), `tests/about-page.test.js` (no change expected — it reads `css/` sources)

**Interfaces:**
- Produces: `buildCss(minify: boolean)` exported from `scripts/build.js`; output files `dist/css/app.css`, `dist/css/canvas.css`, `dist/css/about.css`.

- [ ] **Step 1: Update the SW test expectations (failing first)**

In `tests/sw.test.js`, change the shell-precache test's expectation:

```js
expect(addAll).toHaveBeenCalledWith(expect.arrayContaining(['/dist/css/canvas.css']));
```

and the cache-version-hash test:

```js
expect(src).toMatch(/dist\/css\/canvas\.css/);
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/sw.test.js -t "precache"`
Expected: FAIL (SHELL still lists `/css/canvas.css`).

- [ ] **Step 3: Implement the CSS build**

In `scripts/build.js` (top, after existing requires — esbuild is a devDependency):

```js
const esbuild = require('esbuild');

// Minified (prod) or plain (dev) copies of the stylesheets, served from
// dist/css/. Sources in css/ stay readable; hosting ignores them (firebase.json).
function buildCss(minify) {
  esbuild.buildSync({
    entryPoints: ['css/app.css', 'css/canvas.css', 'css/about.css'],
    outdir: 'dist/css',
    minify,
  });
}
```

Export it: add `buildCss` to the `module.exports` list at `scripts/build.js:157`.

In `writeServiceWorker`, change the hashed-input list from `'css/app.css', 'css/canvas.css'` to `'dist/css/app.css', 'dist/css/canvas.css'`:

```js
for (const f of ['dist/bundle.js', 'dist/css/app.css', 'dist/css/canvas.css', 'index.html', 'manifest.json']) {
```

In `sw.template.js:10`:

```js
const SHELL = ['/', '/index.html', '/dist/css/app.css', '/dist/css/canvas.css', '/dist/bundle.js', '/manifest.json'];
```

In `index.template.html:27-28`:

```html
  <link rel="stylesheet" href="dist/css/app.css" />
  <link rel="stylesheet" href="dist/css/canvas.css" />
```

In `about.template.html:29`:

```html
  <link rel="stylesheet" href="dist/css/about.css" />
```

In `scripts/prod.js`, after the `esbuild.buildSync` call and before `writeServiceWorker()` (hash inputs must exist):

```js
const { define, envFile, writeIndexHtml, writeServiceWorker, writeAboutHtml, buildCss } = require('./build.js');
// … existing buildSync …
buildCss(true);
```

In `scripts/dev-build.js`, same placement: `buildCss(false);` (and add `buildCss` to its require).

In `scripts/dev.js`, inside `main()` after the JS `ctx.watch()`, add a second watching context so CSS edits rebuild live:

```js
  const cssCtx = await esbuild.context({
    entryPoints: ['css/app.css', 'css/canvas.css', 'css/about.css'],
    outdir: 'dist/css',
  });
  await cssCtx.watch();
```

In `firebase.json` hosting `ignore`, add `"css/**"` (sources no longer referenced by any page):

```json
"ignore": ["firebase.json", ".firebaserc", "**/.*", "**/node_modules/**", "tests/**", "scripts/**", "docs/**", "css/**", "package.json", "package-lock.json", "jest.config.js", "babel.config.js", "*.md"],
```

- [ ] **Step 4: Verify**

Run: `npx jest tests/sw.test.js tests/about-page.test.js tests/build-env.test.js tests/deploy-workflows.test.js && npm run typecheck && npm run typecheck:scripts`
Expected: PASS.

Run: `node scripts/prod.js && ls -la dist/css/ && head -c 200 dist/css/app.css`
Expected: three files exist; `app.css` is one minified line; size well under the 56 KB source.

Run: `grep -c 'dist/css/app.css' index.html sw.js`
Expected: ≥1 in each.

- [ ] **Step 5: Commit**

```bash
git add scripts/build.js scripts/prod.js scripts/dev-build.js scripts/dev.js index.template.html about.template.html sw.template.js firebase.json tests/sw.test.js
git commit -m "perf(css): serve minified stylesheets from dist/css — build pass in prod/dev/watch, SW shell + hash follow"
```

---

### Task 2: Preconnect hints for boot origins (finding #4)

Overlap DNS+TLS to the origins every boot hits with the bundle download.

**Files:**
- Modify: `scripts/build.js` (new pure `preconnectLinks`, wire into `writeIndexHtml`)
- Modify: `index.template.html` (placeholder)
- Test: `tests/build-env.test.js`

**Interfaces:**
- Produces: `preconnectLinks(databaseUrl: string): string` exported from `scripts/build.js`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/build-env.test.js` (node environment, same file-level pattern as the existing describe blocks):

```js
describe('preconnectLinks (boot-origin hints)', () => {
  const { preconnectLinks } = require('../scripts/build.js');

  test('emits the RTDB origin plus the two auth origins', () => {
    const out = preconnectLinks('https://my-db-default-rtdb.europe-west1.firebasedatabase.app');
    expect(out).toContain('<link rel="preconnect" href="https://my-db-default-rtdb.europe-west1.firebasedatabase.app">');
    expect(out).toContain('<link rel="preconnect" href="https://identitytoolkit.googleapis.com" crossorigin>');
    expect(out).toContain('<link rel="preconnect" href="https://securetoken.googleapis.com" crossorigin>');
  });

  test('unset or placeholder database URL emits nothing (fail-closed)', () => {
    expect(preconnectLinks('')).toBe('');
    expect(preconnectLinks('REPLACE_ME')).toBe('');
  });

  test('the index template carries the substitution slot', () => {
    const fs = require('fs');
    const path = require('path');
    const tpl = fs.readFileSync(path.resolve(__dirname, '..', 'index.template.html'), 'utf8');
    expect(tpl).toContain('__PRECONNECT_LINKS__');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/build-env.test.js -t preconnect`
Expected: FAIL (`preconnectLinks` is not a function).

- [ ] **Step 3: Implement**

In `scripts/build.js`:

```js
// Preconnect hints for the origins every boot hits before the bundle can ask
// for them: the RTDB websocket origin (from the env's databaseURL) and the two
// Firebase Auth REST origins (sign-in mint + token refresh). CORS fetches need
// the crossorigin connection pool; the RTDB websocket does not. Fail-closed:
// no/placeholder config (test builds) emits nothing.
/** @param {string} databaseUrl */
function preconnectLinks(databaseUrl) {
  if (!databaseUrl || databaseUrl === 'REPLACE_ME') return '';
  let origin;
  try { origin = new URL(databaseUrl).origin; } catch { return ''; }
  return [
    `<link rel="preconnect" href="${origin}">`,
    '<link rel="preconnect" href="https://identitytoolkit.googleapis.com" crossorigin>',
    '<link rel="preconnect" href="https://securetoken.googleapis.com" crossorigin>',
  ].join('\n  ');
}
```

In `writeIndexHtml` (`scripts/build.js:68-75`), chain the substitution:

```js
  writeFileSync(outPath, template
    .replaceAll('__APP_TITLE__', escapeHtml(title))
    .replaceAll('__PRECONNECT_LINKS__', preconnectLinks(envVal('FIREBASE_DATABASE_URL'))));
```

(`envVal` is defined at `scripts/build.js:51`; it already handles process.env-over-file precedence.)

Add `preconnectLinks` to `module.exports`.

In `index.template.html`, add the slot on its own line right after the `<meta name="theme-color">` line (before stylesheets, so the hints are seen early):

```html
  __PRECONNECT_LINKS__
```

- [ ] **Step 4: Verify**

Run: `npx jest tests/build-env.test.js tests/about-page.test.js && npm run typecheck:scripts`
Expected: PASS.

Run: `FIREBASE_DATABASE_URL=https://x-default-rtdb.europe-west1.firebasedatabase.app node scripts/prod.js && grep -c preconnect index.html`
Expected: 3. Then `node scripts/prod.js && grep -c __PRECONNECT_LINKS__ index.html` → 0 (slot always cleared).

- [ ] **Step 5: Commit**

```bash
git add scripts/build.js index.template.html tests/build-env.test.js
git commit -m "perf(boot): preconnect hints for RTDB + auth origins, derived from env at build"
```

---

### Task 3: ESM code-splitting + lazy wordlist (finding #1 — biggest payload win)

Switch the bundle to ESM with splitting; load the 78 KB wordlist via dynamic `import()` only in the three flows that need it (create account, phrase restore, Telegram graduation).

**Files:**
- Modify: `scripts/prod.js`, `scripts/dev-build.js`, `scripts/dev.js` (esbuild options)
- Modify: `scripts/build.js` (`writeServiceWorker` chunk enumeration)
- Modify: `index.template.html:437` (module script), `sw.template.js` (CHUNKS)
- Modify: `js/identity.ts`, `js/app.ts:259,382`, `js/graduation.ts:41`, `js/recoveryModal.ts:57`, `js/telegramSettings.ts:128`
- Test: `tests/identity.test.js`, `tests/recovery.test.js`, `tests/sw.test.js` (touched suites), full `npx jest`

**Interfaces:**
- Consumes: nothing from earlier tasks (SHELL paths from Task 1 if landed — keep whichever list is current).
- Produces: `generateRecoveryCode(): Promise<string>` and `parseRecoveryCode(input: unknown): Promise<string | null>` — the new async signatures every caller in this task adopts. `writeServiceWorker` now substitutes `__CHUNK_LIST__`.

**Landmine notes:** `tests/cacheOwner.test.js`'s drift-scan already walks `.ts` files — unaffected. `scripts/build.js` reads `js/features.js` source text — untouched. `defer` classic scripts and non-async `type="module"` scripts share the after-parse, in-document-order execution queue, so the telegram bridge still executes before the bundle (until Task 5 changes that deliberately).

- [ ] **Step 1: Update `js/identity.ts` to lazy-load the wordlist**

```ts
async function generateRecoveryCode(): Promise<string> {
  const { WORDLIST } = await import('./wordlist.js');
  const words = [];
  const buf = new Uint32Array(4);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 4; i++) {
    // buf[i] is in [0, 2^32). Modulo by WORDLIST.length introduces negligible bias
    // (WORDLIST.length = 7772 ≪ 2^32, so the bias is ~7e-7 — irrelevant at this scale).
    words.push(WORDLIST[buf[i] % WORDLIST.length]);
  }
  return words.join('-');
}

async function parseRecoveryCode(input: unknown): Promise<string | null> {
  if (typeof input !== 'string') return null;
  const normalized = input
    .toLowerCase()
    .replace(/[\s,\-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalized) return null;
  const tokens = normalized.split('-');
  if (tokens.length !== 4) return null;
  const { WORDSET } = await import('./wordlist.js');
  for (const t of tokens) {
    if (!WORDSET.has(t)) return null;
  }
  return tokens.join('-');
}
```

(Keep the early `typeof`/shape checks before the import — malformed input still rejects without touching the network/chunk.)

- [ ] **Step 2: Update the five call sites**

`js/app.ts:259` (inside `createNewAccount`, already async):
```ts
  const initial = await generateRecoveryCode();
```

`js/app.ts:382` (inside the restore `onSubmit`, already async):
```ts
      const normalized = await parseRecoveryCode(input.value);
```

`js/graduation.ts:41` (enclosing function already awaits `showRecoveryCodeModal`):
```ts
  await showRecoveryCodeModal(await generateRecoveryCode(), async (rc) => {
```

`js/recoveryModal.ts:57` — make the rotate handler async:
```ts
    async function onRotate() {
      current = await generateRecoveryCode();
```
(The rest of the handler body is unchanged; it's attached with `addEventListener`, which accepts an async listener.)

`js/telegramSettings.ts:128` (enclosing handler already async — it awaits at line 143):
```ts
      const normalized = await parseRecoveryCode(input.value);
```

- [ ] **Step 3: Update the touched tests to await**

In `tests/identity.test.js` and any suite calling `generateRecoveryCode`/`parseRecoveryCode` directly (find them: `grep -ln 'generateRecoveryCode\|parseRecoveryCode' tests/*.js`), make the test callbacks async and `await` the calls, e.g.:

```js
test('parses a valid phrase', async () => {
  expect(await parseRecoveryCode('Swift river AMBER dust')).toBe('swift-river-amber-dust');
});
```

Assertion values are unchanged — only the awaits are new. (babel-jest's preset-env compiles `import()` to `require` under Jest; the existing `moduleNameMapper` resolves `./wordlist.js` → `wordlist.ts`.)

- [ ] **Step 4: Run the affected suites — green before touching the build**

Run: `npx jest tests/identity.test.js tests/recovery.test.js tests/telegramSettings.test.js tests/graduation.test.js && npm run typecheck`
Expected: PASS. (The source change is complete and correct under the OLD single-file build too — `import()` of a bundled module just inlines. This isolates the source change from the build change.)

- [ ] **Step 5: Switch the build to ESM + splitting**

In `scripts/prod.js`, replace the esbuild options (keep `minify`, `sourcemap`, `define` as-is) and clear stale chunks first:

```js
const { rmSync } = require('fs');
rmSync('dist/chunks', { recursive: true, force: true });

esbuild.buildSync({
  entryPoints: ['js/app.ts'],
  bundle: true,
  outdir: 'dist',
  entryNames: 'bundle',
  chunkNames: 'chunks/[name]-[hash]',
  format: 'esm',
  splitting: true,
  minify: true,
  sourcemap: true,
  define,
});
```

Same options block (minus `minify`/`sourcemap`) in `scripts/dev-build.js` and in the `esbuild.context` of `scripts/dev.js`, each with the same `rmSync` guard before the build/context creation.

In `index.template.html:437`:

```html
  <script type="module" src="dist/bundle.js"></script>
```

In `sw.template.js`, after the SHELL const:

```js
// Code-split chunks, substituted at build (comma-joined). The unsubstituted
// template filters to [] so tests can load this file directly.
const CHUNKS = '__CHUNK_LIST__'.split(',').filter((s) => s && s.indexOf('__') !== 0);
```

and in the install handler:

```js
    caches.open(CACHE).then((cache) => cache.addAll(SHELL.concat(CHUNKS))),
```

In `scripts/build.js` `writeServiceWorker`, enumerate and hash the chunks, and substitute:

```js
function writeServiceWorker() {
  const root = path.resolve(__dirname, '..');
  const { readdirSync } = require('fs');
  const template = readFileSync(path.join(root, 'sw.template.js'), 'utf8');
  let chunks = [];
  try {
    chunks = readdirSync(path.join(root, 'dist', 'chunks'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => `/dist/chunks/${f}`)
      .sort();
  } catch { /* no chunks dir (pre-split build) */ }
  const hash = createHash('sha256');
  const hashed = ['dist/bundle.js', 'dist/css/app.css', 'dist/css/canvas.css', 'index.html', 'manifest.json', ...chunks.map((c) => c.slice(1))];
  for (const f of hashed) {
    const p = path.join(root, f);
    if (existsSync(p)) hash.update(readFileSync(p));
  }
  const version = `knockknock-${hash.digest('hex').slice(0, 12)}`;
  writeFileSync(path.join(root, 'sw.js'), template
    .replace(/__CACHE_VERSION__/g, version)
    .replace('__CHUNK_LIST__', chunks.join(',')));
  return version;
}
```

(If Task 1 has not landed yet, keep `css/app.css`/`css/canvas.css` in the hashed list instead of the `dist/css/` paths.)

- [ ] **Step 6: Add an SW-template guard test**

Append to `tests/sw.test.js`'s shell-precache describe:

```js
  test('unsubstituted CHUNKS placeholder filters to empty (template loads as-is)', async () => {
    const { handlers, addAll } = loadSwWithMockSelf();
    const waited = [];
    handlers.install({ waitUntil: (p) => waited.push(p) });
    await Promise.all(waited);
    const cached = addAll.mock.calls[0][0];
    expect(cached).toEqual(expect.arrayContaining(['/dist/bundle.js']));
    expect(cached.some((u) => u.includes('__'))).toBe(false);
  });
```

- [ ] **Step 7: Verify the split and the numbers**

Run: `npx jest && npm run typecheck && npm run typecheck:scripts`
Expected: full suite PASS.

Run: `node scripts/prod.js && ls dist/chunks/ && wc -c dist/bundle.js && grep -c '"abacus"\|abacus' dist/bundle.js ; grep -l abacus dist/chunks/*.js`
Expected: ≥1 chunk file; `dist/bundle.js` roughly 78 KB smaller than the 592 KB baseline; `abacus` (first EFF word) absent from `bundle.js`, present in exactly one chunk. `grep -c __CHUNK_LIST__ sw.js` → 0.

- [ ] **Step 8: Commit**

```bash
git add js/identity.ts js/app.ts js/graduation.ts js/recoveryModal.ts js/telegramSettings.ts tests/ scripts/ index.template.html sw.template.js
git commit -m "perf(boot): ESM code-splitting — 78KB wordlist lazy-loads only in create/restore/graduate flows"
```

---

### Task 4: Lazy-load firebase/messaging (finding #5)

**Files:**
- Modify: `js/firebase-config.ts:4,83-92`
- Test: full `npx jest` (notifyPrompt suites exercise the seam via mocks)

**Interfaces:**
- Consumes: Task 3's ESM splitting (without it the dynamic import inlines and nothing moves).
- Produces: `getMessagingIfSupported()` — signature unchanged (already async), so no caller changes.

- [ ] **Step 1: Implement**

In `js/firebase-config.ts`, delete line 4 (`import { getMessaging, isSupported } from 'firebase/messaging';`) and rewrite the accessor:

```ts
let _messaging: import('firebase/messaging').Messaging | null = null;
// Returns a Messaging instance, or null where unsupported (e.g. iOS Safari tab).
// The messaging SDK (+installations, ~20KB) loads as a lazy chunk on first call —
// it's not needed to paint the app, and unsupported contexts never pay for it.
export async function getMessagingIfSupported() {
  try {
    if (_messaging) return _messaging;
    const { getMessaging, isSupported } = await import('firebase/messaging');
    if (!(await isSupported())) return null;
    _messaging = getMessaging(app);
    return _messaging;
  } catch { return null; }
}
```

- [ ] **Step 2: Verify**

Run: `npx jest tests/notifyPrompt.test.js tests/notifyChannel.test.js tests/notifyDebug.test.js tests/app-boot-cacheOwner.test.js && npm run typecheck`
Expected: PASS.

Run: `node scripts/prod.js && grep -c fcmregistrations dist/bundle.js ; grep -lc fcmregistrations dist/chunks/*.js`
Expected: 0 in `bundle.js`; present in a chunk (the messaging SDK embeds that endpoint string).

- [ ] **Step 3: Commit**

```bash
git add js/firebase-config.ts
git commit -m "perf(boot): firebase/messaging loads as a lazy chunk on first getMessagingIfSupported call"
```

---

### Task 5: Take telegram-web-app.js off the universal boot path (finding #3)

Web boots stop waiting on telegram.org; Telegram boots await the bridge explicitly, with a timeout backstop.

**Files:**
- Create: `js/telegramBridge.ts`
- Modify: `index.template.html:23`, `js/app.ts` (top of `main()`)
- Test: `tests/telegramBridge.test.js` (new)

**Interfaces:**
- Produces: `telegramBridgeReady(timeoutMs?: number): Promise<void>` from `js/telegramBridge.ts`.

**Landmine note:** the current `defer` ordering IS the guarantee that `isTelegramContext()` sees `window.Telegram` at boot (comment at `index.template.html:18-22`). This task replaces that implicit guarantee with an explicit await — the template comment must be rewritten, not just the attribute.

- [ ] **Step 1: Write the failing tests**

Create `tests/telegramBridge.test.js`:

```js
/** @jest-environment jsdom */
const { telegramBridgeReady } = require('../js/telegramBridge.ts');

function setHash(h) {
  Object.defineProperty(window, 'location', {
    value: new URL(`https://app.example/${h}`),
    writable: true,
  });
}

describe('telegramBridgeReady', () => {
  afterEach(() => {
    delete window.Telegram;
    document.getElementById('tg-bridge')?.remove();
    jest.useRealTimers();
  });

  test('resolves immediately outside a Telegram launch (no tgWebApp hash)', async () => {
    setHash('#other=1');
    await expect(telegramBridgeReady()).resolves.toBeUndefined();
  });

  test('resolves immediately when the bridge already loaded', async () => {
    setHash('#tgWebAppData=x');
    window.Telegram = { WebApp: { initData: 'x' } };
    await expect(telegramBridgeReady()).resolves.toBeUndefined();
  });

  test('waits for the bridge script load event on a Telegram launch', async () => {
    setHash('#tgWebAppData=x');
    const el = document.createElement('script');
    el.id = 'tg-bridge';
    document.head.appendChild(el);
    let settled = false;
    const p = telegramBridgeReady().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    el.dispatchEvent(new Event('load'));
    await p;
    expect(settled).toBe(true);
  });

  test('times out rather than hanging when telegram.org never answers', async () => {
    jest.useFakeTimers();
    setHash('#tgWebAppData=x');
    const el = document.createElement('script');
    el.id = 'tg-bridge';
    document.head.appendChild(el);
    const p = telegramBridgeReady(3000);
    jest.advanceTimersByTime(3000);
    await expect(p).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/telegramBridge.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `js/telegramBridge.ts`**

```ts
// js/telegramBridge.ts — decouples web boots from telegram.org.
// The bridge <script> is `async` (index.template.html): the bundle no longer
// executes behind a third-party download. Telegram launches are detected from
// the launch URL itself — Mini App URLs carry tgWebAppData/tgWebAppPlatform in
// the fragment — and only those boots await the bridge, with a timeout so a
// slow/blocked telegram.org degrades to a web boot instead of hanging forever.
// Everyone else resolves synchronously.
const TG_LAUNCH = /tgWebAppData|tgWebAppPlatform/;

export function telegramBridgeReady(timeoutMs = 3000): Promise<void> {
  const w = window as unknown as { Telegram?: { WebApp?: unknown } };
  if (w.Telegram?.WebApp) return Promise.resolve();          // bridge already up
  if (!TG_LAUNCH.test(location.hash)) return Promise.resolve(); // not a Telegram launch
  const el = document.getElementById('tg-bridge');
  if (!el) return Promise.resolve();                          // no bridge tag (tests/legacy)
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, timeoutMs);
    el.addEventListener('load', done, { once: true });
    el.addEventListener('error', done, { once: true });
  });
}
```

- [ ] **Step 4: Wire into boot and the template**

`index.template.html:18-23` — replace the script line and its comment block:

```html
  <!-- Telegram Mini App bridge. Inert outside Telegram (defines window.Telegram
       with empty initData). `async`: the bundle does NOT wait for telegram.org —
       Telegram launches are detected from the URL fragment and explicitly await
       this script via telegramBridgeReady() (js/telegramBridge.ts) before any
       isTelegramContext() read. Keep id="tg-bridge" — the await keys off it. -->
  <script id="tg-bridge" src="https://telegram.org/js/telegram-web-app.js" async></script>
```

`js/app.ts` — add the import alongside the other telegram imports (`js/app.ts:31`):

```ts
import { telegramBridgeReady } from './telegramBridge.js';
```

and in `main()` (`js/app.ts:975-978`), await it before Stage 1 (first `isTelegramContext()` consumer is `resolveIdentity`):

```ts
  if (await maybeRunDevReset()) return; // dev-only identity reset (env-gated); halts boot
  await telegramBridgeReady(); // Telegram launches wait (bounded) for the async bridge; web boots don't
  const session = await resolveIdentity(intent);  // Stage 1 (may halt boot → null)
```

- [ ] **Step 5: Verify**

Run: `npx jest tests/telegramBridge.test.js tests/telegramFirstRun.test.js tests/telegramOnramp.test.js tests/telegramLinkArrival.test.js tests/app-boot-cacheOwner.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add js/telegramBridge.ts js/app.ts index.template.html tests/telegramBridge.test.js
git commit -m "perf(boot): telegram bridge goes async — web boots stop waiting on telegram.org; TG launches await it bounded"
```

---

### Task 6: Delta-based canvas live-draw broadcast (finding #6)

Send only points appended since the last broadcast instead of the whole cumulative stroke (O(n²) → O(n) bytes), and append-render on the receiver instead of full clear-and-redraw per tick.

**Files:**
- Create: `js/canvasDelta.ts`
- Modify: `js/canvas.ts` (sender: pointerdown/`onPointerMove`/`onPointerUp`; receiver: the `watchDrawing` callback at `js/canvas.ts:415-432`)
- Test: `tests/canvasDelta.test.js` (new), `tests/canvas.test.js` + `tests/canvas-sync.test.js` (must stay green)

**Interfaces:**
- Produces:
  - `buildDrawingPayload(allPoints: number[][], lastSentIndex: number, color: string, thickness: number): DrawingPayload` where `DrawingPayload = { color: string; thickness: number; points: number[][]; base: number }`
  - `applyDrawingPayload(buffer: number[][] | null, p: { points?: number[][]; base?: number }): number[][]`

**Wire-compat contract (version skew is real — peers update at different times):**
- Old sender → new receiver: no `base` field ⇒ treated as a full replace (today's semantics).
- New sender → old receiver: old code renders `points` as the whole stroke, so mid-stroke it draws only the latest tail — a transient preview artifact; the final stroke still arrives complete via `pushStroke` on pointerup. Acceptable degradation, note it in the module comment.

- [ ] **Step 1: Write the failing tests**

Create `tests/canvasDelta.test.js`:

```js
/** @jest-environment node */
const { buildDrawingPayload, applyDrawingPayload } = require('../js/canvasDelta.ts');

describe('buildDrawingPayload', () => {
  test('first send carries everything with base 0', () => {
    const pts = [[0, 0], [0.1, 0.1]];
    expect(buildDrawingPayload(pts, 0, '#fff', 0.01)).toEqual(
      { color: '#fff', thickness: 0.01, points: [[0, 0], [0.1, 0.1]], base: 0 });
  });

  test('subsequent sends carry only the tail since lastSentIndex', () => {
    const pts = [[0, 0], [0.1, 0.1], [0.2, 0.2]];
    const p = buildDrawingPayload(pts, 2, '#fff', 0.01);
    expect(p.base).toBe(2);
    expect(p.points).toEqual([[0.2, 0.2]]);
  });
});

describe('applyDrawingPayload', () => {
  test('base 0 replaces the buffer (new stroke)', () => {
    expect(applyDrawingPayload([[9, 9]], { base: 0, points: [[0, 0]] })).toEqual([[0, 0]]);
  });

  test('base === buffer.length appends', () => {
    expect(applyDrawingPayload([[0, 0]], { base: 1, points: [[0.1, 0.1]] }))
      .toEqual([[0, 0], [0.1, 0.1]]);
  });

  test('missing base (legacy sender) replaces — old cumulative semantics', () => {
    expect(applyDrawingPayload([[9, 9]], { points: [[0, 0], [0.1, 0.1]] }))
      .toEqual([[0, 0], [0.1, 0.1]]);
  });

  test('a gap (skipped intermediate write) still yields a usable buffer', () => {
    // RTDB may coalesce rapid set()s; base can jump past buffer.length.
    expect(applyDrawingPayload([[0, 0]], { base: 3, points: [[0.4, 0.4]] }))
      .toEqual([[0, 0], [0.4, 0.4]]);
  });

  test('null buffer starts fresh from the payload tail', () => {
    expect(applyDrawingPayload(null, { base: 2, points: [[0.2, 0.2]] })).toEqual([[0.2, 0.2]]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/canvasDelta.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `js/canvasDelta.ts`**

```ts
// js/canvasDelta.ts — delta protocol for the live-drawing broadcast.
// The old protocol re-sent the ENTIRE stroke every throttle tick (O(n²) bytes
// over a long stroke, full clear-and-redraw per tick on the receiver). Now each
// tick sends only the points appended since the last send, plus `base` = how
// many points the receiver should already hold.
// Wire compat: a payload with no `base` (legacy sender) is a full replace; a
// legacy RECEIVER shown a delta payload renders just the tail mid-stroke — a
// transient preview artifact only, since the final stroke lands via pushStroke.
export type DrawingPayload = { color: string; thickness: number; points: number[][]; base: number };

export function buildDrawingPayload(
  allPoints: number[][], lastSentIndex: number, color: string, thickness: number,
): DrawingPayload {
  return { color, thickness, points: allPoints.slice(lastSentIndex), base: lastSentIndex };
}

export function applyDrawingPayload(
  buffer: number[][] | null,
  p: { points?: number[][]; base?: number },
): number[][] {
  const points = p.points ?? [];
  const base = p.base;
  if (base === undefined || base === 0 || !buffer) return points.slice();
  // base > buffer.length means an intermediate write was coalesced away; join
  // what we have to the new tail — a short straight-line gap in the PREVIEW only.
  return buffer.slice(0, Math.min(base, buffer.length)).concat(points);
}
```

- [ ] **Step 4: Wire the sender (`js/canvas.ts`)**

Add the import at the top of `js/canvas.ts`:

```ts
import { buildDrawingPayload, applyDrawingPayload } from './canvasDelta.js';
```

Add module state next to `_lastDrawingSend` (`js/canvas.ts:~46`):

```ts
let _lastSentIndex = 0; // how many of _currentPoints the peer already has
```

In the pointerdown handler that starts a stroke (where `_currentPoints` is reset to `[]`), also reset:

```ts
  _lastSentIndex = 0;
```

Replace the throttle block in `onPointerMove` (`js/canvas.ts:773-782`):

```ts
  // Throttled live drawing broadcast — delta only (see js/canvasDelta.ts)
  const now = Date.now();
  if (now - _lastDrawingSend > DRAWING_THROTTLE) {
    _lastDrawingSend = now;
    const payload = buildDrawingPayload(_currentPoints, _lastSentIndex, _penColor, _thickness);
    _lastSentIndex = _currentPoints.length;
    setDrawingState(_canvasId, _myUserId, payload).catch(() => {});
  }
```

In `onPointerUp` (`js/canvas.ts:785`), after `_currentPoints = [];` add `_lastSentIndex = 0;`.

- [ ] **Step 5: Wire the receiver (`js/canvas.ts:415-432`)**

Add module state next to the other watch state:

```ts
let _peerPreview: number[][] | null = null; // reassembled live-stroke buffer
```

Replace the `watchDrawing` callback body:

```ts
  _canvasUnsubs.push(watchDrawing(_canvasId, peerId, (drawingData) => {
    if (!drawingData) { _peerPreview = null; return; } // stroke ended (pointerup clears)
    const d = (drawingData as StrokeData & { base?: number });
    if (d.color) updatePeerDot(d.color);
    if (d.points) {
      const prevLen = _peerPreview ? _peerPreview.length : 0;
      const appended = d.base === prevLen && prevLen > 0;
      _peerPreview = applyDrawingPayload(_peerPreview, d);
      if (appended) {
        // Pure append: draw just the new segments (include the joint point);
        // no full clear-and-redraw per tick.
        renderStroke({ color: d.color, thickness: d.thickness, points: _peerPreview.slice(prevLen - 1) },
          _ctx, _canvas.width, _canvas.height);
      } else {
        // Replace/gap/legacy: fall back to the full repaint path.
        clearAndRedraw(_ctx, _canvas.width, _canvas.height, _bgColor, _allStrokes);
        renderStroke({ color: d.color, thickness: d.thickness, points: _peerPreview },
          _ctx, _canvas.width, _canvas.height);
        // Preserve my own in-progress stroke so it doesn't flash off while the
        // peer is drawing — _currentPoints isn't in _allStrokes until pointerup.
        if (_isDrawing && _currentPoints.length > 0) {
          renderStroke({ color: _penColor, thickness: _thickness, points: _currentPoints },
            _ctx, _canvas.width, _canvas.height);
        }
      }
    }
  }));
```

Also reset `_peerPreview = null;` wherever the canvas session tears down (`exitCanvas`'s cleanup, alongside the existing watcher unsubscribes).

- [ ] **Step 6: Verify**

Run: `npx jest tests/canvasDelta.test.js tests/canvas.test.js tests/canvas-sync.test.js && npm run typecheck`
Expected: PASS. If `tests/canvas-sync.test.js` pins the old full-array payload shape, update those assertions to the delta shape in the same commit — behavior contract, not incidental.

- [ ] **Step 7: Commit**

```bash
git add js/canvasDelta.ts js/canvas.ts tests/canvasDelta.test.js tests/canvas-sync.test.js
git commit -m "perf(canvas): delta live-draw broadcast — O(n) wire bytes per stroke, append-only preview rendering"
```

---

### Task 7: Memoize hot localStorage parses in `js/store.ts` (finding #7)

Skip re-`JSON.parse` when the raw string hasn't changed. Raw-string comparison keeps correctness identical (direct/cross-tab writes are still seen — the raw value is read every call) and needs no test-reset hooks.

**Files:**
- Modify: `js/store.ts` (`getFollowing`, `getPaletteState`)
- Test: `tests/store.test.js`

**Interfaces:**
- Produces: no signature changes. `getFollowing()` returns a fresh shallow-copied array per call (callers like `addFollowing` mutate the returned list — sharing one instance would leak).

- [ ] **Step 1: Write the failing test**

Append to `tests/store.test.js`:

```js
describe('parse memoization', () => {
  test('unchanged raw skips re-parse but still returns a fresh array', () => {
    localStorage.setItem('statusapp_following', JSON.stringify([{ userId: 'u1', code: 'C1' }]));
    const spy = jest.spyOn(JSON, 'parse');
    const a = getFollowing();
    const callsAfterFirst = spy.mock.calls.length;
    const b = getFollowing();
    expect(spy.mock.calls.length).toBe(callsAfterFirst); // second call: no parse
    expect(b).toEqual(a);
    expect(b).not.toBe(a); // fresh copy — callers mutate their list
    spy.mockRestore();
  });

  test('a direct localStorage write between calls is honored (cross-tab safety)', () => {
    localStorage.setItem('statusapp_following', JSON.stringify([{ userId: 'u1', code: 'C1' }]));
    getFollowing();
    localStorage.setItem('statusapp_following', JSON.stringify([{ userId: 'u2', code: 'C2' }]));
    expect(getFollowing()).toEqual([{ userId: 'u2', code: 'C2' }]);
  });
});
```

(Match the file's existing import/require style for `getFollowing` when adding.)

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/store.test.js -t memoization`
Expected: FAIL on the no-re-parse assertion.

- [ ] **Step 3: Implement**

In `js/store.ts`, replace `getFollowing` (keep `saveFollowing` as-is — the raw string it writes differs from `_followingRaw`, so the next read re-parses; that IS the write-through):

```ts
// Raw-string memo: getFollowing is called from render loops and the 60s label
// refresh; parsing the same string every call is pure waste. The raw value is
// still read (and compared) every call, so direct/cross-tab writes are seen.
let _followingRaw: string | null = null;
let _followingParsed: FollowingEntry[] = [];

function getFollowing(): FollowingEntry[] {
  const raw = localStorage.getItem(FOLLOWING_KEY);
  if (raw !== null && raw === _followingRaw) return _followingParsed.slice();
  let parsed: FollowingEntry[] = [];
  if (raw) {
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) {
        parsed = p.filter(e => e && typeof e.userId === 'string' && typeof e.code === 'string');
      }
    } catch { /* malformed → [] */ }
  }
  _followingRaw = raw;
  _followingParsed = parsed;
  return parsed.slice();
}
```

Apply the same raw-memo pattern to `getPaletteState` (`js/store.ts:95-116`). Consumers currently get a fresh object per call (from `JSON.parse`) and mutate it before `setPaletteState` round-trips, so memo hits must hand out a deep copy (`structuredClone` — es2022 DOM lib, jsdom ≥ 20):

```ts
let _paletteRaw: string | null = null;
let _paletteParsed: PaletteState | null = null;

function getPaletteState(): PaletteState {
  const raw = localStorage.getItem(PALETTE_STATE_KEY);
  if (raw !== null && raw === _paletteRaw && _paletteParsed) {
    return structuredClone(_paletteParsed);
  }
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.activeSet === 'number' && parsed.sets && parsed.sets['1'] && parsed.sets['2']) {
        _paletteRaw = raw;
        _paletteParsed = parsed;
        return structuredClone(parsed);
      }
    } catch { /* fall through to default */ }
  }
  // Write default first
  const state = JSON.parse(JSON.stringify(DEFAULT_PALETTE_STATE));
  localStorage.setItem(PALETTE_STATE_KEY, JSON.stringify(state));
  // Migrate legacy key
  const legacy = localStorage.getItem(PALETTE_LEGACY_KEY);
  if (legacy) {
    state.sets['1'].selectedKey = legacy;
    localStorage.setItem(PALETTE_STATE_KEY, JSON.stringify(state));
    localStorage.removeItem(PALETTE_LEGACY_KEY);
  }
  _paletteRaw = localStorage.getItem(PALETTE_STATE_KEY);
  _paletteParsed = state;
  return structuredClone(state);
}
```

- [ ] **Step 4: Verify**

Run: `npx jest tests/store.test.js tests/following.test.js tests/palettes.test.js tests/favorites.test.js tests/prefs.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/store.ts tests/store.test.js
git commit -m "perf(store): raw-string memo for getFollowing/getPaletteState — parse only when storage actually changed"
```

---

### Task 8: 60-second refresh repaints the time label only (finding #8)

**Files:**
- Modify: `js/following.ts:257-265` (extract the tick body as a testable function)
- Test: `tests/following.test.js`

**Interfaces:**
- Produces: `_refreshTimeLabels(myUserId: string): void` exported from `js/following.ts` (underscore-prefixed test seam, matching the repo's `_forTests` convention).

- [ ] **Step 1: Write the failing test**

Append to `tests/following.test.js` (uses the suite's existing jsdom setup; `updateFolloweeRow` is already exported and seeds the module's `lastUserData`):

```js
describe('60s time-label refresh', () => {
  test('repaints only the availableFor text, not the whole row', () => {
    document.body.innerHTML = `<ul id="people-list">
      <li data-user-id="u1"><div class="person-dot"></div><span class="person-status"></span></li>
    </ul>`;
    const entry = { userId: 'u1', code: 'C1' };
    const data = { status: 'available', availableUntil: Date.now() + 90 * 60000, statusColor: '#22c55e' };
    localStorage.setItem('statusapp_following', JSON.stringify([entry]));
    updateFolloweeRow(entry, data, 'me');
    const row = document.querySelector('#people-list [data-user-id="u1"]');
    const statusEl = row.querySelector('.person-status');
    const spanBefore = statusEl.querySelector('.status-available');
    const dotBefore = row.querySelector('.person-dot');

    _refreshTimeLabels('me');

    // Same nodes survived (no innerHTML rebuild) …
    expect(row.querySelector('.status-available')).toBe(spanBefore);
    expect(row.querySelector('.person-dot')).toBe(dotBefore);
    // … and the label reflects the current remaining time.
    expect(spanBefore.textContent).toMatch(/1\s*h|hour|9\d\s*min/i);
  });
});
```

(Import `_refreshTimeLabels` alongside the suite's existing `updateFolloweeRow` import. If the suite's fixtures already build richer rows, reuse those helpers instead of the inline `innerHTML` — the assertions are what matter: node identity preserved + text current.)

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/following.test.js -t "time-label refresh"`
Expected: FAIL (`_refreshTimeLabels` is not exported).

- [ ] **Step 3: Implement**

In `js/following.ts`, replace the interval body (`:257-265`) with a named, exported function and call it from the interval:

```ts
// 60s tick: advance "available for …" labels in place. A row whose
// availability actually FLIPPED (timer expired) gets the full repaint —
// label-only would leave a green row claiming availability. Rows in call mode
// have no .status-available span and also fall through to the full repaint.
export function _refreshTimeLabels(myUserId: string) {
  getFollowing().forEach((entry) => {
    const userData = lastUserData.get(entry.userId);
    if (!userData || userData.status !== 'available') return;
    if (editingSet.has(entry.userId)) return;
    if (!isAvailable(userData.status, userData.availableUntil)) {
      updateFolloweeRow(entry, userData, myUserId); // expired since last tick — full state flip
      return;
    }
    const span = followeeRow(entry.userId)?.querySelector('.status-available');
    if (span) span.textContent = availableForText(userData.availableUntil);
    else updateFolloweeRow(entry, userData, myUserId); // unexpected row shape — full paint
  });
}
```

```ts
  // Refresh time labels every 60s (label-only; see _refreshTimeLabels)
  refreshInterval = setInterval(() => _refreshTimeLabels(myUserId), 60000);
```

- [ ] **Step 4: Verify**

Run: `npx jest tests/following.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/following.ts tests/following.test.js
git commit -m "perf(following): 60s refresh updates the time label in place; full repaint only on state flips"
```

---

## Final gate (after Task 8)

- [ ] `npx jest` — full web suite green.
- [ ] `cd functions && npm test` — untouched, but confirm green (shared mirror guard etc.).
- [ ] `npm run typecheck && npm run typecheck:scripts` — green, zero suppressions added (`git diff dev --stat` + `grep -rn 'ts-ignore\|ts-expect-error' js/ scripts/` unchanged).
- [ ] `node scripts/prod.js` — record final `wc -c dist/bundle.js` and `gzip -9 -c dist/bundle.js | wc -c` against the 592,530 / 175,089 baseline in the commit or handoff notes.
- [ ] Smoke on a real device before any deploy: cold boot (web), cold boot (Telegram Mini App), phrase restore (exercises the lazy wordlist chunk), notifications opt-in (exercises the lazy messaging chunk), a two-device canvas session (exercises the delta protocol both directions).

## Deliberately out of scope

- Firebase `database`/`auth` SDK weight (223 KB) — already tree-shaken, both needed at boot.
- Hosting `Cache-Control` changes — the SW owns shell caching; files aren't content-hashed.
- Canvas stroke-history pruning — flagged in the audit as UNKNOWN-impact; measure real pair-canvas sizes first.
