// sw.js
// Bump CACHE on every prod deploy that ships shell-asset changes (index.html,
// css/app.css, dist/bundle.js). The byte-change forces browsers to fire
// install → fetch fresh SHELL → activate purges the old cache. Without a
// bump, an identical sw.js means no install event, so existing PWA users
// keep serving cached old shell until a manual hard-refresh.
const CACHE = 'knockknock-v3';
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
