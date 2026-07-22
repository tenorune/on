# Zero-reload PWA updates — portable pattern

Audience: an agent (or developer) adding automatic updates to a different PWA.
Goal: **users never manually reload**. A deployed update is picked up the next
time the app is opened or foregrounded — including home-screen (standalone)
PWAs on iOS, which never re-check anything on their own.

This is the pattern proven in the KnockKnock app (see `sw.template.js`,
`scripts/build.js` `writeServiceWorker()`, and `initServiceWorker()` in
`js/app.js` of that repo). Everything below is self-contained; no code from
that app is required.

## The idea in one paragraph

The service worker file itself is the version stamp. At build time, hash the
app-shell assets and bake the hash into `sw.js` as the cache name. Any real
change to the shell produces a byte-different `sw.js`; the browser's built-in
byte-comparison then detects an update. The new worker installs (precaching
the fresh shell into a new cache), activates immediately (`skipWaiting` +
`clients.claim`), old caches are deleted, and the page reloads itself exactly
once on `controllerchange` — with the new shell already cached, so the reload
is instant. Because iOS standalone PWAs resume without a navigation (so the
browser never re-checks `sw.js` spontaneously), the page also calls
`registration.update()` on every foreground.

Four cooperating pieces. All four are required; each exists to fix a specific
failure mode.

## Piece 1 — build step: stamp a content hash into sw.js

Keep the worker as a template (`sw.template.js`) with a placeholder, and
generate the deployable `sw.js` at build time:

```js
// in the build script — run AFTER bundling/minification, so hashed inputs exist
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync, existsSync } = require('node:fs');

function writeServiceWorker(root) {
  const template = readFileSync(`${root}/sw.template.js`, 'utf8');
  const hash = createHash('sha256');
  // List every asset the SW precaches (the "shell"). Same list as SHELL below.
  for (const f of ['dist/bundle.js', 'css/app.css', 'index.html', 'manifest.json']) {
    if (existsSync(`${root}/${f}`)) hash.update(readFileSync(`${root}/${f}`));
  }
  const version = `myapp-${hash.digest('hex').slice(0, 12)}`;
  writeFileSync(`${root}/sw.js`, template.replace(/__CACHE_VERSION__/g, version));
  return version;
}
```

Why this shape:

- **No manual version bump, ever.** Deploys that change the shell update the
  hash automatically; deploys that don't (docs, server-only) leave `sw.js`
  identical and no client reloads for nothing.
- **Ordering matters.** Stamp `sw.js` after the bundle/CSS/HTML are in their
  final bytes, or the hash describes the previous build.
- **The hashed set and the precached set must match.** If the SW precaches a
  file that isn't hashed, changes to it never trigger an update.

## Piece 2 — the service worker: cache-first shell, immediate takeover

```js
// sw.template.js — build stamps __CACHE_VERSION__ and writes sw.js
const CACHE = '__CACHE_VERSION__';
const SHELL = ['/', '/index.html', '/css/app.css', '/dist/bundle.js', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting(); // don't wait for all tabs to close — take over now
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim(); // control already-open pages → fires controllerchange
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // SAME-ORIGIN ONLY. Intercepting cross-origin requests and re-issuing
  // fetch(e.request) rejects respondWith on Safari ("TypeError: Load failed"),
  // which silently breaks third-party SDKs (Firebase Auth/FCM, gapi, …).
  // An origin allowlist beats a host denylist — denylists miss hosts.
  if (new URL(e.request.url).origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request)),
  );
});
```

Why this shape:

- **`skipWaiting()` + `clients.claim()`** are what make updates immediate. The
  default lifecycle parks the new worker in "waiting" until every tab closes —
  for a home-screen PWA that can be days. The cost: activation can interrupt a
  user mid-interaction with a reload. Acceptable when the app restores its own
  state on boot and the reload is instant (shell already precached). If your
  app can lose meaningful in-progress user input on reload, either persist
  that input continuously or defer the reload until idle — do **not** fall
  back to a "new version available, tap to refresh" banner unless the operator
  asks for one; the whole point is zero manual reloads.
- **One versioned cache, delete the rest on activate.** The cache name *is*
  the version, so cleanup is a one-liner and storage never accumulates.
- **Cache-first for the shell** gives offline startup and instant loads. The
  shell never goes stale-forever because the SW file itself rotates the cache.
- **GET only, same-origin only.** The Safari cross-origin failure above was a
  real production bug; the origin check is load-bearing, not style.

## Piece 3 — page-side registration: reload once on takeover

```js
// Call once at app startup.
function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Guard: on the FIRST-EVER install there was no controller before
  // registration; claim() will fire controllerchange, and reloading then
  // would reload every new visitor. Only reload for genuine updates.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false; // controllerchange can fire more than once
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    window.location.reload();
  });
  // updateViaCache 'none' makes update checks bypass the HTTP cache at the
  // spec level — see piece 4 for why the default is not enough on iOS.
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((reg) => {
    // Piece 4: iOS standalone PWAs resume without a navigation, so the
    // browser never re-checks sw.js on its own. Poke it on every foreground
    // (and once at launch) so a deployed update is noticed promptly.
    const checkForUpdate = () => { reg.update().catch(() => {}); };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    });
    checkForUpdate();
  }).catch(console.error);
}
```

