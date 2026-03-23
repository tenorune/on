// sw.js
const CACHE = 'knockknock';
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
