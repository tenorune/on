// sw.js
// Bump CACHE on every prod deploy that ships shell-asset changes (index.html,
// css/app.css, dist/bundle.js). The byte-change forces browsers to fire
// install → fetch fresh SHELL → activate purges the old cache. Without a
// bump, an identical sw.js means no install event, so existing PWA users
// keep serving cached old shell until a manual hard-refresh.
const CACHE = 'knockknock-v7';
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

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  const url = data.contextGroupId ? `/?group=${encodeURIComponent(data.contextGroupId)}` : '/';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = all.find((c) => 'focus' in c);
    if (client) { client.postMessage({ kind: 'notification-click', data }); return client.focus(); }
    return self.clients.openWindow(url);
  })());
});
