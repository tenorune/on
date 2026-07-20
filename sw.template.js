// sw.template.js — source for the service worker.
// The build (scripts/build.js writeServiceWorker) stamps the cache name below
// with a hash of the shell assets and writes sw.js. The hash changes whenever
// the shell (index.html, dist/css/app.css, dist/css/canvas.css, dist/bundle.js,
// manifest.json) changes, so
// every real deploy ships a byte-different sw.js → the browser detects the
// update, installs the fresh shell, activates, and the page reloads (see
// app.js). No manual version bump required.
const CACHE = '__CACHE_VERSION__';
const SHELL = ['/', '/index.html', '/dist/css/app.css', '/dist/css/canvas.css', '/dist/bundle.js', '/manifest.json'];

// Code-split chunks, substituted at build (comma-joined). The unsubstituted
// template filters to [] so tests can load this file directly.
const CHUNKS = '__CHUNK_LIST__'.split(',').filter((s) => s && s.indexOf('__') !== 0);

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // Chunk filenames are content-hashed — a URL that exists in a previous
      // version's cache is byte-identical, so copy it across instead of
      // re-fetching the whole set on every deploy (activate deletes the old
      // cache afterwards, which used to throw all unchanged chunks away).
      // The shell proper (unhashed URLs) is always re-fetched.
      const missing = [];
      await Promise.all(CHUNKS.map((url) =>
        caches.match(url).then((prior) => {
          if (prior) return cache.put(url, prior);
          missing.push(url);
          return undefined;
        }),
      ));
      await cache.addAll(SHELL.concat(missing));
    }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Only the same-origin app shell is cached here. Cross-origin requests
  // (Firebase RTDB, apis.google.com/gapi, fcmregistrations.googleapis.com,
  // gstatic, the auth iframe, …) MUST go straight to the network: intercepting
  // them and re-issuing fetch(e.request) rejects respondWith on Safari
  // ("FetchEvent.respondWith received an error: TypeError: Load failed"), which
  // breaks Firebase Auth + FCM token registration there. An origin allowlist
  // replaces the old firebaseio/googleapis host denylist, which missed
  // apis.google.com (gapi) and gstatic.
  if (new URL(e.request.url).origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request)),
  );
});

self.addEventListener('push', (e) => {
  if (!e.data) return;
  let payload = {};
  try { payload = e.data.json(); } catch { return; }
  // FCM data messages arrive wrapped: the fields we sent live under payload.data.
  // Fall back to the top level so a raw (non-FCM) Web Push payload also works.
  const d = (payload && payload.data) ? payload.data : (payload || {});
  e.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window' });
    const appVisible = windows.some((c) => c.focused || c.visibilityState === 'visible');
    // #156 debug: tell any open client a push reached the SW (distinguishes
    // "delivery never arrived" from "arrived but didn't display"), and whether
    // the app was visible. The NOTIFY_DEBUG readout listens.
    for (const c of windows) {
      try { c.postMessage({ kind: 'push-debug', at: Date.now(), type: d.type || null, appVisible }); } catch { /* client gone */ }
    }
    // ALWAYS present a notification — no foreground de-dupe. Apple: "Safari
    // doesn't support invisible push notifications… If you don't [present one],
    // Safari revokes the push notification permission for your site." Receiving
    // a push while the app was visible and showing nothing silently killed all
    // future Safari delivery. The cost is a possibly-redundant banner when the
    // app is already focused, which is acceptable (and required on Safari).
    //
    // A reused tag (e.g. two calls from the same person → `call:<uid>`) coalesces
    // into one notification; without renotify the OS updates it SILENTLY, so a
    // repeat appears to "not notify". renotify re-alerts; it requires a tag, so
    // set it only when we have one (an untagged notification with renotify throws).
    const tag = d.type ? `${d.type}:${d.targetUid || ''}` : undefined;
    await self.registration.showNotification(d.title || 'KnockKnock', {
      body: d.body || '',
      tag,
      renotify: tag ? true : undefined,
      data: { type: d.type, targetUid: d.targetUid, contextGroupId: d.contextGroupId },
    });
  })());
});

// #156 debug: report the controlling SW's cache version on request, so the
// readout can confirm THIS (updated) worker is actually controlling the page —
// Safari is prone to keeping an old worker around.
self.addEventListener('message', (e) => {
  if (e.data && e.data.kind === 'debug-ping' && e.source) {
    try { e.source.postMessage({ kind: 'debug-pong', cache: CACHE }); } catch { /* gone */ }
  }
});

// Where a cold tap (no live client to postMessage) should land. Invite and
// follow-request taps deep-link to the Inbox — the recipient isn't in the
// group, and on a cold start they'd otherwise boot into their last (stale)
// context with no inbox affordance. Group activity deep-links into the group;
// everything else lands on Direct.
function coldStartUrl(data) {
  if (data.type === 'invite' || data.type === 'followRequest') return '/?inbox=1';
  // Only route to a group whose id matches the real format (8× [A-Z0-9]); the
  // payload is attacker-controllable, so a forged id must not reach the URL (#164 R3c).
  if (data.contextGroupId && /^[A-Z0-9]{8}$/.test(data.contextGroupId)) return `/?group=${encodeURIComponent(data.contextGroupId)}`;
  // Direct-scope activity (knock/call/availability, no contextGroupId) lands in
  // Direct — otherwise a cold boot restores the user's last (group) context and
  // the Direct activity is never seen (#144).
  if (data.type === 'knock' || data.type === 'call' || data.type === 'availability') return '/?direct=1';
  return '/';
}

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  const url = coldStartUrl(data);
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = all.find((c) => 'focus' in c);
    if (client) { client.postMessage({ kind: 'notification-click', data }); return client.focus(); }
    return self.clients.openWindow(url);
  })());
});
