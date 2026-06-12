// firebase-messaging-sw.js
//
// This app delivers web push through its own service worker (sw.js — see
// sw.template.js), and getToken() is always called with that registration
// passed explicitly, so the FCM token is bound to sw.js. The Firebase Cloud
// Messaging SDK, however, probes for a default worker at this exact path; when
// it's absent, Firebase Hosting's SPA rewrite returns index.html (text/html),
// and the browser logs:
//   "The script has an unsupported MIME type ('text/html')."
//
// Shipping this minimal, valid worker makes that probe (and any stale prior
// registration's update-check) resolve to JS instead of HTML, silencing the
// warning. It intentionally registers no push/fetch handlers: push is owned by
// sw.js, whose registration holds the FCM subscription, so nothing is ever
// delivered here.
self.addEventListener('install', () => self.skipWaiting());
