// sw.template.js — source for the service worker.
// The build (scripts/build.js writeServiceWorker) stamps the cache name below
// with a hash of the shell assets and writes sw.js. The hash changes whenever
// the shell (index.html, css/app.css, dist/bundle.js, manifest.json) changes, so
// every real deploy ships a byte-different sw.js → the browser detects the
// update, installs the fresh shell, activates, and the page reloads (see
// app.js). No manual version bump required.
const CACHE = '__CACHE_VERSION__';
const SHELL = ['/', '/index.html', '/css/app.css', '/dist/bundle.js', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)),
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
  // Only cache GET requests for shell assets; let Firebase requests go through
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('firebaseio.com') || e.request.url.includes('googleapis.com')) return;

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
    const focused = (await self.clients.matchAll({ type: 'window' }))
      .some((c) => c.focused || c.visibilityState === 'visible');
    if (focused) return; // foreground de-dupe: the live in-app UI already handled it
    await self.registration.showNotification(d.title || 'KnockKnock', {
      body: d.body || '',
      tag: d.type ? `${d.type}:${d.targetUid || ''}` : undefined,
      data: { type: d.type, targetUid: d.targetUid, contextGroupId: d.contextGroupId },
    });
  })());
});

// Where a cold tap (no live client to postMessage) should land. Invite and
// follow-request taps deep-link to the Inbox — the recipient isn't in the
// group, and on a cold start they'd otherwise boot into their last (stale)
// context with no inbox affordance. Group activity deep-links into the group;
// everything else lands on Direct.
function coldStartUrl(data) {
  if (data.type === 'invite' || data.type === 'followRequest') return '/?inbox=1';
  if (data.contextGroupId) return `/?group=${encodeURIComponent(data.contextGroupId)}`;
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