Why this shape:

- **`hadController` guard.** Without it, the very first visit installs, claims,
  fires `controllerchange`, and reloads a page that was already fresh —
  visible flicker for every new user.
- **`reloading` flag.** Prevents reload loops if `controllerchange` fires
  repeatedly.
- **`visibilitychange` → `reg.update()`** is the piece that makes home-screen
  PWAs work. Browsers only re-check `sw.js` on navigations (throttled to
  24 h); a standalone PWA resumed from the app switcher performs no
  navigation, so without this poke an iOS user can run a stale build
  indefinitely. Desktop/Android benefit too — updates land on foreground
  instead of next launch.

## Piece 4 — hosting: `sw.js` must be `no-store`, everything else revalidates

Serve the app `no-cache`, but `sw.js` itself `no-store` (Firebase Hosting
syntax; when a path matches multiple blocks, the LATER block wins for a
duplicate header key — keep the `sw.js` block after `**`):

```json
"headers": [
  { "source": "**", "headers": [ { "key": "Cache-Control", "value": "no-cache" } ] },
  { "source": "/sw.js", "headers": [ { "key": "Cache-Control", "value": "no-store" } ] }
]
```

- `no-cache` means "revalidate before use" (a conditional request, usually a
  cheap 304), not "don't cache". Instant loads and offline still come from the
  SW cache, so the HTTP cache adds little here — correctness beats it.
- **`no-cache` is NOT enough for `sw.js` itself** (device-observed, iOS
  WebKit, 2026-07-21): the SW *update check* was answered from
  conditional-revalidation cache state with stale bytes — `reg.update()`
  "succeeded" seeing the old worker for days while every unconditional fetch
  of the same URL returned the new one, so the PWA never auto-updated.
  `no-store` leaves nothing to revalidate on either the client or CDN side.
  Pair it with `updateViaCache: 'none'` at `register()` (piece 3) — belt and
  braces against the same failure. The cost is one small unconditional fetch
  per check instead of a 304, for one file.
- **Do NOT reach for a cache-busting registration URL** (`sw.js?v=…`)
  instead: a script-URL change forces an install+activate+reload even when
  the worker bytes are identical — with a per-boot value that is a visible
  reload on every app open. And a build-stamped value can't help the stuck
  devices anyway: the registering code is itself served from the old SW's
  cache-first shell, so the stamp never changes exactly where it would matter.
- **A long-cached `sw.js` breaks the entire scheme**: the browser re-checks
  the file but the CDN/HTTP cache keeps handing back the old bytes, and no
  client ever updates. If anything must be long-cached, exempt `sw.js` (and
  `index.html`).
- This design deliberately skips hashed *filenames* (`bundle.abc123.js`) —
  the hashed *cache name* plays that role, and stable filenames keep the
  HTML template static. If a project already has hashed filenames, keep them;
  just make sure the SHELL list and the build hash cover the final names.

## The end-to-end update timeline

1. Deploy: build re-stamps `sw.js` with a new hash (only if shell bytes changed).
2. User foregrounds the PWA → `visibilitychange` → `reg.update()`.
3. Browser fetches `sw.js` (`no-store` + `updateViaCache: 'none'` — a full
   fresh read, no stale copy possible), sees new bytes.
4. New worker installs: precaches the **new** shell into the **new** cache
   while the old one still serves the page.
5. `skipWaiting` → activate → old caches deleted → `clients.claim()`.
6. `controllerchange` fires on the page → one `window.location.reload()`.
7. The reload is served cache-first from the freshly precached shell —
   effectively instant, works even if the network dropped after step 4.

Users on the old version who never foreground again simply get the update on
their next open. Nobody ever sees a "please refresh" prompt.

## Gotchas checklist for the implementing agent

- [ ] Serve `sw.js` from the origin root (or set the `Service-Worker-Allowed`
      header) so its scope covers the whole app.
- [ ] Run the SW stamping **last** in the build, after every hashed input.
- [ ] Keep the hash-input list and the `SHELL` precache list in sync.
- [ ] Same-origin check in `fetch` — do not proxy cross-origin requests
      (breaks Safari + third-party SDKs).
- [ ] `hadController` guard so first install doesn't reload new visitors.
- [ ] `Cache-Control` on `sw.js` must be `no-store` — revalidation
      (`no-cache`) is not enough on iOS WebKit; pair with
      `updateViaCache: 'none'` at `register()`.
- [ ] **Skip SW registration inside embedded webviews** (e.g. a Telegram
      Mini App): there's no offline-shell need there, and the update-reload
      cycle fights the host's own webview lifecycle. Detect the context and
      don't call `initServiceWorker()`.
- [ ] If the app holds unsaved in-memory user input, persist it (or defer the
      reload until idle) before adopting `skipWaiting`.
- [ ] Verify by deploying a trivial shell change, backgrounding and
      re-foregrounding the installed PWA, and watching it reload once into
      the new version. Check `caches.keys()` shows only the new cache name.
